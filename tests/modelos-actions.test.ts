import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, filtro, type Chamada, type Resposta } from "./apoio/db-falso";

const hoisted = vi.hoisted(() => ({
  dbAtual: undefined as unknown,
  exigirUsuarioMock: vi.fn(async () => ({ id: "u1" })),
  revalidar: vi.fn(),
}));

vi.mock("@/src/lib/permissoes", async () => (await import("./apoio/permissoes")).permissoesFalsas());
vi.mock("@/src/lib/supabase/usuario", () => ({ exigirUsuario: hoisted.exigirUsuarioMock, dbUsuario: async () => hoisted.dbAtual }));
vi.mock("next/cache", () => ({ revalidatePath: hoisted.revalidar }));
// `registrarHistorico` usa `dbAdmin` (service role), que este arquivo não mocka (as ações de modelos usam `dbUsuario`):
// sem isto, o teste tentaria criar um client real do Supabase.
vi.mock("@/src/lib/historico", () => ({ registrarHistorico: vi.fn() }));

import { arquivarModelos, duplicarModelos, excluirModelos, moverModelos, salvarModelo } from "@/app/(painel)/modelos/actions";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const MSG = { formato: "texto", texto: "Oi", midia_url: null, nome_arquivo: null, mencionar_todos: false };

function usar(responder?: (c: Chamada) => Resposta) {
  const f = dbFalso(responder);
  hoisted.dbAtual = f.db;
  return f.chamadas;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("salvarModelo", () => {
  it("exige usuário logado", async () => {
    const chamadas = usar();
    hoisted.exigirUsuarioMock.mockRejectedValueOnce(new Error("sem sessão"));
    await expect(salvarModelo(null, { nome: "x", tipo: "mensagem", conteudo: MSG, pasta: null })).rejects.toThrow();
    expect(chamadas).toEqual([]);
  });

  it("cria com a pasta limpa e updated_at", async () => {
    const chamadas = usar();
    expect(await salvarModelo(null, { nome: " Boas-vindas ", tipo: "mensagem", conteudo: MSG, pasta: "  Lançamento " })).toEqual({});
    const ins = chamadas.find((c) => c.op === "insert")!;
    expect(ins.tabela).toBe("modelos");
    const d = ins.dados as Record<string, unknown>;
    expect(d.nome).toBe("Boas-vindas");
    expect(d.pasta).toBe("Lançamento");
    expect(typeof d.updated_at).toBe("string");
    expect(hoisted.revalidar).toHaveBeenCalledWith("/modelos");
  });

  it("pasta vazia ou ausente vira null", async () => {
    const chamadas = usar();
    await salvarModelo(A, { nome: "a", tipo: "mensagem", conteudo: MSG, pasta: "   " });
    await salvarModelo(A, { nome: "a", tipo: "mensagem", conteudo: MSG });
    const ups = chamadas.filter((c) => c.op === "update");
    expect(ups).toHaveLength(2);
    for (const u of ups) {
      expect((u.dados as Record<string, unknown>).pasta).toBeNull();
      expect(filtro(u, "eq", "id")).toBe(A);
    }
  });

  it("conexão o nome por letra (emoji vale 1, como no banco)", async () => {
    usar();
    expect(await salvarModelo(null, { nome: "😀".repeat(60), tipo: "mensagem", conteudo: MSG, pasta: null })).toEqual({});
    expect((await salvarModelo(null, { nome: "😀".repeat(61), tipo: "mensagem", conteudo: MSG, pasta: null })).erro).toBeTruthy();
  });

  it("recusa pasta com mais de 40 letras", async () => {
    const chamadas = usar();
    const r = await salvarModelo(null, { nome: "a", tipo: "mensagem", conteudo: MSG, pasta: "x".repeat(41) });
    expect(r.erro).toMatch(/pasta/i);
    expect(chamadas).toEqual([]);
  });

  it("recusa pasta que não é texto", async () => {
    const chamadas = usar();
    const r = await salvarModelo(null, { nome: "a", tipo: "mensagem", conteudo: MSG, pasta: 3 as unknown as string });
    expect(r.erro).toBeTruthy();
    expect(chamadas).toEqual([]);
  });
});

describe("arquivarModelos", () => {
  it("arquiva os marcados e conexão os que mudaram", async () => {
    const chamadas = usar((c) => (c.op === "update" ? { data: [{ id: A }, { id: B }] } : {}));
    const r = await arquivarModelos([A, B, A], true);
    expect(r).toEqual({ feitas: 2, erros: [] });
    const u = chamadas.find((c) => c.op === "update")!;
    expect((u.dados as Record<string, unknown>).arquivado).toBe(true);
    expect(filtro(u, "in", "id")).toEqual([A, B]);
    expect(hoisted.revalidar).toHaveBeenCalledWith("/modelos");
  });

  it("desarquiva", async () => {
    const chamadas = usar((c) => (c.op === "update" ? { data: [{ id: A }] } : {}));
    expect(await arquivarModelos([A], false)).toEqual({ feitas: 1, erros: [] });
    expect((chamadas[0].dados as Record<string, unknown>).arquivado).toBe(false);
  });

  it("sem marcados ou com lista inválida não toca no banco", async () => {
    const chamadas = usar();
    expect("erro" in (await arquivarModelos([], true))).toBe(true);
    expect("erro" in (await arquivarModelos("x" as unknown as string[], true))).toBe(true);
    expect(chamadas).toEqual([]);
  });

  it("recusa mais de 100 de uma vez", async () => {
    const chamadas = usar();
    const ids = Array.from({ length: 101 }, (_, i) => `id-${i}`);
    expect("erro" in (await arquivarModelos(ids, true))).toBe(true);
    expect(chamadas).toEqual([]);
  });

  it("recusa `arquivar` que não é booleano", async () => {
    const chamadas = usar();
    expect("erro" in (await arquivarModelos([A], "sim" as unknown as boolean))).toBe(true);
    expect(chamadas).toEqual([]);
  });

  it("erro do banco vira erro na lista", async () => {
    usar((c) => (c.op === "update" ? { error: { message: "x" } } : {}));
    const r = await arquivarModelos([A], true);
    expect(r).toEqual({ feitas: 0, erros: [expect.any(String)] });
  });
});

describe("duplicarModelos", () => {
  it("copia nome (cópia), tipo, conteúdo e pasta, sem arquivar", async () => {
    const chamadas = usar((c) => {
      if (c.op === "select") return { data: [{ id: A, nome: "Oi", tipo: "mensagem", conteudo: MSG, pasta: "P" }] };
      if (c.op === "insert") return { data: [{ id: "novo" }] };
      return {};
    });
    const r = await duplicarModelos([A, B]);
    expect(r).toEqual({ feitas: 1, erros: [expect.stringMatching(/não encontrado/i)] });
    const ins = chamadas.find((c) => c.op === "insert")!;
    expect(ins.dados).toEqual([{ nome: "Oi (cópia)", tipo: "mensagem", conteudo: MSG, pasta: "P", arquivado: false, updated_at: expect.any(String) }]);
  });

  it("nenhum encontrado não insere", async () => {
    const chamadas = usar((c) => (c.op === "select" ? { data: [] } : {}));
    const r = await duplicarModelos([A]);
    expect(r).toEqual({ feitas: 0, erros: [expect.any(String)] });
    expect(chamadas.some((c) => c.op === "insert")).toBe(false);
  });

  it("falha ao inserir", async () => {
    usar((c) => (c.op === "select" ? { data: [{ id: A, nome: "Oi", tipo: "mensagem", conteudo: MSG, pasta: null }] } : c.op === "insert" ? { error: { message: "x" } } : {}));
    expect(await duplicarModelos([A])).toEqual({ feitas: 0, erros: [expect.any(String)] });
  });
});

describe("moverModelos", () => {
  it("move para a pasta (sem espaços nas pontas)", async () => {
    const chamadas = usar((c) => (c.op === "update" ? { data: [{ id: A }] } : {}));
    expect(await moverModelos([A], "  Março ")).toEqual({ feitas: 1, erros: [] });
    expect((chamadas[0].dados as Record<string, unknown>).pasta).toBe("Março");
    expect(filtro(chamadas[0], "in", "id")).toEqual([A]);
  });

  it("null tira da pasta", async () => {
    const chamadas = usar((c) => (c.op === "update" ? { data: [{ id: A }] } : {}));
    await moverModelos([A], null);
    expect((chamadas[0].dados as Record<string, unknown>).pasta).toBeNull();
  });

  it("recusa pasta inválida", async () => {
    const chamadas = usar();
    expect("erro" in (await moverModelos([A], "  "))).toBe(true);
    expect("erro" in (await moverModelos([A], "x".repeat(41)))).toBe(true);
    expect(chamadas).toEqual([]);
  });
});

describe("excluirModelos", () => {
  it("apaga os marcados", async () => {
    const chamadas = usar((c) => (c.op === "delete" ? { data: [{ id: A }, { id: B }] } : {}));
    expect(await excluirModelos([A, B])).toEqual({ feitas: 2, erros: [] });
    expect(chamadas[0].op).toBe("delete");
    expect(filtro(chamadas[0], "in", "id")).toEqual([A, B]);
  });

  it("exige usuário logado", async () => {
    const chamadas = usar();
    hoisted.exigirUsuarioMock.mockRejectedValueOnce(new Error("sem sessão"));
    await expect(excluirModelos([A])).rejects.toThrow();
    expect(chamadas).toEqual([]);
  });
});
