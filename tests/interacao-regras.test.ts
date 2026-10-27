import { describe, expect, it } from "vitest";
import { algumBlocoSalvando, deveSalvarAoSair, enterNaPropriaLinha, textoConfirmarDesativarGrupos } from "@/src/lib/regras/interacao";

describe("enterNaPropriaLinha (revisão final B, item 3)", () => {
  it("Enter na própria linha (target === currentTarget) navega", () => {
    const linha = {};
    expect(enterNaPropriaLinha("Enter", linha, linha)).toBe(true);
  });

  it("Enter borbulhando de um controle interno (target !== currentTarget) não navega", () => {
    const linha = {};
    const checkbox = {};
    expect(enterNaPropriaLinha("Enter", checkbox, linha)).toBe(false);
  });

  it("outra tecla não navega mesmo na própria linha", () => {
    const linha = {};
    expect(enterNaPropriaLinha("Tab", linha, linha)).toBe(false);
  });
});

describe("deveSalvarAoSair (revisão final B, item 4)", () => {
  it("valor idêntico ao último salvo: não salva", () => {
    expect(deveSalvarAoSair("5", "5")).toBe(false);
  });

  it("valor diferente do último salvo: salva", () => {
    expect(deveSalvarAoSair("7", "5")).toBe(true);
    expect(deveSalvarAoSair("", "5")).toBe(true);
  });
});

describe("algumBlocoSalvando (revisão final B, item m4)", () => {
  it("nenhum bloco salvando: não desabilita", () => {
    expect(algumBlocoSalvando(null)).toBe(false);
  });

  it("qualquer bloco salvando (mesmo um diferente do controle em questão): desabilita todos", () => {
    expect(algumBlocoSalvando("entrou")).toBe(true);
    expect(algumBlocoSalvando("saiu")).toBe(true);
  });
});

describe("textoConfirmarDesativarGrupos (revisão final B, item m5)", () => {
  it("descreve desativação, não exclusão — grupos ficam na lista esmaecidos e o sistema para de usá-los", () => {
    const texto = textoConfirmarDesativarGrupos(3);
    expect(texto).toContain("Desativar 3");
    expect(texto).toContain("esmaecidos");
    expect(texto).toContain("sistema para de usá-los");
    expect(texto.toLowerCase()).not.toContain("excluir");
  });
});
