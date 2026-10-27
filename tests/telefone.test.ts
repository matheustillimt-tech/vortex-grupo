import { describe, expect, it } from "vitest";
import { chaveTelefone, digitosSemDdi, mascararTelefone, normalizarTelefone, telefoneLegivel, variantesTelefone } from "@/src/lib/telefone";

describe("normalizarTelefone", () => {
  it.each([
    ["(37) " + "98000-1001", "5537" + "980001001"],
    ["37" + "980001001", "5537" + "980001001"],
    ["+55 37 8000-1001", "553780001001"],
    ["5511" + "999999999", "5511" + "999999999"],
    ["+1 202 555 0100 99", "1202555010099"],
    ["037 " + "98000-1001", "5537" + "980001001"],
    ["(37) 3221-1001", "553732211001"],
    ["+61430780810", "61430780810"],
    ["0061430780810", "61430780810"],
    ["61430780810", "61430780810"],
    ["351" + "961000222", "351" + "961000222"],
  ])("%s → %s", (bruto, esperado) => {
    expect(normalizarTelefone(bruto)).toBe(esperado);
  });

  it("recusa lixo", () => {
    expect(normalizarTelefone("")).toBeNull();
    expect(normalizarTelefone("123")).toBeNull();
  });

  it("número de fora sem DDI não vira número brasileiro inventado", () => {
    expect(normalizarTelefone("0430780810")).toBeNull(); // Austrália, sem o +61
    expect(normalizarTelefone("961000222")).toBeNull(); // Portugal, sem o +351
    expect(normalizarTelefone("2025550100")).toBeNull(); // EUA, sem o +1 (DDD 20 não existe)
  });
});

describe("digitosSemDdi", () => {
  it("tira os zeros da frente e aceita de 8 a 11 dígitos", () => {
    expect(digitosSemDdi("0430 780 810")).toBe("430780810");
    expect(digitosSemDdi("961000222")).toBe("961000222");
    expect(digitosSemDdi("1234567")).toBeNull();
    expect(digitosSemDdi("")).toBeNull();
  });
});

describe("variantesTelefone", () => {
  it("com nono dígito gera a versão sem", () => {
    expect(variantesTelefone("5537" + "980001001")).toEqual(["5537" + "980001001", "553780001001"]);
  });
  it("sem nono dígito gera a versão com", () => {
    expect(variantesTelefone("553780001001")).toEqual(["553780001001", "5537" + "980001001"]);
  });
  it("estrangeiro fica igual", () => {
    expect(variantesTelefone("12025550100")).toEqual(["12025550100"]);
  });
});

describe("chaveTelefone", () => {
  it("com e sem o nono dígito dão a mesma chave", () => {
    expect(chaveTelefone("5537" + "980001001")).toBe(chaveTelefone("553780001001"));
  });
  it("números diferentes dão chaves diferentes", () => {
    expect(chaveTelefone("5537" + "980001001")).not.toBe(chaveTelefone("5537" + "980001002"));
  });
});

describe("telefoneLegivel", () => {
  it.each([
    ["5537" + "980001001", "55 37 " + "98000-1001"],
    ["553780001001", "55 37 8000-1001"],
    ["12025550100", "12025550100"],
  ])("%s → %s", (t, esperado) => {
    expect(telefoneLegivel(t)).toBe(esperado);
  });
});

describe("mascararTelefone", () => {
  it("mostra só o DDI 55 e os 4 últimos dígitos", () => {
    expect(mascararTelefone("5511" + "987651234")).toBe("+55 •• •••• 1234");
    expect(mascararTelefone("551187651234")).toBe("+55 •• •••• 1234");
    expect(mascararTelefone("14155551234")).toBe("+•• •••• 1234");
    expect(mascararTelefone(null)).toBeNull();
    expect(mascararTelefone("123")).toBeNull();
  });
});
