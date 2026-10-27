import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, filtro, type Chamada, type Resposta } from "./apoio/db-falso";
import { liberarTudo, SEM_PERMISSAO, usarMembro } from "./apoio/permissoes";

const hoisted = vi.hoisted(() => ({ dbAtual: undefined as unknown, historico: vi.fn() }));

vi.mock("@/src/lib/permissoes", async () => (await import("./apoio/permissoes")).permissoesFalsas());
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => hoisted.dbAtual }));
vi.mock("@/src/lib/supabase/usuario", () => ({ exigirUsuario: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/src/lib/historico", () => ({ registrarHistorico: hoisted.historico }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { criarAcao, dadosDaCampanhaAcao, listarGruposAcao } from "@/app/(painel)/acoes/actions";
import type { EntradaAcao } from "@/src/lib/regras/assistente-acao";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const D = "33333333-3333-3333-3333-333333333333";
const P = "44444444-4444-4444-4444-444444444444";
const G1 = "55555555-5555-5555-5555-555555555551";
const G2 = "55555555-5555-5555-5555-555555555552";
const K1 = "66666666-6666-6666-6666-666666666661";
const K2 = "66666666-6666-6666-6666-666666666662";

type Camp = { id: string; arquivada: boolean; projeto_id?: string | null; conexao_criadora_id?: string | null };

/** Banco com campanhas, grupos (id → campanha/conta), contas associadas e projeto. */
function banco(campanhas: Camp[], extra: { grupos?: { id: string; campanha_id: string; conexao_id: string }[]; associadas?: Record<string, string[]>; projeto?: { id: string; arquivado: boolean } | null } = {}) {
  let n = 0;
  return dbFalso((c: Chamada): Resposta => {
    const eqId = filtro(c, "eq", "id");
    const inId = filtro(c, "in", "id") as string[] | undefined;
    if (c.tabela === "campanhas" && c.op === "select") {
      if (inId) return { data: campanhas.filter((x) => inId.includes(x.id)) };
      if (eqId) return { data: campanhas.find((x) => x.id === eqId) ?? null };
      const proj = filtro(c, "eq", "projeto_id");
      if (proj) return { data: campanhas.filter((x) => x.projeto_id === proj && !x.arquivada).map((x) => ({ id: x.id })) };
    }
    if (c.tabela === "projetos") return { data: extra.projeto ?? null };
    if (c.tabela === "campanha_conexoes") return { data: (extra.associadas?.[filtro(c, "eq", "campanha_id") as string] ?? []).map((k) => ({ conexao_id: k })) };
    if (c.tabela === "grupos") {
      const camp = filtro(c, "eq", "campanha_id");
      const doCamp = (extra.grupos ?? []).filter((g) => g.campanha_id === camp);
      return { data: inId ? doCamp.filter((g) => inId.includes(g.id)) : doCamp };
    }
    if (c.tabela === "conexoes") return { data: (inId ?? []).map((id) => ({ id, nome: id.slice(-1), telefone: null, status: "conectado" })) };
    if (c.tabela === "execucoes" && c.op === "insert") return { data: (c.dados as unknown[]).map(() => ({ id: `e${++n}` })) };
    return {};
  });
}

const entrada = (p: Partial<EntradaAcao> = {}): EntradaAcao => ({
  categoria: "campanha",
  campanhas: [A],
  projetoId: null,
  tipo: "abrir",
  contas: null,
  grupos: null,
  conteudo: {},
  importante: false,
  quando: "agora",
  ...p,
});

const insercao = (chamadas: Chamada[]) => chamadas.find((c) => c.tabela === "execucoes" && c.op === "insert");

beforeEach(() => {
  vi.clearAllMocks();
  liberarTudo();
});

describe("criarAcao", () => {
  it("uma execução avulsa por campanha, com alvo null = todas/todos, e histórico em Ações", async () => {
    const { db, chamadas } = banco([{ id: A, arquivada: false }, { id: B, arquivada: false }]);
    hoisted.dbAtual = db;
    const r = await criarAcao(entrada({ campanhas: [A, B], tipo: "nome", conteudo: { padrao: "Aula {n}" } }));
    expect(r).toEqual({ ok: true, ids: ["e1", "e2"] });
    const linhas = insercao(chamadas)!.dados as Record<string, unknown>[];
    expect(linhas).toHaveLength(2);
    expect(linhas.map((l) => l.campanha_id)).toEqual([A, B]);
    expect(linhas[0]).toMatchObject({ origem: "avulsa", tipo: "nome", conteudo: { padrao: "Aula {n}" }, alvo_contas: null, alvo_grupos: null, importante: false, criada_por: "u1" });
    expect(linhas[0].agendada_para).toBe(linhas[1].agendada_para);
    expect(hoisted.historico).toHaveBeenCalledWith(expect.objectContaining({ id: "u1" }), expect.objectContaining({ acao: "adicionar", area: "Ações", resumo: "Trocar nome em 2 campanhas, agora" }));
  });

  it("mensagem v2 importante e agendada", async () => {
    const { db, chamadas } = banco([{ id: A, arquivada: false }]);
    hoisted.dbAtual = db;
    const conteudo = { versao: 2, mensagens: [{ formato: "texto", texto: "Oi" }], opcoes: { mencionar_todos: false, temporarias: "nao", fixar: "nao", intervalo_grupos: "nao", intervalo_mensagens: false } };
    const r = await criarAcao(entrada({ tipo: "mensagem", conteudo, importante: true, quando: "2099-01-01T10:00" }));
    expect("ok" in r).toBe(true);
    expect(insercao(chamadas)!.dados).toEqual([expect.objectContaining({ tipo: "mensagem", importante: true, agendada_para: "2099-01-01T13:00:00.000Z" })]);
    expect(hoisted.historico).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ resumo: "Enviar mensagem em 1 campanha, agendada" }));
  });

  it("recusa campanha arquivada e campanha que não existe, sem gravar", async () => {
    const { db, chamadas } = banco([{ id: A, arquivada: true }, { id: B, arquivada: false }]);
    hoisted.dbAtual = db;
    expect(await criarAcao(entrada({ campanhas: [A, B] }))).toEqual({ erro: "Campanha arquivada não recebe ação." });
    expect(await criarAcao(entrada({ campanhas: [B, D] }))).toEqual({ erro: "Campanha não encontrada." });
    expect(insercao(chamadas)).toBeUndefined();
    expect(hoisted.historico).not.toHaveBeenCalled();
  });

  it("valida o formato antes do banco", async () => {
    const { db, chamadas } = banco([]);
    hoisted.dbAtual = db;
    expect(await criarAcao(entrada({ tipo: "admin_add", conteudo: { telefone: "12" } }))).toEqual({ erro: "Telefone inválido: use DDD + número." });
    expect(await criarAcao(entrada({ quando: "2000-01-01T10:00" }))).toEqual({ erro: "Esse horário já passou." });
    expect(await criarAcao(entrada({ campanhas: [A, B], contas: [K1] }))).toEqual({ erro: "Conexões e grupos específicos só valem com uma campanha." });
    expect(chamadas).toHaveLength(0);
  });

  it("conexões e grupos específicos: têm que ser da campanha e combinar entre si", async () => {
    const grupos = [{ id: G1, campanha_id: A, conexao_id: K1 }, { id: G2, campanha_id: A, conexao_id: K2 }];
    const { db, chamadas } = banco([{ id: A, arquivada: false }], { grupos, associadas: { [A]: [K1] } });
    hoisted.dbAtual = db;
    expect(await criarAcao(entrada({ contas: [D] }))).toEqual({ erro: "Conexão escolhida não é desta campanha." });
    expect(await criarAcao(entrada({ grupos: [G1, D] }))).toEqual({ erro: "Grupo escolhido não é desta campanha." });
    expect(await criarAcao(entrada({ contas: [K1], grupos: [G2] }))).toEqual({ erro: "Grupo escolhido não é de uma das conexões escolhidas." });
    expect(insercao(chamadas)).toBeUndefined();
    // K2 só tem grupo (não está associada): conta mesmo assim.
    const r = await criarAcao(entrada({ contas: [K1, K2], grupos: [G1, G2] }));
    expect("ok" in r).toBe(true);
    expect(insercao(chamadas)!.dados).toEqual([expect.objectContaining({ alvo_contas: [K1, K2], alvo_grupos: [G1, G2] })]);
  });

  it("importante é sempre falso quando a ação tem conexão ou grupo específico como alvo (defesa de servidor)", async () => {
    const grupos = [{ id: G1, campanha_id: A, conexao_id: K1 }];
    const conteudo = { versao: 2, mensagens: [{ formato: "texto", texto: "Oi" }], opcoes: { mencionar_todos: false, temporarias: "nao", fixar: "nao", intervalo_grupos: "nao", intervalo_mensagens: false } };
    const { db: db1, chamadas: ch1 } = banco([{ id: A, arquivada: false }], { grupos, associadas: { [A]: [K1] } });
    hoisted.dbAtual = db1;
    const r1 = await criarAcao(entrada({ tipo: "mensagem", conteudo, importante: true, contas: [K1] }));
    expect("ok" in r1).toBe(true);
    expect(insercao(ch1)!.dados).toEqual([expect.objectContaining({ importante: false, alvo_contas: [K1] })]);

    const { db: db2, chamadas: ch2 } = banco([{ id: A, arquivada: false }], { grupos, associadas: { [A]: [K1] } });
    hoisted.dbAtual = db2;
    const r2 = await criarAcao(entrada({ tipo: "mensagem", conteudo, importante: true, grupos: [G1] }));
    expect("ok" in r2).toBe(true);
    expect(insercao(ch2)!.dados).toEqual([expect.objectContaining({ importante: false, alvo_grupos: [G1] })]);

    // Sem alvo específico (todas as contas/todos os grupos): "importante" passa normalmente.
    const { db: db3, chamadas: ch3 } = banco([{ id: A, arquivada: false }]);
    hoisted.dbAtual = db3;
    const r3 = await criarAcao(entrada({ tipo: "mensagem", conteudo, importante: true }));
    expect("ok" in r3).toBe(true);
    expect(insercao(ch3)!.dados).toEqual([expect.objectContaining({ importante: true, alvo_contas: null, alvo_grupos: null })]);
  });

  it("confere campanhas e grupos em lotes de 150 (uma lista de ids grande não estoura a URL)", async () => {
    const muitasCampanhas = Array.from({ length: 170 }, (_, i) => `aaaaaaaa-aaaa-aaaa-aaaa-${String(i).padStart(12, "0")}`);
    const { db, chamadas } = banco(muitasCampanhas.map((id) => ({ id, arquivada: false })));
    hoisted.dbAtual = db;
    const r = await criarAcao(entrada({ campanhas: muitasCampanhas, tipo: "fechar" }));
    expect(r).toEqual({ ok: true, ids: muitasCampanhas.map((_, i) => `e${i + 1}`) });
    const chamadasCampanhas = chamadas.filter((c) => c.tabela === "campanhas" && c.op === "select");
    expect(chamadasCampanhas).toHaveLength(2);
    expect((filtro(chamadasCampanhas[0], "in", "id") as string[]).length).toBe(150);
    expect((filtro(chamadasCampanhas[1], "in", "id") as string[]).length).toBe(20);

    const muitosGrupos = Array.from({ length: 160 }, (_, i) => `bbbbbbbb-bbbb-bbbb-bbbb-${String(i).padStart(12, "0")}`);
    const grupos = muitosGrupos.map((id) => ({ id, campanha_id: A, conexao_id: K1 }));
    const { db: db2, chamadas: chamadas2 } = banco([{ id: A, arquivada: false }], { grupos, associadas: { [A]: [K1] } });
    hoisted.dbAtual = db2;
    const r2 = await criarAcao(entrada({ contas: [K1], grupos: muitosGrupos }));
    expect("ok" in r2).toBe(true);
    const chamadasGrupos = chamadas2.filter((c) => c.tabela === "grupos" && c.op === "select" && filtro(c, "in", "id") !== undefined);
    expect(chamadasGrupos).toHaveLength(2);
    expect((filtro(chamadasGrupos[0], "in", "id") as string[]).length).toBe(150);
    expect((filtro(chamadasGrupos[1], "in", "id") as string[]).length).toBe(10);
  });

  it("projeto: todas as campanhas ativas dele", async () => {
    const { db, chamadas } = banco(
      [{ id: A, arquivada: false, projeto_id: P }, { id: B, arquivada: true, projeto_id: P }, { id: D, arquivada: false, projeto_id: P }],
      { projeto: { id: P, arquivado: false } },
    );
    hoisted.dbAtual = db;
    const r = await criarAcao(entrada({ categoria: "projeto", campanhas: [], projetoId: P, tipo: "fechar" }));
    expect(r).toEqual({ ok: true, ids: ["e1", "e2"] });
    expect((insercao(chamadas)!.dados as { campanha_id: string }[]).map((l) => l.campanha_id)).toEqual([A, D]);
  });

  it("projeto arquivado ou sem campanhas ativas", async () => {
    hoisted.dbAtual = banco([], { projeto: { id: P, arquivado: true } }).db;
    expect(await criarAcao(entrada({ categoria: "projeto", campanhas: [], projetoId: P }))).toEqual({ erro: "Projeto arquivado." });
    hoisted.dbAtual = banco([{ id: A, arquivada: true, projeto_id: P }], { projeto: { id: P, arquivado: false } }).db;
    expect(await criarAcao(entrada({ categoria: "projeto", campanhas: [], projetoId: P }))).toEqual({ erro: "Esse projeto não tem campanhas ativas." });
  });

  it("mover grupos: destino existe, não está arquivado", async () => {
    hoisted.dbAtual = banco([{ id: A, arquivada: false }, { id: B, arquivada: true }]).db;
    expect(await criarAcao(entrada({ tipo: "mover_grupos", conteudo: { campanha_destino: B } }))).toEqual({ erro: "Campanha de destino está arquivada." });
    expect(await criarAcao(entrada({ tipo: "mover_grupos", conteudo: { campanha_destino: D } }))).toEqual({ erro: "Campanha de destino não encontrada." });
    expect(await criarAcao(entrada({ tipo: "mover_grupos", conteudo: { campanha_destino: A } }))).toEqual({ erro: "A campanha de destino não pode ser uma das campanhas da ação." });
  });

  it("sem campanhas/editar: recusa sem tocar no banco", async () => {
    const { db, chamadas } = banco([{ id: A, arquivada: false }]);
    hoisted.dbAtual = db;
    usarMembro({ papel: "membro", permissoes: { campanhas: "ver" } });
    expect(await criarAcao(entrada())).toEqual({ erro: SEM_PERMISSAO });
    expect(await dadosDaCampanhaAcao(A)).toEqual({ erro: SEM_PERMISSAO });
    expect(await listarGruposAcao(A, {})).toEqual({ erro: SEM_PERMISSAO });
    expect(chamadas).toHaveLength(0);
  });
});

describe("carregadores do assistente", () => {
  it("dadosDaCampanhaAcao junta associadas, criadora e donas de grupo; recusa arquivada", async () => {
    const grupos = [{ id: G1, campanha_id: A, conexao_id: K2 }];
    hoisted.dbAtual = banco([{ id: A, arquivada: false, conexao_criadora_id: D }], { grupos, associadas: { [A]: [K1] } }).db;
    const r = await dadosDaCampanhaAcao(A);
    expect("contas" in r && r.contas.map((c) => c.id).sort()).toEqual([D, K1, K2].sort());
    hoisted.dbAtual = banco([{ id: A, arquivada: true }]).db;
    expect(await dadosDaCampanhaAcao(A)).toEqual({ erro: "Campanha arquivada." });
    expect(await dadosDaCampanhaAcao("x")).toEqual({ erro: "Campanha inválida." });
  });

  it("listarGruposAcao pagina de 50, busca escapada e filtra pelas conexões", async () => {
    const { db, chamadas } = banco([{ id: A, arquivada: false }], { grupos: [{ id: G1, campanha_id: A, conexao_id: K1 }] });
    hoisted.dbAtual = db;
    const r = await listarGruposAcao(A, { busca: " 10%_ ", pagina: 3, contas: [K1, "x"] });
    expect("grupos" in r && r.porPagina).toBe(50);
    const c = chamadas.find((x) => x.tabela === "grupos")!;
    expect(filtro(c, "ilike", "nome")).toBe("%10\\%\\_%");
    expect(filtro(c, "in", "conexao_id")).toEqual([K1]);
    expect(filtro(c, "eq", "ativo")).toBe(true);
    expect(c.filtros.find((f) => f[0] === "range")).toEqual(["range", 100, 149]);
  });
});
