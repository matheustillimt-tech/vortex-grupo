import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { dbFalso, filtro, type Chamada, type Resposta } from "./apoio/db-falso";

const h = vi.hoisted(() => ({
  db: undefined as unknown,
  permitir: true,
  usuario: "u1",
  lookup: vi.fn(async (..._a: unknown[]) => [{ address: "93.184.216.34", family: 4 }] as { address: string; family: number }[]),
}));

vi.mock("@/src/lib/permissoes", () => ({
  checarPermissao: vi.fn(async (area: string, nivel: string) =>
    h.permitir && area === "webhooks" && nivel === "editar" ? { ok: true, usuario: { id: h.usuario, email: "u@x" } } : { ok: false, erro: "Sem permissão." },
  ),
}));
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => h.db }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/src/lib/historico", () => ({ registrarHistorico: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: h.lookup }));

import { assinatura } from "@/src/lib/webhooks-assinatura";
import { pendenciaHook } from "@/src/lib/regras/webhooks";
import * as acoes from "@/app/(painel)/hooks/actions";
import { novoToken, salvarWebhook, testarHook } from "@/app/(painel)/hooks/actions";

const ID = "11111111-2222-3333-4444-555555555555";
const TOK = "0123456789abcdef".repeat(3);

function usar(responder?: (c: Chamada) => Resposta) {
  const f = dbFalso(responder);
  h.db = f.db;
  return f.chamadas;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.permitir = true;
  h.usuario = `u-${Math.random()}`;
  h.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
});
afterEach(() => vi.unstubAllGlobals());

const ler = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");

describe("testarHook (passo teste)", () => {
  it("criação: manda {evento:'teste', em, isTest:true} com X-Vortex-Grupo-Token e SEM assinatura (o segredo nem existe), sem seguir redirect, 10 s; devolve status e 500 caracteres", async () => {
    const fetchMock = vi.fn(async () => new Response("x".repeat(800), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await testarHook("https://hook.exemplo.com/entrada", TOK);
    expect(r).toEqual({ status: 201, resposta: "x".repeat(500) });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://hook.exemplo.com/entrada");
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const corpo = JSON.parse(String(init.body));
    expect(corpo).toEqual({ evento: "teste", em: expect.any(String), isTest: true });
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Vortex-Grupo-Token"]).toBe(TOK);
    expect(headers["X-Vortex-Grupo-Assinatura"]).toBeUndefined();
  });

  it("edição: assina com o segredo gravado (nunca com o token); sem token novo, sem X-Vortex-Grupo-Token", async () => {
    const SEG = "f".repeat(48);
    const cs = usar(() => ({ data: { segredo: SEG } }));
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await testarHook("https://hook.exemplo.com", null, ID);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Vortex-Grupo-Assinatura"]).toBe(`sha256=${assinatura(SEG, String(init.body))}`);
    expect(headers["X-Vortex-Grupo-Token"]).toBeUndefined();
    expect(filtro(cs[0], "eq", "id")).toBe(ID);
  });

  it("até 10 testes por pessoa a cada 10 minutos", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    for (let i = 0; i < 10; i++) expect((await testarHook("https://hook.exemplo.com", TOK)).status).toBe(200);
    expect((await testarHook("https://hook.exemplo.com", TOK)).erro).toMatch(/Limite de 10 testes/);
    expect(fetchMock).toHaveBeenCalledTimes(10);
    h.usuario = "outra-pessoa";
    expect((await testarHook("https://hook.exemplo.com", TOK)).status).toBe(200);
  });

  it.each([
    ["https://localhost/x", "localhost"],
    ["https://127.0.0.1/x", "IP privado"],
    ["https://10.0.0.5/x", "IP privado"],
    ["https://[::ffff:127.0.0.1]/x", "IP privado"],
    ["https://servico.internal/x", "host interno"],
    ["http://hook.exemplo.com/x", "https"],
    ["https://user:senha@hook.exemplo.com/x", "usuário"],
    ["https://198.18.0.1/x", "198.18/15"],
    ["https://198.19.255.1/x", "198.18/15"],
    ["https://224.0.0.1/x", "multicast 224/4"],
    ["https://239.255.255.250/x", "multicast 224/4"],
    ["https://240.0.0.1/x", "reservado 240/4"],
    ["https://255.255.255.255/x", "broadcast"],
  ])("recusa %s sem mandar nada (%s)", async (url) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const r = await testarHook(url, TOK);
    expect(r.erro).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("nome público que resolve pra IP privado: recusa (mesmo bloqueio)", async () => {
    h.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }, { address: "192.168.0.10", family: 4 }]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await testarHook("https://interno.exemplo.com/x", TOK)).erro).toBe("A URL não pode apontar para um IP privado.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("DNS falhou: não manda", async () => {
    h.lookup.mockRejectedValue(new Error("ENOTFOUND"));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await testarHook("https://nao-existe.exemplo.com/x", TOK)).erro).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sem permissão ou token inválido: não manda", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    h.permitir = false;
    expect((await testarHook("https://hook.exemplo.com", TOK)).erro).toBe("Sem permissão.");
    h.permitir = true;
    expect((await testarHook("https://hook.exemplo.com", "curto")).erro).toBe("Token inválido.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("redirect: mostra o 3xx e não segue", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/" } })));
    expect(await testarHook("https://hook.exemplo.com", TOK)).toEqual({ status: 302, resposta: "" });
  });

  it("falha de rede vira mensagem (não lança)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));
    expect(await testarHook("https://hook.exemplo.com", TOK)).toEqual({ erro: "Não foi possível conectar na URL." });
  });
});

describe("token", () => {
  it("novoToken: 48 hex, exige Hooks/editar", async () => {
    expect((await novoToken()).token).toMatch(/^[0-9a-f]{48}$/);
    h.permitir = false;
    expect(await novoToken()).toEqual({ erro: "Sem permissão." });
  });

  it("lerToken não existe mais (o token só aparece quando é gerado)", () => {
    expect("lerToken" in acoes).toBe(false);
  });

  it("regerarSegredo continua (único jeito de ter o segredo de assinatura) e o cartão usa", () => {
    expect(typeof acoes.regerarSegredo).toBe("function");
    expect(ler("app/(painel)/hooks/lista.tsx")).toMatch(/regerarSegredo\(webhook\.id\)/);
  });

  it("criação: token na coluna token, segredo do HMAC gerado à parte (diferente)", async () => {
    const cs = usar(() => ({ data: { id: ID } }));
    const r = await salvarWebhook(null, { nome: "CRM", url: "https://crm.exemplo.com", eventos: ["metricas_campanha", "conta_pareada"], campanhas: null }, TOK);
    const ins = cs.find((c) => c.op === "insert")!.dados as Record<string, unknown>;
    expect(ins).toMatchObject({ token: TOK, eventos: ["metricas_campanha", "conta_pareada"] });
    expect(ins.segredo).toMatch(/^[0-9a-f]{48}$/);
    expect(ins.segredo).not.toBe(TOK);
    expect(r.segredo).toBe(ins.segredo);
  });

  it("edição sem 'Gerar novo' (aba velha): não toca em token nem em segredo", async () => {
    const cs = usar(() => ({ data: [{ id: ID }] }));
    await salvarWebhook(ID, { nome: "CRM", url: "https://crm.exemplo.com", eventos: ["entrou"], campanhas: null });
    expect(cs.find((c) => c.op === "update")!.dados).toEqual({ nome: "CRM", url: "https://crm.exemplo.com", eventos: ["entrou"], campanhas: null });
  });

  it("edição depois de 'Gerar novo': troca só o token", async () => {
    const cs = usar(() => ({ data: [{ id: ID }] }));
    await salvarWebhook(ID, { nome: "CRM", url: "https://crm.exemplo.com", eventos: ["entrou"], campanhas: null }, TOK);
    expect(cs.find((c) => c.op === "update")!.dados).toEqual({ nome: "CRM", url: "https://crm.exemplo.com", eventos: ["entrou"], campanhas: null, token: TOK });
  });

  it("token com formato errado: recusa sem tocar no banco", async () => {
    const cs = usar();
    expect(await salvarWebhook(null, { nome: "CRM", url: "https://crm.exemplo.com", eventos: ["entrou"], campanhas: null }, "XYZ")).toEqual({ erro: "Token inválido." });
    expect(cs).toEqual([]);
  });

  it("assistente na edição não relê o token e só manda o novo", () => {
    const s = ler("app/(painel)/hooks/novo/assistente.tsx");
    expect(s).not.toMatch(/lerToken/);
    expect(s).toMatch(/if \(idEdicao\) return;/);
    expect(s).toMatch(/token \?\? undefined\)/);
  });
});

describe("pendenciaHook (passo Hook)", () => {
  const base = { nome: "CRM", url: "https://crm.exemplo.com", eventos: ["entrou"], campanhas: null, token: TOK };
  it("completo: pode seguir", () => expect(pendenciaHook(base)).toBeNull());
  it("edição sem token novo: pode seguir", () => expect(pendenciaHook({ ...base, token: null, criacao: false })).toBeNull());
  it("sem token, URL privada, sem evento, escolher sem campanha: bloqueia", () => {
    expect(pendenciaHook({ ...base, token: null })).toBeTruthy();
    expect(pendenciaHook({ ...base, url: "https://192.168.0.1" })).toBe("A URL não pode apontar para um IP privado.");
    expect(pendenciaHook({ ...base, eventos: [] })).toBeTruthy();
    expect(pendenciaHook({ ...base, campanhas: [] })).toBeTruthy();
  });
});

describe("telas", () => {
  it("páginas novas chamam bloqueio('webhooks') e exigem editar", () => {
    for (const p of ["app/(painel)/hooks/novo/page.tsx", "app/(painel)/hooks/[id]/editar/page.tsx"]) {
      const s = ler(p);
      expect(s).toMatch(/await bloqueio\("webhooks"\)/);
      expect(s).toMatch(/permitido\("webhooks", "editar"\)/);
      expect(s).not.toMatch(/select\([^)]*segredo/);
    }
  });

  it("assistente: stepper, botões e textos", () => {
    const s = ler("app/(painel)/hooks/novo/assistente.tsx");
    for (const t of ["TOKEN", "content_copy", "Gerar novo", "ENVIAR TESTE", "PULAR TESTE", "SALVAR", "Eventos que o Vórtex Grupo não recebe", "Link"]) expect(s).toContain(t);
    expect(s).toMatch(/\{marcados\.length\}\/\{EVENTOS_WEBHOOK\.length\}/);
    const r = ler("src/lib/regras/webhooks.ts");
    expect(r).toMatch(/\{ rotulo: "Webhook", icone: "webhook" \}/);
    expect(r).toMatch(/\{ rotulo: "teste", icone: "play_arrow" \}/);
    expect(r).toMatch(/\{ rotulo: "Confirmar", icone: "check" \}/);
  });

  it("?evento= pré-marca um evento conhecido (Etapa 3N, Tarefa 3); o atalho das Solicitações usa solicitacoes_entrada", () => {
    const pagina = ler("app/(painel)/hooks/novo/page.tsx");
    expect(pagina).toMatch(/searchParams/);
    expect(pagina).toMatch(/EVENTOS_WEBHOOK as readonly string\[\]\)\.includes\(pedido\)/);
    expect(pagina).toMatch(/eventosIniciais=\{evento \? \[evento\] : \[\]\}/);
    const s = ler("app/(painel)/hooks/novo/assistente.tsx");
    expect(s).toMatch(/useState<Evento\[\]>\(inicial\?\.eventos \?\? eventosIniciais \?\? \[\]\)/);
    // O exemplo de payload do passo de teste mostra os dois `tipo`.
    expect(s).toMatch(/eventos\.includes\("solicitacoes_entrada"\)/);
    expect(s).toMatch(/EXEMPLOS_SOLICITACOES\.map/);
    expect(ler("app/(painel)/campanhas/[id]/solicitacoes/configuracoes/page.tsx")).toContain('href: "/hooks/novo?evento=solicitacoes_entrada"');
  });

  it("lista: ADICIONAR abre o assistente, diálogo 'Novo webhook' saiu, editar vai pro assistente, texto do topo", () => {
    expect(ler("app/(painel)/hooks/page.tsx")).toMatch(/href="\/hooks\/novo"/);
    const lista = ler("app/(painel)/hooks/lista.tsx");
    expect(lista).not.toMatch(/Novo webhook/);
    expect(lista).toMatch(/\/hooks\/\$\{webhook\.id\}\/editar/);
    expect(ler("app/(painel)/hooks/comum.ts")).toContain('"Os envios de métricas de campanha acontecem em 3 horários. 7h, 12h e 17h"');
  });

  it("tick tem o passo hooks antes da entrega", () => {
    const t = ler("app/api/cron/tick/route.ts");
    expect(t.indexOf('passo("hooks"')).toBeGreaterThan(-1);
    expect(t.indexOf('passo("hooks"')).toBeLessThan(t.indexOf('passo("eventos"'));
  });
});
