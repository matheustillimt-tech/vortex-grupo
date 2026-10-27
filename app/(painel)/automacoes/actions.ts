"use server";
import { revalidatePath } from "next/cache";
import { removerPendentes, sincronizarCronograma } from "@/src/lib/automacoes";
import { registrarHistorico } from "@/src/lib/historico";
import {
  alvoDaAcaoDePessoa,
  entradaDoImportJson,
  exportarAutomacaoJson,
  validarAutomacao,
  type AcaoAutomacao,
  type AutomacaoExportada,
  type EntradaAutomacao,
} from "@/src/lib/regras/automacoes";
import { ehUuid } from "@/src/lib/regras/uuid";
import { normalizarIds } from "@/src/lib/regras/lote";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { checarPermissao } from "@/src/lib/permissoes";
import { contasDaCampanha, type ContaDaCampanha } from "../_acoes/contas-da-campanha";

type DB = ReturnType<typeof dbAdmin>;

const MAXIMO_LOTE = 100;

export type ResultadoLoteAutomacoes = { feitas: number; erros: string[] };

/** Lista de automações, a(s) campanha(s) envolvida(s) e o calendário (as execuções do cronograma aparecem lá). */
function revalidar(campanhaIds: Iterable<string>) {
  revalidatePath("/automacoes");
  for (const c of new Set(campanhaIds)) revalidatePath(`/campanhas/${c}`, "layout");
  revalidatePath("/calendario");
}

const msg = (e: unknown) => (e instanceof Error ? e.message : "erro inesperado");

/** Ações de blacklist (Etapa 3J) mexem na blacklist por fora da tela de Anti-spam: quem salva ou importa uma
 *  automação com `adicionar_blacklist`/`remover_blacklist` também precisa de "Anti-spam: editar", além de
 *  "Automações: editar" (já exigido por quem chama). `null` = pode seguir; senão, a mensagem de erro. */
async function exigirPermissaoBlacklist(acoes: { tipo: string }[]): Promise<string | null> {
  if (!acoes.some((a) => a.tipo === "adicionar_blacklist" || a.tipo === "remover_blacklist")) return null;
  const acesso = await checarPermissao("antispam", "editar");
  return acesso.ok ? null : acesso.erro;
}

/** Confere no banco as referências aninhadas da automação validada (Etapa 3F, Tarefa 3, Ruling 4): os grupos e as
 *  contas marcados têm que ser da campanha escolhida; a tag de cada Tag Condicional tem que existir; a campanha de
 *  destino de cada "mover grupos" tem que existir e não estar arquivada; nas ações de pessoa (Etapa 3J), a tag tem que
 *  existir e ser `manual` e a blacklist tem que existir (o "não pode ser a mesma campanha" já é
 *  conferido por `validarAutomacao`, sem precisar do banco). Roda em `salvarAutomacao` e `importarAutomacaoJson` —
 *  o assistente só oferece opções válidas, mas o servidor não confia nisso. */
async function confirmarReferencias(
  db: DB,
  v: { campanha_id: string; alvo_grupos: string[] | null; alvo_contas: string[] | null; acoes: AcaoAutomacao[] },
): Promise<string | null> {
  if (v.alvo_grupos?.length) {
    const { data, error } = await db.from("grupos").select("id").eq("campanha_id", v.campanha_id).in("id", v.alvo_grupos);
    if (error) return "Não foi possível conferir os grupos.";
    const ids = new Set(((data ?? []) as { id: string }[]).map((g) => g.id));
    if (v.alvo_grupos.some((g) => !ids.has(g))) return "Grupo escolhido não é desta campanha.";
  }
  if (v.alvo_contas?.length) {
    let daCampanha: ContaDaCampanha[];
    try {
      daCampanha = await contasDaCampanha(db, v.campanha_id);
    } catch {
      return "Não foi possível conferir as conexões.";
    }
    const ids = new Set(daCampanha.map((c) => c.id));
    if (v.alvo_contas.some((c) => !ids.has(c))) return "Conexão escolhida não é desta campanha.";
  }
  const tagIds = [...new Set(v.acoes.filter((a) => a.tipo === "tag_condicional").map((a) => (a.conteudo as { tag_id: string }).tag_id))];
  if (tagIds.length) {
    const { data, error } = await db.from("tags").select("id").in("id", tagIds);
    if (error) return "Não foi possível conferir a tag.";
    const ids = new Set(((data ?? []) as { id: string }[]).map((t) => t.id));
    if (tagIds.some((t) => !ids.has(t))) return "Tag escolhida não existe.";
  }
  const alvos = v.acoes.map(alvoDaAcaoDePessoa).filter((x) => x !== null);
  const tagsPessoa = [...new Set(alvos.filter((x) => x.tipo === "tag").map((x) => x.id))];
  if (tagsPessoa.length) {
    const { data, error } = await db.from("tags").select("id, tipo").in("id", tagsPessoa);
    if (error) return "Não foi possível conferir a tag.";
    const linhas = (data ?? []) as { id: string; tipo: string }[];
    if (tagsPessoa.some((t) => !linhas.some((l) => l.id === t))) return "Tag escolhida não existe.";
    if (linhas.some((l) => l.tipo !== "manual")) return "Só tags manuais podem ser adicionadas ou removidas por automação.";
  }
  const blacklistsPessoa = [...new Set(alvos.filter((x) => x.tipo === "blacklist").map((x) => x.id))];
  if (blacklistsPessoa.length) {
    const { data, error } = await db.from("blacklists").select("id").in("id", blacklistsPessoa);
    if (error) return "Não foi possível conferir a blacklist.";
    const ids = new Set(((data ?? []) as { id: string }[]).map((b) => b.id));
    if (blacklistsPessoa.some((b) => !ids.has(b))) return "Blacklist escolhida não existe.";
  }
  const destinos = [...new Set(v.acoes.filter((a) => a.tipo === "mover_grupos").map((a) => (a.conteudo as { campanha_destino: string }).campanha_destino))];
  for (const destino of destinos) {
    const { data, error } = await db.from("campanhas").select("id, arquivada").eq("id", destino).maybeSingle();
    if (error) return "Não foi possível conferir a campanha de destino.";
    if (!data) return "Campanha de destino não encontrada.";
    if ((data as { arquivada: boolean }).arquivada) return "Campanha de destino está arquivada.";
  }
  return null;
}

/** Cria ou edita. Ações são trocadas por inteiro (insere as novas com `ordem`, depois apaga as antigas), então o cronograma é recalculado
 *  do zero. Edição mantém o `ativo` atual (a não ser que `ativar` ligue); criação nasce desativada sem `ativar`. */
export async function salvarAutomacao(id: string | null, e: EntradaAutomacao, ativar: boolean): Promise<{ id?: string; erro?: string }> {
  const acesso = await checarPermissao("automacoes", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  const db = dbAdmin();

  let anterior: { ativo: boolean; gatilho: string; campanha_id: string; quando: string | null } | null = null;
  if (id) {
    const { data, error } = await db.from("automacoes").select("ativo, gatilho, campanha_id, quando").eq("id", id).maybeSingle();
    if (error) return { erro: "Não foi possível carregar a automação." };
    if (!data) return { erro: "Automação não encontrada." };
    anterior = data;
  }
  // Data futura só é exigida se o `quando` mudou (ou é nova) ou se a automação fica ativa: ativa, o cronograma é
  // recalculado com as ações novas (ids novos) e uma data vencida dispararia tudo na hora.
  const v = validarAutomacao(e, new Date(), { quandoAnterior: anterior?.quando, ativando: ativar || !!anterior?.ativo });
  if (!v.ok) return { erro: v.erro };
  const { acoes, ...campos } = v.valor;
  const erroBlacklist = await exigirPermissaoBlacklist(acoes);
  if (erroBlacklist) return { erro: erroBlacklist };
  // Campanha arquivada só fica numa automação que já era dela (edição sem trocar a campanha); nova automação, ou troca
  // de campanha, precisa de uma não arquivada — o assistente nem lista as arquivadas, mas o servidor não confia nisso.
  if (!anterior || anterior.campanha_id !== campos.campanha_id) {
    const { data: campanha, error: erroCampanha } = await db.from("campanhas").select("arquivada").eq("id", campos.campanha_id).maybeSingle();
    if (erroCampanha) return { erro: "Não foi possível conferir a campanha." };
    if (!campanha) return { erro: "Campanha não encontrada." };
    if (campanha.arquivada) return { erro: "Essa campanha está arquivada: escolha outra." };
  }
  const erroReferencias = await confirmarReferencias(db, { campanha_id: campos.campanha_id, alvo_grupos: campos.alvo_grupos, alvo_contas: campos.alvo_contas, acoes });
  if (erroReferencias) return { erro: erroReferencias };
  const linha = {
    nome: campos.nome,
    campanha_id: campos.campanha_id,
    gatilho: campos.gatilho,
    quando: campos.quando,
    alvo_grupos: campos.alvo_grupos,
    alvo_contas: campos.alvo_contas,
    pasta: campos.pasta,
    provedor: campos.provedor,
    produto: campos.produto,
    checkout_evento: campos.checkout_evento,
    ativo: ativar || (anterior?.ativo ?? false),
    // Ativar limpa o motivo de uma desativação feita pelo sistema (ex.: a conexão escolhida saiu da campanha).
    ...(ativar ? { motivo_desativada: null } : {}),
  };
  const r = id
    ? await db.from("automacoes").update(linha).eq("id", id).select("id").single()
    : await db.from("automacoes").insert(linha).select("id").single();
  if (r.error || !r.data) return { erro: "Não foi possível salvar a automação." };
  const automacaoId = r.data.id as string;
  const campanhas = [campos.campanha_id, ...(anterior ? [anterior.campanha_id] : [])];

  // Troca das ações sem janela vazia: lê as antigas, insere as novas e só então apaga as antigas pelo id. Se a
  // inserção falhar, as antigas ficam intactas (e uma automação recém-criada é desfeita, pra não sobrar vazia).
  let antigos: string[] = [];
  if (id) {
    const { data: velhas, error: erroVelhas } = await db.from("automacao_acoes").select("id").eq("automacao_id", automacaoId);
    if (erroVelhas) {
      revalidar(campanhas);
      return { id: automacaoId, erro: "Automação salva, mas não foi possível atualizar as ações." };
    }
    antigos = (velhas ?? []).map((a) => a.id as string);
  }
  const ins = await db.from("automacao_acoes").insert(
    acoes.map((a, ordem) => ({ automacao_id: automacaoId, ordem, tipo: a.tipo, conteudo: a.conteudo, atraso_min: a.atraso_min })),
  ).select("id");
  if (ins.error) {
    if (!id) {
      await db.from("automacoes").delete().eq("id", automacaoId);
      return { erro: "Não foi possível salvar as ações da automação." };
    }
    revalidar(campanhas);
    return { id: automacaoId, erro: "Automação salva, mas não foi possível salvar as ações: as anteriores foram mantidas." };
  }

  try {
    if (antigos.length) {
      const del = await db.from("automacao_acoes").delete().in("id", antigos);
      if (del.error) {
        // Sem apagar as antigas ficariam as duas listas (ações em dobro): desfaz as novas e mantém as antigas.
        await db.from("automacao_acoes").delete().in("id", (ins.data ?? []).map((a) => a.id as string));
        throw new Error("Automação salva, mas não foi possível trocar as ações: as anteriores foram mantidas.");
      }
    }
    // Cronograma (ou que deixou de ser): recalcula/remove as execuções agendadas dele.
    if (campos.gatilho === "cronograma" || anterior?.gatilho === "cronograma") {
      try {
        await sincronizarCronograma(automacaoId, db);
      } catch {
        throw new Error("Automação salva, mas não foi possível agendar o cronograma.");
      }
    }
  } catch (err) {
    revalidar(campanhas);
    return { id: automacaoId, erro: msg(err) };
  }
  revalidar(campanhas);
  await registrarHistorico(usuario, { acao: id ? "atualizar" : "adicionar", area: "Automações", resumo: `Automação "${campos.nome}" ${id ? "atualizada" : "criada"}`, refId: automacaoId });
  return { id: automacaoId };
}

async function alternarUma(id: string, ativo: boolean): Promise<string> {
  const db = dbAdmin();
  const { data, error } = await db
    .from("automacoes")
    .select("nome, campanha_id, gatilho, quando, alvo_grupos, alvo_contas, pasta, provedor, produto, automacao_acoes(ordem, tipo, conteudo, atraso_min)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("Não foi possível carregar a automação.");
  if (!data) throw new Error("Automação não encontrada.");
  if (ativo) {
    // Ligar um cronograma com data vencida dispararia tudo na hora: obriga a escolher uma data nova antes.
    if (data.gatilho === "cronograma" && (!data.quando || new Date(data.quando) <= new Date())) {
      throw new Error(`"${data.nome}": a data do disparo já passou. Edite e escolha uma data futura.`);
    }
    const acoes = ((data.automacao_acoes ?? []) as { ordem: number; tipo: AcaoAutomacao["tipo"]; conteudo: unknown; atraso_min: number }[])
      .sort((a, b) => a.ordem - b.ordem)
      .map(({ tipo, conteudo, atraso_min }) => ({ tipo, conteudo, atraso_min }));
    const v = validarAutomacao(
      { nome: data.nome, campanha_id: data.campanha_id, gatilho: data.gatilho, quando: data.quando, alvo_grupos: data.alvo_grupos, alvo_contas: data.alvo_contas, pasta: data.pasta, provedor: data.provedor, produto: data.produto, acoes },
      new Date(),
      { quandoAnterior: data.quando, ativando: true },
    );
    if (!v.ok) throw new Error(`"${data.nome}": ${v.erro} Edite antes de ativar.`);
    // Reativar pela lista (sem passar pelo assistente): confere de novo se grupos/contas ainda são da campanha,
    // a tag da Tag Condicional ainda existe e a campanha de destino do "mover grupos" ainda existe/não arquivou —
    // qualquer uma pode ter mudado desde que a automação foi salva (ex.: a conta saiu da campanha).
    const erroReferencias = await confirmarReferencias(db, { campanha_id: v.valor.campanha_id, alvo_grupos: v.valor.alvo_grupos, alvo_contas: v.valor.alvo_contas, acoes: v.valor.acoes });
    if (erroReferencias) throw new Error(`"${data.nome}": ${erroReferencias} Edite antes de ativar.`);
  }
  const up = await db.from("automacoes").update(ativo ? { ativo, motivo_desativada: null } : { ativo }).eq("id", id);
  if (up.error) throw new Error(`"${data.nome}": não foi possível ${ativo ? "ativar" : "desativar"}.`);
  try {
    if (data.gatilho === "cronograma") await sincronizarCronograma(id, db);
    else if (!ativo) await removerPendentes(id, db);
  } catch {
    throw new Error(`"${data.nome}": ${ativo ? "ativada, mas não foi possível agendar o cronograma" : "desativada, mas não foi possível remover as pendentes"}.`);
  }
  return data.campanha_id as string;
}

export async function alternarAutomacoes(ids: unknown, ativo: boolean): Promise<ResultadoLoteAutomacoes> {
  const acesso = await checarPermissao("automacoes", "editar");
  if (!acesso.ok) return { feitas: 0, erros: [acesso.erro] };
  const usuario = acesso.usuario;
  const r = await emLote(ids, (id) => alternarUma(id, ativo));
  if (r.feitas) await registrarHistorico(usuario, { acao: "atualizar", area: "Automações", resumo: `${r.feitas} automação(ões) ${ativo ? "ativada(s)" : "desativada(s)"}` });
  return r;
}

async function duplicarUma(id: string): Promise<string> {
  const db = dbAdmin();
  const { data, error } = await db
    .from("automacoes")
    .select("nome, campanha_id, gatilho, quando, alvo_grupos, alvo_contas, pasta, provedor, produto, checkout_evento, automacao_acoes(ordem, tipo, conteudo, atraso_min)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("Não foi possível carregar a automação.");
  if (!data) throw new Error("Automação não encontrada.");
  // "Duplicar" do menu `more_vert`: nome com o prefixo "Cópia de ", sempre desativada.
  const prefixo = "Cópia de ";
  const nova = await db
    .from("automacoes")
    .insert({
      nome: `${prefixo}${data.nome}`.slice(0, 80),
      campanha_id: data.campanha_id,
      gatilho: data.gatilho,
      quando: data.quando, // cronograma com data vencida também copia: nasce desativada e só liga com data nova
      alvo_grupos: data.alvo_grupos,
      alvo_contas: data.alvo_contas,
      pasta: data.pasta,
      provedor: data.provedor,
      produto: data.produto,
      checkout_evento: data.checkout_evento,
      ativo: false,
    })
    .select("id")
    .single();
  if (nova.error || !nova.data) throw new Error(`"${data.nome}": não foi possível duplicar.`);
  const acoes = ((data.automacao_acoes ?? []) as { ordem: number; tipo: string; conteudo: unknown; atraso_min: number }[]).sort((a, b) => a.ordem - b.ordem);
  if (acoes.length) {
    const ins = await db.from("automacao_acoes").insert(acoes.map((a) => ({ ...a, automacao_id: nova.data.id })));
    if (ins.error) {
      await db.from("automacoes").delete().eq("id", nova.data.id);
      throw new Error(`"${data.nome}": não foi possível copiar as ações.`);
    }
  }
  return data.campanha_id as string;
}

/** "Duplicar" em massa (Etapa 3K, Tarefa 7): no máximo 50 por vez; acima disso não duplica nenhuma. */
const MAXIMO_DUPLICAR = 50;

export async function duplicarAutomacoes(ids: unknown): Promise<ResultadoLoteAutomacoes> {
  const acesso = await checarPermissao("automacoes", "editar");
  if (!acesso.ok) return { feitas: 0, erros: [acesso.erro] };
  if (normalizarIds(ids, Number.MAX_SAFE_INTEGER).length > MAXIMO_DUPLICAR) return { feitas: 0, erros: [`Duplique no máximo ${MAXIMO_DUPLICAR} automações por vez.`] };
  const usuario = acesso.usuario;
  const r = await emLote(ids, duplicarUma);
  if (r.feitas) await registrarHistorico(usuario, { acao: "adicionar", area: "Automações", resumo: `${r.feitas} automação(ões) duplicada(s)` });
  return r;
}

async function excluirUma(id: string): Promise<string> {
  const db = dbAdmin();
  const { data, error } = await db.from("automacoes").select("nome, campanha_id").eq("id", id).maybeSingle();
  if (error) throw new Error("Não foi possível carregar a automação.");
  if (!data) throw new Error("Automação não encontrada.");
  try {
    await removerPendentes(id, db);
  } catch {
    throw new Error(`"${data.nome}": não foi possível remover as pendentes, nada foi apagado.`);
  }
  const del = await db.from("automacoes").delete().eq("id", id);
  if (del.error) throw new Error(`"${data.nome}": não foi possível excluir.`);
  return data.campanha_id as string;
}

export async function excluirAutomacoes(ids: unknown): Promise<ResultadoLoteAutomacoes> {
  const acesso = await checarPermissao("automacoes", "editar");
  if (!acesso.ok) return { feitas: 0, erros: [acesso.erro] };
  const usuario = acesso.usuario;
  const r = await emLote(ids, excluirUma);
  if (r.feitas) await registrarHistorico(usuario, { acao: "remover", area: "Automações", resumo: `${r.feitas} automação(ões) excluída(s)` });
  return r;
}

export async function moverParaPasta(ids: unknown, pasta: string | null): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("automacoes", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  const lista = normalizarIds(ids, MAXIMO_LOTE);
  if (!lista.length) return { erro: "Marque pelo menos uma automação." };
  const nome = typeof pasta === "string" ? pasta.trim() || null : null;
  if (nome && nome.length > 40) return { erro: "Pasta com até 40 caracteres." };
  const { error } = await dbAdmin().from("automacoes").update({ pasta: nome }).in("id", lista);
  if (error) return { erro: "Não foi possível mover para a pasta." };
  revalidatePath("/automacoes");
  await registrarHistorico(usuario, { acao: "atualizar", area: "Automações", resumo: `${lista.length} automação(ões) movida(s)${nome ? ` para a pasta "${nome}"` : " para fora da pasta"}` });
  return {};
}

/** Roda `uma` em cada id (até 100), uma por vez; junta os erros e revalida uma vez só no fim. */
async function emLote(ids: unknown, uma: (id: string) => Promise<string>): Promise<ResultadoLoteAutomacoes> {
  const lista = normalizarIds(ids, MAXIMO_LOTE);
  const campanhas: string[] = [];
  const erros: string[] = [];
  for (const id of lista) {
    try {
      campanhas.push(await uma(id));
    } catch (err) {
      erros.push(msg(err));
    }
  }
  if (lista.length) revalidar(campanhas); // mesmo com erro: uma falha no meio pode ter mudado algo (ex.: ativou sem agendar)
  return { feitas: campanhas.length, erros };
}

/** "Cancelar tudo" do menu `more_vert`: cancela as execuções ainda `agendada` da automação —
 *  mesmo critério de uma a uma (`cancelarUma`, em `_acoes/execucoes.ts`), só que num `update` em lote (todas são
 *  da mesma automação). Fica registrado no histórico. */
export async function cancelarTudoAutomacao(id: string): Promise<{ feitas: number; erro?: string }> {
  const acesso = await checarPermissao("automacoes", "editar");
  if (!acesso.ok) return { feitas: 0, erro: acesso.erro };
  if (!ehUuid(id)) return { feitas: 0, erro: "Automação inválida." };
  const usuario = acesso.usuario;
  const db = dbAdmin();
  const { data: automacao, error: erroAutomacao } = await db.from("automacoes").select("nome, campanha_id").eq("id", id).maybeSingle();
  if (erroAutomacao) return { feitas: 0, erro: "Não foi possível carregar a automação." };
  if (!automacao) return { feitas: 0, erro: "Automação não encontrada." };
  const { data, error } = await db.from("execucoes").update({ status: "cancelada" }).eq("automacao_id", id).eq("status", "agendada").select("id");
  if (error) return { feitas: 0, erro: "Não foi possível cancelar as execuções." };
  const feitas = (data ?? []).length;
  if (feitas) {
    revalidar([automacao.campanha_id as string]);
    await registrarHistorico(usuario, { acao: "remover", area: "Automações", resumo: `"${automacao.nome}": ${feitas} execução(ões) agendada(s) cancelada(s)`, refId: id });
  }
  return { feitas };
}

/** "Exportar JSON" do menu `more_vert`: monta o arquivo com `exportarAutomacaoJson` (nunca id, campanha, contas
 *  ou grupos). Só precisa ver a automação (não editar). */
export async function exportarAutomacaoJsonAcao(id: string): Promise<{ nome?: string; json?: AutomacaoExportada; erro?: string }> {
  const acesso = await checarPermissao("automacoes", "ver");
  if (!acesso.ok) return { erro: acesso.erro };
  if (!ehUuid(id)) return { erro: "Automação inválida." };
  const db = dbAdmin();
  const { data, error } = await db
    .from("automacoes")
    .select("nome, gatilho, quando, provedor, produto, checkout_evento, automacao_acoes(ordem, tipo, conteudo, atraso_min)")
    .eq("id", id)
    .maybeSingle();
  if (error) return { erro: "Não foi possível carregar a automação." };
  if (!data) return { erro: "Automação não encontrada." };
  const acoesOrdenadas = ((data.automacao_acoes ?? []) as { ordem: number; tipo: string; conteudo: unknown; atraso_min: number }[]).sort((a, b) => a.ordem - b.ordem);
  const json = exportarAutomacaoJson({
    nome: data.nome as string,
    gatilho: data.gatilho as string,
    quando: data.quando as string | null,
    provedor: data.provedor as string | null,
    produto: data.produto as string | null,
    checkout_evento: data.checkout_evento as string | null,
    acoes: acoesOrdenadas,
  });
  return { nome: data.nome as string, json };
}

const MAXIMO_BYTES_IMPORT_JSON = 200 * 1024;

/** "IMPORTAR JSON" do cabeçalho: valida com as mesmas regras do assistente (`validarAutomacao`) e nasce
 *  desativada, na campanha escolhida na janela. `brutoTexto` é o conteúdo cru (colado ou lido do arquivo); o
 *  tamanho é conferido aqui antes de tentar o `JSON.parse` (o cliente também limita a 200 KB, mas o servidor não
 *  confia nisso). */
export async function importarAutomacaoJson(campanhaId: string, brutoTexto: string): Promise<{ id?: string; erro?: string }> {
  const acesso = await checarPermissao("automacoes", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  if (!ehUuid(campanhaId)) return { erro: "Escolha a campanha de destino." };
  if (typeof brutoTexto !== "string" || !brutoTexto.trim()) return { erro: "Cole ou envie o JSON da automação." };
  if (new TextEncoder().encode(brutoTexto).length > MAXIMO_BYTES_IMPORT_JSON) return { erro: "Arquivo muito grande (máximo 200 KB)." };
  let bruto: unknown;
  try {
    bruto = JSON.parse(brutoTexto);
  } catch {
    return { erro: "JSON inválido: não foi possível ler o arquivo." };
  }

  const db = dbAdmin();
  const { data: campanha, error: erroCampanha } = await db.from("campanhas").select("arquivada").eq("id", campanhaId).maybeSingle();
  if (erroCampanha) return { erro: "Não foi possível conferir a campanha." };
  if (!campanha) return { erro: "Campanha não encontrada." };
  if (campanha.arquivada) return { erro: "Essa campanha está arquivada: escolha outra." };

  const entrada = entradaDoImportJson(bruto, campanhaId);
  if (!entrada.ok) return { erro: entrada.erro };
  const v = validarAutomacao(entrada.valor, new Date(), {});
  if (!v.ok) return { erro: v.erro };
  const { acoes, ...campos } = v.valor;
  const erroBlacklist = await exigirPermissaoBlacklist(acoes);
  if (erroBlacklist) return { erro: erroBlacklist };
  const erroReferencias = await confirmarReferencias(db, { campanha_id: campos.campanha_id, alvo_grupos: campos.alvo_grupos, alvo_contas: campos.alvo_contas, acoes });
  if (erroReferencias) return { erro: erroReferencias };

  const linha = {
    nome: campos.nome,
    campanha_id: campos.campanha_id,
    gatilho: campos.gatilho,
    quando: campos.quando,
    alvo_grupos: campos.alvo_grupos,
    alvo_contas: campos.alvo_contas,
    pasta: campos.pasta,
    provedor: campos.provedor,
    produto: campos.produto,
    checkout_evento: campos.checkout_evento,
    ativo: false,
  };
  const ins = await db.from("automacoes").insert(linha).select("id").single();
  if (ins.error || !ins.data) return { erro: "Não foi possível importar a automação." };
  const automacaoId = ins.data.id as string;
  const insAcoes = await db
    .from("automacao_acoes")
    .insert(acoes.map((a, ordem) => ({ automacao_id: automacaoId, ordem, tipo: a.tipo, conteudo: a.conteudo, atraso_min: a.atraso_min })));
  if (insAcoes.error) {
    await db.from("automacoes").delete().eq("id", automacaoId);
    return { erro: "Não foi possível importar as ações da automação." };
  }
  revalidar([campanhaId]);
  await registrarHistorico(usuario, { acao: "adicionar", area: "Automações", resumo: `Automação "${campos.nome}" importada de JSON`, refId: automacaoId });
  return { id: automacaoId };
}

/** Passo "Conta" do assistente: as mesmas contas que o assistente "Adicionar ação" oferece pra campanha
 *  (`contasDaCampanha`) — associadas, criadora e donas de grupo. Carregado só quando o passo é visitado
 *  (a campanha já está escolhida nesse ponto do assistente). */
export async function contasDaCampanhaAutomacao(campanhaId: string): Promise<{ erro: string } | { contas: ContaDaCampanha[] }> {
  const acesso = await checarPermissao("automacoes", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  if (!ehUuid(campanhaId)) return { erro: "Campanha inválida." };
  try {
    return { contas: await contasDaCampanha(dbAdmin(), campanhaId) };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "Não foi possível carregar as conexões." };
  }
}
