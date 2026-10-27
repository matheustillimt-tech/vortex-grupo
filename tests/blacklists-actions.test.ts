import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, filtro, type Chamada, type Resposta } from "./apoio/db-falso";
import { liberarTudo, negarTudo, usarMembro } from "./apoio/permissoes";

const h = vi.hoisted(() => ({
  db: undefined as unknown,
  reenfileirar: vi.fn(async (..._a: unknown[]) => 0),
  protegidos: vi.fn(async () => new Set<string>()),
  historico: vi.fn(async () => undefined),
}));

vi.mock("@/src/lib/permissoes", async () => (await import("./apoio/permissoes")).permissoesFalsas());
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => h.db }));
vi.mock("@/src/lib/supabase/usuario", () => ({ exigirUsuario: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/src/lib/historico", () => ({ registrarHistorico: h.historico }));
vi.mock("@/src/lib/automacoes", () => ({ telefonesProtegidos: h.protegidos }));
vi.mock("@/src/lib/bloqueio", () => ({ reenfileirarBloqueados: h.reenfileirar }));

import { adicionarNumerosBlacklist, alternarBlacklist, criarBlacklist, excluirBlacklist, removerNumerosBlacklist } from "@/app/(painel)/blacklists/actions";

const ID = "11111111-1111-1111-1111-111111111111";

function usar(responder?: (c: Chamada) => Resposta) {
  const f = dbFalso(responder);
  h.db = f.db;
  return f.chamadas;
}

beforeEach(() => {
  vi.clearAllMocks();
  liberarTudo();
  h.protegidos.mockResolvedValue(new Set<string>());
  h.reenfileirar.mockResolvedValue(0);
});

describe("permissão", () => {
  it("sem antispam/editar nada toca o banco", async () => {
    const chamadas = usar();
    usarMembro({ papel: "membro", permissoes: { antispam: "ver" } });
    expect((await criarBlacklist("X")).erro).toBeTruthy();
    expect((await alternarBlacklist(ID, false)).erro).toBeTruthy();
    expect((await excluirBlacklist(ID)).erro).toBeTruthy();
    expect((await adicionarNumerosBlacklist(ID, "11" + "999998888")).erro).toBeTruthy();
    expect((await removerNumerosBlacklist(ID, ["11" + "999998888"])).erro).toBeTruthy();
    negarTudo();
    expect((await criarBlacklist("X")).erro).toBeTruthy();
    expect(chamadas).toEqual([]);
  });
});

describe("criarBlacklist", () => {
  it("valida o nome e insere só o nome (nasce ativa)", async () => {
    const chamadas = usar((c) => (c.op === "insert" ? { data: { id: ID } } : {}));
    expect((await criarBlacklist("  ")).erro).toBeTruthy();
    expect(await criarBlacklist("  Golpistas ")).toEqual({ id: ID });
    const ins = chamadas.find((c) => c.op === "insert")!;
    expect(ins.tabela).toBe("blacklists");
    expect(ins.dados).toEqual({ nome: "Golpistas" });
    expect(h.historico).toHaveBeenCalledTimes(1);
  });
});

describe("alternarBlacklist", () => {
  it("atualiza ativa; id inválido recusa", async () => {
    const chamadas = usar((c) => (c.op === "update" ? { data: { nome: "L" } } : {}));
    expect((await alternarBlacklist("x", true)).erro).toBe("Blacklist inválida.");
    expect(await alternarBlacklist(ID, false)).toEqual({});
    const up = chamadas.find((c) => c.op === "update")!;
    expect(up.dados).toEqual({ ativa: false });
    expect(filtro(up, "eq", "id")).toBe(ID);
  });
});

describe("adicionarNumerosBlacklist", () => {
  it("recusa mais de 5000 linhas sem tocar no banco", async () => {
    const chamadas = usar();
    const texto = Array.from({ length: 5001 }, (_, i) => `1199${String(i).padStart(7, "0")}`).join("\n");
    expect(await adicionarNumerosBlacklist(ID, texto)).toEqual({ erro: "No máximo 5000 números por vez." });
    expect(chamadas).toEqual([]);
  });

  it("normaliza como lista-telefones, ignora conectado, pula quem já está (com/sem 9) e enfileira se ativa", async () => {
    h.protegidos.mockResolvedValue(new Set(["5511" + "900000009"]));
    h.reenfileirar.mockResolvedValue(2);
    const chamadas = usar((c) => {
      if (c.tabela === "blacklists") return { data: { nome: "L", ativa: true } };
      if (c.tabela === "blacklist_numeros" && c.op === "select") return { data: [{ telefone: "551188887777" }] };
      return {};
    });
    const r = await adicionarNumerosBlacklist(ID, "(11) " + "99999-0001\n11 " + "98888-7777\n+55 11 " + "90000-0009\nabc123\n11" + "999990001");
    expect(r.resumo).toEqual({ novos: 1, jaEstavam: 1, ignorados: 1, invalidos: ["abc123"], remocoes: 2 });
    const up = chamadas.find((c) => c.op === "upsert")!;
    expect(up.dados).toEqual([{ blacklist_id: ID, telefone: "5511" + "999990001" }]);
    expect(h.reenfileirar).toHaveBeenCalledWith(expect.anything(), ["5511" + "999990001"]);
  });

  it("lista inativa: grava mas não enfileira remoção", async () => {
    usar((c) => (c.tabela === "blacklists" ? { data: { nome: "L", ativa: false } } : { data: [] }));
    const r = await adicionarNumerosBlacklist(ID, "11" + "999990001");
    expect(r.resumo).toMatchObject({ novos: 1, remocoes: 0 });
    expect(h.reenfileirar).not.toHaveBeenCalled();
  });

  it("lista que não existe mais", async () => {
    usar(() => ({ data: null }));
    expect(await adicionarNumerosBlacklist(ID, "11" + "999990001")).toEqual({ erro: "Essa blacklist não existe mais." });
  });
});

describe("removerNumerosBlacklist", () => {
  it("apaga com as variantes do nono dígito, só da lista", async () => {
    const chamadas = usar((c) => (c.op === "delete" ? { data: [{ telefone: "5511" + "999990001" }] } : {}));
    expect(await removerNumerosBlacklist(ID, ["5511" + "999990001"])).toEqual({ removidos: 1 });
    const del = chamadas.find((c) => c.op === "delete")!;
    expect(del.tabela).toBe("blacklist_numeros");
    expect(filtro(del, "eq", "blacklist_id")).toBe(ID);
    expect(filtro(del, "in", "telefone")).toEqual(["5511" + "999990001", "551199990001"]);
  });
  it("lista vazia ou grande demais recusa", async () => {
    usar();
    expect((await removerNumerosBlacklist(ID, [])).erro).toBeTruthy();
    expect((await removerNumerosBlacklist(ID, Array.from({ length: 501 }, () => "11" + "999990001"))).erro).toBeTruthy();
  });
});
