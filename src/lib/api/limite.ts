import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** No máximo 60 chamadas por minuto por chave (contador no banco, `api_registrar_uso`). */
export const LIMITE_POR_MINUTO = 60;

/** Soma a chamada e diz se passou do limite. Erro do banco → `indisponivel` (fecha: sem contador, sem chamada). */
export async function registrarUso(db: Pick<SupabaseClient, "rpc">, chaveId: string): Promise<"ok" | "limite" | "indisponivel"> {
  const { data, error } = await db.rpc("api_registrar_uso", { p_chave: chaveId });
  if (error) return "indisponivel";
  return Number(data) > LIMITE_POR_MINUTO ? "limite" : "ok";
}
