import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, filtro, type Chamada, type Resposta } from "./apoio/db-falso";

const alertarMock = vi.hoisted(() => vi.fn(async (_a: unknown, _db?: unknown) => undefined));
vi.mock("@/src/lib/jobs/alertas", () => ({ alertar: alertarMock }));

import { enfileirarRemocoes, tratarRodada, type Rodada } from "@/src/lib/jobs/pessoas";

const rodada: Rodada = { grupoId: "g1", grupoNome: "AULÃO #01", campanhaId: "c1", campanhaNome: "Aulão", entraram: [], sairam: [], protegidos: [], agora: "2026-10-16T12:00:00.000Z" };
/** Remoções de bloqueado/duplicado vencem 60 s depois: dá tempo da conferência gravar a entrada antes. */
const VENCE = "2026-10-16T12:01:00.000Z";
/** Duplicado espera 5 min: dá tempo da conferência do outro grupo ver se a pessoa saiu de lá. */
const VENCE_DUPLICADO = "2026-10-16T12:05:00.000Z";

/** Respostas padrão: nada pendente, ninguém bloqueado, ninguém aberto em outro grupo. */
function banco(extra: (c: Chamada) => Resposta | undefined = () => undefined) {
  return dbFalso((c) => {
    const r = extra(c);
    if (r) return r;
    if (c.tabela === "rpc:tag_da_campanha") return { data: "tag-camp" };
    if (c.tabela === "tags") return { data: { id: "tag-saiu" } };
    if (c.op === "select") return { data: [] };
    return {};
  });
}
const inserts = (cs: Chamada[], tabela: string) => cs.filter((c) => c.tabela === tabela && c.op === "insert").map((c) => c.dados);
const rpcs = (cs: Chamada[], nome: string) => cs.filter((c) => c.tabela === `rpc:${nome}`).map((c) => c.dados);

beforeEach(() => alertarMock.mockClear());

describe("tratarRodada", () => {
  it("bloqueado que entra vai pra fila de remoção, gera alerta e não ganha tag", async () => {
    const { db, chamadas } = banco((c) => (c.tabela === "bloqueados_efetivos" ? { data: [{ telefone: "5537" + "911110001" }] } : undefined));
    const plano = await tratarRodada(db, { ...rodada, entraram: [{ telefone: "553711110001", admin: false }, { telefone: "553711110002", admin: false }] });
    expect(plano.removerBloqueio).toEqual(["553711110001"]);
    expect(inserts(chamadas, "acoes")).toEqual([{ tipo: "remover", campanha_id: "c1", grupo_id: "g1", telefone: "553711110001", origem: "bloqueado", executar_apos: VENCE }]);
    expect(alertarMock).toHaveBeenCalledTimes(1);
    expect(alertarMock.mock.calls[0][0]).toMatchObject({ tipo: "bloqueado_removido", campanhaId: "c1" });
    expect(rpcs(chamadas, "por_tag")).toEqual([{ p_telefones: ["553711110002"], p_tag: "tag-camp", p_campanha: null }]);
    expect(rpcs(chamadas, "tirar_tag")).toEqual([{ p_telefones: ["553711110002"], p_tag: "tag-saiu", p_campanha: "c1" }]);
  });

  it("duplicado vai pra fila sem alerta", async () => {
    const { db, chamadas } = banco((c) =>
      c.tabela === "participantes" ? { data: [{ telefone: "553711110001", grupo_id: "g2" }] } : undefined,
    );
    await tratarRodada(db, { ...rodada, entraram: [{ telefone: "553711110001", admin: false }] });
    expect(inserts(chamadas, "acoes")).toEqual([{ tipo: "remover", campanha_id: "c1", grupo_id: "g1", telefone: "553711110001", origem: "duplicado", executar_apos: VENCE_DUPLICADO }]);
    expect(alertarMock).not.toHaveBeenCalled();
    expect(rpcs(chamadas, "por_tag")).toEqual([]);
  });

  it("procura participações abertas só na campanha e em grupos ativos", async () => {
    const { db, chamadas } = banco();
    await tratarRodada(db, { ...rodada, entraram: [{ telefone: "5537" + "911110001", admin: false }] });
    const p = chamadas.find((c) => c.tabela === "participantes")!;
    expect(filtro(p, "in", "telefone")).toEqual(["5537" + "911110001", "553711110001"]);
    expect(filtro(p, "eq", "grupos.campanha_id")).toBe("c1");
    expect(filtro(p, "eq", "grupos.ativo")).toBe(true);
    expect(filtro(p, "is", "saiu_em")).toBeNull();
  });

  it("duplicado só conexão participação não admin em grupo conferido nos últimos 10 min", async () => {
    const { db, chamadas } = banco();
    await tratarRodada(db, { ...rodada, entraram: [{ telefone: "553711110001", admin: false }] });
    const p = chamadas.find((c) => c.tabela === "participantes")!;
    expect(filtro(p, "eq", "admin")).toBe(false);
    expect(filtro(p, "gte", "grupos.conferido_em")).toBe("2026-10-16T11:50:00.000Z");
  });

  it("bloqueado vence em 60 s e duplicado em 5 min na mesma rodada", async () => {
    const { db, chamadas } = banco((c) => {
      if (c.tabela === "bloqueados_efetivos") return { data: [{ telefone: "553711110001" }] };
      if (c.tabela === "participantes") return { data: [{ telefone: "553711110002", grupo_id: "g2" }] };
      return undefined;
    });
    await tratarRodada(db, { ...rodada, entraram: ["553711110001", "553711110002"].map((telefone) => ({ telefone, admin: false })) });
    expect(inserts(chamadas, "acoes")).toEqual([
      expect.objectContaining({ telefone: "553711110001", origem: "bloqueado", executar_apos: VENCE }),
      expect.objectContaining({ telefone: "553711110002", origem: "duplicado", executar_apos: VENCE_DUPLICADO }),
    ]);
  });

  it("quem saiu com remoção pendente não ganha Saiu; quem saiu sozinho ganha", async () => {
    const { db, chamadas } = banco((c) =>
      c.tabela === "acoes" && c.op === "select" ? { data: [{ telefone: "553711110002" }] } : undefined,
    );
    const plano = await tratarRodada(db, { ...rodada, sairam: [{ telefone: "553711110001", admin: false }, { telefone: "553711110002", admin: false }] });
    expect(plano.sairamSozinhos).toEqual(["553711110001"]);
    expect(rpcs(chamadas, "por_tag")).toEqual([{ p_telefones: ["553711110001"], p_tag: "tag-saiu", p_campanha: "c1" }]);
  });

  it("rodada sem ninguém entrando nem saindo não toca no banco", async () => {
    const { db, chamadas } = banco();
    const plano = await tratarRodada(db, rodada);
    expect(chamadas).toEqual([]);
    expect(plano).toEqual({ removerBloqueio: [], removerDuplicado: [], ganhamCampanha: [], sairamSozinhos: [], ganhamSaiu: [], duplicadosMantidos: [] });
  });

  it("só conexão como pendente a remoção que já venceu (executar_apos <= agora)", async () => {
    const { db, chamadas } = banco();
    await tratarRodada(db, { ...rodada, sairam: [{ telefone: "553711110001", admin: false }] });
    const p = chamadas.find((c) => c.tabela === "acoes" && c.op === "select")!;
    expect(filtro(p, "lte", "executar_apos")).toBe(rodada.agora);
  });

  it("falha nas tags: lança antes do alerta (a próxima rodada alerta uma vez só, quando der certo)", async () => {
    const { db } = banco((c) => {
      if (c.tabela === "bloqueados_efetivos") return { data: [{ telefone: "553711110001" }] };
      if (c.tabela === "rpc:por_tag") return { error: { message: "rpc caiu" } };
      return undefined;
    });
    await expect(tratarRodada(db, { ...rodada, entraram: [{ telefone: "553711110001", admin: false }, { telefone: "553711110002", admin: false }] })).rejects.toThrow(/rpc caiu/);
    expect(alertarMock).not.toHaveBeenCalled();
  });

  it("rodada suspeita (pularDuplicados): remove bloqueado, não remove duplicado e alerta quantos ficaram", async () => {
    const { db, chamadas } = banco((c) => {
      if (c.tabela === "bloqueados_efetivos") return { data: [{ telefone: "553711110001" }] };
      if (c.tabela === "participantes") return { data: [{ telefone: "553711110002", grupo_id: "g2" }, { telefone: "553711110003", grupo_id: "g2" }] };
      return undefined;
    });
    const plano = await tratarRodada(db, {
      ...rodada,
      pularDuplicados: true,
      entraram: ["553711110001", "553711110002", "553711110003"].map((telefone) => ({ telefone, admin: false })),
    });
    expect(inserts(chamadas, "acoes")).toEqual([expect.objectContaining({ telefone: "553711110001", origem: "bloqueado" })]);
    expect(plano.removerDuplicado).toEqual([]);
    expect(plano.duplicadosMantidos).toEqual(["553711110002", "553711110003"]);
    const alertas = alertarMock.mock.calls.map((c) => c[0] as { tipo: string; texto: string });
    expect(alertas.map((a) => a.tipo)).toEqual(["bloqueado_removido", "criacao_erro"]);
    expect(alertas[1].texto).toMatch(/2 duplicados/);
  });

  it("sem candidatos não consulta bloqueados nem participações", async () => {
    const { db, chamadas } = banco();
    await tratarRodada(db, { ...rodada, entraram: [{ telefone: "553711110001", admin: true }] });
    expect(chamadas.some((c) => c.tabela === "bloqueados_efetivos" || c.tabela === "participantes")).toBe(false);
  });

  it("número conectado (protegido) que entra não sofre regra nem ganha tag", async () => {
    const { db, chamadas } = banco((c) => (c.tabela === "bloqueados_efetivos" ? { data: [{ telefone: "553711110001" }] } : undefined));
    const plano = await tratarRodada(db, { ...rodada, protegidos: ["5537" + "911110001"], entraram: [{ telefone: "553711110001", admin: false }] });
    expect(plano.removerBloqueio).toEqual([]);
    expect(inserts(chamadas, "acoes")).toEqual([]);
    expect(rpcs(chamadas, "por_tag")).toEqual([]);
  });

  it("erro de banco interrompe a rodada (a conferência registra e tenta de novo)", async () => {
    const { db } = banco((c) => (c.tabela === "bloqueados_efetivos" ? { error: { message: "caiu" } } : undefined));
    await expect(tratarRodada(db, { ...rodada, entraram: [{ telefone: "553711110001", admin: false }] })).rejects.toThrow(/caiu/);
  });

  describe("Antispam por Conexões Associadas: não duplica o aviso de bloqueado_removido", () => {
    const CONTA_A = "11111111-1111-1111-1111-111111111111";
    const CONTA_B = "22222222-2222-2222-2222-222222222222";

    it("ligado e a conexão do grupo não autorizada: enfileira a remoção, mas não alerta bloqueado_removido", async () => {
      const { db } = banco((c) => {
        if (c.tabela === "bloqueados_efetivos") return { data: [{ telefone: "553711110001" }] };
        if (c.tabela === "configuracoes") return { data: { valor: { ligado: true, contas: [CONTA_A] } } };
        return undefined;
      });
      await tratarRodada(db, { ...rodada, conexaoId: CONTA_B, entraram: [{ telefone: "553711110001", admin: false }] });
      expect(alertarMock).not.toHaveBeenCalled();
    });

    it("ligado e a conexão do grupo autorizada: alerta normalmente", async () => {
      const { db } = banco((c) => {
        if (c.tabela === "bloqueados_efetivos") return { data: [{ telefone: "553711110001" }] };
        if (c.tabela === "configuracoes") return { data: { valor: { ligado: true, contas: [CONTA_A] } } };
        return undefined;
      });
      await tratarRodada(db, { ...rodada, conexaoId: CONTA_A, entraram: [{ telefone: "553711110001", admin: false }] });
      expect(alertarMock).toHaveBeenCalledTimes(1);
      expect(alertarMock.mock.calls[0][0]).toMatchObject({ tipo: "bloqueado_removido" });
    });

    it("desligado (sem linha): alerta normalmente mesmo sem conexaoId", async () => {
      const { db } = banco((c) => (c.tabela === "bloqueados_efetivos" ? { data: [{ telefone: "553711110001" }] } : undefined));
      await tratarRodada(db, { ...rodada, entraram: [{ telefone: "553711110001", admin: false }] });
      expect(alertarMock).toHaveBeenCalledTimes(1);
      expect(alertarMock.mock.calls[0][0]).toMatchObject({ tipo: "bloqueado_removido" });
    });
  });
});

describe("tratarRodada: seção Checar participantes duplicados (Etapa 3J)", () => {
  const duplicado = () => banco((c) => (c.tabela === "participantes" ? { data: [{ telefone: "553711110001", grupo_id: "g2" }] } : undefined));

  it("checarDuplicados: false não remove duplicado nem alerta, mas ainda dá a tag Campanha", async () => {
    const { db, chamadas } = duplicado();
    const plano = await tratarRodada(db, { ...rodada, checarDuplicados: false, entraram: [{ telefone: "553711110001", admin: false }] });
    expect(plano.removerDuplicado).toEqual([]);
    expect(plano.duplicadosMantidos).toEqual([]);
    expect(inserts(chamadas, "acoes")).toEqual([]);
    expect(alertarMock).not.toHaveBeenCalled();
  });

  it("checarDuplicados: false na rodada suspeita também não alerta duplicado mantido", async () => {
    const { db } = duplicado();
    await tratarRodada(db, { ...rodada, checarDuplicados: false, pularDuplicados: true, entraram: [{ telefone: "553711110001", admin: false }] });
    expect(alertarMock).not.toHaveBeenCalled();
  });

  it("checarDuplicados: true (e sem passar nada) remove como sempre", async () => {
    for (const checarDuplicados of [true, undefined]) {
      const { db, chamadas } = duplicado();
      await tratarRodada(db, { ...rodada, checarDuplicados, entraram: [{ telefone: "553711110001", admin: false }] });
      expect(inserts(chamadas, "acoes")).toEqual([{ tipo: "remover", campanha_id: "c1", grupo_id: "g1", telefone: "553711110001", origem: "duplicado", executar_apos: VENCE_DUPLICADO }]);
    }
  });

  it("bloqueado continua sendo removido com a seção desligada", async () => {
    const { db, chamadas } = banco((c) => (c.tabela === "bloqueados_efetivos" ? { data: [{ telefone: "5537" + "911110001" }] } : undefined));
    await tratarRodada(db, { ...rodada, checarDuplicados: false, entraram: [{ telefone: "553711110001", admin: false }] });
    expect(inserts(chamadas, "acoes")).toEqual([expect.objectContaining({ telefone: "553711110001", origem: "bloqueado" })]);
  });
});

describe("enfileirarRemocoes", () => {
  it("ignora remoção já pendente (23505) e conexão só as novas", async () => {
    // "1" já está na fila: o insert que o inclui (lote ou linha) bate no índice único.
    const comUm = (d: unknown) => ([] as { telefone: string }[]).concat(d as { telefone: string }[]).some((l) => l.telefone === "1");
    const { db, chamadas } = dbFalso((c) => (c.op === "insert" && comUm(c.dados) ? { error: { message: "dup", code: "23505" } } : {}));
    expect(await enfileirarRemocoes(db, { campanhaId: "c1", grupoId: "g1", telefones: ["1", "2"], origem: "bloqueado" })).toBe(1);
    // Lote recusado inteiro e refeito linha a linha.
    expect(chamadas.filter((c) => c.op === "insert").map((c) => (Array.isArray(c.dados) ? "lote" : (c.dados as { telefone: string }).telefone))).toEqual(["lote", "1", "2"]);
  });
  it("vários telefones vão num insert só por lote de 200", async () => {
    const { db, chamadas } = dbFalso();
    const telefones = Array.from({ length: 450 }, (_, i) => String(i));
    expect(await enfileirarRemocoes(db, { campanhaId: "c1", grupoId: "g1", telefones, origem: "campanha_anterior", executarApos: VENCE })).toBe(450);
    const ins = chamadas.filter((c) => c.op === "insert").map((c) => c.dados as unknown[]);
    expect(ins.map((d) => d.length)).toEqual([200, 200, 50]);
    expect(ins[0][0]).toEqual({ tipo: "remover", campanha_id: "c1", grupo_id: "g1", telefone: "0", origem: "campanha_anterior", executar_apos: VENCE });
  });
  it("sem executarApos não manda a coluna (vale o default do banco)", async () => {
    const { db, chamadas } = dbFalso();
    await enfileirarRemocoes(db, { campanhaId: "c1", grupoId: "g1", telefones: ["1"], origem: "manual" });
    expect(chamadas[0].dados).not.toHaveProperty("executar_apos");
  });
  it("bloqueio em cima de remoção já na fila: vira bloqueado, perde a automação e é antecipada pra agora se estava pro futuro", async () => {
    const { db, chamadas } = dbFalso((c) => (c.op === "insert" ? { error: { message: "dup", code: "23505" } } : {}));
    const antes = Date.now();
    expect(await enfileirarRemocoes(db, { campanhaId: "c1", grupoId: "g1", telefones: ["5537" + "911110001"], origem: "bloqueado" })).toBe(0);
    const ups = chamadas.filter((c) => c.tabela === "acoes" && c.op === "update");
    expect(ups).toHaveLength(2);
    for (const u of ups) {
      expect(filtro(u, "eq", "tipo")).toBe("remover");
      expect(filtro(u, "eq", "grupo_id")).toBe("g1");
      expect(filtro(u, "eq", "telefone")).toBe("5537" + "911110001");
      expect(filtro(u, "eq", "status")).toBe("fila");
    }
    expect(ups[0].dados).toEqual({ origem: "bloqueado", automacao_id: null });
    const agora = (ups[1].dados as { executar_apos: string }).executar_apos;
    expect(Date.parse(agora)).toBeGreaterThanOrEqual(antes);
    expect(Date.parse(agora)).toBeLessThanOrEqual(Date.now());
    // Só antecipa: remoção que já vence antes fica como está.
    expect(filtro(ups[1], "gt", "executar_apos")).toBe(agora);
  });

  it("bloqueio com executarApos antecipa até esse instante (não além)", async () => {
    const { db, chamadas } = dbFalso((c) => (c.op === "insert" ? { error: { message: "dup", code: "23505" } } : {}));
    await enfileirarRemocoes(db, { campanhaId: "c1", grupoId: "g1", telefones: ["1"], origem: "bloqueado", executarApos: VENCE });
    const data = chamadas.filter((c) => c.op === "update").at(-1)!;
    expect(data.dados).toEqual({ executar_apos: VENCE });
    expect(filtro(data, "gt", "executar_apos")).toBe(VENCE);
  });

  it("duplicado em cima de remoção já na fila não mexe na que existe", async () => {
    const { db, chamadas } = dbFalso((c) => (c.op === "insert" ? { error: { message: "dup", code: "23505" } } : {}));
    await enfileirarRemocoes(db, { campanhaId: "c1", grupoId: "g1", telefones: ["1"], origem: "duplicado" });
    expect(chamadas.some((c) => c.op === "update")).toBe(false);
  });

  it("erro ao priorizar o bloqueio lança", async () => {
    const { db } = dbFalso((c) => (c.op === "insert" ? { error: { message: "dup", code: "23505" } } : c.op === "update" ? { error: { message: "update caiu" } } : {}));
    await expect(enfileirarRemocoes(db, { campanhaId: "c1", grupoId: "g1", telefones: ["1"], origem: "bloqueado" })).rejects.toThrow(/update caiu/);
  });

  it("outro erro lança", async () => {
    const { db } = dbFalso(() => ({ error: { message: "sem permissão" } }));
    await expect(enfileirarRemocoes(db, { campanhaId: "c1", grupoId: "g1", telefones: ["1"], origem: "bloqueado" })).rejects.toThrow(/sem permissão/);
  });
});
