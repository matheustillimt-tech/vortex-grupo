import { describe, expect, it } from "vitest";
import { dbFalso, filtro, type Chamada, type Resposta } from "./apoio/db-falso";
import { FILTROS_PADRAO as filtros } from "@/app/(painel)/automacoes/abas";
import { carregarAutomacoes } from "@/app/(painel)/automacoes/comum";

const CAMP = "33333333-3333-3333-3333-333333333333";

function consultaDePastas(chamadas: Chamada[]) {
  return chamadas.find((c) => c.tabela === "automacoes" && c.filtros.some((f) => f[0] === "not" && f[1] === "pasta"))!;
}

describe("carregarAutomacoes: pastas", () => {
  it("na aba da campanha, só as pastas com automação daquela campanha", async () => {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => (c.tabela === "automacoes" ? { data: [] } : {}));
    await carregarAutomacoes(db, { campanhaId: CAMP, filtros });
    expect(filtro(consultaDePastas(chamadas), "eq", "campanha_id")).toBe(CAMP);
  });

  it("na tela geral, todas as pastas", async () => {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => (c.tabela === "automacoes" && !c.filtros.some((f) => f[0] === "range") ? { data: [{ pasta: "B" }, { pasta: "A" }, { pasta: "B" }] } : { data: [] }));
    const r = await carregarAutomacoes(db, { campanhaId: null, filtros });
    expect(filtro(consultaDePastas(chamadas), "eq", "campanha_id")).toBeUndefined();
    expect(r.pastas).toEqual(["A", "B"]);
  });
});

function consultaPrincipal(chamadas: Chamada[]) {
  return chamadas.find((c) => c.tabela === "automacoes" && c.filtros.some((f) => f[0] === "range"))!;
}

describe("carregarAutomacoes: filtro de gatilho por plataforma (checkout)", () => {
  it("'checkout' + sentinela '_geral': filtra provedor nulo (qualquer plataforma)", async () => {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => (c.tabela === "automacoes" ? { data: [], count: 0 } : {}));
    await carregarAutomacoes(db, { filtros: { ...filtros, gatilho: "checkout", provedor: "_geral" } });
    const principal = consultaPrincipal(chamadas);
    expect(filtro(principal, "eq", "gatilho")).toBe("checkout");
    expect(filtro(principal, "is", "provedor")).toBe(null);
  });

  it("'checkout' + 'hotmart': filtra pela plataforma", async () => {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => (c.tabela === "automacoes" ? { data: [], count: 0 } : {}));
    await carregarAutomacoes(db, { filtros: { ...filtros, gatilho: "checkout", provedor: "hotmart" } });
    const principal = consultaPrincipal(chamadas);
    expect(filtro(principal, "eq", "provedor")).toBe("hotmart");
  });

  it("gatilho que não é checkout: `provedor` nunca entra na consulta", async () => {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => (c.tabela === "automacoes" ? { data: [], count: 0 } : {}));
    await carregarAutomacoes(db, { filtros: { ...filtros, gatilho: "cronograma", provedor: null } });
    const principal = consultaPrincipal(chamadas);
    expect(filtro(principal, "eq", "provedor")).toBeUndefined();
    expect(filtro(principal, "is", "provedor")).toBeUndefined();
  });
});

describe("carregarAutomacoes: acoesDetalhe (lista expandida 'ações em ordem')", () => {
  it("ordena pelo campo `ordem`, mesmo que o banco devolva fora de ordem, e `acoes` conexão o total", async () => {
    const A1 = "11111111-1111-1111-1111-111111111111";
    const { db } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "automacoes" && c.filtros.some((f) => f[0] === "range")) {
        return {
          data: [
            {
              id: A1, nome: "A", gatilho: "entrou", quando: null, provedor: null, produto: null, ativo: false, pasta: null, campanha_id: "c1", campanhas: { nome: "Camp" },
              automacao_acoes: [
                { ordem: 1, tipo: "remover_participante", conteudo: {}, atraso_min: 0 },
                { ordem: 0, tipo: "mensagem", conteudo: { formato: "texto", texto: "oi" }, atraso_min: 0 },
              ],
            },
          ],
          count: 1,
        };
      }
      if (c.tabela === "automacoes") return { data: [] };
      if (c.tabela === "rpc:resumo_automacoes") return { data: [] };
      if (c.tabela === "execucoes") return { data: [] };
      return {};
    });
    const r = await carregarAutomacoes(db, { filtros });
    expect(r.automacoes).toHaveLength(1);
    expect(r.automacoes[0].acoes).toBe(2);
    expect(r.automacoes[0].acoesDetalhe.map((a) => a.tipo)).toEqual(["mensagem", "remover_participante"]);
  });
});
