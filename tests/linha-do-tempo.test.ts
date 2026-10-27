import { describe, expect, it } from "vitest";
import { corDaBolinha, janelaDoPeriodo, rotuloDoDia, rotuloPeriodo } from "@/src/lib/regras/linha-do-tempo";

describe("corDaBolinha", () => {
  it.each([
    ["feito", false, "ok"],
    ["falhou", false, "erro"],
    ["bloqueado", false, "erro"],
    ["agendado", false, "neutro"],
    ["projetado", false, "neutro"],
    ["executando", false, "neutro"],
    ["cancelado", false, "neutro"],
    ["pulado", false, "neutro"],
    ["agendado", true, "proximo"],
    ["projetado", true, "proximo"],
  ] as const)("%s (próximo: %s) → %s", (situacao, proximo, cor) => {
    expect(corDaBolinha(situacao, proximo)).toBe(cor);
  });
});

describe("rotuloDoDia", () => {
  it("dia da semana curto e DD/MM; 'Hoje' no dia de hoje", () => {
    expect(rotuloDoDia("2026-10-20", "2026-10-15")).toEqual({ semana: "Ter", data: "20/10" });
    expect(rotuloDoDia("2026-10-21", "2026-10-15")).toEqual({ semana: "Qua", data: "21/10" });
    expect(rotuloDoDia("2026-10-15", "2026-10-15")).toEqual({ semana: "Hoje", data: "15/10" });
  });
});

describe("janelaDoPeriodo", () => {
  const hoje = new Date("2026-10-15T03:00:00.000Z"); // meia-noite de Brasília

  it("padrão: N dias antes e 45 depois (a janela de hoje)", () => {
    const j = janelaDoPeriodo(undefined, hoje, 7);
    expect(j.periodo).toBe("padrao");
    expect(j.de.toISOString()).toBe("2026-10-08T03:00:00.000Z");
    expect(j.ate.toISOString()).toBe("2026-11-29T03:00:00.000Z");
  });
  it("hoje: só o dia de hoje", () => {
    const j = janelaDoPeriodo("hoje", hoje, 7);
    expect(j.de.toISOString()).toBe("2026-10-15T03:00:00.000Z");
    expect(j.ate.toISOString()).toBe("2026-10-16T02:59:59.999Z");
  });
  it("semana: de hoje a 7 dias", () => {
    expect(janelaDoPeriodo("semana", hoje, 7).ate.toISOString()).toBe("2026-10-22T03:00:00.000Z");
  });
  it("passado: últimos 30 dias até o fim de hoje", () => {
    const j = janelaDoPeriodo("passado", hoje, 7);
    expect(j.de.toISOString()).toBe("2026-09-15T03:00:00.000Z");
    expect(j.ate.toISOString()).toBe("2026-10-16T02:59:59.999Z");
  });
  it("valor desconhecido vira o padrão", () => {
    const j = janelaDoPeriodo("xyz", hoje, 30);
    expect(j.periodo).toBe("padrao");
    expect(j.de.toISOString()).toBe("2026-09-15T03:00:00.000Z");
  });
});

describe("rotuloPeriodo", () => {
  it("texto de cada período", () => {
    expect(rotuloPeriodo("padrao", 7)).toBe("Últimos 7 e próximos 45 dias");
    expect(rotuloPeriodo("padrao", 30)).toBe("Últimos 30 e próximos 45 dias");
    expect(rotuloPeriodo("hoje", 7)).toBe("Hoje");
    expect(rotuloPeriodo("semana", 7)).toBe("Próximos 7 dias");
    expect(rotuloPeriodo("passado", 7)).toBe("Últimos 30 dias");
  });
});
