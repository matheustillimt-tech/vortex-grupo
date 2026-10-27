import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, type Chamada, type Resposta } from "./apoio/db-falso";

const hoisted = vi.hoisted(() => ({ dbAtual: undefined as unknown }));

vi.mock("@/src/lib/permissoes", async () => (await import("./apoio/permissoes")).permissoesFalsas());
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => hoisted.dbAtual }));
vi.mock("@/src/lib/supabase/usuario", () => ({ exigirUsuario: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/src/lib/bloqueio", () => ({ bloquearTelefones: vi.fn(), desbloquearTelefone: vi.fn(), reenfileirarBloqueados: vi.fn() }));

import { atualizarLead, cadastrarLead } from "@/app/(painel)/leads/actions";

const TAG = "11111111-2222-3333-4444-555555555555";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("cadastrarLead", () => {
  it("normaliza o telefone e grava em contatos (upsert)", async () => {
    const { db, chamadas } = dbFalso();
    hoisted.dbAtual = db;
    const r = await cadastrarLead({ telefone: "+55 (37) " + "98000-1001", nome: " Ana ", campos: [{ chave: "cidade", valor: "SP" }] });
    expect(r).toEqual({});
    const up = chamadas.find((c) => c.tabela === "contatos" && c.op === "upsert")!;
    expect(up.dados).toEqual({ telefone: "5537" + "980001001", nome: "Ana", campos: { cidade: "SP" } });
  });

  it("telefone inválido não grava nada", async () => {
    const { db, chamadas } = dbFalso();
    hoisted.dbAtual = db;
    const r = await cadastrarLead({ telefone: "123" });
    expect(r.erro).toBe("Número do WhatsApp inválido.");
    expect(chamadas).toEqual([]);
  });

  it("nome com mais de 80 letras recusa antes de ir ao banco", async () => {
    const { db, chamadas } = dbFalso();
    hoisted.dbAtual = db;
    const r = await cadastrarLead({ telefone: "5537" + "980001001", nome: "x".repeat(81) });
    expect(r.erro).toMatch(/80 letras/);
    expect(chamadas).toEqual([]);
  });

  it("campo inválido (chave repetida) recusa antes de ir ao banco", async () => {
    const { db, chamadas } = dbFalso();
    hoisted.dbAtual = db;
    const r = await cadastrarLead({ telefone: "5537" + "980001001", campos: [{ chave: "a", valor: "1" }, { chave: "A", valor: "2" }] });
    expect(r.erro).toMatch(/repetido/);
    expect(chamadas).toEqual([]);
  });

  it("tagIds por id: põe cada tag depois de gravar o contato", async () => {
    const { db, chamadas } = dbFalso();
    hoisted.dbAtual = db;
    const r = await cadastrarLead({ telefone: "5537" + "980001001", tagIds: [TAG] });
    expect(r).toEqual({});
    const rpc = chamadas.find((c) => c.tabela === "rpc:por_tag")!;
    expect(rpc.dados).toEqual({ p_telefones: ["5537" + "980001001"], p_tag: TAG, p_campanha: null });
  });

  it("novaTag: cria a tag manual e põe no contato", async () => {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "tags" && c.op === "insert") return { data: { id: "nova-id" } };
      return {};
    });
    hoisted.dbAtual = db;
    const r = await cadastrarLead({ telefone: "5537" + "980001001", novaTag: "VIP" });
    expect(r).toEqual({});
    const ins = chamadas.find((c) => c.tabela === "tags" && c.op === "insert")!;
    expect(ins.dados).toEqual({ nome: "VIP", tipo: "manual" });
    const rpc = chamadas.find((c) => c.tabela === "rpc:por_tag")!;
    expect(rpc.dados).toEqual({ p_telefones: ["5537" + "980001001"], p_tag: "nova-id", p_campanha: null });
  });

  it("sem tags: não chama a RPC de tag", async () => {
    const { db, chamadas } = dbFalso();
    hoisted.dbAtual = db;
    await cadastrarLead({ telefone: "5537" + "980001001" });
    expect(chamadas.some((c) => c.tabela === "rpc:por_tag")).toBe(false);
  });

  it("erro ao gravar em contatos devolve mensagem e não tenta pôr tag", async () => {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => (c.tabela === "contatos" && c.op === "upsert" ? { error: { message: "x" } } : {}));
    hoisted.dbAtual = db;
    const r = await cadastrarLead({ telefone: "5537" + "980001001", tagIds: [TAG] });
    expect(r.erro).toBe("Não foi possível cadastrar o lead.");
    expect(chamadas.some((c) => c.tabela === "rpc:por_tag")).toBe(false);
  });
});

describe("atualizarLead", () => {
  it("normaliza o telefone e faz upsert do nome/campos", async () => {
    const { db, chamadas } = dbFalso();
    hoisted.dbAtual = db;
    const r = await atualizarLead("(37) " + "98000-1001", "Bruno", [{ chave: "idade", valor: "30" }]);
    expect(r).toEqual({});
    const up = chamadas.find((c) => c.tabela === "contatos" && c.op === "upsert")!;
    expect(up.dados).toEqual({ telefone: "5537" + "980001001", nome: "Bruno", campos: { idade: "30" } });
  });

  it("telefone inválido não grava nada", async () => {
    const { db, chamadas } = dbFalso();
    hoisted.dbAtual = db;
    const r = await atualizarLead("abc", "Bruno", []);
    expect(r.erro).toBe("Telefone inválido.");
    expect(chamadas).toEqual([]);
  });

  it("erro do banco vira mensagem", async () => {
    const { db } = dbFalso(() => ({ error: { message: "x" } }));
    hoisted.dbAtual = db;
    const r = await atualizarLead("5537" + "980001001", "Bruno", []);
    expect(r.erro).toBe("Não foi possível salvar.");
  });
});
