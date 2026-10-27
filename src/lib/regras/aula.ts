const BRASILIA_MS = 3 * 3600_000; // UTC−3, sem horário de verão desde 2019
const DIA_MS = 86_400_000;

/** Dia do calendário de Brasília ("AAAA-MM-DD") de um instante. */
export function diaBrasilia(quando: string | Date): string {
  return new Date(new Date(quando).getTime() - BRASILIA_MS).toISOString().slice(0, 10);
}

/** Dias de calendário (Brasília) de `dia` até o dia da aula: positivo antes, 0 no dia, negativo depois. */
export function diasAteAula(dia: string, dataAulaIso: string): number {
  const aula = Date.parse(`${diaBrasilia(dataAulaIso)}T00:00:00Z`);
  return Math.round((aula - Date.parse(`${dia}T00:00:00Z`)) / DIA_MS);
}

/** Pílula da campanha no Início: "D-5", "D-0" (o dia todo) ou "aula passou". Sem aula, sem pílula. */
export function rotuloAulaCampanha(dataAulaIso: string | null, agora: Date): { texto: string; cor: "destaque" | "neutro" } | null {
  if (!dataAulaIso) return null;
  const n = diasAteAula(diaBrasilia(agora), dataAulaIso);
  if (n < 0) return { texto: "aula passou", cor: "neutro" };
  return { texto: `D-${n}`, cor: "destaque" };
}

/** Rótulo do dia no calendário em relação à aula: "D-3", "Dia da aula", "D+1". */
export function rotuloDiaDaAula(dia: string, dataAulaIso: string): string {
  const n = diasAteAula(dia, dataAulaIso);
  if (n === 0) return "Dia da aula";
  return n > 0 ? `D-${n}` : `D+${-n}`;
}
