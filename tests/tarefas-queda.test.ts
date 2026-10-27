import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, filtro, type Chamada, type Resposta } from "./apoio/db-falso";

const hoisted = vi.hoisted(() => ({
  dbAtual: undefined as unknown,
  executarTarefaMock: vi.fn(),
  alertarMock: vi.fn(async () => undefined),
}));

vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => hoisted.dbAtual }));
vi.mock("@/src/lib/zapbot/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/src/lib/zapbot/client")>()), zapbot: () => ({}) }));
vi.mock("@/src/lib/conexoes", () => ({ paraZapbot: (c: { id: string }) => ({ id: c.id, token: "t", clientToken: "c" }) }));
vi.mock("@/src/lib/jobs/alertas", () => ({ alertar: hoisted.alertarMock }));
vi.mock("@/src/lib/jobs/monitor", () => ({ campanhasDoNumero: vi.fn(async () => []) }));
vi.mock("@/src/lib/jobs/executar-tarefa", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/lib/jobs/executar-tarefa")>()),
  executarTarefa: hoisted.executarTarefaMock,
}));

import { ZapbotError } from "@/src/lib/zapbot/client";
import { processarTarefas } from "@/src/lib/jobs/tarefas";

beforeEach(() => vi.clearAllMocks());

function montar(erroQueda?: { message: string }) {
  let entregue = false;
  return dbFalso((c: Chamada): Resposta => {
    if (c.tabela === "rpc:pegar_tarefas") {
      if (entregue) return { data: [] };
      entregue = true;
      return { data: [{ id: "t1", execucao_id: "e1", grupo_id: "g1", conexao_id: "A", tipo: "mensagem", prioridade: 1, tentativas: 1, enviar_apos: new Date(Date.now() - 1000).toISOString() }] };
    }
    if (c.tabela === "conexoes" && c.op === "update" && "caiu_em" in (c.dados as object)) return erroQueda ? { error: erroQueda } : {};
    if (c.tabela === "execucoes") return { data: c.op === "select" && !filtro(c, "eq", "status") ? { id: "e1", tipo: "mensagem", conteudo_final: { texto: "oi" } } : [] };
    if (c.tabela === "conexoes") return { data: { id: "A", nome: "Número A", status: "conectado" } };
    if (c.tabela === "grupos") return { data: { group_id: "120@g.us", numero: 1, nome: "Turma 01", campanha_id: "c1" } };
    return {};
  });
}

describe("queda durante um envio: caiu_em só na transição", () => {
  it("marca desconectado como antes e grava caiu_em num update separado, só se estiver vazio", async () => {
    hoisted.executarTarefaMock.mockRejectedValueOnce(new ZapbotError(502, "instance abc not connected", {}));
    const { db, chamadas } = montar();
    hoisted.dbAtual = db;
    await processarTarefas({ ate: Date.now() + 20_000 });
    const ups = chamadas.filter((c) => c.tabela === "conexoes" && c.op === "update");
    expect(ups.find((c) => (c.dados as { status?: string }).status === "desconectado")?.dados).toEqual({ status: "desconectado", ultimo_erro: "Desconectou durante uma tarefa" });
    const queda = ups.find((c) => "caiu_em" in (c.dados as object))!;
    expect(typeof (queda.dados as { caiu_em: unknown }).caiu_em).toBe("string");
    expect(queda.filtros).toContainEqual(["is", "caiu_em", null]);
    expect(filtro(queda, "eq", "id")).toBe("A");
  });

  it("erro ao gravar caiu_em é conferido (log) e não derruba o envio", async () => {
    hoisted.executarTarefaMock.mockRejectedValueOnce(new ZapbotError(502, "instance abc not connected", {}));
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { db } = montar({ message: "fora do ar" });
    hoisted.dbAtual = db;
    await expect(processarTarefas({ ate: Date.now() + 20_000 })).resolves.toBeTypeOf("number");
    expect(erro.mock.calls.some((c) => String(c[0]).includes("início da queda"))).toBe(true);
    erro.mockRestore();
  });
});
