import { describe, expect, it } from "vitest";
import { csvDaSerie, lerIntervalo, nomeArquivoGrafico, slugDoTitulo } from "@/src/lib/regras/grafico-exportar";

describe("slugDoTitulo", () => {
  it("remove acento e espaço, baixa a caixa", () => {
    expect(slugDoTitulo("Cliques diários")).toBe("cliques-diarios");
  });
  it("tira hífen das pontas", () => {
    expect(slugDoTitulo(" Atividade Diária! ")).toBe("atividade-diaria");
  });
});

describe("nomeArquivoGrafico", () => {
  it("monta slug-data.ext com a data em Brasília", () => {
    // 2026-10-17T02:00:00Z = 2026-10-16 23:00 em Brasília (UTC-3): ainda 16/10.
    expect(nomeArquivoGrafico("Cliques diários", "svg", new Date("2026-10-17T02:00:00Z"))).toBe("cliques-diarios-2026-10-16.svg");
    expect(nomeArquivoGrafico("Cliques diários", "png", new Date("2026-10-17T05:00:00Z"))).toBe("cliques-diarios-2026-10-17.png");
  });
  it("título sem letra/número (slug vazio) cai pra 'grafico'", () => {
    expect(nomeArquivoGrafico("!!!", "csv", new Date("2026-10-17T05:00:00Z"))).toBe("grafico-2026-10-17.csv");
    expect(nomeArquivoGrafico("", "svg", new Date("2026-10-17T05:00:00Z"))).toBe("grafico-2026-10-17.svg");
  });
});

describe("csvDaSerie", () => {
  it("cabeçalho 'Data;{titulo}', datas dd/mm/aaaa, separador ;", () => {
    const csv = csvDaSerie("Clicks", [
      { data: "2026-10-10", valor: 5 },
      { data: "2026-10-11", valor: 12 },
    ]);
    const linhas = csv.replace(/^﻿/, "").split("\r\n").filter(Boolean);
    expect(linhas[0]).toBe("Data;Clicks");
    expect(linhas[1]).toBe("10/10/2026;5");
    expect(linhas[2]).toBe("11/10/2026;12");
  });
});

describe("lerIntervalo", () => {
  it("datas válidas e dentro do limite voltam como estão", () => {
    expect(lerIntervalo("2026-10-01", "2026-10-10")).toEqual({ de: "2026-10-01", ate: "2026-10-10" });
  });
  it("data inválida vira null", () => {
    expect(lerIntervalo("2026-13-40", "2026-10-10")).toBeNull();
    expect(lerIntervalo("não é data", "2026-10-10")).toBeNull();
  });
  it("intervalo invertido (fim antes do início) vira null", () => {
    expect(lerIntervalo("2026-10-10", "2026-10-01")).toBeNull();
  });
  it("mais de maxDias (padrão 90) vira null", () => {
    expect(lerIntervalo("2026-01-01", "2026-12-31")).toBeNull();
  });
  it("exatamente no limite continua válido", () => {
    expect(lerIntervalo("2026-01-01", "2026-04-01", 90)).toEqual({ de: "2026-01-01", ate: "2026-04-01" });
  });
  it("maxDias customizado", () => {
    expect(lerIntervalo("2026-10-01", "2026-10-05", 3)).toBeNull();
    expect(lerIntervalo("2026-10-01", "2026-10-04", 3)).toEqual({ de: "2026-10-01", ate: "2026-10-04" });
  });
});
