import { describe, expect, it } from "vitest";
import {
  ANTISPAM_CONTAS_PADRAO,
  FONTE_BLOQUEADOS,
  contaPodeRemover,
  descreverBloqueio,
  lerAntispamContas,
  textoAlertaSemConta,
  validarAntispamContas,
  validarNomeBlacklist,
} from "@/src/lib/regras/antispam";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

describe("FONTE_BLOQUEADOS", () => {
  it("é a view que junta bloqueados e blacklists ativas", () => {
    expect(FONTE_BLOQUEADOS).toBe("bloqueados_efetivos");
  });
});

describe("descreverBloqueio", () => {
  it("bloqueio manual (tabela bloqueados): fonte Anti-spam, com motivo e data", () => {
    expect(descreverBloqueio({ motivo: "spam", created_at: "2026-10-01T00:00:00Z" }, null)).toEqual({
      fonte: "Anti-spam",
      motivo: "spam",
      criadoEm: "2026-10-01T00:00:00Z",
    });
  });
  it("só na blacklist (ativa): fonte 'Blacklist: NOME', sem motivo nem data", () => {
    expect(descreverBloqueio(null, { nome: "Concorrentes" })).toEqual({ fonte: "Blacklist: Concorrentes", motivo: null, criadoEm: null });
  });
  it("nos dois: Anti-spam prevalece (é o bloqueio com motivo/data)", () => {
    expect(descreverBloqueio({ motivo: null, created_at: "2026-10-01T00:00:00Z" }, { nome: "Concorrentes" })).toMatchObject({ fonte: "Anti-spam" });
  });
  it("em nenhum dos dois: null (não bloqueado)", () => {
    expect(descreverBloqueio(null, null)).toBeNull();
  });
});

describe("lerAntispamContas", () => {
  it.each([undefined, null, "x", 1, [], {}])("valor estranho (%j) vira desligado", (v) => {
    expect(lerAntispamContas(v)).toEqual(ANTISPAM_CONTAS_PADRAO);
  });
  it("só ligado === true liga; conexões inválidas e repetidas somem", () => {
    expect(lerAntispamContas({ ligado: "sim", contas: [A] })).toEqual({ ligado: false, contas: [A] });
    expect(lerAntispamContas({ ligado: true, contas: [A, A, "x", 3, B] })).toEqual({ ligado: true, contas: [A, B] });
  });
});

describe("contaPodeRemover", () => {
  it("desligado: qualquer conexão (até sem conexão) remove — comportamento de antes", () => {
    expect(contaPodeRemover({ ligado: false, contas: [] }, B)).toBe(true);
    expect(contaPodeRemover({ ligado: false, contas: [A] }, null)).toBe(true);
  });
  it("ligado: só as conexões escolhidas", () => {
    expect(contaPodeRemover({ ligado: true, contas: [A] }, A)).toBe(true);
    expect(contaPodeRemover({ ligado: true, contas: [A] }, B)).toBe(false);
    expect(contaPodeRemover({ ligado: true, contas: [A] }, null)).toBe(false);
  });
});

describe("textoAlertaSemConta", () => {
  it("texto fixo do alerta", () => {
    expect(textoAlertaSemConta("Grupo 3", "Conexão B")).toBe("Anti-spam: número bloqueado no grupo Grupo 3, mas a conexão Conexão B não está autorizada a remover.");
  });
});

describe("validarAntispamContas", () => {
  it("aceita desligado sem conexões e ligado com conexões (sem repetir)", () => {
    expect(validarAntispamContas({ ligado: false, contas: [] })).toEqual({ ok: true, valor: { ligado: false, contas: [] } });
    expect(validarAntispamContas({ ligado: true, contas: [A, A] })).toEqual({ ok: true, valor: { ligado: true, contas: [A] } });
  });
  it("recusa ligado sem conexão, formato errado e id inválido", () => {
    expect(validarAntispamContas({ ligado: true, contas: [] })).toMatchObject({ ok: false });
    expect(validarAntispamContas(null)).toMatchObject({ ok: false });
    expect(validarAntispamContas({ ligado: "sim", contas: [] })).toMatchObject({ ok: false });
    expect(validarAntispamContas({ ligado: false, contas: ["x"] })).toMatchObject({ ok: false });
  });
});

describe("validarNomeBlacklist", () => {
  it("1 a 60 caracteres depois do trim", () => {
    expect(validarNomeBlacklist("  Golpistas  ")).toEqual({ ok: true, nome: "Golpistas" });
    expect(validarNomeBlacklist("   ")).toMatchObject({ ok: false });
    expect(validarNomeBlacklist("a".repeat(61))).toMatchObject({ ok: false });
    expect(validarNomeBlacklist(3)).toMatchObject({ ok: false });
  });
});
