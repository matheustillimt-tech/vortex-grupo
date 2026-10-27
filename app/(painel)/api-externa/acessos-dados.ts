import "server-only";
import { dbAdmin } from "@/src/lib/supabase/admin";
import type { EscopoApi } from "@/src/lib/api/chaves";
import type { AcessoLinha, MeuAcessoLinha, StatusAcessoLinha } from "./comum";

/** Leituras dos "Acessos de atendentes" (Etapa 3K, Tarefa 7). `api_acessos` só é lida pelo servidor (service role):
 *  quem chama já conferiu quem pode ver (Administrador pra lista toda; o próprio usuário pros dele). */

type LinhaAcesso = { id: string; created_at: string; chave_id: string; solicitante: string; motivo: string | null; status: StatusAcessoLinha; chave_emitida_id: string | null };

/** Lista do Administrador: atendente (nome em Equipe, senão o e-mail), contato (e-mail), chave, motivo, data e situação. */
export async function carregarAcessosAdmin(): Promise<AcessoLinha[]> {
  const db = dbAdmin();
  const { data, error } = await db
    .from("api_acessos")
    .select("id, created_at, chave_id, solicitante, motivo, status, chave_emitida_id")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(`Não foi possível carregar os acessos: ${error.message}`);
  const linhas = (data ?? []) as LinhaAcesso[];
  if (!linhas.length) return [];
  const chaveIds = [...new Set(linhas.map((l) => l.chave_id))];
  const pessoas = [...new Set(linhas.map((l) => l.solicitante))];
  const [chaves, membros, usuarios] = await Promise.all([
    db.from("api_chaves").select("id, nome").in("id", chaveIds),
    db.from("membros").select("usuario_id, nome").in("usuario_id", pessoas),
    db.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);
  const nomeChave = new Map(((chaves.data ?? []) as { id: string; nome: string }[]).map((c) => [c.id, c.nome]));
  const nomeMembro = new Map(((membros.data ?? []) as { usuario_id: string; nome: string }[]).map((m) => [m.usuario_id, m.nome]));
  const email = new Map((usuarios.data?.users ?? []).map((u) => [u.id, u.email ?? ""]));
  return linhas.map((l) => {
    const contato = email.get(l.solicitante) ?? "";
    return {
      id: l.id,
      created_at: l.created_at,
      atendente: nomeMembro.get(l.solicitante)?.trim() || contato || "Membro removido",
      contato,
      chave: nomeChave.get(l.chave_id) ?? "—",
      motivo: l.motivo,
      status: l.status,
    };
  });
}

/** "Meus acessos": os pedidos do próprio usuário, com o prefixo da chave dele que está valendo (se já gerou). */
export async function carregarMeusAcessos(usuarioId: string): Promise<MeuAcessoLinha[]> {
  const db = dbAdmin();
  const { data, error } = await db
    .from("api_acessos")
    .select("id, created_at, chave_id, solicitante, motivo, status, chave_emitida_id")
    .eq("solicitante", usuarioId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(`Não foi possível carregar seus acessos: ${error.message}`);
  const linhas = (data ?? []) as LinhaAcesso[];
  if (!linhas.length) return [];
  const ids = [...new Set(linhas.flatMap((l) => (l.chave_emitida_id ? [l.chave_id, l.chave_emitida_id] : [l.chave_id])))];
  const { data: chaves, error: e2 } = await db.from("api_chaves").select("id, nome, escopo, prefixo, revogada_em").in("id", ids);
  if (e2) throw new Error(`Não foi possível carregar seus acessos: ${e2.message}`);
  const porId = new Map(((chaves ?? []) as { id: string; nome: string; escopo: EscopoApi; prefixo: string; revogada_em: string | null }[]).map((c) => [c.id, c]));
  return linhas.map((l) => {
    const mae = porId.get(l.chave_id);
    const filha = l.chave_emitida_id ? porId.get(l.chave_emitida_id) : undefined;
    return {
      id: l.id,
      created_at: l.created_at,
      chave: mae?.nome ?? "—",
      escopo: mae?.escopo ?? "leitura",
      status: l.status,
      chaveRevogada: !mae || Boolean(mae.revogada_em),
      prefixo: filha && !filha.revogada_em ? filha.prefixo : null,
    };
  });
}
