import { describe, expect, it } from "vitest";
import { inicioDoDiaBrasilia, porDia, preencherDias, taxaEntrada } from "@/src/lib/regras/metricas";

describe("porDia", () => {
  it("agrupa no fuso de Brasília e preenche dias vazios", () => {
    const hoje = new Date("2026-10-15T15:00:00Z");
    const r = porDia(["2026-10-15T02:00:00Z", "2026-10-14T12:00:00Z", "2026-10-15T12:00:00Z"], 3, hoje);
    // 02:00Z do dia 15 é 23:00 do dia 14 em Brasília
    expect(r).toEqual([{ dia: "13/10", total: 0 }, { dia: "14/10", total: 2 }, { dia: "15/10", total: 1 }]);
  });
});

describe("taxaEntrada", () => {
  it("percentual com uma casa", () => {
    expect(taxaEntrada(200, 117)).toBe("58,5%");
    expect(taxaEntrada(0, 0)).toBe("—");
  });
});

describe("inicioDoDiaBrasilia", () => {
  it("retorna a meia-noite de Brasília em UTC, independente do fuso do host", () => {
    expect(inicioDoDiaBrasilia(new Date("2026-10-15T02:00:00Z"))).toBe("2026-10-14T03:00:00.000Z");
    expect(inicioDoDiaBrasilia(new Date("2026-10-15T15:00:00Z"))).toBe("2026-10-15T03:00:00.000Z");
  });
});

describe("preencherDias", () => {
  it("cobre os últimos dias de Brasília, zera os vazios e converte bigint em texto", () => {
    // 01:00Z do dia 16 ainda é dia 15 em Brasília.
    const hoje = new Date("2026-10-16T01:00:00Z");
    const r = preencherDias(
      [
        { dia: "2026-10-12", cliques: 9, entradas: 9, saidas: 9 }, // fora da janela
        { dia: "2026-10-13", cliques: "5", entradas: "2", saidas: "0" },
        { dia: "2026-10-15", cliques: 1, entradas: 0, saidas: 3 },
      ],
      3,
      hoje,
    );
    expect(r).toEqual([
      { dia: "13/10", data: "2026-10-13", cliques: 5, entradas: 2, saidas: 0 },
      { dia: "14/10", data: "2026-10-14", cliques: 0, entradas: 0, saidas: 0 },
      { dia: "15/10", data: "2026-10-15", cliques: 1, entradas: 0, saidas: 3 },
    ]);
  });
});
