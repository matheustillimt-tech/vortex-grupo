import { describe, expect, it } from "vitest";
import { campanhaTerminou, TIPOS_CAMPANHA } from "@/src/lib/regras/campanha-tipo";

describe("TIPOS_CAMPANHA", () => {
  it("tem os 4 tipos, na ordem usada nos selects", () => {
    expect(TIPOS_CAMPANHA).toEqual(["campanha", "lista", "viral", "aleatorio"]);
  });
});

describe("campanhaTerminou", () => {
  it("sem termina_em nunca termina", () => {
    expect(campanhaTerminou(null, new Date())).toBe(false);
    expect(campanhaTerminou(undefined, new Date())).toBe(false);
  });
  it("termina_em no futuro ainda não terminou", () => {
    expect(campanhaTerminou("2026-10-18T00:00:00.000Z", new Date("2026-10-17T12:00:00.000Z"))).toBe(false);
  });
  it("termina_em no passado já terminou", () => {
    expect(campanhaTerminou("2026-10-16T00:00:00.000Z", new Date("2026-10-17T12:00:00.000Z"))).toBe(true);
  });
  it("termina_em exatamente agora já terminou (<=)", () => {
    const agora = new Date("2026-10-17T12:00:00.000Z");
    expect(campanhaTerminou(agora.toISOString(), agora)).toBe(true);
  });
});
