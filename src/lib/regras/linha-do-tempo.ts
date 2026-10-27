import type { Situacao } from "./calendario";

const DIA = 86_400_000;
const SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export type CorBolinha = "ok" | "erro" | "neutro" | "proximo";

/** Bolinha da linha do tempo: verde feito, laranja com halo o próximo, vermelha falhou/bloqueado, cinza o resto. */
export function corDaBolinha(situacao: Situacao, ehProximo: boolean): CorBolinha {
  if (ehProximo) return "proximo";
  if (situacao === "feito") return "ok";
  if (situacao === "falhou" || situacao === "bloqueado") return "erro";
  return "neutro";
}

/** "AAAA-MM-DD" (dia de Brasília) → { semana: "Qua", data: "21/10" }; "Hoje" no dia de hoje. */
export function rotuloDoDia(dia: string, hoje: string): { semana: string; data: string } {
  const d = new Date(`${dia}T12:00:00Z`);
  return { semana: dia === hoje ? "Hoje" : SEMANA[d.getUTCDay()], data: `${dia.slice(8, 10)}/${dia.slice(5, 7)}` };
}

export const PERIODOS = ["padrao", "hoje", "semana", "passado"] as const;
export type Periodo = (typeof PERIODOS)[number];

export function rotuloPeriodo(p: Periodo, diasAntes: number): string {
  switch (p) {
    case "hoje":
      return "Hoje";
    case "semana":
      return "Próximos 7 dias";
    case "passado":
      return "Últimos 30 dias";
    default:
      return `Últimos ${diasAntes} e próximos 45 dias`;
  }
}

/** Janela do filtro de período. "padrao" é a janela de sempre (`diasAntes` antes de hoje e 45 depois). */
export function janelaDoPeriodo(valor: string | undefined, inicioDeHoje: Date, diasAntes: number): { periodo: Periodo; de: Date; ate: Date } {
  const periodo: Periodo = (PERIODOS as readonly string[]).includes(valor ?? "") ? (valor as Periodo) : "padrao";
  const h = inicioDeHoje.getTime();
  switch (periodo) {
    case "hoje":
      return { periodo, de: new Date(h), ate: new Date(h + DIA - 1) };
    case "semana":
      return { periodo, de: new Date(h), ate: new Date(h + 7 * DIA) };
    case "passado":
      return { periodo, de: new Date(h - 30 * DIA), ate: new Date(h + DIA - 1) };
    default:
      return { periodo, de: new Date(h - diasAntes * DIA), ate: new Date(h + 45 * DIA) };
  }
}
