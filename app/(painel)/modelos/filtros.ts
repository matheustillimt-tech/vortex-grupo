import type { OrdemModelos } from "@/src/lib/regras/modelos";

export type { OrdemModelos };

export type FiltrosModelos = { q: string; pasta: string | null; ordem: OrdemModelos; pagina: number };

/** Lê os parâmetros da URL; qualquer valor inválido vira o padrão. */
export function lerFiltrosModelos(sp: { q?: string; pasta?: string; ordem?: string; pagina?: string }): FiltrosModelos {
  return {
    q: (sp.q ?? "").trim().slice(0, 80),
    pasta: sp.pasta?.trim().slice(0, 40) || null,
    ordem: sp.ordem === "nome" ? "nome" : sp.ordem === "criacao" ? "criacao" : "atualizacao",
    pagina: Math.max(1, Math.floor(Number(sp.pagina)) || 1),
  };
}

/** Endereço da lista com os filtros atuais + `mudar` (omitindo os padrões). Mudar qualquer filtro volta pra página 1. */
export function urlModelos(atual: FiltrosModelos, mudar: Partial<FiltrosModelos>): string {
  const f = { ...atual, ...mudar };
  if (!("pagina" in mudar)) f.pagina = 1;
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.pasta) p.set("pasta", f.pasta);
  if (f.ordem !== "atualizacao") p.set("ordem", f.ordem);
  if (f.pagina > 1) p.set("pagina", String(f.pagina));
  const s = p.toString();
  return `/modelos${s ? `?${s}` : ""}`;
}
