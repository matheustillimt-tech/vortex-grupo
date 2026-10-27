import { describe, expect, it } from "vitest";
import { atrasadaDemais, decidirPasso, pulaSeAtrasada, horarioDoPasso, linhasParaMaterializar, rotuloDia, validarPasso } from "@/src/lib/regras/sequencia";

// Aula na quarta 21/10/2026 às 20h de Brasília = 23:00Z.
const AULA = "2026-10-21T23:00:00Z";

describe("horarioDoPasso", () => {
  it("D-0 e D-1 no horário de Brasília", () => {
    expect(horarioDoPasso(AULA, 0, "19:50").toISOString()).toBe("2026-10-21T22:50:00.000Z");
    expect(horarioDoPasso(AULA, -1, "09:00:00").toISOString()).toBe("2026-10-20T12:00:00.000Z");
    expect(horarioDoPasso(AULA, 0, "23:30").toISOString()).toBe("2026-10-22T02:30:00.000Z");
    expect(horarioDoPasso(AULA, 1, "10:00").toISOString()).toBe("2026-10-22T13:00:00.000Z");
  });
  it("vira o mês", () => {
    expect(horarioDoPasso("2026-11-02T23:00:00Z", -3, "10:00").toISOString()).toBe("2026-10-30T13:00:00.000Z");
    expect(horarioDoPasso("2026-10-31T23:00:00Z", 1, "08:00").toISOString()).toBe("2026-11-01T11:00:00.000Z");
  });
  it("o dia da aula é o de Brasília, não o de UTC", () => {
    // 22/10 01:00Z = 21/10 22h em Brasília: D-0 é 21/10.
    expect(horarioDoPasso("2026-10-22T01:00:00Z", 0, "19:00").toISOString()).toBe("2026-10-21T22:00:00.000Z");
  });
});

describe("decidirPasso (regra dos 15 min)", () => {
  const agora = new Date("2026-10-21T22:00:00Z");
  const em = (min: number) => new Date(agora.getTime() + min * 60_000);
  it("mais de 1 min no futuro: espera", () => {
    expect(decidirPasso(em(2), agora)).toBe("esperar");
    expect(decidirPasso(em(1), agora)).toBe("agendada");
  });
  it("até 15 min atrasado ainda agenda; mais que isso, pulada", () => {
    expect(decidirPasso(em(-15), agora)).toBe("agendada");
    expect(decidirPasso(em(-15.01), agora)).toBe("pulada");
  });
  it("pulaSeAtrasada: sequência e cronograma de automação sim; avulsa e automação de evento não", () => {
    expect(pulaSeAtrasada({ origem: "sequencia" })).toBe(true);
    expect(pulaSeAtrasada({ origem: "automacao", gatilhoChave: "cronograma" })).toBe(true);
    expect(pulaSeAtrasada({ origem: "automacao", gatilhoChave: "22222222-2222-4222-8222-222222222222" })).toBe(false);
    expect(pulaSeAtrasada({ origem: "avulsa", gatilhoChave: null })).toBe(false);
  });
  it("atrasadaDemais usa a mesma tolerância", () => {
    expect(atrasadaDemais(em(-15), agora)).toBe(false);
    expect(atrasadaDemais(em(-16), agora)).toBe(true);
  });
});

describe("validarPasso", () => {
  const base = { dia_relativo: 0, hora: "19:50", tipo: "mensagem" as const, conteudo: { formato: "texto", texto: "Começou" }, importante: true };
  it("aceita e normaliza a hora", () => {
    expect(validarPasso({ ...base, hora: "19:50:00" })).toMatchObject({ ok: true, valor: { hora: "19:50", importante: true } });
  });
  it("dia fora de D-30..D+7, hora inválida e conteúdo inválido", () => {
    expect(validarPasso({ ...base, dia_relativo: -31 })).toEqual({ ok: false, erro: "O dia vai de D-30 a D+7." });
    expect(validarPasso({ ...base, hora: "24:00" })).toEqual({ ok: false, erro: "Hora inválida (use HH:MM)." });
    expect(validarPasso({ ...base, conteudo: { formato: "texto", texto: "" } })).toEqual({ ok: false, erro: "Escreva a mensagem." });
  });
  it("só mensagem e enquete podem ser importantes", () => {
    expect(validarPasso({ ...base, tipo: "abrir", conteudo: {} })).toMatchObject({ ok: true, valor: { importante: false } });
  });
  it("rótulo do dia", () => {
    expect([rotuloDia(-2), rotuloDia(0), rotuloDia(3)]).toEqual(["D-2", "D-0", "D+3"]);
  });
});

describe("linhasParaMaterializar", () => {
  const passos = [
    { id: "p1", dia_relativo: -1, hora: "10:00", tipo: "mensagem" as const, conteudo: { texto: "ontem" }, importante: true },
    { id: "p2", dia_relativo: 0, hora: "19:45", tipo: "nome" as const, conteudo: { padrao: "AO VIVO" }, importante: false },
    { id: "p3", dia_relativo: 0, hora: "19:50", tipo: "abrir" as const, conteudo: {}, importante: false },
    { id: "p4", dia_relativo: 0, hora: "20:00", tipo: "mensagem" as const, conteudo: { texto: "começou" }, importante: true },
  ];
  it("passado vira pulada, dentro da janela vira agendada, futuro espera", () => {
    const agora = new Date("2026-10-21T22:50:30Z"); // 19:50:30 em Brasília
    const linhas = linhasParaMaterializar({ id: "c1", data_aula: AULA }, passos, agora);
    expect(linhas.map((l) => [l.passo_id, l.status, l.agendada_para])).toEqual([
      ["p1", "pulada", "2026-10-20T13:00:00.000Z"],
      ["p2", "agendada", "2026-10-21T22:45:00.000Z"],
      ["p3", "agendada", "2026-10-21T22:50:00.000Z"],
    ]);
    expect(linhas[0]).toMatchObject({ campanha_id: "c1", origem: "sequencia", tipo: "mensagem", importante: true, motivo: expect.stringContaining("Já tinha passado") });
    expect(linhas[1].motivo).toBeNull();
  });
});
