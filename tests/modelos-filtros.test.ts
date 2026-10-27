import { describe, expect, it } from "vitest";
import { lerFiltrosModelos, urlModelos } from "@/app/(painel)/modelos/filtros";

describe("lerFiltrosModelos", () => {
  it("padrões", () => {
    expect(lerFiltrosModelos({})).toEqual({ q: "", pasta: null, ordem: "atualizacao", pagina: 1 });
  });
  it("lê e limpa os valores", () => {
    expect(lerFiltrosModelos({ q: "  oi ", pasta: " P ", ordem: "nome", pagina: "3" })).toEqual({ q: "oi", pasta: "P", ordem: "nome", pagina: 3 });
  });
  it("valores inválidos viram padrão", () => {
    expect(lerFiltrosModelos({ ordem: "x", pagina: "-2", pasta: "  " })).toEqual({ q: "", pasta: null, ordem: "atualizacao", pagina: 1 });
  });

  it("aceita 'criacao' (Data de criação)", () => {
    expect(lerFiltrosModelos({ ordem: "criacao" })).toEqual({ q: "", pasta: null, ordem: "criacao", pagina: 1 });
  });
});

describe("urlModelos", () => {
  const base = { q: "oi", pasta: "P", ordem: "nome" as const, pagina: 2 };
  it("mudar filtro volta pra página 1", () => {
    expect(urlModelos(base, { pasta: null })).toBe("/modelos?q=oi&ordem=nome");
  });
  it("mantém a página quando muda a página", () => {
    expect(urlModelos(base, { pagina: 3 })).toBe("/modelos?q=oi&pasta=P&ordem=nome&pagina=3");
  });
  it("sem filtros", () => {
    expect(urlModelos({ q: "", pasta: null, ordem: "atualizacao", pagina: 1 }, {})).toBe("/modelos");
  });
});
