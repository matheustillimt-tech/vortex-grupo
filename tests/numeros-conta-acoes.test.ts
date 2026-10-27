import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, filtro, type Chamada, type Resposta } from "./apoio/db-falso";
import { liberarTudo } from "./apoio/permissoes";

/** Ações novas do detalhe da conta (Etapa 3G, Tarefa 3): Desconectar, Finalizar Sessão, Definir projeto e a
 *  seleção de campanhas (Campanhas tab). Permissão ("contas"/"editar" recusa) já é testada em
 *  `permissoes-acoes.test.ts`; aqui o foco é a lógica depois de liberado. */

const ID = "11111111-2222-3333-4444-555555555555";
const PROJETO = "22222222-2222-3333-4444-555555555555";

const hoisted = vi.hoisted(() => ({
  dbAtual: undefined as unknown,
  desconectarMock: vi.fn(async () => undefined),
  credenciaisMock: vi.fn(async () => ({ id: "z1", token: "t", clientToken: "c" })),
}));

vi.mock("@/src/lib/permissoes", async () => (await import("./apoio/permissoes")).permissoesFalsas());
vi.mock("@/src/lib/supabase/usuario", () => ({ exigirUsuario: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => hoisted.dbAtual }));
vi.mock("@/src/lib/conexoes", () => ({ credenciais: hoisted.credenciaisMock }));
vi.mock("@/src/lib/zapbot/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/src/lib/zapbot/client")>();
  return { ...real, zapbot: () => ({ desconectar: hoisted.desconectarMock }) };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/src/lib/historico", () => ({ registrarHistorico: vi.fn() }));

import {
  definirCampanhasDaConta,
  definirProjetoConexao,
  desconectarConexao,
  finalizarSessaoConexao,
} from "@/app/(painel)/numeros/actions";

function usar(responder?: (c: Chamada) => Resposta) {
  const f = dbFalso(responder);
  hoisted.dbAtual = f.db;
  return { chamadas: f.chamadas };
}

beforeEach(() => {
  vi.clearAllMocks();
  liberarTudo();
});

describe("desconectarConexao", () => {
  it("chama o Zapbot (disconnect) e marca a conexão como desconectada", async () => {
    const { chamadas } = usar((c) => {
      if (c.tabela === "conexoes" && c.op === "select") return { data: { zapbot_id: "z1", status: "conectado" } };
      return {};
    });
    const r = await desconectarConexao(ID);
    expect(r).toEqual({});
    expect(hoisted.desconectarMock).toHaveBeenCalledTimes(1);
    const up = chamadas.find((c) => c.tabela === "conexoes" && c.op === "update")!;
    expect(up.dados).toEqual({ status: "desconectado", ultimo_erro: null });
    expect(filtro(up, "eq", "id")).toBe(ID);
  });

  it("já desconectada: não chama o Zapbot de novo", async () => {
    usar((c) => {
      if (c.tabela === "conexoes" && c.op === "select") return { data: { zapbot_id: "z1", status: "desconectado" } };
      return {};
    });
    const r = await desconectarConexao(ID);
    expect(r).toEqual({});
    expect(hoisted.desconectarMock).not.toHaveBeenCalled();
  });

  it("sem instância no Zapbot (zapbot_id null): só marca localmente", async () => {
    usar((c) => {
      if (c.tabela === "conexoes" && c.op === "select") return { data: { zapbot_id: null, status: "conectado" } };
      return {};
    });
    const r = await desconectarConexao(ID);
    expect(r).toEqual({});
    expect(hoisted.desconectarMock).not.toHaveBeenCalled();
  });

  it("conexão não encontrada", async () => {
    usar((c) => (c.tabela === "conexoes" && c.op === "select" ? { data: null } : {}));
    expect(await desconectarConexao(ID)).toEqual({ erro: "Conexão não encontrada." });
  });

  it("Zapbot não responde: erro, sem marcar desconectada", async () => {
    hoisted.desconectarMock.mockRejectedValueOnce(new Error("timeout"));
    const { chamadas } = usar((c) => {
      if (c.tabela === "conexoes" && c.op === "select") return { data: { zapbot_id: "z1", status: "conectado" } };
      return {};
    });
    const r = await desconectarConexao(ID);
    expect(r.erro).toBeTruthy();
    expect(chamadas.some((c) => c.op === "update")).toBe(false);
  });
});

describe("finalizarSessaoConexao", () => {
  it("usa a mesma rota de desconectar (a doc do Zapbot só tem 'disconnect') e grava histórico próprio", async () => {
    usar((c) => (c.tabela === "conexoes" && c.op === "select" ? { data: { zapbot_id: "z1", status: "conectado" } } : {}));
    const r = await finalizarSessaoConexao(ID);
    expect(r).toEqual({});
    expect(hoisted.desconectarMock).toHaveBeenCalledTimes(1);
    const { registrarHistorico } = await import("@/src/lib/historico");
    expect(registrarHistorico).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ resumo: expect.stringContaining("Sessão finalizada") }));
  });
});

describe("definirProjetoConexao", () => {
  it("define o projeto quando ele existe", async () => {
    const { chamadas } = usar((c) => {
      if (c.tabela === "projetos" && c.op === "select") return { data: { id: PROJETO } };
      if (c.tabela === "conexoes" && c.op === "update") return { data: [{ id: ID }] };
      return {};
    });
    const r = await definirProjetoConexao(ID, PROJETO);
    expect(r).toEqual({});
    const up = chamadas.find((c) => c.tabela === "conexoes" && c.op === "update")!;
    expect(up.dados).toEqual({ projeto_id: PROJETO });
  });

  it("projeto inexistente: erro, não grava", async () => {
    const { chamadas } = usar((c) => (c.tabela === "projetos" && c.op === "select" ? { data: null } : {}));
    const r = await definirProjetoConexao(ID, PROJETO);
    expect(r).toEqual({ erro: "Projeto não encontrado." });
    expect(chamadas.some((c) => c.tabela === "conexoes" && c.op === "update")).toBe(false);
  });

  it("null tira a conexão do projeto, sem conferir projeto nenhum", async () => {
    const { chamadas } = usar((c) => (c.tabela === "conexoes" && c.op === "update" ? { data: [{ id: ID }] } : {}));
    const r = await definirProjetoConexao(ID, null);
    expect(r).toEqual({});
    expect(chamadas.some((c) => c.tabela === "projetos")).toBe(false);
    const up = chamadas.find((c) => c.tabela === "conexoes" && c.op === "update")!;
    expect(up.dados).toEqual({ projeto_id: null });
  });

  it("conta/projeto inválidos não tocam no banco", async () => {
    const { chamadas } = usar();
    expect((await definirProjetoConexao("x", null)).erro).toBeTruthy();
    expect((await definirProjetoConexao(ID, "x")).erro).toBeTruthy();
    expect(chamadas).toEqual([]);
  });

  it("conexão não encontrada (update sem linha)", async () => {
    usar((c) => (c.tabela === "conexoes" && c.op === "update" ? { data: [] } : {}));
    expect(await definirProjetoConexao(ID, null)).toEqual({ erro: "Conexão não encontrada." });
  });
});

describe("definirCampanhasDaConta", () => {
  const CAMP_A = "44444444-2222-3333-4444-555555555555";
  const CAMP_B = "55555555-2222-3333-4444-555555555555";

  it("chama a RPC definir_campanhas_da_conta uma vez só, com a conexão e a lista sem repetição", async () => {
    const { chamadas } = usar((c) => {
      if (c.tabela === "rpc:definir_campanhas_da_conta") return { data: { adicionadas: 1, removidas: 1, reassociadas: 1, canceladas: 0, mantidas: 0 } };
      return {};
    });
    const r = await definirCampanhasDaConta(ID, [CAMP_A, CAMP_A, CAMP_B]);
    expect(r.erro).toBeUndefined();
    expect(r.mensagem).toContain("1 entrou, 1 saiu");
    const chamadasRpc = chamadas.filter((c) => c.tabela === "rpc:definir_campanhas_da_conta");
    expect(chamadasRpc).toHaveLength(1);
    expect(chamadasRpc[0].dados).toEqual({ p_conexao: ID, p_campanhas: [CAMP_A, CAMP_B] });
  });

  it("repassa 'mantidas' (reassociar_acoes desligado numa das campanhas) na mensagem de histórico", async () => {
    usar((c) => (c.tabela === "rpc:definir_campanhas_da_conta" ? { data: { adicionadas: 0, removidas: 1, reassociadas: 0, canceladas: 0, mantidas: 2 } } : {}));
    const r = await definirCampanhasDaConta(ID, []);
    expect(r.mensagem).toContain("2 ação(ões) agendada(s) continuam usando a conexão que saiu");
  });

  it("nada muda (adicionadas e removidas zeradas): sem mensagem de histórico", async () => {
    const { chamadas } = usar((c) => (c.tabela === "rpc:definir_campanhas_da_conta" ? { data: { adicionadas: 0, removidas: 0, reassociadas: 0, canceladas: 0, mantidas: 0 } } : {}));
    const r = await definirCampanhasDaConta(ID, [CAMP_A]);
    expect(r).toEqual({});
    expect(chamadas.some((c) => c.tabela === "rpc:definir_campanhas_da_conta")).toBe(true);
  });

  it("erro da RPC vira mensagem amigável", async () => {
    const { chamadas } = usar((c) => (c.tabela === "rpc:definir_campanhas_da_conta" ? { error: { message: "boom" } } : {}));
    const r = await definirCampanhasDaConta(ID, [CAMP_A]);
    expect(r).toEqual({ erro: "Não foi possível atualizar as campanhas desta conexão. Tente de novo." });
    expect(chamadas).toHaveLength(1);
  });

  it("ids inválidos não tocam no banco", async () => {
    const { chamadas } = usar();
    expect((await definirCampanhasDaConta("x", [])).erro).toBeTruthy();
    expect((await definirCampanhasDaConta(ID, ["x"])).erro).toBeTruthy();
    expect(chamadas).toEqual([]);
  });
});
