import { describe, expect, it } from "vitest";
import { filtrosBloqueadosParaQuery, lerFiltrosBloqueados, urlBloqueados } from "@/src/lib/regras/filtros-bloqueados";

describe("lerFiltrosBloqueados", () => {
  it("vazio vira tudo nulo, página 1, ordem recentes", () => {
    expect(lerFiltrosBloqueados({})).toEqual({ busca: null, inicio: null, fim: null, ordem: "recentes", pagina: 1 });
  });
  it("lê os válidos e descarta lixo", () => {
    expect(lerFiltrosBloqueados({ q: "(37) 9983", inicio: "2026-10-01", fim: "2026-10-16", ordem: "antigos", pagina: "3" }))
      .toEqual({ busca: "379983", inicio: "2026-10-01", fim: "2026-10-16", ordem: "antigos", pagina: 3 });
  });
  it("data mal formada e página inválida caem no padrão", () => {
    expect(lerFiltrosBloqueados({ inicio: "16/10/2026", fim: "lixo", pagina: "-2", ordem: "lixo" }))
      .toEqual({ busca: null, inicio: null, fim: null, ordem: "recentes", pagina: 1 });
  });
  it("valor repetido na URL usa o primeiro", () => {
    expect(lerFiltrosBloqueados({ q: ["111", "222"] }).busca).toBe("111");
  });
});

describe("filtrosBloqueadosParaQuery e urlBloqueados", () => {
  const f = { busca: "9983", inicio: "2026-10-01", fim: "2026-10-16", ordem: "antigos" as const, pagina: 2 };
  it("query string sem vazios", () => {
    expect(filtrosBloqueadosParaQuery(f)).toBe("q=9983&inicio=2026-10-01&fim=2026-10-16&ordem=antigos&pagina=2");
    expect(filtrosBloqueadosParaQuery({ busca: null, inicio: null, fim: null, ordem: "recentes", pagina: 1 })).toBe("");
  });
  it("urlBloqueados muda de filtro e volta pra página 1", () => {
    expect(urlBloqueados(f, { busca: "111" })).toBe("/anti-spam?q=111&inicio=2026-10-01&fim=2026-10-16&ordem=antigos");
  });
  it("urlBloqueados com só a página mantém os outros filtros", () => {
    expect(urlBloqueados(f, { pagina: 3 })).toBe("/anti-spam?q=9983&inicio=2026-10-01&fim=2026-10-16&ordem=antigos&pagina=3");
  });
  it("sem filtro nenhum devolve a rota pura", () => {
    expect(urlBloqueados({ busca: null, inicio: null, fim: null, ordem: "recentes", pagina: 1 }, { pagina: 1 })).toBe("/anti-spam");
  });
});
