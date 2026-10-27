import { describe, expect, it } from "vitest";
import { lerAgrupar, lerPorPagina } from "@/app/(painel)/_acoes/comum";
import { lerPorPaginaMensagens, POR_PAGINA_ACOES, POR_PAGINA_MENSAGENS } from "@/app/(painel)/_acoes/tipos";
import { urlAcoes, type FiltrosAcoes } from "@/app/(painel)/_acoes/tipos";

describe("lerPorPagina", () => {
  it("aceita só os valores da lista (10, 25, 50, 100, 200, 300)", () => {
    for (const n of POR_PAGINA_ACOES) expect(lerPorPagina(String(n))).toBe(n);
  });
  it("qualquer outra coisa cai em 10", () => {
    expect(lerPorPagina(undefined)).toBe(10);
    expect(lerPorPagina("")).toBe(10);
    expect(lerPorPagina("15")).toBe(10);
    expect(lerPorPagina("lixo")).toBe(10);
  });
});

describe("lerPorPaginaMensagens (revisão final B, item m11)", () => {
  it("aceita só os valores da lista curta da aba Mensagens (10, 25, 50)", () => {
    for (const n of POR_PAGINA_MENSAGENS) expect(lerPorPaginaMensagens(String(n))).toBe(n);
  });
  it("100/200/300 (válidos pra Ações, não pra Mensagens) caem na opção permitida mais próxima: 50", () => {
    expect(lerPorPaginaMensagens("100")).toBe(50);
    expect(lerPorPaginaMensagens("200")).toBe(50);
    expect(lerPorPaginaMensagens("300")).toBe(50);
  });
  it("qualquer outro valor fora da lista cai em 10", () => {
    expect(lerPorPaginaMensagens(undefined)).toBe(10);
    expect(lerPorPaginaMensagens("")).toBe(10);
    expect(lerPorPaginaMensagens("15")).toBe(10);
    expect(lerPorPaginaMensagens("lixo")).toBe(10);
  });
});

describe("lerAgrupar", () => {
  it("tudo exceto 'nao' é agrupado (padrão Sim)", () => {
    expect(lerAgrupar(undefined)).toBe(true);
    expect(lerAgrupar("sim")).toBe(true);
    expect(lerAgrupar("qualquer")).toBe(true);
    expect(lerAgrupar("nao")).toBe(false);
  });
});

describe("urlAcoes", () => {
  const base: FiltrosAcoes = { aba: "todas", tipos: null, agrupar: true, inicio: "", fim: "", por: 10, pagina: 1 };

  it("sem filtro nenhum, a URL é só a base", () => {
    expect(urlAcoes("/acoes", base, {})).toBe("/acoes");
  });

  it("aba diferente de 'todas' entra na query", () => {
    expect(urlAcoes("/acoes", base, { aba: "falhas" })).toBe("/acoes?aba=falhas");
  });

  it("tipos entram em lista separada por vírgula", () => {
    expect(urlAcoes("/acoes", base, { tipos: ["mensagem", "enquete"] })).toBe("/acoes?tipos=mensagem%2Cenquete");
  });

  it("agrupar=false entra como 'nao'; true (padrão) não aparece", () => {
    expect(urlAcoes("/acoes", base, { agrupar: false })).toBe("/acoes?agrupar=nao");
    expect(urlAcoes("/acoes", { ...base, agrupar: false }, { agrupar: true })).toBe("/acoes");
  });

  it("datas entram quando preenchidas", () => {
    expect(urlAcoes("/acoes", base, { inicio: "2026-10-01", fim: "2026-10-31" })).toBe("/acoes?inicio=2026-10-01&fim=2026-10-31");
  });

  it("'por' só aparece quando difere do padrão (10)", () => {
    expect(urlAcoes("/acoes", base, { por: 10 })).toBe("/acoes");
    expect(urlAcoes("/acoes", base, { por: 50 })).toBe("/acoes?por=50");
  });

  it("qualquer mudança que não seja 'pagina' volta pra página 1", () => {
    const naPagina3: FiltrosAcoes = { ...base, pagina: 3 };
    expect(urlAcoes("/acoes", naPagina3, { aba: "falhas" })).toBe("/acoes?aba=falhas");
    expect(urlAcoes("/acoes", naPagina3, { pagina: 4 })).toBe("/acoes?pagina=4");
  });
});
