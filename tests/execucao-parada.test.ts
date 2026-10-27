import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ dbAtual: undefined as unknown, alertarMock: vi.fn(async (_a: unknown) => undefined) }));

vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => hoisted.dbAtual }));
vi.mock("@/src/lib/zapbot/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/src/lib/zapbot/client")>();
  return { ...real, zapbot: () => ({}) };
});
vi.mock("@/src/lib/conexoes", () => ({ paraZapbot: vi.fn() }));
vi.mock("@/src/lib/jobs/alertas", () => ({ alertar: hoisted.alertarMock }));
vi.mock("@/src/lib/jobs/monitor", () => ({ campanhasDoNumero: vi.fn(async () => []) }));

import { processarTarefas } from "@/src/lib/jobs/tarefas";

type Exec = { id: string; campanha_id: string; tipo: string; origem: string; agendada_para: string; iniciada_em: string | null; campanhas: { nome: string } };

/** Sem tarefas na fila; `execucoes` em 'enviando' = `emAndamento`, todas com zero tarefas. Registra os updates. */
function construirDb(emAndamento: Exec[]) {
  const updates: { payload: Record<string, unknown>; filtros: [string, unknown][] }[] = [];
  const from = (tabela: string) => {
    let upd: { payload: Record<string, unknown>; filtros: [string, unknown][] } | undefined;
    let contagem = false;
    const q: Record<string, unknown> = {};
    q.select = (_c: string, o?: { count?: string }) => {
      if (o?.count) contagem = true;
      return q;
    };
    q.in = () => q;
    q.eq = (col: string, v: unknown) => {
      upd?.filtros.push([col, v]);
      return q;
    };
    q.update = (payload: Record<string, unknown>) => {
      upd = { payload, filtros: [] };
      if (tabela === "execucoes") updates.push(upd);
      return q;
    };
    q.then = (resolve: (v: unknown) => void) => {
      if (upd) return resolve({ data: [{ id: "x" }], error: null });
      if (contagem) return resolve({ count: 0, error: null });
      if (tabela === "execucoes") return resolve({ data: emAndamento, error: null });
      resolve({ data: null, error: null });
    };
    return q;
  };
  return { from, rpc: async () => ({ data: [], error: null }), updates };
}

const min = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

beforeEach(() => vi.clearAllMocks());

describe("execução parada em 'enviando' sem tarefas", () => {
  it("há mais de 5 min: volta pra agendada (limpa iniciada_em) e avisa uma vez", async () => {
    const db = construirDb([{ id: "e1", campanha_id: "c1", tipo: "mensagem", origem: "avulsa", agendada_para: min(7), iniciada_em: min(6), campanhas: { nome: "Camp" } }]);
    hoisted.dbAtual = db;
    await processarTarefas({ ate: Date.now() + 60_000 });
    expect(db.updates).toEqual([{ payload: { status: "agendada", iniciada_em: null }, filtros: [["id", "e1"], ["status", "enviando"]] }]);
    expect(hoisted.alertarMock).toHaveBeenCalledTimes(1);
    expect(hoisted.alertarMock.mock.calls[0][0]).toMatchObject({ tipo: "tarefa_erro", campanhaId: "c1" });
  });

  it("passo de sequência mais de 15 min atrasado: pulada com motivo", async () => {
    const db = construirDb([{ id: "e2", campanha_id: "c1", tipo: "abrir", origem: "sequencia", agendada_para: min(20), iniciada_em: min(6), campanhas: { nome: "Camp" } }]);
    hoisted.dbAtual = db;
    await processarTarefas({ ate: Date.now() + 60_000 });
    expect(db.updates[0].payload).toEqual({ status: "pulada", motivo: "Ficou parada sem tarefas e já passou mais de 15 min do horário." });
    expect(hoisted.alertarMock).toHaveBeenCalledTimes(1);
  });

  it("começou há pouco: não mexe nem avisa", async () => {
    const db = construirDb([{ id: "e3", campanha_id: "c1", tipo: "mensagem", origem: "avulsa", agendada_para: min(1), iniciada_em: min(1), campanhas: { nome: "Camp" } }]);
    hoisted.dbAtual = db;
    await processarTarefas({ ate: Date.now() + 60_000 });
    expect(db.updates).toEqual([]);
    expect(hoisted.alertarMock).not.toHaveBeenCalled();
  });
});
