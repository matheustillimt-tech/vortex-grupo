/** `<input type="datetime-local">` digitado em Brasília (UTC−3, sem horário de verão desde 2019). */
export function brasiliaParaIso(valor: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(valor)) throw new Error("Data e hora inválidas");
  const d = new Date(`${valor}:00-03:00`);
  if (Number.isNaN(d.getTime())) throw new Error("Data e hora inválidas");
  return d.toISOString();
}

export function isoParaBrasilia(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
}

/** ISO → valor de `<input type="datetime-local">` em Brasília (AAAA-MM-DDTHH:MM). */
export function isoParaCampoBrasilia(iso: string): string {
  return new Date(new Date(iso).getTime() - 3 * 3600_000).toISOString().slice(0, 16);
}
