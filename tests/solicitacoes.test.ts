import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, filtro, type Chamada, type Resposta } from "./apoio/db-falso";
import { liberarTudo, usarMembro } from "./apoio/permissoes";

/** Etapa 3M, Tarefa 4: job das solicitações de entrada, ações da aba, Configurações e o CSV das Processadas. */

const hoisted = vi.hoisted(() => ({
  adminAtual: undefined as unknown,
  usuarioDb: undefined as unknown,
  registrarHistoricoMock: vi.fn(async (..._a: unknown[]) => undefined),
  exigirUsuarioMock: vi.fn(async () => ({ id: "u1", email: "u1@x.com" })),
  pedidosPendentes: vi.fn(async (..._a: unknown[]) => [] as unknown),
  revisarPedidos: vi.fn(async (..._a: unknown[]) => null as unknown),
  listarGrupos: vi.fn(async (..._a: unknown[]) => [] as unknown),
}));

vi.mock("@/src/lib/permissoes", async () => (await import("./apoio/permissoes")).permissoesFalsas());
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => hoisted.adminAtual }));
vi.mock("@/src/lib/supabase/usuario", () => ({ exigirUsuario: hoisted.exigirUsuarioMock, dbUsuario: async () => hoisted.usuarioDb }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/src/lib/historico", () => ({ registrarHistorico: hoisted.registrarHistoricoMock }));
vi.mock("@/src/lib/conexoes", () => ({ paraZapbot: (c: { id: string }) => ({ id: c.id, token: "t", clientToken: "c" }) }));
vi.mock("@/src/lib/zapbot/client", () => ({
  PRAZO_TELA_MS: 20_000,
  zapbot: () => ({ pedidosPendentes: hoisted.pedidosPendentes, revisarPedidos: hoisted.revisarPedidos, listarGrupos: hoisted.listarGrupos }),
}));

import { classificarPedidos, decidirPedidos, enfileirarSolicitacoes, expirarVistos, lerPendentes, MARGEM_PRAZO_REGRA_MS, MAX_EXPIRAR_POR_TICK, MAX_VISTOS_POR_GRUPO, lerEResponderPedidos, pedidoNaoExiste, registrarLeitura, type GrupoParaLeitura } from "@/src/lib/jobs/solicitacoes";
import type { EventoHook } from "@/src/lib/regras/webhooks";
import { ERRO_BLOQUEADO, ERRO_CHEIO, ERRO_LID } from "@/src/lib/regras/solicitacoes";
import { aplicarAprovacaoEmTodos, aprovarSelecionadas, listarPendentes, recusarSelecionadas, salvarConfiguracoesSolicitacoes } from "@/app/(painel)/campanhas/[id]/solicitacoes/actions";
import { GET } from "@/app/api/exportar/solicitacoes/route";

const CAMP = "999" + "99999-2222-3333-4444-555555555555";
const G1 = "44444444-4444-4444-4444-444444444444";
const G2 = "55555555-5555-5555-5555-555555555555";
const LIVRE = "5511" + "900000001";
const BLOQ = "5511" + "900000066";
const BLOQ_SEM_9 = "551100000066";
const LID = "123456789012345@lid";
const C = { id: "inst", token: "t", clientToken: "c" };
const z = () => ({ pedidosPendentes: hoisted.pedidosPendentes, revisarPedidos: hoisted.revisarPedidos, listarGrupos: hoisted.listarGrupos }) as never;
const grupo = { id: G1, groupId: "g1@g.us", nome: "Turma 01" };

function usar(responder?: (c: Chamada) => Resposta) {
  const f = dbFalso(responder);
  hoisted.adminAtual = f.db;
  return f.chamadas;
}

/** Banco com `bloqueados_efetivos` = `bloq` e `bloqueados.lid` = `lids`; o resto responde `extra` ou vazio. */
function bancoBloqueados(bloq: string[], lids: string[] = [], extra?: (c: Chamada) => Resposta | undefined) {
  return usar((c) => {
    const e = extra?.(c);
    if (e) return e;
    if (c.tabela === "bloqueados_efetivos") {
      const pedidas = (filtro(c, "in", "telefone") as string[]) ?? [];
      return { data: bloq.filter((b) => pedidas.includes(b)).map((telefone) => ({ telefone })) };
    }
    if (c.tabela === "bloqueados") {
      const pedidas = (filtro(c, "in", "lid") as string[]) ?? [];
      return { data: lids.filter((l) => pedidas.includes(l)).map((lid) => ({ lid })) };
    }
    return {};
  });
}

const linhasGravadas = (cs: Chamada[]) =>
  cs.filter((c) => c.tabela === "solicitacoes_entrada" && c.op === "insert").flatMap((c) => c.dados as { telefone: string; resultado: string; erro: string | null; decisao: string; origem: string }[]);

beforeEach(() => {
  vi.clearAllMocks();
  liberarTudo();
  hoisted.revisarPedidos.mockImplementation(async () => null);
  hoisted.pedidosPendentes.mockImplementation(async () => []);
  hoisted.listarGrupos.mockImplementation(async () => []);
});

describe("classificarPedidos", () => {
  it("lê bloqueados_efetivos nas duas formas do nono dígito e a forma LID", async () => {
    const chamadas = bancoBloqueados([BLOQ_SEM_9], ["123456789012345"]);
    const r = await classificarPedidos(hoisted.adminAtual as never, [LIVRE, BLOQ, LID]);
    const pedidas = filtro(chamadas.find((c) => c.tabela === "bloqueados_efetivos")!, "in", "telefone") as string[];
    expect(pedidas).toEqual(expect.arrayContaining([BLOQ, BLOQ_SEM_9, LIVRE]));
    expect(r.bloqueados).toEqual([BLOQ_SEM_9]);
    expect(r.lidsBloqueados).toEqual([LID]);
  });

  it("erro na leitura lança (na dúvida ninguém é aprovado)", async () => {
    usar((c) => (c.tabela === "bloqueados_efetivos" ? { error: { message: "caiu" } } : {}));
    await expect(classificarPedidos(hoisted.adminAtual as never, [LIVRE])).rejects.toThrow(/bloqueados/);
  });
});

describe("decidirPedidos", () => {
  const db = () => hoisted.adminAtual as never;

  it("aprovar: tira bloqueado (mesmo sem o nono dígito) e LID NA HORA, mesmo que a tela tenha mandado; nunca chegam ao Zapbot", async () => {
    const chamadas = bancoBloqueados([BLOQ_SEM_9]);
    const r = await decidirPedidos(db(), z(), C, { campanhaId: CAMP, grupo, telefones: [LIVRE, BLOQ, LID], decisao: "aprovada", origem: "manual", usuario: "u1" });
    expect(hoisted.revisarPedidos).toHaveBeenCalledTimes(1);
    expect(hoisted.revisarPedidos.mock.calls[0].slice(1, 4)).toEqual(["g1@g.us", [LIVRE], "approve"]);
    expect(r).toMatchObject({ ok: 1, bloqueados: 1, falhas: 1 });
    const linhas = linhasGravadas(chamadas);
    expect(linhas.find((l) => l.telefone === BLOQ)).toMatchObject({ resultado: "erro", erro: ERRO_BLOQUEADO, decisao: "aprovada", origem: "manual" });
    expect(linhas.find((l) => l.telefone === LID)).toMatchObject({ resultado: "erro", erro: ERRO_LID });
    expect(linhas.find((l) => l.telefone === LIVRE)).toMatchObject({ resultado: "ok", erro: null });
  });

  it("aprovar só bloqueados: o Zapbot não é chamado", async () => {
    bancoBloqueados([BLOQ]);
    const r = await decidirPedidos(db(), z(), C, { campanhaId: CAMP, grupo, telefones: [BLOQ], decisao: "aprovada", origem: "automatica", usuario: null });
    expect(hoisted.revisarPedidos).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: 0, bloqueados: 1, falhas: 0 });
  });

  it("aprovar: erro ao ler bloqueados lança antes de chamar o Zapbot", async () => {
    usar((c) => (c.tabela === "bloqueados_efetivos" ? { error: { message: "caiu" } } : {}));
    await expect(decidirPedidos(db(), z(), C, { campanhaId: CAMP, grupo, telefones: [LIVRE], decisao: "aprovada", origem: "manual", usuario: "u1" })).rejects.toThrow();
    expect(hoisted.revisarPedidos).not.toHaveBeenCalled();
  });

  it("aprovar: o que passar das vagas não é aprovado (grupo cheio)", async () => {
    const chamadas = bancoBloqueados([]);
    const r = await decidirPedidos(db(), z(), C, { campanhaId: CAMP, grupo, telefones: [LIVRE, "5511" + "900000002"], decisao: "aprovada", origem: "manual", usuario: "u1", vagas: 1 });
    expect(hoisted.revisarPedidos.mock.calls[0][2]).toEqual([LIVRE]);
    expect(linhasGravadas(chamadas).find((l) => l.telefone === "5511" + "900000002")).toMatchObject({ resultado: "erro", erro: ERRO_CHEIO });
    expect(r).toMatchObject({ ok: 1, bloqueados: 0, falhas: 1 });
  });

  it("fatia em 50; resposta com lista marca quem não deu certo; falha numa fatia não derruba a outra", async () => {
    const telefones = Array.from({ length: 60 }, (_, i) => `55119${String(i).padStart(8, "0")}`);
    const chamadas = bancoBloqueados([]);
    hoisted.revisarPedidos.mockImplementationOnce(async (..._a: unknown[]) => telefones.slice(0, 49)).mockImplementationOnce(async () => {
      throw new Error("HTTP 500");
    });
    const r = await decidirPedidos(db(), z(), C, { campanhaId: CAMP, grupo, telefones, decisao: "recusada", origem: "manual", usuario: "u1" });
    expect(hoisted.revisarPedidos.mock.calls.map((c) => (c[2] as string[]).length)).toEqual([50, 10]);
    expect(hoisted.revisarPedidos.mock.calls[0][3]).toBe("reject");
    expect(r).toMatchObject({ ok: 49, bloqueados: 0, falhas: 11 });
    expect(linhasGravadas(chamadas)).toHaveLength(60);
    // Recusar não lê bloqueados.
    expect(chamadas.some((c) => c.tabela === "bloqueados_efetivos")).toBe(false);
  });
});

describe("lerEResponderPedidos", () => {
  const db = () => hoisted.adminAtual as never;
  const base = { campanhaId: CAMP, grupo, recusarBloqueados: true, aprovarAutomaticamente: true, vagas: 100, suspeita: false, membros: 50 };

  it("com prazo: `pending` e cada `group-review` levam restante(prazo) − margem", async () => {
    bancoBloqueados([BLOQ]);
    hoisted.pedidosPendentes.mockImplementation(async () => [{ telefone: BLOQ, pedidoEm: null }, { telefone: LIVRE, pedidoEm: null }]);
    const prazo = { ate: Date.now() + 30_000 };
    const r = await lerEResponderPedidos(db(), z(), C, { ...base, prazo });
    expect(r).toMatchObject({ aprovadas: 1, recusadas: 1 });
    const leitura = hoisted.pedidosPendentes.mock.calls[0][2] as { prazoTotalMs: number; timeoutMs: number };
    expect(leitura.prazoTotalMs).toBeLessThanOrEqual(30_000 - MARGEM_PRAZO_REGRA_MS);
    expect(leitura.prazoTotalMs).toBeGreaterThan(20_000);
    expect(leitura.timeoutMs).toBeLessThanOrEqual(15_000);
    expect(hoisted.revisarPedidos.mock.calls.map((c) => c[3])).toEqual(["reject", "approve"]);
    for (const c of hoisted.revisarPedidos.mock.calls) expect((c[4] as { prazoTotalMs: number }).prazoTotalMs).toBeLessThanOrEqual(30_000 - MARGEM_PRAZO_REGRA_MS);
  });

  it("sem tempo útil no prazo: não chama o Zapbot", async () => {
    bancoBloqueados([]);
    const r = await lerEResponderPedidos(db(), z(), C, { ...base, prazo: { ate: Date.now() + MARGEM_PRAZO_REGRA_MS + 500 } });
    expect(r).toMatchObject({ aprovadas: 0, recusadas: 0 });
    expect(hoisted.pedidosPendentes).not.toHaveBeenCalled();
    expect(hoisted.revisarPedidos).not.toHaveBeenCalled();
  });

  it("o prazo acaba depois da leitura: não aprova (nada chega ao group-review)", async () => {
    bancoBloqueados([]);
    const prazo = { ate: Date.now() + 30_000 };
    hoisted.pedidosPendentes.mockImplementation(async () => {
      prazo.ate = Date.now() + 1_000;
      return [{ telefone: LIVRE, pedidoEm: null }];
    });
    const r = await lerEResponderPedidos(db(), z(), C, { ...base, prazo });
    expect(r).toMatchObject({ aprovadas: 0, recusadas: 0 });
    expect(hoisted.revisarPedidos).not.toHaveBeenCalled();
  });

  it("erro ao ler quem já está na campanha lança antes de aprovar (na dúvida ninguém é aprovado)", async () => {
    bancoBloqueados([], [], (c) => (c.tabela === "participantes" ? { error: { message: "caiu" } } : undefined));
    hoisted.pedidosPendentes.mockImplementation(async () => [{ telefone: LIVRE, pedidoEm: null }]);
    await expect(lerEResponderPedidos(db(), z(), C, base)).rejects.toThrow(/participações/);
    expect(hoisted.revisarPedidos).not.toHaveBeenCalled();
  });

  it("estrangeiro e LID sem @lid nunca são aprovados sozinhos (nem consultados como participação)", async () => {
    const chamadas = bancoBloqueados([]);
    hoisted.pedidosPendentes.mockImplementation(async () => [
      { telefone: "351" + "912345678", pedidoEm: null },
      { telefone: "120363012345678", pedidoEm: null },
    ]);
    const r = await lerEResponderPedidos(db(), z(), C, base);
    expect(r).toMatchObject({ aprovadas: 0, recusadas: 0 });
    expect(hoisted.revisarPedidos).not.toHaveBeenCalled();
    expect(chamadas.some((c) => c.tabela === "participantes")).toBe(false);
  });
});

describe("lerPendentes", () => {
  const g = (n: number, conexaoId = "con1"): GrupoParaLeitura => ({ id: `id-${n}`, groupId: `${n}@g.us`, nome: `G${n}`, conexaoId, conexao: { id: conexaoId, token: "t", clientToken: "c" } });

  it("no máximo 40 grupos", async () => {
    const grupos = Array.from({ length: 45 }, (_, i) => g(i));
    await lerPendentes(z(), grupos);
    expect(hoisted.pedidosPendentes).toHaveBeenCalledTimes(40);
    expect(hoisted.pedidosPendentes.mock.calls.map((c) => c[1])).not.toContain("44@g.us");
  });

  it("parcial quando um grupo estoura o tempo; erro e 404 também contam como 'não respondeu'", async () => {
    hoisted.pedidosPendentes.mockImplementation(async (...a: unknown[]) => {
      const id = a[1] as string;
      if (id === "1@g.us") return new Promise(() => undefined); // nunca responde
      if (id === "2@g.us") throw new Error("HTTP 500");
      if (id === "3@g.us") return null;
      return [{ telefone: LIVRE, pedidoEm: null }];
    });
    const inicio = Date.now();
    const r = await lerPendentes(z(), [g(0), g(1), g(2), g(3)], { porChamadaMs: 50, prazoMs: 2_000 });
    expect(Date.now() - inicio).toBeLessThan(1_500);
    expect(r.pedidos).toEqual([{ grupoId: "id-0", telefone: LIVRE, pedidoEm: null }]);
    expect(r.semResposta.sort()).toEqual(["id-1", "id-2", "id-3"]);
    // Cada chamada leva o teto de tempo.
    expect(hoisted.pedidosPendentes.mock.calls[0][2]).toEqual({ timeoutMs: 50, prazoTotalMs: 50 });
  });

  it("pula grupo de aviso de comunidade (uma leitura GET groups por conexão); se essa leitura falha, não pula nada", async () => {
    hoisted.listarGrupos.mockImplementation(async (...a: unknown[]) => {
      if ((a[0] as { id: string }).id === "con2") throw new Error("caiu");
      return [{ groupId: "1@g.us", isAnnouncementGroup: true }];
    });
    await lerPendentes(z(), [g(0), g(1), g(2, "con2")]);
    expect(hoisted.listarGrupos).toHaveBeenCalledTimes(2);
    expect(hoisted.pedidosPendentes.mock.calls.map((c) => c[1]).sort()).toEqual(["0@g.us", "2@g.us"]);
  });
});

describe("listarPendentes (action)", () => {
  const grupoLinha = (id: string, n: number) => ({ id, group_id: `${n}@g.us`, nome: `Turma ${n}`, numero: n, conexao_id: "con1", conexoes: { id: "con1", status: "conectado" } });

  it("sem 'ver' em Campanhas: recusa sem ler nada", async () => {
    usarMembro({ papel: "membro", permissoes: { campanhas: "nenhum", leads: "ver" } });
    const chamadas = usar();
    expect((await listarPendentes(CAMP)).erro).toBeTruthy();
    expect(chamadas).toHaveLength(0);
  });

  it("lê só grupos ativos com conexão conectada, maior número primeiro, até 40; marca bloqueado e LID", async () => {
    const chamadas = bancoBloqueados([BLOQ], [], (c) => (c.tabela === "grupos" ? { data: [grupoLinha(G1, 2)] } : undefined));
    hoisted.pedidosPendentes.mockImplementation(async () => [
      { telefone: LIVRE, pedidoEm: "2026-10-17T10:00:00.000Z" },
      { telefone: BLOQ, pedidoEm: null },
      { telefone: LID, pedidoEm: null },
    ]);
    const r = await listarPendentes(CAMP);
    const consulta = chamadas.find((c) => c.tabela === "grupos" && c.filtros.some((f) => f[0] === "limit"))!;
    expect(filtro(consulta, "eq", "ativo")).toBe(true);
    expect(filtro(consulta, "eq", "conexoes.status")).toBe("conectado");
    expect(consulta.filtros.find((f) => f[0] === "limit")?.[1]).toBe(40);
    expect(consulta.filtros.find((f) => f[0] === "order")).toEqual(["order", "numero", { ascending: false }]);
    expect(r.itens!.map((i) => [i.telefone, i.bloqueado, i.lid])).toEqual([
      [LIVRE, false, false],
      [BLOQ, true, false],
      [LID, false, true],
    ]);
    expect(r.semResposta).toBe(0);
  });

  it("sem Leads/ver: número mascarado e sem telefone", async () => {
    usarMembro({ papel: "membro", permissoes: { campanhas: "editar", leads: "nenhum" } });
    bancoBloqueados([], [], (c) => (c.tabela === "grupos" ? { data: [grupoLinha(G1, 2)] } : undefined));
    hoisted.pedidosPendentes.mockImplementation(async () => [{ telefone: LIVRE, pedidoEm: null }]);
    const r = await listarPendentes(CAMP);
    expect(r.itens![0].telefone).toBeNull();
    expect(r.itens![0].numero).toBe("+55 •• •••• 0001");
    expect(JSON.stringify(r)).not.toContain(LIVRE);
  });

  it("um grupo que falha entra em semResposta e o resto vem", async () => {
    bancoBloqueados([], [], (c) => (c.tabela === "grupos" ? { data: [grupoLinha(G1, 2), grupoLinha(G2, 1)] } : undefined));
    hoisted.pedidosPendentes.mockImplementation(async (...a: unknown[]) => {
      if (a[1] === "1@g.us") throw new Error("timeout");
      return [{ telefone: LIVRE, pedidoEm: null }];
    });
    const r = await listarPendentes(CAMP);
    expect(r.itens).toHaveLength(1);
    expect(r.semResposta).toBe(1);
  });

  it("grupos com a conexão desconectada (ou sem conexão) entram em 'não responderam'", async () => {
    bancoBloqueados([], [], (c) => {
      if (c.tabela !== "grupos") return undefined;
      // Leitura dos grupos conectados (com limite) e a contagem (só status da conta) de todos os ativos.
      if (c.filtros.some((f) => f[0] === "limit")) return { data: [grupoLinha(G1, 3)] };
      return { data: [{ id: G1, conexoes: { status: "conectado" } }, { id: G2, conexoes: { status: "desconectado" } }, { id: "g3", conexoes: null }, { id: "g4", conexoes: [{ status: "qr" }] }] };
    });
    hoisted.pedidosPendentes.mockImplementation(async () => [{ telefone: LIVRE, pedidoEm: null }]);
    const r = await listarPendentes(CAMP);
    expect(r.itens).toHaveLength(1);
    expect(r.semResposta).toBe(3);
  });

  it("falha ao contar os desconectados não derruba a aba", async () => {
    bancoBloqueados([], [], (c) => {
      if (c.tabela !== "grupos") return undefined;
      if (c.filtros.some((f) => f[0] === "limit")) return { data: [grupoLinha(G1, 3)] };
      return { error: { message: "caiu" } };
    });
    hoisted.pedidosPendentes.mockImplementation(async () => [{ telefone: LIVRE, pedidoEm: null }]);
    const r = await listarPendentes(CAMP);
    expect(r.erro).toBeUndefined();
    expect(r.semResposta).toBe(0);
  });
});

describe("aprovarSelecionadas / recusarSelecionadas", () => {
  const linhaGrupo = (id: string) => ({ id, group_id: `${id}@g.us`, nome: "Turma", participantes: 10, cheio: false, conexoes: { id: "con1", status: "conectado" }, campanhas: { limite_por_grupo: 1000 } });
  const item = { grupoId: G1, telefone: LIVRE };

  it("sem campanhas/editar: recusa sem ler nem chamar o Zapbot", async () => {
    usarMembro({ papel: "membro", permissoes: { campanhas: "ver", leads: "ver" } });
    const chamadas = usar();
    expect((await aprovarSelecionadas(CAMP, [item])).erro).toBeTruthy();
    expect((await recusarSelecionadas(CAMP, [item])).erro).toBeTruthy();
    expect(chamadas).toHaveLength(0);
    expect(hoisted.revisarPedidos).not.toHaveBeenCalled();
  });

  it("sem leads/ver: recusa (precisa ver o número)", async () => {
    usarMembro({ papel: "membro", permissoes: { campanhas: "editar", leads: "nenhum" } });
    const chamadas = usar();
    expect((await aprovarSelecionadas(CAMP, [item])).erro).toBeTruthy();
    expect((await recusarSelecionadas(CAMP, [item])).erro).toBeTruthy();
    expect(chamadas).toHaveLength(0);
  });

  it("grupo de outra campanha (ou inativo): 'Grupo inválido.' e nada é feito", async () => {
    usar((c) => (c.tabela === "grupos" ? { data: [linhaGrupo(G1)] } : {}));
    const r = await aprovarSelecionadas(CAMP, [item, { grupoId: G2, telefone: "5511" + "900000002" }]);
    expect(r).toEqual({ erro: "Grupo inválido." });
    expect(hoisted.revisarPedidos).not.toHaveBeenCalled();
    expect(hoisted.registrarHistoricoMock).not.toHaveBeenCalled();
  });

  it("mais de 200 itens: recusa", async () => {
    const chamadas = usar();
    const muitos = Array.from({ length: 201 }, (_, i) => ({ grupoId: G1, telefone: `55119${String(i).padStart(8, "0")}` }));
    expect((await aprovarSelecionadas(CAMP, muitos)).erro).toMatch(/200/);
    expect(chamadas).toHaveLength(0);
  });

  it("aprovar: bloqueado mandado pela tela não é aprovado; resposta e histórico", async () => {
    const chamadas = bancoBloqueados([BLOQ], [], (c) => (c.tabela === "grupos" ? { data: [linhaGrupo(G1)] } : undefined));
    const r = await aprovarSelecionadas(CAMP, [item, { grupoId: G1, telefone: BLOQ }]);
    expect(r).toEqual({ mensagem: "1 aprovada(s); 1 não aprovada(s) por bloqueio; 0 falharam" });
    expect(hoisted.revisarPedidos.mock.calls[0][2]).toEqual([LIVRE]);
    const consulta = chamadas.find((c) => c.tabela === "grupos")!;
    expect(filtro(consulta, "eq", "campanha_id")).toBe(CAMP);
    expect(filtro(consulta, "eq", "ativo")).toBe(true);
    expect(hoisted.registrarHistoricoMock.mock.calls[0][1]).toMatchObject({ area: "Campanhas", resumo: "Solicitações de entrada: +1 aprovadas, −0 recusadas", refId: CAMP });
    expect(linhasGravadas(chamadas).every((l) => l.origem === "manual")).toBe(true);
  });

  it("recusar: manda tudo como reject", async () => {
    usar((c) => (c.tabela === "grupos" ? { data: [linhaGrupo(G1)] } : {}));
    const r = await recusarSelecionadas(CAMP, [item, { grupoId: G1, telefone: BLOQ }]);
    expect(r).toEqual({ mensagem: "2 recusada(s); 0 falharam" });
    expect(hoisted.revisarPedidos.mock.calls[0].slice(2, 4)).toEqual([[LIVRE, BLOQ], "reject"]);
    expect(hoisted.registrarHistoricoMock.mock.calls[0][1]).toMatchObject({ resumo: "Solicitações de entrada: +0 aprovadas, −2 recusadas" });
  });

  it("item malformado: recusa", async () => {
    usar();
    expect(await aprovarSelecionadas(CAMP, [{ grupoId: "x", telefone: LIVRE }])).toEqual({ erro: "Solicitação inválida." });
    expect(await aprovarSelecionadas(CAMP, [{ grupoId: G1, telefone: "abc" }])).toEqual({ erro: "Solicitação inválida." });
  });
});

describe("salvarConfiguracoesSolicitacoes", () => {
  const antes = { aprovacao_entrada: false, recusar_bloqueados: false, aprovar_automaticamente: false };
  const banco = (linha = antes) => usar((c) => (c.tabela === "campanhas" && c.op === "select" ? { data: linha } : {}));
  const execucoes = (cs: Chamada[]) => cs.filter((c) => c.tabela === "execucoes" && c.op === "insert");

  it("sem campanhas/editar: recusa", async () => {
    usarMembro({ papel: "membro", permissoes: { campanhas: "ver" } });
    const chamadas = banco();
    expect((await salvarConfiguracoesSolicitacoes(CAMP, { ...antes, aprovacao_entrada: true })).erro).toBeTruthy();
    expect(chamadas).toHaveLength(0);
  });

  it("aprovação mudou: cria a execução configuracao {aprovacao_entrada} em massa ANTES de gravar a campanha", async () => {
    const chamadas = banco();
    const r = await salvarConfiguracoesSolicitacoes(CAMP, { ...antes, aprovacao_entrada: true });
    expect(r.erro).toBeUndefined();
    const ex = execucoes(chamadas);
    expect(ex).toHaveLength(1);
    expect(ex[0].dados).toMatchObject({ campanha_id: CAMP, origem: "massa", tipo: "configuracao", conteudo: { aprovacao_entrada: true }, alvo_grupos: null });
    const idxEx = chamadas.indexOf(ex[0]);
    const idxUp = chamadas.findIndex((c) => c.tabela === "campanhas" && c.op === "update");
    expect(idxEx).toBeLessThan(idxUp);
    expect(hoisted.registrarHistoricoMock.mock.calls[0][1]).toMatchObject({ resumo: "Solicitações de entrada: exigir aprovação ligado" });
  });

  it("só as regras mudaram: grava a campanha sem criar execução", async () => {
    const chamadas = banco({ ...antes, aprovacao_entrada: true });
    await salvarConfiguracoesSolicitacoes(CAMP, { aprovacao_entrada: true, recusar_bloqueados: true, aprovar_automaticamente: true });
    expect(execucoes(chamadas)).toHaveLength(0);
    expect(chamadas.find((c) => c.tabela === "campanhas" && c.op === "update")!.dados).toEqual({ aprovacao_entrada: true, recusar_bloqueados: true, aprovar_automaticamente: true });
  });

  it("nada mudou: não grava nada", async () => {
    const chamadas = banco();
    expect(await salvarConfiguracoesSolicitacoes(CAMP, antes)).toEqual({ mensagem: "Nada mudou." });
    expect(chamadas.filter((c) => c.op !== "select")).toHaveLength(0);
  });

  it("sem aprovação, 'aprovar automaticamente' é gravado desligado", async () => {
    const chamadas = banco();
    await salvarConfiguracoesSolicitacoes(CAMP, { aprovacao_entrada: false, recusar_bloqueados: true, aprovar_automaticamente: true });
    expect(chamadas.find((c) => c.tabela === "campanhas" && c.op === "update")!.dados).toEqual({ aprovacao_entrada: false, recusar_bloqueados: true, aprovar_automaticamente: false });
  });

  it("valor que não é booleano: recusa", async () => {
    banco();
    expect(await salvarConfiguracoesSolicitacoes(CAMP, { aprovacao_entrada: "sim" } as never)).toEqual({ erro: "Valor inválido." });
  });
});

describe("GET /api/exportar/solicitacoes", () => {
  function comAuth(user: unknown, responder?: (c: Chamada) => Resposta) {
    const f = dbFalso(responder);
    hoisted.usuarioDb = Object.assign({}, f.db as object, { auth: { getUser: async () => ({ data: { user } }) } });
    return f.chamadas;
  }
  const req = (q = `?campanha=${CAMP}`) => new Request(`http://x/api/exportar/solicitacoes${q}`);

  it("401 sem sessão", async () => {
    comAuth(null);
    expect((await GET(req())).status).toBe(401);
  });

  it("403 sem leads/ver (tem telefone) ou sem campanhas/ver, sem ler o banco", async () => {
    usarMembro({ papel: "membro", permissoes: { campanhas: "editar", leads: "nenhum" } });
    let chamadas = comAuth({ id: "u1" });
    expect((await GET(req())).status).toBe(403);
    expect(chamadas).toHaveLength(0);
    usarMembro({ papel: "membro", permissoes: { campanhas: "nenhum", leads: "ver" } });
    chamadas = comAuth({ id: "u1" });
    expect((await GET(req())).status).toBe(403);
    expect(chamadas).toHaveLength(0);
  });

  it("400 sem campanha válida", async () => {
    comAuth({ id: "u1" });
    expect((await GET(req(""))).status).toBe(400);
  });

  it("200: gera o CSV e registra a exportação tipo 'solicitacoes'; reexportação não registra de novo", async () => {
    const linha = { created_at: "2026-10-17T12:00:00.000Z", grupo_nome: "Turma", telefone: LIVRE, pedido_em: null, decisao: "aprovada", origem: "automatica", motivo: "Aprovação automática", resultado: "ok", erro: null };
    let chamadas = comAuth({ id: "u1" }, (c) => (c.tabela === "solicitacoes_entrada" ? { data: [linha] } : {}));
    const res = await GET(req());
    expect(res.status).toBe(200);
    const texto = await res.text();
    expect(texto).toContain("Número;Grupo;Decisão;Origem");
    expect(texto).toContain("55 11 " + "90000-0001;Turma;Aprovada;Automática");
    const reg = chamadas.find((c) => c.tabela === "exportacoes" && c.op === "insert")!;
    expect(reg.dados).toMatchObject({ tipo: "solicitacoes", filtros: { campanha: CAMP }, linhas: 1 });

    chamadas = comAuth({ id: "u1" }, (c) => {
      if (c.tabela === "exportacoes" && c.op === "select") return { data: { tipo: "solicitacoes", filtros: { campanha: CAMP } } };
      if (c.tabela === "solicitacoes_entrada") return { data: [linha] };
      return {};
    });
    expect((await GET(req("?exportacao=11111111-1111-1111-1111-111111111111"))).status).toBe(200);
    expect(chamadas.some((c) => c.tabela === "exportacoes" && c.op === "insert")).toBe(false);
  });
});

// ───────────────────────────── Etapa 3N, Task 2 ─────────────────────────────

const AGORA = "2026-10-17T12:00:00.000Z";
const vistosEscritos = (cs: Chamada[]) => cs.filter((c) => c.tabela === "solicitacoes_vistas" && c.op !== "select");

describe("decidirPedidos (Etapa 3N)", () => {
  const db = () => hoisted.adminAtual as never;

  it("404 / 'not found' no group-review vira `expirada` (não erro); o que deu certo sai dos vistos", async () => {
    const chamadas = bancoBloqueados([]);
    hoisted.revisarPedidos.mockImplementationOnce(async () => {
      throw Object.assign(new Error("HTTP 404"), { status: 404 });
    });
    const r = await decidirPedidos(db(), z(), C, { campanhaId: CAMP, grupo, telefones: [LIVRE], decisao: "recusada", origem: "manual", usuario: "u1" });
    expect(linhasGravadas(chamadas)).toEqual([expect.objectContaining({ telefone: LIVRE, decisao: "expirada", resultado: "ok", erro: null, motivo: "O pedido já não existia no WhatsApp" })]);
    expect(r).toMatchObject({ ok: 0, falhas: 1, decididos: [LIVRE] });
    const apagou = vistosEscritos(chamadas);
    expect(apagou).toHaveLength(1);
    expect(apagou[0].op).toBe("delete");
    expect(filtro(apagou[0], "in", "telefone")).toEqual([LIVRE]);

    hoisted.revisarPedidos.mockImplementationOnce(async () => {
      throw new Error("Group request not found");
    });
    const c2 = bancoBloqueados([]);
    await decidirPedidos(db(), z(), C, { campanhaId: CAMP, grupo, telefones: [LIVRE], decisao: "aprovada", origem: "automatica", usuario: null });
    expect(linhasGravadas(c2)[0]).toMatchObject({ decisao: "expirada" });
  });

  it("pedidoNaoExiste: só o pedido (item); conexão ou grupo não encontrados nunca viram `expirada` (revisão final A, m1)", () => {
    expect(pedidoNaoExiste(Object.assign(new Error("HTTP 404"), { status: 404 }))).toBe(true);
    expect(pedidoNaoExiste(new Error("Group request not found"))).toBe(true);
    expect(pedidoNaoExiste(new Error("participant not found"))).toBe(true);
    for (const msg of ["Instance not found", "instance_not_found", "Group not found", "group-not-found", "Session not found", "Grupo não encontrado", "Token not found"]) {
      expect(pedidoNaoExiste(Object.assign(new Error(msg), { status: 404 })), msg).toBe(false);
      expect(pedidoNaoExiste(Object.assign(new Error("HTTP 404"), { status: 404, body: { error: msg } })), msg).toBe(false);
    }
  });

  it("group-review com 'instance not found' / 'group not found': erro (não sai dos vistos), nunca `expirada`", async () => {
    for (const msg of ["Instance not found", "Group not found"]) {
      const chamadas = bancoBloqueados([]);
      hoisted.revisarPedidos.mockImplementationOnce(async () => {
        throw Object.assign(new Error(msg), { status: 404 });
      });
      await decidirPedidos(db(), z(), C, { campanhaId: CAMP, grupo, telefones: [LIVRE], decisao: "recusada", origem: "manual", usuario: "u1" });
      expect(linhasGravadas(chamadas)[0], msg).toMatchObject({ decisao: "recusada", resultado: "erro" });
      expect(vistosEscritos(chamadas)).toEqual([]);
    }
  });

  it("falha comum continua `erro` e não sai dos vistos", async () => {
    const chamadas = bancoBloqueados([]);
    hoisted.revisarPedidos.mockImplementationOnce(async () => {
      throw new Error("HTTP 500");
    });
    await decidirPedidos(db(), z(), C, { campanhaId: CAMP, grupo, telefones: [LIVRE], decisao: "recusada", origem: "manual", usuario: "u1" });
    expect(linhasGravadas(chamadas)[0]).toMatchObject({ decisao: "recusada", resultado: "erro" });
    expect(vistosEscritos(chamadas)).toEqual([]);
  });

  it("motivo por telefone (automática × por tag)", async () => {
    const chamadas = bancoBloqueados([]);
    await decidirPedidos(db(), z(), C, {
      campanhaId: CAMP, grupo, telefones: [LIVRE, "5511" + "900000002"], decisao: "aprovada", origem: "automatica", usuario: null,
      motivo: "Aprovação automática", motivoPorTelefone: { ["5511" + "900000002"]: "Aprovação por tag" },
    });
    expect(linhasGravadas(chamadas).map((l) => [l.telefone, (l as unknown as { motivo: string }).motivo])).toEqual([
      [LIVRE, "Aprovação automática"],
      ["5511" + "900000002", "Aprovação por tag"],
    ]);
  });
});

describe("registrarLeitura", () => {
  const db = () => hoisted.adminAtual as never;
  type VistoBanco = { telefone: string; pedido_em: string | null; visto_em: string; ultimo_visto_em: string };
  function banco(o: { vistos?: VistoBanco[]; entraram?: { telefone: string; entrou_em: string }[]; decididos?: { telefone: string; created_at: string }[] } = {}) {
    return usar((c) => {
      if (c.tabela === "solicitacoes_vistas" && c.op === "select") return { data: o.vistos ?? [] };
      if (c.tabela === "participantes") return { data: o.entraram ?? [] };
      if (c.tabela === "solicitacoes_entrada" && c.op === "select") return { data: o.decididos ?? [] };
      return {};
    });
  }
  const visto = (telefone: string, ultimo = "2026-10-17T11:58:00.000Z"): VistoBanco => ({ telefone, pedido_em: null, visto_em: "2026-10-17T10:00:00.000Z", ultimo_visto_em: ultimo });
  /** Pedido que continua pendente: a leitura não vem vazia (leitura vazia com vistos = incompleta, revisão final A). */
  const FICA = "5511" + "900000099";
  const leitura = (pedidos: { telefone: string; pedidoEm: string | null }[], completa = true, extra = {}) =>
    registrarLeitura(db(), { campanhaId: CAMP, grupo, pedidos, completa, agora: AGORA, ...extra });

  it("pedido novo: insert com visto_em = ultimo_visto_em = agora (repetido é ignorado)", async () => {
    const chamadas = banco();
    const r = await leitura([{ telefone: LIVRE, pedidoEm: "2026-10-17T11:00:00.000Z" }]);
    const up = vistosEscritos(chamadas);
    expect(up).toHaveLength(1);
    expect(up[0].op).toBe("upsert");
    expect(up[0].dados).toEqual([{ grupo_id: G1, campanha_id: CAMP, telefone: LIVRE, pedido_em: "2026-10-17T11:00:00.000Z", visto_em: AGORA, ultimo_visto_em: AGORA }]);
    expect(up[0].opcoes).toEqual({ onConflict: "grupo_id,telefone", ignoreDuplicates: true });
    expect(r.novos).toEqual([{ telefone: LIVRE, pedidoEm: "2026-10-17T11:00:00.000Z" }]);
  });

  it("mesma lista de novo (visto há pouco): nenhuma escrita", async () => {
    const chamadas = banco({ vistos: [visto(LIVRE)] });
    const r = await leitura([{ telefone: LIVRE, pedidoEm: null }]);
    expect(vistosEscritos(chamadas)).toEqual([]);
    expect(chamadas.some((c) => c.tabela === "solicitacoes_entrada")).toBe(false);
    expect(r.novos).toEqual([]);
    expect(r.vistos.map((v) => v.telefone)).toEqual([LIVRE]);
  });

  it("visto de novo depois de 1 h: só regrava ultimo_visto_em (visto_em fica)", async () => {
    const chamadas = banco({ vistos: [visto(LIVRE, "2026-10-17T10:30:00.000Z")] });
    await leitura([{ telefone: LIVRE, pedidoEm: null }]);
    const esc = vistosEscritos(chamadas);
    expect(esc.map((c) => [c.op, c.dados])).toEqual([["update", { ultimo_visto_em: AGORA }]]);
  });

  it("leitura vazia com pedidos já vistos vale como incompleta: não fecha nem apaga nada (revisão final A)", async () => {
    const chamadas = banco({ vistos: [visto(LIVRE), visto("5511" + "900000002")], entraram: [{ telefone: "551100000001", entrou_em: AGORA }] });
    const r = await leitura([]);
    expect(vistosEscritos(chamadas)).toEqual([]);
    expect(chamadas.some((c) => c.tabela === "solicitacoes_entrada" || c.tabela === "participantes")).toBe(false);
    expect(r.fechados).toEqual([]);
    expect(r.vistos.map((v) => v.telefone)).toEqual([LIVRE, "5511" + "900000002"]);
  });

  it("lê no máximo 1000 vistos por grupo (max_rows da API; revisão final A, m2)", async () => {
    expect(MAX_VISTOS_POR_GRUPO).toBe(1_000);
    const chamadas = banco();
    await leitura([{ telefone: LIVRE, pedidoEm: null }]);
    const sel = chamadas.find((c) => c.tabela === "solicitacoes_vistas" && c.op === "select")!;
    expect(sel.filtros).toContainEqual(["limit", 1_000]);
  });

  it("leitura vazia sem nada visto: nenhuma escrita", async () => {
    const chamadas = banco();
    const r = await leitura([]);
    expect(vistosEscritos(chamadas)).toEqual([]);
    expect(r).toEqual({ novos: [], fechados: [], vistos: [] });
  });

  it("leitura parcial (o grupo não respondeu): não fecha nada", async () => {
    const chamadas = banco({ vistos: [visto(LIVRE)] });
    const r = await leitura([], false);
    expect(vistosEscritos(chamadas)).toEqual([]);
    expect(chamadas.some((c) => c.tabela === "solicitacoes_entrada" || c.tabela === "participantes")).toBe(false);
    expect(r.fechados).toEqual([]);
  });

  it("sumiu e entrou = aprovada pelo WhatsApp; sumiu sem entrar = cancelada; grava o Histórico e tira dos vistos", async () => {
    const chamadas = banco({ vistos: [visto(LIVRE), visto("5511" + "900000002"), visto(FICA)], entraram: [{ telefone: "551100000001", entrou_em: AGORA }] });
    const r = await leitura([{ telefone: FICA, pedidoEm: null }]);
    const hist = linhasGravadas(chamadas) as unknown as { telefone: string; decisao: string; origem: string; resultado: string; motivo: string }[];
    expect(hist.map((h) => [h.telefone, h.decisao, h.origem, h.resultado])).toEqual([
      [LIVRE, "aprovada", "whatsapp", "ok"],
      ["5511" + "900000002", "cancelada", "whatsapp", "ok"],
    ]);
    expect(hist[0].motivo).toBe("Aprovada pelo celular");
    const del = vistosEscritos(chamadas).find((c) => c.op === "delete")!;
    expect(filtro(del, "in", "telefone")).toEqual([LIVRE, "5511" + "900000002"]);
    expect(r.fechados.map((f) => [f.telefone, f.decisao])).toEqual([[LIVRE, "aprovada"], ["5511" + "900000002", "cancelada"]]);
    // As leituras de apoio olham a partir do visto_em mais antigo, só neste grupo.
    const part = chamadas.find((c) => c.tabela === "participantes")!;
    expect(filtro(part, "eq", "grupo_id")).toBe(G1);
    expect(filtro(part, "gte", "entrou_em")).toBe("2026-10-17T10:00:00.000Z");
    expect(filtro(part, "is", "saiu_em")).toBeNull();
  });

  it("LID que sumiu: nunca vira cancelada (fica nos vistos)", async () => {
    const chamadas = banco({ vistos: [visto(LID)] });
    const r = await leitura([]);
    expect(linhasGravadas(chamadas)).toEqual([]);
    expect(vistosEscritos(chamadas)).toEqual([]);
    expect(r.vistos.map((v) => v.telefone)).toEqual([LID]);
  });

  it("decisão manual gravada no meio da leitura (relida antes de gravar): não duplica", async () => {
    let leiturasDecisao = 0;
    const chamadas = usar((c) => {
      if (c.tabela === "solicitacoes_vistas" && c.op === "select") return { data: [visto(LIVRE), visto(FICA)] };
      if (c.tabela === "solicitacoes_entrada" && c.op === "select") {
        leiturasDecisao++;
        return { data: leiturasDecisao === 1 ? [] : [{ telefone: LIVRE, created_at: "2026-10-17T11:59:59.000Z" }] };
      }
      return {};
    });
    const r = await leitura([{ telefone: FICA, pedidoEm: null }]);
    expect(leiturasDecisao).toBe(2);
    expect(linhasGravadas(chamadas)).toEqual([]);
    expect(filtro(vistosEscritos(chamadas).find((c) => c.op === "delete")!, "in", "telefone")).toEqual([LIVRE]);
    expect(r.fechados).toEqual([]);
  });

  it("decidido por nós depois de visto_em: não duplica (sai dos vistos sem linha nova)", async () => {
    const chamadas = banco({ vistos: [visto(LIVRE), visto(FICA)], decididos: [{ telefone: LIVRE, created_at: "2026-10-17T11:00:00.000Z" }] });
    await leitura([{ telefone: FICA, pedidoEm: null }]);
    expect(linhasGravadas(chamadas)).toEqual([]);
    expect(filtro(vistosEscritos(chamadas).find((c) => c.op === "delete")!, "in", "telefone")).toEqual([LIVRE]);
  });

  it("aba Pendentes (participantes não frescos): quem sumiu sem entrar não é cancelado nem apagado", async () => {
    const chamadas = banco({ vistos: [visto(LIVRE)] });
    await leitura([], true, { participantesFrescos: false });
    expect(linhasGravadas(chamadas)).toEqual([]);
    expect(vistosEscritos(chamadas)).toEqual([]);
  });

  it("erro ao ler os vistos lança antes de escrever", async () => {
    const chamadas = usar((c) => (c.tabela === "solicitacoes_vistas" ? { error: { message: "caiu" } } : {}));
    await expect(leitura([{ telefone: LIVRE, pedidoEm: null }])).rejects.toThrow(/vistos/);
    expect(chamadas.filter((c) => c.op !== "select")).toEqual([]);
  });
});

describe("expirarVistos", () => {
  const db = () => hoisted.adminAtual as never;

  it("vistos sem leitura há 48 h viram `expirada` (origem whatsapp) e saem; até 500 por tick; nenhuma chamada ao Zapbot", async () => {
    const chamadas = usar((c) =>
      c.tabela === "solicitacoes_vistas" && c.op === "select"
        ? { data: [{ grupo_id: G1, campanha_id: CAMP, telefone: LIVRE, pedido_em: null, grupos: { nome: "Turma 01" } }, { grupo_id: G2, campanha_id: CAMP, telefone: "5511" + "900000002", pedido_em: null, grupos: null }] }
        : {},
    );
    expect(await expirarVistos(db(), AGORA)).toBe(2);
    const sel = chamadas.find((c) => c.tabela === "solicitacoes_vistas" && c.op === "select")!;
    expect(filtro(sel, "lt", "ultimo_visto_em")).toBe("2026-10-15T12:00:00.000Z");
    expect(sel.filtros.find((f) => f[0] === "limit")?.[1]).toBe(MAX_EXPIRAR_POR_TICK);
    expect(linhasGravadas(chamadas).map((l) => [l.telefone, l.decisao, l.origem, (l as unknown as { motivo: string }).motivo])).toEqual([
      [LIVRE, "expirada", "whatsapp", "Sem leitura há 48 horas"],
      ["5511" + "900000002", "expirada", "whatsapp", "Sem leitura há 48 horas"],
    ]);
    expect(vistosEscritos(chamadas).filter((c) => c.op === "delete")).toHaveLength(2);
    expect(hoisted.pedidosPendentes).not.toHaveBeenCalled();
    expect(hoisted.revisarPedidos).not.toHaveBeenCalled();
  });

  it("quem entrou no grupo depois de visto_em (nas variantes) vira aprovada pelo celular, não expirada", async () => {
    const chamadas = usar((c) => {
      if (c.tabela === "solicitacoes_vistas" && c.op === "select")
        return { data: [
          { grupo_id: G1, campanha_id: CAMP, telefone: LIVRE, pedido_em: null, visto_em: "2026-10-14T10:00:00.000Z", grupos: { nome: "Turma 01" } },
          { grupo_id: G1, campanha_id: CAMP, telefone: "5511" + "900000002", pedido_em: null, visto_em: "2026-10-14T10:00:00.000Z", grupos: { nome: "Turma 01" } },
          { grupo_id: G1, campanha_id: CAMP, telefone: "5511" + "900000003", pedido_em: null, visto_em: "2026-10-14T10:00:00.000Z", grupos: { nome: "Turma 01" } },
        ] };
      if (c.tabela === "participantes")
        return { data: [
          { telefone: "551100000001", entrou_em: "2026-10-14T11:00:00.000Z" },
          { telefone: "5511" + "900000003", entrou_em: "2026-10-14T09:00:00.000Z" }, // antes do visto_em: não conta
        ] };
      return {};
    });
    expect(await expirarVistos(db(), AGORA)).toBe(3);
    const part = chamadas.find((c) => c.tabela === "participantes")!;
    expect(filtro(part, "eq", "grupo_id")).toBe(G1);
    expect(filtro(part, "in", "telefone")).toEqual(expect.arrayContaining([LIVRE, "551100000001"]));
    expect(linhasGravadas(chamadas).map((l) => [l.telefone, l.decisao, (l as unknown as { motivo: string }).motivo])).toEqual([
      [LIVRE, "aprovada", "Aprovada pelo celular"],
      ["5511" + "900000002", "expirada", "Sem leitura há 48 horas"],
      ["5511" + "900000003", "expirada", "Sem leitura há 48 horas"],
    ]);
  });

  it("nada vencido: nenhuma escrita", async () => {
    const chamadas = usar();
    expect(await expirarVistos(db(), AGORA)).toBe(0);
    expect(chamadas.filter((c) => c.op !== "select")).toEqual([]);
  });
});

describe("lerEResponderPedidos (Etapa 3N)", () => {
  const db = () => hoisted.adminAtual as never;
  const base = { campanhaId: CAMP, grupo, recusarBloqueados: false, aprovarAutomaticamente: false, vagas: 100, suspeita: false, membros: 50, agora: AGORA };
  const TAG = "77777777-7777-7777-7777-777777777777";
  const ESTRANGEIRO = "14155550100";

  it("aprovação por tag: aprova o livre com tag (até estrangeiro), nunca o bloqueado nem o LID com tag; motivo 'Aprovação por tag'", async () => {
    const chamadas = bancoBloqueados([BLOQ_SEM_9], [], (c) => {
      if (c.tabela !== "pessoa_tags") return undefined;
      const pedidas = (filtro(c, "in", "telefone") as string[]) ?? [];
      return { data: [BLOQ, BLOQ_SEM_9, ESTRANGEIRO, "551100000001"].filter((t) => pedidas.includes(t)).map((telefone) => ({ telefone })) };
    });
    hoisted.pedidosPendentes.mockImplementation(async () => [
      { telefone: LIVRE, pedidoEm: null },
      { telefone: BLOQ, pedidoEm: null },
      { telefone: LID, pedidoEm: null },
      { telefone: ESTRANGEIRO, pedidoEm: null },
      { telefone: "5511" + "900000002", pedidoEm: null },
    ]);
    const r = await lerEResponderPedidos(db(), z(), C, { ...base, aprovarPorTag: true, aprovarTags: [TAG] });
    expect(hoisted.revisarPedidos.mock.calls.map((c) => [c[2], c[3]])).toEqual([[[LIVRE, ESTRANGEIRO], "approve"]]);
    expect(r.aprovadas).toBe(2);
    const tagsLidas = chamadas.find((c) => c.tabela === "pessoa_tags")!;
    expect(filtro(tagsLidas, "in", "tag_id")).toEqual([TAG]);
    expect(linhasGravadas(chamadas).map((l) => (l as unknown as { motivo: string }).motivo)).toEqual(["Aprovação por tag", "Aprovação por tag"]);
    // Sem a regra de hoje ligada: nem consulta participações.
    expect(chamadas.some((c) => c.tabela === "participantes" && filtro(c, "eq", "grupos.campanha_id"))).toBe(false);
  });

  it("tag ligada mas sem nenhuma tag escolhida: não lê nada", async () => {
    bancoBloqueados([]);
    const r = await lerEResponderPedidos(db(), z(), C, { ...base, aprovarPorTag: true, aprovarTags: [] });
    expect(r).toMatchObject({ aprovadas: 0, recusadas: 0, leitura: null });
    expect(hoisted.pedidosPendentes).not.toHaveBeenCalled();
  });

  it("rodada suspeita: lê e registra, mas não decide", async () => {
    const chamadas = bancoBloqueados([BLOQ]);
    hoisted.pedidosPendentes.mockImplementation(async () => [{ telefone: BLOQ, pedidoEm: null }, { telefone: LIVRE, pedidoEm: null }]);
    await lerEResponderPedidos(db(), z(), C, { ...base, recusarBloqueados: true, aprovarAutomaticamente: true, suspeita: true });
    expect(hoisted.revisarPedidos).not.toHaveBeenCalled();
    expect(vistosEscritos(chamadas).map((c) => c.op)).toEqual(["upsert"]);
    expect(chamadas.some((c) => c.tabela === "bloqueados_efetivos")).toBe(false);
  });

  it("só reservar vaga: lê, registra e grava pendentes_reservados (sem decidir nada)", async () => {
    const chamadas = bancoBloqueados([]);
    hoisted.pedidosPendentes.mockImplementation(async () => [{ telefone: LIVRE, pedidoEm: "2026-10-17T11:00:00.000Z" }, { telefone: BLOQ, pedidoEm: "2026-10-10T11:00:00.000Z" }]);
    await lerEResponderPedidos(db(), z(), C, { ...base, reservarVaga: true, reservadosAtual: 0, lidosEmAtual: null });
    expect(hoisted.revisarPedidos).not.toHaveBeenCalled();
    const up = chamadas.find((c) => c.tabela === "grupos" && c.op === "update")!;
    // O pedido de 7 dias atrás não segura vaga (só os das últimas 48 h).
    expect(up.dados).toEqual({ pendentes_reservados: 1, pendentes_lidos_em: AGORA });
    expect(filtro(up, "eq", "id")).toBe(G1);
  });

  it("reserva: o que foi aprovado nesta rodada não segura vaga; número igual e marca recente = nenhuma escrita", async () => {
    let chamadas = bancoBloqueados([]);
    hoisted.pedidosPendentes.mockImplementation(async () => [{ telefone: LIVRE, pedidoEm: AGORA }, { telefone: "5511" + "900000002", pedidoEm: AGORA }]);
    await lerEResponderPedidos(db(), z(), C, { ...base, aprovarAutomaticamente: true, vagas: 1, reservarVaga: true, reservadosAtual: 5 });
    expect(chamadas.find((c) => c.tabela === "grupos" && c.op === "update")!.dados).toEqual({ pendentes_reservados: 1, pendentes_lidos_em: AGORA });

    chamadas = bancoBloqueados([], [], (c) => (c.tabela === "solicitacoes_vistas" && c.op === "select" ? { data: [{ telefone: LIVRE, pedido_em: AGORA, visto_em: AGORA, ultimo_visto_em: AGORA }] } : undefined));
    hoisted.pedidosPendentes.mockImplementation(async () => [{ telefone: LIVRE, pedidoEm: AGORA }]);
    await lerEResponderPedidos(db(), z(), C, { ...base, reservarVaga: true, reservadosAtual: 1, lidosEmAtual: "2026-10-17T11:58:00.000Z" });
    expect(chamadas.some((c) => c.op !== "select")).toBe(false);
  });

  it("reserva: bloqueado e LID não seguram vaga (mesma classificação da decisão)", async () => {
    const chamadas = bancoBloqueados([BLOQ_SEM_9]);
    hoisted.pedidosPendentes.mockImplementation(async () => [
      { telefone: LIVRE, pedidoEm: AGORA },
      { telefone: BLOQ, pedidoEm: AGORA },
      { telefone: LID, pedidoEm: AGORA },
      { telefone: "120363012345678", pedidoEm: AGORA },
    ]);
    await lerEResponderPedidos(db(), z(), C, { ...base, reservarVaga: true, reservadosAtual: 0 });
    expect(chamadas.filter((c) => c.tabela === "bloqueados_efetivos")).toHaveLength(1);
    expect(chamadas.find((c) => c.tabela === "grupos" && c.op === "update")!.dados).toEqual({ pendentes_reservados: 1, pendentes_lidos_em: AGORA });
  });

  it("grupo não respondeu (404): não mexe na reserva", async () => {
    const chamadas = bancoBloqueados([]);
    hoisted.pedidosPendentes.mockImplementation(async () => null);
    await lerEResponderPedidos(db(), z(), C, { ...base, reservarVaga: true, reservadosAtual: 3 });
    expect(chamadas.some((c) => c.tabela === "grupos")).toBe(false);
  });
});

describe("listarPendentes registra a leitura (Etapa 3N)", () => {
  const grupoLinha = (id: string, n: number) => ({ id, group_id: `${n}@g.us`, nome: `Turma ${n}`, numero: n, conexao_id: "con1", conexoes: { id: "con1", status: "conectado" } });
  /** Campanha com a reserva ligada: a aba registra a leitura (revisão final A). */
  const comRegra = (c: Chamada): Resposta | undefined => (c.tabela === "campanhas" ? { data: { reservar_vaga_pendentes: true } } : undefined);
  const escritas = (cs: Chamada[]) => cs.filter((c) => c.op !== "select");

  it("grupo que respondeu vira upsert em solicitacoes_vistas; o que não respondeu não", async () => {
    const chamadas = bancoBloqueados([], [], (c) => (c.tabela === "grupos" ? { data: [grupoLinha(G1, 2), grupoLinha(G2, 1)] } : comRegra(c)));
    hoisted.pedidosPendentes.mockImplementation(async (...a: unknown[]) => {
      if (a[1] === "1@g.us") throw new Error("timeout");
      return [{ telefone: LIVRE, pedidoEm: null }];
    });
    const r = await listarPendentes(CAMP);
    expect(r.itens).toHaveLength(1);
    const ups = vistosEscritos(chamadas);
    expect(ups.map((c) => c.op)).toEqual(["upsert"]);
    expect((ups[0].dados as { grupo_id: string }[])[0].grupo_id).toBe(G1);
  });

  it("tudo desligado (sem regra, sem reserva, sem Hook assinado): abrir a aba não grava nada (revisão final A)", async () => {
    const casos: Record<string, unknown>[] = [
      {},
      { recusar_bloqueados: false, aprovar_automaticamente: false, aprovar_por_tag: false, aprovar_tags: [], reservar_vaga_pendentes: false },
      // Aprovar por tag ligado sem tag escolhida não conta (igual à conferência).
      { aprovar_por_tag: true, aprovar_tags: [] },
    ];
    for (const camp of casos) {
      const chamadas = bancoBloqueados([], [], (c) => {
        if (c.tabela === "grupos") return { data: [grupoLinha(G1, 2)] };
        if (c.tabela === "campanhas") return { data: camp };
        if (c.tabela === "webhooks") return { data: [{ id: "w1", url: "https://x.test", eventos: ["solicitacoes_entrada"], campanhas: ["outra"], ativo: true, arquivado: false }] };
        if (c.tabela === "solicitacoes_vistas") return { data: [{ telefone: "5511" + "900000002", pedido_em: null, visto_em: "2026-10-17T10:00:00.000Z", ultimo_visto_em: "2026-10-17T10:00:00.000Z" }] };
        return undefined;
      });
      hoisted.pedidosPendentes.mockImplementation(async () => [{ telefone: LIVRE, pedidoEm: null }]);
      const r = await listarPendentes(CAMP);
      expect(r.itens, JSON.stringify(camp)).toHaveLength(1);
      expect(escritas(chamadas), JSON.stringify(camp)).toEqual([]);
      expect(chamadas.some((c) => c.tabela === "solicitacoes_vistas")).toBe(false);
    }
  });

  it("cada uma das regras (ou um Hook ativo assinado pra campanha) faz a aba registrar", async () => {
    const casos: [Record<string, unknown>, unknown[]][] = [
      [{ recusar_bloqueados: true }, []],
      [{ aprovar_automaticamente: true }, []],
      [{ aprovar_por_tag: true, aprovar_tags: ["77777777-7777-7777-7777-777777777777"] }, []],
      [{ reservar_vaga_pendentes: true }, []],
      [{}, [{ id: "w1", url: "https://x.test", eventos: ["solicitacoes_entrada"], campanhas: [CAMP], ativo: true, arquivado: false }]],
    ];
    for (const [camp, webhooks] of casos) {
      const chamadas = bancoBloqueados([], [], (c) => {
        if (c.tabela === "grupos") return { data: [grupoLinha(G1, 2)] };
        if (c.tabela === "campanhas") return { data: camp };
        if (c.tabela === "webhooks") return { data: webhooks };
        return undefined;
      });
      hoisted.pedidosPendentes.mockImplementation(async () => [{ telefone: LIVRE, pedidoEm: null }]);
      await listarPendentes(CAMP);
      expect(vistosEscritos(chamadas).map((c) => c.op), JSON.stringify(camp)).toEqual(["upsert"]);
    }
  });

  it("falha ao ler a campanha: não grava (só mostra a lista)", async () => {
    const chamadas = bancoBloqueados([], [], (c) => {
      if (c.tabela === "grupos") return { data: [grupoLinha(G1, 2)] };
      if (c.tabela === "campanhas") return { error: { message: "caiu" } };
      return undefined;
    });
    hoisted.pedidosPendentes.mockImplementation(async () => [{ telefone: LIVRE, pedidoEm: null }]);
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await listarPendentes(CAMP);
    erro.mockRestore();
    expect(r.itens).toHaveLength(1);
    expect(escritas(chamadas)).toEqual([]);
  });

  it("falha ao registrar não derruba a aba", async () => {
    bancoBloqueados([], [], (c) => {
      if (c.tabela === "grupos") return { data: [grupoLinha(G1, 2)] };
      if (c.tabela === "campanhas") return { data: { recusar_bloqueados: true } };
      if (c.tabela === "solicitacoes_vistas") return { error: { message: "caiu" } };
      return undefined;
    });
    hoisted.pedidosPendentes.mockImplementation(async () => [{ telefone: LIVRE, pedidoEm: null }]);
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await listarPendentes(CAMP);
    erro.mockRestore();
    expect(r.erro).toBeUndefined();
    expect(r.itens).toHaveLength(1);
  });
});

describe("salvarConfiguracoesSolicitacoes (Etapa 3N)", () => {
  const T1 = "11111111-aaaa-4aaa-8aaa-111111111111";
  const T2 = "22222222-aaaa-4aaa-8aaa-222222222222";
  const antes = { aprovacao_entrada: true, recusar_bloqueados: false, aprovar_automaticamente: false, reservar_vaga_pendentes: false, aprovar_por_tag: false, aprovar_tags: [] as string[] };
  const banco = (linha: Record<string, unknown> = antes, existentes = [T1, T2]) =>
    usar((c) => {
      if (c.tabela === "campanhas" && c.op === "select") return { data: linha };
      if (c.tabela === "tags") return { data: existentes.filter((t) => ((filtro(c, "in", "id") as string[]) ?? []).includes(t)).map((id) => ({ id })) };
      return {};
    });
  const regras = { aprovacao_entrada: true, recusar_bloqueados: false, aprovar_automaticamente: false };
  const gravado = (cs: Chamada[]) => cs.find((c) => c.tabela === "campanhas" && c.op === "update")?.dados;

  it("grava reserva, tag e tags (conferidas no banco) e registra o que mudou", async () => {
    const chamadas = banco();
    const r = await salvarConfiguracoesSolicitacoes(CAMP, { ...regras, reservar_vaga_pendentes: true, aprovar_por_tag: true, aprovar_tags: [T1, T2, T1] });
    expect(r.erro).toBeUndefined();
    expect(gravado(chamadas)).toEqual({ ...regras, reservar_vaga_pendentes: true, aprovar_por_tag: true, aprovar_tags: [T1, T2] });
    expect(hoisted.registrarHistoricoMock.mock.calls[0][1]).toMatchObject({ resumo: "Solicitações de entrada: reservar vaga ligado, aprovar por tag ligado, tags da aprovação por tag: 2" });
    expect(chamadas.some((c) => c.tabela === "execucoes")).toBe(false);
  });

  it("tag que não existe: recusa sem gravar", async () => {
    const chamadas = banco(antes, [T1]);
    expect(await salvarConfiguracoesSolicitacoes(CAMP, { ...regras, aprovar_tags: [T1, T2] })).toEqual({ erro: "Tag inválida." });
    expect(gravado(chamadas)).toBeUndefined();
  });

  it("mais de 20 tags ou id inválido: recusa sem ler o banco", async () => {
    const chamadas = banco();
    const muitas = Array.from({ length: 21 }, (_, i) => `11111111-aaaa-4aaa-8aaa-${String(i).padStart(12, "0")}`);
    expect(await salvarConfiguracoesSolicitacoes(CAMP, { ...regras, aprovar_tags: muitas })).toEqual({ erro: "No máximo 20 tags." });
    expect(await salvarConfiguracoesSolicitacoes(CAMP, { ...regras, aprovar_tags: ["x"] })).toEqual({ erro: "Tag inválida." });
    expect(chamadas).toHaveLength(0);
  });

  it("aprovar por tag sem tag, ou sem aprovação: gravado desligado", async () => {
    let chamadas = banco();
    await salvarConfiguracoesSolicitacoes(CAMP, { ...regras, aprovar_por_tag: true, aprovar_tags: [] });
    expect(gravado(chamadas)).toBeUndefined(); // nada mudou de verdade
    chamadas = banco({ ...antes, aprovar_por_tag: true, aprovar_tags: [T1] });
    await salvarConfiguracoesSolicitacoes(CAMP, { ...regras, aprovacao_entrada: false, aprovar_por_tag: true });
    expect(gravado(chamadas)).toMatchObject({ aprovacao_entrada: false, aprovar_por_tag: false });
  });

  it("campos novos ausentes mantêm o gravado (não entram no update)", async () => {
    const chamadas = banco({ ...antes, reservar_vaga_pendentes: true, aprovar_por_tag: true, aprovar_tags: [T1] });
    await salvarConfiguracoesSolicitacoes(CAMP, { ...regras, recusar_bloqueados: true });
    expect(gravado(chamadas)).toEqual({ ...regras, recusar_bloqueados: true });
  });
});

describe("aplicarAprovacaoEmTodos", () => {
  const banco = () => usar((c) => (c.tabela === "campanhas" && c.op === "select" ? { data: { id: CAMP } } : {}));

  it("sem campanhas/editar: recusa sem ler nada", async () => {
    usarMembro({ papel: "membro", permissoes: { campanhas: "ver" } });
    const chamadas = banco();
    expect((await aplicarAprovacaoEmTodos(CAMP, true)).erro).toBeTruthy();
    expect(chamadas).toHaveLength(0);
  });

  it("ativar: cria a execução configuracao em massa e só depois grava aprovacao_entrada", async () => {
    const chamadas = banco();
    expect((await aplicarAprovacaoEmTodos(CAMP, true)).erro).toBeUndefined();
    const ex = chamadas.findIndex((c) => c.tabela === "execucoes" && c.op === "insert");
    const up = chamadas.findIndex((c) => c.tabela === "campanhas" && c.op === "update");
    expect(chamadas[ex].dados).toMatchObject({ origem: "massa", tipo: "configuracao", conteudo: { aprovacao_entrada: true } });
    expect(ex).toBeLessThan(up);
    expect(chamadas[up].dados).toEqual({ aprovacao_entrada: true });
  });

  it("desativar: também desliga as aprovações automáticas", async () => {
    const chamadas = banco();
    await aplicarAprovacaoEmTodos(CAMP, false);
    expect(chamadas.find((c) => c.tabela === "campanhas" && c.op === "update")!.dados).toEqual({ aprovacao_entrada: false, aprovar_automaticamente: false, aprovar_por_tag: false });
  });
});

describe("GET /api/exportar/solicitacoes com ?status= (Etapa 3N)", () => {
  function comAuth(responder?: (c: Chamada) => Resposta) {
    const f = dbFalso(responder);
    hoisted.usuarioDb = Object.assign({}, f.db as object, { auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) } });
    return f.chamadas;
  }
  it("o CSV respeita o filtro e guarda o status na exportação", async () => {
    const chamadas = comAuth();
    const res = await GET(new Request(`http://x/api/exportar/solicitacoes?campanha=${CAMP}&status=aprovadas`));
    expect(res.status).toBe(200);
    const sel = chamadas.find((c) => c.tabela === "solicitacoes_entrada")!;
    expect(filtro(sel, "eq", "decisao")).toBe("aprovada");
    expect(filtro(sel, "eq", "resultado")).toBe("ok");
    expect(chamadas.find((c) => c.tabela === "exportacoes" && c.op === "insert")!.dados).toMatchObject({ filtros: { campanha: CAMP, status: "aprovadas" } });
  });
  it("sem status (ou inválido): todas as linhas, inclusive as de erro", async () => {
    const chamadas = comAuth();
    await GET(new Request(`http://x/api/exportar/solicitacoes?campanha=${CAMP}&status=xyz`));
    const sel = chamadas.find((c) => c.tabela === "solicitacoes_entrada")!;
    expect(filtro(sel, "eq", "decisao")).toBeUndefined();
    expect(filtro(sel, "eq", "resultado")).toBeUndefined();
  });
});

// ---------- Hook "Solicitações de entrada em grupos" (Etapa 3N, Tarefa 3) ----------

/** Escuta `solicitacoes_entrada` só da campanha CAMP. */
const HOOK_SOLIC = { id: "w-solic", url: "https://hook.test/solic", eventos: ["solicitacoes_entrada"], campanhas: [CAMP], ativo: true, arquivado: false };
/** Webhook de antes (só os 4 eventos antigos). */
const HOOK_ANTIGO = { id: "w-antigo", url: "https://hook.test/antigo", eventos: ["entrou", "saiu", "alerta", "compra"], campanhas: null, ativo: true, arquivado: false };
type LinhaSaida = { webhook_id: string; chave: string; payload: Record<string, unknown> & { tipo: string; solicitacoes: Record<string, unknown>[] } };
const saidas = (cs: Chamada[]) => cs.filter((c) => c.tabela === "eventos_saida" && (c.op === "upsert" || c.op === "insert")).flatMap((c) => c.dados as LinhaSaida[]);

describe("lerEResponderPedidos: Hook (Etapa 3N, Tarefa 3)", () => {
  const db = () => hoisted.adminAtual as never;
  const base = { campanhaId: CAMP, grupo, recusarBloqueados: false, aprovarAutomaticamente: false, vagas: 100, suspeita: false, membros: 50, agora: AGORA, campanhaSlug: "aulao", campanhaNome: "Aulão" };

  it("regressão: sem regra, sem reserva e sem hook, não lê nada (mesmo com `emitir`)", async () => {
    const chamadas = bancoBloqueados([]);
    const emitir = vi.fn();
    expect(await lerEResponderPedidos(db(), z(), C, { ...base, emitir })).toEqual({ aprovadas: 0, recusadas: 0, leitura: null });
    expect(hoisted.pedidosPendentes).not.toHaveBeenCalled();
    expect(chamadas).toEqual([]);
    expect(emitir).not.toHaveBeenCalled();
  });

  it("hook sem `emitir`: não lê nem marca como visto (o pedido sairia sem ninguém receber)", async () => {
    const chamadas = bancoBloqueados([]);
    expect(await lerEResponderPedidos(db(), z(), C, { ...base, hook: true })).toEqual({ aprovadas: 0, recusadas: 0, leitura: null });
    expect(hoisted.pedidosPendentes).not.toHaveBeenCalled();
    expect(chamadas).toEqual([]);
  });

  it("pendente sem `pedido_em` que volta no mesmo dia (outro `visto_em`): chave nova", async () => {
    const emitidos: EventoHook[] = [];
    hoisted.pedidosPendentes.mockImplementation(async () => [{ telefone: LIVRE, pedidoEm: null }]);
    bancoBloqueados([]);
    await lerEResponderPedidos(db(), z(), C, { ...base, hook: true, emitir: (ev) => emitidos.push(...ev) });
    bancoBloqueados([]);
    await lerEResponderPedidos(db(), z(), C, { ...base, agora: "2026-10-17T15:00:00.000Z", hook: true, emitir: (ev) => emitidos.push(...ev) });
    expect(emitidos).toHaveLength(2);
    expect(emitidos[0].chave).not.toBe(emitidos[1].chave);
    expect(emitidos[0].dados.solicitacoes).toEqual([{ telefone: LIVRE, pedido_em: null }]);
  });

  it("só o hook: lê, registra e emite `pendentes` com os novos, sem decidir nada", async () => {
    const chamadas = bancoBloqueados([BLOQ]);
    hoisted.pedidosPendentes.mockImplementation(async () => [{ telefone: LIVRE, pedidoEm: "2026-10-17T11:00:00.000Z" }, { telefone: BLOQ, pedidoEm: null }]);
    const emitidos: EventoHook[] = [];
    const r = await lerEResponderPedidos(db(), z(), C, { ...base, hook: true, emitir: (ev) => emitidos.push(...ev) });
    expect(hoisted.pedidosPendentes).toHaveBeenCalledTimes(1);
    expect(hoisted.revisarPedidos).not.toHaveBeenCalled();
    expect(chamadas.some((c) => c.tabela === "bloqueados_efetivos")).toBe(false);
    expect(vistosEscritos(chamadas).map((c) => c.op)).toEqual(["upsert"]);
    expect(r).toMatchObject({ aprovadas: 0, recusadas: 0 });
    expect(emitidos).toHaveLength(1);
    expect(emitidos[0]).toMatchObject({ evento: "solicitacoes_entrada", campanhaId: CAMP, dados: { tipo: "pendentes", campanha: "aulao", campanha_nome: "Aulão", grupo_id: G1, grupo: "Turma 01", group_id: "g1@g.us", total: 2 } });
    expect((emitidos[0].dados.solicitacoes as unknown[])).toEqual([{ telefone: LIVRE, pedido_em: "2026-10-17T11:00:00.000Z" }, { telefone: BLOQ, pedido_em: null }]);
    expect(emitidos[0].chave).toMatch(/^solicitacoes:pendentes:44444444-4444-4444-4444-444444444444:[0-9a-f]{16}$/);
  });

  it("decisões automáticas viram `decisao` (origem automática, com o motivo); bloqueado recusado também", async () => {
    bancoBloqueados([BLOQ]);
    hoisted.pedidosPendentes.mockImplementation(async () => [{ telefone: LIVRE, pedidoEm: null }, { telefone: BLOQ, pedidoEm: null }]);
    const emitidos: EventoHook[] = [];
    await lerEResponderPedidos(db(), z(), C, { ...base, recusarBloqueados: true, aprovarAutomaticamente: true, hook: true, emitir: (ev) => emitidos.push(...ev) });
    const decisao = emitidos.find((e) => e.dados.tipo === "decisao")!;
    expect(decisao.dados.solicitacoes).toEqual([
      // Na ordem do telefone (o mesmo lote dá sempre a mesma chave).
      { telefone: LIVRE, pedido_em: null, decisao: "aprovada", origem: "automatica", motivo: "Aprovação automática" },
      { telefone: BLOQ, pedido_em: null, decisao: "recusada", origem: "automatica", motivo: "Bloqueado" },
    ]);
  });

  it("`emitir` que lança não muda o resultado (nem o que foi decidido e gravado)", async () => {
    const semEmitir = bancoBloqueados([BLOQ]);
    hoisted.pedidosPendentes.mockImplementation(async () => [{ telefone: LIVRE, pedidoEm: null }, { telefone: BLOQ, pedidoEm: null }]);
    const r1 = await lerEResponderPedidos(db(), z(), C, { ...base, recusarBloqueados: true, aprovarAutomaticamente: true });
    const comEmitir = bancoBloqueados([BLOQ]);
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r2 = await lerEResponderPedidos(db(), z(), C, { ...base, recusarBloqueados: true, aprovarAutomaticamente: true, hook: true, emitir: () => { throw new Error("fora do ar"); } });
    erro.mockRestore();
    expect(r2).toEqual(r1);
    expect(comEmitir.map((c) => [c.tabela, c.op])).toEqual(semEmitir.map((c) => [c.tabela, c.op]));
  });
});

describe("decidirPedidos: decisões pro Hook (Etapa 3N, Tarefa 3)", () => {
  it("devolve uma decisão por linha `ok` (expirada quando o pedido já não existia); erros não entram", async () => {
    bancoBloqueados([BLOQ]);
    const r = await decidirPedidos(hoisted.adminAtual as never, z(), C, { campanhaId: CAMP, grupo, telefones: [LIVRE, BLOQ], decisao: "aprovada", origem: "manual", usuario: "u1", pedidoEm: { [LIVRE]: "2026-10-17T11:00:00.000Z" } });
    expect(r.decisoes).toEqual([{ telefone: LIVRE, pedidoEm: "2026-10-17T11:00:00.000Z", decisao: "aprovada", origem: "manual", motivo: null }]);
    hoisted.revisarPedidos.mockImplementation(async () => {
      throw Object.assign(new Error("HTTP 404"), { status: 404 });
    });
    const r2 = await decidirPedidos(hoisted.adminAtual as never, z(), C, { campanhaId: CAMP, grupo, telefones: [LIVRE], decisao: "recusada", origem: "manual", usuario: "u1" });
    expect(r2.decisoes).toEqual([{ telefone: LIVRE, pedidoEm: null, decisao: "expirada", origem: "manual", motivo: "O pedido já não existia no WhatsApp" }]);
  });
});

describe("expirarVistos: Hook `decisao` (Etapa 3N, Tarefa 3)", () => {
  const linhasVistas = [
    { grupo_id: G1, campanha_id: CAMP, telefone: LIVRE, pedido_em: null, visto_em: "2026-10-14T10:00:00.000Z", grupos: { nome: "Turma 01", group_id: "g1@g.us" }, campanhas: { slug: "aulao", nome: "Aulão" } },
    { grupo_id: G1, campanha_id: CAMP, telefone: "5511" + "900000002", pedido_em: null, visto_em: "2026-10-14T10:00:00.000Z", grupos: { nome: "Turma 01", group_id: "g1@g.us" }, campanhas: { slug: "aulao", nome: "Aulão" } },
  ];
  const montarExpirar = () =>
    usar((c) => {
      if (c.tabela === "solicitacoes_vistas" && c.op === "select") return { data: linhasVistas };
      if (c.tabela === "participantes") return { data: [{ telefone: LIVRE, entrou_em: "2026-10-14T11:00:00.000Z" }] };
      return {};
    });

  it("emite as expiradas (e as aprovadas pelo celular) por grupo, depois do Histórico; sem `emitir`, as mesmas chamadas", async () => {
    const sem = montarExpirar();
    await expirarVistos(hoisted.adminAtual as never, AGORA);
    const com = montarExpirar();
    const emitidos: EventoHook[] = [];
    expect(await expirarVistos(hoisted.adminAtual as never, AGORA, (ev) => emitidos.push(...ev))).toBe(2);
    expect(com.map((c) => [c.tabela, c.op])).toEqual(sem.map((c) => [c.tabela, c.op]));
    expect(emitidos).toHaveLength(1);
    expect(emitidos[0].dados).toMatchObject({ tipo: "decisao", campanha: "aulao", campanha_nome: "Aulão", grupo: "Turma 01", group_id: "g1@g.us", total: 2 });
    expect(emitidos[0].dados.solicitacoes).toEqual([
      { telefone: LIVRE, pedido_em: null, decisao: "aprovada", origem: "whatsapp", motivo: "Aprovada pelo celular" },
      { telefone: "5511" + "900000002", pedido_em: null, decisao: "expirada", origem: "whatsapp", motivo: "Sem leitura há 48 horas" },
    ]);
  });

  it("`emitir` que lança: expira do mesmo jeito", async () => {
    montarExpirar();
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await expirarVistos(hoisted.adminAtual as never, AGORA, () => { throw new Error("x"); })).toBe(2);
    erro.mockRestore();
  });
});

describe("telas: Hook das solicitações (Etapa 3N, Tarefa 3)", () => {
  const grupoLinha = (id: string, n: number) => ({ id, group_id: `${n}@g.us`, nome: `Turma ${n}`, numero: n, conexao_id: "con1", conexoes: { id: "con1", status: "conectado" } });
  const linhaGrupo = (id: string) => ({ id, group_id: `${id}@g.us`, nome: "Turma", participantes: 10, cheio: false, conexoes: { id: "con1", status: "conectado" }, campanhas: { limite_por_grupo: 1000 } });
  function banco(o: { webhooks?: unknown[]; falharSaida?: boolean } = {}) {
    return bancoBloqueados([], [], (c) => {
      if (c.tabela === "grupos" && c.filtros.some((f) => f[0] === "limit")) return { data: [grupoLinha(G1, 2)] };
      if (c.tabela === "grupos") return { data: [linhaGrupo(G1)] };
      if (c.tabela === "webhooks") return { data: o.webhooks ?? [] };
      if (c.tabela === "campanhas") return { data: { slug: "aulao", nome: "Aulão" } };
      if (c.tabela === "eventos_saida" && o.falharSaida) return { error: { message: "fora do ar" } };
      return undefined;
    });
  }

  it("listarPendentes com Hook assinado: enfileira `pendentes` com os novos (uma leitura de webhooks)", async () => {
    const chamadas = banco({ webhooks: [HOOK_SOLIC, HOOK_ANTIGO] });
    hoisted.pedidosPendentes.mockImplementation(async () => [{ telefone: LIVRE, pedidoEm: null }]);
    await listarPendentes(CAMP);
    const ls = saidas(chamadas);
    expect(ls.map((l) => [l.webhook_id, l.payload.tipo])).toEqual([["w-solic", "pendentes"]]);
    expect(ls[0].chave).toMatch(/^solicitacoes:pendentes:/);
    expect(ls[0].payload).toMatchObject({ evento: "solicitacoes_entrada", campanha: "aulao", total: 1 });
    expect(chamadas.filter((c) => c.tabela === "webhooks")).toHaveLength(1);
  });

  it("listarPendentes sem Hook assinado (só o antigo) e sem regra: só lê as regras da campanha, nada na fila e nenhuma escrita", async () => {
    const chamadas = banco({ webhooks: [HOOK_ANTIGO] });
    hoisted.pedidosPendentes.mockImplementation(async () => [{ telefone: LIVRE, pedidoEm: null }]);
    await listarPendentes(CAMP);
    expect(saidas(chamadas)).toEqual([]);
    expect(chamadas.filter((c) => c.tabela === "campanhas")).toHaveLength(1);
    expect(chamadas.filter((c) => c.op !== "select")).toEqual([]);
  });

  it("listarPendentes: erro no enfileirar não muda a resposta", async () => {
    hoisted.pedidosPendentes.mockImplementation(async () => [{ telefone: LIVRE, pedidoEm: null }]);
    banco({ webhooks: [HOOK_SOLIC] });
    const ok = await listarPendentes(CAMP);
    banco({ webhooks: [HOOK_SOLIC], falharSaida: true });
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const falhou = await listarPendentes(CAMP);
    expect(erro).toHaveBeenCalled();
    erro.mockRestore();
    expect(falhou).toEqual(ok);
  });

  it("aprovar/recusar: enfileira `decisao` (origem manual); erro no enfileirar não muda a resposta", async () => {
    const chamadas = banco({ webhooks: [HOOK_SOLIC] });
    const r1 = await aprovarSelecionadas(CAMP, [{ grupoId: G1, telefone: LIVRE }]);
    expect(saidas(chamadas).map((l) => [l.payload.tipo, l.payload.solicitacoes])).toEqual([["decisao", [{ telefone: LIVRE, pedido_em: null, decisao: "aprovada", origem: "manual" }]]]);
    banco({ webhooks: [HOOK_SOLIC], falharSaida: true });
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await aprovarSelecionadas(CAMP, [{ grupoId: G1, telefone: LIVRE }])).toEqual(r1);
    banco({ webhooks: [HOOK_SOLIC] });
    const r3 = await recusarSelecionadas(CAMP, [{ grupoId: G1, telefone: LIVRE }]);
    banco({ webhooks: [HOOK_SOLIC], falharSaida: true });
    expect(await recusarSelecionadas(CAMP, [{ grupoId: G1, telefone: LIVRE }])).toEqual(r3);
    erro.mockRestore();
  });

  it("enfileirarSolicitacoes nunca lança, nem com a leitura de webhooks quebrando", async () => {
    usar(() => {
      throw new Error("banco fora");
    });
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(enfileirarSolicitacoes(hoisted.adminAtual as never, CAMP, [{ grupo, decisoes: [{ telefone: LIVRE, pedidoEm: null, decisao: "aprovada" }] }])).resolves.toBeUndefined();
    erro.mockRestore();
  });

  it("nada novo nem decidido: não lê nada", async () => {
    const chamadas = usar();
    await enfileirarSolicitacoes(hoisted.adminAtual as never, CAMP, [{ grupo, leitura: { novos: [], fechados: [] }, decisoes: [] }]);
    expect(chamadas).toEqual([]);
  });
});
