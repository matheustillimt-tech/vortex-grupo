import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, filtro, type Chamada, type Resposta } from "./apoio/db-falso";

const hoisted = vi.hoisted(() => ({
  dbAtual: undefined as unknown,
  participantesMock: vi.fn(async (..._a: unknown[]) => undefined),
}));

vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => hoisted.dbAtual }));
vi.mock("@/src/lib/zapbot/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/src/lib/zapbot/client")>();
  return { ...real, zapbot: () => ({ participantes: hoisted.participantesMock }) };
});
vi.mock("@/src/lib/conexoes", () => ({ paraZapbot: vi.fn(), credenciais: vi.fn(async () => ({ id: "i", token: "t", clientToken: "c" })) }));
vi.mock("@/src/lib/jobs/alertas", () => ({ alertar: vi.fn(async () => undefined) }));
vi.mock("@/src/lib/jobs/grupo-novo", () => ({ criarGatilhosGrupoNovo: vi.fn() }));

import {
  NOTA_AUTOMACAO_DESATIVADA,
  NOTA_FORA_DO_GRUPO,
  NOTA_NAO_MAIS_ANTERIOR,
  NOTA_NAO_DUPLICADO,
  NOTA_NAO_MAIS_BLOQUEADO,
  NOTA_NUMERO_CONECTADO,
  NOTA_VIROU_ADMIN,
  processarAcoes,
} from "@/src/lib/jobs/acoes";

const prazo = () => ({ ate: Date.now() + 60_000 });

type Cenario = {
  acao?: Record<string, unknown>;
  automacao?: { ativo: boolean } | null;
  conectados?: string[];
  abertas?: { admin: boolean }[];
  /** Participações abertas em outro grupo (a releitura do duplicado, que filtra `neq grupo_id`). */
  outros?: unknown[];
  /** Releitura da fonte única de bloqueados (`bloqueados_efetivos`) na hora de executar uma remoção `origem: "bloqueado"`. Default: ainda bloqueado. */
  bloqueado?: boolean;
};

function montar(c: Cenario = {}) {
  const acao = { id: "ac1", tipo: "remover", campanha_id: "c1", grupo_id: "g1", telefone: "5511" + "900000001", dados: {}, tentativas: 1, origem: "venda hotmart", automacao_id: null, ...c.acao };
  const { db, chamadas } = dbFalso((q: Chamada): Resposta => {
    if (q.tabela === "rpc:pegar_acoes") return { data: [acao] };
    if (q.tabela === "automacoes") return { data: c.automacao === undefined ? { ativo: true } : c.automacao };
    if (q.tabela === "conexoes") return { data: (c.conectados ?? ["5511" + "999990000"]).map((telefone) => ({ telefone })) };
    if (q.tabela === "participantes" && q.op === "select" && filtro(q, "neq", "grupo_id") !== undefined) return { data: c.outros ?? [] };
    if (q.tabela === "participantes" && q.op === "select") return { data: c.abertas ?? [{ admin: false }] };
    if (q.tabela === "bloqueados_efetivos") return { data: c.bloqueado === false ? [] : [{ telefone: acao.telefone }] };
    if (q.tabela === "grupos") return { data: { group_id: "120@g.us", conexao_id: "con1" } };
    return {};
  });
  hoisted.dbAtual = db;
  const final = () => chamadas.filter((x) => x.tabela === "acoes" && x.op === "update").at(-1)?.dados as { status: string; erro: string | null };
  return { chamadas, final };
}

beforeEach(() => vi.clearAllMocks());

describe("processarAcoes: remover", () => {
  it("participante comum, aberto e não admin: remove no WhatsApp e marca ok sem nota", async () => {
    const { chamadas, final } = montar();
    await processarAcoes(prazo());
    expect(hoisted.participantesMock).toHaveBeenCalledWith(expect.anything(), "120@g.us", ["5511" + "900000001"], "remove");
    expect(final()).toMatchObject({ status: "ok", erro: null });
    const leitura = chamadas.find((x) => x.tabela === "participantes" && x.op === "select")!;
    expect(filtro(leitura, "eq", "grupo_id")).toBe("g1");
    expect(filtro(leitura, "in", "telefone")).toEqual(["5511" + "900000001", "551100000001"]);
    expect(filtro(leitura, "is", "saiu_em")).toBeNull();
  });

  it("já não está no grupo: não chama o Zapbot e marca ok com a nota", async () => {
    const { final } = montar({ abertas: [] });
    await processarAcoes(prazo());
    expect(hoisted.participantesMock).not.toHaveBeenCalled();
    expect(final()).toMatchObject({ status: "ok", erro: NOTA_FORA_DO_GRUPO });
    expect(NOTA_FORA_DO_GRUPO).toBe("Já não estava no grupo.");
  });

  it("virou admin: não remove", async () => {
    const { final } = montar({ abertas: [{ admin: true }] });
    await processarAcoes(prazo());
    expect(hoisted.participantesMock).not.toHaveBeenCalled();
    expect(final()).toMatchObject({ status: "ok", erro: NOTA_VIROU_ADMIN });
    expect(NOTA_VIROU_ADMIN).toBe("Virou admin: não removido.");
  });

  it("número conectado no sistema (variante do nono dígito): não remove", async () => {
    const { final } = montar({ conectados: ["551100000001"] });
    await processarAcoes(prazo());
    expect(hoisted.participantesMock).not.toHaveBeenCalled();
    expect(final()).toMatchObject({ status: "ok", erro: NOTA_NUMERO_CONECTADO });
  });

  it("duplicado que ainda está aberto em outro grupo conferido depois da fila: remove", async () => {
    const { chamadas, final } = montar({ acao: { origem: "duplicado", created_at: "2026-10-16T12:00:00.000Z" }, outros: [{ grupo_id: "g2" }] });
    await processarAcoes(prazo());
    expect(hoisted.participantesMock).toHaveBeenCalledTimes(1);
    expect(final()).toMatchObject({ status: "ok", erro: null });
    const releitura = chamadas.find((x) => x.tabela === "participantes" && x.op === "select" && filtro(x, "neq", "grupo_id") !== undefined)!;
    expect(filtro(releitura, "neq", "grupo_id")).toBe("g1");
    expect(filtro(releitura, "in", "telefone")).toEqual(["5511" + "900000001", "551100000001"]);
    expect(filtro(releitura, "is", "saiu_em")).toBeNull();
    expect(filtro(releitura, "eq", "admin")).toBe(false);
    expect(filtro(releitura, "eq", "grupos.campanha_id")).toBe("c1");
    expect(filtro(releitura, "eq", "grupos.ativo")).toBe(true);
    expect(filtro(releitura, "gt", "grupos.conferido_em")).toBe("2026-10-16T12:00:00.000Z");
  });

  it("duplicado que saiu do outro grupo antes da remoção: não remove e marca ok com a nota", async () => {
    const { final } = montar({ acao: { origem: "duplicado", created_at: "2026-10-16T12:00:00.000Z" }, outros: [] });
    await processarAcoes(prazo());
    expect(hoisted.participantesMock).not.toHaveBeenCalled();
    expect(final()).toMatchObject({ status: "ok", erro: NOTA_NAO_DUPLICADO });
    expect(NOTA_NAO_DUPLICADO).toBe("Não é mais duplicado: removido do outro grupo antes.");
  });

  it("remoção que não é de duplicado não relê os outros grupos", async () => {
    const { chamadas } = montar({ acao: { origem: "bloqueado" } });
    await processarAcoes(prazo());
    expect(chamadas.some((x) => x.tabela === "participantes" && filtro(x, "neq", "grupo_id") !== undefined)).toBe(false);
    expect(hoisted.participantesMock).toHaveBeenCalledTimes(1);
  });

  it("bloqueado que já não está mais bloqueado (desbloqueado ou blacklist desativada): não remove e marca ok com a nota", async () => {
    const { chamadas, final } = montar({ acao: { origem: "bloqueado" }, bloqueado: false });
    await processarAcoes(prazo());
    expect(hoisted.participantesMock).not.toHaveBeenCalled();
    expect(final()).toMatchObject({ status: "ok", erro: NOTA_NAO_MAIS_BLOQUEADO });
    expect(NOTA_NAO_MAIS_BLOQUEADO).toBe("Número não está mais bloqueado");
    const leitura = chamadas.find((x) => x.tabela === "bloqueados_efetivos")!;
    expect(filtro(leitura, "in", "telefone")).toEqual(["5511" + "900000001", "551100000001"]);
  });

  it("bloqueado que ainda está bloqueado na fonte única: remove normalmente", async () => {
    const { final } = montar({ acao: { origem: "bloqueado" }, bloqueado: true });
    await processarAcoes(prazo());
    expect(hoisted.participantesMock).toHaveBeenCalledTimes(1);
    expect(final()).toMatchObject({ status: "ok", erro: null });
  });

  it("remoção de automação ativa: remove", async () => {
    const { final } = montar({ acao: { origem: "automacao", automacao_id: "a1" }, automacao: { ativo: true } });
    await processarAcoes(prazo());
    expect(hoisted.participantesMock).toHaveBeenCalledTimes(1);
    expect(final()).toMatchObject({ status: "ok", erro: null });
  });

  it("automação desativada: não remove e marca ok com a nota", async () => {
    const { final } = montar({ acao: { origem: "automacao", automacao_id: "a1" }, automacao: { ativo: false } });
    await processarAcoes(prazo());
    expect(hoisted.participantesMock).not.toHaveBeenCalled();
    expect(final()).toMatchObject({ status: "ok", erro: NOTA_AUTOMACAO_DESATIVADA });
    expect(NOTA_AUTOMACAO_DESATIVADA).toBe("Automação desativada: remoção não feita.");
  });

  it("automação apagada (sem linha, ou automacao_id já nulo com origem automacao): não remove", async () => {
    const a = montar({ acao: { origem: "automacao", automacao_id: "a1" }, automacao: null });
    await processarAcoes(prazo());
    expect(a.final()).toMatchObject({ status: "ok", erro: NOTA_AUTOMACAO_DESATIVADA });
    const b = montar({ acao: { origem: "automacao", automacao_id: null } });
    await processarAcoes(prazo());
    expect(b.final()).toMatchObject({ status: "ok", erro: NOTA_AUTOMACAO_DESATIVADA });
    expect(hoisted.participantesMock).not.toHaveBeenCalled();
  });
});

describe("processarAcoes: remover de campanha anterior (Etapa 3J)", () => {
  const anterior = { origem: "campanha_anterior", campanha_id: "c-antiga", grupo_id: "g-antigo" };
  const releitura = (cs: Chamada[]) => cs.find((x) => x.tabela === "participantes" && x.op === "select" && filtro(x, "neq", "grupo_id") !== undefined);

  it("ainda num grupo ativo de campanha com a seção ligada e a antiga na lista: remove", async () => {
    const { chamadas, final } = montar({ acao: anterior, outros: [{ grupo_id: "g-novo" }] });
    await processarAcoes(prazo());
    expect(hoisted.participantesMock).toHaveBeenCalled();
    expect(final()).toMatchObject({ status: "ok", erro: null });
    const r = releitura(chamadas)!;
    expect(filtro(r, "in", "telefone")).toEqual(["5511" + "900000001", "551100000001"]);
    expect(filtro(r, "is", "saiu_em")).toBeNull();
    expect(filtro(r, "neq", "grupo_id")).toBe("g-antigo");
    expect(filtro(r, "eq", "grupos.ativo")).toBe(true);
    expect(filtro(r, "eq", "grupos.campanhas.remover_anteriores_ativo")).toBe(true);
    expect(filtro(r, "contains", "grupos.campanhas.campanhas_anteriores")).toEqual(["c-antiga"]);
  });

  it("saiu do grupo novo, seção desligada ou campanha fora da lista (releitura vazia): não remove e deixa a nota", async () => {
    const { final } = montar({ acao: anterior, outros: [] });
    await processarAcoes(prazo());
    expect(hoisted.participantesMock).not.toHaveBeenCalled();
    expect(final()).toMatchObject({ status: "ok", erro: NOTA_NAO_MAIS_ANTERIOR });
  });

  it("admin e número conectado continuam protegidos antes da releitura", async () => {
    let m = montar({ acao: anterior, outros: [{ grupo_id: "g-novo" }], abertas: [{ admin: true }] });
    await processarAcoes(prazo());
    expect(m.final()).toMatchObject({ erro: NOTA_VIROU_ADMIN });
    m = montar({ acao: anterior, outros: [{ grupo_id: "g-novo" }], conectados: ["5511" + "900000001"] });
    await processarAcoes(prazo());
    expect(m.final()).toMatchObject({ erro: NOTA_NUMERO_CONECTADO });
    expect(hoisted.participantesMock).not.toHaveBeenCalled();
  });

  it("outras origens não fazem essa releitura", async () => {
    const { chamadas } = montar();
    await processarAcoes(prazo());
    expect(chamadas.some((x) => filtro(x, "contains", "grupos.campanhas.campanhas_anteriores") !== undefined)).toBe(false);
  });
});
