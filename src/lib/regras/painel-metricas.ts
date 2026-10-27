import { percentual, type Resumo } from "./campanhas";
import { formatarNumero } from "./inicio";

export type { Resumo };

export type LinhaCampanha = { id: string; nome: string; descricao: string; projetoId: string | null; atual: Resumo; anterior: Resumo };

const conv = (r: Resumo) => (r.cliques ? r.entradas / r.cliques : 0);

/** Período anterior de mesmo tamanho = resumo do dobro do período menos o do período (só nas contagens do período). */
export function periodoAnterior(doDobro: Resumo, doPeriodo: Resumo): Resumo {
  return {
    ...doPeriodo,
    cliques: Math.max(0, doDobro.cliques - doPeriodo.cliques),
    entradas: Math.max(0, doDobro.entradas - doPeriodo.entradas),
    saidas: Math.max(0, doDobro.saidas - doPeriodo.saidas),
  };
}

/** "+37% vs ant." / "-57% vs ant."; sem base, a diferença absoluta. `maiorEhMelhor = false` para saídas. */
export function variacao(atual: number, anterior: number, maiorEhMelhor = true): { texto: string; tom: "ok" | "erro" | "neutro"; sobe: boolean } {
  const tomDe = (sobe: boolean) => (sobe === maiorEhMelhor ? "ok" : "erro");
  if (!anterior) {
    if (!atual) return { texto: "0% vs ant.", tom: "neutro", sobe: false };
    return { texto: `+${formatarNumero(atual)} vs ant.`, tom: tomDe(true), sobe: true };
  }
  const pct = Math.round(((atual - anterior) / anterior) * 100);
  if (pct === 0) return { texto: "0% vs ant.", tom: "neutro", sobe: false };
  return { texto: `${pct > 0 ? "+" : ""}${pct}% vs ant.`, tom: tomDe(pct > 0), sobe: pct > 0 };
}

/** Filtro do select "Projeto" no "Funil de campanhas": só as campanhas desse projeto, ou todas sem filtro. */
export function filtrarPorProjeto(l: LinhaCampanha[], projetoId: string): LinhaCampanha[] {
  return projetoId ? l.filter((x) => x.projetoId === projetoId) : l;
}

/** Tendências: cada gráfico (Clicks/Entraram/Sairam) tem o próprio período `?tc=&te=&ts=`;
 *  o `?tendencia=` antigo (de antes de cada gráfico ter o próprio seletor) continua valendo como padrão dos
 *  três quando um deles não vier na URL (links já mandados continuam abrindo igual). */
export function resolverPeriodosTendencia(
  tc: string | undefined,
  te: string | undefined,
  ts: string | undefined,
  tendenciaLegado: number,
  opcoes: readonly number[],
): { tc: number; te: number; ts: number } {
  const resolve = (v: string | undefined) => {
    const n = Number(v);
    return v !== undefined && opcoes.includes(n) ? n : tendenciaLegado;
  };
  return { tc: resolve(tc), te: resolve(te), ts: resolve(ts) };
}

export function topPorCliques(l: LinhaCampanha[], n = 5): LinhaCampanha[] {
  return l.filter((x) => x.atual.cliques > 0).sort((a, b) => b.atual.cliques - a.atual.cliques).slice(0, n);
}

export function topPorConversao(l: LinhaCampanha[], n = 5): LinhaCampanha[] {
  return l.filter((x) => x.atual.cliques > 0).sort((a, b) => conv(b.atual) - conv(a.atual)).slice(0, n);
}

export function emQueda(l: LinhaCampanha[]): LinhaCampanha[] {
  return l
    .filter((x) => x.anterior.cliques >= 20 && x.atual.cliques <= x.anterior.cliques * 0.7)
    .sort((a, b) => a.atual.cliques / a.anterior.cliques - b.atual.cliques / b.anterior.cliques);
}

export function vazamento(l: LinhaCampanha[]): LinhaCampanha[] {
  return l.filter((x) => x.atual.cliques >= 20 && conv(x.atual) < 0.15).sort((a, b) => conv(a.atual) - conv(b.atual));
}

export function maiorChurn(l: LinhaCampanha[], n = 5): LinhaCampanha[] {
  const churn = (r: Resumo) => (r.entradas ? r.saidas / r.entradas : 0);
  return l.filter((x) => x.atual.entradas > 0).sort((a, b) => churn(b.atual) - churn(a.atual)).slice(0, n);
}

const duasCasas = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function indicadores(total: Resumo, campanhasAtivas: number) {
  return {
    conversao: percentual(total.entradas, total.cliques),
    churn: percentual(total.saidas, total.participantes),
    cliquesMedios: duasCasas(campanhasAtivas ? total.cliques / campanhasAtivas : 0),
  };
}

export function etapasDoFunil(total: Resumo) {
  const leads = total.participantes - total.admins;
  const pct = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1).replace(".", ",") : null);
  return [
    { rotulo: "Cliques", valor: total.cliques, pctAnterior: null },
    { rotulo: "Entradas", valor: total.entradas, pctAnterior: pct(total.entradas, total.cliques) },
    { rotulo: "Participantes", valor: leads, pctAnterior: pct(leads, total.entradas) },
  ];
}

/** Hoje contra a média diária dos 7 dias anteriores (`soma7d` = soma desses dias), no formato do selo do
 *  `CartaoFunil`: "-57% vs média 7d". Mesma conta de `variacaoVsMedia`; sem base (média 0), sem selo. */
export function variacaoDoDia(hoje: number, soma7d: number): { texto: string; tom: "ok" | "erro" | "neutro"; sobe: boolean } | null {
  const media = soma7d / 7;
  if (media === 0) return null;
  const pct = Math.round(((hoje - media) / media) * 100);
  if (pct === 0) return { texto: "0% vs média 7d", tom: "neutro", sobe: false };
  return { texto: `${pct > 0 ? "+" : ""}${pct}% vs média 7d`, tom: pct > 0 ? "ok" : "erro", sobe: pct > 0 };
}

/** "7,0": média diária dos 7 dias com uma casa. */
export function mediaDiaria7d(soma7d: number): string {
  return (soma7d / 7).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
