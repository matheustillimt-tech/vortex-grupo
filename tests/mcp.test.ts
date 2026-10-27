import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, filtro, type Chamada, type Resposta } from "./apoio/db-falso";

const hoisted = vi.hoisted(() => ({ dbAtual: undefined as unknown, historico: vi.fn() }));
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => hoisted.dbAtual }));
vi.mock("@/src/lib/historico", () => ({ registrarHistorico: hoisted.historico }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { DELETE, GET, POST } from "@/app/api/mcp/route";
import { hashDaChave } from "@/src/lib/api/chaves";

const CHAVE_ENVIO = "vg_" + "E".repeat(8) + "a".repeat(32);
const CHAVE_LEITURA = "vg_" + "L".repeat(8) + "b".repeat(32);
const CHAVE_DESCONHECIDA = "vg_" + "D".repeat(8) + "d".repeat(32);

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const G1 = "55555555-5555-5555-5555-555555555551";

const CHAVES: Record<string, { id: string; nome: string; escopo: string; tipo: string; revogada_em: string | null }> = {
  [hashDaChave(CHAVE_ENVIO)]: { id: "k-envio", nome: "Claude", escopo: "envio", tipo: "mcp", revogada_em: null },
  [hashDaChave(CHAVE_LEITURA)]: { id: "k-leitura", nome: "Leitor", escopo: "leitura", tipo: "mcp", revogada_em: null },
};

/** Banco falso: chave pelo hash, contador de uso (sobe a cada chamada a partir de `usoInicial`) e o resto. */
function montar(resto: (c: Chamada) => Resposta = () => ({}), usoInicial = 1) {
  let uso = usoInicial - 1;
  const r = dbFalso((c) => {
    if (c.tabela === "api_chaves") return { data: CHAVES[filtro(c, "eq", "hash") as string] ?? null };
    if (c.tabela === "rpc:api_registrar_uso") return { data: ++uso };
    return resto(c);
  });
  hoisted.dbAtual = r.db;
  return r.chamadas;
}

const usos = (chamadas: Chamada[]) => chamadas.filter((c) => c.tabela === "rpc:api_registrar_uso").length;

function post(corpo: unknown, opcoes: { chave?: string | null; headers?: Record<string, string> } = {}) {
  const chave = opcoes.chave === undefined ? CHAVE_ENVIO : opcoes.chave;
  return POST(
    new Request("https://gg.test/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(chave ? { authorization: `Bearer ${chave}` } : {}),
        ...(opcoes.headers ?? {}),
      },
      body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
    }),
  );
}

const rpc = (method: string, params?: unknown, id: number | string = 1) => ({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });
const chamar = (name: string, args: unknown = {}, chave?: string) => post(rpc("tools/call", { name, arguments: args }), { chave });
async function resultadoDe(r: Response) {
  expect(r.status).toBe(200);
  const corpo = await r.json();
  expect(corpo.error).toBeUndefined();
  return corpo.result as { content: { type: string; text: string }[]; isError?: boolean };
}

let espioes: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SITE_URL = "https://gg.test";
  espioes = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
});
afterEach(() => {
  const tudo = JSON.stringify(espioes.flatMap((e) => e.mock.calls));
  for (const k of [CHAVE_ENVIO, CHAVE_LEITURA, CHAVE_DESCONHECIDA]) expect(tudo).not.toContain(k);
  expect(tudo.toLowerCase()).not.toContain("bearer");
  espioes.forEach((e) => e.mockRestore());
});

describe("transporte", () => {
  it("initialize: 2025-06-18, tools, Vórtex Grupo; JSON sem sessão; conexão 1 chamada", async () => {
    const chamadas = montar();
    const r = await post(rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "teste", version: "1" } }));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/^application\/json/);
    expect(r.headers.get("mcp-session-id")).toBeNull();
    const corpo = await r.json();
    expect(corpo).toMatchObject({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "Vórtex Grupo", version: "0.1.0" } } });
    expect(usos(chamadas)).toBe(1);
  });

  it("initialize: versão suportada mais antiga é ecoada; desconhecida recebe 2025-06-18 (mesmo com header estranho)", async () => {
    montar();
    expect((await (await post(rpc("initialize", { protocolVersion: "2025-03-26" }))).json()).result.protocolVersion).toBe("2025-03-26");
    const r = await post(rpc("initialize", { protocolVersion: "1999-01-01" }), { headers: { "mcp-protocol-version": "1999-01-01" } });
    expect((await r.json()).result.protocolVersion).toBe("2025-06-18");
  });

  it("MCP-Protocol-Version desconhecido fora do initialize: 400; suportado ou ausente passa", async () => {
    montar();
    const r = await post(rpc("ping"), { headers: { "mcp-protocol-version": "1999-01-01" } });
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe(-32600);
    expect((await post(rpc("ping"), { headers: { "mcp-protocol-version": "2025-06-18" } })).status).toBe(200);
    expect((await post(rpc("ping"))).status).toBe(200);
  });

  it("Accept é tolerante: sem Accept ou só */* também responde JSON", async () => {
    montar();
    const r = await POST(new Request("https://gg.test/api/mcp", { method: "POST", headers: { authorization: `Bearer ${CHAVE_ENVIO}`, accept: "*/*" }, body: JSON.stringify(rpc("ping")) }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
  });

  it("notificação (notifications/initialized) e resposta do cliente: 202 sem corpo", async () => {
    montar();
    const r = await post({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(r.status).toBe(202);
    expect(await r.text()).toBe("");
    const r2 = await post({ jsonrpc: "2.0", id: 9, result: {} });
    expect(r2.status).toBe(202);
    const r3 = await post([{ jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 1 } }]);
    expect(r3.status).toBe(202);
  });

  it("ping → {}; método desconhecido → -32601", async () => {
    montar();
    expect(await (await post(rpc("ping", undefined, "a"))).json()).toEqual({ jsonrpc: "2.0", id: "a", result: {} });
    const r = await post(rpc("resources/list", {}, 7));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ jsonrpc: "2.0", id: 7, error: { code: -32601, message: "Método não encontrado: resources/list" } });
  });

  it("JSON inválido → 400 com -32700; JSON-RPC inválido → -32600", async () => {
    montar();
    const r = await post("{nao é json");
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON inválido." } });
    expect((await (await post({ id: 1, method: "ping" })).json()).error.code).toBe(-32600);
    expect((await (await post(5)).json()).error.code).toBe(-32600);
    expect((await post([])).status).toBe(400);
    expect((await (await post(rpc("tools/list", "x"))).json()).error.code).toBe(-32602);
  });

  it("lote: responde em lista, na ordem, sem as notificações; cada requisição conexão uma chamada", async () => {
    const chamadas = montar();
    const r = await post([rpc("ping", undefined, 1), { jsonrpc: "2.0", method: "notifications/initialized" }, rpc("tools/list", undefined, 2), rpc("nada", undefined, 3)]);
    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(corpo.map((x: { id: number }) => x.id)).toEqual([1, 2, 3]);
    expect(corpo[2].error.code).toBe(-32601);
    expect(usos(chamadas)).toBe(3);
  });

  it("lote que passa de 60 no minuto: 429", async () => {
    const chamadas = montar(() => ({}), 59);
    const r = await post([rpc("ping", undefined, 1), rpc("ping", undefined, 2), rpc("ping", undefined, 3)]);
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBeTruthy();
    expect(usos(chamadas)).toBe(3);
  });

  it("sem chave ou chave errada: 401 SEM WWW-Authenticate (não é um navegador; diferente da API v1)", async () => {
    montar();
    for (const chave of [null, CHAVE_DESCONHECIDA]) {
      const r = await post(rpc("initialize", {}), { chave });
      expect(r.status).toBe(401);
      expect(r.headers.get("www-authenticate")).toBeNull();
    }
  });

  it("Origin: de outro site 403 (antes de tocar no banco); do próprio site ou sem Origin passa", async () => {
    const chamadas = montar();
    for (const origin of ["https://atacante.example", "null", "http://gg.test"]) {
      const r = await post(rpc("ping"), { headers: { origin } });
      expect(r.status, origin).toBe(403);
    }
    expect(chamadas).toHaveLength(0);
    expect((await post(rpc("ping"), { headers: { origin: "https://gg.test" } })).status).toBe(200);
  });

  it("GET e DELETE: 405 com Allow: POST", async () => {
    for (const r of [GET(), DELETE()]) {
      expect(r.status).toBe(405);
      expect(r.headers.get("allow")).toBe("POST");
    }
  });

  it("corpo grande demais: 413 (pelo content-length e, de novo, pelo tamanho em bytes, igual à v1)", async () => {
    montar();
    expect((await post(JSON.stringify({ ...rpc("ping"), x: "a".repeat(300 * 1024) }))).status).toBe(413);

    const chamadas = montar();
    const rCabecalho = await POST(
      new Request("https://gg.test/api/mcp", {
        method: "POST",
        headers: { authorization: `Bearer ${CHAVE_ENVIO}`, "content-length": String(300 * 1024) },
        body: JSON.stringify(rpc("ping")),
      }),
    );
    expect(rCabecalho.status).toBe(413);
    expect(usos(chamadas)).toBe(1); // autenticou (conta 1) antes de olhar o tamanho, mas não chegou a processar a mensagem

    const corpoMultibyte = JSON.stringify({ ...rpc("ping"), x: "á".repeat(240 * 1024) });
    expect(corpoMultibyte.length).toBeLessThanOrEqual(256 * 1024);
    expect(new TextEncoder().encode(corpoMultibyte).length).toBeGreaterThan(256 * 1024);
    expect((await post(corpoMultibyte)).status).toBe(413);
  });

  it("lote com mais de 20 mensagens: 400 com -32600", async () => {
    montar();
    const r = await post(Array.from({ length: 21 }, (_, i) => rpc("ping", undefined, i)));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Lote grande demais (máximo 20)." } });
    expect((await post(Array.from({ length: 20 }, (_, i) => rpc("ping", undefined, i)))).status).toBe(200);
  });
});

describe("tools/list", () => {
  it("as 12 ferramentas com inputSchema; as de envio avisam que é WhatsApp real", async () => {
    montar();
    const r = await post(rpc("tools/list"));
    const { tools } = (await r.json()).result as { tools: { name: string; description: string; inputSchema: { type: string } }[] };
    expect(tools.map((t) => t.name)).toEqual(["listar_campanhas", "ver_campanha", "listar_grupos", "listar_acoes", "listar_contas", "metricas_campanha", "listar_modelos", "enviar_mensagem", "criar_acao", "cancelar_acao", "editar_acao", "criar_campanha", "arquivar_campanha", "excluir_campanha", "criar_modelo", "preparar_upload"]);
    for (const t of tools) expect(t.inputSchema.type).toBe("object");
    for (const n of ["enviar_mensagem", "criar_acao"]) expect(tools.find((t) => t.name === n)!.description).toMatch(/WhatsApp reais/);
  });
});

describe("tools/call: leitura", () => {
  it("listar_campanhas", async () => {
    montar((c) => {
      if (c.tabela === "campanhas") return { data: [{ id: A, nome: "Aulão", slug: "aulao", tipo: "campanha", arquivada: false }] };
      if (c.tabela === "rpc:resumo_campanhas") return { data: [{ campanha_id: A, grupos: 3, participantes: 420 }] };
      return {};
    });
    const res = await resultadoDe(await chamar("listar_campanhas"));
    expect(res.isError).toBeUndefined();
    expect(res.content[0].type).toBe("text");
    expect(JSON.parse(res.content[0].text)).toEqual({ campanhas: [{ id: A, nome: "Aulão", slug: "aulao", link: "https://gg.test/l/aulao", tipo: "campanha", grupos: 3, participantes: 420 }] });
  });

  it("ver_campanha (com métricas) e erro de negócio como isError", async () => {
    montar((c) => {
      if (c.tabela === "campanhas") return { data: { id: A, nome: "Aulão", slug: "aulao", tipo: "campanha", descricao: null, arquivada: false } };
      if (c.tabela === "rpc:resumo_campanhas") return { data: [{ campanha_id: A, cliques: 30, entradas: 12, saidas: 2, grupos: 2, participantes: 100 }] };
      if (c.tabela === "rpc:metricas_campanha") return { data: [] };
      return {};
    });
    const res = await resultadoDe(await chamar("ver_campanha", { campanha: A }, CHAVE_LEITURA));
    expect(JSON.parse(res.content[0].text).campanha).toMatchObject({ id: A, metricas_7_dias: { cliques: 30, entraram: 12, sairam: 2 } });
    const ruim = await resultadoDe(await chamar("ver_campanha", { campanha: "x" }));
    expect(ruim).toEqual({ content: [{ type: "text", text: "Campanha inválida." }], isError: true });
  });

  it("listar_grupos com página", async () => {
    const chamadas = montar((c) => {
      if (c.tabela === "campanhas") return { data: { id: A } };
      if (c.tabela === "grupos") return { data: [{ id: G1, nome: "Aulão #1", numero: 1, link_convite: null, participantes: 10, cheio: false }], count: 1 };
      if (c.tabela === "rpc:resumo_grupos") return { data: [] };
      return {};
    });
    const res = await resultadoDe(await chamar("listar_grupos", { campanha: A, pagina: 2 }));
    expect(JSON.parse(res.content[0].text)).toMatchObject({ pagina: 2, total: 1, grupos: [{ id: G1, numero: 1 }] });
    expect(chamadas.find((c) => c.tabela === "grupos")!.filtros.find((f) => f[0] === "range")).toEqual(["range", 50, 99]);
  });

  it("listar_acoes com campanha e aba; aba inválida é isError", async () => {
    const chamadas = montar((c) => (c.tabela === "rpc:listar_acoes" ? { data: [] } : { data: [] }));
    const res = await resultadoDe(await chamar("listar_acoes", { campanha: A, aba: "agendado" }));
    expect(JSON.parse(res.content[0].text)).toMatchObject({ acoes: [], pagina: 1 });
    expect(chamadas.find((c) => c.tabela === "rpc:listar_acoes")!.dados).toMatchObject({ p_campanha: A, p_aba: "agendado" });
    expect((await resultadoDe(await chamar("listar_acoes", { aba: "lixo" }))).isError).toBe(true);
  });

  it("listar_contas com telefone mascarado", async () => {
    montar((c) => (c.tabela === "conexoes" ? { data: [{ id: "c1", nome: "Suporte", telefone: "5511" + "987651234", status: "conectado" }] } : {}));
    const res = await resultadoDe(await chamar("listar_contas", {}, CHAVE_LEITURA));
    expect(JSON.parse(res.content[0].text)).toEqual({ contas: [{ id: "c1", nome: "Suporte", telefone: "+55 •• •••• 1234", conectado: true }] });
  });

  it("ferramenta desconhecida ou arguments inválido: -32602", async () => {
    montar();
    expect((await (await chamar("apagar_tudo")).json()).error).toEqual({ code: -32602, message: "Ferramenta desconhecida: apagar_tudo" });
    expect((await (await chamar("listar_contas", [1])).json()).error.code).toBe(-32602);
    expect((await (await post(rpc("tools/call", {}))).json()).error.code).toBe(-32602);
  });

  it("falha inesperada vira isError sem derrubar a resposta", async () => {
    hoisted.dbAtual = dbFalso((c) => {
      if (c.tabela === "api_chaves") return { data: CHAVES[filtro(c, "eq", "hash") as string] ?? null };
      if (c.tabela === "rpc:api_registrar_uso") return { data: 1 };
      throw new Error("boom");
    }).db;
    const res = await resultadoDe(await chamar("listar_contas"));
    expect(res.isError).toBe(true);
  });
});

describe("tools/call: envio", () => {
  function bancoAcao() {
    let n = 0;
    return montar((c) => {
      if (c.tabela === "campanhas" && c.op === "select") {
        const ids = filtro(c, "in", "id") as string[] | undefined;
        return { data: (ids ?? []).filter((id) => id === A).map((id) => ({ id, arquivada: false })) };
      }
      if (c.tabela === "execucoes" && c.op === "insert") return { data: (c.dados as unknown[]).map(() => ({ id: `e${++n}` })) };
      return {};
    });
  }

  it("enviar_mensagem: ação 'mensagem' v2 com um texto, histórico via API, ids + link /acoes", async () => {
    const chamadas = bancoAcao();
    const res = await resultadoDe(await chamar("enviar_mensagem", { campanhas: [A], texto: "Começa às 20h!", agendar_para: "2099-01-01T10:00:00" }));
    expect(res.isError).toBeUndefined();
    expect(JSON.parse(res.content[0].text)).toEqual({ ids: ["e1"], link: "https://gg.test/acoes", mensagem: "Ação criada." });
    const ins = chamadas.find((c) => c.tabela === "execucoes" && c.op === "insert")!;
    const linha = (ins.dados as Record<string, unknown>[])[0];
    // Sem fuso = Brasília: 10:00 BRT = 13:00 UTC.
    expect(linha).toMatchObject({ campanha_id: A, tipo: "mensagem", origem: "avulsa", criada_por: null, agendada_para: "2099-01-01T13:00:00.000Z" });
    expect(linha.conteudo).toMatchObject({ versao: 2, mensagens: [{ formato: "texto", texto: "Começa às 20h!" }] });
    expect(hoisted.historico).toHaveBeenCalledWith(null, expect.objectContaining({ resumo: "Enviar mensagem em 1 campanha, agendada via API (chave Claude)" }));
  });

  it("enviar_mensagem: agendar_para com fuso é respeitado; sem agendar_para é agora", async () => {
    const chamadas = bancoAcao();
    await resultadoDe(await chamar("enviar_mensagem", { campanhas: [A], texto: "oi", agendar_para: "2099-01-01T10:00:00Z" }));
    expect(((chamadas.find((c) => c.tabela === "execucoes")!.dados as Record<string, unknown>[])[0]).agendada_para).toBe("2099-01-01T10:00:00.000Z");
    const r = await resultadoDe(await chamar("enviar_mensagem", { campanhas: [A], texto: "oi" }));
    expect(r.isError).toBeUndefined();
    expect(hoisted.historico).toHaveBeenLastCalledWith(null, expect.objectContaining({ resumo: expect.stringContaining("agora via API") }));
  });

  it("enviar_mensagem: erros de validação viram isError sem gravar", async () => {
    const chamadas = bancoAcao();
    for (const args of [{ campanhas: [B], texto: "oi" }, { campanhas: [A], texto: "  " }, { texto: "oi" }, { campanhas: [A], texto: "oi", agendar_para: "amanhã" }]) {
      const res = await resultadoDe(await chamar("enviar_mensagem", args));
      expect(res.isError, JSON.stringify(args)).toBe(true);
    }
    expect(chamadas.some((c) => c.tabela === "execucoes")).toBe(false);
  });

  it("criar_acao: nome, descricao, abrir e fechar com o conteúdo certo", async () => {
    const chamadas = bancoAcao();
    const casos: [Record<string, unknown>, string, unknown][] = [
      [{ tipo: "nome", nome: "Aulão {n}" }, "nome", { padrao: "Aulão {n}" }],
      [{ tipo: "descricao", descricao: "Regras do grupo" }, "descricao", { texto: "Regras do grupo" }],
      [{ tipo: "abrir" }, "abrir", {}],
      [{ tipo: "fechar" }, "fechar", {}],
    ];
    for (const [args, tipo, conteudo] of casos) {
      const res = await resultadoDe(await chamar("criar_acao", { campanhas: [A], ...args }));
      expect(res.isError, tipo).toBeUndefined();
      expect(JSON.parse(res.content[0].text).link).toBe("https://gg.test/acoes");
      const ins = chamadas.filter((c) => c.tabela === "execucoes" && c.op === "insert").at(-1)!;
      expect((ins.dados as Record<string, unknown>[])[0]).toMatchObject({ tipo, conteudo });
    }
  });

  it("criar_acao: tipo fora da lista ou nome vazio é isError", async () => {
    const chamadas = bancoAcao();
    const r1 = await resultadoDe(await chamar("criar_acao", { campanhas: [A], tipo: "desativar_comunidade" }));
    expect(r1).toEqual({ content: [{ type: "text", text: "Tipo inválido: use nome, descricao, abrir, fechar ou imagem." }], isError: true });
    expect((await resultadoDe(await chamar("criar_acao", { campanhas: [A], tipo: "nome" }))).isError).toBe(true);
    expect(chamadas.some((c) => c.tabela === "execucoes")).toBe(false);
  });

  it("enviar_mensagem: sequência com áudio, vídeo e texto, marcando todos", async () => {
    const chamadas = bancoAcao();
    const mensagens = [
      { formato: "audio", midia_url: "https://x.test/a.ogg" },
      { formato: "video", midia_url: "https://x.test/v.mp4", legenda: "Assista" },
      { formato: "texto", texto: "É HOJE!" },
    ];
    const res = await resultadoDe(await chamar("enviar_mensagem", { campanhas: [A], mensagens, mencionar_todos: true, agendar_para: "2099-01-01T19:00:00" }));
    expect(res.isError).toBeUndefined();
    const linha = ((chamadas.find((c) => c.tabela === "execucoes" && c.op === "insert")!.dados as Record<string, unknown>[])[0]);
    expect(linha.conteudo).toMatchObject({
      versao: 2,
      mensagens: [
        { formato: "audio", midia_url: "https://x.test/a.ogg", legenda: "" },
        { formato: "video", midia_url: "https://x.test/v.mp4", legenda: "Assista" },
        { formato: "texto", texto: "É HOJE!" },
      ],
      opcoes: { mencionar_todos: true },
    });
  });

  it("enviar_mensagem: enquete no meio da sequência (áudio, enquete, texto marcando todos)", async () => {
    const chamadas = bancoAcao();
    const mensagens = [
      { formato: "audio", midia_url: "https://x.test/a.ogg" },
      { formato: "enquete", pergunta: " Pra que você quer? ", opcoes: ["Vender", " Automatizar "] },
      { formato: "texto", texto: "Vota aí!" },
    ];
    const res = await resultadoDe(await chamar("enviar_mensagem", { campanhas: [A], mensagens, mencionar_todos: true, agendar_para: "2099-01-01T19:00:00" }));
    expect(res.isError).toBeUndefined();
    const linha = ((chamadas.find((c) => c.tabela === "execucoes" && c.op === "insert")!.dados as Record<string, unknown>[])[0]);
    expect(linha.conteudo).toMatchObject({
      versao: 2,
      mensagens: [
        { formato: "audio", midia_url: "https://x.test/a.ogg" },
        { formato: "enquete", enquete: { pergunta: "Pra que você quer?", opcoes: ["Vender", "Automatizar"], max_respostas: 1 } },
        { formato: "texto", texto: "Vota aí!" },
      ],
      opcoes: { mencionar_todos: true },
    });
  });

  it("enviar_mensagem: enquete sem pergunta, com 1 opção ou opção repetida é isError sem gravar", async () => {
    const chamadas = bancoAcao();
    for (const enquete of [
      { formato: "enquete", opcoes: ["a", "b"] },
      { formato: "enquete", pergunta: "P?", opcoes: ["a"] },
      { formato: "enquete", pergunta: "P?", opcoes: ["a", "a"] },
      { formato: "enquete", pergunta: "P?", opcoes: ["a", "b"], max_respostas: 3 },
    ]) {
      expect((await resultadoDe(await chamar("enviar_mensagem", { campanhas: [A], mensagens: [enquete] }))).isError, JSON.stringify(enquete)).toBe(true);
    }
    expect(chamadas.some((c) => c.tabela === "execucoes")).toBe(false);
  });

  const E1 = "999" + "99999-9999-9999-9999-999" + "999999991";
  /** Banco com uma execução: `linha` (parcial) sobre um padrão agendado; updates respondem pelo filtro de status. */
  function bancoExecucao(linha: Record<string, unknown> | null) {
    const exec = linha && { id: E1, campanha_id: A, status: "agendada", agendada_para: "2099-01-01T13:00:00.000Z", alvo_contas: null, alvo_grupos: null, importante: false, ...linha };
    return montar((c) => {
      if (c.tabela !== "execucoes") return {};
      if (c.op === "select") return { data: exec };
      if (c.op === "update" && filtro(c, "eq", "id") === E1) return { data: exec?.status === "agendada" ? [{ id: E1 }] : [] };
      return { data: [] };
    });
  }
  const updates = (ch: Chamada[]) => ch.filter((c) => c.tabela === "execucoes" && c.op === "update");

  it("cancelar_acao: agendada vira cancelada (com as seguintes), histórico via API", async () => {
    const chamadas = bancoExecucao({ tipo: "nome", conteudo: { padrao: "🔴 É HOJE #{n}" } });
    const res = await resultadoDe(await chamar("cancelar_acao", { acao: E1 }));
    expect(res.isError).toBeUndefined();
    expect(JSON.parse(res.content[0].text)).toMatchObject({ id: E1, mensagem: "Ação cancelada." });
    const [principal, seguintes] = updates(chamadas);
    expect(principal.dados).toEqual({ status: "cancelada" });
    expect(filtro(principal, "eq", "status")).toBe("agendada");
    expect(filtro(seguintes, "in", "depois_de")).toEqual([E1]);
    expect(hoisted.historico).toHaveBeenCalledWith(null, expect.objectContaining({ acao: "remover", resumo: expect.stringContaining("cancelada via API (chave Claude)") }));
  });

  it("cancelar_acao: já começou, não existe ou id inválido é isError sem cancelar", async () => {
    let chamadas = bancoExecucao({ tipo: "nome", conteudo: { padrao: "x" }, status: "enviando" });
    let res = await resultadoDe(await chamar("cancelar_acao", { acao: E1 }));
    expect(res).toMatchObject({ isError: true, content: [{ text: "Já começou: não dá mais pra cancelar." }] });
    expect(updates(chamadas)).toHaveLength(0);
    chamadas = bancoExecucao(null);
    res = await resultadoDe(await chamar("cancelar_acao", { acao: E1 }));
    expect(res).toMatchObject({ isError: true, content: [{ text: "Ação não encontrada." }] });
    expect((await resultadoDe(await chamar("cancelar_acao", { acao: "x" }))).isError).toBe(true);
    expect(updates(chamadas)).toHaveLength(0);
  });

  it("editar_acao: troca o nome e mantém o horário", async () => {
    const chamadas = bancoExecucao({ tipo: "nome", conteudo: { padrao: "🔴 É HOJE: 100K #{n}" } });
    const res = await resultadoDe(await chamar("editar_acao", { acao: E1, nome: "⚫ É HOJE: 100K #{n}" }));
    expect(res.isError).toBeUndefined();
    expect(JSON.parse(res.content[0].text)).toMatchObject({ id: E1, agendada_para: "2099-01-01T13:00:00.000Z", mensagem: "Ação editada." });
    const [u] = updates(chamadas);
    expect(u.dados).toMatchObject({ conteudo: { padrao: "⚫ É HOJE: 100K #{n}" }, agendada_para: "2099-01-01T13:00:00.000Z" });
    expect(filtro(u, "eq", "status")).toBe("agendada");
    expect(hoisted.historico).toHaveBeenCalledWith(null, expect.objectContaining({ acao: "atualizar", resumo: expect.stringContaining("editada via API (chave Claude)") }));
  });

  it("editar_acao: mensagem — só o horário, ou só mencionar_todos (mantém as mensagens), ou texto novo", async () => {
    const conteudo = { versao: 2, mensagens: [{ formato: "texto", texto: "oi" }], opcoes: { mencionar_todos: false, temporarias: "nao", fixar: "nao", intervalo_grupos: "nao", intervalo_mensagens: false } };
    let chamadas = bancoExecucao({ tipo: "mensagem", conteudo });
    await resultadoDe(await chamar("editar_acao", { acao: E1, agendar_para: "2099-01-02T08:30:00" }));
    expect(updates(chamadas)[0].dados).toMatchObject({ agendada_para: "2099-01-02T11:30:00.000Z", conteudo: { mensagens: [{ formato: "texto", texto: "oi" }] } });
    chamadas = bancoExecucao({ tipo: "mensagem", conteudo });
    await resultadoDe(await chamar("editar_acao", { acao: E1, mencionar_todos: true }));
    expect(updates(chamadas)[0].dados).toMatchObject({ conteudo: { mensagens: [{ formato: "texto", texto: "oi" }], opcoes: { mencionar_todos: true } } });
    chamadas = bancoExecucao({ tipo: "mensagem", conteudo });
    await resultadoDe(await chamar("editar_acao", { acao: E1, texto: "novo" }));
    expect(updates(chamadas)[0].dados).toMatchObject({ conteudo: { mensagens: [{ formato: "texto", texto: "novo" }] } });
  });

  it("editar_acao: sem mudança, nome vazio, campo do tipo errado, horário passado ou já começou é isError sem gravar", async () => {
    for (const [linha, args] of [
      [{ tipo: "nome", conteudo: { padrao: "x" } }, { acao: E1 }],
      [{ tipo: "nome", conteudo: { padrao: "x" } }, { acao: E1, nome: "   " }],
      [{ tipo: "nome", conteudo: { padrao: "x" } }, { acao: E1, texto: "oi" }],
      [{ tipo: "nome", conteudo: { padrao: "x" } }, { acao: E1, agendar_para: "2000-01-01T10:00:00" }],
      [{ tipo: "nome", conteudo: { padrao: "x" }, status: "concluida" }, { acao: E1, nome: "ok #{n}" }],
      [{ tipo: "abrir", conteudo: {} }, { acao: E1, texto: "oi" }],
    ] as const) {
      const chamadas = bancoExecucao(linha as Record<string, unknown>);
      expect((await resultadoDe(await chamar("editar_acao", args))).isError, JSON.stringify(args)).toBe(true);
      expect(updates(chamadas), JSON.stringify(args)).toHaveLength(0);
    }
  });

  it("enviar_mensagem: texto e mensagens juntos, lista vazia ou mídia sem https é isError sem gravar", async () => {
    const chamadas = bancoAcao();
    for (const args of [
      { campanhas: [A], texto: "oi", mensagens: [{ formato: "texto", texto: "oi" }] },
      { campanhas: [A], mensagens: [] },
      { campanhas: [A], mensagens: [{ formato: "video", midia_url: "http://x.test/v.mp4" }] },
      { campanhas: [A] },
    ]) {
      expect((await resultadoDe(await chamar("enviar_mensagem", args))).isError, JSON.stringify(args)).toBe(true);
    }
    expect(chamadas.some((c) => c.tabela === "execucoes")).toBe(false);
  });

  it("criar_acao: imagem com URL do midias vira \"Trocar imagem\"; URL de fora é isError", async () => {
    const chamadas = bancoAcao();
    const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/midias/mcp/1-capa.jpg`;
    const ok = await resultadoDe(await chamar("criar_acao", { campanhas: [A], tipo: "imagem", imagem_url: url, nome_arquivo: "capa.jpg" }));
    expect(ok.isError).toBeUndefined();
    const ins = chamadas.filter((c) => c.tabela === "execucoes" && c.op === "insert").at(-1)!;
    expect((ins.dados as Record<string, unknown>[])[0]).toMatchObject({ tipo: "imagem", conteudo: { url, nome_arquivo: "capa.jpg" } });
    const fora = await resultadoDe(await chamar("criar_acao", { campanhas: [A], tipo: "imagem", imagem_url: "https://outro.site/capa.jpg" }));
    expect(fora.isError).toBe(true);
  });

  it("preparar_upload: link assinado no midias/mcp e a midia_url pública; chave de leitura não pode", async () => {
    bancoAcao();
    const assinar = vi.fn(async (caminho: string) => ({ data: { signedUrl: `https://s.test/upload/${caminho}?token=t` }, error: null }));
    (hoisted.dbAtual as Record<string, unknown>).storage = { from: (b: string) => (b === "midias" ? { createSignedUploadUrl: assinar } : null) };
    const res = await resultadoDe(await chamar("preparar_upload", { nome_arquivo: "áudio aquecimento.ogg" }));
    expect(res.isError).toBeUndefined();
    const dados = JSON.parse(res.content[0].text);
    const caminho = assinar.mock.calls[0][0];
    expect(caminho).toMatch(/^mcp\/\d+-_udio_aquecimento\.ogg$/);
    expect(dados).toMatchObject({ metodo: "PUT", upload_url: `https://s.test/upload/${caminho}?token=t`, midia_url: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/midias/${caminho}` });
    const leitura = await resultadoDe(await chamar("preparar_upload", { nome_arquivo: "a.ogg" }, CHAVE_LEITURA));
    expect(leitura.isError).toBe(true);
  });

  it("criar_campanha com copiar_de: copia a linha (sem id/slug/fixada), conexões, variáveis e regras; devolve links", async () => {
    let inseridas = 0;
    const chamadas = montar((c) => {
      if (c.tabela === "campanhas" && c.op === "select" && filtro(c, "eq", "id") === A)
        return { data: { id: A, nome: "Webinar", slug: "imersao", fixada: true, comunidade_id: "x", arquivada: true, folga: 2, created_at: "t", updated_at: "t" } };
      if (c.tabela === "campanhas" && c.op === "select") return { data: null };
      if (c.tabela === "campanha_conexoes" && c.op === "select") return { data: [{ conexao_id: "k1" }] };
      if (c.tabela === "campanha_variaveis" && c.op === "select") return { data: [{ chave: "link", valor: "https://x" }] };
      if (c.tabela === "regras_compra" && c.op === "select") return { data: [] };
      if (c.tabela === "campanhas" && c.op === "insert") return { data: { id: `c${++inseridas}` } };
      return {};
    });
    const res = await resultadoDe(await chamar("criar_campanha", { nome: "Webinar 26/10", copiar_de: A }));
    expect(res.isError).toBeUndefined();
    expect(JSON.parse(res.content[0].text)).toEqual({ id: "c1", nome: "Webinar 26/10", slug: "webinar-26-10", link: "https://gg.test/l/webinar-26-10", painel: "https://gg.test/campanhas/c1" });
    const ins = chamadas.find((c) => c.tabela === "campanhas" && c.op === "insert")!;
    expect(ins.dados).toEqual({ nome: "Webinar 26/10", slug: "webinar-26-10", arquivada: false, folga: 2 });
    expect(chamadas.find((c) => c.tabela === "campanha_conexoes" && c.op === "insert")!.dados).toEqual([{ campanha_id: "c1", conexao_id: "k1" }]);
    expect(chamadas.find((c) => c.tabela === "campanha_variaveis" && c.op === "insert")!.dados).toEqual([{ campanha_id: "c1", chave: "link", valor: "https://x" }]);
    expect(hoisted.historico).toHaveBeenCalledWith(null, expect.objectContaining({ resumo: 'Campanha "Webinar 26/10" criada como cópia de "Webinar" via API (chave Claude)' }));
  });

  it("criar_campanha: nome vazio, copiar_de inválido ou inexistente e tipo errado são isError sem gravar", async () => {
    const chamadas = montar((c) => (c.tabela === "campanhas" && c.op === "select" ? { data: null } : {}));
    for (const args of [{ nome: " " }, { nome: "X", copiar_de: "abc" }, { nome: "X", copiar_de: B }, { nome: "X", tipo: "outro" }]) {
      expect((await resultadoDe(await chamar("criar_campanha", args))).isError, JSON.stringify(args)).toBe(true);
    }
    expect(chamadas.some((c) => c.op === "insert")).toBe(false);
  });

  it("arquivar_campanha: arquiva (padrão) e desarquiva com arquivada false; histórico via API", async () => {
    const chamadas = montar((c) => (c.tabela === "campanhas" && c.op === "select" ? { data: filtro(c, "eq", "id") === A ? { id: A, nome: "TESTE" } : null } : {}));
    const res = await resultadoDe(await chamar("arquivar_campanha", { campanha: A }));
    expect(JSON.parse(res.content[0].text)).toEqual({ id: A, nome: "TESTE", arquivada: true });
    expect(chamadas.find((c) => c.tabela === "campanhas" && c.op === "update")!.dados).toEqual({ arquivada: true });
    expect(hoisted.historico).toHaveBeenCalledWith(null, expect.objectContaining({ resumo: 'Campanha "TESTE" arquivada via API (chave Claude)' }));
    await resultadoDe(await chamar("arquivar_campanha", { campanha: A, arquivada: false }));
    expect(chamadas.filter((c) => c.tabela === "campanhas" && c.op === "update")[1].dados).toEqual({ arquivada: false });
    for (const args of [{ campanha: "x" }, { campanha: B }]) expect((await resultadoDe(await chamar("arquivar_campanha", args))).isError).toBe(true);
    expect((await resultadoDe(await chamar("arquivar_campanha", { campanha: A }, CHAVE_LEITURA))).isError).toBe(true);
  });

  it("excluir_campanha: com o nome exato e sem envio em andamento, grava histórico e apaga", async () => {
    const chamadas = montar((c) => {
      if (c.tabela === "campanhas" && c.op === "select") return { data: { id: A, nome: "TESTE ANA" } };
      if (c.tabela === "execucoes") return { data: [] };
      return {};
    });
    const res = await resultadoDe(await chamar("excluir_campanha", { campanha: A, confirmar_nome: " TESTE ANA " }));
    expect(res.isError).toBeUndefined();
    expect(JSON.parse(res.content[0].text)).toEqual({ id: A, nome: "TESTE ANA", excluida: true });
    const del = chamadas.find((c) => c.tabela === "campanhas" && c.op === "delete")!;
    expect(filtro(del, "eq", "id")).toBe(A);
    expect(hoisted.historico).toHaveBeenCalledWith(null, expect.objectContaining({ acao: "remover", resumo: 'Campanha "TESTE ANA" excluída via API (chave Claude)' }));
  });

  it("excluir_campanha: nome diferente, envio em andamento, id inválido, inexistente ou chave de leitura não apagam", async () => {
    let enviando = false;
    const chamadas = montar((c) => {
      if (c.tabela === "campanhas" && c.op === "select") return { data: filtro(c, "eq", "id") === A ? { id: A, nome: "TESTE ANA" } : null };
      if (c.tabela === "execucoes") return { data: enviando ? [{ id: "e1" }] : [] };
      return {};
    });
    for (const args of [{ campanha: A, confirmar_nome: "teste ana" }, { campanha: A }, { campanha: "x", confirmar_nome: "TESTE ANA" }, { campanha: B, confirmar_nome: "TESTE ANA" }]) {
      expect((await resultadoDe(await chamar("excluir_campanha", args))).isError, JSON.stringify(args)).toBe(true);
    }
    expect((await resultadoDe(await chamar("excluir_campanha", { campanha: A, confirmar_nome: "TESTE ANA" }, CHAVE_LEITURA))).isError).toBe(true);
    enviando = true;
    const r = await resultadoDe(await chamar("excluir_campanha", { campanha: A, confirmar_nome: "TESTE ANA" }));
    expect(r.content[0].text).toContain("envio em andamento");
    expect(chamadas.some((c) => c.op === "delete")).toBe(false);
    expect(hoisted.historico).not.toHaveBeenCalled();
  });

  it("metricas_campanha: soma o período pedido e preenche os dias sem dado com zero", async () => {
    montar((c) => {
      if (c.tabela === "campanhas") return { data: { id: A, nome: "Webinar" } };
      if (c.tabela === "rpc:metricas_campanha") return { data: [{ dia: "2026-10-18", cliques: 10, entradas: 7, saidas: 1 }, { dia: "2026-10-19", cliques: "5", entradas: "4", saidas: "0" }, { dia: "2026-10-21", cliques: 99, entradas: 99, saidas: 99 }] };
      return {};
    });
    const res = await resultadoDe(await chamar("metricas_campanha", { campanha: A, de: "2026-10-17", ate: "2026-10-19" }));
    expect(JSON.parse(res.content[0].text)).toEqual({
      campanha: { id: A, nome: "Webinar" }, de: "2026-10-17", ate: "2026-10-19", cliques: 15, entraram: 11, sairam: 1,
      por_dia: [
        { data: "2026-10-17", cliques: 0, entraram: 0, sairam: 0 },
        { data: "2026-10-18", cliques: 10, entraram: 7, sairam: 1 },
        { data: "2026-10-19", cliques: 5, entraram: 4, sairam: 0 },
      ],
    });
    for (const args of [{ campanha: A, de: "17/10" }, { campanha: A, de: "2026-10-20", ate: "2026-10-19" }, { campanha: "x" }]) {
      expect((await resultadoDe(await chamar("metricas_campanha", args))).isError, JSON.stringify(args)).toBe(true);
    }
  });

  it("criar_modelo: mensagem com áudio na pasta; tipo nome; conteúdo inválido é isError; listar_modelos lê", async () => {
    let n = 0;
    const chamadas = montar((c) => {
      if (c.tabela === "modelos" && c.op === "insert") return { data: { id: `m${++n}` } };
      if (c.tabela === "modelos" && c.op === "select") return { data: [{ id: "m1", nome: "Aquecimento 1", tipo: "mensagem", pasta: "Webinar", conteudo: {} }] };
      return {};
    });
    const r1 = await resultadoDe(await chamar("criar_modelo", { nome: "Aquecimento 1", tipo: "mensagem", pasta: "Webinar", mensagens: [{ formato: "audio", midia_url: "https://x.test/a.ogg" }], mencionar_todos: true }));
    expect(JSON.parse(r1.content[0].text)).toEqual({ id: "m1" });
    const ins = chamadas.find((c) => c.tabela === "modelos" && c.op === "insert")!;
    expect(ins.dados).toMatchObject({ nome: "Aquecimento 1", tipo: "mensagem", pasta: "Webinar", conteudo: { versao: 2, mensagens: [{ formato: "audio", midia_url: "https://x.test/a.ogg" }], opcoes: { mencionar_todos: true } } });
    await resultadoDe(await chamar("criar_modelo", { nome: "Falta 1h", tipo: "nome", nome_grupo: "⏰ FALTA 1 HORA ⏰" }));
    expect(chamadas.filter((c) => c.tabela === "modelos" && c.op === "insert").at(-1)!.dados).toMatchObject({ tipo: "nome", conteudo: { padrao: "⏰ FALTA 1 HORA ⏰" }, pasta: null });
    expect((await resultadoDe(await chamar("criar_modelo", { nome: "X", tipo: "mensagem", texto: "  " }))).isError).toBe(true);
    expect((await resultadoDe(await chamar("criar_modelo", { nome: "X", tipo: "nome", nome_grupo: "a" }, CHAVE_LEITURA))).isError).toBe(true);
    const lista = await resultadoDe(await chamar("listar_modelos", { pasta: "Webinar" }, CHAVE_LEITURA));
    expect(JSON.parse(lista.content[0].text).modelos).toHaveLength(1);
  });

  it("lote com 2 chamadas de envio: só a 1ª executa, a 2ª vira isError 'Só um envio por chamada.' sem gravar de novo", async () => {
    const chamadas = bancoAcao();
    const r = await post([
      rpc("tools/call", { name: "enviar_mensagem", arguments: { campanhas: [A], texto: "1ª" } }, 1),
      rpc("tools/call", { name: "criar_acao", arguments: { campanhas: [A], tipo: "abrir" } }, 2),
      rpc("tools/call", { name: "listar_contas", arguments: {} }, 3),
    ]);
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as { id: number; result: { isError?: boolean; content: { text: string }[] } }[];
    expect(corpo[0].result.isError).toBeUndefined();
    expect(corpo[1].result).toEqual({ content: [{ type: "text", text: "Só um envio por chamada." }], isError: true });
    expect(corpo[2].result.isError).toBeUndefined();
    expect(chamadas.filter((c) => c.tabela === "execucoes" && c.op === "insert")).toHaveLength(1);
  });

  it("chave de leitura: as de envio voltam isError (HTTP 200) e não gravam nada", async () => {
    const chamadas = bancoAcao();
    for (const [nome, args] of [
      ["enviar_mensagem", { campanhas: [A], texto: "oi" }],
      ["criar_acao", { campanhas: [A], tipo: "abrir" }],
    ] as const) {
      const r = await chamar(nome, args, CHAVE_LEITURA);
      expect(r.status).toBe(200);
      expect((await r.json()).result).toEqual({ content: [{ type: "text", text: "Esta chave só tem permissão de leitura." }], isError: true });
    }
    expect(chamadas.some((c) => c.tabela === "execucoes" || c.tabela === "campanhas")).toBe(false);
  });
});
