import { ehUuid } from "./uuid";

/** Valida que `ids` é um array de strings não vazias, remove duplicados e corta em `maximo`. Qualquer outro valor (undefined, número, objeto) vira lista vazia. */
export function normalizarIds(ids: unknown, maximo: number): string[] {
  if (!Array.isArray(ids)) return [];
  const unicos = [...new Set(ids.filter((i): i is string => typeof i === "string" && i.length > 0))];
  return unicos.slice(0, maximo);
}

/** Como `normalizarIds`, mas exige que cada item seja um uuid de verdade (v1–v5) — usado pelas ações em massa
 *  "sem campanha" (`/acoes`), que cruzam ids de execuções de campanhas diferentes e não podem confiar em
 *  qualquer string. Item que não é uuid é descartado em silêncio, não vira erro. */
export function normalizarIdsUuid(ids: unknown, maximo: number): string[] {
  if (!Array.isArray(ids)) return [];
  const unicos = [...new Set(ids.filter(ehUuid))];
  return unicos.slice(0, maximo);
}
