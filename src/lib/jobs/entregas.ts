import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dataHoraCurta } from "../regras/abas-mensagens";
import { textoAlertaEntrega } from "../regras/entregas";
import { dbAdmin } from "../supabase/admin";
import { alertar } from "./alertas";
import { restante, type Prazo } from "./tipos";

/** Tarefas conferidas por chamada (execuções inteiras; ver `conferir_entregas`). */
export const LIMITE_CONFERIR_ENTREGAS = 500;

type Linha = { execucao_id: string; campanha_id: string; nao_confirmadas: number };

/** Passo `entregas` do tick (Confirmação de entrega): o banco marca cada tarefa enviada há 30 min nas campanhas com a
 *  seção ligada e devolve as execuções com grupo sem confirmação, cada uma no máximo uma vez na vida
 *  (`execucoes.entrega_alertada`). Um alerta `entrega_nao_confirmada` por execução. Campanha sem a seção ligada
 *  nunca aparece (o filtro é no banco). */
export async function conferirEntregas(prazo: Prazo, db: Pick<SupabaseClient, "from" | "rpc"> = dbAdmin()): Promise<number> {
  if (restante(prazo) < 5_000) return 0;
  const { data, error } = await db.rpc("conferir_entregas", { p_limite: LIMITE_CONFERIR_ENTREGAS });
  if (error) throw new Error(`Não foi possível conferir as entregas: ${error.message}`);
  const linhas = (data ?? []) as Linha[];
  if (!linhas.length) return 0;

  // Nomes e datas em duas leituras (não uma por execução). Falha aqui não perde o alerta: sai com o que tiver.
  const execIds = [...new Set(linhas.map((l) => l.execucao_id))];
  const campIds = [...new Set(linhas.map((l) => l.campanha_id))];
  const [execs, camps] = await Promise.all([
    db.from("execucoes").select("id, agendada_para").in("id", execIds),
    db.from("campanhas").select("id, nome").in("id", campIds),
  ]);
  if (execs.error) console.error(`[entregas] não foi possível ler as execuções: ${execs.error.message}`);
  if (camps.error) console.error(`[entregas] não foi possível ler as campanhas: ${camps.error.message}`);
  const quando = new Map(((execs.data ?? []) as { id: string; agendada_para: string }[]).map((e) => [e.id, e.agendada_para]));
  const nomes = new Map(((camps.data ?? []) as { id: string; nome: string }[]).map((c) => [c.id, c.nome]));

  for (const l of linhas) {
    const iso = quando.get(l.execucao_id);
    // `alertar` nunca lança: um alerta que falha não impede os outros.
    await alertar({
      tipo: "entrega_nao_confirmada",
      texto: textoAlertaEntrega(l.nao_confirmadas, iso ? dataHoraCurta(iso) : "data desconhecida", nomes.get(l.campanha_id) ?? "sem nome"),
      campanhaId: l.campanha_id,
    }, db);
  }
  return linhas.length;
}
