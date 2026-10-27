import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MAXIMO_ITENS_ACAO } from "@/src/lib/regras/assistente-acao";

type DB = Pick<SupabaseClient, "from">;

export type ContaDaCampanha = { id: string; nome: string; telefone: string | null; status: string };

/** Contas de uma campanha pro assistente "Adicionar ação": as associadas (`campanha_conexoes`), a criadora e as
 *  donas dos grupos ativos (a execução filtra os grupos por `conexao_id`, então quem tem grupo na campanha conta
 *  mesmo se saiu da associação). Leituras limitadas a 1000. Lança se o banco falhar. */
export async function contasDaCampanha(db: DB, campanhaId: string): Promise<ContaDaCampanha[]> {
  const [associadas, campanha, grupos] = await Promise.all([
    db.from("campanha_conexoes").select("conexao_id").eq("campanha_id", campanhaId).limit(MAXIMO_ITENS_ACAO),
    db.from("campanhas").select("conexao_criadora_id").eq("id", campanhaId).maybeSingle(),
    db.from("grupos").select("conexao_id").eq("campanha_id", campanhaId).eq("ativo", true).limit(MAXIMO_ITENS_ACAO),
  ]);
  if (associadas.error || campanha.error || grupos.error) throw new Error("Não foi possível carregar as conexões da campanha.");
  const ids = new Set<string>();
  for (const l of (associadas.data ?? []) as { conexao_id: string }[]) ids.add(l.conexao_id);
  const criadora = (campanha.data as { conexao_criadora_id: string | null } | null)?.conexao_criadora_id;
  if (criadora) ids.add(criadora);
  for (const l of (grupos.data ?? []) as { conexao_id: string }[]) ids.add(l.conexao_id);
  if (!ids.size) return [];
  const { data, error } = await db.from("conexoes").select("id, nome, telefone, status").in("id", [...ids]).order("nome").limit(MAXIMO_ITENS_ACAO);
  if (error) throw new Error("Não foi possível carregar as conexões da campanha.");
  return (data ?? []) as ContaDaCampanha[];
}
