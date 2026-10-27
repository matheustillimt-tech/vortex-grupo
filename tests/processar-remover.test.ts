import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, type Chamada, type Resposta } from "./apoio/db-falso";

const h = vi.hoisted(() => ({ db: undefined as unknown, participantes: vi.fn(async () => undefined), alertar: vi.fn(async () => undefined) }));
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => h.db }));
vi.mock("@/src/lib/jobs/alertas", () => ({ alertar: h.alertar }));
vi.mock("@/src/lib/jobs/grupo-novo", () => ({ criarGatilhosGrupoNovo: vi.fn(async () => 0) }));
vi.mock("@/src/lib/conexoes", () => ({ paraZapbot: vi.fn(), credenciais: vi.fn(async () => ({ id: "x", token: "t", clientToken: "c" })) }));
vi.mock("@/src/lib/zapbot/client", async (orig) => ({ ...(await orig<typeof import("@/src/lib/zapbot/client")>()), zapbot: () => ({ participantes: h.participantes }) }));

import { NOTA_CONTA_NAO_AUTORIZADA, processarAcoes } from "@/src/lib/jobs/acoes";

describe("ação remover", () => {
  it.each([
    ["venda hotmart", "comprador"],
    ["bloqueado", "bloqueado"],
    ["duplicado", "duplicado"],
  ])("origem %s grava motivo %s", async (origem, motivo) => {
    const { db, chamadas } = dbFalso((c) => {
      if (c.tabela === "rpc:pegar_acoes") return { data: [{ id: "a1", tipo: "remover", campanha_id: "c1", grupo_id: "g1", telefone: "553711110001", dados: {}, tentativas: 1, origem }] };
      if (c.tabela === "grupos") return { data: { group_id: "120@g.us", conexao_id: "x" } };
      if (c.tabela === "participantes" && c.op === "select") return { data: [{ admin: false }] };
      if (c.tabela === "bloqueados_efetivos") return { data: [{ telefone: "553711110001" }] };
      if (c.tabela === "conexoes") return { data: [] };
      return {};
    });
    h.db = db;
    await processarAcoes({ ate: Date.now() + 55_000 });
    const up = chamadas.find((c) => c.tabela === "participantes" && c.op === "update")!;
    expect(up.dados).toMatchObject({ motivo_saida: motivo });
    expect(chamadas.find((c) => c.tabela === "acoes" && c.op === "update")!.dados).toMatchObject({ status: "ok" });
  });
});

const CONTA_A = "11111111-1111-1111-1111-111111111111";
const CONTA_B = "22222222-2222-2222-2222-222222222222";

/** Remoção pendente do grupo g1 (conta `conexao`) com a config `antispam_contas` dada (undefined = sem linha). */
function montar(origem: string, conexao: string, config: unknown, alertaHoje = false, extra?: (c: Chamada) => Resposta | undefined) {
  const { db, chamadas } = dbFalso((c) => {
    const e = extra?.(c);
    if (e) return e;
    if (c.tabela === "rpc:pegar_acoes") return { data: [{ id: "a1", tipo: "remover", campanha_id: "c1", grupo_id: "g1", telefone: "553711110001", dados: {}, tentativas: 1, origem }] };
    if (c.tabela === "grupos") return { data: { group_id: "120@g.us", conexao_id: conexao, nome: "Grupo 7" } };
    if (c.tabela === "participantes" && c.op === "select") return { data: [{ admin: false }] };
    if (c.tabela === "bloqueados_efetivos") return { data: [{ telefone: "553711110001" }] };
    if (c.tabela === "configuracoes") return { data: config === undefined ? null : { valor: config } };
    if (c.tabela === "conexoes" && c.op === "select" && c.filtros.some((f) => f[0] === "eq" && f[1] === "id")) return { data: { nome: "Conexão B" } };
    if (c.tabela === "conexoes") return { data: [] };
    if (c.tabela === "alertas") return { data: alertaHoje ? [{ id: "al1" }] : [] };
    return {};
  });
  h.db = db;
  return chamadas;
}

describe("ação remover: Antispam por Conexões Associadas", () => {
  beforeEach(() => {
    h.participantes.mockClear();
    h.alertar.mockClear();
  });

  it("sem configuração (padrão): remove como antes, sem alerta", async () => {
    const chamadas = montar("bloqueado", CONTA_B, undefined);
    await processarAcoes({ ate: Date.now() + 55_000 });
    expect(h.participantes).toHaveBeenCalledTimes(1);
    expect(h.alertar).not.toHaveBeenCalled();
    expect(chamadas.find((c) => c.tabela === "acoes" && c.op === "update")!.dados).toMatchObject({ status: "ok", erro: null });
  });

  it("desligado: remove mesmo com conexões escolhidas", async () => {
    montar("bloqueado", CONTA_B, { ligado: false, contas: [CONTA_A] });
    await processarAcoes({ ate: Date.now() + 55_000 });
    expect(h.participantes).toHaveBeenCalledTimes(1);
  });

  it("ligado e a conexão do grupo autorizada: remove", async () => {
    montar("bloqueado", CONTA_A, { ligado: true, contas: [CONTA_A] });
    await processarAcoes({ ate: Date.now() + 55_000 });
    expect(h.participantes).toHaveBeenCalledTimes(1);
    expect(h.alertar).not.toHaveBeenCalled();
  });

  it("ligado e a conexão não autorizada: não remove, termina com nota e alerta uma vez", async () => {
    const chamadas = montar("bloqueado", CONTA_B, { ligado: true, contas: [CONTA_A] });
    await processarAcoes({ ate: Date.now() + 55_000 });
    expect(h.participantes).not.toHaveBeenCalled();
    expect(chamadas.some((c) => c.tabela === "participantes" && c.op === "update")).toBe(false);
    expect(chamadas.find((c) => c.tabela === "acoes" && c.op === "update")!.dados).toMatchObject({ status: "ok", erro: NOTA_CONTA_NAO_AUTORIZADA });
    expect(h.alertar).toHaveBeenCalledTimes(1);
    expect(h.alertar).toHaveBeenCalledWith(
      { tipo: "antispam_sem_conta", texto: "Anti-spam: número bloqueado no grupo Grupo 7, mas a conexão Conexão B não está autorizada a remover.", campanhaId: "c1", conexaoId: CONTA_B },
      expect.anything(),
    );
  });

  it("mesmo alerta já dado hoje pro grupo: não alerta de novo", async () => {
    montar("bloqueado", CONTA_B, { ligado: true, contas: [CONTA_A] }, true);
    await processarAcoes({ ate: Date.now() + 55_000 });
    expect(h.participantes).not.toHaveBeenCalled();
    expect(h.alertar).not.toHaveBeenCalled();
  });

  it("só vale pro anti-spam: duplicado e venda removem com a conexão não autorizada", async () => {
    for (const origem of ["duplicado", "venda hotmart"]) {
      h.participantes.mockClear();
      const chamadas = montar(origem, CONTA_B, { ligado: true, contas: [CONTA_A] }, false, (c) =>
        c.tabela === "participantes" && c.op === "select" && c.filtros.some((f) => f[0] === "neq") ? { data: [{ grupo_id: "g2" }] } : undefined,
      );
      await processarAcoes({ ate: Date.now() + 55_000 });
      expect(h.participantes).toHaveBeenCalledTimes(1);
      expect(chamadas.some((c) => c.tabela === "configuracoes")).toBe(false);
    }
  });

  it("erro ao ler a configuração: não remove e a ação volta pra fila (nova tentativa)", async () => {
    const chamadas = montar("bloqueado", CONTA_B, undefined, false, (c) => (c.tabela === "configuracoes" ? { error: { message: "caiu" } } : undefined));
    await processarAcoes({ ate: Date.now() + 55_000 });
    expect(h.participantes).not.toHaveBeenCalled();
    expect(chamadas.find((c) => c.tabela === "acoes" && c.op === "update")!.dados).toMatchObject({ status: "fila" });
  });
});
