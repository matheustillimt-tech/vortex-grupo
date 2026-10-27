import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  dbAtual: undefined as unknown,
  executarTarefaMock: vi.fn(),
}));

vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => hoisted.dbAtual }));
vi.mock("@/src/lib/zapbot/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/src/lib/zapbot/client")>();
  return { ...real, zapbot: () => ({}) };
});
vi.mock("@/src/lib/conexoes", () => ({ paraZapbot: (c: { id: string }) => ({ id: c.id, token: "t", clientToken: "c" }) }));
vi.mock("@/src/lib/jobs/alertas", () => ({ alertar: vi.fn(async () => undefined) }));
vi.mock("@/src/lib/jobs/monitor", () => ({ campanhasDoNumero: vi.fn(async () => []) }));
vi.mock("@/src/lib/jobs/executar-tarefa", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/lib/jobs/executar-tarefa")>()),
  executarTarefa: hoisted.executarTarefaMock,
}));

import { ZapbotError } from "@/src/lib/zapbot/client";
import { processarTarefas } from "@/src/lib/jobs/tarefas";

type Tarefa = { id: string; execucao_id: string; grupo_id: string; conexao_id: string; tipo: string; prioridade: number; tentativas: number; enviar_apos: string };

/** Banco falso: `pegar_tarefas` devolve o lote uma vez; leituras devolvem a execução/conexão/grupo; os `update` de
 *  "tarefas" ficam registrados. Nenhuma execução em 'enviando' (o fechamento no fim não faz nada). */
function construirDb(lote: Tarefa[]) {
  const updatesTarefas: { payload: Record<string, unknown>; id?: unknown }[] = [];
  let entregue = false;
  const from = (tabela: string) => {
    let upd: { payload: Record<string, unknown>; id?: unknown } | undefined;
    let usouSingle = false;
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.in = () => q;
    q.eq = (col: string, v: unknown) => {
      if (upd && col === "id") upd.id = v;
      return q;
    };
    q.single = () => {
      usouSingle = true;
      return q;
    };
    q.update = (payload: Record<string, unknown>) => {
      upd = { payload };
      if (tabela === "tarefas") updatesTarefas.push(upd);
      return q;
    };
    q.then = (resolve: (v: unknown) => void) => {
      if (upd) return resolve({ data: null, error: null });
      // fechamento das execuções (`select(...).eq("status","enviando")`, sem single): nenhuma em andamento
      if (tabela === "execucoes") return resolve(usouSingle ? { data: { id: "e1", tipo: "mensagem", conteudo_final: { texto: "oi" } }, error: null } : { data: [], error: null });
      if (tabela === "conexoes") return resolve({ data: { id: "A", nome: "Número A" }, error: null });
      if (tabela === "grupos") return resolve({ data: { group_id: "120@g.us", numero: 1, nome: "Turma 01", campanha_id: "c1" }, error: null });
      resolve({ data: null, error: null });
    };
    return q;
  };
  const rpc = async () => {
    if (entregue) return { data: [], error: null };
    entregue = true;
    return { data: lote, error: null };
  };
  return { from, rpc, updatesTarefas };
}

const tarefa = (id: string): Tarefa => ({ id, execucao_id: "e1", grupo_id: "g1", conexao_id: "A", tipo: "mensagem", prioridade: 1, tentativas: 1, enviar_apos: new Date(Date.now() - 1000).toISOString() });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Math, "random").mockReturnValue(1); // intervalo sorteado = 8 s
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("intervalo de 3–8 s por número", () => {
  it("tentativa que falhou também segura o número, e o mapa compartilhado vale na chamada seguinte (tarefas2)", async () => {
    hoisted.executarTarefaMock.mockRejectedValueOnce(new ZapbotError(400, "recusado", {}));
    const proximoPermitido = new Map<string, number>();

    const db1 = construirDb([tarefa("t1")]);
    hoisted.dbAtual = db1;
    const antes = Date.now();
    expect(await processarTarefas({ ate: Date.now() + 20_000 }, proximoPermitido)).toBe(0);
    expect(hoisted.executarTarefaMock).toHaveBeenCalledTimes(1);
    expect(db1.updatesTarefas.at(-1)!.payload.status).toBe("erro");
    const livre = proximoPermitido.get("A")!;
    expect(livre).toBeGreaterThanOrEqual(antes + 8000);
    expect(livre).toBeLessThanOrEqual(Date.now() + 8000);

    // segunda chamada no mesmo tick, com pouco prazo: a próxima tarefa do número A não sai antes de `livre`
    const db2 = construirDb([tarefa("t2")]);
    hoisted.dbAtual = db2;
    await processarTarefas({ ate: Date.now() + 12_000 }, proximoPermitido);
    expect(hoisted.executarTarefaMock).toHaveBeenCalledTimes(1); // não tentou de novo
    const volta = db2.updatesTarefas.find((u) => u.id === "t2")!;
    expect(volta.payload.status).toBe("fila");
    expect(new Date(volta.payload.enviar_apos as string).getTime()).toBe(livre);
  });

  it("sem o mapa compartilhado (chamada isolada) a mesma tarefa sairia na hora", async () => {
    hoisted.executarTarefaMock.mockResolvedValueOnce({ messageId: "M1" });
    hoisted.dbAtual = construirDb([tarefa("t2")]);
    expect(await processarTarefas({ ate: Date.now() + 12_000 })).toBe(1);
    expect(hoisted.executarTarefaMock).toHaveBeenCalledTimes(1);
  });
});
