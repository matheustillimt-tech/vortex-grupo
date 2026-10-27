import { timingSafeEqual } from "node:crypto";

export type Prazo = { ate: number };
export const restante = (p: Prazo) => p.ate - Date.now();

export function autorizado(header: string | null, segredo: string): boolean {
  const esperado = Buffer.from(`Bearer ${segredo}`);
  const veio = Buffer.from(header ?? "");
  return veio.length === esperado.length && timingSafeEqual(veio, esperado);
}
