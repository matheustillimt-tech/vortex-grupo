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
// `registrarHistorico` usa `dbAdmin` (service role), que este arquivo não mocka (as ações de deep link usam
// `dbUsuario`, igual modelos/projetos): sem isto, o teste tentaria criar um client real do Supabase.
vi.mock("@/src/lib/historico", () => ({ registrarHistorico: vi.fn() }));

import { criarDeeplink, excluirDeeplinks, moverDeeplinks } from "@/app/(painel)/deeplinks/actions";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

function usar(responder?: (c: Chamada) => Resposta) {
  const f = dbFalso(responder);
  hoisted.dbAtual = f.db;
  return f.chamadas;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("criarDeeplink", () => {
  it("exige usuário logado", async () => {
    const chamadas = usar();
    hoisted.exigirUsuarioMock.mockRejectedValueOnce(new Error("sem sessão"));
    await expect(criarDeeplink({ nome: "Bio", destino: "https://chat.whatsapp.com/ABC", slug: "bio", pasta: null })).rejects.toThrow();
    expect(chamadas).toEqual([]);
  });

  it("recusa nome, destino ou slug inválidos sem tocar no banco", async () => {
    const chamadas = usar();
    expect(await criarDeeplink({ nome: "", destino: "https://x", slug: "bio", pasta: null })).toEqual({ erro: "Dê um nome de até 60 caracteres." });
    expect(await criarDeeplink({ nome: "Bio", destino: "http://x", slug: "bio", pasta: null })).toEqual({ erro: "O link precisa começar com https://" });
    expect(await criarDeeplink({ nome: "Bio", destino: "https://x", slug: "ab", pasta: null })).toMatchObject({ erro: expect.stringContaining("minúsculas") });
    expect(await criarDeeplink({ nome: "Bio", destino: "https://x", slug: "admin", pasta: null })).toEqual({ erro: "Esse endereço é reservado; escolha outro." });
    expect(chamadas).toEqual([]);
  });

  it("insere com o slug minúsculo e a pasta; grava o histórico", async () => {
    const chamadas = usar((c) => (c.op === "insert" ? { data: { id: A } } : {}));
    const r = await criarDeeplink({ nome: "  Bio  ", destino: "  https://chat.whatsapp.com/ABC  ", slug: "Bio-2", pasta: "Redes" });
    expect(r.erro).toBeUndefined();
    const ins = chamadas.find((c) => c.op === "insert")!;
    expect(ins.tabela).toBe("deeplinks");
    expect(ins.dados).toEqual({ nome: "Bio", destino: "https://chat.whatsapp.com/ABC", slug: "bio-2", pasta: "Redes" });
    expect(hoisted.revalidar).toHaveBeenCalledWith("/deeplinks");
  });

  it("slug repetido (23505) vira mensagem amigável", async () => {
    usar((c) => (c.op === "insert" ? { error: { message: "duplicate", code: "23505" } } : {}));
    const r = await criarDeeplink({ nome: "Bio", destino: "https://x", slug: "bio", pasta: null });
    expect(r).toEqual({ erro: "Já existe um deep link com esse endereço." });
  });
});

describe("moverDeeplinks", () => {
  it("move os marcados pra pasta informada (ou tira de pasta com null)", async () => {
    const chamadas = usar((c) => (c.op === "update" ? { data: [{ id: A }, { id: B }] } : {}));
    const r = await moverDeeplinks([A, B], "Redes");
    expect(r).toEqual({ feitas: 2, erros: [] });
    const upd = chamadas.find((c) => c.op === "update")!;
    expect(upd.dados).toEqual({ pasta: "Redes" });
    expect(filtro(upd, "in", "id")).toEqual([A, B]);
  });

  it("sem ids marcados é erro, sem tocar no banco", async () => {
    const chamadas = usar();
    expect(await moverDeeplinks([], "Redes")).toEqual({ erro: "Marque pelo menos um deep link." });
    expect(chamadas).toEqual([]);
  });
});

describe("excluirDeeplinks", () => {
  it("exclui os marcados e grava o histórico", async () => {
    const chamadas = usar((c) => (c.op === "delete" ? { data: [{ id: A }] } : {}));
    const r = await excluirDeeplinks([A]);
    expect(r).toEqual({ feitas: 1, erros: [] });
    expect(chamadas.find((c) => c.op === "delete")!.tabela).toBe("deeplinks");
  });
});
