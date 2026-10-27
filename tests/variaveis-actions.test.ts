import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, filtro, type Chamada, type Resposta } from "./apoio/db-falso";

const hoisted = vi.hoisted(() => ({
  dbAtual: undefined as unknown,
  adminAtual: undefined as unknown,
  exigirUsuarioMock: vi.fn(async () => ({ id: "u1" })),
  revalidar: vi.fn(),
}));

vi.mock("@/src/lib/permissoes", async () => (await import("./apoio/permissoes")).permissoesFalsas());
vi.mock("@/src/lib/supabase/usuario", () => ({ exigirUsuario: hoisted.exigirUsuarioMock, dbUsuario: async () => hoisted.dbAtual }));
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => hoisted.adminAtual }));
vi.mock("next/cache", () => ({ revalidatePath: hoisted.revalidar }));

import { removerVariavel, salvarValores } from "@/app/(painel)/campanhas/[id]/configuracoes/actions";
import { excluirVariavelGlobal, salvarVariavelGlobal } from "@/app/(painel)/variaveis/actions";

const ID = "11111111-2222-3333-4444-555555555555";
const CAMP = "999" + "99999-2222-3333-4444-555555555555";

function usar(responder?: (c: Chamada) => Resposta) {
  const f = dbFalso(responder);
  hoisted.dbAtual = f.db;
  const admin = dbFalso();
  hoisted.adminAtual = admin.db;
  return { chamadas: f.chamadas, admin: admin.chamadas };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("salvarVariavelGlobal", () => {
  it("exige usuário logado", async () => {
    const { chamadas } = usar();
    hoisted.exigirUsuarioMock.mockRejectedValueOnce(new Error("sem sessão"));
    await expect(salvarVariavelGlobal(null, { chave: "cupom", tipo: "texto", categoria: null })).rejects.toThrow();
    expect(chamadas).toEqual([]);
  });

  it("cria com chave e categoria limpas", async () => {
    const { chamadas } = usar();
    expect(await salvarVariavelGlobal(null, { chave: " cupom ", tipo: "texto", categoria: "  Oferta " })).toEqual({});
    const ins = chamadas.find((c) => c.op === "insert")!;
    expect(ins.tabela).toBe("variaveis_globais");
    expect(ins.dados).toEqual({ chave: "cupom", tipo: "texto", categoria: "Oferta" });
    expect(hoisted.revalidar).toHaveBeenCalledWith("/variaveis");
  });

  it("edita pelo id; categoria vazia vira null", async () => {
    const { chamadas } = usar();
    expect(await salvarVariavelGlobal(ID, { chave: "link_checkout", tipo: "link", categoria: "  " })).toEqual({});
    const up = chamadas.find((c) => c.op === "update")!;
    expect(up.dados).toEqual({ chave: "link_checkout", tipo: "link", categoria: null });
    expect(filtro(up, "eq", "id")).toBe(ID);
  });

  it.each([
    [{ chave: "Cupom", tipo: "texto", categoria: null }],
    [{ chave: "data_aula", tipo: "texto", categoria: null }],
    [{ chave: "cupom", tipo: "cor", categoria: null }],
    [{ chave: "cupom", tipo: "texto", categoria: "x".repeat(41) }],
  ])("recusa entrada inválida %#", async (e) => {
    const { chamadas } = usar();
    expect((await salvarVariavelGlobal(null, e)).erro).toBeTruthy();
    expect(chamadas).toEqual([]);
  });

  it("recusa valores que não são texto", async () => {
    const { chamadas } = usar();
    expect((await salvarVariavelGlobal(null, { chave: 3, tipo: "texto", categoria: null } as never)).erro).toBeTruthy();
    expect(chamadas).toEqual([]);
  });

  it("nome repetido vira erro legível", async () => {
    usar((c) => (c.op === "insert" ? { error: { message: "dup", code: "23505" } } : {}));
    expect((await salvarVariavelGlobal(null, { chave: "cupom", tipo: "texto", categoria: null })).erro).toMatch(/já existe/i);
  });
});

describe("excluirVariavelGlobal", () => {
  it("apaga só a global (os valores nas campanhas ficam)", async () => {
    const { chamadas } = usar();
    expect(await excluirVariavelGlobal(ID)).toEqual({});
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]).toMatchObject({ tabela: "variaveis_globais", op: "delete" });
    expect(filtro(chamadas[0], "eq", "id")).toBe(ID);
  });

  it("erro do banco", async () => {
    usar(() => ({ error: { message: "x" } }));
    expect((await excluirVariavelGlobal(ID)).erro).toBeTruthy();
  });

  it("id inválido não toca no banco", async () => {
    const { chamadas } = usar();
    expect((await excluirVariavelGlobal("" as string)).erro).toBeTruthy();
    expect(chamadas).toEqual([]);
  });
});

describe("salvarValores", () => {
  const globais = (c: Chamada): Resposta =>
    c.tabela === "variaveis_globais" ? { data: [{ chave: "link_checkout", tipo: "link" }, { chave: "data_oferta", tipo: "data" }, { chave: "preco", tipo: "numero" }] } : {};

  it("exige usuário logado", async () => {
    const { chamadas } = usar(globais);
    hoisted.exigirUsuarioMock.mockRejectedValueOnce(new Error("sem sessão"));
    await expect(salvarValores(CAMP, [{ chave: "cupom", valor: "x" }])).rejects.toThrow();
    expect(chamadas).toEqual([]);
  });

  it("grava tudo de uma vez (vazio grava vazio) e libera os passos bloqueados", async () => {
    const { chamadas, admin } = usar(globais);
    const r = await salvarValores(CAMP, [
      { chave: "link_checkout", valor: " https://pay.x/1 " },
      { chave: "data_oferta", valor: "" },
      { chave: "preco", valor: "97,90" },
      { chave: "cupom", valor: "qualquer coisa" },
    ]);
    expect(r).toEqual({});
    const up = chamadas.find((c) => c.op === "upsert")!;
    expect(up.tabela).toBe("campanha_variaveis");
    expect(up.dados).toEqual([
      { campanha_id: CAMP, chave: "link_checkout", valor: "https://pay.x/1" },
      { campanha_id: CAMP, chave: "data_oferta", valor: "" },
      { campanha_id: CAMP, chave: "preco", valor: "97,90" },
      { campanha_id: CAMP, chave: "cupom", valor: "qualquer coisa" },
    ]);
    expect(up.opcoes).toEqual({ onConflict: "campanha_id,chave" });
    expect(admin.some((c) => c.tabela === "execucoes" && c.op === "delete" && filtro(c, "eq", "status") === "bloqueada")).toBe(true);
    expect(hoisted.revalidar).toHaveBeenCalledWith(`/campanhas/${CAMP}`, "layout");
  });

  it("valida o valor pelo tipo da global e não grava nada se algum estiver errado", async () => {
    const { chamadas } = usar(globais);
    const r = await salvarValores(CAMP, [
      { chave: "link_checkout", valor: "pay.x/1" },
      { chave: "data_oferta", valor: "31/02/2026" },
      { chave: "preco", valor: "R$ 10" },
      { chave: "cupom", valor: "ok" },
    ]);
    expect(r.erro).toBeTruthy();
    expect(Object.keys(r.erros ?? {}).sort()).toEqual(["data_oferta", "link_checkout", "preco"]);
    expect(chamadas.some((c) => c.op === "upsert")).toBe(false);
  });

  it("recusa chave inválida ou automática", async () => {
    const { chamadas } = usar(globais);
    const r = await salvarValores(CAMP, [{ chave: "data_aula", valor: "x" }, { chave: "Ruim", valor: "y" }]);
    expect(Object.keys(r.erros ?? {}).sort()).toEqual(["Ruim", "data_aula"]);
    expect(chamadas.some((c) => c.op === "upsert")).toBe(false);
  });

  const chaves = (n: number) => Array.from({ length: n }, (_, i) => ({ chave: `v_${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`, valor: "" }));

  it("aceita até 200 de uma vez (100 globais + 100 só da campanha)", async () => {
    const { chamadas } = usar(globais);
    expect(await salvarValores(CAMP, chaves(200))).toEqual({});
    expect((chamadas.find((c) => c.op === "upsert")!.dados as unknown[]).length).toBe(200);
  });

  it("recusa mais de 200 de uma vez, lista inválida e chave repetida", async () => {
    const { chamadas } = usar(globais);
    expect((await salvarValores(CAMP, chaves(201))).erro).toBeTruthy();
    expect((await salvarValores(CAMP, "x" as never)).erro).toBeTruthy();
    expect((await salvarValores(CAMP, [{ chave: "cupom", valor: 1 } as never])).erro).toBeTruthy();
    expect((await salvarValores(CAMP, [{ chave: "cupom", valor: "a" }, { chave: "cupom", valor: "b" }])).erro).toBeTruthy();
    expect(chamadas.some((c) => c.op === "upsert")).toBe(false);
  });

  it("lista vazia não faz nada", async () => {
    const { chamadas } = usar(globais);
    expect(await salvarValores(CAMP, [])).toEqual({});
    expect(chamadas).toEqual([]);
  });

  it("erro ao gravar", async () => {
    usar((c) => (c.op === "upsert" ? { error: { message: "x" } } : globais(c)));
    expect((await salvarValores(CAMP, [{ chave: "cupom", valor: "a" }])).erro).toBeTruthy();
  });
});

describe("removerVariavel", () => {
  it("apaga a chave da campanha", async () => {
    const { chamadas } = usar();
    expect(await removerVariavel(CAMP, "cupom")).toEqual({});
    expect(chamadas[0]).toMatchObject({ tabela: "campanha_variaveis", op: "delete" });
    expect(filtro(chamadas[0], "eq", "chave")).toBe("cupom");
  });
});
