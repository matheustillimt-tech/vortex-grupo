import { afterEach, describe, expect, it, vi } from "vitest";
import { dbFalso, filtro, type Chamada, type Resposta } from "./apoio/db-falso";

const h = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => h.db }));

import { assinatura } from "@/src/lib/webhooks-assinatura";
import { carregarWebhooks, enfileirarEvento, enfileirarEventos, type WebhookComUrl } from "@/src/lib/webhooks";
import { processarEventos } from "@/src/lib/jobs/eventos";

const TODAS: WebhookComUrl = { id: "w1", url: "https://hook.test/w1", eventos: ["entrou", "alerta"], campanhas: null, ativo: true, arquivado: false };
const DA_CAMPANHA: WebhookComUrl = { id: "w2", url: "https://hook.test/w2", eventos: ["entrou"], campanhas: ["c1"], ativo: true, arquivado: false };
const OUTRA_CAMPANHA: WebhookComUrl = { id: "w3", url: "https://hook.test/w3", eventos: ["entrou"], campanhas: ["c2"], ativo: true, arquivado: false };
const INATIVO: WebhookComUrl = { id: "w4", url: "https://hook.test/w4", eventos: ["entrou"], campanhas: null, ativo: false, arquivado: false };
const SEM_EVENTO: WebhookComUrl = { id: "w5", url: "https://hook.test/w5", eventos: ["saiu"], campanhas: null, ativo: true, arquivado: false };

const legadoPayload = { evento: "entrou", telefone: "5511" + "999990000", campanha: "aulao", grupo: "Turma 01", em: "2026-10-16T00:00:00.000Z" };

function banco(webhooks: WebhookComUrl[] | { error: { message: string } }) {
  return dbFalso((c: Chamada): Resposta => {
    if (c.tabela === "webhooks" && c.op === "select") {
      return Array.isArray(webhooks) ? { data: webhooks } : webhooks;
    }
    return {};
  });
}

describe("enfileirarEvento", () => {
  it("casa com os webhooks certos (evento, campanha, ativo/arquivado) e mantém o legado como veio", async () => {
    const { db, chamadas } = banco([TODAS, DA_CAMPANHA, OUTRA_CAMPANHA, INATIVO, SEM_EVENTO]);
    await enfileirarEvento(db, {
      evento: "entrou",
      campanhaId: "c1",
      dados: { telefone: "5511" + "999990000", campanha: "aulao", campanha_nome: "Aulão", grupo: "Turma 01" },
      legado: [{ url: "https://crm.test/hook", payload: legadoPayload }],
    });
    const linhas = chamadas.find((c) => c.tabela === "eventos_saida")!.dados as { campanha_id: string | null; webhook_id: string | null; url: string; payload: Record<string, unknown> }[];
    expect(linhas).toHaveLength(3); // TODAS + DA_CAMPANHA (casam) + o legado; OUTRA_CAMPANHA, INATIVO e SEM_EVENTO não casam
    const porWebhook = linhas.filter((l) => l.webhook_id);
    expect(porWebhook.map((l) => l.webhook_id).sort()).toEqual(["w1", "w2"]);
    for (const l of porWebhook) {
      expect(l.campanha_id).toBe("c1");
      expect(l.payload).toEqual({ evento: "entrou", telefone: "5511" + "999990000", campanha: "aulao", campanha_nome: "Aulão", grupo: "Turma 01", em: expect.any(String) });
    }
    const legado = linhas.find((l) => !l.webhook_id)!;
    expect(legado.url).toBe("https://crm.test/hook");
    expect(legado.payload).toEqual(legadoPayload); // byte a byte idêntico ao que foi passado — sem webhook_id
    expect(legado.webhook_id).toBeNull();
    // Todas as linhas do lote têm as mesmas colunas (senão o supabase-js manda NULL no lugar do default).
    const chaves = linhas.map((l) => Object.keys(l).sort().join(","));
    expect(new Set(chaves).size).toBe(1);
  });

  it("campanhaId null (ex.: evento de compra) só casa com webhooks de 'todas as campanhas'", async () => {
    const { db, chamadas } = banco([TODAS, DA_CAMPANHA]);
    await enfileirarEvento(db, { evento: "entrou", campanhaId: null, dados: { telefone: "5511" + "999990000" } });
    const linhas = chamadas.find((c) => c.tabela === "eventos_saida")!.dados as { webhook_id?: string }[];
    expect(linhas.map((l) => l.webhook_id)).toEqual(["w1"]);
  });

  it("leitura da tabela de webhooks falhando ainda enfileira o legado (não lança)", async () => {
    const { db, chamadas } = banco({ error: { message: "fora do ar" } });
    await expect(
      enfileirarEvento(db, { evento: "entrou", campanhaId: "c1", dados: { telefone: "x" }, legado: [{ url: "https://crm.test/hook", payload: legadoPayload }] }),
    ).resolves.toBeUndefined();
    const linhas = chamadas.find((c) => c.tabela === "eventos_saida")!.dados as unknown[];
    expect(linhas).toHaveLength(1);
  });

  it("sem casamento e sem legado não insere nada", async () => {
    const { db, chamadas } = banco([]);
    await enfileirarEvento(db, { evento: "entrou", campanhaId: "c1", dados: {} });
    expect(chamadas.some((c) => c.tabela === "eventos_saida")).toBe(false);
  });

  it("insert falhando lança (quem chama decide)", async () => {
    const { db } = dbFalso((c) => (c.tabela === "eventos_saida" ? { error: { message: "caiu" } } : { data: [] }));
    await expect(enfileirarEvento(db, { evento: "entrou", campanhaId: "c1", dados: {}, legado: [{ url: "https://crm.test/hook", payload: legadoPayload }] })).rejects.toThrow(/caiu/);
  });

  it("lista pré-carregada: não lê a tabela de webhooks de novo", async () => {
    const leituras: Chamada[] = [];
    const { db } = dbFalso((c) => {
      if (c.tabela === "webhooks") leituras.push(c);
      return c.tabela === "webhooks" ? { data: [TODAS] } : {};
    });
    await enfileirarEvento(db, { evento: "entrou", campanhaId: "c1", dados: {} }, [TODAS]);
    expect(leituras).toHaveLength(0);
  });

  it("webhooksPreCarregados null (leitura anterior falhou): segue só com o legado", async () => {
    const { db, chamadas } = dbFalso(() => ({}));
    await enfileirarEvento(db, { evento: "entrou", campanhaId: "c1", dados: {}, legado: [{ url: "https://crm.test/hook", payload: legadoPayload }] }, null);
    expect(chamadas.some((c) => c.tabela === "webhooks")).toBe(false);
    const linhas = chamadas.find((c) => c.tabela === "eventos_saida")!.dados as unknown[];
    expect(linhas).toHaveLength(1);
  });
});

describe("enfileirarEventos", () => {
  it("lê os webhooks uma vez só pro lote e junta tudo num insert (sem chave)", async () => {
    const { db, chamadas } = banco([TODAS]);
    await enfileirarEventos(db, [
      { evento: "entrou", campanhaId: "c1", dados: { telefone: "a" }, legado: [{ url: "https://crm.test/hook", payload: { evento: "entrou", telefone: "a" } }] },
      { evento: "entrou", campanhaId: "c1", dados: { telefone: "b" } },
    ]);
    expect(chamadas.filter((c) => c.tabela === "webhooks")).toHaveLength(1);
    const insert = chamadas.find((c) => c.tabela === "eventos_saida" && c.op === "insert")!;
    const linhas = insert.dados as { webhook_id?: string; url: string; payload: { telefone: string } }[];
    expect(linhas.map((l) => [l.webhook_id, l.url, l.payload.telefone]).sort()).toEqual([
      [null, "https://crm.test/hook", "a"],
      ["w1", "https://hook.test/w1", "a"],
      ["w1", "https://hook.test/w1", "b"],
    ]);
    expect(chamadas.some((c) => c.tabela === "eventos_saida" && c.op === "upsert")).toBe(false);
  });

  it("linhas com chave vão por upsert (ignora duplicata); as sem chave seguem por insert separado", async () => {
    const { db, chamadas } = banco([TODAS]);
    await enfileirarEventos(db, [
      { evento: "entrou", campanhaId: "c1", dados: { telefone: "a" }, chave: "entrou:a" },
      { evento: "entrou", campanhaId: "c1", dados: { telefone: "b" }, legado: [{ url: "https://crm.test/hook", payload: { evento: "entrou", telefone: "b" } }] },
    ]);
    const upsert = chamadas.find((c) => c.tabela === "eventos_saida" && c.op === "upsert")!;
    expect(upsert.dados).toEqual([{ campanha_id: "c1", webhook_id: "w1", de_webhook: true, chave: "entrou:a", url: "https://hook.test/w1", payload: expect.objectContaining({ telefone: "a" }) }]);
    expect(upsert.opcoes).toEqual({ onConflict: "webhook_id,chave", ignoreDuplicates: true });
    const insert = chamadas.find((c) => c.tabela === "eventos_saida" && c.op === "insert")!;
    const linhas = insert.dados as { webhook_id?: string; url: string }[];
    expect(linhas).toHaveLength(2); // casado (webhook w1, sem chave) + legado
  });

  it("sem eventos não lê nada nem insere nada", async () => {
    const { db, chamadas } = banco([TODAS]);
    await enfileirarEventos(db, []);
    expect(chamadas).toHaveLength(0);
  });

  it("enfileirarEvento (singular) é um atalho pra um evento só", async () => {
    const { db, chamadas } = banco([TODAS]);
    await enfileirarEvento(db, { evento: "entrou", campanhaId: "c1", dados: { telefone: "a" } });
    const insert = chamadas.find((c) => c.tabela === "eventos_saida" && c.op === "insert")!;
    expect((insert.dados as unknown[]).length).toBe(1);
  });
});

describe("carregarWebhooks", () => {
  it("devolve null (e loga) quando a leitura falha", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db } = banco({ error: { message: "fora do ar" } });
    await expect(carregarWebhooks(db)).resolves.toBeNull();
    expect(erro).toHaveBeenCalled();
    erro.mockRestore();
  });

  it("devolve a lista quando a leitura funciona", async () => {
    const { db } = banco([TODAS]);
    await expect(carregarWebhooks(db)).resolves.toEqual([TODAS]);
  });
});

describe("processarEventos — assinatura", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function montarFila(eventos: { id: string; url: string; payload: unknown; tentativas: number; webhook_id: string | null; de_webhook?: boolean }[], segredos: { id: string; segredo: string }[] = []) {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "rpc:pegar_eventos") return { data: eventos };
      if (c.tabela === "webhooks" && c.op === "select") return { data: segredos.filter((s) => (filtro(c, "in", "id") as string[] | undefined)?.includes(s.id)) };
      if (c.tabela === "eventos_saida") return { data: null };
      return {};
    });
    h.db = db;
    return chamadas;
  }

  it("evento com webhook_id manda o cabeçalho X-Vortex-Grupo-Assinatura (HMAC do corpo exato)", async () => {
    const payload = { evento: "entrou", telefone: "x", em: "2026-10-16T00:00:00.000Z" };
    montarFila([{ id: "e1", url: "https://hook.test/w1", payload, tentativas: 0, webhook_id: "w1" }], [{ id: "w1", segredo: "segredo-1" }]);
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await processarEventos({ ate: Date.now() + 60_000 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://hook.test/w1");
    const corpo = String(init.body);
    expect(corpo).toBe(JSON.stringify(payload));
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Vortex-Grupo-Assinatura"]).toBe(`sha256=${assinatura("segredo-1", corpo)}`);
  });

  it("evento legado (sem webhook_id) não manda o cabeçalho de assinatura", async () => {
    const payload = { evento: "entrou", telefone: "x", em: "2026-10-16T00:00:00.000Z" };
    montarFila([{ id: "e1", url: "https://crm.test/hook", payload, tentativas: 0, webhook_id: null }]);
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await processarEventos({ ate: Date.now() + 60_000 });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["X-Vortex-Grupo-Assinatura"]).toBeUndefined();
  });

  it("webhook excluído (webhook_id preenchido mas sem linha em webhooks): segue sem assinatura", async () => {
    const payload = { evento: "entrou", telefone: "x", em: "2026-10-16T00:00:00.000Z" };
    // `webhook_id` não nulo mas a leitura de segredos não encontra a linha (webhook já foi excluído antes de
    // a FK zerar a coluna, ou a leitura falhou) — não é pra travar o envio nem assinar com segredo errado.
    montarFila([{ id: "e1", url: "https://hook.test/w1", payload, tentativas: 0, webhook_id: "w1" }], []);
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await processarEventos({ ate: Date.now() + 60_000 });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["X-Vortex-Grupo-Assinatura"]).toBeUndefined();
  });

  it("de_webhook=true e webhook_id nulo (webhook excluído entre o enfileiramento e esta rodada): marca erro e não manda", async () => {
    const payload = { evento: "entrou", telefone: "x", em: "2026-10-16T00:00:00.000Z" };
    const chamadas = montarFila([{ id: "e1", url: "https://hook.test/w1", payload, tentativas: 0, webhook_id: null, de_webhook: true }]);
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await processarEventos({ ate: Date.now() + 60_000 });
    expect(fetchMock).not.toHaveBeenCalled();
    const up = chamadas.find((c) => c.tabela === "eventos_saida" && c.op === "update")!;
    expect(up.dados).toEqual({ status: "erro", erro: "Webhook excluído." });
    expect(filtro(up, "eq", "id")).toBe("e1");
  });

  it("de_webhook=true mas webhook_id ainda presente: continua mandando normalmente", async () => {
    const payload = { evento: "entrou", telefone: "x", em: "2026-10-16T00:00:00.000Z" };
    montarFila([{ id: "e1", url: "https://hook.test/w1", payload, tentativas: 0, webhook_id: "w1", de_webhook: true }], [{ id: "w1", segredo: "segredo-1" }]);
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await processarEventos({ ate: Date.now() + 60_000 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
