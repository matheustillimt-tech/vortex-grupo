import { PROVEDORES, type Provedor } from "@/src/lib/checkout/parsers";
import { GATILHOS, type Gatilho } from "@/src/lib/regras/automacoes";

/** Abas do topo das telas de automação: o motor novo e as sequências relativas à data da aula. */
export const ABAS_AUTOMACOES: { href: string; rotulo: string }[] = [
  { href: "/automacoes", rotulo: "Automações" },
  { href: "/sequencias", rotulo: "Sequências" },
];

export const ESTADOS = [
  { valor: "ativado", rotulo: "Ativado" },
  { valor: "desativado", rotulo: "Desativado" },
  { valor: "todos", rotulo: "Todos" },
] as const;
export type Estado = (typeof ESTADOS)[number]["valor"];

/** Sentinela de `?provedor=` pro item genérico "Checkout - Compra aprovada" (provedor nulo na automação, dispara
 *  em qualquer plataforma) — diferente de não ter `?provedor=` algum (quando o gatilho nem é "checkout"). */
const PROVEDOR_GERAL = "_geral";

export type FiltrosAutomacoes = {
  q: string;
  gatilho: Gatilho | null;
  /** Só lido quando `gatilho === "checkout"`: `"_geral"` (sentinela) = provedor nulo (qualquer plataforma);
   *  um `Provedor` = só essa plataforma; `null` = filtro de gatilho sem distinguir plataforma. */
  provedor: Provedor | typeof PROVEDOR_GERAL | null;
  pasta: string | null;
  estado: Estado;
  pagina: number;
};

export const FILTROS_PADRAO: FiltrosAutomacoes = { q: "", gatilho: null, provedor: null, pasta: null, estado: "todos", pagina: 1 };

/** Lê os parâmetros da URL; qualquer valor inválido vira o padrão. */
export function lerFiltrosAutomacoes(sp: { q?: string; gatilho?: string; provedor?: string; pasta?: string; estado?: string; pagina?: string }): FiltrosAutomacoes {
  const gatilho = (GATILHOS as readonly string[]).includes(sp.gatilho ?? "") ? (sp.gatilho as Gatilho) : null;
  const estado = ESTADOS.some((e) => e.valor === sp.estado) ? (sp.estado as Estado) : "todos";
  let provedor: FiltrosAutomacoes["provedor"] = null;
  if (gatilho === "checkout") {
    if (sp.provedor === PROVEDOR_GERAL) provedor = PROVEDOR_GERAL;
    else if ((PROVEDORES as readonly string[]).includes(sp.provedor ?? "")) provedor = sp.provedor as Provedor;
  }
  return {
    q: (sp.q ?? "").trim().slice(0, 80),
    gatilho,
    provedor,
    pasta: sp.pasta?.trim().slice(0, 40) || null,
    estado,
    pagina: Math.max(1, Math.floor(Number(sp.pagina)) || 1),
  };
}

/** Endereço da lista (`/automacoes`, `/campanhas/{id}/automacoes` ou `/webhooks/{id}?aba=automacoes`) com os
 *  filtros atuais + `mudar` (omitindo os padrões). Mudar qualquer filtro volta pra página 1. `base` pode já ter
 *  sua própria query fixa (ex.: `?aba=automacoes`), que fica preservada — os filtros entram com `&`, nunca com
 *  um segundo `?`. */
export function urlAutomacoes(base: string, atual: FiltrosAutomacoes, mudar: Partial<FiltrosAutomacoes>): string {
  const f = { ...atual, ...mudar };
  if (!("pagina" in mudar)) f.pagina = 1;
  const [caminho, queryFixa] = base.split("?");
  const p = new URLSearchParams(queryFixa ?? "");
  if (f.q) p.set("q", f.q);
  if (f.gatilho) p.set("gatilho", f.gatilho);
  if (f.gatilho === "checkout" && f.provedor) p.set("provedor", f.provedor);
  if (f.pasta) p.set("pasta", f.pasta);
  if (f.estado !== "todos") p.set("estado", f.estado);
  if (f.pagina > 1) p.set("pagina", String(f.pagina));
  const s = p.toString();
  return `${caminho}${s ? `?${s}` : ""}`;
}

export { PROVEDOR_GERAL };

/** Liga/desliga feito na lista, mostrado na hora (teste de 17/10/2026: depois de "Desativar", a lista seguia em
 *  "Ativado" até recarregar). `local` = o que a tela já sabe que mudou (id → ativo). */
export function comAtivoLocal<T extends { id: string; ativo: boolean }>(automacoes: T[], local: Readonly<Record<string, boolean>>): T[] {
  if (!Object.keys(local).length) return automacoes;
  return automacoes.map((a) => (a.id in local && local[a.id] !== a.ativo ? { ...a, ativo: local[a.id] } : a));
}

/** Depois de ativar/desativar `ids`: só marca na tela quando tudo deu certo (com erro, não dá pra saber quais
 *  mudaram; aí vale o `router.refresh`). */
export function marcarAtivoLocal(local: Readonly<Record<string, boolean>>, ids: string[], ativo: boolean, erros: number): Record<string, boolean> {
  if (erros > 0 || !ids.length) return { ...local };
  return { ...local, ...Object.fromEntries(ids.map((id) => [id, ativo])) };
}

/** Lista nova do servidor: some de `local` o que o servidor já mostra igual (ou que nem está mais na lista). O que
 *  ainda difere fica (lista atrasada não volta a mostrar o estado velho). Mesmo objeto quando nada muda. */
export function podarAtivoLocal(local: Readonly<Record<string, boolean>>, automacoes: { id: string; ativo: boolean }[]): Readonly<Record<string, boolean>> {
  const ids = Object.keys(local);
  if (!ids.length) return local;
  const doServidor = new Map(automacoes.map((a) => [a.id, a.ativo]));
  const fica = ids.filter((id) => doServidor.has(id) && doServidor.get(id) !== local[id]);
  return fica.length === ids.length ? local : Object.fromEntries(fica.map((id) => [id, local[id]]));
}
