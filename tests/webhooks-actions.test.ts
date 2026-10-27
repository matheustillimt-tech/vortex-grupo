import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, filtro, type Chamada, type Resposta } from "./apoio/db-falso";

const hoisted = vi.hoisted(() => ({
  adminAtual: undefined as unknown,
  exigirUsuarioMock: vi.fn(async () => ({ id: "u1" })),
  revalidar: vi.fn(),
}));

vi.mock("@/src/lib/permissoes", async () => (await import("./apoio/permissoes")).permissoesFalsas());
vi.mock("@/src/lib/supabase/usuario", () => ({ exigirUsuario: hoisted.exigirUsuarioMock }));
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => hoisted.adminAtual }));
vi.mock("next/cache", () => ({ revalidatePath: hoisted.revalidar }));
// `registrarHistorico` também usa `dbAdmin` (o mesmo banco falso acima): sem isto, a gravação do histórico
// apareceria como um `insert` extra nas asserções que contam chamadas por operação.
vi.mock("@/src/lib/historico", () => ({ registrarHistorico: vi.fn() }));

import {
  alternarWebhook,
  arquivarWebhook,
  enviarTeste,
  excluirWebhook,
  regerarSegredo,
  salvarWebhook,
} from "@/app/(painel)/hooks/actions";

const ID = "11111111-2222-3333-4444-555555555555";
const CAMP = "999" + "99999-2222-3333-4444-555555555555";

function usar(responder?: (c: Chamada) => Resposta) {
  const f = dbFalso(responder);
  hoisted.adminAtual = f.db;
  return { chamadas: f.chamadas };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("salvarWebhook", () => {
  it("exige usuário logado", async () => {
    const { chamadas } = usar();
    hoisted.exigirUsuarioMock.mockRejectedValueOnce(new Error("sem sessão"));
    await expect(salvarWebhook(null, { nome: "CRM", url: "https://crm.exemplo.com", eventos: ["entrou"], campanhas: null })).rejects.toThrow();
    expect(chamadas).toEqual([]);
  });

  it("cria com segredo de 24 bytes em hex (48 caracteres) e devolve o segredo", async () => {
    const { chamadas } = usar();
    const r = await salvarWebhook(null, { nome: " CRM de vendas ", url: "https://crm.exemplo.com/entrada", eventos: ["entrou", "compra"], campanhas: null });
    expect(r.erro).toBeUndefined();
    expect(r.segredo).toMatch(/^[0-9a-f]{48}$/);
    const ins = chamadas.find((c) => c.op === "insert")!;
    expect(ins.tabela).toBe("webhooks");
    expect(ins.dados).toMatchObject({ nome: "CRM de vendas", url: "https://crm.exemplo.com/entrada", eventos: ["entrou", "compra"], campanhas: null, segredo: r.segredo });
    expect(hoisted.revalidar).toHaveBeenCalledWith("/hooks");
    expect(hoisted.revalidar).toHaveBeenCalledWith("/hooks/arquivadas");
    expect(hoisted.revalidar).toHaveBeenCalledWith("/");
  });

  it("cria com campanhas escolhidas", async () => {
    const { chamadas } = usar();
    await salvarWebhook(null, { nome: "Alertas", url: "https://alerta.exemplo.com", eventos: ["alerta"], campanhas: [CAMP] });
    const ins = chamadas.find((c) => c.op === "insert")!;
    expect(ins.dados).toMatchObject({ campanhas: [CAMP] });
  });

  it("edita pelo id e não gera nem devolve segredo", async () => {
    const { chamadas } = usar(() => ({ data: [{ id: ID }] }));
    const r = await salvarWebhook(ID, { nome: "Novo nome", url: "https://crm.exemplo.com", eventos: ["saiu"], campanhas: null });
    expect(r).toEqual({});
    const up = chamadas.find((c) => c.op === "update")!;
    expect(up.dados).toEqual({ nome: "Novo nome", url: "https://crm.exemplo.com", eventos: ["saiu"], campanhas: null });
    expect(filtro(up, "eq", "id")).toBe(ID);
    expect(chamadas.some((c) => c.op === "insert")).toBe(false);
  });

  it("editar webhook inexistente (nenhuma linha atualizada): erro e não grava histórico", async () => {
    const { chamadas } = usar(() => ({ data: [] }));
    const r = await salvarWebhook(ID, { nome: "x", url: "https://crm.exemplo.com", eventos: ["saiu"], campanhas: null });
    expect(r).toEqual({ erro: "Webhook não encontrado." });
    const { registrarHistorico } = await import("@/src/lib/historico");
    expect(registrarHistorico).not.toHaveBeenCalled();
    void chamadas;
  });

  it.each([
    [{ nome: "", url: "https://x.com", eventos: ["entrou"], campanhas: null }],
    [{ nome: "x", url: "http://x.com", eventos: ["entrou"], campanhas: null }],
    [{ nome: "x", url: "https://x.com", eventos: [], campanhas: null }],
    [{ nome: "x", url: "https://x.com", eventos: ["evento-invalido"], campanhas: null }],
    [{ nome: "x", url: "https://localhost/y", eventos: ["entrou"], campanhas: null }],
    [{ nome: "x", url: "https://x.com", eventos: ["entrou"], campanhas: ["não-é-uuid"] }],
  ])("recusa entrada inválida %#", async (e) => {
    const { chamadas } = usar();
    expect((await salvarWebhook(null, e as never)).erro).toBeTruthy();
    expect(chamadas).toEqual([]);
  });

  it("id de edição inválido não toca no banco", async () => {
    const { chamadas } = usar();
    expect((await salvarWebhook("não-é-uuid", { nome: "x", url: "https://x.com", eventos: ["entrou"], campanhas: null })).erro).toBeTruthy();
    expect(chamadas).toEqual([]);
  });

  it("erro do banco", async () => {
    usar(() => ({ error: { message: "x" } }));
    expect((await salvarWebhook(null, { nome: "x", url: "https://x.com", eventos: ["entrou"], campanhas: null })).erro).toBeTruthy();
  });
});

/** Resposta padrão de um update/delete que encontrou a linha (o `.select("id")` que as actions fazem depois). */
const ACHOU: Resposta = { data: [{ id: ID }] };

describe("regerarSegredo", () => {
  it("gera e devolve um novo segredo", async () => {
    const { chamadas } = usar(() => ACHOU);
    const r = await regerarSegredo(ID);
    expect(r.segredo).toMatch(/^[0-9a-f]{48}$/);
    const up = chamadas.find((c) => c.op === "update")!;
    expect(up.tabela).toBe("webhooks");
    expect(up.dados).toEqual({ segredo: r.segredo });
    expect(filtro(up, "eq", "id")).toBe(ID);
  });

  it("id inválido não toca no banco", async () => {
    const { chamadas } = usar();
    expect((await regerarSegredo("")).erro).toBeTruthy();
    expect(chamadas).toEqual([]);
  });

  it("erro do banco", async () => {
    usar(() => ({ error: { message: "x" } }));
    expect((await regerarSegredo(ID)).erro).toBeTruthy();
  });

  it("webhook não encontrado (nenhuma linha atualizada)", async () => {
    usar(() => ({ data: [] }));
    expect((await regerarSegredo(ID)).erro).toBe("Webhook não encontrado.");
  });
});

describe("alternarWebhook", () => {
  it("liga e desliga", async () => {
    const { chamadas } = usar(() => ACHOU);
    expect(await alternarWebhook(ID, false)).toEqual({});
    expect(chamadas[0]).toMatchObject({ tabela: "webhooks", op: "update", dados: { ativo: false } });
    expect(filtro(chamadas[0], "eq", "id")).toBe(ID);
  });

  it("desativar marca como erro os eventos desse webhook ainda em fila/processando", async () => {
    const { chamadas } = usar(() => ACHOU);
    await alternarWebhook(ID, false);
    const up = chamadas.find((c) => c.tabela === "eventos_saida" && c.op === "update")!;
    expect(up.dados).toEqual({ status: "erro", erro: "Webhook desativado." });
    expect(filtro(up, "eq", "webhook_id")).toBe(ID);
    expect(filtro(up, "in", "status")).toEqual(["fila", "processando"]);
  });

  it("ativar não toca em eventos_saida", async () => {
    const { chamadas } = usar(() => ACHOU);
    await alternarWebhook(ID, true);
    expect(chamadas.some((c) => c.tabela === "eventos_saida")).toBe(false);
  });

  it("recusa id ou valor inválido", async () => {
    const { chamadas } = usar();
    expect((await alternarWebhook("x", true)).erro).toBeTruthy();
    expect((await alternarWebhook(ID, "sim" as never)).erro).toBeTruthy();
    expect(chamadas).toEqual([]);
  });

  it("webhook não encontrado (nenhuma linha atualizada)", async () => {
    usar(() => ({ data: [] }));
    expect((await alternarWebhook(ID, true)).erro).toBe("Webhook não encontrado.");
  });

  it("falha ao marcar eventos_saida ao desativar: devolve erro e não grava histórico", async () => {
    const { chamadas } = usar((c) => (c.tabela === "eventos_saida" ? { error: { message: "caiu" } } : ACHOU));
    const r = await alternarWebhook(ID, false);
    expect(r.erro).toBeTruthy();
    const { registrarHistorico } = await import("@/src/lib/historico");
    expect(registrarHistorico).not.toHaveBeenCalled();
    void chamadas;
  });
});

describe("arquivarWebhook", () => {
  it("arquiva e desarquiva", async () => {
    const { chamadas } = usar(() => ACHOU);
    expect(await arquivarWebhook(ID, true)).toEqual({});
    expect(chamadas[0]).toMatchObject({ tabela: "webhooks", op: "update", dados: { arquivado: true } });
  });

  it("arquivar marca como erro os eventos desse webhook ainda em fila/processando", async () => {
    const { chamadas } = usar(() => ACHOU);
    await arquivarWebhook(ID, true);
    const up = chamadas.find((c) => c.tabela === "eventos_saida" && c.op === "update")!;
    expect(up.dados).toEqual({ status: "erro", erro: "Webhook arquivado." });
    expect(filtro(up, "eq", "webhook_id")).toBe(ID);
    expect(filtro(up, "in", "status")).toEqual(["fila", "processando"]);
  });

  it("desarquivar não toca em eventos_saida", async () => {
    const { chamadas } = usar(() => ACHOU);
    await arquivarWebhook(ID, false);
    expect(chamadas.some((c) => c.tabela === "eventos_saida")).toBe(false);
  });

  it("erro do banco vira mensagem diferente pra arquivar/desarquivar", async () => {
    usar(() => ({ error: { message: "x" } }));
    expect((await arquivarWebhook(ID, true)).erro).toMatch(/arquivar/);
  });

  it("webhook não encontrado (nenhuma linha atualizada)", async () => {
    usar(() => ({ data: [] }));
    expect((await arquivarWebhook(ID, true)).erro).toBe("Webhook não encontrado.");
  });
});

describe("excluirWebhook", () => {
  it("marca como erro os eventos desse webhook ainda em fila/processando ANTES de excluir, e exclui pelo id", async () => {
    const { chamadas } = usar(() => ACHOU);
    expect(await excluirWebhook(ID)).toEqual({});
    const marcar = chamadas.find((c) => c.tabela === "eventos_saida" && c.op === "update")!;
    expect(marcar.dados).toEqual({ status: "erro", erro: "Webhook excluído." });
    expect(filtro(marcar, "eq", "webhook_id")).toBe(ID);
    expect(filtro(marcar, "in", "status")).toEqual(["fila", "processando"]);
    const del = chamadas.find((c) => c.tabela === "webhooks" && c.op === "delete")!;
    expect(filtro(del, "eq", "id")).toBe(ID);
    // A marcação acontece antes do delete (senão, depois dele, `webhook_id` já estaria zerado pela FK).
    expect(chamadas.indexOf(marcar)).toBeLessThan(chamadas.indexOf(del));
  });

  it("id inválido não toca no banco", async () => {
    const { chamadas } = usar();
    expect((await excluirWebhook("" as string)).erro).toBeTruthy();
    expect(chamadas).toEqual([]);
  });

  it("webhook não encontrado (nenhuma linha excluída)", async () => {
    usar(() => ({ data: [] }));
    expect((await excluirWebhook(ID)).erro).toBe("Webhook não encontrado.");
  });

  it("falha ao marcar eventos_saida pendentes: não chega a excluir o webhook", async () => {
    const { chamadas } = usar((c) => (c.tabela === "eventos_saida" ? { error: { message: "caiu" } } : ACHOU));
    expect((await excluirWebhook(ID)).erro).toBeTruthy();
    expect(chamadas.some((c) => c.tabela === "webhooks" && c.op === "delete")).toBe(false);
  });
});

describe("enviarTeste", () => {
  it("enfileira o evento de teste com a url do webhook", async () => {
    const { chamadas } = usar((c) => (c.tabela === "webhooks" && c.op === "select" ? { data: { url: "https://crm.exemplo.com/entrada" } } : {}));
    const r = await enviarTeste(ID);
    expect(r.erro).toBeUndefined();
    expect(r.mensagem).toBe("Teste na fila; chega em até 1 minuto.");
    const ins = chamadas.find((c) => c.tabela === "eventos_saida" && c.op === "insert")!;
    expect(ins.dados).toMatchObject({ webhook_id: ID, de_webhook: true, campanha_id: null, url: "https://crm.exemplo.com/entrada" });
    expect((ins.dados as { payload: { evento: string; mensagem: string } }).payload).toMatchObject({ evento: "teste", mensagem: "Teste do Vórtex Grupo" });
  });

  it("webhook não encontrado", async () => {
    const { chamadas } = usar((c) => (c.tabela === "webhooks" ? { data: null } : {}));
    expect((await enviarTeste(ID)).erro).toBeTruthy();
    expect(chamadas.some((c) => c.tabela === "eventos_saida")).toBe(false);
  });

  it("id inválido não toca no banco", async () => {
    const { chamadas } = usar();
    expect((await enviarTeste("x")).erro).toBeTruthy();
    expect(chamadas).toEqual([]);
  });

  it("erro ao enfileirar", async () => {
    usar((c) => {
      if (c.tabela === "webhooks" && c.op === "select") return { data: { url: "https://crm.exemplo.com" } };
      if (c.tabela === "eventos_saida") return { error: { message: "x" } };
      return {};
    });
    expect((await enviarTeste(ID)).erro).toBeTruthy();
  });
});
