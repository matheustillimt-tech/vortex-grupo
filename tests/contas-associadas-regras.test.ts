import { describe, expect, it } from "vitest";
import { contaECriadora, MENSAGEM_NAO_REMOVE_CRIADORA, mensagemExecucoes, MOTIVO_CONTA_SAIU } from "@/src/lib/regras/contas-associadas";

describe("contaECriadora", () => {
  it("true quando a conexão é a criadora", () => expect(contaECriadora("c1", "c1")).toBe(true));
  it("false quando não é", () => expect(contaECriadora("c1", "c2")).toBe(false));
  it("false quando a campanha não tem criadora definida", () => expect(contaECriadora("c1", null)).toBe(false));
});

describe("MENSAGEM_NAO_REMOVE_CRIADORA", () => {
  it("é a mensagem exata da Tarefa 3", () => {
    expect(MENSAGEM_NAO_REMOVE_CRIADORA).toBe("Troque o número que cria os grupos antes de remover esta conexão.");
  });
});

describe("mensagemExecucoes", () => {
  it("nada afetado: null", () => {
    expect(mensagemExecucoes({ reassociadas: 0, canceladas: 0 })).toBeNull();
    expect(mensagemExecucoes({ reassociadas: 0, canceladas: 0, mantidas: 0 })).toBeNull();
  });

  it("reassociadas e canceladas aparecem com as contagens", () => {
    const m = mensagemExecucoes({ reassociadas: 2, canceladas: 1 })!;
    expect(m).toContain("2 ação(ões)");
    expect(m).toContain("1 ação(ões) agendada(s) foram canceladas");
  });

  it("mantidas (reassociação desligada) aparece sozinha", () => {
    expect(mensagemExecucoes({ reassociadas: 0, canceladas: 0, mantidas: 3 })).toContain("3 ação(ões) agendada(s) continuam usando");
  });
});

describe("MOTIVO_CONTA_SAIU", () => {
  it("é o mesmo texto gravado pela migração", () => {
    expect(MOTIVO_CONTA_SAIU).toBe("A conexão escolhida saiu da campanha.");
  });
});
