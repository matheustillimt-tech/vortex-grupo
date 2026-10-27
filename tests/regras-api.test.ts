import { describe, expect, it } from "vitest";
import { entradaAcaoDaApi, quandoDaApi } from "@/src/lib/regras/api";

describe("quandoDaApi", () => {
  it("ausente = agora; ISO com fuso vira Brasília; sem fuso já é Brasília; resto é erro", () => {
    expect(quandoDaApi(undefined)).toEqual({ ok: true, quando: "agora" });
    expect(quandoDaApi(null)).toEqual({ ok: true, quando: "agora" });
    expect(quandoDaApi("2099-01-01T13:00:00Z")).toEqual({ ok: true, quando: "2099-01-01T10:00" });
    expect(quandoDaApi("2099-01-01T10:00:00-03:00")).toEqual({ ok: true, quando: "2099-01-01T10:00" });
    expect(quandoDaApi("2099-01-01T10:00")).toEqual({ ok: true, quando: "2099-01-01T10:00" });
    expect(quandoDaApi("2099-01-01T10:00:30")).toEqual({ ok: true, quando: "2099-01-01T10:00" });
    expect(quandoDaApi("2099-01-01T10:00:30.123")).toEqual({ ok: true, quando: "2099-01-01T10:00" });
    expect(quandoDaApi("amanhã").ok).toBe(false);
    expect(quandoDaApi(123).ok).toBe(false);
    expect(quandoDaApi("2099-13-45T99:00:00Z").ok).toBe(false);
  });
});

describe("entradaAcaoDaApi", () => {
  it("traduz o corpo pro formato do assistente (categoria campanha, sem importante)", () => {
    const r = entradaAcaoDaApi({ campanhas: ["a"], tipo: "abrir", conteudo: {}, agendar_para: "2099-01-01T13:00:00Z", importante: true });
    expect(r).toEqual({
      ok: true,
      entrada: { categoria: "campanha", campanhas: ["a"], projetoId: null, tipo: "abrir", contas: null, grupos: null, conteudo: {}, importante: false, quando: "2099-01-01T10:00" },
    });
  });

  it("corpo que não é objeto ou sem campanhas", () => {
    expect(entradaAcaoDaApi([])).toEqual({ ok: false, erro: "Corpo inválido: envie um objeto JSON." });
    expect(entradaAcaoDaApi(null)).toEqual({ ok: false, erro: "Corpo inválido: envie um objeto JSON." });
    expect(entradaAcaoDaApi({ tipo: "abrir" })).toEqual({ ok: false, erro: "Informe campanhas (lista de ids)." });
  });
});
