export type FiltrosBloqueados = {
  busca: string | null;
  inicio: string | null;
  fim: string | null;
  ordem: "recentes" | "antigos";
  pagina: number;
};

const DATA = /^\d{4}-\d{2}-\d{2}$/;

function primeiro(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

function data(v: string | string[] | undefined): string | null {
  const s = primeiro(v);
  return DATA.test(s) ? s : null;
}

/** Filtros da URL da tela Números bloqueados (e da exportação). Valor inválido vira "sem filtro" em vez de erro no banco. */
export function lerFiltrosBloqueados(sp: Record<string, string | string[] | undefined>): FiltrosBloqueados {
  const busca = primeiro(sp.q).replace(/\D/g, "");
  const pagina = Number.parseInt(primeiro(sp.pagina), 10);
  const ordem = primeiro(sp.ordem);
  return {
    busca: busca || null,
    inicio: data(sp.inicio),
    fim: data(sp.fim),
    ordem: ordem === "antigos" ? "antigos" : "recentes",
    pagina: Number.isFinite(pagina) && pagina > 0 ? pagina : 1,
  };
}

export function filtrosBloqueadosParaQuery(f: FiltrosBloqueados): string {
  const q = new URLSearchParams();
  if (f.busca) q.set("q", f.busca);
  if (f.inicio) q.set("inicio", f.inicio);
  if (f.fim) q.set("fim", f.fim);
  if (f.ordem !== "recentes") q.set("ordem", f.ordem);
  if (f.pagina > 1) q.set("pagina", String(f.pagina));
  return q.toString();
}

/** Endereço da lista com os filtros atuais + `mudar`. Mudar qualquer filtro volta pra página 1. */
export function urlBloqueados(atual: FiltrosBloqueados, mudar: Partial<FiltrosBloqueados>): string {
  const f = { ...atual, ...mudar };
  if (!("pagina" in mudar)) f.pagina = 1;
  const q = filtrosBloqueadosParaQuery(f);
  return q ? `/anti-spam?${q}` : "/anti-spam";
}
