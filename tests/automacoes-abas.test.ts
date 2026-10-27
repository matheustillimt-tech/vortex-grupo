import { describe, expect, it } from "vitest";
import { ABAS_AUTOMACOES, comAtivoLocal, FILTROS_PADRAO, lerFiltrosAutomacoes, marcarAtivoLocal, podarAtivoLocal, urlAutomacoes } from "@/app/(painel)/automacoes/abas";

describe("ABAS_AUTOMACOES", () => {
  it("Automações | Sequências", () => {
    expect(ABAS_AUTOMACOES).toEqual([
      { href: "/automacoes", rotulo: "Automações" },
      { href: "/sequencias", rotulo: "Sequências" },
    ]);
  });
});

describe("lerFiltrosAutomacoes", () => {
  it("sem parâmetros: padrão (todos, página 1)", () => {
    expect(lerFiltrosAutomacoes({})).toEqual(FILTROS_PADRAO);
    expect(FILTROS_PADRAO).toEqual({ q: "", gatilho: null, provedor: null, pasta: null, estado: "todos", pagina: 1 });
  });
  it("lê os valores válidos", () => {
    expect(lerFiltrosAutomacoes({ q: " boas ", gatilho: "grupo_cheio", pasta: " Lançamento ", estado: "ativado", pagina: "3" })).toEqual({
      q: "boas", gatilho: "grupo_cheio", provedor: null, pasta: "Lançamento", estado: "ativado", pagina: 3,
    });
  });
  it("descarta valores inválidos", () => {
    expect(lerFiltrosAutomacoes({ gatilho: "outro", estado: "x", pagina: "-2", pasta: "   " })).toEqual(FILTROS_PADRAO);
    expect(lerFiltrosAutomacoes({ pagina: "abc" }).pagina).toBe(1);
    expect(lerFiltrosAutomacoes({ pagina: "2.7" }).pagina).toBe(2);
    expect(lerFiltrosAutomacoes({ estado: "desativado" }).estado).toBe("desativado");
  });
  it("corta a busca em 80 caracteres", () => {
    expect(lerFiltrosAutomacoes({ q: "a".repeat(200) }).q).toHaveLength(80);
  });
  it("gatilho checkout: provedor genérico (sentinela) e por plataforma", () => {
    expect(lerFiltrosAutomacoes({ gatilho: "checkout", provedor: "_geral" })).toMatchObject({ gatilho: "checkout", provedor: "_geral" });
    expect(lerFiltrosAutomacoes({ gatilho: "checkout", provedor: "hotmart" })).toMatchObject({ gatilho: "checkout", provedor: "hotmart" });
    expect(lerFiltrosAutomacoes({ gatilho: "checkout", provedor: "xpto" })).toMatchObject({ gatilho: "checkout", provedor: null });
  });
  it("provedor só vale junto de gatilho checkout: ignorado nos outros gatilhos", () => {
    expect(lerFiltrosAutomacoes({ gatilho: "cronograma", provedor: "hotmart" })).toMatchObject({ gatilho: "cronograma", provedor: null });
  });
});

describe("urlAutomacoes", () => {
  const f = { q: "boas", gatilho: "cronograma" as const, provedor: null, pasta: "L 1", estado: "ativado" as const, pagina: 2 };
  it("sem nada fora do padrão: a própria base", () => {
    expect(urlAutomacoes("/automacoes", FILTROS_PADRAO, {})).toBe("/automacoes");
  });
  it("mantém os filtros e a página quando só muda a página", () => {
    expect(urlAutomacoes("/automacoes", f, { pagina: 3 })).toBe("/automacoes?q=boas&gatilho=cronograma&pasta=L+1&estado=ativado&pagina=3");
  });
  it("mudar filtro volta pra página 1", () => {
    expect(urlAutomacoes("/automacoes", f, { estado: "todos" })).toBe("/automacoes?q=boas&gatilho=cronograma&pasta=L+1");
    expect(urlAutomacoes("/automacoes", f, { pasta: null, gatilho: null })).toBe("/automacoes?q=boas&estado=ativado");
  });
  it("base diferente (aba Automações da campanha)", () => {
    expect(urlAutomacoes("/campanhas/abc/automacoes", f, { estado: "todos" })).toBe("/campanhas/abc/automacoes?q=boas&gatilho=cronograma&pasta=L+1");
  });
  it("checkout com plataforma: leva o `provedor` na URL; sem plataforma (sentinela) também", () => {
    expect(urlAutomacoes("/automacoes", FILTROS_PADRAO, { gatilho: "checkout", provedor: "hotmart" })).toBe("/automacoes?gatilho=checkout&provedor=hotmart");
    expect(urlAutomacoes("/automacoes", FILTROS_PADRAO, { gatilho: "checkout", provedor: "_geral" })).toBe("/automacoes?gatilho=checkout&provedor=_geral");
  });
  it("gatilho que não é checkout nunca leva `provedor`", () => {
    expect(urlAutomacoes("/automacoes", FILTROS_PADRAO, { gatilho: "entrou", provedor: "hotmart" })).toBe("/automacoes?gatilho=entrou");
  });
  it("base com query fixa (aba Automações do webhook): mantém `aba=automacoes` e usa `&`, nunca um segundo `?`", () => {
    expect(urlAutomacoes("/webhooks/123?aba=automacoes", FILTROS_PADRAO, {})).toBe("/webhooks/123?aba=automacoes");
    expect(urlAutomacoes("/webhooks/123?aba=automacoes", f, { pagina: 3 })).toBe(
      "/webhooks/123?aba=automacoes&q=boas&gatilho=cronograma&pasta=L+1&estado=ativado&pagina=3",
    );
    expect(urlAutomacoes("/webhooks/123?aba=automacoes", FILTROS_PADRAO, { estado: "desativado" })).toBe(
      "/webhooks/123?aba=automacoes&estado=desativado",
    );
  });
});

describe("ligar/desligar aparece na hora na lista (teste de 17/10/2026, observação D)", () => {
  const lista = [{ id: "a", ativo: true }, { id: "b", ativo: true }];

  it("depois de Desativar, a linha já mostra desativada (sem esperar recarregar)", () => {
    const local = marcarAtivoLocal({}, ["a"], false, 0);
    expect(comAtivoLocal(lista, local)).toEqual([{ id: "a", ativo: false }, { id: "b", ativo: true }]);
  });

  it("com erro no lote não marca nada (vale a lista do servidor)", () => {
    expect(marcarAtivoLocal({}, ["a", "b"], false, 1)).toEqual({});
    expect(comAtivoLocal(lista, {})).toBe(lista);
  });

  it("lista nova idêntico ao marcado limpa; lista atrasada (ainda Ativado) não volta a mostrar o estado velho", () => {
    const local = { a: false };
    expect(podarAtivoLocal(local, [{ id: "a", ativo: false }])).toEqual({});
    expect(podarAtivoLocal(local, [{ id: "a", ativo: true }])).toBe(local);
    expect(podarAtivoLocal(local, [{ id: "b", ativo: true }])).toEqual({});
  });
});
