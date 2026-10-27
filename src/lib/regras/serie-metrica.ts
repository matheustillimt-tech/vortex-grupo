import { percentual } from "./campanhas";
import { formatarNumero } from "./inicio";
import type { MetricaDia } from "./metricas";

export type Metrica = "cliques" | "entradas" | "pct_entrada" | "saidas" | "pct_saida";

const duas = (n: number) => Math.round(n * 100) / 100;

/** Um ponto por dia da métrica pedida. Percentuais com 2 casas (0 quando não há base). */
export function serieDaMetrica(dias: MetricaDia[], m: Metrica): { data: string; valor: number }[] {
  return dias.map((d) => ({
    data: d.data,
    valor:
      m === "pct_entrada" ? (d.cliques ? duas((d.entradas / d.cliques) * 100) : 0)
      : m === "pct_saida" ? (d.entradas ? duas((d.saidas / d.entradas) * 100) : 0)
      : d[m],
  }));
}

/** Total do período: soma das contagens, ou o percentual do período (não a média dos dias), ex. "53,58". */
export function totalDaMetrica(dias: MetricaDia[], m: Metrica): string {
  const soma = (k: "cliques" | "entradas" | "saidas") => dias.reduce((s, d) => s + d[k], 0);
  if (m === "pct_entrada") return percentual(soma("entradas"), soma("cliques"));
  if (m === "pct_saida") return percentual(soma("saidas"), soma("entradas"));
  return formatarNumero(soma(m));
}

/** "2026-10-16" → "16/10/2026". */
export function rotuloData(data: string): string {
  return `${data.slice(8, 10)}/${data.slice(5, 7)}/${data.slice(0, 4)}`;
}

const fmtDiaBrasilia = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });

/** Exatamente `dias` pontos (hoje incluso, fuso de Brasília), com zero onde não há ponto — `dias = 7` dá 7
 *  pontos (hoje e os 6 anteriores), batendo com o rótulo "últimos 7 dias" (revisão final B, item m8: antes
 *  dava 8 pontos, 1 a mais que o período escolhido). Pura: reaproveitada por Atividades e
 *  Clicks, que têm fontes de dados diferentes mas o mesmo eixo "últimos N dias". `pontos` casa por
 *  `data` (prefixo "AAAA-MM-DD"; aceita "AAAA-MM-DDTHH:mm…"). */
export function serieComTodosOsDias(pontos: { data: string; valor: number }[], dias: number, agora: Date = new Date()): { data: string; valor: number }[] {
  const porDia = new Map(pontos.map((p) => [p.data.slice(0, 10), p.valor]));
  return Array.from({ length: dias }, (_, i) => {
    const data = fmtDiaBrasilia.format(new Date(agora.getTime() - (dias - 1 - i) * 86_400_000));
    return { data, valor: porDia.get(data) ?? 0 };
  });
}

/** Pontos que ganham etiqueta de valor: todos até `max`; acima, 1 a cada ceil(n/max), sempre com o último e o
 *  maior valor (primeira ocorrência), em ordem crescente. Evita etiquetas encavaladas em 21/28 dias. */
export function indicesComEtiqueta(valores: number[], max = 14): number[] {
  const n = valores.length;
  if (n <= max) return valores.map((_, i) => i);
  const passo = Math.ceil(n / max);
  const indices = new Set<number>();
  for (let i = 0; i < n; i += passo) indices.add(i);
  indices.add(n - 1);
  indices.add(valores.indexOf(Math.max(...valores)));
  return [...indices].sort((a, b) => a - b);
}
