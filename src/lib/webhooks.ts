import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { webhooksQueCasam, type Evento, type WebhookCadastrado } from "./regras/webhooks";
import { dbAdmin } from "./supabase/admin";

type DB = Pick<SupabaseClient, "from">;

/** Webhook cadastrado com a URL (além do que `webhooksQueCasam` usa pra decidir o casamento). */
export type WebhookComUrl = WebhookCadastrado & { url: string };

/** Endereço legado (CRM/alertas de uma campanha): o payload já vem pronto, byte a byte idêntico ao de hoje —
 *  `enfileirarEvento` não o reconstrói, só o insere. */
export type EventoLegado = { url: string; payload: Record<string, unknown> };

export type NovoEventoSaida = {
  evento: Evento;
  campanhaId: string | null;
  /** Campos extras do payload novo (pros webhooks cadastrados). `evento` e `em` são preenchidos aqui. */
  dados: Record<string, unknown>;
  legado?: EventoLegado[];
  /** Chave de idempotência (ex.: "compra:<venda id>") — só vai nas linhas dos webhooks cadastrados (nunca nas
   *  legadas: não há pra elas um identificador do evento de origem que valha reusar como chave). Repetir a
   *  mesma chave pro mesmo webhook não duplica a linha (upsert com `ignoreDuplicates`, índice único
   *  `(webhook_id, chave)` — NULL nunca conflita, então eventos sem chave seguem como insert simples). */
  chave?: string;
  /** Restringe quais webhooks cadastrados casam: "restritos" só os com `campanhas` definido (nunca os de "todas
   *  as campanhas"); "todas" só os de "todas as campanhas". Serve pra quem enfileira o mesmo evento uma vez por
   *  campanha envolvida sem mandar uma cópia por campanha pros webhooks de "todas" (ver `alertar`). Sem isso,
   *  casamento normal (default do `webhooksQueCasam`). */
  apenas?: "restritos" | "todas";
};

/** Toda linha leva as mesmas colunas: num insert em lote o supabase-js manda NULL (e não o default) pra coluna
 *  que falta em alguma linha, o que quebraria `de_webhook not null` ao misturar legadas e cadastradas. */
type LinhaEventoSaida = {
  campanha_id: string | null;
  webhook_id: string | null;
  de_webhook: boolean;
  chave: string | null;
  url: string;
  payload: Record<string, unknown>;
};

/** Webhooks cadastrados, com a URL, pra casar e montar o `eventos_saida` (service role). `null` se a leitura
 *  falhar: uma falha aqui não pode travar o enfileiramento dos endereços legados (CRM/alertas das campanhas). */
export async function carregarWebhooks(db: DB = dbAdmin()): Promise<WebhookComUrl[] | null> {
  const { data, error } = await db.from("webhooks").select("id, url, eventos, campanhas, ativo, arquivado");
  if (error) {
    console.error(`[webhooks] não foi possível ler os webhooks cadastrados: ${error.message}`);
    return null;
  }
  return (data ?? []) as WebhookComUrl[];
}

/** Monta e insere em lote os `eventos_saida` de vários eventos de uma vez (ex.: todo entrou/saiu apurado num
 *  grupo na mesma rodada): um por webhook cadastrado que casa com cada evento (com `webhook_id`, payload no
 *  formato novo — `{ evento, ...dados, em }`), mais os endereços legados informados em cada um (payload de
 *  hoje, inalterado). Os webhooks são lidos uma vez só (não por evento). Linhas com `chave` vão num único
 *  `upsert` (idempotente, ignora duplicata); o resto (legadas e sem chave) num único `insert` — no máximo duas
 *  idas ao banco pra chamada inteira, não uma por evento. `webhooksPreCarregados` evita reler a tabela
 *  `webhooks` de novo (ex.: várias chamadas no mesmo tick do cron) — passe o resultado de `carregarWebhooks`.
 *  Lança só se alguma das duas escritas falhar; o chamador decide o que fazer. */
export async function enfileirarEventos(db: DB, eventos: NovoEventoSaida[], webhooksPreCarregados?: WebhookComUrl[] | null): Promise<void> {
  if (!eventos.length) return;
  const em = new Date().toISOString();
  const webhooks = webhooksPreCarregados !== undefined ? webhooksPreCarregados : await carregarWebhooks(db);
  const linhas: LinhaEventoSaida[] = [];
  for (const e of eventos) {
    const casados = webhooks ? (webhooksQueCasam(webhooks, e.evento, e.campanhaId, e.apenas) as WebhookComUrl[]) : [];
    for (const w of casados) {
      linhas.push({ campanha_id: e.campanhaId, webhook_id: w.id, de_webhook: true, chave: e.chave ?? null, url: w.url, payload: { evento: e.evento, ...e.dados, em } });
    }
    for (const l of e.legado ?? []) linhas.push({ campanha_id: e.campanhaId, webhook_id: null, de_webhook: false, chave: null, url: l.url, payload: l.payload });
  }
  if (!linhas.length) return;
  const comChave = linhas.filter((l) => l.chave !== null);
  const semChave = linhas.filter((l) => l.chave === null);
  if (comChave.length) {
    const { error } = await db.from("eventos_saida").upsert(comChave, { onConflict: "webhook_id,chave", ignoreDuplicates: true });
    if (error) throw new Error(`Não foi possível enfileirar os eventos (upsert por chave): ${error.message}`);
  }
  if (semChave.length) {
    const { error } = await db.from("eventos_saida").insert(semChave);
    if (error) throw new Error(`Não foi possível enfileirar os eventos: ${error.message}`);
  }
}

/** Mesma coisa que `enfileirarEventos`, pra um evento só. */
export async function enfileirarEvento(db: DB, e: NovoEventoSaida, webhooksPreCarregados?: WebhookComUrl[] | null): Promise<void> {
  return enfileirarEventos(db, [e], webhooksPreCarregados);
}

/** Enfileira sem nunca lançar (Etapa 3K, Tarefa 5): os pontos novos de emissão moram dentro de jobs e rotas que não
 *  podem cair por causa de um Hook. Falha vira log. */
export async function emitirSemFalhar(db: DB, eventos: NovoEventoSaida[], webhooksPreCarregados?: WebhookComUrl[] | null): Promise<void> {
  if (!eventos.length) return;
  try {
    await enfileirarEventos(db, eventos, webhooksPreCarregados);
  } catch (e) {
    console.error(`[hooks] não foi possível enfileirar ${eventos.map((x) => x.evento).join(", ")}: ${e instanceof Error ? e.message : e}`);
  }
}

/** Junta os eventos de uma rodada de um job e enfileira tudo de uma vez no fim (`enviar`): uma leitura de
 *  `webhooks` (só se houver evento) e no máximo duas escritas pra rodada inteira. `enviar` nunca lança e pode ser
 *  chamado mais de uma vez (só manda o que chegou depois). */
export type Emissor = { adicionar: (...eventos: NovoEventoSaida[]) => void; enviar: () => Promise<void> };

export function criarEmissor(db: DB, webhooksPreCarregados?: WebhookComUrl[] | null): Emissor {
  let pendentes: NovoEventoSaida[] = [];
  let webhooks: WebhookComUrl[] | null | undefined = webhooksPreCarregados;
  return {
    adicionar: (...eventos) => {
      pendentes.push(...eventos);
    },
    enviar: async () => {
      if (!pendentes.length) return;
      const lote = pendentes;
      pendentes = [];
      try {
        if (webhooks === undefined) webhooks = await carregarWebhooks(db);
      } catch (e) {
        console.error(`[hooks] não foi possível ler os webhooks: ${e instanceof Error ? e.message : e}`);
        return;
      }
      // Sem webhook cadastrado (ou leitura falhou) e sem legado nos eventos novos: nada a gravar.
      if (!webhooks?.length && !lote.some((e) => e.legado?.length)) return;
      await emitirSemFalhar(db, lote, webhooks);
    },
  };
}
