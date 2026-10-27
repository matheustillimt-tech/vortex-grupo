import { describe, expect, it } from "vitest";
import { caminhoArea, caminhoBanda, caminhoLinha, pontosDoGrafico, rotulosDoEixo, topoDaEscala } from "@/src/lib/regras/grafico";

describe("topoDaEscala", () => {
  it.each([
    [0, 1],
    [1, 1],
    [5, 5],
    [7, 10],
    [12, 20],
    [812, 1000],
    [1000, 1000],
    [1284, 2000],
  ])("%d → %d", (maior, topo) => {
    expect(topoDaEscala(maior)).toBe(topo);
  });
});

describe("pontosDoGrafico", () => {
  it("distribui no eixo x e inverte o y (zero embaixo)", () => {
    expect(pontosDoGrafico([0, 5, 10], 600, 140, 10)).toEqual([
      { x: 0, y: 140 },
      { x: 300, y: 70 },
      { x: 600, y: 0 },
    ]);
  });
  it("um único ponto fica no meio", () => {
    expect(pontosDoGrafico([4], 600, 140, 10)).toEqual([{ x: 300, y: 84 }]);
  });
  it("valor negativo vira zero", () => {
    expect(pontosDoGrafico([-3, 10], 600, 140, 10)).toEqual([
      { x: 0, y: 140 },
      { x: 600, y: 0 },
    ]);
  });
});

describe("caminhoLinha e caminhoArea", () => {
  it("monta o d do SVG com uma casa decimal", () => {
    const p = pontosDoGrafico([1, 2], 600, 140, 3);
    expect(caminhoLinha(p)).toBe("M0,93.3 L600,46.7");
    expect(caminhoArea(p, 140)).toBe("M0,93.3 L600,46.7 L600,140 L0,140 Z");
  });
  it("sem pontos devolve vazio", () => {
    expect(caminhoLinha([])).toBe("");
    expect(caminhoArea([], 140)).toBe("");
  });
});

describe("caminhoBanda (gráfico empilhado, revisão final B item m7)", () => {
  it("monta o polígono entre a linha de cima e a de baixo (invertida)", () => {
    const superior = pontosDoGrafico([5, 10], 600, 140, 10);
    const inferior = pontosDoGrafico([0, 0], 600, 140, 10);
    expect(caminhoBanda(superior, inferior)).toBe("M0,70 L600,0 L600,140 L0,140 Z");
  });

  it("sem pontos (período sem dados): devolve vazio, nunca o 'd=\" Z\"' degenerado", () => {
    expect(caminhoBanda([], [])).toBe("");
    expect(caminhoBanda([], [])).not.toBe(" Z");
  });
});

describe("rotulosDoEixo", () => {
  const dias = (n: number) => Array.from({ length: n }, (_, i) => `${String(i + 1).padStart(2, "0")}/10`);
  it("7 dias: todos, do 0% ao 100%", () => {
    const r = rotulosDoEixo(dias(7));
    expect(r).toHaveLength(7);
    expect(r[0]).toEqual({ indice: 0, rotulo: "01/10", posicao: 0 });
    expect(r[6]).toEqual({ indice: 6, rotulo: "07/10", posicao: 100 });
  });
  it("14 dias: um sim, um não", () => {
    const r = rotulosDoEixo(dias(14));
    expect(r.map((x) => x.indice)).toEqual([0, 2, 4, 6, 8, 10, 12]);
    expect(r[6].posicao).toBe(92.3);
  });
  it("28 dias: de 4 em 4", () => {
    expect(rotulosDoEixo(dias(28)).map((x) => x.indice)).toEqual([0, 4, 8, 12, 16, 20, 24]);
  });
  it("um dia só fica no meio", () => {
    expect(rotulosDoEixo(["16/10"])).toEqual([{ indice: 0, rotulo: "16/10", posicao: 50 }]);
  });
});
