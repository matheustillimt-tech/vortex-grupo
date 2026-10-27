import { describe, expect, it } from "vitest";
import {
  CABECALHO_BLOQUEADOS,
  CABECALHO_FUNIL,
  CABECALHO_LEADS,
  CABECALHO_NUMEROS_AUTOMACAO,
  CABECALHO_NUMEROS_AUTOMACAO_STATUS,
  CABECALHO_PESSOAS,
  dataCsv,
  dataDoArquivo,
  linhaCsvBloqueado,
  linhaCsvFunil,
  linhaCsvLead,
  linhaCsvPessoa,
  linhaNumeroAutomacao,
  linhaNumeroAutomacaoStatus,
  montarCsv,
} from "@/src/lib/regras/csv";

describe("montarCsv", () => {
  it("BOM, ponto e vírgula, CRLF", () => {
    expect(montarCsv(["a", "b"], [["1", "2"]])).toBe("﻿a;b\r\n1;2\r\n");
  });
  it("aspas quando tem ; aspas ou quebra de linha", () => {
    expect(montarCsv(["x"], [['a;b'], ['diz "oi"'], ["l1\nl2"]])).toBe('﻿x\r\n"a;b"\r\n"diz ""oi"""\r\n"l1\nl2"\r\n');
  });
  it("protege contra fórmula", () => {
    expect(montarCsv(["x"], [["=1+1"], ["+55"], ["-2"], ["@a"]])).toBe("﻿x\r\n'=1+1\r\n'+55\r\n'-2\r\n'@a\r\n");
  });
});

describe("datas", () => {
  it("dataCsv em Brasília", () => {
    expect(dataCsv("2026-10-16T15:05:00Z")).toBe("16/10/2026 12:05");
    expect(dataCsv(null)).toBe("");
  });
  it("dataDoArquivo em Brasília", () => {
    expect(dataDoArquivo(new Date("2026-10-17T02:00:00Z"))).toBe("2026-10-16");
  });
});

describe("linhaCsvPessoa", () => {
  it("monta as colunas na ordem do cabeçalho", () => {
    expect(CABECALHO_PESSOAS).toEqual(["Telefone", "Campanha", "Grupo", "Entrou em", "Saiu em", "Motivo da saída", "Situação", "Tags"]);
    const base = { participante_id: "p", campanha_id: "c", grupo_id: "g", campanha: "Aulão", grupo: "AULÃO #01", telefone: "5537" + "980001001" };
    expect(linhaCsvPessoa({ ...base, entrou_em: "2026-10-16T15:05:00Z", saiu_em: null, motivo_saida: null, tags: ["Aulão", "VIP"] }))
      .toEqual(["55 37 " + "98000-1001", "Aulão", "AULÃO #01", "16/10/2026 12:05", "", "", "No grupo", "Aulão, VIP"]);
    expect(linhaCsvPessoa({ ...base, entrou_em: "2026-10-16T15:05:00Z", saiu_em: "2026-10-16T16:00:00Z", motivo_saida: "duplicado", tags: [] }).slice(4, 7))
      .toEqual(["16/10/2026 13:00", "Duplicado", "Saiu"]);
  });
});

describe("linhaCsvBloqueado", () => {
  it("monta as colunas na ordem do cabeçalho, traduzindo a origem", () => {
    expect(CABECALHO_BLOQUEADOS).toEqual(["Telefone", "Motivo", "Origem", "Criado em"]);
    const base = { telefone: "5537" + "980001001", created_at: "2026-10-16T15:05:00Z" };
    expect(linhaCsvBloqueado({ ...base, motivo: "spam de link", origem: "manual" }))
      .toEqual(["55 37 " + "98000-1001", "spam de link", "À mão", "16/10/2026 12:05"]);
    expect(linhaCsvBloqueado({ ...base, motivo: null, origem: "csv" })).toEqual(["55 37 " + "98000-1001", "", "Planilha", "16/10/2026 12:05"]);
    expect(linhaCsvBloqueado({ ...base, motivo: null, origem: "botao" })[2]).toBe("Botão");
    expect(linhaCsvBloqueado({ ...base, motivo: null, origem: "outra" })[2]).toBe("outra");
  });
});

describe("linhaNumeroAutomacao / linhaNumeroAutomacaoStatus ('Exportar números' da lista de automações)", () => {
  it("cabeçalhos", () => {
    expect(CABECALHO_NUMEROS_AUTOMACAO).toEqual(["Telefone"]);
    expect(CABECALHO_NUMEROS_AUTOMACAO_STATUS).toEqual(["Telefone", "Situação"]);
  });
  it("telefone legível, sem status", () => {
    expect(linhaNumeroAutomacao("5537" + "980001001")).toEqual(["55 37 " + "98000-1001"]);
  });
  it("com status, traduzindo cada um", () => {
    expect(linhaNumeroAutomacaoStatus({ telefone: "5537" + "980001001", status: "fila" })).toEqual(["55 37 " + "98000-1001", "Fila"]);
    expect(linhaNumeroAutomacaoStatus({ telefone: "5537" + "980001001", status: "processando" })[1]).toBe("Processando");
    expect(linhaNumeroAutomacaoStatus({ telefone: "5537" + "980001001", status: "ok" })[1]).toBe("Sucesso");
    expect(linhaNumeroAutomacaoStatus({ telefone: "5537" + "980001001", status: "erro" })[1]).toBe("Falha");
    expect(linhaNumeroAutomacaoStatus({ telefone: "5537" + "980001001", status: "outro" })[1]).toBe("outro");
  });
});

describe("linhaCsvLead (exportação 'Leads' da Visão geral — Etapa 3I, Tarefa 1)", () => {
  it("cabeçalho e colunas na ordem: Nome, Número, Campos, Tags", () => {
    expect(CABECALHO_LEADS).toEqual(["Nome", "Número", "Campos", "Tags"]);
    expect(linhaCsvLead({ telefone: "5537" + "980001001", nome: "Ana", campos: { cidade: "SP", idade: "30" }, tags: ["VIP", "Comprador"] }))
      .toEqual(["Ana", "55 37 " + "98000-1001", "cidade: SP; idade: 30", "VIP, Comprador"]);
  });
  it("sem nome, sem campos, sem tags", () => {
    expect(linhaCsvLead({ telefone: "5537" + "980001001", nome: null, campos: {}, tags: [] })).toEqual(["", "55 37 " + "98000-1001", "", ""]);
  });
});

describe("linhaCsvFunil (exportação do Funil de campanhas — Etapa 3I, Tarefa 3)", () => {
  it("cabeçalho", () => {
    expect(CABECALHO_FUNIL).toEqual(["Campanha", "Cliques", "Entradas", "Percentual de entrada", "Saídas", "Participantes", "Administradores", "Leads", "Grupos", "Grupos cheios"]);
  });
  it("percentual de entrada e leads (participantes - admins) calculados", () => {
    expect(linhaCsvFunil({ nome: "Campanha X", cliques: 200, entradas: 50, saidas: 10, participantes: 40, admins: 5, grupos: 3, gruposCheios: 1 }))
      .toEqual(["Campanha X", "200", "50", "25,00", "10", "40", "5", "35", "3", "1"]);
  });
  it("sem cliques: percentual 0,00 sem dividir por zero", () => {
    expect(linhaCsvFunil({ nome: "Y", cliques: 0, entradas: 0, saidas: 0, participantes: 0, admins: 0, grupos: 0, gruposCheios: 0 })[3]).toBe("0,00");
  });
});
