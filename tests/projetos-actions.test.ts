import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, filtro, type Chamada, type Resposta } from "./apoio/db-falso";

const hoisted = vi.hoisted(() => ({
  dbAtual: undefined as unknown,
  exigirUsuarioMock: vi.fn(async () => ({ id: "u1" })),
  revalidar: vi.fn(),
}));

vi.mock("@/src/lib/permissoes", async () => (await import("./apoio/permissoes")).permissoesFalsas());
vi.mock("@/src/lib/supabase/usuario", () => ({
  exigirUsuario: hoisted.exigirUsuarioMock,
  dbUsuario: async () => hoisted.dbAtual,
}));
vi.mock("next/cache", () => ({ revalidatePath: hoisted.revalidar }));
vi.mock("@/src/lib/historico", () => ({ registrarHistorico: vi.fn() }));

import { arquivarProjeto, excluirProjeto, moverProjeto, salvarProjeto } from "@/app/(painel)/projetos/actions";

const ID = "11111111-2222-3333-4444-555555555555";
const ACHOU: Resposta = { data: [{ id: ID }] };

function usar(responder?: (c: Chamada) => Resposta) {
  const f = dbFalso(responder);
  hoisted.dbAtual = f.db;
  return { chamadas: f.chamadas };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("salvarProjeto", () => {
  it("exige usuário logado", async () => {
    const { chamadas } = usar();
    hoisted.exigirUsuarioMock.mockRejectedValueOnce(new Error("sem sessão"));
    await expect(salvarProjeto(null, { nome: "Aulão", descricao: "", cor: "amarelo" })).rejects.toThrow();
    expect(chamadas).toEqual([]);
  });

  it("cria com nome, descrição e cor (aparados)", async () => {
    const { chamadas } = usar();
    const r = await salvarProjeto(null, { nome: " Aulão ", descricao: " turma de março ", cor: "verde" });
    expect(r.erro).toBeUndefined();
    const ins = chamadas.find((c) => c.op === "insert")!;
    expect(ins.tabela).toBe("projetos");
    expect(ins.dados).toEqual({ nome: "Aulão", descricao: "turma de março", cor: "verde" });
    expect(hoisted.revalidar).toHaveBeenCalledWith("/projetos");
    expect(hoisted.revalidar).toHaveBeenCalledWith("/projetos/arquivados");
    expect(hoisted.revalidar).toHaveBeenCalledWith("/campanhas");
  });

  it("edita pelo id", async () => {
    const { chamadas } = usar(() => ACHOU);
    const r = await salvarProjeto(ID, { nome: "Novo nome", descricao: "", cor: "azul" });
    expect(r).toEqual({});
    const up = chamadas.find((c) => c.op === "update")!;
    expect(up.dados).toMatchObject({ nome: "Novo nome", descricao: "", cor: "azul" });
    expect(typeof (up.dados as { updated_at?: string }).updated_at).toBe("string");
    expect(filtro(up, "eq", "id")).toBe(ID);
    expect(chamadas.some((c) => c.op === "insert")).toBe(false);
    expect(hoisted.revalidar).toHaveBeenCalledWith(`/projetos/${ID}`);
  });

  it("editar projeto inexistente (nenhuma linha atualizada): erro e não grava histórico", async () => {
    usar(() => ({ data: [] }));
    const r = await salvarProjeto(ID, { nome: "x", descricao: "", cor: "azul" });
    expect(r).toEqual({ erro: "Projeto não encontrado." });
    const { registrarHistorico } = await import("@/src/lib/historico");
    expect(registrarHistorico).not.toHaveBeenCalled();
  });

  it.each([
    [{ nome: "", descricao: "", cor: "azul" }],
    [{ nome: "x".repeat(61), descricao: "", cor: "azul" }],
    [{ nome: "x", descricao: "y".repeat(201), cor: "azul" }],
    [{ nome: "x", descricao: "", cor: "cor-invalida" }],
  ])("recusa entrada inválida %#", async (e) => {
    const { chamadas } = usar();
    expect((await salvarProjeto(null, e as never)).erro).toBeTruthy();
    expect(chamadas).toEqual([]);
  });

  it("id de edição inválido não toca no banco", async () => {
    const { chamadas } = usar();
    expect((await salvarProjeto("não-é-uuid", { nome: "x", descricao: "", cor: "azul" })).erro).toBeTruthy();
    expect(chamadas).toEqual([]);
  });

  it("erro do banco", async () => {
    usar(() => ({ error: { message: "x" } }));
    expect((await salvarProjeto(null, { nome: "x", descricao: "", cor: "azul" })).erro).toBeTruthy();
  });
});

describe("arquivarProjeto", () => {
  it("arquiva e desarquiva", async () => {
    const { chamadas } = usar(() => ACHOU);
    expect(await arquivarProjeto(ID, true)).toEqual({});
    expect(chamadas[0]).toMatchObject({ tabela: "projetos", op: "update", dados: { arquivado: true } });
    expect(filtro(chamadas[0], "eq", "id")).toBe(ID);
    expect(hoisted.revalidar).toHaveBeenCalledWith(`/projetos/${ID}`);
  });

  it("não arquiva as campanhas do projeto (só a linha de projetos é tocada)", async () => {
    const { chamadas } = usar(() => ACHOU);
    await arquivarProjeto(ID, true);
    expect(chamadas.every((c) => c.tabela === "projetos")).toBe(true);
  });

  it("id inválido não toca no banco", async () => {
    const { chamadas } = usar();
    expect((await arquivarProjeto("x", true)).erro).toBeTruthy();
    expect(chamadas).toEqual([]);
  });

  it("projeto não encontrado", async () => {
    usar(() => ({ data: [] }));
    expect((await arquivarProjeto(ID, true)).erro).toBe("Projeto não encontrado.");
  });

  it("erro do banco", async () => {
    usar(() => ({ error: { message: "x" } }));
    expect((await arquivarProjeto(ID, true)).erro).toBeTruthy();
  });
});

describe("excluirProjeto", () => {
  it("exclui e grava histórico", async () => {
    const { chamadas } = usar(() => ACHOU);
    expect(await excluirProjeto(ID)).toEqual({});
    expect(chamadas[0]).toMatchObject({ tabela: "projetos", op: "delete" });
    expect(filtro(chamadas[0], "eq", "id")).toBe(ID);
    const { registrarHistorico } = await import("@/src/lib/historico");
    expect(registrarHistorico).toHaveBeenCalledWith({ id: "u1" }, expect.objectContaining({ acao: "remover", area: "Projetos" }));
  });

  it("id inválido não toca no banco", async () => {
    const { chamadas } = usar();
    expect((await excluirProjeto("x")).erro).toBeTruthy();
    expect(chamadas).toEqual([]);
  });

  it("projeto não encontrado", async () => {
    usar(() => ({ data: [] }));
    expect((await excluirProjeto(ID)).erro).toBe("Projeto não encontrado.");
  });

  it("erro do banco", async () => {
    usar(() => ({ error: { message: "x" } }));
    expect((await excluirProjeto(ID)).erro).toBeTruthy();
  });
});

describe("moverProjeto", () => {
  const A = "11111111-0000-0000-0000-000000000001";
  const B = "11111111-0000-0000-0000-000000000002";
  const C = "11111111-0000-0000-0000-000000000003";
  // Hoje: todos com `posicao` nula, então a ordem "Posição" cai pra `created_at` desc (A é o mais novo).
  const TRES_PROJETOS = [
    { id: A, posicao: null, created_at: "2026-10-03T00:00:00Z" },
    { id: B, posicao: null, created_at: "2026-10-02T00:00:00Z" },
    { id: C, posicao: null, created_at: "2026-10-01T00:00:00Z" },
  ];

  it("move pra cima: troca com o vizinho e renumera TODOS que ainda não tinham posição gravada (0..N-1)", async () => {
    const { chamadas } = usar((c) => (c.tabela === "projetos" && c.op === "select" ? { data: TRES_PROJETOS } : {}));
    const r = await moverProjeto(B, "cima");
    expect(r).toEqual({});
    const updates = chamadas.filter((c) => c.op === "update");
    // Ordem antes: A(0) B(1) C(2), todos com `posicao` nula no banco. B sobe: B(0) A(1) C(2) — os 3 diferem do
    // valor gravado (null), então os 3 ganham número junto (regressão §final-fixes-B item 2: comparar com a
    // `posicao` crua do banco, não com o índice da lista antiga — senão C fica pra sempre sem número).
    expect(updates).toHaveLength(3);
    expect(updates.find((u) => filtro(u, "eq", "id") === B)?.dados).toEqual({ posicao: 0 });
    expect(updates.find((u) => filtro(u, "eq", "id") === A)?.dados).toEqual({ posicao: 1 });
    expect(updates.find((u) => filtro(u, "eq", "id") === C)?.dados).toEqual({ posicao: 2 });
    const { registrarHistorico } = await import("@/src/lib/historico");
    expect(registrarHistorico).toHaveBeenCalledWith({ id: "u1" }, expect.objectContaining({ acao: "atualizar", area: "Projetos", refId: B }));
  });

  it("move pra baixo: mesma troca, do outro lado — todos ganham número junto", async () => {
    const { chamadas } = usar((c) => (c.tabela === "projetos" && c.op === "select" ? { data: TRES_PROJETOS } : {}));
    await moverProjeto(B, "baixo");
    const updates = chamadas.filter((c) => c.op === "update");
    expect(updates).toHaveLength(3);
    expect(updates.find((u) => filtro(u, "eq", "id") === A)?.dados).toEqual({ posicao: 0 });
    expect(updates.find((u) => filtro(u, "eq", "id") === C)?.dados).toEqual({ posicao: 1 });
    expect(updates.find((u) => filtro(u, "eq", "id") === B)?.dados).toEqual({ posicao: 2 });
  });

  it("quando já existe posição gravada, só regrava quem mudou de índice (regressão)", async () => {
    // A e B já têm `posicao` definida e correta (0 e 1); só C está nula. Mover C pra cima troca com B: só os
    // dois que de fato mudaram (B e C) precisam de update — A mantém o valor que já estava certo no banco.
    const projetosComPosicao = [
      { id: A, posicao: 0, created_at: "2026-10-03T00:00:00Z" },
      { id: B, posicao: 1, created_at: "2026-10-02T00:00:00Z" },
      { id: C, posicao: null, created_at: "2026-10-01T00:00:00Z" },
    ];
    const { chamadas } = usar((c) => (c.tabela === "projetos" && c.op === "select" ? { data: projetosComPosicao } : {}));
    await moverProjeto(C, "cima");
    const updates = chamadas.filter((c) => c.op === "update");
    expect(updates).toHaveLength(2);
    expect(updates.find((u) => filtro(u, "eq", "id") === C)?.dados).toEqual({ posicao: 1 });
    expect(updates.find((u) => filtro(u, "eq", "id") === B)?.dados).toEqual({ posicao: 2 });
    expect(updates.some((u) => filtro(u, "eq", "id") === A)).toBe(false);
  });

  it("já no topo: erro, sem gravar nada", async () => {
    const { chamadas } = usar((c) => (c.tabela === "projetos" && c.op === "select" ? { data: TRES_PROJETOS } : {}));
    const r = await moverProjeto(A, "cima");
    expect(r.erro).toBeTruthy();
    expect(chamadas.some((c) => c.op === "update")).toBe(false);
  });

  it("já no fim: erro, sem gravar nada", async () => {
    const { chamadas } = usar((c) => (c.tabela === "projetos" && c.op === "select" ? { data: TRES_PROJETOS } : {}));
    const r = await moverProjeto(C, "baixo");
    expect(r.erro).toBeTruthy();
    expect(chamadas.some((c) => c.op === "update")).toBe(false);
  });

  it("id inválido não toca no banco", async () => {
    const { chamadas } = usar();
    expect((await moverProjeto("x", "cima")).erro).toBeTruthy();
    expect(chamadas).toEqual([]);
  });

  it("id fora da lista: erro", async () => {
    usar((c) => (c.tabela === "projetos" && c.op === "select" ? { data: TRES_PROJETOS } : {}));
    const r = await moverProjeto(ID, "cima");
    expect(r.erro).toBeTruthy();
  });
});
