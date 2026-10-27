import "server-only";
import { assinatura } from "../webhooks-assinatura";
import { dbAdmin } from "../supabase/admin";
import { restante, type Prazo } from "./tipos";

const ESPERAS_MIN = [1, 5, 15, 60, 240];

/** `tentativas` já conta a que acabou de falhar. */
export function proximaTentativaMs(tentativas: number): number | null {
  const min = ESPERAS_MIN[tentativas - 1];
  return min === undefined ? null : min * 60_000;
}

export async function processarEventos(prazo: Prazo): Promise<number> {
  const db = dbAdmin();
  const { data, error } = await db.rpc("pegar_eventos", { limite: 50 });
  if (error) throw new Error(`Não foi possível buscar os eventos pendentes: ${error.message}`);
  const eventos = (data ?? []) as { id: string; url: string; payload: unknown; tentativas: number; webhook_id: string | null; de_webhook?: boolean }[];
  // Segredos dos webhooks cadastrados envolvidos neste lote, numa consulta só (em vez de uma por evento). Evento
  // com `webhook_id` mas sem segredo encontrado (ex.: leitura falhou) segue como legado, sem assinatura.
  const idsWebhook = [...new Set(eventos.filter((e) => e.webhook_id).map((e) => e.webhook_id as string))];
  const segredos = new Map<string, string>();
  // token (Etapa 3K): coluna própria, opcional. Webhook sem ela (todos os de antes) não ganha cabeçalho novo.
  const tokens = new Map<string, string>();
  if (idsWebhook.length) {
    const { data: ws, error: erroSegredos } = await db.from("webhooks").select("id, segredo, token").in("id", idsWebhook);
    if (erroSegredos) console.error(`Não foi possível ler o segredo dos webhooks: ${erroSegredos.message}`);
    else
      for (const w of (ws ?? []) as { id: string; segredo: string; token?: string | null }[]) {
        segredos.set(w.id, w.segredo);
        if (w.token) tokens.set(w.id, w.token);
      }
  }
  for (const e of eventos) {
    // Linha de um webhook cadastrado cujo `webhook_id` já foi zerado (a FK `on delete set null`, quando o
    // webhook foi excluído entre o enfileiramento e esta rodada): não é legado de verdade, não pode ser
    // entregue sem assinatura pro endereço de um webhook que já não existe mais.
    if (e.de_webhook && e.webhook_id === null) {
      const { error: erroExcluido } = await db.from("eventos_saida").update({ status: "erro", erro: "Webhook excluído." }).eq("id", e.id);
      if (erroExcluido) console.error(`Evento ${e.id} (webhook excluído) não pôde ser marcado como erro: ${erroExcluido.message}`);
      continue;
    }
    // O POST tem timeout de 10 s: só começa se ainda sobra folga no prazo do tick.
    if (restante(prazo) <= 12_000) {
      const { error: erroFila } = await db.from("eventos_saida").update({ status: "fila" }).eq("id", e.id);
      if (erroFila) console.error(`Evento ${e.id} não pôde voltar pra fila (sem tempo no lote): ${erroFila.message}`);
      continue;
    }
    try {
      const corpo = JSON.stringify(e.payload);
      const segredo = e.webhook_id ? segredos.get(e.webhook_id) : undefined;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      // Webhook excluído: a FK zera `webhook_id` (on delete set null) — a linha segue como legado, sem assinatura.
      if (segredo) headers["X-Vortex-Grupo-Assinatura"] = `sha256=${assinatura(segredo, corpo)}`;
      // token: token próprio pra quem só compara um valor; nunca o segredo do HMAC.
      const token = e.webhook_id ? tokens.get(e.webhook_id) : undefined;
      if (token) headers["X-Vortex-Grupo-Token"] = token;
      const r = await fetch(e.url, { method: "POST", headers, body: corpo, signal: AbortSignal.timeout(10_000), redirect: "manual" });
      if (r.status >= 200 && r.status < 300) {
        const { error: erroOk } = await db.from("eventos_saida").update({ status: "ok", erro: null }).eq("id", e.id);
        if (erroOk) console.error(`Evento ${e.id} entregue mas não foi possível marcar como ok: ${erroOk.message}`);
        continue;
      }
      throw new Error(`HTTP ${r.status}`);
    } catch (err) {
      const espera = proximaTentativaMs(e.tentativas);
      const { error: erroStatus } = await db.from("eventos_saida").update({
        status: espera === null ? "erro" : "fila",
        erro: err instanceof Error ? err.message : String(err),
        proxima_tentativa: new Date(Date.now() + (espera ?? 0)).toISOString(),
      }).eq("id", e.id);
      if (erroStatus) console.error(`Evento ${e.id} falhou e não foi possível atualizar o status: ${erroStatus.message}`);
    }
  }
  return eventos.length;
}
