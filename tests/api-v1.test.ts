import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, filtro, type Chamada, type Resposta } from "./apoio/db-falso";

const hoisted = vi.hoisted(() => ({ dbAtual: undefined as unknown, historico: vi.fn() }));
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => hoisted.dbAtual }));
vi.mock("@/src/lib/historico", () => ({ registrarHistorico: hoisted.historico }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { GET as getAcoes, POST as postAcoes } from "@/app/api/v1/acoes/route";
import { GET as getCampanha } from "@/app/api/v1/campanhas/[id]/route";
import { GET as getGrupos } from "@/app/api/v1/campanhas/[id]/grupos/route";
import { GET as getCampanhas } from "@/app/api/v1/campanhas/route";
import { GET as getContas } from "@/app/api/v1/contas/route";
import { hashDaChave } from "@/src/lib/api/chaves";

const CHAVE_ENVIO = "vg_" + "E".repeat(8) + "a".repeat(32);
const CHAVE_LEITURA = "vg_" + "L".repeat(8) + "b".repeat(32);
const CHAVE_REVOGADA = "vg_" + "R".repeat(8) + "c".repeat(32);
const CHAVE_DESCONHECIDA = "vg_" + "D".repeat(8) + "d".repeat(32);

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const G1 = "55555555-5555-5555-5555-555555555551";
const MAXIMO_CORPO = 256 * 1024;

const CHAVES: Record<string, { id: string; nome: string; escopo: string; tipo: string; revogada_em: string | null }> = {
  [hashDaChave(CHAVE_ENVIO)]: { id: "k-envio", nome: "Zapier", escopo: "envio", tipo: "api", revogada_em: null },
  [hashDaChave(CHAVE_LEITURA)]: { id: "k-leitura", nome: "Painel BI", escopo: "leitura", tipo: "mcp", revogada_em: null },
  [hashDaChave(CHAVE_REVOGADA)]: { id: "k-rev", nome: "Velha", escopo: "envio", tipo: "api", revogada_em: "2026-10-01T00:00:00Z" },
};

/** Banco falso: responde a chave pelo hash e o contador de uso; o resto vai pro `resto`. */
function montar(resto: (c: Chamada) => Resposta = () => ({}), uso = 1) {
  const r = dbFalso((c) => {
    if (c.tabela === "api_chaves") return { data: CHAVES[filtro(c, "eq", "hash") as string] ?? null };
    if (c.tabela === "rpc:api_registrar_uso") return { data: uso };
    return resto(c);
  });
  hoisted.dbAtual = r.db;
  return r.chamadas;
}

const req = (caminho: string, chave?: string | null, init: RequestInit = {}) =>
  new Request(`https://gg.test${caminho}`, { ...init, headers: { ...(chave ? { authorization: `Bearer ${chave}` } : {}), ...(init.headers ?? {}) } });

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

let espioes: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SITE_URL = "https://gg.test";
  espioes = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
});
afterEach(() => {
  // Nada loga a chave nem o header Authorization.
  const tudo = JSON.stringify(espioes.flatMap((e) => e.mock.calls));
  for (const k of [CHAVE_ENVIO, CHAVE_LEITURA, CHAVE_REVOGADA, CHAVE_DESCONHECIDA]) expect(tudo).not.toContain(k);
  expect(tudo.toLowerCase()).not.toContain("bearer");
  espioes.forEach((e) => e.mockRestore());
});

describe("autenticarApi (pelas rotas)", () => {
  it("sem header, header sem Bearer, formato errado: 401 { erro } sem tocar no banco", async () => {
    const chamadas = montar();
    for (const r of [
      await getContas(req("/api/v1/contas")),
      await getContas(req("/api/v1/contas", null, { headers: { authorization: CHAVE_ENVIO } })),
      await getContas(req("/api/v1/contas", "vg_curta")),
    ]) {
      expect(r.status).toBe(401);
      expect(await r.json()).toEqual({ erro: "Chave de API ausente ou inválida." });
    }
    expect(chamadas).toHaveLength(0);
  });

  it("chave errada ou revogada: 401 igual (sem detalhe) e não conexão uso", async () => {
    const chamadas = montar();
    for (const k of [CHAVE_DESCONHECIDA, CHAVE_REVOGADA]) {
      const r = await getContas(req("/api/v1/contas", k));
      expect(r.status).toBe(401);
      expect(await r.json()).toEqual({ erro: "Chave de API ausente ou inválida." });
    }
    expect(chamadas.some((c) => c.tabela === "rpc:api_registrar_uso")).toBe(false);
    // Procura pelo hash, nunca pela chave em texto.
    const busca = chamadas.find((c) => c.tabela === "api_chaves")!;
    expect(filtro(busca, "eq", "hash")).toBe(hashDaChave(CHAVE_DESCONHECIDA));
    expect(JSON.stringify(chamadas)).not.toContain(CHAVE_DESCONHECIDA);
  });

  it("escopo leitura não cria ação: 403", async () => {
    const chamadas = montar();
    const r = await postAcoes(req("/api/v1/acoes", CHAVE_LEITURA, { method: "POST", body: JSON.stringify({ campanhas: [A], tipo: "abrir", conteudo: {} }) }));
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ erro: "Esta chave não tem permissão de envio." });
    expect(chamadas.some((c) => c.tabela === "execucoes")).toBe(false);
  });

  it("chave de leitura (inclusive a do MCP) lê", async () => {
    montar(() => ({ data: [] }));
    const r = await getContas(req("/api/v1/contas", CHAVE_LEITURA));
    expect(r.status).toBe(200);
  });

  it("acima de 60 chamadas no minuto: 429 com Retry-After; a 60ª ainda passa", async () => {
    const chamadas = montar(() => ({ data: [] }), 61);
    const r = await getContas(req("/api/v1/contas", CHAVE_ENVIO));
    expect(r.status).toBe(429);
    expect(await r.json()).toEqual({ erro: "Limite de 60 chamadas por minuto atingido. Tente de novo em instantes." });
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(chamadas.find((c) => c.tabela === "rpc:api_registrar_uso")!.dados).toEqual({ p_chave: "k-envio" });
    expect(chamadas.some((c) => c.tabela === "conexoes")).toBe(false);
    montar(() => ({ data: [] }), 60);
    expect((await getContas(req("/api/v1/contas", CHAVE_ENVIO))).status).toBe(200);
  });

  it("erro do banco ao conferir a chave ou o contador: 503 (fecha)", async () => {
    hoisted.dbAtual = dbFalso(() => ({ error: { message: "fora" } })).db;
    expect((await getContas(req("/api/v1/contas", CHAVE_ENVIO))).status).toBe(503);
    hoisted.dbAtual = dbFalso((c) => (c.tabela === "api_chaves" ? { data: CHAVES[hashDaChave(CHAVE_ENVIO)] } : { error: { message: "fora" } })).db;
    expect((await getContas(req("/api/v1/contas", CHAVE_ENVIO))).status).toBe(503);
  });
});

describe("GET /api/v1/campanhas", () => {
  it("só as ativas, com slug, link, tipo, grupos e participantes", async () => {
    montar((c) => {
      if (c.tabela === "campanhas")
        return {
          data: [
            { id: A, nome: "Aulão", slug: "aulao", tipo: "lista", arquivada: false },
            { id: B, nome: "Velha", slug: "velha", tipo: "campanha", arquivada: true },
          ],
        };
      if (c.tabela === "rpc:resumo_campanhas") return { data: [{ campanha_id: A, grupos: 3, participantes: 420, cliques: 9 }] };
      return {};
    });
    const r = await getCampanhas(req("/api/v1/campanhas", CHAVE_LEITURA));
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toEqual({ campanhas: [{ id: A, nome: "Aulão", slug: "aulao", link: "https://gg.test/l/aulao", tipo: "lista", grupos: 3, participantes: 420 }] });
  });

  it("erro do banco: 500 { erro }", async () => {
    montar(() => ({ error: { message: "x" } }));
    const r = await getCampanhas(req("/api/v1/campanhas", CHAVE_LEITURA));
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ erro: "Não foi possível carregar as campanhas." });
  });
});

describe("GET /api/v1/campanhas/{id}", () => {
  it("campanha + métricas dos últimos 7 dias", async () => {
    const chamadas = montar((c) => {
      if (c.tabela === "campanhas") return { data: { id: A, nome: "Aulão", slug: "aulao", tipo: "campanha", descricao: null, arquivada: false } };
      if (c.tabela === "rpc:resumo_campanhas") return { data: [{ campanha_id: A, cliques: 30, entradas: 12, saidas: 2, grupos: 2, participantes: 100 }] };
      if (c.tabela === "rpc:metricas_campanha") return { data: [] };
      return {};
    });
    const r = await getCampanha(req(`/api/v1/campanhas/${A}`, CHAVE_LEITURA), params({ id: A }));
    expect(r.status).toBe(200);
    const { campanha } = await r.json();
    expect(campanha).toMatchObject({ id: A, link: "https://gg.test/l/aulao", grupos: 2, participantes: 100, metricas_7_dias: { cliques: 30, entraram: 12, sairam: 2 } });
    expect(campanha.metricas_7_dias.por_dia).toHaveLength(7);
    expect(chamadas.find((c) => c.tabela === "rpc:resumo_campanhas")!.dados).toMatchObject({ p_campanha: A });
  });

  it("id inválido 400; inexistente 404", async () => {
    montar(() => ({ data: null }));
    const r1 = await getCampanha(req("/api/v1/campanhas/x", CHAVE_LEITURA), params({ id: "x" }));
    expect(r1.status).toBe(400);
    expect(await r1.json()).toEqual({ erro: "Campanha inválida." });
    const r2 = await getCampanha(req(`/api/v1/campanhas/${A}`, CHAVE_LEITURA), params({ id: A }));
    expect(r2.status).toBe(404);
    expect(await r2.json()).toEqual({ erro: "Campanha não encontrada." });
  });
});

describe("GET /api/v1/campanhas/{id}/grupos", () => {
  it("paginado de 50, ativos, com cliques e admins de resumo_grupos", async () => {
    const chamadas = montar((c) => {
      if (c.tabela === "campanhas") return { data: { id: A } };
      if (c.tabela === "grupos") return { data: [{ id: G1, nome: "Aulão #1", numero: 1, link_convite: "https://chat.whatsapp.com/x", participantes: 200, cheio: false }], count: 51 };
      if (c.tabela === "rpc:resumo_grupos") return { data: [{ grupo_id: G1, cliques: "7", admins: "2", leads: "198" }] };
      return {};
    });
    const r = await getGrupos(req(`/api/v1/campanhas/${A}/grupos?pagina=2`, CHAVE_LEITURA), params({ id: A }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      grupos: [{ id: G1, nome: "Aulão #1", numero: 1, link_convite: "https://chat.whatsapp.com/x", participantes: 200, admins: 2, cliques: 7, cheio: false }],
      pagina: 2,
      por_pagina: 50,
      total: 51,
    });
    const g = chamadas.find((c) => c.tabela === "grupos")!;
    expect(filtro(g, "eq", "ativo")).toBe(true);
    expect(g.filtros.find((f) => f[0] === "range")).toEqual(["range", 50, 99]);
  });

  it("campanha inexistente 404", async () => {
    montar(() => ({ data: null }));
    const r = await getGrupos(req(`/api/v1/campanhas/${A}/grupos`, CHAVE_LEITURA), params({ id: A }));
    expect(r.status).toBe(404);
  });
});

describe("GET /api/v1/acoes", () => {
  it("usa listar_acoes com campanha, aba e página", async () => {
    const chamadas = montar((c) => {
      if (c.tabela === "rpc:listar_acoes") return { data: [{ id: "e1", total: 1 }] };
      if (c.tabela === "execucoes")
        return {
          data: [
            { id: "e1", campanha_id: A, tipo: "abrir", origem: "avulsa", status: "agendada", motivo: null, agendada_para: "2099-01-01T13:00:00.000Z", iniciada_em: null, created_at: "2026-10-17T10:00:00Z", conteudo: {}, conteudo_final: null, importante: false },
          ],
        };
      if (c.tabela === "campanhas") return { data: [{ id: A, nome: "Aulão" }] };
      return { data: [] };
    });
    const r = await getAcoes(req(`/api/v1/acoes?campanha=${A}&aba=agendado&pagina=3`, CHAVE_LEITURA));
    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(corpo).toMatchObject({ pagina: 3, por_pagina: 50, total: 1 });
    expect(corpo.acoes[0]).toMatchObject({ id: "e1", tipo: "abrir", situacao: "Agendado", campanha: { id: A, nome: "Aulão" }, agendada_para: "2099-01-01T13:00:00.000Z" });
    expect(chamadas.find((c) => c.tabela === "rpc:listar_acoes")!.dados).toMatchObject({ p_campanha: A, p_aba: "agendado", p_limite: 50, p_deslocamento: 100 });
  });

  it("aba ou campanha inválida: 400", async () => {
    montar();
    const r1 = await getAcoes(req("/api/v1/acoes?aba=lixo", CHAVE_LEITURA));
    expect(r1.status).toBe(400);
    expect((await r1.json()).erro).toMatch(/^Aba inválida/);
    expect((await getAcoes(req("/api/v1/acoes?campanha=x", CHAVE_LEITURA))).status).toBe(400);
  });
});

describe("POST /api/v1/acoes", () => {
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
  const post = (corpo: unknown, chave = CHAVE_ENVIO) =>
    postAcoes(req("/api/v1/acoes", chave, { method: "POST", body: typeof corpo === "string" ? corpo : JSON.stringify(corpo) }));

  it("cria pela mesma regra do assistente; histórico sem usuário e 'via API (chave NOME)'", async () => {
    const chamadas = bancoAcao();
    const r = await post({ campanhas: [A], tipo: "nome", conteudo: { padrao: "Aula {n}" }, agendar_para: "2099-01-01T13:00:00Z" });
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ ids: ["e1"] });
    const ins = chamadas.find((c) => c.tabela === "execucoes" && c.op === "insert")!;
    expect(ins.dados).toEqual([expect.objectContaining({ campanha_id: A, origem: "avulsa", tipo: "nome", criada_por: null, agendada_para: "2099-01-01T13:00:00.000Z", alvo_contas: null, alvo_grupos: null })]);
    expect(hoisted.historico).toHaveBeenCalledWith(null, expect.objectContaining({ acao: "adicionar", area: "Ações", resumo: "Trocar nome em 1 campanha, agendada via API (chave Zapier)", refId: A }));
  });

  it("erros de validação do assistente voltam como 400 { erro }, sem gravar", async () => {
    const chamadas = bancoAcao();
    const casos: [unknown, string][] = [
      [{ campanhas: [B], tipo: "abrir", conteudo: {} }, "Campanha não encontrada."],
      [{ campanhas: [A], tipo: "explodir", conteudo: {} }, "Escolha a ação."],
      [{ campanhas: [A], tipo: "abrir", conteudo: {}, agendar_para: "2000-01-01T10:00:00Z" }, "Esse horário já passou."],
      [{ campanhas: [A], tipo: "abrir", conteudo: {}, agendar_para: "amanhã" }, "agendar_para inválido: use ISO 8601 (ex.: 2026-10-20T21:00:00-03:00)."],
      [{ campanhas: ["x"], tipo: "abrir", conteudo: {} }, "Lista de campanhas inválida."],
      [{ tipo: "abrir" }, "Informe campanhas (lista de ids)."],
    ];
    for (const [corpo, erro] of casos) {
      const r = await post(corpo);
      expect(r.status, erro).toBe(400);
      expect(await r.json()).toEqual({ erro });
    }
    expect(chamadas.some((c) => c.tabela === "execucoes")).toBe(false);
    expect(hoisted.historico).not.toHaveBeenCalled();
  });

  it("JSON inválido 400; corpo grande demais 413 (pelo content-length e, de novo, pelo tamanho em bytes)", async () => {
    bancoAcao();
    const r = await post("{nao é json");
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ erro: "JSON inválido." });
    expect((await post(JSON.stringify({ x: "a".repeat(300 * 1024) }))).status).toBe(413);

    // Rejeitado só pelo content-length, sem precisar ler o corpo (corpo pequeno, header mentindo que é grande).
    const chamadas = bancoAcao();
    const rCabecalho = await postAcoes(
      req("/api/v1/acoes", CHAVE_ENVIO, { method: "POST", headers: { "content-length": String(300 * 1024) }, body: "{}" }),
    );
    expect(rCabecalho.status).toBe(413);
    expect(await rCabecalho.json()).toEqual({ erro: "Corpo grande demais." });
    expect(chamadas.some((c) => c.tabela === "execucoes")).toBe(false);

    // Caracteres multibyte: 300 KB de "á" tem o dobro de bytes em UTF-8 — `.length` (UTF-16) não pegaria isso.
    const corpoMultibyte = JSON.stringify({ x: "á".repeat(240 * 1024) });
    expect(corpoMultibyte.length).toBeLessThanOrEqual(MAXIMO_CORPO);
    expect(new TextEncoder().encode(corpoMultibyte).length).toBeGreaterThan(MAXIMO_CORPO);
    expect((await post(corpoMultibyte)).status).toBe(413);
  });

  it("sem chave: 401", async () => {
    bancoAcao();
    expect((await postAcoes(req("/api/v1/acoes", null, { method: "POST", body: "{}" }))).status).toBe(401);
  });
});

describe("GET /api/v1/contas", () => {
  it("nome, telefone mascarado e conectado", async () => {
    montar((c) =>
      c.tabela === "conexoes"
        ? { data: [{ id: "c1", nome: "Suporte", telefone: "5511" + "987651234", status: "conectado" }, { id: "c2", nome: "Vendas", telefone: null, status: "desconectado" }] }
        : {},
    );
    const r = await getContas(req("/api/v1/contas", CHAVE_LEITURA));
    const corpo = await r.json();
    expect(corpo).toEqual({
      contas: [
        { id: "c1", nome: "Suporte", telefone: "+55 •• •••• 1234", conectado: true },
        { id: "c2", nome: "Vendas", telefone: null, conectado: false },
      ],
    });
    expect(JSON.stringify(corpo)).not.toContain("987651234");
  });
});
