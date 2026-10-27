import { describe, expect, it } from "vitest";
import { escaparBusca, filtrosVisaoGeralParaQuery, filtrosVisaoGeralParaRpc, lerFiltrosVisaoGeral } from "@/src/lib/regras/filtros-leads";

const TAG = "11111111-1111-4111-8111-111111111111";

describe("lerFiltrosVisaoGeral", () => {
  it("vazio vira tudo nulo, página 1, 12 por página", () => {
    expect(lerFiltrosVisaoGeral({})).toEqual({ busca: null, tag: null, por: 12, pagina: 1 });
  });
  it("aceita letras na busca (ao contrário da busca de Participações)", () => {
    expect(lerFiltrosVisaoGeral({ q: "Ana Paula" })).toEqual({ busca: "Ana Paula", tag: null, por: 12, pagina: 1 });
  });
  it("tag inválida é descartada; página inválida cai em 1", () => {
    expect(lerFiltrosVisaoGeral({ tag: "x", pagina: "-1" })).toEqual({ busca: null, tag: null, por: 12, pagina: 1 });
  });
  it("lê tag válida e página", () => {
    expect(lerFiltrosVisaoGeral({ tag: TAG, pagina: "3" })).toEqual({ busca: null, tag: TAG, por: 12, pagina: 3 });
  });
  it("valor repetido na URL usa o primeiro", () => {
    expect(lerFiltrosVisaoGeral({ q: ["a", "b"] }).busca).toBe("a");
  });
  it("'por' aceita 12 (padrão) ou 50; qualquer outro valor cai em 12", () => {
    expect(lerFiltrosVisaoGeral({ por: "50" }).por).toBe(50);
    expect(lerFiltrosVisaoGeral({ por: "25" }).por).toBe(12);
    expect(lerFiltrosVisaoGeral({ por: "x" }).por).toBe(12);
  });
});

describe("escaparBusca", () => {
  it("escapa % e _ com barra invertida", () => {
    expect(escaparBusca("100%")).toBe("100\\%");
    expect(escaparBusca("a_b")).toBe("a\\_b");
    expect(escaparBusca("a\\b")).toBe("a\\\\b");
  });
  it("texto sem caractere especial não muda", () => {
    expect(escaparBusca("Ana Paula")).toBe("Ana Paula");
  });
});

describe("filtrosVisaoGeralParaRpc", () => {
  it("escapa a busca antes de mandar pro banco", () => {
    expect(filtrosVisaoGeralParaRpc({ busca: "100%", tag: TAG, por: 12, pagina: 1 })).toEqual({ p_busca: "100\\%", p_tag: TAG });
  });
  it("busca nula fica nula (sem escapar)", () => {
    expect(filtrosVisaoGeralParaRpc({ busca: null, tag: null, por: 12, pagina: 1 })).toEqual({ p_busca: null, p_tag: null });
  });
});

describe("filtrosVisaoGeralParaQuery", () => {
  it("query string sem vazios", () => {
    expect(filtrosVisaoGeralParaQuery({ busca: "ana", tag: TAG, por: 12, pagina: 2 })).toBe(`tag=${TAG}&q=ana&pagina=2`);
    expect(filtrosVisaoGeralParaQuery({ busca: null, tag: null, por: 12, pagina: 1 })).toBe("");
  });
  it("'por' diferente do padrão (12) entra na query", () => {
    expect(filtrosVisaoGeralParaQuery({ busca: null, tag: null, por: 50, pagina: 1 })).toBe("por=50");
  });
});
