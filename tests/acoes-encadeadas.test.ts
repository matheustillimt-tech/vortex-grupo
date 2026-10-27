import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, filtro, type Chamada, type Resposta } from "./apoio/db-falso";
import { liberarTudo } from "./apoio/permissoes";

const hoisted = vi.hoisted(() => ({ dbAtual: undefined as unknown, historico: vi.fn(), alertar: vi.fn(async () => undefined) }));

vi.mock("@/src/lib/permissoes", async () => (await import("./apoio/permissoes")).permissoesFalsas());
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => hoisted.dbAtual }));
vi.mock("@/src/lib/supabase/usuario", () => ({ exigirUsuario: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/src/lib/historico", () => ({ registrarHistorico: hoisted.historico }));
vi.mock("@/src/lib/jobs/alertas", () => ({ alertar: hoisted.alertar }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { cancelarExecucao } from "@/app/(painel)/_acoes/execucoes";
import { criarAcao } from "@/app/(painel)/acoes/actions";
import { cancelarSeguintes, liberarEncadeadas } from "@/src/lib/jobs/encadeadas";
import { iniciarExecucoesVencidas } from "@/src/lib/jobs/execucoes";
import { entradaAcaoDaApi } from "@/src/lib/regras/api";
import {
  estadoAcaoInicial,
  listaDeAcoes,
  montarEntradaAcao,
  novaSeguinte,
  pendenciaDoPassoAcao,
  validarEntradaAcao,
  type EntradaAcao,
  type EstadoAcao,
} from "@/src/lib/regras/assistente-acao";
import { decidirEncadeada, MOTIVO_ANTERIOR_BLOQUEADA, MOTIVO_ANTERIOR_CANCELADA, MOTIVO_ANTERIOR_PULADA } from "@/src/lib/regras/encadeadas";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const D = "33333333-3333-3333-3333-333333333333";
const AGORA = new Date("2026-10-17T12:00:00.000Z");
const MSG = { versao: 2, mensagens: [{ formato: "texto", texto: "Oi" }], opcoes: { mencionar_todos: false, temporarias: "nao", fixar: "nao", intervalo_grupos: "nao", intervalo_mensagens: false } };

beforeEach(() => {
  vi.clearAllMocks();
  liberarTudo();
});

function bancoCriar() {
  return dbFalso((c: Chamada): Resposta => {
    const inId = filtro(c, "in", "id") as string[] | undefined;
    const eqId = filtro(c, "eq", "id") as string | undefined;
    if (c.tabela === "campanhas" && c.op === "select") {
      if (inId) return { data: inId.map((id) => ({ id, arquivada: false })) };
      if (eqId) return { data: { id: eqId, arquivada: false } };
    }
    if (c.tabela === "execucoes" && c.op === "insert") return { data: (c.dados as { id?: string }[]).map((l, i) => ({ id: l.id ?? `e${i + 1}` })) };
    return {};
  });
}

const entrada = (p: Partial<EntradaAcao> = {}): EntradaAcao => ({
  categoria: "campanha",
  campanhas: [A],
  projetoId: null,
  tipo: "mensagem",
  contas: null,
  grupos: null,
  conteudo: MSG,
  importante: false,
  quando: "agora",
  ...p,
});

describe("criarAcao com ações encadeadas", () => {
  it("um único insert: por campanha, a seguinte n aponta pra execução n-1 da mesma campanha, mesmo horário", async () => {
    const { db, chamadas } = bancoCriar();
    hoisted.dbAtual = db;
    const r = await criarAcao(entrada({ campanhas: [A, B], seguintes: [{ tipo: "fechar", conteudo: {}, importante: false }, { tipo: "nome", conteudo: { padrao: "Aula {n}" }, importante: false }] }));
    const inserts = chamadas.filter((c) => c.tabela === "execucoes" && c.op === "insert");
    expect(inserts).toHaveLength(1);
    const linhas = inserts[0].dados as Record<string, unknown>[];
    expect(linhas).toHaveLength(6);
    expect(linhas.map((l) => [l.campanha_id, l.tipo])).toEqual([[A, "mensagem"], [A, "fechar"], [A, "nome"], [B, "mensagem"], [B, "fechar"], [B, "nome"]]);
    for (const l of linhas) expect(l.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Set(linhas.map((l) => l.id)).size).toBe(6);
    expect(linhas.map((l) => l.depois_de)).toEqual([null, linhas[0].id, linhas[1].id, null, linhas[3].id, linhas[4].id]);
    expect(new Set(linhas.map((l) => l.agendada_para)).size).toBe(1);
    expect(linhas.every((l) => l.origem === "avulsa" && l.alvo_contas === null && l.alvo_grupos === null && l.criada_por === "u1")).toBe(true);
    expect(r).toEqual({ ok: true, ids: linhas.map((l) => l.id) });
    expect(hoisted.historico).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ resumo: "Ação criada com 3 ações encadeadas (Enviar mensagem → Fechar Grupos → Trocar nome) em 2 campanhas, agora" }),
    );
  });

  it("regressão: sem `seguintes`, cria exatamente as mesmas linhas de antes (sem id nem depois_de)", async () => {
    const { db, chamadas } = bancoCriar();
    hoisted.dbAtual = db;
    await criarAcao(entrada({ campanhas: [A, B], importante: true }));
    const linhas = chamadas.find((c) => c.tabela === "execucoes" && c.op === "insert")!.dados as Record<string, unknown>[];
    expect(linhas).toHaveLength(2);
    for (const l of linhas) {
      expect(Object.keys(l).sort()).toEqual(["agendada_para", "alvo_contas", "alvo_grupos", "campanha_id", "conteudo", "criada_por", "importante", "origem", "tipo"]);
    }
    expect(linhas[0]).toMatchObject({ campanha_id: A, tipo: "mensagem", importante: true });
    expect(hoisted.historico).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ resumo: "Enviar mensagem em 2 campanhas, agora" }));
  });

  it("insert falhou: nada criado, erro claro (atômico — um comando só)", async () => {
    const { db } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "campanhas") return { data: [{ id: A, arquivada: false }] };
      if (c.tabela === "execucoes" && c.op === "insert") return { error: { message: "fk" } };
      return {};
    });
    hoisted.dbAtual = db;
    expect(await criarAcao(entrada({ seguintes: [{ tipo: "fechar", conteudo: {}, importante: false }] }))).toEqual({ erro: "Não foi possível salvar." });
    expect(hoisted.historico).not.toHaveBeenCalled();
  });

  it("mover grupos numa ação extra: confere o destino como na principal", async () => {
    const { db, chamadas } = bancoCriar();
    hoisted.dbAtual = db;
    expect(await criarAcao(entrada({ seguintes: [{ tipo: "mover_grupos", conteudo: { campanha_destino: A }, importante: false }] }))).toEqual({
      erro: "Ação 2: A campanha de destino não pode ser uma das campanhas da ação.",
    });
    const r = await criarAcao(entrada({ seguintes: [{ tipo: "mover_grupos", conteudo: { campanha_destino: D }, importante: false }] }));
    expect("ok" in r).toBe(true);
    expect(chamadas.some((c) => c.tabela === "campanhas" && filtro(c, "eq", "id") === D)).toBe(true);
  });

  it("importante de ação extra é sempre falsa (ela só sai depois da anterior terminar)", async () => {
    const { db, chamadas } = bancoCriar();
    hoisted.dbAtual = db;
    await criarAcao(entrada({ importante: true, seguintes: [{ tipo: "mensagem", conteudo: MSG, importante: true }] }));
    const linhas = chamadas.find((c) => c.tabela === "execucoes" && c.op === "insert")!.dados as Record<string, unknown>[];
    expect(linhas.map((l) => l.importante)).toEqual([true, false]);
  });
});

describe("validarEntradaAcao: seguintes", () => {
  const base = { categoria: "campanha", campanhas: [A], projetoId: null, tipo: "abrir", contas: null, grupos: null, conteudo: {}, importante: false, quando: "agora" };

  it("até 4 seguintes (5 ações), cada uma com as regras de tipo e conteúdo da principal; 'importante' sempre falsa", () => {
    const ok = validarEntradaAcao({ ...base, seguintes: [{ tipo: "fechar", conteudo: {} }, { tipo: "mensagem", conteudo: MSG, importante: true }] }, AGORA);
    expect(ok.ok && ok.valor.seguintes).toEqual([
      { tipo: "fechar", conteudo: {}, importante: false },
      { tipo: "mensagem", conteudo: expect.objectContaining({ versao: 2 }), importante: false },
    ]);
    const cinco = Array.from({ length: 5 }, () => ({ tipo: "fechar", conteudo: {} }));
    expect(validarEntradaAcao({ ...base, seguintes: cinco }, AGORA)).toEqual({ ok: false, erro: "No máximo 5 ações por disparo." });
    expect(validarEntradaAcao({ ...base, seguintes: [{ tipo: "enquete", conteudo: {} }] }, AGORA)).toEqual({ ok: false, erro: "Ação 2: Escolha a ação." });
    expect(validarEntradaAcao({ ...base, seguintes: [{ tipo: "fechar", conteudo: {} }, { tipo: "nome", conteudo: { padrao: " " } }] }, AGORA)).toEqual({ ok: false, erro: "Ação 3: Escreva o novo nome." });
    expect(validarEntradaAcao({ ...base, seguintes: "x" }, AGORA)).toEqual({ ok: false, erro: "Lista de ações inválida." });
  });

  it("sem o campo: `seguintes` = [] (ação simples, igual a antes)", () => {
    const r = validarEntradaAcao(base, AGORA);
    expect(r.ok && r.valor.seguintes).toEqual([]);
  });

  it("API v1/MCP: `seguintes` no corpo é ignorado", () => {
    const r = entradaAcaoDaApi({ campanhas: [A], tipo: "abrir", conteudo: {}, seguintes: [{ tipo: "fechar", conteudo: {} }] });
    expect(r.ok && "seguintes" in r.entrada).toBe(false);
  });
});

describe("assistente: ações extras", () => {
  const camp = [{ id: A, nome: "A", descricao: null, projeto_id: null }];
  const estado = (p: Partial<EstadoAcao> = {}): EstadoAcao => ({ ...estadoAcaoInicial(), categoria: "campanha", campanhas: [A], tipo: "mensagem", conteudo: MSG, ...p });

  it("passo Conteúdo confere cada ação extra e diz qual", () => {
    expect(pendenciaDoPassoAcao("conteudo", estado({ seguintes: [novaSeguinte("fechar")] }), camp)).toBeNull();
    expect(pendenciaDoPassoAcao("conteudo", estado({ seguintes: [novaSeguinte("fechar"), novaSeguinte("nome")] }), camp)).toBe("Ação 3: Escreva o novo nome.");
    const remover = { ...novaSeguinte("remover_participantes"), telefonesTexto: "12" };
    expect(pendenciaDoPassoAcao("conteudo", estado({ seguintes: [remover] }), camp)).toBe("Ação 2: Telefone inválido: 12.");
  });

  it("montarEntradaAcao: sem extra, sem o campo; com extras, na ordem e sem a chave da tela", () => {
    expect("seguintes" in montarEntradaAcao(estado(), camp)!).toBe(false);
    const remover = { ...novaSeguinte("remover_participantes"), telefonesTexto: "11 " + "98888-7777" };
    expect(montarEntradaAcao(estado({ seguintes: [novaSeguinte("fechar"), remover] }), camp)!.seguintes).toEqual([
      { tipo: "fechar", conteudo: {}, importante: false },
      { tipo: "remover_participantes", conteudo: { telefones: ["5511" + "988887777"] }, importante: false },
    ]);
  });

  it("lista do Confirmar", () => {
    expect(listaDeAcoes(estado({ seguintes: [novaSeguinte("fechar")] }))).toBe("Ação 1: Enviar mensagem · Ação 2: Fechar Grupos");
  });
});

describe("decidirEncadeada", () => {
  const agendadaPara = "2026-10-17T11:00:00.000Z";
  it("concluída sem pendente: libera com 30 s; com tarefa pendente: espera", () => {
    expect(decidirEncadeada({ statusAnterior: "concluida", anteriorComPendentes: false, agendadaPara }, AGORA)).toEqual({ tipo: "liberar", agendadaPara: "2026-10-17T12:00:30.000Z" });
    expect(decidirEncadeada({ statusAnterior: "concluida", anteriorComPendentes: true, agendadaPara }, AGORA)).toEqual({ tipo: "esperar" });
  });
  it("horário próprio mais tarde continua valendo", () => {
    expect(decidirEncadeada({ statusAnterior: "concluida", anteriorComPendentes: false, agendadaPara: "2026-10-18T00:00:00.000Z" }, AGORA)).toEqual({ tipo: "liberar", agendadaPara: "2026-10-18T00:00:00.000Z" });
  });
  it("agendada/enviando: espera; cancelada/bloqueada/pulada: cancela (a seguinte não sai fora de ordem)", () => {
    expect(decidirEncadeada({ statusAnterior: "agendada", anteriorComPendentes: false, agendadaPara }, AGORA)).toEqual({ tipo: "esperar" });
    expect(decidirEncadeada({ statusAnterior: "enviando", anteriorComPendentes: false, agendadaPara }, AGORA)).toEqual({ tipo: "esperar" });
    expect(decidirEncadeada({ statusAnterior: "cancelada", anteriorComPendentes: false, agendadaPara }, AGORA)).toEqual({ tipo: "cancelar", motivo: MOTIVO_ANTERIOR_CANCELADA });
    expect(decidirEncadeada({ statusAnterior: "bloqueada", anteriorComPendentes: false, agendadaPara }, AGORA)).toEqual({ tipo: "cancelar", motivo: MOTIVO_ANTERIOR_BLOQUEADA });
    expect(decidirEncadeada({ statusAnterior: "pulada", anteriorComPendentes: false, agendadaPara }, AGORA)).toEqual({ tipo: "cancelar", motivo: MOTIVO_ANTERIOR_PULADA });
  });
});

describe("liberarEncadeadas (passo encadeadas do tick)", () => {
  const P = "2026-10-17T11:00:00.000Z";
  function banco(anteriores: Record<string, string>, pendentes: string[] = []) {
    return dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "execucoes" && c.op === "select" && filtro(c, "eq", "status") === "agendada") {
        return { data: Object.keys(anteriores).map((ant, i) => ({ id: `s${i + 1}`, depois_de: ant, agendada_para: P })) };
      }
      if (c.tabela === "execucoes" && c.op === "select") return { data: (filtro(c, "in", "id") as string[]).map((id) => ({ id, status: anteriores[id] })) };
      if (c.tabela === "tarefas") return { data: pendentes.map((execucao_id) => ({ execucao_id })) };
      if (c.tabela === "execucoes" && c.op === "update") return { data: [{ id: filtro(c, "eq", "id") }] };
      return {};
    });
  }

  it("só olha agendadas com depois_de; anterior agendada/enviando: não mexe", async () => {
    const { db, chamadas } = banco({ a1: "agendada", a2: "enviando" });
    expect(await liberarEncadeadas(AGORA, db)).toBe(0);
    const leitura = chamadas[0];
    expect(filtro(leitura, "eq", "status")).toBe("agendada");
    expect(leitura.filtros).toContainEqual(["not", "depois_de", "is", null]);
    expect(chamadas.some((c) => c.op === "update")).toBe(false);
  });

  it("anterior concluída: solta (depois_de null) com 30 s, com a trava de status e da mesma anterior", async () => {
    const { db, chamadas } = banco({ a1: "concluida" });
    expect(await liberarEncadeadas(AGORA, db)).toBe(1);
    const up = chamadas.find((c) => c.op === "update")!;
    expect(up.dados).toEqual({ depois_de: null, agendada_para: "2026-10-17T12:00:30.000Z" });
    expect(filtro(up, "eq", "id")).toBe("s1");
    expect(filtro(up, "eq", "status")).toBe("agendada");
    expect(filtro(up, "eq", "depois_de")).toBe("a1");
  });

  it("anterior concluída mas com tarefa ainda na fila/processando: espera", async () => {
    const { db, chamadas } = banco({ a1: "concluida" }, ["a1"]);
    expect(await liberarEncadeadas(AGORA, db)).toBe(0);
    const t = chamadas.find((c) => c.tabela === "tarefas")!;
    expect(filtro(t, "in", "status")).toEqual(["fila", "processando"]);
    expect(chamadas.some((c) => c.op === "update")).toBe(false);
  });

  it("anterior cancelada, bloqueada ou pulada: a seguinte vira cancelada", async () => {
    const { db, chamadas } = banco({ a1: "cancelada", a2: "bloqueada", a3: "pulada" });
    expect(await liberarEncadeadas(AGORA, db)).toBe(3);
    expect(chamadas.filter((c) => c.op === "update").map((c) => c.dados)).toEqual([
      { status: "cancelada", motivo: MOTIVO_ANTERIOR_CANCELADA },
      { status: "cancelada", motivo: MOTIVO_ANTERIOR_BLOQUEADA },
      { status: "cancelada", motivo: MOTIVO_ANTERIOR_PULADA },
    ]);
  });

  it("outro tick já mexeu (update não pega linha): não conexão", async () => {
    const { db } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "execucoes" && c.op === "select" && filtro(c, "eq", "status") === "agendada") return { data: [{ id: "s1", depois_de: "a1", agendada_para: P }] };
      if (c.tabela === "execucoes" && c.op === "select") return { data: [{ id: "a1", status: "pulada" }] };
      return { data: [] };
    });
    expect(await liberarEncadeadas(AGORA, db)).toBe(0);
  });
});

describe("iniciarExecucoesVencidas não pega encadeada que espera", () => {
  it("o update agendada → enviando tem `depois_de is null`", async () => {
    const { db, chamadas } = dbFalso(() => ({ data: [] }));
    hoisted.dbAtual = db;
    await iniciarExecucoesVencidas(AGORA);
    const up = chamadas.find((c) => c.tabela === "execucoes" && c.op === "update")!;
    expect(up.dados).toMatchObject({ status: "enviando" });
    expect(up.filtros).toContainEqual(["is", "depois_de", null]);
    expect(filtro(up, "eq", "status")).toBe("agendada");
  });
});

describe("cancelamento em cascata", () => {
  it("cancelarSeguintes desce a corrente até 4 níveis, só nas agendadas", async () => {
    let nivel = 0;
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => (c.op === "update" ? { data: [{ id: `n${++nivel}` }] } : {}));
    expect(await cancelarSeguintes(["e0"], MOTIVO_ANTERIOR_CANCELADA, db)).toEqual(["n1", "n2", "n3", "n4"]);
    const ups = chamadas.filter((c) => c.op === "update");
    expect(ups.map((c) => filtro(c, "in", "depois_de"))).toEqual([["e0"], ["n1"], ["n2"], ["n3"]]);
    for (const u of ups) {
      expect(filtro(u, "eq", "status")).toBe("agendada");
      expect(u.dados).toEqual({ status: "cancelada", motivo: MOTIVO_ANTERIOR_CANCELADA });
    }
  });

  it("para quando não há mais seguinte", async () => {
    const { db, chamadas } = dbFalso(() => ({ data: [] }));
    expect(await cancelarSeguintes(["e0"], MOTIVO_ANTERIOR_CANCELADA, db)).toEqual([]);
    expect(chamadas).toHaveLength(1);
  });

  it("cancelarExecucao cancela a ação e as seguintes dela", async () => {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.op !== "update") return {};
      if (filtro(c, "eq", "id")) return { data: [{ id: "e0" }] };
      return { data: filtro(c, "in", "depois_de")?.toString() === "e0" ? [{ id: "e1" }] : [] };
    });
    hoisted.dbAtual = db;
    await cancelarExecucao("e0", A);
    expect(chamadas.filter((c) => c.op === "update").map((c) => filtro(c, "eq", "id") ?? filtro(c, "in", "depois_de"))).toEqual(["e0", ["e0"], ["e1"]]);
  });
});

describe("tick", () => {
  it("o passo encadeadas roda antes de execucoes", () => {
    const tick = readFileSync(path.join(__dirname, "..", "app/api/cron/tick/route.ts"), "utf8");
    expect(tick.indexOf('passo("encadeadas"')).toBeGreaterThan(-1);
    expect(tick.indexOf('passo("encadeadas"')).toBeLessThan(tick.indexOf('passo("execucoes"'));
  });
});
