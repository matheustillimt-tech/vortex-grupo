"use server";
import { revalidatePath } from "next/cache";
import { cancelarExecucaoAgendada } from "@/src/lib/acoes/editar";
import { cancelarSeguintes } from "@/src/lib/jobs/encadeadas";
import { checarPermissao, exigirPermissao } from "@/src/lib/permissoes";
import { registrarHistorico } from "@/src/lib/historico";
import { MOTIVO_ANTERIOR_CANCELADA, MOTIVO_ANTERIOR_EXCLUIDA } from "@/src/lib/regras/encadeadas";
import { espacarEnvios } from "@/src/lib/regras/espacamento";
import { normalizarIds, normalizarIdsUuid } from "@/src/lib/regras/lote";
import { dbAdmin } from "@/src/lib/supabase/admin";

/** Atualiza todas as abas da campanha e o calendário geral. */
function revalidar(campanhaId: string) {
  revalidatePath(`/campanhas/${campanhaId}`, "layout");
  revalidatePath("/calendario");
}

/** Pras ações "sem campanha" (`/acoes`): revalida cada campanha afetada, mais a própria tela geral. */
function revalidarGlobal(campanhaIds: Iterable<string>) {
  for (const id of new Set(campanhaIds)) revalidar(id);
  revalidatePath("/acoes");
}

/** Máximo de ids por chamada nas ações em massa "sem campanha" — a tela global cruza execuções de campanhas
 *  diferentes, então os ids precisam ser uuids de verdade (não dá pra confiar em "qualquer string"). */
const MAXIMO_LOTE_GLOBAL = 300;

function erroTamanhoGlobal(ids: unknown): string | null {
  const brutos = Array.isArray(ids) ? new Set(ids.filter((i): i is string => typeof i === "string" && i.length > 0)) : new Set();
  return brutos.size > MAXIMO_LOTE_GLOBAL ? `Marque no máximo ${MAXIMO_LOTE_GLOBAL} de uma vez.` : null;
}

/** Campanha de cada execução (pra revalidar os caminhos certos) — carregada no servidor, nunca confiada do cliente. */
async function campanhasDosIds(db: ReturnType<typeof dbAdmin>, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const { data, error } = await db.from("execucoes").select("id, campanha_id").in("id", ids);
  if (error) throw new Error(`Não foi possível carregar as execuções: ${error.message}`);
  return new Map((data ?? []).map((e: { id: string; campanha_id: string }) => [e.id, e.campanha_id]));
}

// Miolos sem checar permissão nem `revalidar`: a versão individual e a em lote chamam o mesmo código, e o lote revalida uma vez só.

/** Cancela a execução e, em cascata, as seguintes dela ainda agendadas (núcleo em `src/lib/acoes/editar.ts`,
 *  o mesmo da API/MCP). */
const cancelarUma = (id: string) => cancelarExecucaoAgendada(id);

async function executarUmaAgora(id: string) {
  const { data, error } = await dbAdmin().from("execucoes").update({ agendada_para: new Date().toISOString() }).eq("id", id).eq("status", "agendada").select("id");
  if (error) throw new Error(`Não foi possível antecipar: ${error.message}`);
  if (!data?.length) throw new Error("Já começou ou foi cancelada.");
}

/** `soComFalhas` (lote): sem tarefa com erro, não mexe na execução (não marca uma agendada como "enviando"). */
async function reexecutarFalhasDeUma(execucaoId: string, soComFalhas = false) {
  const db = dbAdmin();
  const { data: exec, error: erroExecSelect } = await db.from("execucoes").select("status").eq("id", execucaoId).maybeSingle();
  if (erroExecSelect) throw new Error(`Não foi possível conferir a execução: ${erroExecSelect.message}`);
  if (exec?.status === "enviando") throw new Error("Já está em andamento: não dá pra reprocessar agora.");
  // "Adicionar outra ação": reprocessar a anterior enquanto a seguinte já está agendada/enviando sairia fora de
  // ordem (a seguinte pode terminar antes da anterior ser refeita). Recusa até a seguinte sair da fila.
  const { data: seguinte, error: erroSeguinte } = await db.from("execucoes").select("id").eq("depois_de", execucaoId).in("status", ["agendada", "enviando"]).limit(1);
  if (erroSeguinte) throw new Error(`Não foi possível conferir a ação seguinte: ${erroSeguinte.message}`);
  if (seguinte?.length) throw new Error("A ação seguinte já está agendada: não dá pra reprocessar a anterior agora.");
  const { data, error: erroSelect } = await db.from("tarefas").select("id, grupo_id, conexao_id").eq("execucao_id", execucaoId).eq("status", "erro");
  if (erroSelect) throw new Error(`Não foi possível carregar as falhas: ${erroSelect.message}`);
  const falhas = data ?? [];
  if (soComFalhas && !falhas.length) throw new Error("Não há falhas pra reprocessar.");
  const itens = espacarEnvios(falhas.map((f) => ({ grupoId: f.grupo_id, conexaoId: f.conexao_id, id: f.id })), new Date());
  for (const i of itens) {
    const { error } = await db.from("tarefas").update({ status: "fila", tentativas: 0, erro: null, enviar_apos: i.enviarApos.toISOString() }).eq("id", i.id);
    if (error) throw new Error(`Não foi possível repetir uma das falhas: ${error.message}`);
  }
  const { error: erroExec } = await db.from("execucoes").update({ status: "enviando" }).eq("id", execucaoId);
  if (erroExec) throw new Error(`Não foi possível marcar a execução como em andamento: ${erroExec.message}`);
}

export async function cancelarExecucao(id: string, campanhaId: string) {
  const { usuario } = await exigirPermissao("campanhas", "editar");
  await cancelarUma(id);
  revalidar(campanhaId);
  await registrarHistorico(usuario, { acao: "remover", area: "Ações", resumo: "Execução cancelada", refId: id });
}

export async function executarAgora(id: string, campanhaId: string) {
  const { usuario } = await exigirPermissao("campanhas", "editar");
  await executarUmaAgora(id);
  revalidar(campanhaId);
  await registrarHistorico(usuario, { acao: "executar", area: "Ações", resumo: "Execução antecipada para agora", refId: id });
}

/** Tarefas com erro voltam pra fila, espaçadas por número; a execução volta a "enviando". */
export async function reexecutarFalhas(execucaoId: string, campanhaId: string) {
  const { usuario } = await exigirPermissao("campanhas", "editar");
  await reexecutarFalhasDeUma(execucaoId);
  revalidar(campanhaId);
  await registrarHistorico(usuario, { acao: "executar", area: "Ações", resumo: "Falhas da execução reprocessadas", refId: execucaoId });
}

export type ResultadoLote = { feitas: number; erros: string[] };

const MAXIMO_LOTE = 100;

type Usuario = Parameters<typeof registrarHistorico>[0];

/** Roda `uma` para cada id (um de cada vez), junta as mensagens de erro (sem repetir) e revalida uma vez. */
async function emLote(usuario: Usuario, ids: string[], campanhaId: string, uma: (id: string) => Promise<void>, resumo: (feitas: number) => string, acao: "remover" | "executar"): Promise<ResultadoLote> {
  const brutosUnicos = new Set(ids.filter((i) => typeof i === "string" && i));
  if (brutosUnicos.size > MAXIMO_LOTE) return { feitas: 0, erros: [`Marque no máximo ${MAXIMO_LOTE} de uma vez.`] };
  const unicos = normalizarIds(ids, MAXIMO_LOTE);
  let feitas = 0;
  const erros = new Set<string>();
  for (const id of unicos) {
    try {
      await uma(id);
      feitas++;
    } catch (e) {
      erros.add(e instanceof Error ? e.message : "Erro inesperado.");
    }
  }
  if (feitas) revalidar(campanhaId);
  if (feitas) await registrarHistorico(usuario, { acao, area: "Ações", resumo: resumo(feitas) });
  return { feitas, erros: [...erros] };
}

export async function executarAgoraEmLote(ids: string[], campanhaId: string): Promise<ResultadoLote> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { feitas: 0, erros: [acesso.erro] };
  return emLote(acesso.usuario, ids, campanhaId, executarUmaAgora, (n) => `${n} execuç${n === 1 ? "ão" : "ões"} antecipada${n === 1 ? "" : "s"} para agora`, "executar");
}

export async function cancelarEmLote(ids: string[], campanhaId: string): Promise<ResultadoLote> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { feitas: 0, erros: [acesso.erro] };
  return emLote(acesso.usuario, ids, campanhaId, cancelarUma, (n) => `${n} execuç${n === 1 ? "ão" : "ões"} cancelada${n === 1 ? "" : "s"}`, "remover");
}

export async function reexecutarFalhasEmLote(ids: string[], campanhaId: string): Promise<ResultadoLote> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { feitas: 0, erros: [acesso.erro] };
  return emLote(acesso.usuario, ids, campanhaId, (id) => reexecutarFalhasDeUma(id, true), (n) => `Falhas reprocessadas em ${n} execuç${n === 1 ? "ão" : "ões"}`, "executar");
}

// --- Tela geral `/acoes`: as mesmas ações, mas sem campanha fixa (os ids podem ser de campanhas diferentes). ---

/** Como `emLote`, mas sem campanha: carrega a campanha de cada id no servidor (pra revalidar os caminhos certos)
 *  e exige uuid de verdade em cada id (até 300 por chamada). */
async function emLoteGlobal(usuario: Usuario, ids: string[], uma: (id: string) => Promise<void>, resumo: (feitas: number) => string, acao: "remover" | "executar"): Promise<ResultadoLote> {
  const erroTamanho = erroTamanhoGlobal(ids);
  if (erroTamanho) return { feitas: 0, erros: [erroTamanho] };
  const unicos = normalizarIdsUuid(ids, MAXIMO_LOTE_GLOBAL);
  if (!unicos.length) return { feitas: 0, erros: [] };
  const db = dbAdmin();
  const campanhaPorId = await campanhasDosIds(db, unicos);
  let feitas = 0;
  const erros = new Set<string>();
  for (const id of unicos) {
    try {
      await uma(id);
      feitas++;
    } catch (e) {
      erros.add(e instanceof Error ? e.message : "Erro inesperado.");
    }
  }
  if (feitas) {
    revalidarGlobal(campanhaPorId.values());
    await registrarHistorico(usuario, { acao, area: "Ações", resumo: resumo(feitas) });
  }
  return { feitas, erros: [...erros] };
}

export async function executarAgoraGlobal(ids: string[]): Promise<ResultadoLote> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { feitas: 0, erros: [acesso.erro] };
  return emLoteGlobal(acesso.usuario, ids, executarUmaAgora, (n) => `${n} execuç${n === 1 ? "ão" : "ões"} antecipada${n === 1 ? "" : "s"} para agora`, "executar");
}

export async function cancelarGlobal(ids: string[]): Promise<ResultadoLote> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { feitas: 0, erros: [acesso.erro] };
  return emLoteGlobal(acesso.usuario, ids, cancelarUma, (n) => `${n} execuç${n === 1 ? "ão" : "ões"} cancelada${n === 1 ? "" : "s"}`, "remover");
}

export async function reexecutarFalhasGlobal(ids: string[]): Promise<ResultadoLote> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { feitas: 0, erros: [acesso.erro] };
  return emLoteGlobal(acesso.usuario, ids, (id) => reexecutarFalhasDeUma(id, true), (n) => `Falhas reprocessadas em ${n} execuç${n === 1 ? "ão" : "ões"}`, "executar");
}

/** "Reenviar ações travadas": mesmo critério que o job usa pra achar tarefa presa (`pegar_tarefas`, em
 *  `src/lib/jobs/tarefas.ts`) — `status = 'processando'` com `pego_em` há mais de 5 min — só que em vez de marcar
 *  erro, manda direto pra fila de novo (como `reexecutarFalhasDeUma` faz com as de erro), espaçada por número. */
export async function reenviarTravadas(ids: string[]): Promise<ResultadoLote> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { feitas: 0, erros: [acesso.erro] };
  const erroTamanho = erroTamanhoGlobal(ids);
  if (erroTamanho) return { feitas: 0, erros: [erroTamanho] };
  const unicos = normalizarIdsUuid(ids, MAXIMO_LOTE_GLOBAL);
  if (!unicos.length) return { feitas: 0, erros: [] };
  const db = dbAdmin();
  const campanhaPorId = await campanhasDosIds(db, unicos);
  const limite = new Date(Date.now() - 5 * 60_000).toISOString();
  const { data, error } = await db.from("tarefas").select("id, grupo_id, conexao_id").in("execucao_id", unicos).eq("status", "processando").lt("pego_em", limite);
  if (error) return { feitas: 0, erros: [`Não foi possível carregar as tarefas travadas: ${error.message}`] };
  const travadas = data ?? [];
  if (!travadas.length) return { feitas: 0, erros: [] };
  const itens = espacarEnvios(travadas.map((t: { id: string; grupo_id: string; conexao_id: string }) => ({ grupoId: t.grupo_id, conexaoId: t.conexao_id, id: t.id })), new Date());
  const erros = new Set<string>();
  let feitas = 0;
  for (const i of itens) {
    // Só volta pra fila se AINDA estiver travada: o job pode ter marcado erro ou o envio pode ter terminado entre a
    // leitura e aqui — sem essa trava a gente sobrescreveria o resultado e mandaria de novo.
    const { data: mudou, error: erroUpdate } = await db
      .from("tarefas")
      .update({ status: "fila", tentativas: 0, erro: null, enviar_apos: i.enviarApos.toISOString() })
      .eq("id", i.id)
      .eq("status", "processando")
      .lt("pego_em", limite)
      .select("id");
    if (erroUpdate) erros.add(`Não foi possível reenviar uma tarefa travada: ${erroUpdate.message}`);
    else if (mudou?.length) feitas++;
  }
  if (feitas) {
    revalidarGlobal(campanhaPorId.values());
    await registrarHistorico(acesso.usuario, { acao: "executar", area: "Ações", resumo: `${feitas} tarefa${feitas === 1 ? "" : "s"} travada${feitas === 1 ? "" : "s"} reenviada${feitas === 1 ? "" : "s"} para a fila` });
  }
  return { feitas, erros: [...erros] };
}

export type ResultadoExclusao = { apagadas: number; canceladas: number; puladas: number; erros: string[] };

/** Origens que um job recria quando a linha some: `sequencia` (`materializarSequencias`, upsert com ignore no único
 *  `campanha_id,passo_id`) e `automacao` (`sincronizarCronograma`/`dispararAutomacoes`/`dispararPorPessoas`, upsert
 *  com ignore no único `automacao_acao_id,gatilho_chave` — o cronograma ainda apaga as `agendada` antes de
 *  reinserir). Apagar uma dessas faria o job criar de novo e mandar outra vez; marcada `cancelada`, a linha fica como
 *  "lápide" no índice único, o upsert a ignora e `listar_acoes` não a mostra mais. `avulsa`, `massa` e `grupo_novo`
 *  nascem uma vez só (insert), então podem ser apagadas de verdade. */
const ORIGENS_RECRIADAS_PELO_JOB = new Set(["sequencia", "automacao"]);

/** Exclui execuções (e as tarefas junto — `tarefas.execucao_id` tem `on delete cascade`, assim como
 *  `enquete_votos.execucao_id`), exceto as que estão `enviando` agora (em andamento). As de sequência/automação são
 *  canceladas em vez de apagadas (ver `ORIGENS_RECRIADAS_PELO_JOB`). A trava de `enviando` vai no próprio
 *  `delete`/`update` (não só na leitura), então uma que começou a enviar entre a leitura e aqui também é pulada.
 *  Retorna quantas apagou, quantas cancelou e quantas pulou. */
export async function excluirExecucoes(ids: string[]): Promise<ResultadoExclusao> {
  const vazio = (erros: string[] = []): ResultadoExclusao => ({ apagadas: 0, canceladas: 0, puladas: 0, erros });
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return vazio([acesso.erro]);
  const erroTamanho = erroTamanhoGlobal(ids);
  if (erroTamanho) return vazio([erroTamanho]);
  const unicos = normalizarIdsUuid(ids, MAXIMO_LOTE_GLOBAL);
  if (!unicos.length) return vazio();
  const db = dbAdmin();
  const { data, error } = await db.from("execucoes").select("id, campanha_id, origem, status").in("id", unicos);
  if (error) return vazio([`Não foi possível carregar as execuções: ${error.message}`]);
  const linhas = (data ?? []) as { id: string; campanha_id: string; origem: string; status?: string }[];
  if (!linhas.length) return vazio();
  const campanhaPorId = new Map(linhas.map((e) => [e.id, e.campanha_id]));
  const paraCancelar = linhas.filter((e) => ORIGENS_RECRIADAS_PELO_JOB.has(e.origem)).map((e) => e.id);
  const paraApagar = linhas.filter((e) => !ORIGENS_RECRIADAS_PELO_JOB.has(e.origem)).map((e) => e.id);

  const erros: string[] = [];
  const mexidas: string[] = [];
  let canceladas = 0;
  let apagadas = 0;
  let tentadas = 0;
  if (paraCancelar.length) {
    const { data: feitas, error: erroCancelar } = await db
      .from("execucoes")
      .update({ status: "cancelada" })
      .in("id", paraCancelar)
      // Só as que ainda não saíram: uma concluída que já foi pro grupo fica como está (mostrar "Cancelado" numa
      // mensagem enviada seria mentira) e conta como pulada.
      .in("status", ["agendada", "bloqueada"])
      .select("id");
    if (erroCancelar) erros.push(`Não foi possível cancelar as de sequência/automação: ${erroCancelar.message}`);
    else {
      tentadas += paraCancelar.length;
      const idsFeitos = ((feitas ?? []) as { id: string }[]).map((f) => f.id);
      canceladas = idsFeitos.length;
      mexidas.push(...idsFeitos);
    }
  }
  let apagaveis = paraApagar;
  if (paraApagar.length) {
    // "Adicionar outra ação": a seguinte de uma que ainda não terminou é cancelada ANTES de apagar (depois, a FK
    // `on delete set null` a soltaria e ela sairia sozinha, fora de ordem). Seguinte de uma já concluída/pulada fica
    // solta e sai no próximo tick, como sairia de qualquer jeito.
    const naoTerminadas = linhas.filter((e) => paraApagar.includes(e.id) && e.status !== "concluida" && e.status !== "pulada" && e.status !== "enviando").map((e) => e.id);
    if (naoTerminadas.length) {
      try {
        await cancelarSeguintes(naoTerminadas, MOTIVO_ANTERIOR_EXCLUIDA, db);
      } catch (e) {
        // Sem conseguir cancelar as seguintes, essas não são apagadas (a seguinte sairia fora de ordem).
        erros.push(e instanceof Error ? e.message : "Não foi possível cancelar as ações seguintes.");
        apagaveis = paraApagar.filter((id) => !naoTerminadas.includes(id));
      }
    }
  }
  if (apagaveis.length) {
    const { data: feitas, error: erroDelete } = await db.from("execucoes").delete().in("id", apagaveis).neq("status", "enviando").select("id");
    if (erroDelete) erros.push(`Não foi possível excluir: ${erroDelete.message}`);
    else {
      tentadas += apagaveis.length;
      const idsFeitos = ((feitas ?? []) as { id: string }[]).map((f) => f.id);
      apagadas = idsFeitos.length;
      mexidas.push(...idsFeitos);
    }
  }
  // Puladas: as que não foram mexidas sem erro do banco — em andamento (`enviando`) ou que sumiram nesse meio-tempo.
  const puladas = Math.max(0, tentadas - mexidas.length);
  if (mexidas.length) {
    revalidarGlobal(mexidas.map((id) => campanhaPorId.get(id)).filter((c): c is string => !!c));
    const partes: string[] = [];
    if (apagadas) partes.push(`${apagadas} execuç${apagadas === 1 ? "ão" : "ões"} excluída${apagadas === 1 ? "" : "s"}`);
    if (canceladas) partes.push(`${canceladas} execuç${canceladas === 1 ? "ão" : "ões"} de sequência/automação cancelada${canceladas === 1 ? "" : "s"} (excluir)`);
    await registrarHistorico(acesso.usuario, { acao: "remover", area: "Ações", resumo: partes.join("; ") });
  }
  return { apagadas, canceladas, puladas, erros };
}

/** Passo projetado (ainda sem execução): "executar agora" cria a execução já vencida. O único (campanha, passo)
 *  impede que a sequência crie outra depois. */
export async function executarPassoAgora(campanhaId: string, passoId: string) {
  const { usuario } = await exigirPermissao("campanhas", "editar");
  const db = dbAdmin();
  const { data: p, error } = await db.from("sequencia_passos").select("tipo, conteudo, importante").eq("id", passoId).single();
  if (error || !p) throw new Error("Passo não encontrado.");
  const { error: erroInsert } = await db.from("execucoes").insert({
    campanha_id: campanhaId, origem: "sequencia", passo_id: passoId, tipo: p.tipo, conteudo: p.conteudo, importante: p.importante, agendada_para: new Date().toISOString(),
  });
  if (erroInsert) throw new Error(erroInsert.code === "23505" ? "Esse passo já foi agendado." : `Não foi possível agendar: ${erroInsert.message}`);
  revalidar(campanhaId);
  await registrarHistorico(usuario, { acao: "executar", area: "Ações", resumo: "Passo da sequência antecipado para agora", refId: passoId });
}

/** Passo projetado: "cancelar" grava uma execução cancelada no lugar, e a sequência não cria mais esse passo. */
export async function cancelarPasso(campanhaId: string, passoId: string, quando: string) {
  const { usuario } = await exigirPermissao("campanhas", "editar");
  const db = dbAdmin();
  const { data: p, error } = await db.from("sequencia_passos").select("tipo, conteudo, importante").eq("id", passoId).single();
  if (error || !p) throw new Error("Passo não encontrado.");
  const { error: erroInsert } = await db.from("execucoes").insert({
    campanha_id: campanhaId, origem: "sequencia", passo_id: passoId, tipo: p.tipo, conteudo: p.conteudo, importante: p.importante, agendada_para: quando, status: "cancelada",
  });
  if (erroInsert) throw new Error(erroInsert.code === "23505" ? "Esse passo já foi agendado: cancele pela execução." : `Não foi possível cancelar: ${erroInsert.message}`);
  revalidar(campanhaId);
  await registrarHistorico(usuario, { acao: "remover", area: "Ações", resumo: "Passo da sequência cancelado", refId: passoId });
}
