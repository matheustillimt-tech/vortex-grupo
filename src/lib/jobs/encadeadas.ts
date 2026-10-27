import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decidirEncadeada, type StatusAnterior } from "../regras/encadeadas";
import { dbAdmin } from "../supabase/admin";

type DB = Pick<SupabaseClient, "from">;

/** Quantas encadeadas o passo olha por tick (cada uma espera uma anterior; o resto fica pro minuto seguinte). */
const LIMITE_POR_TICK = 500;
const TAMANHO_LOTE_IN = 150;

/**
 * Passo `encadeadas` do tick (antes de `execucoes`), "Adicionar outra ação" (Etapa 3J, Tarefa 5). Pra cada execução
 * `agendada` com `depois_de` (a anterior da corrente), lê a anterior e decide (`decidirEncadeada`):
 *  - concluída sem tarefa pendente → solta (`depois_de = null`) e marca pra daqui a 30 s; o `iniciarExecucoesVencidas`
 *    pega no próximo tick, como qualquer outra;
 *  - cancelada, bloqueada ou pulada → a seguinte vira cancelada (a dela, por sua vez, na próxima volta);
 *  - agendada ou enviando → espera.
 * Cada `update` só vale se a linha ainda está `agendada` e ainda aponta pra mesma anterior: dois ticks juntos não
 * soltam (nem cancelam) duas vezes e nunca mexem numa que já começou. Devolve quantas soltou ou cancelou.
 */
export async function liberarEncadeadas(agora: Date = new Date(), db: DB = dbAdmin()): Promise<number> {
  const { data, error } = await db
    .from("execucoes")
    .select("id, depois_de, agendada_para")
    .eq("status", "agendada")
    .not("depois_de", "is", null)
    .order("agendada_para")
    .limit(LIMITE_POR_TICK);
  if (error) throw new Error(`Não foi possível ler as ações encadeadas: ${error.message}`);
  const esperando = (data ?? []) as { id: string; depois_de: string; agendada_para: string }[];
  if (!esperando.length) return 0;

  const anteriores = [...new Set(esperando.map((e) => e.depois_de))];
  const status = new Map<string, StatusAnterior>();
  for (let i = 0; i < anteriores.length; i += TAMANHO_LOTE_IN) {
    const lote = anteriores.slice(i, i + TAMANHO_LOTE_IN);
    const { data: linhas, error: erroAnt } = await db.from("execucoes").select("id, status").in("id", lote);
    if (erroAnt) throw new Error(`Não foi possível ler as ações anteriores: ${erroAnt.message}`);
    for (const l of (linhas ?? []) as { id: string; status: StatusAnterior }[]) status.set(l.id, l.status);
  }

  // "Concluída" só solta sem tarefa ainda na fila ou processando (o "terminou de vez"). Uma consulta pras concluídas.
  const concluidas = anteriores.filter((id) => status.get(id) === "concluida");
  const comPendentes = new Set<string>();
  for (let i = 0; i < concluidas.length; i += TAMANHO_LOTE_IN) {
    const lote = concluidas.slice(i, i + TAMANHO_LOTE_IN);
    const { data: pend, error: erroPend } = await db.from("tarefas").select("execucao_id").in("execucao_id", lote).in("status", ["fila", "processando"]);
    if (erroPend) throw new Error(`Não foi possível conferir as tarefas das ações anteriores: ${erroPend.message}`);
    for (const t of (pend ?? []) as { execucao_id: string }[]) comPendentes.add(t.execucao_id);
  }

  let mexidas = 0;
  const erros: string[] = [];
  for (const e of esperando) {
    const d = decidirEncadeada({ statusAnterior: status.get(e.depois_de) ?? null, anteriorComPendentes: comPendentes.has(e.depois_de), agendadaPara: e.agendada_para }, agora);
    if (d.tipo === "esperar") continue;
    const mudanca = d.tipo === "liberar" ? { depois_de: null, agendada_para: d.agendadaPara } : { status: "cancelada", motivo: d.motivo };
    const { data: mudou, error: erroMudar } = await db
      .from("execucoes")
      .update(mudanca)
      .eq("id", e.id)
      .eq("status", "agendada")
      .eq("depois_de", e.depois_de)
      .select("id");
    if (erroMudar) erros.push(`execução ${e.id}: ${erroMudar.message}`);
    else if (mudou?.length) mexidas++;
  }
  if (erros.length) throw new Error(`Falha ao soltar ações encadeadas: ${erros.join("; ")}`);
  return mexidas;
}

/** Cancela, junto com as execuções `ids`, as seguintes delas ainda `agendada` (e as seguintes dessas, até 4 níveis =
 *  5 ações por disparo). Usado por "Cancelar" (individual, em lote, global) e por "Excluir". Devolve os ids
 *  cancelados aqui (sem os de `ids`). */
export async function cancelarSeguintes(ids: string[], motivo: string, db: DB = dbAdmin()): Promise<string[]> {
  const canceladas: string[] = [];
  let nivel = ids;
  for (let i = 0; i < 4 && nivel.length; i++) {
    const { data, error } = await db.from("execucoes").update({ status: "cancelada", motivo }).in("depois_de", nivel).eq("status", "agendada").select("id");
    if (error) throw new Error(`Não foi possível cancelar as ações seguintes: ${error.message}`);
    nivel = ((data ?? []) as { id: string }[]).map((l) => l.id);
    canceladas.push(...nivel);
  }
  return canceladas;
}
