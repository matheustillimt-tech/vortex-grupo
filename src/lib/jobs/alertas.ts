import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dbAdmin } from "../supabase/admin";
import { carregarWebhooks, enfileirarEvento } from "../webhooks";

export type TipoAlerta = "grupo_cheio" | "numero_caiu" | "execucao_bloqueada" | "tarefa_erro" | "grupo_sumiu" | "criacao_erro" | "bloqueado_removido" | "antispam_sem_conta" | "entrega_nao_confirmada";

export type NovoAlerta = {
  tipo: TipoAlerta;
  texto: string;
  /** Campanha do alerta (aparece no Início com link). null = alerta geral (ex.: número caiu). */
  campanhaId: string | null;
  /** Outras campanhas cujo webhook de alertas também recebe o aviso (ex.: as que usam o número que caiu). */
  avisarCampanhas?: string[];
  /** Conta (conexão) envolvida, quando dá pra saber (ex.: o número que caiu). Usado pelo filtro/agrupamento
   *  "Conta" de `/alertas`; `undefined`/omitido = sem conta conhecida (o texto continua sendo o fallback). */
  conexaoId?: string | null;
};

/** Grava o alerta (Início) e enfileira o aviso no webhook de alertas de cada campanha envolvida que tiver um
 *  (legado, mesmas tentativas de hoje) e nos webhooks cadastrados de "alerta" que casarem. Nunca lança: alerta
 *  que falha não pode derrubar o fluxo que o gerou. */
export async function alertar(a: NovoAlerta, db: Pick<SupabaseClient, "from"> = dbAdmin()): Promise<void> {
  try {
    const { error } = await db.from("alertas").insert({ tipo: a.tipo, texto: a.texto, campanha_id: a.campanhaId, conexao_id: a.conexaoId ?? null });
    if (error) console.error(`[alerta] não foi possível gravar "${a.texto}": ${error.message}`);
    const ids = [...new Set([...(a.campanhaId ? [a.campanhaId] : []), ...(a.avisarCampanhas ?? [])])];
    // Carregado uma vez (evita reler a tabela a cada campanha envolvida nesta chamada).
    const webhooksCadastrados = await carregarWebhooks(db);
    if (!ids.length) {
      // Sem campanha envolvida: só webhooks cadastrados de "todas as campanhas" podem casar (nenhum legado).
      try {
        await enfileirarEvento(db, { evento: "alerta", campanhaId: null, dados: { tipo: a.tipo, texto: a.texto } }, webhooksCadastrados);
      } catch (e) {
        console.error(`[alerta] não foi possível enfileirar o webhook de alerta: ${e instanceof Error ? e.message : e}`);
      }
      return;
    }
    // Todas as campanhas envolvidas (com ou sem `alertas_webhook_url`): um webhook cadastrado restrito a uma
    // delas tem que casar mesmo que essa campanha não tenha (ou ainda não tenha) o webhook de alerta legado.
    const { data, error: erroCamp } = await db.from("campanhas").select("id, slug, nome, alertas_webhook_url").in("id", ids);
    if (erroCamp) {
      console.error(`[alerta] não foi possível ler as campanhas do alerta: ${erroCamp.message}`);
      return;
    }
    const em = new Date().toISOString();
    for (const c of (data ?? []) as { id: string; slug: string; nome: string; alertas_webhook_url: string | null }[]) {
      try {
        await enfileirarEvento(db, {
          evento: "alerta",
          campanhaId: c.id,
          dados: { tipo: a.tipo, texto: a.texto, campanha: c.slug, campanha_nome: c.nome },
          legado: c.alertas_webhook_url ? [{ url: c.alertas_webhook_url, payload: { evento: "alerta", tipo: a.tipo, texto: a.texto, campanha: c.slug, em } }] : [],
          // Só os webhooks cadastrados restritos a campanhas: os de "todas as campanhas" recebem um único
          // evento (abaixo), em vez de uma cópia por campanha envolvida neste alerta.
          apenas: "restritos",
        }, webhooksCadastrados);
      } catch (e) {
        console.error(`[alerta] não foi possível enfileirar o webhook de alerta: ${e instanceof Error ? e.message : e}`);
      }
    }
    // Um evento só (campanhaId null) pros webhooks cadastrados de "todas as campanhas", mesmo quando o alerta
    // envolve várias campanhas — sem isso cada campanha envolvida gerava uma cópia pro mesmo webhook de "todas".
    try {
      await enfileirarEvento(db, { evento: "alerta", campanhaId: null, dados: { tipo: a.tipo, texto: a.texto } }, webhooksCadastrados);
    } catch (e) {
      console.error(`[alerta] não foi possível enfileirar o webhook de alerta ("todas as campanhas"): ${e instanceof Error ? e.message : e}`);
    }
  } catch (e) {
    console.error("[alerta] erro inesperado", e);
  }
}
