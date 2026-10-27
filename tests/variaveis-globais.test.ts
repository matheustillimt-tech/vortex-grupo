import { describe, expect, it } from "vitest";
import { linhasDeValores, ROTULO_TIPO_VARIAVEL, TIPOS_VARIAVEL, validarValorPorTipo, validarVariavelGlobal } from "@/src/lib/regras/variaveis-globais";

describe("TIPOS_VARIAVEL e ROTULO_TIPO_VARIAVEL", () => {
  it("tem os 4 tipos com rótulo", () => {
    expect(TIPOS_VARIAVEL).toEqual(["texto", "link", "data", "numero"]);
    expect(ROTULO_TIPO_VARIAVEL).toEqual({ texto: "Texto", link: "Link", data: "Data", numero: "Número" });
  });
});

describe("validarVariavelGlobal", () => {
  it("usa validarChave pra chave", () => {
    expect(validarVariavelGlobal({ chave: "Cupom", tipo: "texto", categoria: null })).toEqual({
      ok: false,
      erro: "A chave aceita só letras minúsculas sem acento e _ (2 a 30).",
    });
    expect(validarVariavelGlobal({ chave: "link_grupo", tipo: "texto", categoria: null })).toEqual({
      ok: false,
      erro: "{link_grupo} já é preenchida pela campanha.",
    });
  });

  it("recusa tipo inválido", () => {
    expect(validarVariavelGlobal({ chave: "cupom", tipo: "moeda", categoria: null })).toEqual({ ok: false, erro: "Tipo inválido." });
  });

  it("categoria: null ok, 1 a 40 ok, vazia ou maior recusa", () => {
    expect(validarVariavelGlobal({ chave: "cupom", tipo: "texto", categoria: null })).toEqual({ ok: true });
    expect(validarVariavelGlobal({ chave: "cupom", tipo: "texto", categoria: "Vendas" })).toEqual({ ok: true });
    expect(validarVariavelGlobal({ chave: "cupom", tipo: "texto", categoria: "" })).toMatchObject({ ok: false });
    expect(validarVariavelGlobal({ chave: "cupom", tipo: "texto", categoria: "a".repeat(41) })).toMatchObject({ ok: false });
  });
});

describe("validarValorPorTipo", () => {
  it("vazio é sempre permitido", () => {
    for (const tipo of TIPOS_VARIAVEL) expect(validarValorPorTipo(tipo, "")).toBeNull();
  });

  it("link: precisa começar com http(s)://", () => {
    expect(validarValorPorTipo("link", "https://x.com")).toBeNull();
    expect(validarValorPorTipo("link", "http://x.com")).toBeNull();
    expect(validarValorPorTipo("link", "ftp://x.com")).not.toBeNull();
    expect(validarValorPorTipo("link", "não é link")).not.toBeNull();
  });

  it("data: dd/mm/aaaa válida", () => {
    expect(validarValorPorTipo("data", "16/10/2026")).toBeNull();
    expect(validarValorPorTipo("data", "2026-10-16")).not.toBeNull();
    expect(validarValorPorTipo("data", "31/02/2026")).not.toBeNull();
    expect(validarValorPorTipo("data", "32/01/2026")).not.toBeNull();
  });

  it("numero: inteiro ou com vírgula decimal", () => {
    expect(validarValorPorTipo("numero", "10")).toBeNull();
    expect(validarValorPorTipo("numero", "10,5")).toBeNull();
    expect(validarValorPorTipo("numero", "10.5")).not.toBeNull();
    expect(validarValorPorTipo("numero", "dez")).not.toBeNull();
  });

  it("texto: aceita qualquer coisa", () => {
    expect(validarValorPorTipo("texto", "qualquer coisa")).toBeNull();
  });
});

describe("linhasDeValores", () => {
  it("globais primeiro (alfabética), depois só-campanha", () => {
    const globais = [
      { chave: "zulu", tipo: "texto" },
      { chave: "cupom", tipo: "link" },
    ];
    const valores = [
      { chave: "cupom", valor: "https://x.com" },
      { chave: "so_campanha", valor: "y" },
    ];
    expect(linhasDeValores(globais, valores)).toEqual([
      { chave: "cupom", tipo: "link", valor: "https://x.com", global: true },
      { chave: "zulu", tipo: "texto", valor: "", global: true },
      { chave: "so_campanha", tipo: "texto", valor: "y", global: false },
    ]);
  });

  it("sem globais e sem valores dá lista vazia", () => {
    expect(linhasDeValores([], [])).toEqual([]);
  });
});
