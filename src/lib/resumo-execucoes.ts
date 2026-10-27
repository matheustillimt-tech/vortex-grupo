import type { SupabaseClient } from "@supabase/supabase-js";

export type ResumoExecucao = { total: number; feitas: number; erros: number; pendentes: number; entregues: number; lidos: number };

/** Placar das execuções agregado no banco (`resumo_execucoes`), por id. */
export async function resumoDasExecucoes(db: Pick<SupabaseClient, "rpc">, ids: string[]): Promise<Map<string, ResumoExecucao>> {
  if (!ids.length) return new Map();
  const { data, error } = await db.rpc("resumo_execucoes", { p_ids: ids });
  if (error) throw new Error(`Não foi possível carregar o andamento: ${error.message}`);
  return new Map(
    ((data ?? []) as (Record<keyof ResumoExecucao, number | string> & { execucao_id: string })[]).map((l) => [
      l.execucao_id,
      { total: Number(l.total), feitas: Number(l.feitas), erros: Number(l.erros), pendentes: Number(l.pendentes), entregues: Number(l.entregues), lidos: Number(l.lidos) },
    ]),
  );
}
