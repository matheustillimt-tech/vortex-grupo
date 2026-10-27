import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, filtro, type Chamada, type Resposta } from "./apoio/db-falso";
import { liberarTudo, negarTudo, SEM_PERMISSAO } from "./apoio/permissoes";

const hoisted = vi.hoisted(() => ({ dbAtual: undefined as unknown, revalidar: vi.fn(), historico: vi.fn() }));

vi.mock("@/src/lib/permissoes", async () => (await import("./apoio/permissoes")).permissoesFalsas());
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => hoisted.dbAtual }));
vi.mock("@/src/lib/supabase/usuario", () => ({ exigirUsuario: vi.fn(async () => ({ id: "u1" })), dbUsuario: async () => hoisted.dbAtual }));
vi.mock("next/cache", () => ({ revalidatePath: hoisted.revalidar }));
vi.mock("@/src/lib/historico", () => ({ registrarHistorico: hoisted.historico }));

import { excluirExecucoes, reenviarTravadas, cancelarGlobal, executarAgoraGlobal, reexecutarFalhas, reexecutarFalhasGlobal } from "@/app/(painel)/_acoes/execucoes";

const E1 = "11111111-1111-1111-1111-111111111111";
const E2 = "22222222-2222-2222-2222-222222222222";
const CAMP1 = "33333333-3333-3333-3333-333333333333";
const CAMP2 = "44444444-4444-4444-4444-444444444444";

beforeEach(() => {
  vi.clearAllMocks();
  liberarTudo();
});

describe("executarAgoraGlobal / cancelarGlobal / reexecutarFalhasGlobal", () => {
  it("cancela execuções de campanhas diferentes e revalida cada uma + /acoes", async () => {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "execucoes" && c.op === "select") return { data: [{ id: E1, campanha_id: CAMP1 }, { id: E2, campanha_id: CAMP2 }] };
      // Cascata das encadeadas ("Adicionar outra ação"): nenhuma seguinte.
      if (c.tabela === "execucoes" && c.op === "update" && filtro(c, "in", "depois_de")) return { data: [] };
      if (c.tabela === "execucoes" && c.op === "update") return { data: [{ id: filtro(c, "eq", "id") }] };
      return {};
    });
    hoisted.dbAtual = db;
    const r = await cancelarGlobal([E1, E2]);
    expect(r).toEqual({ feitas: 2, erros: [] });
    expect(hoisted.revalidar).toHaveBeenCalledWith(`/campanhas/${CAMP1}`, "layout");
    expect(hoisted.revalidar).toHaveBeenCalledWith(`/campanhas/${CAMP2}`, "layout");
    expect(hoisted.revalidar).toHaveBeenCalledWith("/acoes");
    expect(hoisted.historico).toHaveBeenCalledTimes(1);
    const updates = chamadas.filter((c) => c.tabela === "execucoes" && c.op === "update" && !filtro(c, "in", "depois_de"));
    expect(updates.map((c) => c.dados)).toEqual([{ status: "cancelada" }, { status: "cancelada" }]);
    const cascata = chamadas.filter((c) => c.tabela === "execucoes" && c.op === "update" && filtro(c, "in", "depois_de"));
    expect(cascata.map((c) => filtro(c, "in", "depois_de"))).toEqual([[E1], [E2]]);
  });

  it("ids não-uuid são descartados em silêncio", async () => {
    const { db } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "execucoes" && c.op === "select") return { data: [{ id: E1, campanha_id: CAMP1 }] };
      if (c.tabela === "execucoes" && c.op === "update") return { data: [{ id: E1 }] };
      return {};
    });
    hoisted.dbAtual = db;
    const r = await executarAgoraGlobal([E1, "não-é-uuid", ""]);
    expect(r).toEqual({ feitas: 1, erros: [] });
  });

  it("mais de 300 ids (string) distintos: recusa antes de tocar no banco", async () => {
    const { db, chamadas } = dbFalso(() => ({}));
    hoisted.dbAtual = db;
    const muitos = Array.from({ length: 301 }, (_, i) => `id-${i}`);
    const r = await reexecutarFalhasGlobal(muitos);
    expect(r).toEqual({ feitas: 0, erros: ["Marque no máximo 300 de uma vez."] });
    expect(chamadas).toEqual([]);
  });

  it("sem permissão: recusa sem tocar no banco", async () => {
    negarTudo();
    const { db, chamadas } = dbFalso(() => ({}));
    hoisted.dbAtual = db;
    const r = await cancelarGlobal([E1]);
    expect(r).toEqual({ feitas: 0, erros: [SEM_PERMISSAO] });
    expect(chamadas).toEqual([]);
  });
});

describe("reenviarTravadas", () => {
  it("só pega tarefas 'processando' com pego_em há mais de 5 min e manda pra fila (espaçadas)", async () => {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "execucoes" && c.op === "select") return { data: [{ id: E1, campanha_id: CAMP1 }] };
      if (c.tabela === "tarefas" && c.op === "select") return { data: [{ id: "t1", grupo_id: "g1", conexao_id: "c1" }] };
      if (c.tabela === "tarefas" && c.op === "update") return { data: [{ id: "t1" }] };
      return {};
    });
    hoisted.dbAtual = db;
    const r = await reenviarTravadas([E1]);
    expect(r).toEqual({ feitas: 1, erros: [] });
    const leitura = chamadas.find((c) => c.tabela === "tarefas" && c.op === "select")!;
    expect(filtro(leitura, "eq", "status")).toBe("processando");
    expect(filtro(leitura, "in", "execucao_id")).toEqual([E1]);
    const limite = filtro(leitura, "lt", "pego_em") as string;
    expect(Date.now() - new Date(limite).getTime()).toBeGreaterThanOrEqual(5 * 60_000 - 1000);
    const update = chamadas.find((c) => c.tabela === "tarefas" && c.op === "update")!;
    expect(update.dados).toMatchObject({ status: "fila", tentativas: 0, erro: null });
    expect(hoisted.revalidar).toHaveBeenCalledWith("/acoes");
  });

  it("nenhuma travada: não revalida nem grava histórico", async () => {
    const { db } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "execucoes" && c.op === "select") return { data: [{ id: E1, campanha_id: CAMP1 }] };
      if (c.tabela === "tarefas" && c.op === "select") return { data: [] };
      return {};
    });
    hoisted.dbAtual = db;
    const r = await reenviarTravadas([E1]);
    expect(r).toEqual({ feitas: 0, erros: [] });
    expect(hoisted.revalidar).not.toHaveBeenCalled();
    expect(hoisted.historico).not.toHaveBeenCalled();
  });
});

describe("excluirExecucoes", () => {
  const E3 = "55555555-5555-5555-5555-555555555555";
  const E4 = "66666666-6666-6666-6666-666666666666";

  it("apaga as avulsas com a trava de 'enviando' no próprio delete e conexão só as apagadas de fato", async () => {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "execucoes" && c.op === "select") {
        return { data: [{ id: E1, campanha_id: CAMP1, origem: "avulsa" }, { id: E2, campanha_id: CAMP2, origem: "massa" }] };
      }
      // E2 começou a enviar entre a leitura e o delete: o banco só apaga a E1.
      if (c.tabela === "execucoes" && c.op === "delete") return { data: [{ id: E1 }] };
      return {};
    });
    hoisted.dbAtual = db;
    const r = await excluirExecucoes([E1, E2]);
    expect(r).toEqual({ apagadas: 1, canceladas: 0, puladas: 1, erros: [] });
    const del = chamadas.find((c) => c.tabela === "execucoes" && c.op === "delete")!;
    expect(filtro(del, "in", "id")).toEqual([E1, E2]);
    expect(filtro(del, "neq", "status")).toBe("enviando");
    // Só a cascata das encadeadas (seguintes ainda agendadas das que vão ser apagadas), antes do delete.
    const updates = chamadas.filter((c) => c.tabela === "execucoes" && c.op === "update");
    expect(updates.map((c) => filtro(c, "in", "depois_de"))).toEqual([[E1, E2]]);
    expect(chamadas.indexOf(updates[0])).toBeLessThan(chamadas.indexOf(del));
    expect(hoisted.revalidar).toHaveBeenCalledWith(`/campanhas/${CAMP1}`, "layout");
    expect(hoisted.revalidar).not.toHaveBeenCalledWith(`/campanhas/${CAMP2}`, "layout");
    expect(hoisted.historico).toHaveBeenCalledTimes(1);
  });

  it("sequência e automação são canceladas (não apagadas), pra o job não recriar e mandar de novo", async () => {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "execucoes" && c.op === "select") {
        return {
          data: [
            { id: E1, campanha_id: CAMP1, origem: "sequencia" },
            { id: E2, campanha_id: CAMP1, origem: "automacao" },
            { id: E3, campanha_id: CAMP2, origem: "grupo_novo" },
            { id: E4, campanha_id: CAMP2, origem: "avulsa" },
          ],
        };
      }
      if (c.tabela === "execucoes" && c.op === "update") return { data: [{ id: E1 }, { id: E2 }] };
      if (c.tabela === "execucoes" && c.op === "delete") return { data: [{ id: E3 }, { id: E4 }] };
      return {};
    });
    hoisted.dbAtual = db;
    const r = await excluirExecucoes([E1, E2, E3, E4]);
    expect(r).toEqual({ apagadas: 2, canceladas: 2, puladas: 0, erros: [] });
    const upd = chamadas.find((c) => c.tabela === "execucoes" && c.op === "update")!;
    expect(upd.dados).toEqual({ status: "cancelada" });
    expect(filtro(upd, "in", "id")).toEqual([E1, E2]);
    expect(filtro(upd, "in", "status")).toEqual(["agendada", "bloqueada"]); // concluída fica como está (já saiu)
    const del = chamadas.find((c) => c.tabela === "execucoes" && c.op === "delete")!;
    expect(filtro(del, "in", "id")).toEqual([E3, E4]);
    expect(hoisted.revalidar).toHaveBeenCalledWith(`/campanhas/${CAMP1}`, "layout");
    expect(hoisted.revalidar).toHaveBeenCalledWith(`/campanhas/${CAMP2}`, "layout");
  });

  it("sequência em andamento: o update com a trava não mexe e ela conexão como pulada", async () => {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "execucoes" && c.op === "select") return { data: [{ id: E1, campanha_id: CAMP1, origem: "sequencia" }] };
      if (c.tabela === "execucoes" && c.op === "update") return { data: [] };
      return {};
    });
    hoisted.dbAtual = db;
    const r = await excluirExecucoes([E1]);
    expect(r).toEqual({ apagadas: 0, canceladas: 0, puladas: 1, erros: [] });
    expect(chamadas.some((c) => c.tabela === "execucoes" && c.op === "delete")).toBe(false);
    expect(hoisted.historico).not.toHaveBeenCalled();
    expect(hoisted.revalidar).not.toHaveBeenCalled();
  });

  it("erro do banco no delete vira mensagem e não conexão como pulada", async () => {
    const { db } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "execucoes" && c.op === "select") return { data: [{ id: E1, campanha_id: CAMP1, origem: "avulsa" }] };
      if (c.tabela === "execucoes" && c.op === "delete") return { error: { message: "falhou" } };
      return {};
    });
    hoisted.dbAtual = db;
    const r = await excluirExecucoes([E1]);
    expect(r).toEqual({ apagadas: 0, canceladas: 0, puladas: 0, erros: ["Não foi possível excluir: falhou"] });
  });
});

// Etapa 3J (revisão final): reprocessar uma execução cuja seguinte ("Adicionar outra ação") já está agendada ou
// enviando sairia fora de ordem — a seguinte pode terminar antes da anterior ser refeita. Recusa até a seguinte
// sair da fila (cancelada ou concluída).
describe("reexecutarFalhas: recusa reprocessar quando a ação seguinte já está agendada/enviando", () => {
  it("seguinte agendada: recusa, sem tocar nas tarefas", async () => {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "execucoes" && c.op === "select" && filtro(c, "eq", "id")) return { data: { status: "concluida" } };
      if (c.tabela === "execucoes" && c.op === "select" && filtro(c, "eq", "depois_de")) return { data: [{ id: "s1" }] };
      return {};
    });
    hoisted.dbAtual = db;
    await expect(reexecutarFalhas(E1, CAMP1)).rejects.toThrow(/seguinte já está agendada/);
    expect(chamadas.some((c) => c.tabela === "tarefas")).toBe(false);
    const checagem = chamadas.find((c) => c.tabela === "execucoes" && c.op === "select" && filtro(c, "eq", "depois_de"))!;
    expect(filtro(checagem, "eq", "depois_de")).toBe(E1);
    expect(filtro(checagem, "in", "status")).toEqual(["agendada", "enviando"]);
  });

  it("sem seguinte pendente (ou nenhuma seguinte): reprocessa normalmente", async () => {
    const { db } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "execucoes" && c.op === "select" && filtro(c, "eq", "id")) return { data: { status: "concluida" } };
      if (c.tabela === "execucoes" && c.op === "select" && filtro(c, "eq", "depois_de")) return { data: [] };
      if (c.tabela === "tarefas" && c.op === "select") return { data: [{ id: "t1", grupo_id: "g1", conexao_id: "c1" }] };
      if (c.tabela === "tarefas" && c.op === "update") return { data: [{ id: "t1" }] };
      if (c.tabela === "execucoes" && c.op === "update") return { data: [{ id: E1 }] };
      return {};
    });
    hoisted.dbAtual = db;
    await expect(reexecutarFalhas(E1, CAMP1)).resolves.toBeUndefined();
  });

  it("reexecutarFalhasGlobal: a seguinte agendada entra como erro no lote, sem travar as outras", async () => {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "execucoes" && c.op === "select" && filtro(c, "in", "id")) return { data: [{ id: E1, campanha_id: CAMP1 }, { id: E2, campanha_id: CAMP2 }] };
      if (c.tabela === "execucoes" && c.op === "select" && filtro(c, "eq", "id") === E1) return { data: { status: "concluida" } };
      if (c.tabela === "execucoes" && c.op === "select" && filtro(c, "eq", "id") === E2) return { data: { status: "concluida" } };
      if (c.tabela === "execucoes" && c.op === "select" && filtro(c, "eq", "depois_de") === E1) return { data: [{ id: "s1" }] };
      if (c.tabela === "execucoes" && c.op === "select" && filtro(c, "eq", "depois_de") === E2) return { data: [] };
      // E2 tem uma falha de verdade (senão `soComFalhas` recusaria por outro motivo); E1 nunca chega até aqui.
      if (c.tabela === "tarefas" && c.op === "select") return { data: filtro(c, "eq", "execucao_id") === E2 ? [{ id: "t2", grupo_id: "g1", conexao_id: "c1" }] : [] };
      if (c.tabela === "tarefas" && c.op === "update") return { data: [{ id: "t2" }] };
      return {};
    });
    hoisted.dbAtual = db;
    const r = await reexecutarFalhasGlobal([E1, E2]);
    expect(r.feitas).toBe(1);
    expect(r.erros).toEqual([expect.stringMatching(/seguinte já está agendada/)]);
    expect(chamadas.some((c) => c.tabela === "tarefas")).toBe(true);
  });
});
