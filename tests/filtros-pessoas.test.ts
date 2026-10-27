import { describe, expect, it } from "vitest";
import { filtrosParaQuery, filtrosParaRpc, lerCampanhasMultiplas, lerFiltros, MAXIMO_CAMPANHAS_EXPORTACAO } from "@/src/lib/regras/filtros-pessoas";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";

describe("lerFiltros", () => {
  it("vazio vira tudo nulo, página 1", () => {
    expect(lerFiltros({})).toEqual({ campanha: null, grupo: null, situacao: null, tag: null, busca: null, pagina: 1 });
  });
  it("lê os válidos e descarta lixo", () => {
    expect(lerFiltros({ campanha: U1, grupo: U2, situacao: "saiu", tag: "x", q: "(37) 9983", pagina: "3" }))
      .toEqual({ campanha: U1, grupo: U2, situacao: "saiu", tag: null, busca: "379983", pagina: 3 });
  });
  it("grupo sem campanha é ignorado; situação e página inválidas caem no padrão", () => {
    expect(lerFiltros({ grupo: U2, situacao: "qualquer", pagina: "-2" })).toEqual({ campanha: null, grupo: null, situacao: null, tag: null, busca: null, pagina: 1 });
  });
  it("valor repetido na URL usa o primeiro", () => {
    expect(lerFiltros({ campanha: [U1, U2] }).campanha).toBe(U1);
  });
});

describe("filtrosParaRpc e filtrosParaQuery", () => {
  const f = { campanha: U1, grupo: null, situacao: "dentro" as const, tag: U2, busca: "9983", pagina: 2 };
  it("args do RPC", () => {
    expect(filtrosParaRpc(f)).toEqual({ p_campanha: U1, p_grupo: null, p_situacao: "dentro", p_tag: U2, p_busca: "9983" });
  });
  it("query string sem vazios", () => {
    expect(filtrosParaQuery(f)).toBe(`campanha=${U1}&situacao=dentro&tag=${U2}&q=9983&pagina=2`);
    expect(filtrosParaQuery({ ...f, pagina: 1, tag: null, situacao: null, busca: null })).toBe(`campanha=${U1}`);
  });
});

describe("lerCampanhasMultiplas (exportação em massa)", () => {
  it("sem parâmetro: null", () => {
    expect(lerCampanhasMultiplas(undefined)).toBeNull();
  });
  it("lista de uuids válidos, sem repetir", () => {
    expect(lerCampanhasMultiplas(`${U1},${U2},${U1}`)).toEqual([U1, U2]);
  });
  it("descarta o que não é uuid; só lixo (ou vazio) vira lista vazia — a rota responde 400", () => {
    expect(lerCampanhasMultiplas(`${U1},não-é-uuid,`)).toEqual([U1]);
    expect(lerCampanhasMultiplas("x,y,z")).toEqual([]);
    expect(lerCampanhasMultiplas("")).toEqual([]);
  });
  it("corta em 50", () => {
    const muitos = Array.from({ length: 60 }, (_, i) => `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`);
    expect(lerCampanhasMultiplas(muitos.join(","))).toHaveLength(MAXIMO_CAMPANHAS_EXPORTACAO);
  });
});
