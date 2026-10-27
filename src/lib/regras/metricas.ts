const fmt = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });

export function porDia(datas: string[], dias: number, hoje: Date = new Date()): { dia: string; total: number }[] {
  const chaves = Array.from({ length: dias }, (_, i) => fmt.format(new Date(hoje.getTime() - (dias - 1 - i) * 86_400_000)));
  const cont = new Map(chaves.map((c) => [c, 0]));
  for (const d of datas) {
    const c = fmt.format(new Date(d));
    if (cont.has(c)) cont.set(c, cont.get(c)! + 1);
  }
  return chaves.map((dia) => ({ dia, total: cont.get(dia)! }));
}

export function taxaEntrada(cliques: number, entradas: number): string {
  if (!cliques) return "—";
  return `${((entradas / cliques) * 100).toFixed(1).replace(".", ",")}%`;
}

const fmtData = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });

/** Meia-noite de Brasília (do dia corrente em America/Sao_Paulo) em UTC, sem depender do fuso do host. */
export function inicioDoDiaBrasilia(agora: Date = new Date()): string {
  const hoje = fmtData.format(agora);
  return new Date(`${hoje}T00:00:00-03:00`).toISOString();
}

export type MetricaDia = { dia: string; data: string; cliques: number; entradas: number; saidas: number };

/** Linhas de `metricas_campanha` (dia `AAAA-MM-DD` em Brasília, só os dias com movimento) → os últimos `dias`
 *  dias, terminando hoje em Brasília, com zero nos dias vazios e rótulo `DD/MM`. */
export function preencherDias(linhas: { dia: string; cliques: number | string; entradas: number | string; saidas: number | string }[], dias: number, hoje: Date = new Date()): MetricaDia[] {
  const porData = new Map(linhas.map((l) => [l.dia.slice(0, 10), l]));
  return Array.from({ length: dias }, (_, i) => {
    const data = fmtData.format(new Date(hoje.getTime() - (dias - 1 - i) * 86_400_000));
    const l = porData.get(data);
    return {
      dia: `${data.slice(8, 10)}/${data.slice(5, 7)}`,
      data,
      cliques: Number(l?.cliques ?? 0),
      entradas: Number(l?.entradas ?? 0),
      saidas: Number(l?.saidas ?? 0),
    };
  });
}
