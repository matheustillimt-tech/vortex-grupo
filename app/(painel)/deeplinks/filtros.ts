import { validarSlugDeeplink, type OrdemDeeplinks } from "@/src/lib/regras/deeplinks";

export type FiltrosDeeplinks = { q: string; pasta: string | null; ordem: OrdemDeeplinks; pagina: number };

/** Lê os parâmetros da URL; qualquer valor inválido vira o padrão. */
export function lerFiltrosDeeplinks(sp: { q?: string; pasta?: string; ordem?: string; pagina?: string }): FiltrosDeeplinks {
  return {
    q: (sp.q ?? "").trim().slice(0, 80),
    pasta: sp.pasta?.trim().slice(0, 40) || null,
    ordem: sp.ordem === "antigos" ? "antigos" : "recentes",
    pagina: Math.max(1, Math.floor(Number(sp.pagina)) || 1),
  };
}

/** Endereço da lista com os filtros atuais + `mudar` (omitindo os padrões). Mudar qualquer filtro volta pra página 1. */
export function urlDeeplinks(atual: FiltrosDeeplinks, mudar: Partial<FiltrosDeeplinks>): string {
  const f = { ...atual, ...mudar };
  if (!("pagina" in mudar)) f.pagina = 1;
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.pasta) p.set("pasta", f.pasta);
  if (f.ordem !== "recentes") p.set("ordem", f.ordem);
  if (f.pagina > 1) p.set("pagina", String(f.pagina));
  const s = p.toString();
  return `/deeplinks${s ? `?${s}` : ""}`;
}

/**
 * Extrai o `slug` de uma URL de deep link do Vórtex Grupo (`/d/{slug}`), pro botão "Pesquisar deeplink por url"
 *: aceita com ou sem protocolo/host, com ou sem barra/segmentos depois do slug, ou o slug puro. Devolve
 * `null` quando não dá pra reconhecer um slug válido (`validarSlugDeeplink`). Pura: quem navega pro `?q=` é o
 * componente cliente que chama esta função.
 */
export function slugDaUrl(url: string): string | null {
  const v = url.trim();
  if (!v) return null;
  const m = v.match(/\/d\/([^/?#]+)/i);
  const candidato = (m ? m[1] : v).toLowerCase();
  const r = validarSlugDeeplink(candidato);
  return r.ok ? r.slug : null;
}
