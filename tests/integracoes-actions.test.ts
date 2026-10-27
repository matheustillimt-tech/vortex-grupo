import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, filtro, type Chamada, type Resposta } from "./apoio/db-falso";

// Ações dos webhooks de checkout (entrada), Etapa 3H: tudo por dbAdmin, com webhooks/editar.

const hoisted = vi.hoisted(() => ({
  adminAtual: undefined as unknown,
  revalidar: vi.fn(),
  historico: vi.fn(),
}));

vi.mock("@/src/lib/permissoes", async () => (await import("./apoio/permissoes")).permissoesFalsas());
vi.mock("@/src/lib/supabase/usuario", () => ({ exigirUsuario: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => hoisted.adminAtual }));
vi.mock("next/cache", () => ({ revalidatePath: hoisted.revalidar }));
vi.mock("@/src/lib/historico", () => ({ registrarHistorico: hoisted.historico }));

import { arquivarIntegracao, carregarPayloadEvento, criarIntegracao, regerarLinkIntegracao } from "@/app/(painel)/webhooks/actions";
import { liberarTudo, negarTudo } from "./apoio/permissoes";

const ID = "11111111-2222-3333-4444-555555555555";

function usar(responder?: (c: Chamada) => Resposta) {
  const f = dbFalso(responder);
  hoisted.adminAtual = f.db;
  return f.chamadas;
}

beforeEach(() => {
  vi.clearAllMocks();
  liberarTudo();
});

describe("criarIntegracao", () => {
  it("grava nome (sem espaços nas pontas) e plataforma, sem mandar segredo (vem do default do banco), e devolve o id", async () => {
    const chamadas = usar((c) => (c.op === "insert" ? { data: { id: ID } } : {}));
    expect(await criarIntegracao({ nome: "  Hotmart do lançamento ", plataforma: "hotmart" })).toEqual({ id: ID });
    const ins = chamadas.find((c) => c.op === "insert")!;
    expect(ins.tabela).toBe("integracoes_checkout");
    expect(ins.dados).toEqual({ nome: "Hotmart do lançamento", plataforma: "hotmart" });
    expect(hoisted.revalidar).toHaveBeenCalledWith("/webhooks");
    expect(hoisted.historico).toHaveBeenCalled();
  });

  it("recusa nome vazio, nome longo e plataforma que o Vórtex Grupo não recebe, sem tocar no banco", async () => {
    const chamadas = usar();
    expect((await criarIntegracao({ nome: "  ", plataforma: "hotmart" })).erro).toBeTruthy();
    expect((await criarIntegracao({ nome: "x".repeat(61), plataforma: "hotmart" })).erro).toBeTruthy();
    expect((await criarIntegracao({ nome: "Stripe", plataforma: "stripe" })).erro).toBe("Escolha a plataforma.");
    expect(chamadas).toEqual([]);
  });

  it("erro no banco: mensagem amigável", async () => {
    usar((c) => (c.op === "insert" ? { error: { message: "x" } } : {}));
    expect(await criarIntegracao({ nome: "K", plataforma: "kiwify" })).toEqual({ erro: "Não foi possível criar o webhook." });
  });
});

describe("arquivarIntegracao", () => {
  it("atualiza só `arquivada` da integração", async () => {
    const chamadas = usar((c) => (c.op === "update" ? { data: [{ id: ID }] } : {}));
    expect(await arquivarIntegracao(ID, true)).toEqual({});
    const up = chamadas.find((c) => c.op === "update")!;
    expect(up.tabela).toBe("integracoes_checkout");
    expect(up.dados).toEqual({ arquivada: true });
    expect(filtro(up, "eq", "id")).toBe(ID);
    expect(hoisted.revalidar).toHaveBeenCalledWith(`/webhooks/${ID}`);
  });

  it("id inválido ou inexistente", async () => {
    const chamadas = usar(() => ({ data: [] }));
    expect(await arquivarIntegracao("x", true)).toEqual({ erro: "Webhook inválido." });
    expect(await arquivarIntegracao(ID, "sim" as unknown as boolean)).toEqual({ erro: "Ação inválida." });
    expect(chamadas).toEqual([]);
    expect(await arquivarIntegracao(ID, false)).toEqual({ erro: "Webhook não encontrado." });
  });
});

describe("regerarLinkIntegracao", () => {
  it("grava um segredo novo de 24 bytes em hex e não o devolve (a página relê só pra quem edita)", async () => {
    const chamadas = usar((c) => (c.op === "update" ? { data: [{ id: ID }] } : {}));
    expect(await regerarLinkIntegracao(ID)).toEqual({});
    const up = chamadas.find((c) => c.op === "update")!;
    expect(up.tabela).toBe("integracoes_checkout");
    expect((up.dados as { segredo: string }).segredo).toMatch(/^[0-9a-f]{48}$/);
    expect(Object.keys(up.dados as object)).toEqual(["segredo"]);
  });

  it("dois cliques geram segredos diferentes", async () => {
    const chamadas = usar((c) => (c.op === "update" ? { data: [{ id: ID }] } : {}));
    await regerarLinkIntegracao(ID);
    await regerarLinkIntegracao(ID);
    const [a, b] = chamadas.filter((c) => c.op === "update").map((c) => (c.dados as { segredo: string }).segredo);
    expect(a).not.toBe(b);
  });

  it("inexistente: erro", async () => {
    usar(() => ({ data: [] }));
    expect(await regerarLinkIntegracao(ID)).toEqual({ erro: "Webhook não encontrado." });
  });
});

// Revisão final B, item m1: a lista de eventos não traz mais `vendas.payload` — "Evento" busca o payload de
// uma venda específica só quando a janela abre, por esta ação (checarPermissao "webhooks"/"ver").
describe("carregarPayloadEvento", () => {
  it("devolve o payload da venda", async () => {
    const chamadas = usar((c) => (c.tabela === "vendas" && c.op === "select" ? { data: { payload: { evento: "compra_aprovada" } } } : {}));
    expect(await carregarPayloadEvento(ID)).toEqual({ payload: { evento: "compra_aprovada" } });
    const sel = chamadas.find((c) => c.tabela === "vendas")!;
    expect(sel.op).toBe("select");
    expect(filtro(sel, "eq", "id")).toBe(ID);
  });

  it("exige webhooks/ver", async () => {
    negarTudo();
    const chamadas = usar();
    expect((await carregarPayloadEvento(ID)).erro).toBeTruthy();
    expect(chamadas).toEqual([]);
  });

  it("id inválido não toca no banco", async () => {
    const chamadas = usar();
    expect((await carregarPayloadEvento("x")).erro).toBeTruthy();
    expect(chamadas).toEqual([]);
  });

  it("venda não encontrada", async () => {
    usar(() => ({ data: null }));
    expect(await carregarPayloadEvento(ID)).toEqual({ erro: "Evento não encontrado." });
  });

  it("erro do banco", async () => {
    usar(() => ({ error: { message: "x" } }));
    expect((await carregarPayloadEvento(ID)).erro).toBeTruthy();
  });
});
