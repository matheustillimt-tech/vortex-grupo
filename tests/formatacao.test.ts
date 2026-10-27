import { describe, expect, it } from "vitest";
import { aplicarCitacao, aplicarFormatacao, aplicarNegritoItalicoEtc } from "@/src/lib/regras/formatacao";

describe("aplicarNegritoItalicoEtc", () => {
  it("envolve a seleção com o marcador do WhatsApp", () => {
    const r = aplicarNegritoItalicoEtc("abc def", 4, 7, "negrito");
    expect(r.texto).toBe("abc *def*");
    expect(r.texto.slice(r.inicio, r.fim)).toBe("def");
  });

  it("alterna: remove o marcador se a seleção já estiver envolvida", () => {
    const r = aplicarNegritoItalicoEtc("abc *def*", 5, 8, "negrito");
    expect(r.texto).toBe("abc def");
    expect(r.texto.slice(r.inicio, r.fim)).toBe("def");
  });

  it("sem seleção, insere o par de marcadores com o cursor entre eles", () => {
    const r = aplicarNegritoItalicoEtc("abc ", 4, 4, "italico");
    expect(r.texto).toBe("abc __");
    expect(r.inicio).toBe(5);
    expect(r.fim).toBe(5);
  });

  it("tachado e monoespaçado usam seus próprios marcadores", () => {
    expect(aplicarNegritoItalicoEtc("oi", 0, 2, "tachado").texto).toBe("~oi~");
    expect(aplicarNegritoItalicoEtc("oi", 0, 2, "monoespacado").texto).toBe("```oi```");
  });

  it("não remove se só um dos lados tiver o marcador", () => {
    const r = aplicarNegritoItalicoEtc("*abc", 1, 4, "negrito");
    expect(r.texto).toBe("**abc*");
  });
});

describe("aplicarCitacao", () => {
  it("marca a linha do cursor quando não há seleção", () => {
    const r = aplicarCitacao("linha um\nlinha dois", 10, 10);
    expect(r.texto).toBe("linha um\n> linha dois");
  });

  it("alterna: desmarca quando a linha já está citada", () => {
    const r = aplicarCitacao("> linha um", 2, 2);
    expect(r.texto).toBe("linha um");
  });

  it("marca todas as linhas tocadas pela seleção, mesmo com algumas já marcadas", () => {
    const texto = "a\n> b\nc";
    const r = aplicarCitacao(texto, 0, texto.length);
    expect(r.texto).toBe("> a\n> > b\n> c");
  });
});

describe("aplicarFormatacao", () => {
  it("despacha citação pro aplicador de bloco e o resto pro de marcador simples", () => {
    expect(aplicarFormatacao("oi", 0, 2, "citacao").texto).toBe("> oi");
    expect(aplicarFormatacao("oi", 0, 2, "negrito").texto).toBe("*oi*");
  });
});
