export type AbaMensagens = "todas" | "fila" | "agendado" | "processando" | "sucesso" | "falhas";

export const ABAS_MENSAGENS: { valor: AbaMensagens; rotulo: string }[] = [
  { valor: "todas", rotulo: "Visão geral" },
  { valor: "fila", rotulo: "Na fila" },
  { valor: "agendado", rotulo: "Agendado" },
  { valor: "processando", rotulo: "Processando" },
  { valor: "sucesso", rotulo: "Sucesso" },
  { valor: "falhas", rotulo: "Falhas" },
];

export function lerAbaMensagens(v: string | undefined): AbaMensagens {
  return ABAS_MENSAGENS.find((a) => a.valor === v)?.valor ?? "todas";
}

/** `<input type="date">` (AAAA-MM-DD) → meia-noite de Brasília (UTC−3 fixo) em ISO UTC. */
export function inicioDoDiaIso(data: string | undefined): string | null {
  if (!data || !/^\d{4}-\d{2}-\d{2}$/.test(data)) return null;
  const d = new Date(`${data}T00:00:00-03:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function fimDoDiaIso(data: string | undefined): string | null {
  const ini = inicioDoDiaIso(data);
  return ini ? new Date(new Date(ini).getTime() + 86_400_000).toISOString() : null;
}

/** "15/10/2026, 13:53:21" em Brasília. */
/** "dd/mm hh:mm" no horário de Brasília (ex.: "Agendada para 20/10 21:00" nos cartões de Ações). */
export function dataHoraCurta(iso: string): string {
  const s = new Date(new Date(iso).getTime() - 3 * 3600_000).toISOString();
  return `${s.slice(8, 10)}/${s.slice(5, 7)} ${s.slice(11, 16)}`;
}

export function dataHoraCompleta(iso: string): string {
  const s = new Date(new Date(iso).getTime() - 3 * 3600_000).toISOString();
  return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}, ${s.slice(11, 19)}`;
}
