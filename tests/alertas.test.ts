import { describe, expect, it } from "vitest";
import {
  agruparAlertas,
  agruparValido,
  contaDoAlerta,
  dataAlertaValida,
  filtrosAlertasParaQuery,
  INFO_ALERTA,
  lerFiltrosAlertas,
  TIPOS_ALERTA,
  tipoAlertaValido,
  urlAlertas,
  type LinhaAlerta,
} from "@/src/lib/regras/alertas";

const CONTAS = [
  { id: "11111111-1111-1111-1111-111111111111", nome: "Vendas 1" },
  { id: "22222222-2222-2222-2222-222222222222", nome: "Vendas 2" },
];

function linha(parcial: Partial<LinhaAlerta>): LinhaAlerta {
  return { id: "a1", created_at: "2026-10-16T12:00:00Z", tipo: "grupo_cheio", texto: "x", campanha_id: null, conexao_id: null, visto: false, ...parcial };
}

describe("tipoAlertaValido", () => {
  it("aceita todos os tipos da tabela", () => {
    for (const t of TIPOS_ALERTA) expect(tipoAlertaValido(t)).toBe(true);
  });

  it("rejeita tipo desconhecido e não-string", () => {
    expect(tipoAlertaValido("xyz")).toBe(false);
    expect(tipoAlertaValido(undefined)).toBe(false);
  });
});

describe("INFO_ALERTA", () => {
  it("tem rótulo e ícone pt-BR para cada tipo", () => {
    for (const t of TIPOS_ALERTA) {
      expect(INFO_ALERTA[t].rotulo).toBeTruthy();
      expect(INFO_ALERTA[t].icone).toBeTruthy();
    }
  });
});

describe("agruparValido / dataAlertaValida", () => {
  it("agruparValido aceita só os 4 valores", () => {
    expect(agruparValido("tipo")).toBe(true);
    expect(agruparValido("conta")).toBe(true);
    expect(agruparValido("data")).toBe(true);
    expect(agruparValido("nenhum")).toBe(true);
    expect(agruparValido("outro")).toBe(false);
  });

  it("dataAlertaValida exige AAAA-MM-DD", () => {
    expect(dataAlertaValida("2026-10-16")).toBe(true);
    expect(dataAlertaValida("16/10/2026")).toBe(false);
    expect(dataAlertaValida("")).toBe(false);
  });
});

describe("contaDoAlerta", () => {
  it("usa conexao_id quando presente (dado de verdade)", () => {
    expect(contaDoAlerta({ conexao_id: CONTAS[1].id, texto: "Número Vendas 1 caiu: desconectado" }, CONTAS)).toEqual(CONTAS[1]);
  });

  it("conexao_id de conexão removida (não está mais na lista): null, mesmo citando outra conexão no texto", () => {
    expect(contaDoAlerta({ conexao_id: "999" + "99999-9999-9999-9999-999" + "999999999", texto: "Número Vendas 1 caiu" }, CONTAS)).toBeNull();
  });

  it("sem conexao_id (linha antiga): cai no fallback do nome no texto", () => {
    expect(contaDoAlerta({ conexao_id: null, texto: "Número Vendas 1 caiu: desconectado" }, CONTAS)).toEqual(CONTAS[0]);
  });

  it("sem conexao_id e nenhuma conexão no texto: null", () => {
    expect(contaDoAlerta({ conexao_id: null, texto: "Grupo Turma A encheu (campanha X)" }, CONTAS)).toBeNull();
  });
});

describe("lerFiltrosAlertas", () => {
  it("padrão sem parâmetros", () => {
    expect(lerFiltrosAlertas({})).toEqual({ tipo: "", conta: "", inicio: null, fim: null, agrupar: "nenhum", pagina: 1 });
  });

  it("tipo e agrupar inválidos caem pro vazio/nenhum", () => {
    expect(lerFiltrosAlertas({ tipo: "lixo", agrupar: "lixo" })).toMatchObject({ tipo: "", agrupar: "nenhum" });
  });

  it("conexão que não é uuid vira vazio", () => {
    expect(lerFiltrosAlertas({ conta: "não-é-uuid" }).conta).toBe("");
    expect(lerFiltrosAlertas({ conta: CONTAS[0].id }).conta).toBe(CONTAS[0].id);
  });

  it("datas mal formadas viram null", () => {
    expect(lerFiltrosAlertas({ de: "10-2026", ate: "2026-10-16" })).toMatchObject({ inicio: null, fim: "2026-10-16" });
  });

  it("página não numérica ou <= 0 vira 1", () => {
    expect(lerFiltrosAlertas({ pagina: "0" }).pagina).toBe(1);
    expect(lerFiltrosAlertas({ pagina: "abc" }).pagina).toBe(1);
    expect(lerFiltrosAlertas({ pagina: "3" }).pagina).toBe(3);
  });
});

describe("filtrosAlertasParaQuery / urlAlertas", () => {
  it("sem filtro nenhum devolve string vazia e endereço limpo", () => {
    const f = lerFiltrosAlertas({});
    expect(filtrosAlertasParaQuery(f)).toBe("");
    expect(urlAlertas(f, {})).toBe("/alertas");
  });

  it("monta a query com os filtros presentes", () => {
    const f = lerFiltrosAlertas({ tipo: "grupo_cheio", agrupar: "tipo", de: "2026-10-01", pagina: "2" });
    expect(filtrosAlertasParaQuery(f)).toBe("tipo=grupo_cheio&de=2026-10-01&agrupar=tipo&pagina=2");
  });

  it("mudar um filtro volta pra página 1", () => {
    const f = lerFiltrosAlertas({ pagina: "3" });
    expect(urlAlertas(f, { tipo: "numero_caiu" })).toBe("/alertas?tipo=numero_caiu");
  });

  it("trocar de página preserva os outros filtros", () => {
    const f = lerFiltrosAlertas({ tipo: "grupo_cheio" });
    expect(urlAlertas(f, { pagina: 2 })).toBe("/alertas?tipo=grupo_cheio&pagina=2");
  });
});

describe("agruparAlertas", () => {
  const linhas = [
    linha({ id: "1", tipo: "grupo_cheio", texto: "Grupo A encheu", created_at: "2026-10-16T10:00:00Z" }),
    linha({ id: "2", tipo: "numero_caiu", texto: "Número Vendas 1 caiu", created_at: "2026-10-16T09:00:00Z" }),
    linha({ id: "3", tipo: "numero_caiu", texto: "Número Vendas 2 caiu", created_at: "2026-10-15T09:00:00Z" }),
    linha({ id: "4", tipo: "grupo_sumiu", texto: "Grupo B sumiu", created_at: "2026-10-14T09:00:00Z" }),
  ];

  it("nenhum: um grupo só, sem rótulo, na ordem recebida", () => {
    const g = agruparAlertas(linhas, "nenhum");
    expect(g).toHaveLength(1);
    expect(g[0].linhas.map((l) => l.id)).toEqual(["1", "2", "3", "4"]);
  });

  it("lista vazia e 'nenhum' não gera grupo", () => {
    expect(agruparAlertas([], "nenhum")).toEqual([]);
  });

  it("tipo: um grupo por tipo, na ordem de TIPOS_ALERTA", () => {
    const g = agruparAlertas(linhas, "tipo");
    expect(g.map((x) => x.chave)).toEqual(["grupo_cheio", "numero_caiu", "grupo_sumiu"]);
    expect(g.find((x) => x.chave === "numero_caiu")!.linhas.map((l) => l.id)).toEqual(["2", "3"]);
  });

  it("conexão: agrupa por conexao_id (ou, faltando, pelo nome no texto); sem nenhuma conexão cai em 'Sem conexão'", () => {
    const g = agruparAlertas(linhas, "conta", CONTAS);
    const rotulos = g.map((x) => x.rotulo).sort();
    expect(rotulos).toEqual(["Sem conexão", "Vendas 1", "Vendas 2"]);
    expect(g.find((x) => x.rotulo === "Vendas 1")!.linhas.map((l) => l.id)).toEqual(["2"]);
  });

  it("conexão: conexao_id manda mesmo quando o texto cita outra conexão", () => {
    const g = agruparAlertas([linha({ id: "5", conexao_id: CONTAS[1].id, texto: "Número Vendas 1 caiu" })], "conta", CONTAS);
    expect(g).toEqual([{ chave: CONTAS[1].id, rotulo: "Vendas 2", linhas: [expect.objectContaining({ id: "5" })] }]);
  });

  it("data: um grupo por dia em Brasília, do mais novo pro mais antigo", () => {
    const g = agruparAlertas(linhas, "data");
    expect(g.map((x) => x.chave)).toEqual(["2026-10-16", "2026-10-15", "2026-10-14"]);
    expect(g[0].linhas.map((l) => l.id)).toEqual(["1", "2"]);
  });
});
