"use server";
import { revalidatePath } from "next/cache";
import { inserirExecucao } from "@/src/lib/acoes/execucao-grupo";
import { paraZapbot, type ConexaoLinha } from "@/src/lib/conexoes";
import { registrarHistorico } from "@/src/lib/historico";
import {
  abaRegistraLeitura,
  classificarPedidos,
  decidirPedidos,
  enfileirarSolicitacoes,
  lerPendentes,
  registrarLeitura,
  type GrupoDecisao,
  type GrupoParaLeitura,
  type ResultadoLeitura,
} from "@/src/lib/jobs/solicitacoes";
import type { ItemSolicitacaoHook } from "@/src/lib/regras/webhooks";
import { checarPermissao, permitido } from "@/src/lib/permissoes";
import {
  MAX_GRUPOS_PENDENTES,
  MAX_APROVAR_TAGS,
  MAX_ITENS_DECISAO,
  mensagemDecisao,
  resumoHistoricoDecisao,
  separarPedidos,
  vagasDoGrupo,
} from "@/src/lib/regras/solicitacoes";
import { ehUuid } from "@/src/lib/regras/uuid";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { mascararTelefone, telefoneLegivel } from "@/src/lib/telefone";
import { PRAZO_TELA_MS, zapbot } from "@/src/lib/zapbot/client";

/** Linha da aba Pendentes. `telefone` só vem para quem tem Leads/ver (senão `null` e `numero` mascarado). */
export type PendenteItem = {
  chave: string;
  grupoId: string;
  grupoNome: string;
  telefone: string | null;
  numero: string;
  pedidoEm: string | null;
  bloqueado: boolean;
  lid: boolean;
};

export type ResultadoPendentes = { erro?: string; itens?: PendenteItem[]; semResposta?: number; verLeads?: boolean };

/** Pendentes, lidos ao vivo ao abrir a aba (e no ATUALIZAR): até 40 grupos ativos da campanha com conta conectada (os
 *  de maior número primeiro), 4 em paralelo, 8 s por chamada, `PRAZO_TELA_MS` no total (`lerPendentes`). Grupos com a
 *  conta desconectada entram no "não responderam". O chip
 *  "Bloqueado" é só aviso: quem barra de verdade é `decidirPedidos`, na hora de aprovar. */
export async function listarPendentes(campanhaId: string): Promise<ResultadoPendentes> {
  const acesso = await checarPermissao("campanhas", "ver");
  if (!acesso.ok) return { erro: acesso.erro };
  if (!ehUuid(campanhaId)) return { erro: "Campanha inválida." };
  const verLeads = await permitido("leads", "ver");
  const db = dbAdmin();
  const [{ data, error }, desconectados] = await Promise.all([
    db
      .from("grupos")
      .select("id, group_id, nome, numero, conexao_id, conexoes!inner(*)")
      .eq("campanha_id", campanhaId)
      .eq("ativo", true)
      .eq("conexoes.status", "conectado")
      .order("numero", { ascending: false })
      .limit(MAX_GRUPOS_PENDENTES),
    contarGruposDesconectados(campanhaId),
  ]);
  if (error) return { erro: "Não foi possível carregar os grupos da campanha." };

  const linhas = (data ?? []) as { id: string; group_id: string; nome: string; conexao_id: string; conexoes: ConexaoLinha | ConexaoLinha[] | null }[];
  const grupos: GrupoParaLeitura[] = [];
  let semCredencial = 0;
  for (const g of linhas.slice(0, MAX_GRUPOS_PENDENTES)) {
    const conexao = Array.isArray(g.conexoes) ? g.conexoes[0] : g.conexoes;
    try {
      if (!conexao) throw new Error("sem conexão");
      grupos.push({ id: g.id, groupId: g.group_id, nome: g.nome, conexaoId: g.conexao_id, conexao: paraZapbot(conexao) });
    } catch {
      semCredencial++;
    }
  }
  const { pedidos, semResposta, responderam } = await lerPendentes(zapbot(), grupos, { prazoMs: PRAZO_TELA_MS });
  // Só registra (e só vira Hook) quando a campanha usa os pedidos vistos (revisão final A): com tudo desligado,
  // abrir a aba só lê.
  const registra = responderam.length ? await abaRegistraLeitura(db, campanhaId) : { grava: false };
  if (registra.grava) {
    const lidas = await registrarLeituraDaAba(db, campanhaId, grupos, pedidos, responderam);
    // Hook "Solicitações de entrada em grupos" (Etapa 3N, Tarefa 3): novos e fechados desta leitura. Nunca lança.
    await enfileirarSolicitacoes(db, campanhaId, lidas, registra.webhooks !== undefined ? { webhooks: registra.webhooks } : {});
  }

  let separados;
  try {
    separados = separarPedidos(pedidos, await classificarPedidos(db, pedidos.map((p) => p.telefone)));
  } catch {
    return { erro: "Não foi possível conferir os números bloqueados. Tente de novo." };
  }
  const bloqueados = new Set(separados.bloqueados);
  const lids = new Set(separados.soLid);
  const nomes = new Map(grupos.map((g) => [g.id, g.nome]));
  const itens: PendenteItem[] = pedidos.map((p, i) => ({
    chave: `${p.grupoId}:${i}`,
    grupoId: p.grupoId,
    grupoNome: nomes.get(p.grupoId) ?? "",
    telefone: verLeads ? p.telefone : null,
    numero: verLeads ? telefoneLegivel(p.telefone) : (mascararTelefone(p.telefone) ?? "••••"),
    pedidoEm: p.pedidoEm,
    bloqueado: bloqueados.has(p),
    lid: lids.has(p),
  }));
  return { itens, semResposta: semResposta.length + semCredencial + desconectados, verLeads };
}

/** Registra em `solicitacoes_vistas` a leitura de cada grupo que respondeu (leitura completa), 8 por vez. A aba não
 *  acabou de ler os participantes (`participantesFrescos: false`): só fecha como "aprovada pelo celular" quem já
 *  aparece no grupo; os outros sumidos ficam para a conferência. Melhor esforço: falha só vai pro log e a aba mostra a
 *  lista do mesmo jeito. Devolve a leitura de cada grupo registrado (pro Hook). */
async function registrarLeituraDaAba(
  db: ReturnType<typeof dbAdmin>,
  campanhaId: string,
  grupos: readonly GrupoParaLeitura[],
  pedidos: readonly { grupoId: string; telefone: string; pedidoEm: string | null }[],
  responderam: readonly string[],
): Promise<{ grupo: GrupoDecisao; leitura: ResultadoLeitura }[]> {
  const lidas: { grupo: GrupoDecisao; leitura: ResultadoLeitura }[] = [];
  const porId = new Map(grupos.map((g) => [g.id, g]));
  const agora = new Date().toISOString();
  const alvos = responderam.filter((id) => porId.has(id));
  for (let i = 0; i < alvos.length; i += 8) {
    await Promise.all(
      alvos.slice(i, i + 8).map(async (id) => {
        const g = porId.get(id)!;
        const grupo = { id: g.id, groupId: g.groupId, nome: g.nome };
        try {
          const leitura = await registrarLeitura(db, {
            campanhaId,
            grupo,
            pedidos: pedidos.filter((p) => p.grupoId === id),
            completa: true,
            agora,
            participantesFrescos: false,
          });
          lidas.push({ grupo, leitura });
        } catch (e) {
          console.error(`[solicitacoes] leitura do grupo ${id} não foi registrada: ${e instanceof Error ? e.message : e}`);
        }
      }),
    );
  }
  return lidas;
}

/** Grupos ativos da campanha cuja conta não está conectada (ou sem conta): não dá pra ler os pedidos deles, então
 *  entram no "N grupo(s) não responderam". Só a coluna `status` da conta. Falha na leitura conta 0 (melhor esforço:
 *  a aba continua com o que leu). */
async function contarGruposDesconectados(campanhaId: string): Promise<number> {
  const { data, error } = await dbAdmin().from("grupos").select("id, conexoes(status)").eq("campanha_id", campanhaId).eq("ativo", true);
  if (error) {
    console.error(`[solicitacoes] não foi possível contar os grupos desconectados da campanha ${campanhaId}: ${error.message}`);
    return 0;
  }
  return ((data ?? []) as { conexoes: { status: string } | { status: string }[] | null }[]).filter((g) => {
    const conta = Array.isArray(g.conexoes) ? g.conexoes[0] : g.conexoes;
    return conta?.status !== "conectado";
  }).length;
}

export type ItemDecisao = { grupoId: string; telefone: string };

/** Teto do clique inteiro (vários grupos): o que não couber vira "falhou" (nada enviado ao Zapbot). */
const PRAZO_DECISAO_MS = 45_000;

/** Corpo comum de aprovar/recusar; quem chama já conferiu `campanhas`/`editar` e `leads`/`ver`. */
async function decidir(usuario: { id: string; email?: string | null }, campanhaId: string, itens: unknown, decisao: "aprovada" | "recusada"): Promise<{ erro?: string; mensagem?: string }> {
  if (!ehUuid(campanhaId)) return { erro: "Campanha inválida." };
  if (!Array.isArray(itens) || !itens.length) return { erro: "Escolha ao menos uma solicitação." };
  if (itens.length > MAX_ITENS_DECISAO) return { erro: `No máximo ${MAX_ITENS_DECISAO} solicitações por vez.` };
  const validos: ItemDecisao[] = [];
  for (const i of itens as unknown[]) {
    const it = (i ?? {}) as Record<string, unknown>;
    if (!ehUuid(it.grupoId) || typeof it.telefone !== "string" || !/^[0-9]{6,20}(@lid)?$/i.test(it.telefone.trim())) return { erro: "Solicitação inválida." };
    validos.push({ grupoId: it.grupoId as string, telefone: it.telefone.trim() });
  }

  const db = dbAdmin();
  const grupoIds = [...new Set(validos.map((v) => v.grupoId))];
  const { data, error } = await db
    .from("grupos")
    .select("id, group_id, nome, participantes, cheio, conexoes(*), campanhas(limite_por_grupo)")
    .eq("campanha_id", campanhaId)
    .eq("ativo", true)
    .in("id", grupoIds);
  if (error) return { erro: "Não foi possível carregar os grupos." };
  type Linha = { id: string; group_id: string; nome: string; participantes: number | null; cheio: boolean | null; conexoes: ConexaoLinha | null; campanhas: { limite_por_grupo: number } | null };
  const porId = new Map(((data ?? []) as unknown as Linha[]).map((g) => [g.id, g]));
  // Todo grupo tem que ser grupo ativo desta campanha: senão nada é feito.
  if (grupoIds.some((id) => !porId.has(id))) return { erro: "Grupo inválido." };

  const total = { ok: 0, falhas: 0, bloqueados: 0 };
  const decididas: { grupo: GrupoDecisao; decisoes: ItemSolicitacaoHook[] }[] = [];
  const fim = Date.now() + PRAZO_DECISAO_MS;
  for (const grupoId of grupoIds) {
    const g = porId.get(grupoId)!;
    const telefones = [...new Set(validos.filter((v) => v.grupoId === grupoId).map((v) => v.telefone))];
    const sobra = fim - Date.now();
    if (!g.conexoes || g.conexoes.status !== "conectado" || sobra < 2_000) {
      total.falhas += telefones.length;
      continue;
    }
    try {
      const r = await decidirPedidos(db, zapbot(), paraZapbot(g.conexoes), {
        campanhaId,
        grupo: { id: g.id, groupId: g.group_id, nome: g.nome },
        telefones,
        decisao,
        origem: "manual",
        usuario: usuario.id,
        vagas: decisao === "aprovada" ? vagasDoGrupo(g.campanhas?.limite_por_grupo, Number(g.participantes ?? 0), g.cheio === true) : undefined,
        prazoTotalMs: Math.min(PRAZO_TELA_MS, sobra),
      });
      total.ok += r.ok;
      total.falhas += r.falhas;
      total.bloqueados += r.bloqueados;
      if (r.decisoes?.length) decididas.push({ grupo: { id: g.id, groupId: g.group_id, nome: g.nome }, decisoes: r.decisoes });
    } catch (e) {
      console.error(`[solicitacoes] decisão no grupo ${grupoId} falhou: ${e instanceof Error ? e.message : e}`);
      total.falhas += telefones.length;
    }
  }
  // Hook `decisao` (Etapa 3N, Tarefa 3): nunca lança; a resposta da tela não muda se falhar.
  await enfileirarSolicitacoes(db, campanhaId, decididas);
  revalidatePath(`/campanhas/${campanhaId}/solicitacoes`, "layout");
  await registrarHistorico(usuario, {
    acao: "atualizar",
    area: "Campanhas",
    resumo: resumoHistoricoDecisao(decisao === "aprovada" ? total.ok : 0, decisao === "recusada" ? total.ok : 0),
    refId: campanhaId,
  });
  return { mensagem: mensagemDecisao(decisao, total) };
}

/** "Aprovar selecionadas": `campanhas`/`editar` + `leads`/`ver`; até 200; bloqueado e LID nunca são aprovados
 *  (reconferido no servidor, na hora). */
export async function aprovarSelecionadas(campanhaId: string, itens: ItemDecisao[]): Promise<{ erro?: string; mensagem?: string }> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  // Precisa ver o número inteiro pra escolher quem entra (mesma regra de Contatos/API/MCP).
  const leads = await checarPermissao("leads", "ver");
  if (!leads.ok) return { erro: leads.erro };
  return decidir(acesso.usuario, campanhaId, itens, "aprovada");
}

/** "Recusar selecionadas": mesmas travas de permissão e de grupo. */
export async function recusarSelecionadas(campanhaId: string, itens: ItemDecisao[]): Promise<{ erro?: string; mensagem?: string }> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const leads = await checarPermissao("leads", "ver");
  if (!leads.ok) return { erro: leads.erro };
  return decidir(acesso.usuario, campanhaId, itens, "recusada");
}

export type ConfiguracoesSolicitacoes = {
  aprovacao_entrada: boolean;
  recusar_bloqueados: boolean;
  aprovar_automaticamente: boolean;
  /** Etapa 3N. Ausentes = mantém o que está gravado. */
  reservar_vaga_pendentes?: boolean;
  aprovar_por_tag?: boolean;
  aprovar_tags?: string[];
};

type Booleanas = "aprovacao_entrada" | "recusar_bloqueados" | "aprovar_automaticamente" | "reservar_vaga_pendentes" | "aprovar_por_tag";

const ROTULO_CONFIG: Record<Booleanas, string> = {
  aprovacao_entrada: "exigir aprovação",
  recusar_bloqueados: "recusar bloqueados",
  aprovar_automaticamente: "aprovar automaticamente",
  reservar_vaga_pendentes: "reservar vaga",
  aprovar_por_tag: "aprovar por tag",
};

const COLUNAS_CONFIG = "aprovacao_entrada, recusar_bloqueados, aprovar_automaticamente, reservar_vaga_pendentes, aprovar_por_tag, aprovar_tags";

/** Aba Configurações. "Exigir aprovação" mudou → cria a execução `configuracao {aprovacao_entrada}` em massa (todos os
 *  grupos ativos, pelo mesmo caminho do "Alterar grupos em lote") e SÓ DEPOIS grava a campanha. As regras só gravam a
 *  coluna (a conferência lê). Sem aprovação, "aprovar automaticamente" e "aprovar por tag" são gravados desligados;
 *  "aprovar por tag" sem nenhuma tag também. `aprovar_tags`: até 20 ids, todos de tags que existem (conferido no
 *  banco). Campos novos ausentes mantêm o valor gravado. */
export async function salvarConfiguracoesSolicitacoes(campanhaId: string, entrada: ConfiguracoesSolicitacoes): Promise<{ erro?: string; mensagem?: string }> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  if (!ehUuid(campanhaId)) return { erro: "Campanha inválida." };
  const e = (entrada ?? {}) as Partial<Record<keyof ConfiguracoesSolicitacoes, unknown>>;
  if (typeof e.aprovacao_entrada !== "boolean" || typeof e.recusar_bloqueados !== "boolean" || typeof e.aprovar_automaticamente !== "boolean") {
    return { erro: "Valor inválido." };
  }
  for (const k of ["reservar_vaga_pendentes", "aprovar_por_tag"] as const) {
    if (e[k] !== undefined && typeof e[k] !== "boolean") return { erro: "Valor inválido." };
  }
  let tagsNovas: string[] | undefined;
  if (e.aprovar_tags !== undefined) {
    if (!Array.isArray(e.aprovar_tags) || e.aprovar_tags.some((t) => !ehUuid(t))) return { erro: "Tag inválida." };
    tagsNovas = [...new Set(e.aprovar_tags as string[])];
    if (tagsNovas.length > MAX_APROVAR_TAGS) return { erro: `No máximo ${MAX_APROVAR_TAGS} tags.` };
  }

  const db = dbAdmin();
  const { data: antes, error: erroAntes } = await db.from("campanhas").select(COLUNAS_CONFIG).eq("id", campanhaId).maybeSingle();
  if (erroAntes) return { erro: "Não foi possível carregar a campanha." };
  if (!antes) return { erro: "Campanha não encontrada." };
  const anterior = antes as Partial<Record<Booleanas, boolean | null>> & { aprovar_tags?: string[] | null };

  if (tagsNovas?.length) {
    const { data: existentes, error: erroTags } = await db.from("tags").select("id").in("id", tagsNovas);
    if (erroTags) return { erro: "Não foi possível conferir as tags." };
    const ok = new Set(((existentes ?? []) as { id: string }[]).map((t) => t.id));
    if (tagsNovas.some((t) => !ok.has(t))) return { erro: "Tag inválida." };
  }
  const tags = tagsNovas ?? [...(anterior.aprovar_tags ?? [])];
  const novo: Record<Booleanas, boolean> = {
    aprovacao_entrada: e.aprovacao_entrada,
    recusar_bloqueados: e.recusar_bloqueados,
    aprovar_automaticamente: e.aprovacao_entrada && e.aprovar_automaticamente,
    reservar_vaga_pendentes: typeof e.reservar_vaga_pendentes === "boolean" ? e.reservar_vaga_pendentes : anterior.reservar_vaga_pendentes === true,
    aprovar_por_tag: e.aprovacao_entrada && tags.length > 0 && (typeof e.aprovar_por_tag === "boolean" ? e.aprovar_por_tag : anterior.aprovar_por_tag === true),
  };
  const mudou = (Object.keys(novo) as Booleanas[]).filter((k) => (anterior[k] === true) !== novo[k]);
  const tagsAntes = [...new Set(anterior.aprovar_tags ?? [])];
  const tagsMudaram = tagsNovas !== undefined && (tagsNovas.length !== tagsAntes.length || tagsNovas.some((t) => !tagsAntes.includes(t)));
  if (!mudou.length && !tagsMudaram) return { mensagem: "Nada mudou." };

  if (mudou.includes("aprovacao_entrada")) {
    const r = await inserirExecucao(db, usuario, campanhaId, "massa", "configuracao", { aprovacao_entrada: novo.aprovacao_entrada }, null);
    if (r.erro) return { erro: `${r.erro} Nada foi salvo.` };
  }
  // Só as colunas que existem antes da Etapa 3N, a não ser que algo novo tenha sido mandado ou mudado.
  const gravar: Record<string, unknown> = {
    aprovacao_entrada: novo.aprovacao_entrada,
    recusar_bloqueados: novo.recusar_bloqueados,
    aprovar_automaticamente: novo.aprovar_automaticamente,
  };
  if (e.reservar_vaga_pendentes !== undefined || mudou.includes("reservar_vaga_pendentes")) gravar.reservar_vaga_pendentes = novo.reservar_vaga_pendentes;
  if (e.aprovar_por_tag !== undefined || mudou.includes("aprovar_por_tag")) gravar.aprovar_por_tag = novo.aprovar_por_tag;
  if (tagsMudaram) gravar.aprovar_tags = tagsNovas;
  const { error } = await db.from("campanhas").update(gravar).eq("id", campanhaId);
  if (error) {
    return {
      erro: mudou.includes("aprovacao_entrada")
        ? "A aprovação já foi enviada para os grupos, mas não foi possível salvar as configurações. Tente salvar de novo."
        : "Não foi possível salvar as configurações.",
    };
  }
  revalidatePath(`/campanhas/${campanhaId}`, "layout");
  const partes = mudou.map((k) => `${ROTULO_CONFIG[k]} ${novo[k] ? "ligado" : "desligado"}`);
  if (tagsMudaram) partes.push(`tags da aprovação por tag: ${tagsNovas!.length}`);
  await registrarHistorico(usuario, { acao: "atualizar", area: "Campanhas", resumo: `Solicitações de entrada: ${partes.join(", ")}`, refId: campanhaId });
  return { mensagem: mudou.includes("aprovacao_entrada") ? "Configurações salvas. A aprovação vai ser aplicada nos grupos em instantes." : "Configurações salvas." };
}

/** Cartão "Solicitações de entrada nos grupos": "Ativar em todos os grupos" / "Desativar em todos os grupos". Sempre
 *  cria a execução `configuracao {aprovacao_entrada}` em massa (a mesma de `salvarConfiguracoesSolicitacoes`, mesmo
 *  que a coluna já tenha o valor: o botão reaplica nos grupos) e só depois grava `aprovacao_entrada`. Desativar
 *  também desliga "aprovar automaticamente" e "aprovar por tag" (dependem da aprovação). */
export async function aplicarAprovacaoEmTodos(campanhaId: string, ligar: boolean): Promise<{ erro?: string; mensagem?: string }> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  if (!ehUuid(campanhaId)) return { erro: "Campanha inválida." };
  if (typeof ligar !== "boolean") return { erro: "Valor inválido." };
  const db = dbAdmin();
  const { data: antes, error: erroAntes } = await db.from("campanhas").select("id").eq("id", campanhaId).maybeSingle();
  if (erroAntes) return { erro: "Não foi possível carregar a campanha." };
  if (!antes) return { erro: "Campanha não encontrada." };
  const r = await inserirExecucao(db, acesso.usuario, campanhaId, "massa", "configuracao", { aprovacao_entrada: ligar }, null);
  if (r.erro) return { erro: `${r.erro} Nada foi salvo.` };
  const { error } = await db
    .from("campanhas")
    .update(ligar ? { aprovacao_entrada: true } : { aprovacao_entrada: false, aprovar_automaticamente: false, aprovar_por_tag: false })
    .eq("id", campanhaId);
  if (error) return { erro: "A aprovação já foi enviada para os grupos, mas não foi possível salvar a campanha. Tente de novo." };
  revalidatePath(`/campanhas/${campanhaId}`, "layout");
  await registrarHistorico(acesso.usuario, {
    acao: "atualizar",
    area: "Campanhas",
    resumo: `Solicitações de entrada: ${ligar ? "ativadas" : "desativadas"} em todos os grupos`,
    refId: campanhaId,
  });
  return { mensagem: ligar ? "A aprovação vai ser ativada em todos os grupos em instantes." : "A aprovação vai ser desativada em todos os grupos em instantes." };
}
