import { PROVEDORES, type Provedor } from "../checkout/parsers";

/** Webhooks de checkout (entrada), Etapa 3H.2. Cada integração tem nome,
 *  plataforma e um segredo próprio, que forma o link colado no checkout. Funções puras (testadas). */

/** Opções do campo "Plataforma" da janela "Criar webhook", na ordem e com os nomes de mercado, só as que o
 *  Vórtex Grupo recebe (as que têm parser em `src/lib/checkout/parsers.ts`). */
export const PLATAFORMAS_INTEGRACAO: { valor: Provedor; rotulo: string }[] = [
  { valor: "hotmart", rotulo: "Hotmart" },
  { valor: "kiwify", rotulo: "Kiwify" },
  { valor: "pagarme", rotulo: "Pagar.me" },
  { valor: "vortex", rotulo: "Checkout próprio" },
];

/** Nome da plataforma nos cartões e no detalhe. */
export const ROTULO_PLATAFORMA: Record<Provedor, string> = { hotmart: "Hotmart", kiwify: "Kiwify", pagarme: "Pagar.me", vortex: "Checkout próprio" };

export function ehPlataforma(v: unknown): v is Provedor {
  return typeof v === "string" && (PROVEDORES as readonly string[]).includes(v);
}

export type EntradaIntegracao = { nome: unknown; plataforma: unknown };

export function validarIntegracao(e: EntradaIntegracao): { ok: true; valor: { nome: string; plataforma: Provedor } } | { ok: false; erro: string } {
  const nome = typeof e.nome === "string" ? e.nome.trim() : "";
  if (!nome) return { ok: false, erro: "Dê um nome ao webhook." };
  if (nome.length > 60) return { ok: false, erro: "O nome pode ter no máximo 60 caracteres." };
  if (!ehPlataforma(e.plataforma)) return { ok: false, erro: "Escolha a plataforma." };
  return { ok: true, valor: { nome, plataforma: e.plataforma } };
}

/** Link que se cola no checkout. É a mesma rota de antes da Etapa 3H (`/api/webhooks/checkout/{plataforma}/{segredo}`). */
export function linkIntegracao(site: string, plataforma: Provedor, segredo: string): string {
  return `${site.replace(/\/+$/, "")}/api/webhooks/checkout/${plataforma}/${segredo}`;
}

/** Onde colar o link em cada plataforma (o evento que importa é o de compra aprovada). */
export const ONDE_CONFIGURAR: Record<Provedor, string> = {
  hotmart: "Hotmart › Ferramentas › Webhook (API e notificações) › evento Compra aprovada",
  kiwify: "Kiwify › Apps › Webhooks › evento Compra aprovada",
  pagarme: "Pagar.me › Configurações › Webhooks › evento order.paid",
  vortex: 'seu sistema de vendas faz um POST no link com o JSON {"evento_id": "...", "status": "aprovado", "telefone": "...", "produto": "..."}',
};

/** As regras do bloco "Importante" da Visão geral do webhook. */
export function regrasImportantes(plataforma: Provedor): string[] {
  return [
    `Cole o link no checkout, no evento de compra aprovada: ${ONDE_CONFIGURAR[plataforma]}.`,
    "O link é secreto: quem tiver ele consegue registrar vendas aqui. Se vazar, use \"Regerar link\" (o antigo para de funcionar na hora) e cole o novo no checkout.",
    "Só compra aprovada dá a tag Comprador e dispara as automações de checkout; as outras vendas ficam registradas, mas são ignoradas.",
  ];
}

// ---------- Lista (/webhooks) ----------

export type AbaIntegracoes = "ativas" | "arquivadas";
export type OrdemIntegracoes = "recentes" | "antigos";
export type FiltrosIntegracoes = { aba: AbaIntegracoes; q: string; ordem: OrdemIntegracoes; pagina: number };

type Params = Record<string, string | string[] | undefined>;

function primeiro(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

function paginaDe(v: string | string[] | undefined): number {
  const n = Number.parseInt(primeiro(v), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** Lê os parâmetros da URL da lista; qualquer valor inválido vira o padrão. */
export function lerFiltrosIntegracoes(sp: Params): FiltrosIntegracoes {
  return {
    aba: primeiro(sp.aba) === "arquivadas" ? "arquivadas" : "ativas",
    q: primeiro(sp.q).trim().slice(0, 80),
    ordem: primeiro(sp.ordem) === "antigos" ? "antigos" : "recentes",
    pagina: paginaDe(sp.pagina),
  };
}

/** Endereço da lista com os filtros atuais + `mudar`. Mudar qualquer filtro (ou a aba) volta pra página 1. */
export function urlIntegracoes(atual: FiltrosIntegracoes, mudar: Partial<FiltrosIntegracoes>): string {
  const f = { ...atual, ...mudar };
  if (!("pagina" in mudar)) f.pagina = 1;
  const p = new URLSearchParams();
  if (f.aba === "arquivadas") p.set("aba", "arquivadas");
  if (f.q) p.set("q", f.q);
  if (f.ordem !== "recentes") p.set("ordem", f.ordem);
  if (f.pagina > 1) p.set("pagina", String(f.pagina));
  const s = p.toString();
  return `/webhooks${s ? `?${s}` : ""}`;
}

// ---------- Detalhe (/webhooks/[id]) ----------

export type AbaDetalhe = "visao" | "contas" | "automacoes" | "eventos";

export function lerAbaDetalhe(v: string | string[] | undefined): AbaDetalhe {
  const a = primeiro(v);
  return a === "contas" || a === "automacoes" || a === "eventos" ? a : "visao";
}

/** Sub-abas da aba Eventos. */
export const STATUS_EVENTOS = ["todos", "fila", "processando", "sucesso", "falhas"] as const;
export type StatusEventos = (typeof STATUS_EVENTOS)[number];
export const ROTULO_STATUS_EVENTOS: Record<StatusEventos, string> = {
  todos: "Visão geral",
  fila: "Na fila",
  processando: "Processando",
  sucesso: "Sucesso",
  falhas: "Falhas",
};

/** Venda recebida há menos que isto e ainda não processada está "Na fila" (o cron roda a cada minuto). Passou disso
 *  sem `processada_em`: o processamento falhou e o cron está tentando de novo ("Processando"). */
export const MINUTOS_FILA = 2;

/** Não processada depois disso: o cron tentou por 1h e não conseguiu (erro repetido, fila de ações parada…) — conta
 *  como "Falhas" (`DETALHE_NAO_PROCESSADA`), em vez de ficar pra sempre em "Processando" sem ninguém notar. */
export const MINUTOS_FALHA_SEM_PROCESSAR = 60;

/** `resultado` que conta como falha: a venda foi aprovada mas não deu pra fazer nada com ela (mesmo texto que
 *  `processarVendas` grava em `src/lib/jobs/vendas.ts`). Os outros resultados (inclusive "ignorada", de venda
 *  não aprovada) são processamentos que deram certo. */
export const RESULTADO_FALHA = "sem telefone";

/** Detalhe mostrado no cartão da venda que nunca terminou de processar (sem `resultado`, porque não chegou a
 *  processar) e caiu em "Falhas" por `MINUTOS_FALHA_SEM_PROCESSAR`. */
export const DETALHE_NAO_PROCESSADA = "não processada";

export type VendaEvento = { created_at: string; processada_em: string | null; resultado: string | null };

/** Em qual sub-abas (além de "Visão geral") a venda aparece, a partir de `processada_em`/`resultado`. */
export function statusDaVenda(v: VendaEvento, agora: Date): Exclude<StatusEventos, "todos"> {
  if (!v.processada_em) {
    const idadeMs = agora.getTime() - new Date(v.created_at).getTime();
    if (idadeMs < MINUTOS_FILA * 60_000) return "fila";
    return idadeMs < MINUTOS_FALHA_SEM_PROCESSAR * 60_000 ? "processando" : "falhas";
  }
  return v.resultado === RESULTADO_FALHA ? "falhas" : "sucesso";
}

/** O texto do cartão pra quem nunca processou e caiu em "Falhas" por idade (sem `resultado` nenhum). Processada
 *  (com ou sem falha) mostra `v.resultado` direto, como antes. */
export function detalheDaVenda(v: VendaEvento, status: Exclude<StatusEventos, "todos">): string | null {
  if (v.resultado) return v.resultado;
  return !v.processada_em && status === "falhas" ? DETALHE_NAO_PROCESSADA : null;
}

/** Início do período da fila: vendas não processadas criadas a partir daqui estão "Na fila". */
export function corteFila(agora: Date): string {
  return new Date(agora.getTime() - MINUTOS_FILA * 60_000).toISOString();
}

/** Início do período de "Processando": antes disso, não processada e ainda sem 1h é falha (acima). */
export function corteFalhaSemProcessar(agora: Date): string {
  return new Date(agora.getTime() - MINUTOS_FALHA_SEM_PROCESSAR * 60_000).toISOString();
}

export type FiltrosEventos = { status: StatusEventos; de: string; ate: string; pagina: number };

const DIA = /^\d{4}-\d{2}-\d{2}$/;

function diaValido(v: string): string {
  if (!DIA.test(v)) return "";
  const d = new Date(`${v}T12:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? "" : v;
}

export function lerFiltrosEventos(sp: Params): FiltrosEventos {
  const status = primeiro(sp.status);
  return {
    status: (STATUS_EVENTOS as readonly string[]).includes(status) ? (status as StatusEventos) : "todos",
    de: diaValido(primeiro(sp.de)),
    ate: diaValido(primeiro(sp.ate)),
    pagina: paginaDe(sp.pagina),
  };
}

/** Datas "de"/"até" (dias de Brasília, inclusive) em instantes UTC pra filtrar `created_at`: `desde` (>=) e
 *  `antes` (<, o começo do dia seguinte ao "até"). Brasília é UTC−3 fixo desde 2019. */
export function limitesDatas(de: string, ate: string): { desde: string | null; antes: string | null } {
  const desde = de ? new Date(`${de}T00:00:00-03:00`).toISOString() : null;
  const antes = ate ? new Date(new Date(`${ate}T00:00:00-03:00`).getTime() + 86_400_000).toISOString() : null;
  return { desde, antes };
}

/** Endereço do detalhe (aba Eventos) com os filtros atuais + `mudar`. Mudar filtro volta pra página 1. */
export function urlEventos(id: string, atual: FiltrosEventos, mudar: Partial<FiltrosEventos>): string {
  const f = { ...atual, ...mudar };
  if (!("pagina" in mudar)) f.pagina = 1;
  const p = new URLSearchParams({ aba: "eventos" });
  if (f.status !== "todos") p.set("status", f.status);
  if (f.de) p.set("de", f.de);
  if (f.ate) p.set("ate", f.ate);
  if (f.pagina > 1) p.set("pagina", String(f.pagina));
  return `/webhooks/${id}?${p.toString()}`;
}

/** Duração entre o recebimento e o processamento ("2 min", "38 s"), pro ícone `timelapse` do cartão de eventos
 * . `null` sem `processadaEm` (ainda não processou). */
export function duracaoProcessamento(createdAt: string, processadaEm: string | null): string | null {
  if (!processadaEm) return null;
  const ms = Math.max(0, new Date(processadaEm).getTime() - new Date(createdAt).getTime());
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  return `${h} h`;
}
