import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  dbAtual: undefined as unknown,
  zapbotFake: {
    criarGrupo: vi.fn(async () => "120@g.us"),
    participantes: vi.fn(async () => undefined),
    configurarGrupo: vi.fn(async () => undefined),
    criarComunidade: vi.fn(async () => "999@g.us"),
    ligarGrupo: vi.fn(async () => undefined),
    linkConvite: vi.fn(async () => "https://chat.whatsapp.com/X"),
  },
  criarGatilhosGrupoNovoMock: vi.fn(async () => 4),
  dispararAutomacoesMock: vi.fn(async () => 0),
  alertarMock: vi.fn(async (_a: unknown) => undefined),
}));

vi.mock("@/src/lib/jobs/alertas", () => ({
  alertar: hoisted.alertarMock,
}));

vi.mock("@/src/lib/supabase/admin", () => ({
  dbAdmin: () => hoisted.dbAtual,
}));

vi.mock("@/src/lib/zapbot/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/src/lib/zapbot/client")>();
  return { ...real, zapbot: () => hoisted.zapbotFake };
});

vi.mock("@/src/lib/conexoes", () => ({
  paraZapbot: (c: { id: string }) => ({ id: c.id, token: "t", clientToken: "c" }),
  credenciais: vi.fn(),
}));

vi.mock("@/src/lib/jobs/grupo-novo", () => ({
  criarGatilhosGrupoNovo: hoisted.criarGatilhosGrupoNovoMock,
}));

vi.mock("@/src/lib/automacoes", () => ({
  dispararAutomacoes: hoisted.dispararAutomacoesMock,
}));

import { processarAcoes } from "@/src/lib/jobs/acoes";
import type { Prazo } from "@/src/lib/jobs/tipos";

type Acao = { id: string; tipo: "criar_grupo"; campanha_id: string; grupo_id: null; telefone: null; dados: Record<string, unknown>; tentativas: number };

/** Banco falso mínimo pro fluxo de `executarCriarGrupo`/`processarAcoes`: resolve por tabela (e, pra "grupos",
 *  por ter chamado `.upsert()` ou não), registrando os `update` de "acoes" e os `upsert` de "grupos". */
function construirDb(acoesFila: Acao[], camp: Record<string, unknown>, criador: Record<string, unknown>, grupoUpsertId: string) {
  const atualizacoesAcoes: Record<string, unknown>[] = [];
  const upsertsGrupos: Record<string, unknown>[] = [];
  const from = vi.fn((tabela: string) => {
    const consulta: Record<string, unknown> & { _modo?: string } = {};
    consulta.select = vi.fn(() => {
      consulta._modo ??= "select";
      return consulta;
    });
    consulta.eq = vi.fn(() => consulta);
    consulta.neq = vi.fn(() => consulta);
    consulta.order = vi.fn(() => consulta);
    consulta.limit = vi.fn(() => consulta);
    consulta.single = vi.fn(() => consulta);
    consulta.maybeSingle = vi.fn(() => consulta);
    consulta.insert = vi.fn(() => {
      consulta._modo = "insert";
      return consulta;
    });
    consulta.update = vi.fn((payload: unknown) => {
      consulta._modo = "update";
      if (tabela === "acoes") atualizacoesAcoes.push(payload as Record<string, unknown>);
      return consulta;
    });
    consulta.upsert = vi.fn((payload: unknown) => {
      consulta._modo = "upsert";
      if (tabela === "grupos") upsertsGrupos.push(payload as Record<string, unknown>);
      return consulta;
    });
    consulta.then = (resolve: (v: unknown) => void) => {
      if (tabela === "campanhas") return resolve({ data: camp, error: null });
      if (tabela === "conexoes") return resolve({ data: criador, error: null });
      if (tabela === "campanha_conexoes") return resolve({ data: [], error: null });
      if (tabela === "grupos" && consulta._modo === "upsert") return resolve({ data: { id: grupoUpsertId }, error: null });
      if (tabela === "grupos") return resolve({ data: null, error: null }); // sem grupo anterior (select numero)
      if (tabela === "acoes") return resolve({ error: null });
      resolve({ data: null, error: null });
    };
    return consulta;
  });
  const rpc = vi.fn(async () => ({ data: acoesFila, error: null }));
  return { from, rpc, atualizacoesAcoes, upsertsGrupos };
}

const camp = { conexao_criadora_id: "con1", descricao: "desc", fechado: false, comunidade_id: null, usar_comunidade: false, padrao_nome: "Turma #", nome: "Campanha X", mensagem_fixa: "Bem-vindo!" };
const criador = { id: "con1", status: "conectado" };
const prazo: Prazo = { ate: Date.now() + 60_000 };

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.criarGatilhosGrupoNovoMock.mockResolvedValue(4);
  hoisted.dispararAutomacoesMock.mockResolvedValue(0);
});

describe("executarCriarGrupo (via processarAcoes) — gatilhos de grupo novo", () => {
  it("primeira execução: salva o grupo, chama os gatilhos uma vez e marca dados.gatilhos", async () => {
    const acao: Acao = { id: "ac1", tipo: "criar_grupo", campanha_id: "c1", grupo_id: null, telefone: null, dados: {}, tentativas: 1 };
    const { from, rpc, atualizacoesAcoes, upsertsGrupos } = construirDb([acao], camp, criador, "grupo-1");
    hoisted.dbAtual = { from, rpc };

    expect(await processarAcoes(prazo)).toBe(1);

    expect(hoisted.criarGatilhosGrupoNovoMock).toHaveBeenCalledTimes(1);
    expect(hoisted.criarGatilhosGrupoNovoMock).toHaveBeenCalledWith("c1", "grupo-1", "Bem-vindo!");
    expect(hoisted.dispararAutomacoesMock).toHaveBeenCalledTimes(1);
    expect(hoisted.dispararAutomacoesMock).toHaveBeenCalledWith({ campanhaId: "c1", gatilho: "grupo_criado", grupoId: "grupo-1" });
    expect(upsertsGrupos).toHaveLength(1);

    const final = atualizacoesAcoes.at(-1) as { status: string; erro: unknown; dados: { gatilhos?: boolean; automacoes?: boolean; groupId?: string } };
    expect(final.status).toBe("ok");
    expect(final.dados.gatilhos).toBe(true);
    expect(final.dados.automacoes).toBe(true);
    expect(final.dados.groupId).toBe("120@g.us");
  });

  it("reentrada com dados.gatilhos já true: não chama os gatilhos de novo nem recria o grupo", async () => {
    const dadosAnteriores = { groupId: "120@g.us", promovidos: true, configurado: true, link: "https://chat.whatsapp.com/X", numero: 1, nome: "Turma #1", gatilhos: true, automacoes: true };
    const acao: Acao = { id: "ac1", tipo: "criar_grupo", campanha_id: "c1", grupo_id: null, telefone: null, dados: dadosAnteriores, tentativas: 2 };
    const { from, rpc, atualizacoesAcoes } = construirDb([acao], camp, criador, "grupo-1");
    hoisted.dbAtual = { from, rpc };

    expect(await processarAcoes(prazo)).toBe(1);

    expect(hoisted.criarGatilhosGrupoNovoMock).not.toHaveBeenCalled();
    expect(hoisted.dispararAutomacoesMock).not.toHaveBeenCalled();
    expect(hoisted.zapbotFake.criarGrupo).not.toHaveBeenCalled();
    const final = atualizacoesAcoes.at(-1) as { status: string };
    expect(final.status).toBe("ok");
  });

  it("gatilho falha: a criação termina 'ok', avisa no alerta e não tenta os gatilhos de novo", async () => {
    hoisted.criarGatilhosGrupoNovoMock.mockRejectedValueOnce(new Error("Não foi possível agendar as mensagens do grupo novo: fora do ar"));
    const acao1: Acao = { id: "ac1", tipo: "criar_grupo", campanha_id: "c1", grupo_id: null, telefone: null, dados: {}, tentativas: 1 };
    const db1 = construirDb([acao1], camp, criador, "grupo-1");
    hoisted.dbAtual = { from: db1.from, rpc: db1.rpc };

    expect(await processarAcoes(prazo)).toBe(1);

    const final1 = db1.atualizacoesAcoes.at(-1) as { status: string; erro: unknown; dados: Record<string, unknown> };
    expect(final1.status).toBe("ok");
    expect(final1.erro).toBeNull();
    expect(final1.dados.gatilhos).toBe(true);
    expect(final1.dados.groupId).toBe("120@g.us");
    // o progresso com gatilhos=true foi salvo antes de a ação terminar (aoAvancar)
    expect(db1.atualizacoesAcoes.some((u) => !("status" in u) && (u.dados as { gatilhos?: boolean }).gatilhos === true)).toBe(true);
    expect(db1.upsertsGrupos).toHaveLength(1);
    expect(hoisted.alertarMock).toHaveBeenCalledTimes(1);
    expect(hoisted.alertarMock.mock.calls[0][0]).toEqual({
      tipo: "criacao_erro",
      campanhaId: "c1",
      texto: "Grupo Turma # 01 criado, mas as mensagens do grupo novo não foram agendadas: Não foi possível agendar as mensagens do grupo novo: fora do ar",
      conexaoId: "con1",
    });

    // se a ação fosse pega de novo com esse progresso, os gatilhos não rodam outra vez
    const acao2: Acao = { ...acao1, dados: final1.dados, tentativas: 2 };
    const db2 = construirDb([acao2], camp, criador, "grupo-1");
    hoisted.dbAtual = { from: db2.from, rpc: db2.rpc };
    await processarAcoes(prazo);
    expect(hoisted.criarGatilhosGrupoNovoMock).toHaveBeenCalledTimes(1);
    expect(hoisted.zapbotFake.criarGrupo).toHaveBeenCalledTimes(1);
  });
});
