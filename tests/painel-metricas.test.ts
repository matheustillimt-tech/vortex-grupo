import { describe, expect, it } from "vitest";
import {
  emQueda, etapasDoFunil, filtrarPorProjeto, indicadores, maiorChurn, mediaDiaria7d, periodoAnterior, resolverPeriodosTendencia, topPorCliques, topPorConversao, variacao, variacaoDoDia, vazamento, type LinhaCampanha,
} from "@/src/lib/regras/painel-metricas";

const PERIODOS_TENDENCIA = [7, 14, 21, 28] as const;

describe("resolverPeriodosTendencia", () => {
  it("usa o próprio período de cada gráfico quando vem na URL", () => {
    expect(resolverPeriodosTendencia("14", "21", "28", 7, PERIODOS_TENDENCIA)).toEqual({ tc: 14, te: 21, ts: 28 });
  });
  it("o '?tendencia=' antigo vale como padrão dos três quando algum não vier na URL", () => {
    expect(resolverPeriodosTendencia(undefined, undefined, undefined, 14, PERIODOS_TENDENCIA)).toEqual({ tc: 14, te: 14, ts: 14 });
    expect(resolverPeriodosTendencia("28", undefined, undefined, 14, PERIODOS_TENDENCIA)).toEqual({ tc: 28, te: 14, ts: 14 });
  });
  it("valor fora das opções cai no padrão", () => {
    expect(resolverPeriodosTendencia("999", "x", undefined, 7, PERIODOS_TENDENCIA)).toEqual({ tc: 7, te: 7, ts: 7 });
  });
});

const R = (cliques: number, entradas: number, saidas: number, participantes = 0, admins = 0, grupos = 0, gruposCheios = 0) =>
  ({ cliques, entradas, saidas, participantes, admins, grupos, gruposCheios });
const L = (id: string, atual: ReturnType<typeof R>, anterior = R(0, 0, 0), projetoId: string | null = null): LinhaCampanha =>
  ({ id, nome: id.toUpperCase(), descricao: "", projetoId, atual, anterior });

describe("periodoAnterior", () => {
  it("dobro menos período, sem negativo; totais atuais do período", () => {
    expect(periodoAnterior(R(30, 20, 5, 9, 1, 3, 1), R(10, 8, 6, 9, 1, 3, 1))).toEqual(R(20, 12, 0, 9, 1, 3, 1));
  });
});

describe("variacao", () => {
  it.each([
    [137, 100, true, { texto: "+37% vs ant.", tom: "ok", sobe: true }],
    [43, 100, true, { texto: "-57% vs ant.", tom: "erro", sobe: false }],
    [100, 100, true, { texto: "0% vs ant.", tom: "neutro", sobe: false }],
    [3648, 0, false, { texto: "+3.648 vs ant.", tom: "erro", sobe: true }],
    [0, 0, true, { texto: "0% vs ant.", tom: "neutro", sobe: false }],
  ] as const)("%s vs %s", (atual, anterior, melhor, esperado) => {
    expect(variacao(atual, anterior, melhor)).toEqual(esperado);
  });
});

describe("rankings", () => {
  const l = [
    L("a", R(9009, 5017, 1756)),
    L("b", R(4614, 3294, 1199)),
    L("c", R(13, 9, 0)),
    L("d", R(0, 0, 0)),
    L("e", R(100, 10, 9), R(200, 30, 0)),
  ];
  it("top por cliques (sem zeros)", () => {
    expect(topPorCliques(l).map((x) => x.id)).toEqual(["a", "b", "e", "c"]);
  });
  it("top por conversão (só com cliques)", () => {
    expect(topPorConversao(l).map((x) => x.id)).toEqual(["b", "c", "a", "e"]);
  });
  it("em queda: ≥ 20 cliques antes e queda ≥ 30%", () => {
    expect(emQueda(l).map((x) => x.id)).toEqual(["e"]);
  });
  it("vazamento: ≥ 20 cliques e conversão < 15%", () => {
    expect(vazamento(l).map((x) => x.id)).toEqual(["e"]);
  });
  it("maior churn: saídas ÷ entradas", () => {
    expect(maiorChurn(l).map((x) => x.id)).toEqual(["e", "b", "a", "c"]);
  });
});

describe("indicadores e funil", () => {
  const total = R(18181, 10875, 3648, 8359, 80);
  it("indicadores derivados", () => {
    expect(indicadores(total, 6)).toEqual({ conversao: "59,82", churn: "43,64", cliquesMedios: "3.030,17" });
    expect(indicadores(R(0, 0, 0), 0)).toEqual({ conversao: "0,00", churn: "0,00", cliquesMedios: "0,00" });
  });
  it("etapas do funil", () => {
    expect(etapasDoFunil(total)).toEqual([
      { rotulo: "Cliques", valor: 18181, pctAnterior: null },
      { rotulo: "Entradas", valor: 10875, pctAnterior: "59,8" },
      { rotulo: "Participantes", valor: 8279, pctAnterior: "76,1" },
    ]);
  });
});

describe("variacaoDoDia", () => {
  it.each([
    [3, 49, { texto: "-57% vs média 7d", tom: "erro", sobe: false }],
    [14, 70, { texto: "+40% vs média 7d", tom: "ok", sobe: true }],
    [10, 70, { texto: "0% vs média 7d", tom: "neutro", sobe: false }],
  ] as const)("hoje %i, 7 dias %i", (hoje, soma, esperado) => {
    expect(variacaoDoDia(hoje, soma)).toEqual(esperado);
  });
  it("sem base nos 7 dias: sem selo", () => {
    expect(variacaoDoDia(5, 0)).toBeNull();
  });
});

describe("mediaDiaria7d", () => {
  it("uma casa decimal em pt-BR", () => {
    expect(mediaDiaria7d(49)).toBe("7,0");
    expect(mediaDiaria7d(10)).toBe("1,4");
    expect(mediaDiaria7d(0)).toBe("0,0");
  });
});

describe("filtrarPorProjeto", () => {
  const l = [L("a", R(10, 1, 0), undefined, "p1"), L("b", R(10, 1, 0), undefined, "p2"), L("c", R(10, 1, 0), undefined, null)];
  it("sem projeto devolve tudo", () => {
    expect(filtrarPorProjeto(l, "").map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
  it("com projeto só as campanhas daquele projeto", () => {
    expect(filtrarPorProjeto(l, "p1").map((x) => x.id)).toEqual(["a"]);
  });
});
