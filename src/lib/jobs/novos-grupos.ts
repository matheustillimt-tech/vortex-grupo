import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { motivoNaoCriar, opcoesCriacao, type OpcoesCriacao } from "../regras/criacao-grupos";
import { precisaGrupoNovo } from "../regras/ocupacao";
import { dbAdmin } from "../supabase/admin";

const UMA_HORA_MS = 60 * 60_000;

export const MOTIVO_SEM_PRIMEIRO_GRUPO = "A campanha ainda não tem grupo: crie o primeiro na aba Grupos (depois a criação fica automática).";

/** Por que a criação AUTOMÁTICA de grupo desta campanha não deve acontecer agora ("Não criar grupos" ligado,
 *  campanha ainda sem nenhum grupo ou cliques da última hora no limite), ou null se pode. Só conta cliques quando há limite configurado. Se a contagem
 *  falhar, lança (quem chama decide: a fila tenta de novo, o link e a folga só não enfileiram). */
export async function motivoBloqueioCriacao(
  db: Pick<SupabaseClient, "from">,
  campanhaId: string,
  o: Pick<OpcoesCriacao, "nao_criar_grupos" | "limite_cliques_sem_criar">,
  agora: Date = new Date(),
): Promise<string | null> {
  if (o.nao_criar_grupos) return motivoNaoCriar(o, 0);
  // Regra (21/10/2026): o primeiro grupo é sempre manual (aba Grupos); só depois a criação fica automática.
  const { count: grupos, error: erroGrupos } = await db.from("grupos").select("id", { count: "exact", head: true }).eq("campanha_id", campanhaId);
  if (erroGrupos) throw new Error(`Não foi possível contar os grupos da campanha: ${erroGrupos.message}`);
  if (grupos === 0) return MOTIVO_SEM_PRIMEIRO_GRUPO;
  if (o.limite_cliques_sem_criar === null) return null;
  const { count, error } = await db
    .from("cliques")
    .select("id", { count: "exact", head: true })
    .eq("campanha_id", campanhaId)
    .gte("created_at", new Date(agora.getTime() - UMA_HORA_MS).toISOString());
  if (error) throw new Error(`Não foi possível contar os cliques da última hora: ${error.message}`);
  return motivoNaoCriar(o, count ?? 0);
}

export const MOTIVO_JA_TEM_VAGA = "A campanha já tem grupo com vaga: criação automática cancelada.";

/** Conferência na hora de criar (21/10/2026): a criação automática foi pedida quando faltava vaga, mas até a fila
 *  rodar alguém pode ter importado ou reativado grupos. Se já há `folga` grupos ativos com vaga, não cria. */
export async function motivoJaTemVaga(db: Pick<SupabaseClient, "from">, campanhaId: string, folga: number): Promise<string | null> {
  const { count, error } = await db.from("grupos").select("id", { count: "exact", head: true }).eq("campanha_id", campanhaId).eq("ativo", true).eq("cheio", false);
  if (error) throw new Error(`Não foi possível contar os grupos com vaga: ${error.message}`);
  return precisaGrupoNovo(count ?? 0, folga, false) ? null : MOTIVO_JA_TEM_VAGA;
}

/** Toda campanha ativa mantém `folga` grupos com vaga (a não ser que as travas de criação da campanha digam não). */
export async function garantirFolga(): Promise<number> {
  const db = dbAdmin();
  // campanhas → conexoes tem dois caminhos (conexao_criadora_id e campanha_conexoes): o embed precisa nomear a FK.
  const { data: campanhas, error } = await db
    .from("campanhas")
    .select("id, folga, nao_criar_grupos, limite_cliques_sem_criar, conexoes!campanhas_conexao_criadora_id_fkey(status)")
    .eq("arquivada", false)
    .not("conexao_criadora_id", "is", null);
  if (error) throw new Error(`Não foi possível ler as campanhas: ${error.message}`);
  let enfileiradas = 0;
  // Criadora caída não para a campanha: uma conexão associada conectada cria no lugar dela (`executarCriarGrupo`).
  const { data: assocVivas } = await db.from("campanha_conexoes").select("campanha_id, conexoes!inner(status)").eq("conexoes.status", "conectado");
  const comReservaViva = new Set(((assocVivas ?? []) as { campanha_id: string }[]).map((a) => a.campanha_id));
  for (const c of campanhas ?? []) {
    const criadora = c.conexoes as unknown as { status: string } | null;
    if (criadora?.status !== "conectado" && !comReservaViva.has(c.id)) continue;
    const [{ count: comVaga }, { count: naFila }] = await Promise.all([
      db.from("grupos").select("id", { count: "exact", head: true }).eq("campanha_id", c.id).eq("ativo", true).eq("cheio", false),
      db.from("acoes").select("id", { count: "exact", head: true }).eq("campanha_id", c.id).eq("tipo", "criar_grupo").in("status", ["fila", "processando", "erro"]),
    ]);
    if (precisaGrupoNovo(comVaga ?? 0, c.folga, (naFila ?? 0) > 0)) {
      try {
        if (await motivoBloqueioCriacao(db, c.id, opcoesCriacao(c))) continue;
      } catch (e) {
        console.error(`[folga] campanha ${c.id}: ${e instanceof Error ? e.message : e}`);
        continue;
      }
      const { error } = await db.from("acoes").insert({ tipo: "criar_grupo", campanha_id: c.id, origem: "folga" });
      if (!error) enfileiradas++;
    }
  }
  return enfileiradas;
}
