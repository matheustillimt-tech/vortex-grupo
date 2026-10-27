import { describe, expect, it } from "vitest";
import { indicesComEtiqueta, rotuloData, serieComTodosOsDias, serieDaMetrica, totalDaMetrica } from "@/src/lib/regras/serie-metrica";

const dias = [
  { dia: "15/10", data: "2026-10-15", cliques: 200, entradas: 100, saidas: 10 },
  { dia: "16/10", data: "2026-10-16", cliques: 0, entradas: 0, saidas: 0 },
];

describe("serie-metrica", () => {
  it("contagens e percentuais por dia", () => {
    expect(serieDaMetrica(dias, "cliques")).toEqual([{ data: "2026-10-15", valor: 200 }, { data: "2026-10-16", valor: 0 }]);
    expect(serieDaMetrica(dias, "pct_entrada")).toEqual([{ data: "2026-10-15", valor: 50 }, { data: "2026-10-16", valor: 0 }]);
    expect(serieDaMetrica(dias, "pct_saida")).toEqual([{ data: "2026-10-15", valor: 10 }, { data: "2026-10-16", valor: 0 }]);
  });
  it("totais", () => {
    expect(totalDaMetrica(dias, "cliques")).toBe("200");
    expect(totalDaMetrica(dias, "pct_entrada")).toBe("50,00");
    expect(totalDaMetrica(dias, "pct_saida")).toBe("10,00");
  });
  it("rótulo de data", () => {
    expect(rotuloData("2026-10-16")).toBe("16/10/2026");
  });
  it("etiquetas: todas até 14 pontos; acima, 1 a cada ceil(n/14) + último + máximo", () => {
    expect(indicesComEtiqueta([5, 1, 3])).toEqual([0, 1, 2]);
    expect(indicesComEtiqueta(Array.from({ length: 14 }, (_, i) => i))).toEqual(Array.from({ length: 14 }, (_, i) => i));
    const v = Array.from({ length: 28 }, () => 1);
    v[5] = 99;
    const pares = Array.from({ length: 14 }, (_, i) => i * 2);
    expect(indicesComEtiqueta(v)).toEqual([...pares.slice(0, 3), 5, ...pares.slice(3), 27]);
    expect(indicesComEtiqueta([])).toEqual([]);
  });
  it("serieComTodosOsDias: 7 dias = exatamente 7 pontos (hoje incluso), zeros nos dias sem ponto, fuso de Brasília (revisão final B, item m8)", () => {
    // 02:00Z do dia 16 é 23:00 de Brasília do dia 15 — a janela conta a partir do dia de Brasília, não do UTC.
    const agora = new Date("2026-10-16T02:00:00Z");
    const r = serieComTodosOsDias([{ data: "2026-10-14T10:00:00Z", valor: 5 }], 7, agora);
    expect(r).toHaveLength(7);
    expect(r.map((p) => p.data)).toEqual(["2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"]);
    expect(r.map((p) => p.valor)).toEqual([0, 0, 0, 0, 0, 5, 0]);
  });
  it("serieComTodosOsDias: sem nenhum ponto, todos os dias ficam zero (3 dias = 3 pontos)", () => {
    const r = serieComTodosOsDias([], 3, new Date("2026-10-16T12:00:00Z"));
    expect(r).toHaveLength(3);
    expect(r.map((p) => p.valor)).toEqual([0, 0, 0]);
  });
});
