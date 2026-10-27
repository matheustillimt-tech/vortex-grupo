import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Colunas de trava de `conexoes` (botões "Atualizar" e "Escanear" da aba Grupos do detalhe da conta). */
export type ColunaTravaConta = "grupos_atualizados_em" | "grupos_escaneados_em";

/** Trava atômica de "1 pedido a cada `ms`" numa conta: um único update condicional (só grava se a coluna está nula
 *  ou mais velha que `ms`). Dois cliques ao mesmo tempo: só um ganha. Devolve o instante gravado (`em`) pra `soltarTravaConta`
 *  poder desfazer se a chamada ao Zapbot falhar. */
export async function pegarTravaConta(
  db: Pick<SupabaseClient, "from">,
  e: { conexaoId: string; coluna: ColunaTravaConta; ms: number },
  agora = new Date(),
): Promise<{ ok: true; em: string } | { ok: false; motivo: "ocupada" | "erro" }> {
  const em = agora.toISOString();
  const limite = new Date(agora.getTime() - e.ms).toISOString();
  const { data, error } = await db
    .from("conexoes")
    .update({ [e.coluna]: em })
    .eq("id", e.conexaoId)
    .or(`${e.coluna}.is.null,${e.coluna}.lte.${limite}`)
    .select("id");
  if (error) return { ok: false, motivo: "erro" };
  if (!(data as unknown[] | null)?.length) return { ok: false, motivo: "ocupada" };
  return { ok: true, em };
}

/** Desfaz a trava (volta ao valor anterior) só se ninguém pegou outra depois. Erro aqui é ignorado: no pior caso a
 *  pessoa espera os 2 minutos. */
export async function soltarTravaConta(
  db: Pick<SupabaseClient, "from">,
  e: { conexaoId: string; coluna: ColunaTravaConta; em: string; anterior: string | null },
): Promise<void> {
  try {
    await db.from("conexoes").update({ [e.coluna]: e.anterior }).eq("id", e.conexaoId).eq(e.coluna, e.em);
  } catch {
    // ignora
  }
}
