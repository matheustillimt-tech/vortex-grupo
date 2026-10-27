import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, filtro, type Chamada, type Resposta } from "./apoio/db-falso";

const hoisted = vi.hoisted(() => ({ dbAtual: undefined as unknown, alertarMock: vi.fn(async (_a: unknown, _db?: unknown) => undefined) }));
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => hoisted.dbAtual }));
vi.mock("@/src/lib/jobs/alertas", () => ({ alertar: hoisted.alertarMock }));

import { iniciarExecucoesVencidas } from "@/src/lib/jobs/execucoes";

beforeEach(() => vi.clearAllMocks());

describe("iniciarExecucoesVencidas: execução atrasada mais de 15 min", () => {
  const agora = new Date("2026-10-16T12:00:00.000Z");
  const atrasada = new Date(agora.getTime() - 16 * 60_000).toISOString();

  it("ação de cronograma de automação vira 'pulada' (não dispara atrasada), como passo de sequência", async () => {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "execucoes" && c.op === "update" && (c.dados as { status: string }).status === "enviando") {
        return {
          data: [
            { id: "e1", campanha_id: "c1", tipo: "abrir", origem: "automacao", gatilho_chave: "cronograma", conteudo: {}, alvo_grupos: null, agendada_para: atrasada },
            { id: "e2", campanha_id: "c1", tipo: "abrir", origem: "sequencia", gatilho_chave: null, conteudo: {}, alvo_grupos: null, agendada_para: atrasada },
          ],
        };
      }
      return {};
    });
    hoisted.dbAtual = db;

    await iniciarExecucoesVencidas(agora);

    const puladas = chamadas.filter((c) => c.tabela === "execucoes" && c.op === "update" && (c.dados as { status: string }).status === "pulada");
    expect(puladas.map((c) => filtro(c, "eq", "id"))).toEqual(["e1", "e2"]);
    expect(chamadas.some((c) => c.tabela === "campanhas")).toBe(false);
  });
});
