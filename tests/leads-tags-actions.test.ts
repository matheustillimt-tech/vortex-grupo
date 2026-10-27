import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, filtro, type Chamada, type Resposta } from "./apoio/db-falso";

const hoisted = vi.hoisted(() => ({
  dbAtual: undefined as unknown,
  exigirUsuarioMock: vi.fn(async () => ({ id: "u1" })),
}));

vi.mock("@/src/lib/permissoes", async () => (await import("./apoio/permissoes")).permissoesFalsas());
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => hoisted.dbAtual }));
vi.mock("@/src/lib/supabase/usuario", () => ({ exigirUsuario: hoisted.exigirUsuarioMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/src/lib/bloqueio", () => ({
  bloquearTelefones: vi.fn(),
  desbloquearTelefone: vi.fn(),
  reenfileirarBloqueados: vi.fn(),
}));

import { criarTag, excluirTag, porTagNaPessoa, renomearTag, tirarTagDaPessoa } from "@/app/(painel)/leads/actions";

const ID = "11111111-2222-3333-4444-555555555555";

beforeEach(() => {
  vi.clearAllMocks();
});

/** Banco em que a tag `ID` existe com o tipo dado. */
function comTag(tipo: string | null, extra: (c: Chamada) => Resposta | undefined = () => undefined) {
  return dbFalso((c) => {
    const r = extra(c);
    if (r) return r;
    if (c.tabela === "tags" && c.op === "select") return { data: tipo ? { id: ID, tipo } : null };
    return {};
  });
}

describe("criarTag", () => {
  it("exige usuário logado", async () => {
    const { db, chamadas } = dbFalso();
    hoisted.dbAtual = db;
    hoisted.exigirUsuarioMock.mockRejectedValueOnce(new Error("sem sessão"));
    await expect(criarTag("VIP")).rejects.toThrow();
    expect(chamadas).toEqual([]);
  });

  it("cria tag manual com o nome sem espaços nas pontas", async () => {
    const { db, chamadas } = dbFalso();
    hoisted.dbAtual = db;
    const r = await criarTag("  VIP  ");
    expect(r).toEqual({});
    const ins = chamadas.find((c) => c.tabela === "tags" && c.op === "insert");
    expect(ins?.dados).toEqual({ nome: "VIP", tipo: "manual" });
  });

  it.each([[""], ["   "], ["x".repeat(41)]])("recusa nome inválido %#", async (nome) => {
    const { db, chamadas } = dbFalso();
    hoisted.dbAtual = db;
    const r = await criarTag(nome);
    expect(r.erro).toBeTruthy();
    expect(chamadas).toEqual([]);
  });

  it("aceita 40 letras", async () => {
    const { db } = dbFalso();
    hoisted.dbAtual = db;
    expect(await criarTag("x".repeat(40))).toEqual({});
  });

  it("nome repetido (sem diferenciar maiúsculas) vira erro legível", async () => {
    const { db } = dbFalso((c) => (c.op === "insert" ? { error: { message: "dup", code: "23505" } } : {}));
    hoisted.dbAtual = db;
    const r = await criarTag("vip");
    expect(r.erro).toMatch(/já existe/i);
  });

  it("recusa valor que não é texto", async () => {
    const { db } = dbFalso();
    hoisted.dbAtual = db;
    expect((await criarTag(42 as unknown as string)).erro).toBeTruthy();
  });
});

describe("renomearTag", () => {
  it("renomeia tag manual, filtrando por id e tipo manual", async () => {
    const { db, chamadas } = comTag("manual");
    hoisted.dbAtual = db;
    const r = await renomearTag(ID, " Clientes ");
    expect(r).toEqual({});
    const up = chamadas.find((c) => c.tabela === "tags" && c.op === "update")!;
    expect(up.dados).toEqual({ nome: "Clientes" });
    expect(filtro(up, "eq", "id")).toBe(ID);
    expect(filtro(up, "eq", "tipo")).toBe("manual");
  });

  it.each([["campanha"], ["comprador"], ["saiu"]])("não renomeia tag automática (%s)", async (tipo) => {
    const { db, chamadas } = comTag(tipo);
    hoisted.dbAtual = db;
    const r = await renomearTag(ID, "Outro");
    expect(r.erro).toMatch(/automática/i);
    expect(chamadas.some((c) => c.op === "update")).toBe(false);
  });

  it("tag que não existe", async () => {
    const { db } = comTag(null);
    hoisted.dbAtual = db;
    expect((await renomearTag(ID, "Outro")).erro).toMatch(/não encontrada/i);
  });

  it("valida o nome antes de ir ao banco", async () => {
    const { db, chamadas } = comTag("manual");
    hoisted.dbAtual = db;
    expect((await renomearTag(ID, "")).erro).toBeTruthy();
    expect((await renomearTag(ID, "y".repeat(41))).erro).toBeTruthy();
    expect(chamadas).toEqual([]);
  });

  it("nome repetido vira erro legível", async () => {
    const { db } = comTag("manual", (c) => (c.op === "update" ? { error: { message: "dup", code: "23505" } } : undefined));
    hoisted.dbAtual = db;
    expect((await renomearTag(ID, "VIP")).erro).toMatch(/já existe/i);
  });

  it("id que não é uuid", async () => {
    const { db, chamadas } = comTag("manual");
    hoisted.dbAtual = db;
    expect((await renomearTag("abc", "VIP")).erro).toBeTruthy();
    expect(chamadas).toEqual([]);
  });
});

describe("excluirTag", () => {
  it("exclui tag manual, filtrando por id e tipo manual", async () => {
    const { db, chamadas } = comTag("manual");
    hoisted.dbAtual = db;
    expect(await excluirTag(ID)).toEqual({});
    const del = chamadas.find((c) => c.tabela === "tags" && c.op === "delete")!;
    expect(filtro(del, "eq", "id")).toBe(ID);
    expect(filtro(del, "eq", "tipo")).toBe("manual");
  });

  it.each([["campanha"], ["comprador"], ["saiu"]])("não exclui tag automática (%s)", async (tipo) => {
    const { db, chamadas } = comTag(tipo);
    hoisted.dbAtual = db;
    expect((await excluirTag(ID)).erro).toMatch(/automática/i);
    expect(chamadas.some((c) => c.op === "delete")).toBe(false);
  });

  it("erro do banco vira mensagem", async () => {
    const { db } = comTag("manual", (c) => (c.op === "delete" ? { error: { message: "x" } } : undefined));
    hoisted.dbAtual = db;
    expect((await excluirTag(ID)).erro).toBeTruthy();
  });
});

describe("porTagNaPessoa", () => {
  it("normaliza o telefone antes de pôr a tag", async () => {
    const { db, chamadas } = dbFalso();
    hoisted.dbAtual = db;
    expect(await porTagNaPessoa("+55 (37) " + "98000-1001", ID, "")).toEqual({});
    expect(chamadas.find((c) => c.tabela === "rpc:por_tag")!.dados).toEqual({ p_telefones: ["5537" + "980001001"], p_tag: ID, p_campanha: null });
  });

  it("telefone inválido devolve erro sem ir ao banco", async () => {
    const { db, chamadas } = dbFalso();
    hoisted.dbAtual = db;
    expect(await porTagNaPessoa("123", ID, "")).toEqual({ erro: "Telefone inválido." });
    expect(chamadas).toEqual([]);
  });

  it("tagId que não é uuid devolve erro sem ir ao banco", async () => {
    const { db, chamadas } = dbFalso();
    hoisted.dbAtual = db;
    expect(await porTagNaPessoa("5537" + "980001001", "abc", "")).toEqual({ erro: "Tag inválida." });
    expect(chamadas).toEqual([]);
  });
});

describe("tirarTagDaPessoa", () => {
  it("normaliza o telefone antes de tirar a tag", async () => {
    const { db, chamadas } = dbFalso();
    hoisted.dbAtual = db;
    await tirarTagDaPessoa("(37) " + "98000-1001", ID, null);
    expect(chamadas.find((c) => c.tabela === "rpc:tirar_tag")!.dados).toEqual({ p_telefones: ["5537" + "980001001"], p_tag: ID, p_campanha: null });
  });

  it("telefone inválido ou tagId que não é uuid lança sem ir ao banco", async () => {
    const { db, chamadas } = dbFalso();
    hoisted.dbAtual = db;
    await expect(tirarTagDaPessoa("abc", ID, null)).rejects.toThrow("Telefone inválido.");
    await expect(tirarTagDaPessoa("5537" + "980001001", "abc", null)).rejects.toThrow("Tag inválida.");
    await expect(tirarTagDaPessoa("5537" + "980001001", ID, "abc")).rejects.toThrow("Campanha inválida.");
    expect(chamadas).toEqual([]);
  });
});
