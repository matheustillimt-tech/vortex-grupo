import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, type Chamada, type Resposta } from "./apoio/db-falso";

const hoisted = vi.hoisted(() => ({
  dbAtual: undefined as unknown,
  dispararAutomacoesMock: vi.fn(async (..._a: unknown[]) => 0),
  alertarMock: vi.fn(async (_a: unknown, _db?: unknown) => undefined),
  obterGrupoMock: vi.fn(async (..._a: unknown[]) => null as unknown),
}));

vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => hoisted.dbAtual }));
vi.mock("@/src/lib/automacoes", () => ({
  dispararAutomacoes: hoisted.dispararAutomacoesMock,
  dispararPorPessoas: vi.fn(async () => 0),
  telefonesProtegidos: vi.fn(async () => new Set<string>()),
}));
vi.mock("@/src/lib/jobs/alertas", () => ({ alertar: hoisted.alertarMock }));
vi.mock("@/src/lib/conexoes", () => ({ paraZapbot: (c: { id: string }) => ({ id: c.id, token: "t", clientToken: "c" }) }));
vi.mock("@/src/lib/zapbot/client", () => ({ zapbot: () => ({ obterGrupo: hoisted.obterGrupoMock }) }));

import { conferirGrupos } from "@/src/lib/jobs/conferir-grupos";

const NOSSO = "5511" + "999990000";
const prazo = () => ({ ate: Date.now() + 60_000 });

/** Grupo com `n` pessoas (o nosso número + n-1), todas já conhecidas (sem entrada nem saída na rodada). */
function montar(o: { n: number; cheio: boolean; cheioManual: boolean | null; limite?: number; sumiu?: boolean }) {
  const telefones = [NOSSO, ...Array.from({ length: o.n - 1 }, (_, i) => `55119${String(i).padStart(8, "0")}`)];
  const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
    if (c.tabela === "conexoes" && c.op === "select") return { data: [{ id: "con1", status: "conectado", telefone: NOSSO, proxima_conferencia_em: "2026-10-16T00:00:00.000Z" }] };
    if (c.tabela === "conexoes" && c.op === "update") return { data: [{ id: "con1" }] };
    if (c.tabela === "grupos" && c.op === "select") {
      return {
        data: [{ id: "g1", campanha_id: "c1", group_id: "g1@g.us", nome: "Turma 01", cheio: o.cheio, cheio_manual: o.cheioManual, conferido_em: null, leitura_suspeita_desde: null, campanhas: { nome: "Camp", limite_por_grupo: o.limite ?? 1000, crm_webhook_url: null, slug: "aulao" } }],
      };
    }
    if (c.tabela === "participantes" && c.op === "select") {
      // Lido em páginas (`range`): devolve só a página pedida.
      const r = c.filtros.find((f) => f[0] === "range") as [string, number, number] | undefined;
      const todos = telefones.map((telefone) => ({ telefone, admin: telefone === NOSSO }));
      return { data: r ? todos.slice(r[1], r[2] + 1) : todos };
    }
    if (c.tabela === "webhooks" && c.op === "select") return { data: [] };
    return {};
  });
  hoisted.dbAtual = db;
  hoisted.obterGrupoMock.mockResolvedValue(o.sumiu ? null : { name: "Turma 01", participants: telefones.map((phone) => ({ phone, isAdmin: phone === NOSSO })) });
  return chamadas;
}

const updateGrupo = (cs: Chamada[]) => cs.find((c) => c.tabela === "grupos" && c.op === "update")?.dados as Record<string, unknown> | undefined;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("conferirGrupos: cheio manual (Etapa 3E)", () => {
  it("automático (null): igual a antes, cheio pela contagem real contra o limite da campanha", async () => {
    const cs = montar({ n: 10, cheio: false, cheioManual: null, limite: 10 });
    await conferirGrupos(prazo());
    expect(updateGrupo(cs)).toMatchObject({ participantes: 10, cheio: true });
    expect(hoisted.dispararAutomacoesMock).toHaveBeenCalledWith({ campanhaId: "c1", gatilho: "grupo_cheio", grupoId: "g1" }, expect.any(Date), expect.anything());
  });

  it("automático (null): cheio pela estimativa do link volta a ter vaga com a contagem real", async () => {
    const cs = montar({ n: 5, cheio: true, cheioManual: null, limite: 10 });
    await conferirGrupos(prazo());
    expect(updateGrupo(cs)).toMatchObject({ participantes: 5, cheio: false });
  });

  it("marcado cheio à mão: mantém cheio e atualiza participantes, sem alerta nem automações de grupo cheio", async () => {
    const cs = montar({ n: 5, cheio: false, cheioManual: true, limite: 10 });
    await conferirGrupos(prazo());
    expect(updateGrupo(cs)).toMatchObject({ participantes: 5, cheio: true });
    expect(hoisted.dispararAutomacoesMock).not.toHaveBeenCalled();
    expect(hoisted.alertarMock).not.toHaveBeenCalled();
  });

  it("marcado não cheio à mão: mantém não cheio mesmo com a contagem no limite da campanha", async () => {
    const cs = montar({ n: 12, cheio: false, cheioManual: false, limite: 10 });
    await conferirGrupos(prazo());
    expect(updateGrupo(cs)).toMatchObject({ participantes: 12, cheio: false });
  });

  it("marcado não cheio à mão, mas com 1024 pessoas (limite do WhatsApp): vira cheio", async () => {
    const cs = montar({ n: 1024, cheio: false, cheioManual: false, limite: 1024 });
    await conferirGrupos(prazo());
    expect(updateGrupo(cs)).toMatchObject({ participantes: 1024, cheio: true });
  });

  it("grupo sumiu do WhatsApp: fica inativo e suspenso", async () => {
    const cs = montar({ n: 3, cheio: false, cheioManual: null, sumiu: true });
    await conferirGrupos(prazo());
    expect(updateGrupo(cs)).toEqual({ ativo: false, suspenso: true });
    expect(hoisted.alertarMock).toHaveBeenCalledWith(expect.objectContaining({ tipo: "grupo_sumiu", conexaoId: "con1" }), expect.anything());
  });
});

describe("conferirGrupos: lotação manual não avisa (Etapa 3E, revisão)", () => {
  it("marcado não cheio que chega a 1024: vira cheio, mas sem alerta nem automações de grupo cheio", async () => {
    const cs = montar({ n: 1024, cheio: false, cheioManual: false, limite: 1024 });
    await conferirGrupos(prazo());
    expect(updateGrupo(cs)).toMatchObject({ cheio: true });
    expect(hoisted.dispararAutomacoesMock).not.toHaveBeenCalled();
    expect(hoisted.alertarMock).not.toHaveBeenCalled();
  });
});
