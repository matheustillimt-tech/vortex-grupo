/** Filtros da aba "Visão geral" de Leads (cadastro — `listar_leads`/`contar_leads`), separados de
 *  `filtros-pessoas.ts` (aba "Participações", que não muda). Busca cobre dígitos do telefone e o nome, por isso
 *  aceita letras (ao contrário da busca de Participações, que só aceita dígitos). */
/** `por`: 12 por página (padrão) ou 50, pra quem preferir — `opcoesPorPagina` do
 *  `Paginacao` da Task 1. */
export const OPCOES_POR_PAGINA_LEADS = [12, 50] as const;
export const POR_PAGINA_LEADS_PADRAO = 12;

export type FiltrosVisaoGeral = { busca: string | null; tag: string | null; por: number; pagina: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function primeiro(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

function uuid(v: string | string[] | undefined): string | null {
  const s = primeiro(v);
  return UUID.test(s) ? s : null;
}

export function lerFiltrosVisaoGeral(sp: Record<string, string | string[] | undefined>): FiltrosVisaoGeral {
  const busca = primeiro(sp.q).trim();
  const pagina = Number.parseInt(primeiro(sp.pagina), 10);
  const por = Number.parseInt(primeiro(sp.por), 10);
  return {
    busca: busca || null,
    tag: uuid(sp.tag),
    por: (OPCOES_POR_PAGINA_LEADS as readonly number[]).includes(por) ? por : POR_PAGINA_LEADS_PADRAO,
    pagina: Number.isFinite(pagina) && pagina > 0 ? pagina : 1,
  };
}

/** `%` e `_` escapados (o `ilike` do nome em `listar_leads` usa `escape '\'`), pra busca não virar curinga. */
export function escaparBusca(busca: string): string {
  return busca.replace(/[\\%_]/g, (c) => "\\" + c);
}

export function filtrosVisaoGeralParaRpc(f: FiltrosVisaoGeral) {
  return { p_busca: f.busca ? escaparBusca(f.busca) : null, p_tag: f.tag };
}

export function filtrosVisaoGeralParaQuery(f: FiltrosVisaoGeral): string {
  const q = new URLSearchParams();
  if (f.tag) q.set("tag", f.tag);
  if (f.busca) q.set("q", f.busca);
  if (f.por !== POR_PAGINA_LEADS_PADRAO) q.set("por", String(f.por));
  if (f.pagina > 1) q.set("pagina", String(f.pagina));
  return q.toString();
}
