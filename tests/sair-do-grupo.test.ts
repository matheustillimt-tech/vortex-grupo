import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, filtro, type Chamada, type Resposta } from "./apoio/db-falso";
import { liberarTudo, negarTudo, SEM_PERMISSAO } from "./apoio/permissoes";

/** Item "Sair do grupo" (`more_vert`) da aba Grupos do detalhe da conta (Etapa 3M, Tarefa 5): chamada direta ao
 *  Zapbot (`leave-group`), com confirmação na tela. Recusa se o grupo estiver ativo numa campanha ou fora de
 *  `conta_grupos` da conta; erro do Zapbot não apaga a linha. */

const CONTA = "11111111-2222-3333-4444-555555555555";
const GROUP_ID = "120363000000000000@g.us";

const hoisted = vi.hoisted(() => ({
  dbAtual: undefined as unknown,
  sairDoGrupoMock: vi.fn(async () => undefined),
  credenciaisMock: vi.fn(async () => ({ id: "z1", token: "t", clientToken: "c" })),
}));

vi.mock("@/src/lib/permissoes", async () => (await import("./apoio/permissoes")).permissoesFalsas());
vi.mock("@/src/lib/supabase/usuario", () => ({ exigirUsuario: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => hoisted.dbAtual }));
vi.mock("@/src/lib/conexoes", () => ({ credenciais: hoisted.credenciaisMock }));
vi.mock("@/src/lib/zapbot/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/src/lib/zapbot/client")>();
  return { ...real, zapbot: () => ({ sairDoGrupo: hoisted.sairDoGrupoMock }) };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/src/lib/historico", () => ({ registrarHistorico: vi.fn() }));

import { sairDoGrupo } from "@/app/(painel)/numeros/[id]/actions";

function usar(responder?: (c: Chamada) => Resposta) {
  const f = dbFalso(responder);
  hoisted.dbAtual = f.db;
  return { chamadas: f.chamadas };
}

function respostaPadrao(c: Chamada): Resposta {
  if (c.tabela === "conexoes" && c.op === "select") return { data: { nome: "Conexão 1", status: "conectado" } };
  if (c.tabela === "conta_grupos" && c.op === "select") return { data: { nome: "Grupo 1" } };
  if (c.tabela === "grupos" && c.op === "select") return { data: null };
  return {};
}

beforeEach(() => {
  vi.clearAllMocks();
  liberarTudo();
});

describe("sairDoGrupo", () => {
  it("sem permissão (contas/editar): recusa e não chama o Zapbot", async () => {
    negarTudo();
    const { chamadas } = usar(respostaPadrao);
    const r = await sairDoGrupo(CONTA, GROUP_ID);
    expect(r).toEqual({ erro: SEM_PERMISSAO });
    expect(hoisted.sairDoGrupoMock).not.toHaveBeenCalled();
    expect(chamadas).toEqual([]);
  });

  it("conta/grupo inválidos não tocam no banco", async () => {
    const { chamadas } = usar(respostaPadrao);
    expect((await sairDoGrupo("x", GROUP_ID)).erro).toBeTruthy();
    expect((await sairDoGrupo(CONTA, "sem-sufixo")).erro).toBeTruthy();
    expect(chamadas).toEqual([]);
  });

  it("conexão não encontrada", async () => {
    usar((c) => (c.tabela === "conexoes" && c.op === "select" ? { data: null } : {}));
    expect(await sairDoGrupo(CONTA, GROUP_ID)).toEqual({ erro: "Conexão não encontrada." });
  });

  it("conexão desconectada", async () => {
    usar((c) => {
      if (c.tabela === "conexoes" && c.op === "select") return { data: { nome: "Conexão 1", status: "desconectado" } };
      if (c.tabela === "conta_grupos" && c.op === "select") return { data: { nome: "Grupo 1" } };
      return {};
    });
    const r = await sairDoGrupo(CONTA, GROUP_ID);
    expect(r).toEqual({ erro: "Conecte a conexão pra sair do grupo." });
    expect(hoisted.sairDoGrupoMock).not.toHaveBeenCalled();
  });

  it("grupo fora de conta_grupos da conexão: recusa", async () => {
    usar((c) => {
      if (c.tabela === "conexoes" && c.op === "select") return { data: { nome: "Conexão 1", status: "conectado" } };
      if (c.tabela === "conta_grupos" && c.op === "select") return { data: null };
      return {};
    });
    const r = await sairDoGrupo(CONTA, GROUP_ID);
    expect(r.erro).toBeTruthy();
    expect(hoisted.sairDoGrupoMock).not.toHaveBeenCalled();
  });

  it("grupo ativo numa campanha: recusa com o nome da campanha", async () => {
    usar((c) => {
      if (c.tabela === "conexoes" && c.op === "select") return { data: { nome: "Conexão 1", status: "conectado" } };
      if (c.tabela === "conta_grupos" && c.op === "select") return { data: { nome: "Grupo 1" } };
      if (c.tabela === "grupos" && c.op === "select") return { data: { ativo: true, campanhas: { nome: "Lançamento" } } };
      return {};
    });
    const r = await sairDoGrupo(CONTA, GROUP_ID);
    expect(r).toEqual({ erro: "Este grupo está na campanha Lançamento. Tire o grupo da campanha antes de sair." });
    expect(hoisted.sairDoGrupoMock).not.toHaveBeenCalled();
  });

  it("grupo de campanha mesmo inativo (linha em `grupos`): recusa, igual à tela", async () => {
    const { chamadas } = usar((c) => {
      if (c.tabela === "conexoes" && c.op === "select") return { data: { nome: "Conexão 1", status: "conectado" } };
      if (c.tabela === "conta_grupos" && c.op === "select") return { data: { nome: "Grupo 1" } };
      if (c.tabela === "grupos" && c.op === "select") return { data: { ativo: false, campanhas: { nome: "Lançamento" } } };
      return {};
    });
    const r = await sairDoGrupo(CONTA, GROUP_ID);
    expect(r).toEqual({ erro: "Este grupo está na campanha Lançamento. Tire o grupo da campanha antes de sair." });
    expect(hoisted.sairDoGrupoMock).not.toHaveBeenCalled();
    expect(chamadas.some((c) => c.tabela === "conta_grupos" && c.op === "delete")).toBe(false);
  });

  it("ok: chama o Zapbot, apaga a linha de conta_grupos e registra histórico", async () => {
    const { chamadas } = usar(respostaPadrao);
    const r = await sairDoGrupo(CONTA, GROUP_ID);
    expect(r).toEqual({});
    expect(hoisted.sairDoGrupoMock).toHaveBeenCalledTimes(1);
    expect(hoisted.sairDoGrupoMock).toHaveBeenCalledWith(expect.anything(), GROUP_ID, expect.anything());
    const del = chamadas.find((c) => c.tabela === "conta_grupos" && c.op === "delete")!;
    expect(filtro(del, "eq", "conexao_id")).toBe(CONTA);
    expect(filtro(del, "eq", "group_id")).toBe(GROUP_ID);
    const { registrarHistorico } = await import("@/src/lib/historico");
    expect(registrarHistorico).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ acao: "remover", area: "Contas", resumo: "Conexão Conexão 1 saiu do grupo Grupo 1", refId: CONTA }),
    );
  });

  it("erro do Zapbot: não apaga a linha nem registra histórico", async () => {
    hoisted.sairDoGrupoMock.mockRejectedValueOnce(new Error("timeout"));
    const { chamadas } = usar(respostaPadrao);
    const r = await sairDoGrupo(CONTA, GROUP_ID);
    expect(r.erro).toBeTruthy();
    expect(chamadas.some((c) => c.op === "delete")).toBe(false);
    const { registrarHistorico } = await import("@/src/lib/historico");
    expect(registrarHistorico).not.toHaveBeenCalled();
  });
});
