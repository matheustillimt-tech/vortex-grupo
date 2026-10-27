import type { SupabaseClient } from "@supabase/supabase-js";
import { escaparBuscaIlike } from "@/src/lib/regras/busca";
import type { Aba } from "../_componentes/abas";

/** Abas do topo das telas de webhooks de saída. Os arquivados ficam em `/hooks/arquivadas`, aberto pelo botão
 *  "Arquivados" da lista (fora das abas). */
export const ABAS_HOOKS: Aba[] = [
  { href: "/hooks", rotulo: "Webhooks", exato: true },
  { href: "/hooks/historico", rotulo: "Histórico" },
];

/** Texto embaixo do título "Webhooks de saída". Os outros eventos saem na hora em que acontecem. */
export const TEXTO_HOOKS = "Os envios de métricas de campanha acontecem em 3 horários. 7h, 12h e 17h";

export type BaseHooks = "/hooks" | "/hooks/arquivadas";

export type OrdemWebhooks = "recentes" | "antigos";
export type FiltrosWebhooks = { q: string; ordem: OrdemWebhooks; pagina: number };

function primeiro(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/** Lê os parâmetros da URL; qualquer valor inválido vira o padrão. */
export function lerFiltrosWebhooks(sp: Record<string, string | string[] | undefined>): FiltrosWebhooks {
  const pagina = Number.parseInt(primeiro(sp.pagina), 10);
  const ordem = primeiro(sp.ordem);
  return {
    q: primeiro(sp.q).trim().slice(0, 80),
    ordem: ordem === "antigos" ? "antigos" : "recentes",
    pagina: Number.isFinite(pagina) && pagina > 0 ? pagina : 1,
  };
}

/** Mantido com este nome por compatibilidade: a implementação mora em `src/lib/regras/busca.ts`, compartilhada
 *  com outras telas (ex.: `/historico`) que também buscam por `.or(...)` do PostgREST. */
export const escaparBuscaWebhook = escaparBuscaIlike;

/** Endereço da lista (Integrações ou Arquivadas) com os filtros atuais + `mudar`. Mudar qualquer filtro volta pra página 1. */
export function urlWebhooks(base: BaseHooks, atual: FiltrosWebhooks, mudar: Partial<FiltrosWebhooks>): string {
  const f = { ...atual, ...mudar };
  if (!("pagina" in mudar)) f.pagina = 1;
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.ordem !== "recentes") p.set("ordem", f.ordem);
  if (f.pagina > 1) p.set("pagina", String(f.pagina));
  const s = p.toString();
  return `${base}${s ? `?${s}` : ""}`;
}

export type WebhookLinha = {
  id: string;
  created_at: string;
  nome: string;
  url: string;
  eventos: string[];
  campanhas: string[] | null;
  ativo: boolean;
  arquivado: boolean;
};

export type EntregaLinha = {
  id: string;
  webhook_id: string | null;
  created_at: string;
  status: string;
  tentativas: number;
  erro: string | null;
};

/** Uma entrega da aba Histórico (todas as linhas de `eventos_saida`, de qualquer webhook). */
export type EntregaHistorico = {
  id: string;
  created_at: string;
  status: string;
  tentativas: number;
  erro: string | null;
  url: string;
  evento: string | null;
  webhook_id: string | null;
  webhooks: { nome: string } | null;
};

export type CampanhaOpcao = { id: string; nome: string };

type DB = Pick<SupabaseClient, "from">;

/** Últimas `porWebhook` entregas de cada webhook da página, numa única consulta (ordenada por `created_at desc`
 *  e limitada a `porWebhook * ids.length` linhas, agrupada aqui em memória) — não faz uma consulta por webhook. */
export async function carregarEntregas(db: DB, ids: string[], porWebhook = 5): Promise<Record<string, EntregaLinha[]>> {
  const porId: Record<string, EntregaLinha[]> = {};
  if (!ids.length) return porId;
  const { data, error } = await db
    .from("eventos_saida")
    .select("id, webhook_id, created_at, status, tentativas, erro")
    .in("webhook_id", ids)
    .order("created_at", { ascending: false })
    .limit(porWebhook * ids.length);
  if (error) {
    console.error(`[webhooks] não foi possível carregar as entregas: ${error.message}`);
    return porId;
  }
  for (const linha of (data ?? []) as EntregaLinha[]) {
    if (!linha.webhook_id) continue;
    const lista = porId[linha.webhook_id] ?? (porId[linha.webhook_id] = []);
    if (lista.length < porWebhook) lista.push(linha);
  }
  return porId;
}
