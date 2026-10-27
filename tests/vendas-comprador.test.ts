import { describe, expect, it, vi } from "vitest";
import { dbFalso, filtro, type Chamada, type Resposta } from "./apoio/db-falso";

const h = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => h.db }));

import { processarVendas } from "@/src/lib/jobs/vendas";

const venda = { id: "v1", provedor: "hotmart", aprovada: true, telefone: "5537" + "980001001", produtos: ["Curso"] };

function banco(extra: (c: Chamada) => Resposta | undefined = () => undefined) {
  return dbFalso((c) => {
    const r = extra(c);
    if (r) return r;
    if (c.tabela === "vendas" && c.op === "select") return { data: [venda] };
    if (c.tabela === "tags") return { data: { id: "tag-comp" } };
    if (c.op === "select") return { data: [] };
    return {};
  });
}

describe("venda aprovada", () => {
  it("põe a tag Comprador no telefone, mesmo sem campanha com o produto", async () => {
    const { db, chamadas } = banco();
    h.db = db;
    await processarVendas();
    expect(chamadas.filter((c) => c.tabela === "rpc:por_tag").map((c) => c.dados)).toEqual([{ p_telefones: ["5537" + "980001001"], p_tag: "tag-comp", p_campanha: null }]);
    expect(chamadas.find((c) => c.tabela === "vendas" && c.op === "update")!.dados).toMatchObject({ resultado: "tag Comprador adicionada" });
  });

  it("falha ao marcar não fecha a venda (tenta de novo na próxima rodada)", async () => {
    const { db, chamadas } = banco((c) => (c.tabela === "rpc:por_tag" ? { error: { message: "caiu" } } : undefined));
    h.db = db;
    await processarVendas();
    expect(chamadas.some((c) => c.tabela === "vendas" && c.op === "update")).toBe(false);
  });

  it("venda recusada não marca", async () => {
    const { db, chamadas } = banco((c) => (c.tabela === "vendas" && c.op === "select" ? { data: [{ ...venda, aprovada: false }] } : undefined));
    h.db = db;
    await processarVendas();
    expect(chamadas.some((c) => c.tabela === "rpc:por_tag")).toBe(false);
  });

  it("enfileira o evento 'compra' (sem campanha) pra webhooks cadastrados de 'todas as campanhas'", async () => {
    const webhook = { id: "w1", url: "https://hook.test/w1", eventos: ["compra"], campanhas: null, ativo: true, arquivado: false };
    const { db, chamadas } = banco((c) => (c.tabela === "webhooks" && c.op === "select" ? { data: [webhook] } : undefined));
    h.db = db;
    await processarVendas();
    const upsert = chamadas.find((c) => c.tabela === "eventos_saida" && c.op === "upsert")!;
    expect(upsert.dados).toEqual([
      { campanha_id: null, webhook_id: "w1", de_webhook: true, chave: "compra:v1", url: "https://hook.test/w1", payload: { evento: "compra", telefone: venda.telefone, produtos: venda.produtos, em: expect.any(String) } },
    ]);
    expect(upsert.opcoes).toEqual({ onConflict: "webhook_id,chave", ignoreDuplicates: true });
    expect(chamadas.find((c) => c.tabela === "vendas" && c.op === "update")).toBeTruthy();
  });

  it("venda recusada não enfileira o evento 'compra'", async () => {
    const webhook = { id: "w1", url: "https://hook.test/w1", eventos: ["compra"], campanhas: null, ativo: true, arquivado: false };
    const { db, chamadas } = banco((c) => {
      if (c.tabela === "vendas" && c.op === "select") return { data: [{ ...venda, aprovada: false }] };
      if (c.tabela === "webhooks" && c.op === "select") return { data: [webhook] };
      return undefined;
    });
    h.db = db;
    await processarVendas();
    expect(chamadas.some((c) => c.tabela === "eventos_saida")).toBe(false);
  });

  it("falha ao enfileirar o evento 'compra' não fecha a venda (tenta de novo, sem duplicar)", async () => {
    const webhook = { id: "w1", url: "https://hook.test/w1", eventos: ["compra"], campanhas: null, ativo: true, arquivado: false };
    const { db, chamadas } = banco((c) => {
      if (c.tabela === "webhooks" && c.op === "select") return { data: [webhook] };
      if (c.tabela === "eventos_saida") return { error: { message: "caiu" } };
      return undefined;
    });
    h.db = db;
    await processarVendas();
    expect(chamadas.some((c) => c.tabela === "vendas" && c.op === "update")).toBe(false);
  });

  it("leitura dos webhooks cadastrados falhou: loga (com o id da venda, sem dado pessoal) e ainda assim marca a venda como processada", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, chamadas } = banco((c) => (c.tabela === "webhooks" && c.op === "select" ? { error: { message: "fora do ar" } } : undefined));
    h.db = db;
    await processarVendas();
    const mensagens = erro.mock.calls.map((c) => String(c[0]));
    expect(mensagens.some((m) => m.includes("v1") && m.includes("webhooks cadastrados"))).toBe(true);
    for (const m of mensagens) {
      expect(m).not.toContain(venda.telefone);
      expect(m).not.toContain("Curso");
    }
    expect(chamadas.find((c) => c.tabela === "vendas" && c.op === "update")).toBeTruthy();
    erro.mockRestore();
  });
});

describe("venda aprovada sem \"Remover compradores\" (removido em 19/10/2026, decisão do dono)", () => {
  const escritas = (cs: Chamada[]) => cs.filter((c) => c.op !== "select").map((c) => ({ tabela: c.tabela, op: c.op, dados: c.dados }));

  it("não lê regras de compra, campanhas nem participantes e não enfileira remoção própria", async () => {
    const { db, chamadas } = banco((c) => (c.tabela === "participantes" ? { data: [{ telefone: venda.telefone, grupo_id: "g1" }] } : undefined));
    h.db = db;
    await processarVendas();
    for (const t of ["regras_compra", "campanhas", "participantes", "acoes"]) expect(chamadas.some((c) => c.tabela === t)).toBe(false);
    expect(JSON.stringify(chamadas)).not.toMatch(/compradores_ativo|regras_compra/);
  });

  it("as escritas são só: tag Comprador, evento 'compra' e venda processada (nesta ordem)", async () => {
    const webhook = { id: "w1", url: "https://hook.test/w1", eventos: ["compra"], campanhas: null, ativo: true, arquivado: false };
    const { db, chamadas } = banco((c) => (c.tabela === "webhooks" && c.op === "select" ? { data: [webhook] } : undefined));
    h.db = db;
    await processarVendas();
    expect(chamadas.filter((c) => c.tabela === "rpc:por_tag")).toHaveLength(1);
    expect(escritas(chamadas).filter((e) => e.tabela !== "rpc:por_tag").map((e) => `${e.tabela}:${e.op}`)).toEqual(["eventos_saida:upsert", "vendas:update"]);
    const up = chamadas.find((c) => c.tabela === "vendas" && c.op === "update")!;
    expect(up.dados).toEqual({ processada_em: expect.any(String), resultado: "tag Comprador adicionada" });
    expect(up.filtros).toContainEqual(["eq", "id", "v1"]);
    expect(up.filtros).toContainEqual(["eq", "aprovada", true]);
  });

  it("venda recusada e sem telefone fecham com o mesmo resultado de antes", async () => {
    for (const [v, resultado] of [
      [{ ...venda, aprovada: false }, "ignorada (não é compra aprovada)"],
      [{ ...venda, telefone: null }, "sem telefone"],
    ] as const) {
      const { db, chamadas } = banco((c) => (c.tabela === "vendas" && c.op === "select" ? { data: [v] } : undefined));
      h.db = db;
      await processarVendas();
      expect(chamadas.find((c) => c.tabela === "vendas" && c.op === "update")!.dados).toMatchObject({ resultado });
      expect(chamadas.some((c) => c.tabela === "rpc:por_tag")).toBe(false);
    }
  });
});

describe("venda com número de fora sem DDI (checkout manda \"961000222\" pra Portugal)", () => {
  const semDdi = (mobile: string) => ({ ...venda, provedor: "kiwify", telefone: null, payload: { Customer: { mobile } } });
  const comParticipantes = (v: unknown, tels: string[]) =>
    banco((c) => {
      if (c.tabela === "vendas" && c.op === "select") return { data: [v] };
      if (c.tabela === "participantes" && c.op === "select" && filtro(c, "like", "telefone")) return { data: tels.map((telefone) => ({ telefone })) };
      return undefined;
    });

  it("acha a pessoa nos grupos pelo final do número e segue com o número completo", async () => {
    const { db, chamadas } = comParticipantes(semDdi("961000222"), ["351" + "961000222", "351" + "961000222"]);
    h.db = db;
    await processarVendas();
    expect(chamadas.find((c) => c.tabela === "participantes" && filtro(c, "like", "telefone"))).toBeTruthy();
    expect(filtro(chamadas.find((c) => c.tabela === "participantes" && filtro(c, "like", "telefone"))!, "like", "telefone")).toBe("%961000222");
    expect(chamadas.find((c) => c.tabela === "rpc:por_tag")!.dados).toMatchObject({ p_telefones: ["351" + "961000222"] });
    expect(chamadas.find((c) => c.tabela === "vendas" && c.op === "update")!.dados).toMatchObject({
      telefone: "351" + "961000222",
      resultado: "número sem DDI achado nos grupos · tag Comprador adicionada",
    });
  });

  it("tira o 0 da frente (Austrália: \"0430780810\" → final 430780810)", async () => {
    const { db, chamadas } = comParticipantes(semDdi("0430780810"), ["61430780810"]);
    h.db = db;
    await processarVendas();
    expect(filtro(chamadas.find((c) => c.tabela === "participantes" && filtro(c, "like", "telefone"))!, "like", "telefone")).toBe("%430780810");
    expect(chamadas.find((c) => c.tabela === "rpc:por_tag")!.dados).toMatchObject({ p_telefones: ["61430780810"] });
  });

  it("duas pessoas com o mesmo final: não arrisca, fica sem telefone", async () => {
    const { db, chamadas } = comParticipantes(semDdi("961000222"), ["351" + "961000222", "55" + "961000222"]);
    h.db = db;
    await processarVendas();
    expect(chamadas.some((c) => c.tabela === "rpc:por_tag")).toBe(false);
    expect(chamadas.find((c) => c.tabela === "vendas" && c.op === "update")!.dados).toEqual({ processada_em: expect.any(String), resultado: "sem telefone" });
  });

  it("ninguém nos grupos com esse final: fica sem telefone", async () => {
    const { db, chamadas } = comParticipantes(semDdi("961000222"), []);
    h.db = db;
    await processarVendas();
    expect(chamadas.find((c) => c.tabela === "vendas" && c.op === "update")!.dados).toMatchObject({ resultado: "sem telefone" });
  });

  it("final curto demais (menos de 9 dígitos) nem procura", async () => {
    const { db, chamadas } = comParticipantes(semDdi("12345678"), ["5512345678"]);
    h.db = db;
    await processarVendas();
    expect(chamadas.some((c) => c.tabela === "participantes")).toBe(false);
  });

  it("falha ao procurar não fecha a venda (tenta de novo na próxima rodada)", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, chamadas } = banco((c) => {
      if (c.tabela === "vendas" && c.op === "select") return { data: [semDdi("961000222")] };
      if (c.tabela === "participantes") return { error: { message: "caiu" } };
      return undefined;
    });
    h.db = db;
    await processarVendas();
    expect(chamadas.some((c) => c.tabela === "vendas" && c.op === "update")).toBe(false);
    erro.mockRestore();
  });
});
