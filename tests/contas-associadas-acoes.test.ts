import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, filtro, type Chamada, type Resposta } from "./apoio/db-falso";

const hoisted = vi.hoisted(() => ({
  dbAtual: undefined as unknown,
  revalidar: vi.fn(),
  historicoMock: vi.fn(),
  exigirUsuarioMock: vi.fn(async () => ({ id: "u1" })),
}));

vi.mock("@/src/lib/permissoes", async () => (await import("./apoio/permissoes")).permissoesFalsas());
vi.mock("@/src/lib/supabase/usuario", () => ({ dbUsuario: async () => hoisted.dbAtual, exigirUsuario: hoisted.exigirUsuarioMock }));
vi.mock("next/cache", () => ({ revalidatePath: hoisted.revalidar }));
vi.mock("@/src/lib/historico", () => ({ registrarHistorico: hoisted.historicoMock }));

import { associarConta, definirReassociarAcoes, removerConta } from "@/app/(painel)/campanhas/[id]/contas/actions";
import { negarTudo, liberarTudo } from "./apoio/permissoes";

const CAMP = "aaaaaaaa-1111-4111-8111-111111111111";
const CRIADORA = "cccccccc-1111-4111-8111-111111111111";
const CONTA = "dddddddd-1111-4111-8111-111111111111";

function usar(responder: (c: Chamada) => Resposta) {
  const f = dbFalso(responder);
  hoisted.dbAtual = f.db;
  return { chamadas: f.chamadas };
}

beforeEach(() => {
  vi.clearAllMocks();
  liberarTudo();
});

describe("associarConta", () => {
  it("sem permissão: recusa antes de tocar no banco", async () => {
    negarTudo();
    const { chamadas } = usar(() => ({}));
    const r = await associarConta(CAMP, CONTA);
    expect(r.erro).toBeTruthy();
    expect(chamadas).toEqual([]);
  });

  it("id que não é uuid: recusa sem tocar no banco", async () => {
    const { chamadas } = usar(() => ({}));
    expect((await associarConta(CAMP, "x")).erro).toBeTruthy();
    expect(chamadas).toEqual([]);
  });

  it("conexão inexistente: erro, não grava", async () => {
    const { chamadas } = usar((c) => {
      if (c.tabela === "campanhas") return { data: { conexao_criadora_id: CRIADORA } };
      if (c.tabela === "conexoes") return { data: null };
      return {};
    });
    const r = await associarConta(CAMP, CONTA);
    expect(r).toEqual({ erro: "Conexão não encontrada." });
    expect(chamadas.some((c) => c.tabela === "campanha_conexoes")).toBe(false);
  });

  it("campanha sem número: a conexão escolhida passa a criar os grupos (não vira reserva)", async () => {
    const { chamadas } = usar((c) => {
      if (c.tabela === "campanhas" && c.op === "select") return { data: { conexao_criadora_id: null } };
      if (c.tabela === "conexoes") return { data: { id: CONTA, nome: "Chip 2" } };
      return {};
    });
    expect(await associarConta(CAMP, CONTA)).toEqual({});
    const upd = chamadas.find((c) => c.tabela === "campanhas" && c.op === "update");
    expect(upd?.dados).toEqual({ conexao_criadora_id: CONTA });
    expect(chamadas.some((c) => c.tabela === "campanha_conexoes")).toBe(false);
  });

  it("conexão criadora: recusa no servidor, não grava", async () => {
    const { chamadas } = usar((c) => {
      if (c.tabela === "campanhas") return { data: { conexao_criadora_id: CRIADORA } };
      if (c.tabela === "conexoes") return { data: { id: CRIADORA, nome: "Criadora" } };
      return {};
    });
    const r = await associarConta(CAMP, CRIADORA);
    expect(r.erro).toMatch(/já cria os grupos/);
    expect(chamadas.some((c) => c.tabela === "campanha_conexoes")).toBe(false);
  });

  it("associa com upsert em (campanha_id, conexao_id) ignorando repetidos, revalida e registra no histórico", async () => {
    const { chamadas } = usar((c) => {
      if (c.tabela === "campanhas") return { data: { conexao_criadora_id: CRIADORA } };
      if (c.tabela === "conexoes") return { data: { id: CONTA, nome: "Conexão 1" } };
      return {};
    });
    const r = await associarConta(CAMP, CONTA);
    expect(r).toEqual({});
    const up = chamadas.find((c) => c.tabela === "campanha_conexoes")!;
    expect(up.op).toBe("upsert");
    expect(up.dados).toEqual({ campanha_id: CAMP, conexao_id: CONTA });
    expect(up.opcoes).toEqual({ onConflict: "campanha_id,conexao_id", ignoreDuplicates: true });
    expect(hoisted.revalidar).toHaveBeenCalledWith(`/campanhas/${CAMP}/contas`);
    expect(hoisted.historicoMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ refId: CAMP }));
  });
});

describe("removerConta", () => {
  it("conexão criadora: recusa com a mensagem certa, não apaga nada", async () => {
    const { chamadas } = usar((c) => (c.tabela === "campanhas" ? { data: { nome: "Aulão", conexao_criadora_id: CRIADORA, reassociar_acoes: true } } : {}));
    const r = await removerConta(CAMP, CRIADORA);
    expect(r).toEqual({ erro: "Troque o número que cria os grupos antes de remover esta conexão." });
    expect(chamadas.some((c) => c.tabela === "campanha_conexoes" && c.op === "delete")).toBe(false);
    expect(chamadas.some((c) => c.tabela.startsWith("rpc:"))).toBe(false);
  });

  it("reassociar_acoes ligado: chama a RPC antes de apagar o vínculo e devolve as contagens", async () => {
    const { chamadas } = usar((c) => {
      if (c.tabela === "campanhas") return { data: { nome: "Aulão", conexao_criadora_id: CRIADORA, reassociar_acoes: true } };
      if (c.tabela === "rpc:remover_conta_das_execucoes") return { data: [{ reassociadas: 2, canceladas: 1 }] };
      return {};
    });
    const r = await removerConta(CAMP, CONTA);
    expect(r.erro).toBeUndefined();
    expect(r.mensagem).toContain("Conexão removida.");
    expect(r.mensagem).toContain("2 ação(ões)");
    expect(r.mensagem).toContain("1 ação(ões) agendada(s) foram canceladas");

    const iRpc = chamadas.findIndex((c) => c.tabela === "rpc:remover_conta_das_execucoes");
    const iDel = chamadas.findIndex((c) => c.tabela === "campanha_conexoes" && c.op === "delete");
    expect(iRpc).toBeGreaterThan(-1);
    expect(iDel).toBeGreaterThan(iRpc);
    expect(chamadas[iRpc].dados).toEqual({ p_campanha: CAMP, p_conexao: CONTA });
    expect(filtro(chamadas[iDel], "eq", "campanha_id")).toBe(CAMP);
    expect(filtro(chamadas[iDel], "eq", "conexao_id")).toBe(CONTA);
    // Nada de laço linha a linha em execucoes.
    expect(chamadas.some((c) => c.tabela === "execucoes")).toBe(false);
    expect(hoisted.historicoMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ refId: CAMP, resumo: expect.stringContaining("canceladas") }));
  });

  it("RPC falha: não apaga o vínculo", async () => {
    const { chamadas } = usar((c) => {
      if (c.tabela === "campanhas") return { data: { nome: "Aulão", conexao_criadora_id: CRIADORA, reassociar_acoes: true } };
      if (c.tabela === "rpc:remover_conta_das_execucoes") return { error: { message: "x" } };
      return {};
    });
    const r = await removerConta(CAMP, CONTA);
    expect(r.erro).toMatch(/continua na campanha/);
    expect(chamadas.some((c) => c.tabela === "campanha_conexoes" && c.op === "delete")).toBe(false);
  });

  it("nenhuma ação afetada: só 'Conexão removida.'", async () => {
    usar((c) => {
      if (c.tabela === "campanhas") return { data: { nome: "Aulão", conexao_criadora_id: CRIADORA, reassociar_acoes: true } };
      if (c.tabela === "rpc:remover_conta_das_execucoes") return { data: [{ reassociadas: 0, canceladas: 0 }] };
      return {};
    });
    expect(await removerConta(CAMP, CONTA)).toEqual({ mensagem: "Conexão removida." });
  });

  it("reassociar_acoes desligado: não chama a RPC nem altera execuções; avisa quantas continuam usando a conexão", async () => {
    const { chamadas } = usar((c) => {
      if (c.tabela === "campanhas") return { data: { nome: "Aulão", conexao_criadora_id: CRIADORA, reassociar_acoes: false } };
      if (c.tabela === "execucoes") return { count: 3 };
      return {};
    });
    const r = await removerConta(CAMP, CONTA);
    expect(r.mensagem).toContain("3 ação(ões) agendada(s) continuam usando a conexão que saiu");
    expect(chamadas.some((c) => c.tabela.startsWith("rpc:"))).toBe(false);
    expect(chamadas.some((c) => c.tabela === "execucoes" && c.op !== "select")).toBe(false);
    const sel = chamadas.find((c) => c.tabela === "execucoes")!;
    expect(filtro(sel, "eq", "status")).toBe("agendada");
    expect(filtro(sel, "contains", "alvo_contas")).toEqual([CONTA]);
  });

  it("campanha não encontrada: erro", async () => {
    usar((c) => (c.tabela === "campanhas" ? { data: null } : {}));
    const r = await removerConta(CAMP, CONTA);
    expect(r).toEqual({ erro: "Campanha não encontrada." });
  });
});

describe("definirReassociarAcoes", () => {
  it("sem permissão: recusa", async () => {
    negarTudo();
    const r = await definirReassociarAcoes(CAMP, false);
    expect(r.erro).toBeTruthy();
  });

  it("grava, revalida e registra no histórico", async () => {
    const { chamadas } = usar(() => ({}));
    const r = await definirReassociarAcoes(CAMP, false);
    expect(r).toEqual({});
    const upd = chamadas.find((c) => c.tabela === "campanhas" && c.op === "update")!;
    expect(upd.dados).toEqual({ reassociar_acoes: false });
    expect(hoisted.revalidar).toHaveBeenCalledWith(`/campanhas/${CAMP}/contas`);
    expect(hoisted.historicoMock).toHaveBeenCalled();
  });
});
