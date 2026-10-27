import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, filtro, type Chamada, type Resposta } from "./apoio/db-falso";

// Rota pública dos webhooks de checkout: a venda é gravada por `registrar_venda` (venda não aprovada que chega
// aprovada depois, com a mesma chave, volta pra fila). Autenticação: plataforma conhecida + segredo de qualquer
// integração NÃO arquivada dela (integracoes_checkout, Etapa 3H); a migração copiou o segredo antigo de
// provedores_checkout, então os links já colados nos checkouts continuam valendo.

const hoisted = vi.hoisted(() => ({ dbAtual: undefined as unknown }));
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => hoisted.dbAtual }));

import { POST } from "@/app/api/webhooks/checkout/[provedor]/[segredo]/route";

const INT = "11111111-2222-3333-4444-555555555555";
const INT2 = "22222222-2222-3333-4444-555555555555";
const KIWIFY = { order_id: "ord-1", order_status: "paid", Customer: { mobile: "5511" + "900000001" }, Product: { product_id: "p1", product_name: "Curso" } };

function montar(r: (c: Chamada) => Resposta | null = () => null) {
  const { db, chamadas } = dbFalso((c) => r(c) ?? (c.tabela === "integracoes_checkout" ? { data: [{ id: INT, segredo: "certo" }] } : {}));
  hoisted.dbAtual = db;
  return chamadas;
}
const chamar = (provedor: string, segredo: string, corpo: unknown) =>
  POST(new Request("http://x/api", { method: "POST", body: JSON.stringify(corpo) }), { params: Promise.resolve({ provedor, segredo }) });

beforeEach(() => vi.restoreAllMocks());

describe("POST /api/webhooks/checkout/[provedor]/[segredo]", () => {
  it("venda válida: chama registrar_venda com os campos normalizados e o payload bruto", async () => {
    const chamadas = montar();
    const r = await chamar("kiwify", "certo", KIWIFY);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(chamadas.filter((c) => c.tabela === "vendas")).toEqual([]);
    expect(chamadas.find((c) => c.tabela === "rpc:registrar_venda")!.dados).toEqual({
      p_provedor: "kiwify", p_evento_id: "ord-1", p_aprovada: true, p_telefone: "5511" + "900000001", p_produtos: ["p1", "Curso"], p_payload: KIWIFY, p_integracao: INT,
    });
  });

  it("procura só as integrações NÃO arquivadas da plataforma da URL", async () => {
    const chamadas = montar();
    await chamar("kiwify", "certo", KIWIFY);
    const c = chamadas.find((x) => x.tabela === "integracoes_checkout")!;
    expect(filtro(c, "eq", "plataforma")).toBe("kiwify");
    expect(filtro(c, "eq", "arquivada")).toBe(false);
    expect(chamadas.some((x) => x.tabela === "provedores_checkout")).toBe(false);
  });

  it("regressão: o link antigo (segredo de provedores_checkout, copiado pra integração da plataforma) continua aceito", async () => {
    const ANTIGO = "a".repeat(48);
    const chamadas = montar((c) =>
      c.tabela === "integracoes_checkout" ? { data: [{ id: INT, segredo: ANTIGO }, { id: INT2, segredo: "b".repeat(48) }] } : null,
    );
    const r = await chamar("kiwify", ANTIGO, KIWIFY);
    expect(r.status).toBe(200);
    expect((chamadas.find((c) => c.tabela === "rpc:registrar_venda")!.dados as { p_integracao: string }).p_integracao).toBe(INT);
  });

  it("com várias integrações da plataforma, grava a do segredo que veio na URL", async () => {
    const chamadas = montar((c) =>
      c.tabela === "integracoes_checkout" ? { data: [{ id: INT, segredo: "primeiro" }, { id: INT2, segredo: "segundo" }] } : null,
    );
    expect((await chamar("kiwify", "segundo", KIWIFY)).status).toBe(200);
    expect((chamadas.find((c) => c.tabela === "rpc:registrar_venda")!.dados as { p_integracao: string }).p_integracao).toBe(INT2);
  });

  it("compara com todas as integrações (sem parar na primeira que bate) usando segredosIguais", async () => {
    const crypto = await import("@/src/lib/crypto");
    const espiao = vi.spyOn(crypto, "segredosIguais");
    montar((c) => (c.tabela === "integracoes_checkout" ? { data: [{ id: INT, segredo: "certo" }, { id: INT2, segredo: "outro" }] } : null));
    expect((await chamar("kiwify", "certo", KIWIFY)).status).toBe(200);
    expect(espiao).toHaveBeenCalledTimes(2);
  });

  it("não aprovada também é registrada (aprovada=false), pra a aprovada do mesmo pedido poder virar depois", async () => {
    const chamadas = montar();
    await chamar("kiwify", "certo", { ...KIWIFY, order_status: "waiting_payment" });
    expect((chamadas.find((c) => c.tabela === "rpc:registrar_venda")!.dados as { p_aprovada: boolean }).p_aprovada).toBe(false);
  });

  it("provedor desconhecido ou segredo errado: 404 sem gravar nada", async () => {
    for (const [provedor, segredo] of [["stripe", "certo"], ["kiwify", "errado"], ["kiwify", "cert"]]) {
      const chamadas = montar();
      const r = await chamar(provedor, segredo, KIWIFY);
      expect(r.status).toBe(404);
      expect(chamadas.some((c) => c.tabela.startsWith("rpc:"))).toBe(false);
    }
  });

  it("plataforma sem integração não arquivada (todas arquivadas ou nenhuma): 404", async () => {
    for (const data of [[], null]) {
      const chamadas = montar((c) => (c.tabela === "integracoes_checkout" ? { data } : null));
      expect((await chamar("kiwify", "certo", KIWIFY)).status).toBe(404);
      expect(chamadas.some((c) => c.tabela.startsWith("rpc:"))).toBe(false);
    }
  });

  it("erro ao ler as integrações: 500 (o checkout reenvia), sem gravar", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const chamadas = montar((c) => (c.tabela === "integracoes_checkout" ? { error: { message: "fora do ar" } } : null));
    expect((await chamar("kiwify", "certo", KIWIFY)).status).toBe(500);
    expect(chamadas.some((c) => c.tabela.startsWith("rpc:"))).toBe(false);
  });

  it("formato desconhecido: 200 ignorado, sem gravar", async () => {
    const chamadas = montar();
    expect(await (await chamar("kiwify", "certo", { x: 1 })).json()).toEqual({ ok: true, ignorado: "formato desconhecido" });
    expect(chamadas.some((c) => c.tabela.startsWith("rpc:"))).toBe(false);
  });

  it("erro ao gravar: 500 (o checkout reenvia)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    montar((c) => (c.tabela === "rpc:registrar_venda" ? { error: { message: "fora do ar" } } : null));
    expect((await chamar("kiwify", "certo", KIWIFY)).status).toBe(500);
  });
});
