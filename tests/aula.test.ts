import { describe, expect, it } from "vitest";
import { diaBrasilia, diasAteAula, rotuloAulaCampanha, rotuloDiaDaAula } from "@/src/lib/regras/aula";

const AULA = "2026-10-21T23:00:00Z"; // 21/10 às 20:00 em Brasília

describe("diaBrasilia", () => {
  it("dia do calendário em Brasília", () => {
    expect(diaBrasilia("2026-10-16T02:00:00Z")).toBe("2026-10-15");
    expect(diaBrasilia(new Date("2026-10-16T03:00:00Z"))).toBe("2026-10-16");
  });
});

describe("diasAteAula", () => {
  it("conexão dias de calendário de Brasília (positivo antes, zero no dia, negativo depois)", () => {
    expect(diasAteAula("2026-10-16", AULA)).toBe(5);
    expect(diasAteAula("2026-10-21", AULA)).toBe(0);
    expect(diasAteAula("2026-10-23", AULA)).toBe(-2);
    expect(diasAteAula("2026-10-21", "2026-10-22T01:00:00Z")).toBe(0); // 22:00 do dia 21 em Brasília
  });
});

describe("rotuloAulaCampanha", () => {
  it("D-N antes, D-0 no dia, 'aula passou' depois", () => {
    expect(rotuloAulaCampanha(AULA, new Date("2026-10-16T17:00:00Z"))).toEqual({ texto: "D-5", cor: "destaque" });
    expect(rotuloAulaCampanha(AULA, new Date("2026-10-21T12:00:00Z"))).toEqual({ texto: "D-0", cor: "destaque" });
    expect(rotuloAulaCampanha(AULA, new Date("2026-10-22T12:00:00Z"))).toEqual({ texto: "aula passou", cor: "neutro" });
  });
  it("sem data de aula, sem pílula", () => {
    expect(rotuloAulaCampanha(null, new Date("2026-10-16T17:00:00Z"))).toBeNull();
  });
});

describe("rotuloDiaDaAula", () => {
  it("D-1, Dia da aula, D+2", () => {
    expect(rotuloDiaDaAula("2026-10-20", AULA)).toBe("D-1");
    expect(rotuloDiaDaAula("2026-10-21", AULA)).toBe("Dia da aula");
    expect(rotuloDiaDaAula("2026-10-23", AULA)).toBe("D+2");
  });
});
