import { describe, expect, it } from "vitest";
import { camposParaTexto, MAXIMO_CAMPOS, validarCampos, validarNomeLead } from "@/src/lib/regras/leads";

describe("validarNomeLead", () => {
  it("corta espaços e aceita vazio como null", () => {
    expect(validarNomeLead("  Ana  ")).toEqual({ nome: "Ana" });
    expect(validarNomeLead("")).toEqual({ nome: null });
    expect(validarNomeLead("   ")).toEqual({ nome: null });
    expect(validarNomeLead(undefined)).toEqual({ nome: null });
    expect(validarNomeLead(null)).toEqual({ nome: null });
  });
  it("recusa mais de 80 letras", () => {
    expect(validarNomeLead("x".repeat(81))).toEqual({ erro: "Nome com no máximo 80 letras." });
    expect(validarNomeLead("x".repeat(80))).toEqual({ nome: "x".repeat(80) });
  });
  it("recusa valor que não é texto", () => {
    expect(validarNomeLead(42)).toEqual({ erro: "Nome inválido." });
  });
});

describe("validarCampos", () => {
  it("entrada que não é array vira objeto vazio", () => {
    expect(validarCampos(undefined)).toEqual({ campos: {} });
    expect(validarCampos("x")).toEqual({ campos: {} });
  });
  it("ignora linha com chave vazia (linha em branco do formulário)", () => {
    expect(validarCampos([{ chave: "", valor: "x" }, { chave: "  ", valor: "y" }])).toEqual({ campos: {} });
  });
  it("corta espaço da chave, mantém o valor como veio", () => {
    expect(validarCampos([{ chave: " Cidade ", valor: "SP " }])).toEqual({ campos: { Cidade: "SP " } });
  });
  it(`recusa mais de ${MAXIMO_CAMPOS} campos`, () => {
    const muitos = Array.from({ length: MAXIMO_CAMPOS + 1 }, (_, i) => ({ chave: `c${i}`, valor: "v" }));
    expect(validarCampos(muitos)).toEqual({ erro: `No máximo ${MAXIMO_CAMPOS} campos personalizados.` });
  });
  it("aceita exatamente o máximo de campos", () => {
    const limite = Array.from({ length: MAXIMO_CAMPOS }, (_, i) => ({ chave: `c${i}`, valor: "v" }));
    const r = validarCampos(limite);
    expect("erro" in r).toBe(false);
    expect(Object.keys((r as { campos: Record<string, string> }).campos)).toHaveLength(MAXIMO_CAMPOS);
  });
  it("recusa chave com mais de 40 letras (mensagem)", () => {
    const r = validarCampos([{ chave: "x".repeat(41), valor: "v" }]);
    expect(r).toEqual({ erro: "Nome do campo com no máximo 40 letras." });
  });
  it("recusa valor com mais de 200 letras", () => {
    const r = validarCampos([{ chave: "cidade", valor: "v".repeat(201) }]);
    expect(r).toEqual({ erro: 'Valor do campo "cidade" com no máximo 200 letras.' });
  });
  it("recusa chave repetida (sem diferenciar maiúsculas)", () => {
    const r = validarCampos([{ chave: "Cidade", valor: "SP" }, { chave: "cidade", valor: "RJ" }]);
    expect(r).toEqual({ erro: 'Campo "cidade" repetido.' });
  });
});

describe("camposParaTexto", () => {
  it("monta 'chave: valor; chave2: valor2'", () => {
    expect(camposParaTexto({ cidade: "SP", idade: "30" })).toBe("cidade: SP; idade: 30");
  });
  it("vazio vira string vazia", () => {
    expect(camposParaTexto({})).toBe("");
  });
});
