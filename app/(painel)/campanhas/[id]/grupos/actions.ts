"use server";
import { revalidatePath } from "next/cache";
import { inserirExecucao } from "@/src/lib/acoes/execucao-grupo";
import { paraZapbot, type ConexaoLinha } from "@/src/lib/conexoes";
import { registrarHistorico } from "@/src/lib/historico";
import { ROTULO_TIPO, TIPOS_MASSA, validarConteudo, type ConteudoConfiguracao, type ConteudoDescricao, type ConteudoImagem, type ConteudoNome, type TipoExecucao, type TipoMassa } from "@/src/lib/regras/conteudo";
import { ERRO_IMAGEM_GRUPO_URL, lerImagemGrupoUrl } from "@/src/lib/regras/imagem-grupo";
import { brasiliaParaIso } from "@/src/lib/regras/horario";
import { normalizarIds } from "@/src/lib/regras/lote";
import { ehUuid } from "@/src/lib/regras/uuid";
import { validarChave } from "@/src/lib/regras/variaveis";
import { validarValorPorTipo } from "@/src/lib/regras/variaveis-globais";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { checarPermissao, exigirPermissao } from "@/src/lib/permissoes";
import { PRAZO_TELA_MS, zapbot, type ZapbotGrupo } from "@/src/lib/zapbot/client";
import { contaEhAdmin, mensagemSemImportaveis, precisaLerGrupo } from "@/src/lib/regras/importar-grupos";
import { validarCriacaoGrupos } from "@/src/lib/regras/campanha";
import { mensagemExecucoes, type ContagemExecucoes } from "@/src/lib/regras/contas-associadas";
import { opcoesCriacao, proximoNumero, validarOpcoesCriacao, type OpcoesCriacao } from "@/src/lib/regras/criacao-grupos";
import { padraoComNumero, padraoNumerado } from "@/src/lib/regras/nome-grupo";
import { diffAdmins, normalizarAdminsNumeros, normalizarTelefoneAdmin } from "@/src/lib/regras/admins-numeros";
import { variantesTelefone } from "@/src/lib/telefone";

const MAXIMO_LOTE = 100;
/** Mesmo teto de `validarConteudo("descricao", …)`, conferido também aqui porque a descrição da campanha (aba
 *  Informações) é gravada direto em `campanhas.descricao`, sem passar pelo validador de conteúdo de execução. */
const MAXIMO_DESCRICAO_GRUPO = 2048;
/** Pelo menos este tanto de tempo entre dois pedidos de "ATUALIZAR LEADS" da mesma campanha. */
const THROTTLE_ATUALIZAR_LEADS_MS = 2 * 60_000;

type DB = ReturnType<typeof dbAdmin>;
type Usuario = { id: string; email?: string | null };

/** Execução avulsa (fila de 3–8 s, igual às outras) pra uma ação específica de grupo(s): "Editar" (nome),
 *  "Atualizar link de convite", "Redefinir link de convite" e o botão "ATUALIZAR LINKS". `grupos: null` = todos
 *  os grupos ativos da campanha na hora de executar; lista = só os grupos passados (já confirmados da campanha
 *  por quem chama). Compartilhada pelas ações de linha e pela faixa, como pede o Passo 2. */
async function criarExecucaoDeGrupo(db: DB, usuario: Usuario, campanhaId: string, tipo: TipoExecucao, conteudo: unknown, grupos: string[] | null): Promise<{ erro?: string }> {
  return inserirExecucao(db, usuario, campanhaId, "avulsa", tipo, conteudo, grupos);
}

/** `inserirExecucao` mora em `src/lib/acoes/execucao-grupo.ts` (Etapa 3M, Tarefa 4: também usada pela aba
 *  Solicitações de entrada); compartilhada por `criarExecucaoDeGrupo`, `criarAcaoEmMassa` e `salvarAlterarEmLote`. */

export type GrupoImportavel = { conexaoId: string; conexaoNome: string; groupId: string; nome: string; participantes: number };

/** Leituras `GET groups/{id}` ao mesmo tempo quando a lista não diz se a conta é admin. */
const LEITURAS_PARALELAS = 4;
/** Não começa leitura nova com menos que isto do prazo da tela. */
const FOLGA_LEITURA_MS = 3_000;

/** Grupos em que algum número da campanha é admin e que ainda não estão em nenhuma campanha. `aviso`: texto pra
 *  tela vazia (grupos admin que já estão em outra campanha, grupos que não deu tempo de conferir). */
export async function listarImportaveis(campanhaId: string): Promise<{ grupos?: GrupoImportavel[]; aviso?: string; erro?: string }> {
  const acesso = await checarPermissao("campanhas", "ver");
  if (!acesso.ok) return { erro: acesso.erro };
  const db = dbAdmin();
  const { data: camp, error: erroCamp } = await db.from("campanhas").select("conexao_criadora_id").eq("id", campanhaId).single();
  if (erroCamp) return { erro: "Não foi possível carregar a campanha." };
  const { data: adm, error: erroAdm } = await db.from("campanha_conexoes").select("conexao_id").eq("campanha_id", campanhaId);
  if (erroAdm) return { erro: "Não foi possível carregar os números da campanha." };
  const ids = [camp?.conexao_criadora_id, ...(adm ?? []).map((a) => a.conexao_id)].filter(Boolean) as string[];
  const { data: conexoes, error: erroConexoes } = await db.from("conexoes").select("*").in("id", ids).eq("status", "conectado");
  if (erroConexoes) return { erro: "Não foi possível carregar os números conectados." };
  // Grupo excluído (inativo e não suspenso) volta pra lista: importar de novo reativa o registro antigo.
  const { data: jaUsados, error: erroUsados } = await db.from("grupos").select("group_id, campanha_id").or("ativo.eq.true,suspenso.eq.true");
  if (erroUsados) return { erro: "Não foi possível carregar os grupos já importados." };
  const usados = new Set((jaUsados ?? []).map((g) => g.group_id));
  const deOutraCampanha = new Set((jaUsados ?? []).filter((g) => g.campanha_id !== campanhaId).map((g) => g.group_id));
  const fim = Date.now() + PRAZO_TELA_MS;
  const out: GrupoImportavel[] = [];
  const jaEmCampanha = new Set<string>();
  // `amAdmin` da lista às vezes vem `false` com a conta admin: sem participantes na resposta, confere no grupo.
  const aLer: { c: ConexaoLinha; g: ZapbotGrupo }[] = [];
  const aceitar = (c: ConexaoLinha, g: ZapbotGrupo) => {
    if (usados.has(g.groupId)) return;
    usados.add(g.groupId);
    out.push({ conexaoId: c.id, conexaoNome: c.nome, groupId: g.groupId, nome: g.name, participantes: g.participantCount });
  };
  try {
    for (const c of (conexoes ?? []) as ConexaoLinha[]) {
      for (const g of await zapbot().listarGrupos(paraZapbot(c), { prazoTotalMs: Math.max(fim - Date.now(), 1_000) })) {
        if (usados.has(g.groupId)) {
          if (deOutraCampanha.has(g.groupId) && contaEhAdmin(g, c.telefone)) jaEmCampanha.add(g.groupId);
        } else if (contaEhAdmin(g, c.telefone)) aceitar(c, g);
        else if (precisaLerGrupo(g)) aLer.push({ c, g });
      }
    }
  } catch {
    return { erro: "O Zapbot não respondeu. Tente de novo." };
  }
  let naoLidos = 0;
  const fila = aLer.filter((x) => !usados.has(x.g.groupId));
  await Promise.all(Array.from({ length: Math.min(LEITURAS_PARALELAS, fila.length) }, async () => {
    for (let item = fila.shift(); item; item = fila.shift()) {
      if (usados.has(item.g.groupId)) continue;
      if (fim - Date.now() < FOLGA_LEITURA_MS) {
        naoLidos++;
        continue;
      }
      try {
        const g = await zapbot().obterGrupo(paraZapbot(item.c), item.g.groupId, { link: false, prazoTotalMs: fim - Date.now() });
        if (g && contaEhAdmin(g, item.c.telefone)) aceitar(item.c, { ...item.g, participantCount: g.participants.length || item.g.participantCount });
      } catch (e) {
        naoLidos++;
        console.error(`[importar] leitura do grupo ${item.g.groupId} pela conexão ${item.c.id}:`, e instanceof Error ? e.message : e);
      }
    }
  }));
  return { grupos: out, aviso: out.length ? undefined : mensagemSemImportaveis(jaEmCampanha.size, naoLidos) };
}

/** "Seguir o padrão da campanha" ao importar ou mover grupos: uma ação "Trocar nome" só nesses grupos, com o padrão de
 *  nome da campanha e o número de cada um na campanha (sem `{n}` no padrão, entra " #{n}"). */
async function renomearComPadrao(db: ReturnType<typeof dbAdmin>, usuario: { id: string }, campanhaId: string, grupoIds: string[]): Promise<{ erro?: string }> {
  if (!grupoIds.length) return {};
  const { data: camp } = await db.from("campanhas").select("padrao_nome, caractere_numeracao, numero_no_inicio").eq("id", campanhaId).single();
  if (!camp?.padrao_nome) return { erro: "Grupos importados, mas não foi possível ler o padrão de nome da campanha." };
  const padrao = padraoNumerado(camp.padrao_nome, camp.caractere_numeracao ?? "", camp.numero_no_inicio === true);
  const r = await inserirExecucao(db, usuario, campanhaId, "massa", "nome", { padrao }, grupoIds);
  if (r.erro) return { erro: "Grupos importados, mas não foi possível agendar a troca de nome." };
  return {};
}

/** Depois de mover grupos de outra campanha pra esta: renomeia com o padrão daqui (ver `renomearComPadrao`). */
export async function seguirPadraoNosGrupos(campanhaId: string, grupoIds: unknown): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  if (!ehUuid(campanhaId)) return { erro: "Campanha inválida." };
  const ids = normalizarIds(grupoIds, MAXIMO_LOTE);
  return renomearComPadrao(dbAdmin(), acesso.usuario, campanhaId, ids);
}

export async function importarGrupos(campanhaId: string, escolhidos: { conexaoId: string; groupId: string }[], seguirPadrao = false): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  const db = dbAdmin();
  const { data: ultimo } = await db.from("grupos").select("numero").eq("campanha_id", campanhaId).order("numero", { ascending: false }).limit(1).maybeSingle();
  let numero = ultimo?.numero ?? 0;
  const { data: camp } = await db.from("campanhas").select("limite_por_grupo").eq("id", campanhaId).single();
  let importados = 0;
  const novos: string[] = [];
  for (const e of escolhidos) {
    const { data: c } = await db.from("conexoes").select("*").eq("id", e.conexaoId).single<ConexaoLinha>();
    if (!c) continue;
    try {
      const z = paraZapbot(c);
      const g = await zapbot().obterGrupo(z, e.groupId);
      if (!g) {
        return { erro: "Grupo não encontrado no WhatsApp." };
      }
      const { data: antigo, error: erroAntigo } = await db.from("grupos").select("id, campanha_id, numero, ativo, suspenso").eq("group_id", g.groupId).maybeSingle();
      if (erroAntigo) return { erro: `Não foi possível conferir se ${g.name} já estava no sistema.` };
      if (antigo && (antigo.ativo || antigo.suspenso)) return { erro: `${g.name} já está em uma campanha.` };
      const link = await zapbot().linkConvite(z, g.groupId);
      const dados = {
        campanha_id: campanhaId, conexao_id: c.id, nome: g.name, link_convite: link,
        participantes: g.participants.length, cheio: g.participants.length >= (camp?.limite_por_grupo ?? 350), conferido_em: new Date().toISOString(),
      };
      let novo: { id: string };
      if (antigo) {
        // Grupo excluído antes (`group_id` é único): reativa o mesmo registro. Na mesma campanha mantém o número;
        // em outra, pega o próximo. Os participantes em aberto saem e entram de novo pela lista atual do WhatsApp.
        const numeroGrupo = antigo.campanha_id === campanhaId ? antigo.numero : ++numero;
        const { data, error } = await db.from("grupos").update({ ...dados, numero: numeroGrupo, ativo: true, suspenso: false, cheio_manual: null }).eq("id", antigo.id).select("id").single();
        if (error || !data) return { erro: `Não foi possível importar ${g.name}.` };
        const { error: erroLimpar } = await db.from("participantes").delete().eq("grupo_id", antigo.id).is("saiu_em", null);
        if (erroLimpar) return { erro: `${g.name} foi reativado, mas não foi possível atualizar os participantes. Importe de novo.` };
        novo = data;
      } else {
        numero++;
        const { data, error } = await db.from("grupos").insert({ ...dados, group_id: g.groupId, numero }).select("id").single();
        if (error || !data) return { erro: `Não foi possível importar ${g.name}.` };
        novo = data;
      }
      if (g.participants.length) {
        const { error: erroParticipantes } = await db.from("participantes").insert(g.participants.map((p) => ({ grupo_id: novo.id, telefone: p.phone, admin: p.isAdmin, importado: true })));
        if (erroParticipantes) {
          // Sem participantes salvos, o grupo ficaria com contagem zerada e geraria falsos "entrou" na próxima
          // conferência: desfaz a importação em vez de deixar o grupo pela metade.
          if (antigo) await db.from("grupos").update({ ativo: false }).eq("id", novo.id);
          else await db.from("grupos").delete().eq("id", novo.id);
          return { erro: `${g.name} foi importado, mas não foi possível salvar os participantes.` };
        }
      }
      importados++;
      novos.push(novo.id);
    } catch {
      return { erro: "O Zapbot não respondeu. Tente de novo." };
    }
  }
  revalidatePath(`/campanhas/${campanhaId}/grupos`);
  if (importados) await registrarHistorico(usuario, { acao: "adicionar", area: "Grupos", resumo: `${importados} grupo(s) importado(s)`, refId: campanhaId });
  if (seguirPadrao) return renomearComPadrao(db, usuario, campanhaId, novos);
  return {};
}

export async function criarGrupoAgora(campanhaId: string): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  const { error } = await dbAdmin().from("acoes").insert({ tipo: "criar_grupo", campanha_id: campanhaId, origem: "manual" });
  if (error) return { erro: "Já existe um grupo sendo criado para esta campanha." };
  revalidatePath(`/campanhas/${campanhaId}/grupos`);
  await registrarHistorico(usuario, { acao: "adicionar", area: "Grupos", resumo: "Criação de grupo novo solicitada", refId: campanhaId });
  return {};
}

export async function tentarDeNovo(acaoId: string, campanhaId: string) {
  const { usuario } = await exigirPermissao("campanhas", "editar");
  const { error } = await dbAdmin().from("acoes").update({ status: "fila", tentativas: 0, erro: null }).eq("id", acaoId);
  if (error) throw new Error("Não foi possível tentar de novo.");
  revalidatePath(`/campanhas/${campanhaId}/grupos`);
  await registrarHistorico(usuario, { acao: "executar", area: "Grupos", resumo: "Criação de grupo tentada de novo", refId: acaoId });
}

/** Desativa vários grupos (para de receber pessoas e mensagens) numa única atualização. */
export async function desativarGrupos(grupoIds: unknown, campanhaId: string): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  const ids = normalizarIds(grupoIds, MAXIMO_LOTE);
  if (!ids.length) return { erro: "Marque pelo menos um grupo." };
  const { data, error } = await dbAdmin().from("grupos").update({ ativo: false }).in("id", ids).eq("campanha_id", campanhaId).select("id");
  if (error) return { erro: "Não foi possível desativar os grupos. Tente de novo." };
  revalidatePath(`/campanhas/${campanhaId}/grupos`);
  if (data?.length) await registrarHistorico(usuario, { acao: "atualizar", area: "Grupos", resumo: `${data.length} grupo(s) desativado(s)`, refId: campanhaId });
  return {};
}

export type AcaoEmMassa = {
  tipo: TipoMassa;
  conteudo: unknown;
  /** null = todos os grupos ativos na hora de executar; lista = só os marcados. */
  grupos: string[] | null;
  quando: "agora" | string; // "agora" ou datetime-local de Brasília
};

/** Vira uma execução `massa`: passa pela mesma fila (3–8 s entre tarefas do número, pausa, retentativas). */
export async function criarAcaoEmMassa(campanhaId: string, a: AcaoEmMassa): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  if (!(TIPOS_MASSA as readonly string[]).includes(a.tipo)) return { erro: "Ação inválida." };
  if (a.grupos && !a.grupos.length) return { erro: "Marque pelo menos um grupo." };
  const v = validarConteudo(a.tipo, a.conteudo);
  if (!v.ok) return { erro: v.erro };
  let agendada: string;
  try {
    agendada = a.quando === "agora" ? new Date().toISOString() : brasiliaParaIso(a.quando);
  } catch {
    return { erro: "Data e hora inválidas." };
  }
  if (a.quando !== "agora" && new Date(agendada) < new Date()) return { erro: "Esse horário já passou." };
  const db = dbAdmin();
  const { error } = await db.from("execucoes").insert({
    campanha_id: campanhaId, origem: "massa", tipo: a.tipo, conteudo: v.valor, alvo_grupos: a.grupos, agendada_para: agendada, criada_por: usuario.id,
  });
  if (error) return { erro: "Não foi possível salvar a ação." };
  revalidatePath(`/campanhas/${campanhaId}`, "layout");
  revalidatePath("/calendario");
  const destino = a.grupos ? `${a.grupos.length} grupo(s)` : "todos os grupos ativos";
  await registrarHistorico(usuario, { acao: "executar", area: "Ações", resumo: `${ROTULO_TIPO[a.tipo]} agendado para ${destino}`, refId: campanhaId });
  return {};
}

/** Só banco, na hora: os grupos passam pra outra campanha com os próximos números de lá.
 *  `grupoIds: null` = todos os grupos ativos da campanha (resolvido aqui, não na tela). Confere origem e
 *  destino (nenhuma pode estar arquivada — a origem entrou na revisão final da Etapa 3E: campanha arquivada
 *  não deveria perder grupo nenhum por baixo). */
export async function moverGrupos(campanhaId: string, grupoIds: string[] | null, destinoId: string): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  if (!ehUuid(campanhaId)) return { erro: "Campanha inválida." };
  if (!destinoId || !ehUuid(destinoId) || destinoId === campanhaId) return { erro: "Escolha outra campanha." };
  if (grupoIds) {
    if (!grupoIds.length) return { erro: "Marque pelo menos um grupo." };
    if (grupoIds.length > MAXIMO_LOTE) return { erro: `No máximo ${MAXIMO_LOTE} grupos por vez.` };
    if (!grupoIds.every(ehUuid)) return { erro: "Grupo inválido na seleção." };
  }
  const db = dbAdmin();
  const { data: campanhasEnvolvidas, error: erroCampanhas } = await db.from("campanhas").select("id, arquivada, inicio_contagem").in("id", [campanhaId, destinoId]);
  if (erroCampanhas) return { erro: "Não foi possível conferir as campanhas." };
  const origem = (campanhasEnvolvidas ?? []).find((c) => c.id === campanhaId);
  const destino = (campanhasEnvolvidas ?? []).find((c) => c.id === destinoId);
  if (!origem || origem.arquivada) return { erro: "Campanha de origem inválida ou arquivada." };
  if (!destino || destino.arquivada) return { erro: "Campanha de destino inválida ou arquivada." };
  let query = db.from("grupos").select("id").eq("campanha_id", campanhaId).order("numero");
  query = grupoIds ? query.in("id", grupoIds) : query.eq("ativo", true);
  const { data: grupos, error } = await query;
  if (error) return { erro: "Não foi possível ler os grupos." };
  const { data: ultimo } = await db.from("grupos").select("numero").eq("campanha_id", destinoId).order("numero", { ascending: false }).limit(1).maybeSingle();
  // Mesma numeração da criação (`inicio_contagem` do destino; padrão 1 = o maior + 1, como antes).
  let numero = proximoNumero(ultimo?.numero ?? null, opcoesCriacao(destino).inicio_contagem) - 1;
  for (const g of grupos ?? []) {
    numero++;
    const { error: erroMover } = await db.from("grupos").update({ campanha_id: destinoId, numero }).eq("id", g.id);
    if (erroMover) return { erro: "Não foi possível mover um dos grupos. Confira as duas campanhas." };
  }
  revalidatePath(`/campanhas/${campanhaId}`, "layout");
  revalidatePath(`/campanhas/${destinoId}`, "layout");
  await registrarHistorico(usuario, { acao: "atualizar", area: "Grupos", resumo: `${(grupos ?? []).length} grupo(s) movido(s) para outra campanha`, refId: campanhaId });
  return {};
}

/** Aba "Informações" do diálogo "Criação de grupos" (Etapa 3E, Tarefa 3): só grava as opções da campanha — não
 *  cria grupo nenhum (quem cria é "Criar grupo agora", botão secundário do mesmo diálogo). Vale só pra grupos
 *  novos: os que já existem não mudam. "Recusar automaticamente números bloqueados" (`recusar_bloqueados`, Etapa 3M)
 *  vale para a campanha toda (a conferência responde os pedidos de entrada). */
export type InformacoesCriacaoEntrada = OpcoesCriacao & {
  padrao_nome: string;
  descricao: string;
  fechado: boolean;
  limite_por_grupo: number;
  folga: number;
  usar_comunidade: boolean;
};

export async function salvarInformacoesCriacao(campanhaId: string, entrada: InformacoesCriacaoEntrada): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  if (!ehUuid(campanhaId)) return { erro: "Campanha inválida." };
  if (typeof entrada.padrao_nome !== "string" || typeof entrada.descricao !== "string") return { erro: "Dados inválidos." };
  if (Array.from(entrada.descricao).length > MAXIMO_DESCRICAO_GRUPO) return { erro: `A descrição vai até ${MAXIMO_DESCRICAO_GRUPO} caracteres.` };
  if (typeof entrada.fechado !== "boolean" || typeof entrada.usar_comunidade !== "boolean") return { erro: "Valor inválido." };
  const base = validarCriacaoGrupos(entrada);
  if (!base.ok) return base;
  const opcoes = validarOpcoesCriacao(entrada);
  if (!opcoes.ok) return opcoes;
  // "Imagem do grupo" (Etapa 3M): vazio = null (grupo novo nasce sem foto). Ausente na entrada (chamada antiga) =
  // não mexe na imagem que a campanha já tem.
  // "Recusar automaticamente números bloqueados" (Etapa 3M, Tarefa 4): ausente na entrada = não mexe na coluna.
  const { imagem_grupo_url, recusar_bloqueados, ...outrasOpcoes } = opcoes.valor;
  const { error } = await dbAdmin().from("campanhas").update({
    padrao_nome: entrada.padrao_nome.trim(),
    descricao: entrada.descricao,
    fechado: entrada.fechado,
    limite_por_grupo: entrada.limite_por_grupo,
    folga: entrada.folga,
    usar_comunidade: entrada.usar_comunidade,
    ...outrasOpcoes,
    ...(entrada.imagem_grupo_url !== undefined ? { imagem_grupo_url } : {}),
    ...(entrada.recusar_bloqueados !== undefined ? { recusar_bloqueados } : {}),
  }).eq("id", campanhaId);
  if (error) return { erro: "Não foi possível salvar as opções de criação." };
  revalidatePath(`/campanhas/${campanhaId}/grupos`);
  await registrarHistorico(usuario, { acao: "atualizar", area: "Grupos", resumo: "Opções de criação de grupos atualizadas", refId: campanhaId });
  return {};
}

/** Aba "Administradores" dos dois diálogos (Criação de grupos / Alterar grupos em lote, revisão final da Etapa
 *  3E): a mesma RPC atômica de "Aplicar em campanhas existentes" (`aplicar_contas_campanha`, migração
 *  `campanha_contas`) — insere as contas novas antes de apagar as que saíram (a campanha nunca fica um instante
 *  sem contas), nunca a criadora, e reassocia/cancela as execuções agendadas das contas que saíram. Só contas
 *  que existem de verdade entram; sem mudança nenhuma no conjunto de admins, nem chama a RPC. */
export async function salvarAdministradores(campanhaId: string, admins: string[]): Promise<{ erro?: string; mensagem?: string }> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  if (!ehUuid(campanhaId)) return { erro: "Campanha inválida." };
  if (!Array.isArray(admins) || !admins.every((a) => typeof a === "string" && ehUuid(a))) return { erro: "Conexão de administrador inválida." };
  const db = dbAdmin();
  const { data: campanha, error: erroCampanha } = await db.from("campanhas").select("conexao_criadora_id").eq("id", campanhaId).maybeSingle();
  if (erroCampanha) return { erro: "Não foi possível carregar a campanha." };
  if (!campanha) return { erro: "Campanha não encontrada." };

  const pedidos = [...new Set(admins)];
  let validos: string[] = [];
  if (pedidos.length) {
    const { data: existentes, error: erroConexoes } = await db.from("conexoes").select("id").in("id", pedidos);
    if (erroConexoes) return { erro: "Não foi possível conferir as conexões." };
    const existem = new Set(((existentes ?? []) as { id: string }[]).map((c) => c.id));
    validos = pedidos.filter((a) => existem.has(a) && a !== campanha.conexao_criadora_id);
  }

  const { data: atuais, error: erroAtuais } = await db.from("campanha_conexoes").select("conexao_id").eq("campanha_id", campanhaId);
  if (erroAtuais) return { erro: "Não foi possível conferir os admins atuais." };
  const atuaisSet = new Set(((atuais ?? []) as { conexao_id: string }[]).map((a) => a.conexao_id));
  const novoSet = new Set(validos);
  const mudou = atuaisSet.size !== novoSet.size || [...atuaisSet].some((id) => !novoSet.has(id));
  if (!mudou) return {};

  const { data, error } = await db.rpc("aplicar_contas_campanha", { p_campanha: campanhaId, p_contas: validos });
  if (error) return { erro: "Não foi possível atualizar os números admin." };
  const r = ((Array.isArray(data) ? data[0] : data) ?? {}) as Partial<Record<"adicionadas" | "removidas" | "reassociadas" | "canceladas" | "mantidas", number>>;
  const contagem: ContagemExecucoes = { reassociadas: r.reassociadas ?? 0, canceladas: r.canceladas ?? 0, mantidas: r.mantidas ?? 0 };
  const execucoes = mensagemExecucoes(contagem);
  const resumo = `Números admin atualizados (${r.adicionadas ?? 0} entrou, ${r.removidas ?? 0} saiu)${execucoes ? `; ${execucoes.replace(/\.$/, "")}` : ""}`;
  revalidatePath(`/campanhas/${campanhaId}/grupos`);
  revalidatePath(`/campanhas/${campanhaId}/contas`);
  await registrarHistorico(usuario, { acao: "atualizar", area: "Campanhas", resumo, refId: campanhaId });
  return { mensagem: resumo };
}

/** Aba "Informações" do diálogo "Alterar grupos em lote" (Etapa 3E, Tarefa 3): grava as opções na campanha (valem
 *  pros grupos futuros) e, só pros campos que mudaram (ou todos, com `forcar`), cria as execuções em massa
 *  (`origem: "massa"`) pros grupos ativos de hoje (`grupos: null`, resolvido na hora de executar) — nome,
 *  descrição, configuração (so_admins_enviam/aprovação/temporárias, só as chaves que mudaram), imagem do grupo
 *  (Etapa 3M: só quando há imagem; tirar a imagem só vale pros grupos novos, o WhatsApp não deixa apagar) — e SÓ DEPOIS
 *  atualiza a campanha: se uma execução falhar no meio, a campanha não é salva, mas as execuções já criadas
 *  continuam valendo (revisão final). */
export type AlterarEmLoteEntrada = {
  padrao_nome: string;
  descricao: string;
  fechado: boolean;
  aprovacao_entrada: boolean;
  caractere_numeracao: string;
  mensagens_temporarias: OpcoesCriacao["mensagens_temporarias"];
  /** "Imagem do grupo" (Etapa 3M): vazio/null = sem imagem (só pros grupos novos). Ausente = não muda. */
  imagem_grupo_url: string | null;
  /** Nome do arquivo escolhido, só pra mostrar na execução ("Imagem: foto.png"). */
  imagem_nome_arquivo?: string | null;
  /** "Aplicar aos grupos existentes mesmo sem mudança": cria a execução de um campo mesmo quando ele já está
   *  idêntico ao da campanha (revisão final da Etapa 3E). */
  forcar: boolean;
};

export async function salvarAlterarEmLote(campanhaId: string, entrada: AlterarEmLoteEntrada): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  if (!ehUuid(campanhaId)) return { erro: "Campanha inválida." };
  if (typeof entrada.padrao_nome !== "string" || typeof entrada.descricao !== "string" || typeof entrada.caractere_numeracao !== "string") {
    return { erro: "Dados inválidos." };
  }
  if (typeof entrada.fechado !== "boolean" || typeof entrada.aprovacao_entrada !== "boolean" || typeof entrada.forcar !== "boolean") {
    return { erro: "Valor inválido." };
  }
  const padraoNome = entrada.padrao_nome.trim();
  if (!padraoNome) return { erro: "Dê um padrão de nome para os grupos." };
  if (entrada.caractere_numeracao.length > 3) return { erro: "O caractere da numeração vai até 3 caracteres." };
  if (Array.from(entrada.descricao).length > MAXIMO_DESCRICAO_GRUPO) return { erro: `A descrição vai até ${MAXIMO_DESCRICAO_GRUPO} caracteres.` };
  if (!(["nao", "24h", "7d", "90d"] as const).includes(entrada.mensagens_temporarias)) return { erro: "Opção de mensagens temporárias inválida." };
  const imagem = entrada.imagem_grupo_url === undefined ? undefined : lerImagemGrupoUrl(entrada.imagem_grupo_url);
  if (entrada.imagem_grupo_url !== undefined && imagem === undefined) return { erro: ERRO_IMAGEM_GRUPO_URL };

  const db = dbAdmin();
  const { data: antes, error: erroAntes } = await db
    .from("campanhas")
    .select("padrao_nome, descricao, fechado, aprovacao_entrada, caractere_numeracao, mensagens_temporarias, numero_no_inicio, imagem_grupo_url")
    .eq("id", campanhaId)
    .maybeSingle();
  if (erroAntes) return { erro: "Não foi possível carregar a campanha." };
  if (!antes) return { erro: "Campanha não encontrada." };

  const mudouNome = entrada.forcar || antes.padrao_nome !== padraoNome || antes.caractere_numeracao !== entrada.caractere_numeracao;
  const mudouDescricao = entrada.forcar || antes.descricao !== entrada.descricao;
  // Só as chaves que de fato mudaram (ou todas, com `forcar`) — nunca manda "so_admins_enviam"/"aprovacao_entrada"
  // sem ter mudado, por exemplo (revisão final).
  const configuracao: ConteudoConfiguracao = {};
  if (entrada.forcar || antes.fechado !== entrada.fechado) configuracao.so_admins_enviam = entrada.fechado;
  if (entrada.forcar || antes.aprovacao_entrada !== entrada.aprovacao_entrada) configuracao.aprovacao_entrada = entrada.aprovacao_entrada;
  if (entrada.forcar || antes.mensagens_temporarias !== entrada.mensagens_temporarias) configuracao.temporarias = entrada.mensagens_temporarias;
  const mudouConfiguracao = Object.keys(configuracao).length > 0;
  // Imagem nova (ou a mesma, com `forcar`) vai pros grupos de hoje; tirar a imagem (null) não cria execução.
  const mudouImagem = typeof imagem === "string" && (entrada.forcar || antes.imagem_grupo_url !== imagem);

  const feitos: string[] = [];
  if (mudouNome) {
    // Padrão sem {n} nunca pode dar o mesmo nome pra todos os grupos (regra de `nomeDoGrupo`, aplicada aqui
    // porque quem de fato troca o nome por grupo, `trocarN`, mantém fixo um padrão sem {n} de propósito —
    // isso é certo pra "Editar" um grupo só, errado pra alterar todos de uma vez).
    const padraoParaExecucao = padraoComNumero(padraoNome, antes.numero_no_inicio === true);
    const conteudo: ConteudoNome = { padrao: padraoParaExecucao, caractere: entrada.caractere_numeracao };
    const r = await inserirExecucao(db, usuario, campanhaId, "massa", "nome", conteudo, null);
    if (r.erro) return { erro: `${r.erro} Nada foi aplicado ainda: a campanha não foi salva.` };
    feitos.push("nome");
  }
  if (mudouDescricao) {
    const conteudo: ConteudoDescricao = { texto: entrada.descricao };
    const r = await inserirExecucao(db, usuario, campanhaId, "massa", "descricao", conteudo, null);
    if (r.erro) {
      return { erro: `${r.erro} ${feitos.length ? `A execução de ${feitos.join(" e ")} já foi criada e continua valendo; ` : ""}a campanha não foi salva.` };
    }
    feitos.push("descrição");
  }
  if (mudouConfiguracao) {
    const r = await inserirExecucao(db, usuario, campanhaId, "massa", "configuracao", configuracao, null);
    if (r.erro) {
      return { erro: `${r.erro} ${feitos.length ? `A(s) execução(ões) de ${feitos.join(" e ")} já foram criadas e continuam valendo; ` : ""}a campanha não foi salva.` };
    }
    feitos.push("configuração");
  }
  if (mudouImagem) {
    const nome = typeof entrada.imagem_nome_arquivo === "string" ? entrada.imagem_nome_arquivo : null;
    const conteudo: ConteudoImagem = { url: imagem, nome_arquivo: nome };
    const r = await inserirExecucao(db, usuario, campanhaId, "massa", "imagem", conteudo, null);
    if (r.erro) {
      return { erro: `${r.erro} ${feitos.length ? `A(s) execução(ões) de ${feitos.join(" e ")} já foram criadas e continuam valendo; ` : ""}a campanha não foi salva.` };
    }
    feitos.push("imagem");
  }

  const { error } = await db.from("campanhas").update({
    padrao_nome: padraoNome,
    descricao: entrada.descricao,
    fechado: entrada.fechado,
    aprovacao_entrada: entrada.aprovacao_entrada,
    caractere_numeracao: entrada.caractere_numeracao,
    mensagens_temporarias: entrada.mensagens_temporarias,
    ...(imagem !== undefined ? { imagem_grupo_url: imagem } : {}),
  }).eq("id", campanhaId);
  if (error) {
    return {
      erro: feitos.length
        ? `Os grupos já foram atualizados (${feitos.join(", ")}), mas não foi possível salvar as opções da campanha. Tente salvar de novo.`
        : "Não foi possível salvar as opções.",
    };
  }

  revalidatePath(`/campanhas/${campanhaId}`, "layout");
  revalidatePath("/calendario");
  await registrarHistorico(usuario, {
    acao: "atualizar",
    area: "Grupos",
    resumo: feitos.length ? `Opções salvas; ${feitos.join(", ")} aplicado(s) nos grupos ativos` : "Opções de grupos atualizadas (nada mudou nos grupos existentes)",
    refId: campanhaId,
  });
  return {};
}

/** Etapa 3K, Tarefa 1: grava a lista de "Administradores por número" (`campanha_admins_numeros`): apaga os
 *  tirados e grava os novos. `modo: "criacao"` só vale pra grupos novos (o job de criação lê a tabela). `modo:
 *  "alterar"` também cria, pra cada número novo, uma execução `admin_add` em massa pra todos os grupos ativos e,
 *  só pros números em `rebaixar` (caixa "Também remover como admin dos grupos existentes", que tem de estar entre
 *  os tirados), uma `admin_remover` — tirar da lista sem marcar a caixa nunca rebaixa ninguém. */
async function salvarAdminsNumeros(
  db: DB,
  usuario: Usuario,
  campanhaId: string,
  lista: unknown,
  modo: "criacao" | "alterar",
  rebaixarPedidos: unknown = [],
): Promise<{ erro?: string }> {
  if (!Array.isArray(rebaixarPedidos) || !rebaixarPedidos.every((t) => typeof t === "string")) return { erro: "Lista de rebaixados inválida." };
  const { data: campanha, error: erroCampanha } = await db.from("campanhas").select("conexao_criadora_id").eq("id", campanhaId).maybeSingle();
  if (erroCampanha) return { erro: "Não foi possível carregar a campanha." };
  if (!campanha) return { erro: "Campanha não encontrada." };
  const { data: vinculadas, error: erroVinculadas } = await db.from("campanha_conexoes").select("conexao_id").eq("campanha_id", campanhaId);
  if (erroVinculadas) return { erro: "Não foi possível conferir as conexões da campanha." };
  const ids = [...new Set([campanha.conexao_criadora_id as string | null, ...((vinculadas ?? []) as { conexao_id: string }[]).map((v) => v.conexao_id)].filter((x): x is string => !!x))];
  let telefonesContas: (string | null)[] = [];
  if (ids.length) {
    const { data: contas, error: erroContas } = await db.from("conexoes").select("telefone").in("id", ids);
    if (erroContas) return { erro: "Não foi possível conferir as conexões da campanha." };
    telefonesContas = ((contas ?? []) as { telefone: string | null }[]).map((c) => c.telefone);
  }
  const n = normalizarAdminsNumeros(lista, telefonesContas);
  if (!n.ok) return { erro: n.erro };

  const { data: atuais, error: erroAtuais } = await db.from("campanha_admins_numeros").select("telefone").eq("campanha_id", campanhaId);
  if (erroAtuais) return { erro: "Não foi possível ler os administradores por número." };
  const { novos, tirados } = diffAdmins(((atuais ?? []) as { telefone: string }[]).map((a) => a.telefone), n.valor);
  const pedidos = new Set((rebaixarPedidos as string[]).flatMap((t) => {
    // Vem dos telefones salvos (já normalizados); `normalizarTelefoneAdmin` aceita também o que foi digitado.
    const tel = normalizarTelefoneAdmin(t) ?? t.replace(/\D/g, "");
    return tel ? variantesTelefone(tel) : [];
  }));
  const rebaixar = modo === "alterar" ? tirados.filter((t) => variantesTelefone(t).some((v) => pedidos.has(v))) : [];
  if (!novos.length && !tirados.length) return {};

  if (tirados.length) {
    const { error } = await db.from("campanha_admins_numeros").delete().eq("campanha_id", campanhaId).in("telefone", tirados);
    if (error) return { erro: "Não foi possível salvar os administradores por número." };
  }
  // Só quem foi de fato inserido agora (o upsert ignora quem já estava, ex.: dois salvamentos ao mesmo tempo) ganha
  // execução: nunca dois `admin_add` do mesmo número.
  let inseridos: string[] = [];
  if (novos.length) {
    const { data, error } = await db
      .from("campanha_admins_numeros")
      .upsert(novos.map((telefone) => ({ campanha_id: campanhaId, telefone, criado_por: usuario.id })), { onConflict: "campanha_id,telefone", ignoreDuplicates: true })
      .select("telefone");
    if (error) return { erro: "Não foi possível salvar os administradores por número." };
    inseridos = ((data ?? []) as { telefone: string }[]).map((r) => r.telefone);
  }
  let canceladas = 0;
  if (modo === "alterar") {
    // Número que volta pra lista com um `admin_remover` ainda agendado (tirado com a caixa marcada antes): cancela
    // a remoção pendente, senão ele seria rebaixado logo depois de voltar.
    if (inseridos.length) {
      const { data, error } = await db
        .from("execucoes")
        .update({ status: "cancelada" })
        .eq("campanha_id", campanhaId)
        .eq("tipo", "admin_remover")
        .eq("status", "agendada")
        .in("conteudo->>telefone", inseridos.flatMap(variantesTelefone))
        .select("id");
      if (error) return { erro: "A lista foi salva, mas não foi possível cancelar a remoção de admin pendente." };
      canceladas = (data ?? []).length;
    }
    const agora = new Date().toISOString();
    const linhas = [
      ...inseridos.map((telefone) => ({ tipo: "admin_add" as const, telefone })),
      ...rebaixar.map((telefone) => ({ tipo: "admin_remover" as const, telefone })),
    ].map(({ tipo, telefone }) => {
      const v = validarConteudo(tipo, { telefone });
      return v.ok ? { campanha_id: campanhaId, origem: "massa", tipo, conteudo: v.valor, agendada_para: agora, alvo_grupos: null, criada_por: usuario.id } : null;
    });
    const validas = linhas.filter((l): l is NonNullable<typeof l> => l !== null);
    if (validas.length !== linhas.length) return { erro: "A lista foi salva, mas um telefone ficou inválido para a ação nos grupos." };
    if (validas.length) {
      const { error } = await db.from("execucoes").insert(validas);
      if (error) return { erro: "A lista foi salva, mas não foi possível criar as ações nos grupos existentes." };
      revalidatePath(`/campanhas/${campanhaId}`, "layout");
      revalidatePath("/calendario");
    }
  }
  revalidatePath(`/campanhas/${campanhaId}/grupos`);
  await registrarHistorico(usuario, {
    acao: "atualizar",
    area: "Grupos",
    resumo: `Administradores por número: +${novos.length}, −${tirados.length} (rebaixados: ${rebaixar.length})${canceladas ? `; ${canceladas} remoção(ões) de admin pendente(s) cancelada(s)` : ""}`,
    refId: campanhaId,
  });
  return {};
}

/** Confere só o formato da lista (antes de gravar qualquer coisa): telefone válido e no máximo 20. Quem confere
 *  contra as contas da campanha é `salvarAdminsNumeros`, depois das contas salvas. */
function conferirFormatoAdminsNumeros(lista: unknown): { erro?: string } {
  if (lista === undefined) return {};
  const n = normalizarAdminsNumeros(lista);
  return n.ok ? {} : { erro: n.erro };
}

/** Diálogo "Criação de grupos" inteiro (Etapa 3E, revisão final): as duas abas numa action só, pra sempre dar
 *  pra saber o que foi salvo quando a segunda parte falha (em vez do cliente chamar duas actions separadas).
 *  `adminsNumeros` (Etapa 3K): lista de "Administradores por número"; ausente = não mexe na lista. */
export async function salvarCriacaoDeGrupos(campanhaId: string, informacoes: InformacoesCriacaoEntrada, admins: string[], adminsNumeros?: string[]): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const formato = conferirFormatoAdminsNumeros(adminsNumeros);
  if (formato.erro) return formato;
  const r1 = await salvarInformacoesCriacao(campanhaId, informacoes);
  if (r1.erro) return r1;
  const r2 = await salvarAdministradores(campanhaId, admins);
  if (r2.erro) return { erro: `As opções de criação foram salvas; ${r2.erro}` };
  if (adminsNumeros !== undefined) {
    const r3 = await salvarAdminsNumeros(dbAdmin(), acesso.usuario, campanhaId, adminsNumeros, "criacao");
    if (r3.erro) return { erro: `As opções de criação e as conexões foram salvas; ${r3.erro}` };
  }
  return {};
}

/** Diálogo "Alterar grupos em lote" inteiro (Etapa 3E, revisão final): idem, as duas abas numa action só.
 *  `adminsNumeros`/`rebaixar` (Etapa 3K): lista de "Administradores por número" e os tirados com a caixa "Também
 *  remover como admin dos grupos existentes" marcada; `adminsNumeros` ausente = não mexe na lista. */
export async function salvarAlterarGruposEmLote(
  campanhaId: string,
  entrada: AlterarEmLoteEntrada,
  admins: string[],
  adminsNumeros?: string[],
  rebaixar: string[] = [],
): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const formato = conferirFormatoAdminsNumeros(adminsNumeros);
  if (formato.erro) return formato;
  const r1 = await salvarAlterarEmLote(campanhaId, entrada);
  if (r1.erro) return r1;
  const r2 = await salvarAdministradores(campanhaId, admins);
  if (r2.erro) return { erro: `Os grupos já foram atualizados; ${r2.erro}` };
  if (adminsNumeros !== undefined) {
    const r3 = await salvarAdminsNumeros(dbAdmin(), acesso.usuario, campanhaId, adminsNumeros, "alterar", rebaixar);
    if (r3.erro) return { erro: `Os grupos e as conexões já foram atualizados; ${r3.erro}` };
  }
  return {};
}

export type GrupoDeOutraCampanha = { id: string; nome: string; numero: number; participantes: number };

/** Passo "Grupos" do assistente "Importar grupos", quando a origem é "Campanha": grupos ATIVOS de outra campanha,
 *  pra escolher quais mover com `moverGrupos`. */
export async function listarGruposAtivosDaCampanha(campanhaId: string): Promise<{ grupos?: GrupoDeOutraCampanha[]; erro?: string }> {
  const acesso = await checarPermissao("campanhas", "ver");
  if (!acesso.ok) return { erro: acesso.erro };
  if (!ehUuid(campanhaId)) return { erro: "Campanha inválida." };
  const { data, error } = await dbAdmin().from("grupos").select("id, nome, numero, participantes").eq("campanha_id", campanhaId).eq("ativo", true).order("numero");
  if (error) return { erro: "Não foi possível carregar os grupos desta campanha." };
  return { grupos: (data ?? []) as GrupoDeOutraCampanha[] };
}

/** Botão "ATUALIZAR LINKS" da faixa: lê de novo o link de convite de todos os grupos ativos (`grupos: null`). */
export async function atualizarLinksGrupos(campanhaId: string): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  const r = await criarExecucaoDeGrupo(dbAdmin(), usuario, campanhaId, "atualizar_links", {}, null);
  if (r.erro) return r;
  await registrarHistorico(usuario, { acao: "executar", area: "Grupos", resumo: "Atualização dos links de convite pedida para todos os grupos ativos", refId: campanhaId });
  return {};
}

/** Menu "⋮" do grupo: "Atualizar link de convite" (lê de novo, sem trocar) só nesse grupo. */
/** Confere que o grupo existe e é desta campanha (ids podem vir direto do cliente nas ações de linha). */
async function confirmarGrupoDaCampanha(db: DB, grupoId: string, campanhaId: string): Promise<string | null> {
  if (!ehUuid(grupoId)) return "Grupo inválido.";
  const { data, error } = await db.from("grupos").select("id").eq("id", grupoId).eq("campanha_id", campanhaId).maybeSingle();
  if (error) return "Não foi possível conferir o grupo.";
  if (!data) return "Grupo não encontrado nesta campanha.";
  return null;
}

export async function atualizarLinkConviteGrupo(grupoId: string, campanhaId: string): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  const db = dbAdmin();
  const erroGrupo = await confirmarGrupoDaCampanha(db, grupoId, campanhaId);
  if (erroGrupo) return { erro: erroGrupo };
  const r = await criarExecucaoDeGrupo(db, usuario, campanhaId, "atualizar_links", {}, [grupoId]);
  if (r.erro) return r;
  await registrarHistorico(usuario, { acao: "executar", area: "Grupos", resumo: "Link de convite atualizado (1 grupo)", refId: campanhaId });
  return {};
}

/** Menu "⋮" do grupo: "Redefinir link de convite" (gera um link novo, revoga o antigo) só nesse grupo. */
export async function redefinirLinkConviteGrupo(grupoId: string, campanhaId: string): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  const db = dbAdmin();
  const erroGrupo = await confirmarGrupoDaCampanha(db, grupoId, campanhaId);
  if (erroGrupo) return { erro: erroGrupo };
  const r = await criarExecucaoDeGrupo(db, usuario, campanhaId, "redefinir_link", {}, [grupoId]);
  if (r.erro) return r;
  await registrarHistorico(usuario, { acao: "executar", area: "Grupos", resumo: "Link de convite redefinido (1 grupo)", refId: campanhaId });
  return {};
}

/** Menu "⋮" do grupo: "Editar" (trocar nome), execução `nome` só desse grupo. */
export async function editarNomeGrupo(grupoId: string, campanhaId: string, nome: string): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  const db = dbAdmin();
  const erroGrupo = await confirmarGrupoDaCampanha(db, grupoId, campanhaId);
  if (erroGrupo) return { erro: erroGrupo };
  const r = await criarExecucaoDeGrupo(db, usuario, campanhaId, "nome", { padrao: nome }, [grupoId]);
  if (r.erro) return r;
  await registrarHistorico(usuario, { acao: "atualizar", area: "Grupos", resumo: "Nome do grupo editado", refId: campanhaId });
  return {};
}

/** Marca um ou mais grupos como cheio/não cheio à mão (`valor: true/false`) ou volta ao automático (`null`).
 *  Marcado à mão também grava `cheio` de uma vez (pede a Tarefa 1): o link público muda na hora, sem esperar a
 *  próxima conferência. "Automático" só limpa `cheio_manual`; `cheio` fica como a conferência deixou. */
export async function marcarCheioManual(grupoIds: unknown, campanhaId: string, valor: boolean | null): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  const ids = normalizarIds(grupoIds, MAXIMO_LOTE);
  if (!ids.length) return { erro: "Marque pelo menos um grupo." };
  const dados: { cheio_manual: boolean | null; cheio?: boolean } = { cheio_manual: valor };
  if (valor !== null) dados.cheio = valor;
  const { data, error } = await dbAdmin().from("grupos").update(dados).in("id", ids).eq("campanha_id", campanhaId).select("id");
  if (error) return { erro: "Não foi possível atualizar os grupos. Tente de novo." };
  revalidatePath(`/campanhas/${campanhaId}/grupos`);
  if (data?.length) {
    const resumo = valor === null ? "voltou a ser automático" : valor ? "marcado(s) como cheio" : "marcado(s) como não cheio";
    await registrarHistorico(usuario, { acao: "atualizar", area: "Grupos", resumo: `${data.length} grupo(s) ${resumo}`, refId: campanhaId });
  }
  return {};
}

/** Botão "ATUALIZAR LEADS": pede a conferência dos grupos ativos da campanha o quanto antes, limpando
 *  `conferido_em` (a conferência escolhe sempre os números com `proxima_conferencia_em` vencida ordenados por
 *  isso, e dentro de cada número os grupos são lidos todos de uma vez — não há ordem por grupo a antecipar; o
 *  que dá pra fazer daqui é só isto: nada muda na conexão). Travado em 1 pedido por campanha a cada 2 minutos
 *  (`campanhas.leads_atualizados_em`), pra não disparar a conferência em excesso num clique duplo. */
export async function atualizarLeads(campanhaId: string): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  const db = dbAdmin();
  const { data: camp, error: erroCamp } = await db.from("campanhas").select("leads_atualizados_em").eq("id", campanhaId).maybeSingle();
  if (erroCamp) return { erro: "Não foi possível conferir a campanha." };
  if (!camp) return { erro: "Campanha não encontrada." };
  const ultima = (camp as { leads_atualizados_em: string | null }).leads_atualizados_em;
  if (ultima && Date.now() - Date.parse(ultima) < THROTTLE_ATUALIZAR_LEADS_MS) return { erro: "Aguarde 2 minutos entre duas atualizações de leads." };
  const agora = new Date().toISOString();
  const { error: erroCampanha } = await db.from("campanhas").update({ leads_atualizados_em: agora }).eq("id", campanhaId);
  if (erroCampanha) return { erro: "Não foi possível pedir a atualização. Tente de novo." };
  const { error: erroGrupos } = await db.from("grupos").update({ conferido_em: null }).eq("campanha_id", campanhaId).eq("ativo", true);
  if (erroGrupos) return { erro: "Não foi possível pedir a atualização dos grupos. Tente de novo." };
  revalidatePath(`/campanhas/${campanhaId}/grupos`);
  await registrarHistorico(usuario, { acao: "executar", area: "Grupos", resumo: "Conferência imediata dos grupos ativos pedida", refId: campanhaId });
  return {};
}

export type ParticipanteDuplicado = { telefone: string; grupos: string[] };

/** Diálogo "Participantes duplicados": quem está em mais de um grupo ATIVO da campanha (saiu_em is null), com
 *  os grupos — até 200 telefones (`participantes_duplicados_campanha`). */
export async function participantesDuplicados(campanhaId: string): Promise<{ erro?: string } & { duplicados?: ParticipanteDuplicado[] }> {
  const acesso = await checarPermissao("campanhas", "ver");
  if (!acesso.ok) return { erro: acesso.erro };
  if (!ehUuid(campanhaId)) return { erro: "Campanha inválida." };
  const { data, error } = await dbAdmin().rpc("participantes_duplicados_campanha", { p_campanha: campanhaId });
  if (error) return { erro: "Não foi possível carregar os participantes duplicados." };
  return { duplicados: (data ?? []) as ParticipanteDuplicado[] };
}

export type GrupoDuplicado = { nome: string; grupos: { id: string; numero: number }[] };

/** Diálogo "Grupos duplicados": grupos ATIVOS da campanha que têm o mesmo nome. */
export async function gruposDuplicados(campanhaId: string): Promise<{ erro?: string } & { duplicados?: GrupoDuplicado[] }> {
  const acesso = await checarPermissao("campanhas", "ver");
  if (!acesso.ok) return { erro: acesso.erro };
  if (!ehUuid(campanhaId)) return { erro: "Campanha inválida." };
  // Agrupado e limitado a 200 nomes já no banco (`grupos_duplicados_campanha`): evita ler todos os grupos
  // ativos da campanha (sem teto) a cada clique no botão.
  const { data, error } = await dbAdmin().rpc("grupos_duplicados_campanha", { p_campanha: campanhaId });
  if (error) return { erro: "Não foi possível carregar os grupos." };
  const duplicados: GrupoDuplicado[] = ((data ?? []) as { nome: string; grupos: { id: string; numero: number }[] }[]).map((l) => ({ nome: l.nome, grupos: l.grupos }));
  return { duplicados };
}

/** Diálogo "Valores das variáveis no grupo": carrega os valores de hoje só desse grupo (sobreposições; vazio
 *  ou sem linha = herda o da campanha). Carregado quando a janela abre, não no carregamento da página. */
export async function valoresDoGrupo(grupoId: string, campanhaId: string): Promise<{ erro?: string; valores?: { chave: string; valor: string }[] }> {
  const acesso = await checarPermissao("campanhas", "ver");
  if (!acesso.ok) return { erro: acesso.erro };
  if (!ehUuid(grupoId) || !ehUuid(campanhaId)) return { erro: "Grupo inválido." };
  const db = dbAdmin();
  const { data: grupo, error: erroGrupo } = await db.from("grupos").select("id").eq("id", grupoId).eq("campanha_id", campanhaId).maybeSingle();
  if (erroGrupo) return { erro: "Não foi possível conferir o grupo." };
  if (!grupo) return { erro: "Grupo não encontrado nesta campanha." };
  const { data, error } = await db.from("grupo_variaveis").select("chave, valor").eq("grupo_id", grupoId).order("chave");
  if (error) return { erro: "Não foi possível carregar os valores deste grupo." };
  return { valores: (data ?? []) as { chave: string; valor: string }[] };
}

/** Teto de variáveis de um grupo salvas de uma vez (idêntico ao teto da campanha). */
const MAXIMO_VALORES_GRUPO = 100;
const MAXIMO_VALOR_GRUPO = 2000;

/** Diálogo "Valores das variáveis no grupo": grava (ou remove, se vazio) os valores que sobrepõem os da
 *  campanha só nesse grupo. Chave pelas regras de sempre; quando a chave é de uma variável global, o valor
 *  também é validado pelo tipo dela — igual à tela "Variáveis". */
export async function salvarValoresGrupo(grupoId: string, campanhaId: string, valores: { chave: string; valor: string }[]): Promise<{ erro?: string; erros?: Record<string, string> }> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  if (!ehUuid(grupoId) || !ehUuid(campanhaId)) return { erro: "Grupo inválido." };
  if (!Array.isArray(valores)) return { erro: "Valores inválidos." };
  if (valores.length > MAXIMO_VALORES_GRUPO) return { erro: `No máximo ${MAXIMO_VALORES_GRUPO} variáveis de uma vez.` };

  const db = dbAdmin();
  const { data: grupo, error: erroGrupo } = await db.from("grupos").select("id").eq("id", grupoId).eq("campanha_id", campanhaId).maybeSingle();
  if (erroGrupo) return { erro: "Não foi possível conferir o grupo." };
  if (!grupo) return { erro: "Grupo não encontrado nesta campanha." };
  if (!valores.length) return {};

  const linhas: { chave: string; valor: string }[] = [];
  const erros: Record<string, string> = {};
  for (const v of valores) {
    if (typeof v?.chave !== "string" || typeof v.valor !== "string") return { erro: "Valores inválidos." };
    const chave = v.chave.trim();
    if (linhas.some((l) => l.chave === chave)) return { erro: `A variável {${chave}} apareceu duas vezes.` };
    const valor = v.valor.trim();
    const erroChave = validarChave(chave);
    if (erroChave) erros[chave] = erroChave;
    else if (valor.length > MAXIMO_VALOR_GRUPO) erros[chave] = `Valor com até ${MAXIMO_VALOR_GRUPO} caracteres.`;
    linhas.push({ chave, valor });
  }

  const chavesValidas = linhas.filter((l) => !erros[l.chave]).map((l) => l.chave);
  if (chavesValidas.length) {
    const { data: globais, error } = await db.from("variaveis_globais").select("chave, tipo").in("chave", chavesValidas);
    if (error) return { erro: "Não foi possível conferir as variáveis globais." };
    const tipoPorChave = new Map(((globais ?? []) as { chave: string; tipo: string }[]).map((g) => [g.chave, g.tipo]));
    for (const l of linhas) {
      const tipo = tipoPorChave.get(l.chave);
      const erro = tipo && !erros[l.chave] ? validarValorPorTipo(tipo, l.valor) : null;
      if (erro) erros[l.chave] = erro;
    }
  }
  if (Object.keys(erros).length) return { erro: "Confira os valores marcados: nada foi salvo.", erros };

  // Vazio = herda o valor da campanha: remove a linha em vez de gravar valor vazio (menos linha morta na tabela).
  const paraSalvar = linhas.filter((l) => l.valor !== "");
  const paraRemover = linhas.filter((l) => l.valor === "").map((l) => l.chave);
  if (paraSalvar.length) {
    const { error } = await db.from("grupo_variaveis").upsert(paraSalvar.map((l) => ({ grupo_id: grupoId, ...l })), { onConflict: "grupo_id,chave" });
    if (error) return { erro: "Não foi possível salvar os valores." };
  }
  if (paraRemover.length) {
    const { error } = await db.from("grupo_variaveis").delete().eq("grupo_id", grupoId).in("chave", paraRemover);
    if (error) return { erro: "Valores salvos, mas não foi possível limpar os que voltaram a herdar. Salve de novo." };
  }
  revalidatePath(`/campanhas/${campanhaId}/grupos`);
  await registrarHistorico(usuario, { acao: "atualizar", area: "Grupos", resumo: `${linhas.length} variável(is) deste grupo atualizada(s)`, refId: campanhaId });
  return {};
}
