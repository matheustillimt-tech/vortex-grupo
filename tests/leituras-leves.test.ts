import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, filtro, type Chamada, type Resposta } from "./apoio/db-falso";

/* Etapa 3M, Task 1: leituras mais baratas do `GET groups/{id}`. A conferência pula o link (nunca usou) e continua
   lendo os participantes; a troca de dono em links.ts tenta a leitura leve antes da completa. */

const hoisted = vi.hoisted(() => ({
  dbAtual: undefined as unknown,
  alertarMock: vi.fn(async (_a: unknown, _db?: unknown) => undefined),
  statusMock: vi.fn(async (..._a: unknown[]) => ({ connected: true, phone: "" }) as { connected: boolean; phone: string }),
  obterGrupoMock: vi.fn(async (..._a: unknown[]) => null as unknown),
}));

vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => hoisted.dbAtual }));
vi.mock("@/src/lib/automacoes", () => ({ dispararAutomacoes: vi.fn(async () => 0), dispararPorPessoas: vi.fn(async () => 0), telefonesProtegidos: async () => new Set<string>() }));
vi.mock("@/src/lib/jobs/alertas", () => ({ alertar: hoisted.alertarMock }));
vi.mock("@/src/lib/conexoes", () => ({ paraZapbot: (c: { id: string }) => ({ id: c.id, token: "t", clientToken: "c" }) }));
vi.mock("@/src/lib/zapbot/client", () => ({ zapbot: () => ({ status: hoisted.statusMock, obterGrupo: hoisted.obterGrupoMock }) }));

import { conferirGrupos } from "@/src/lib/jobs/conferir-grupos";
import { trocarDonoECorrigirLinks } from "@/src/lib/jobs/links";

const prazo = () => ({ ate: Date.now() + 60_000 });

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.statusMock.mockResolvedValue({ connected: true, phone: "" });
  hoisted.obterGrupoMock.mockResolvedValue(null);
});

describe("conferência: GET do grupo sem o link, com os participantes", () => {
  const NOSSO = "5511" + "999990000";
  function montar() {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "conexoes" && c.op === "select") return { data: [{ id: "con1", status: "conectado", telefone: NOSSO, proxima_conferencia_em: "2026-10-16T00:00:00.000Z" }] };
      if (c.tabela === "conexoes" && c.op === "update") return { data: [{ id: "con1" }] };
      if (c.tabela === "grupos" && c.op === "select") {
        return { data: [{ id: "g1", campanha_id: "c1", group_id: "g1@g.us", nome: "Turma 01", cheio: false, conferido_em: null, leitura_suspeita_desde: null, campanhas: { nome: "Camp", limite_por_grupo: 1000, crm_webhook_url: null, slug: "aulao" } }] };
      }
      if (c.tabela === "participantes" && c.op === "select") {
        if (filtro(c, "eq", "grupos.campanha_id") || filtro(c, "in", "grupos.campanha_id")) return { data: [] };
        return { data: [{ telefone: NOSSO, admin: true }] };
      }
      if (c.tabela === "bloqueados_efetivos") return { data: [] };
      if (c.tabela === "acoes" && c.op === "select") return { data: [] };
      if (c.tabela === "webhooks" && c.op === "select") return { data: [] };
      if (c.tabela === "tags") return { data: { id: "tag-saiu" } };
      if (c.tabela === "rpc:tag_da_campanha") return { data: "tag-camp" };
      return {};
    });
    hoisted.dbAtual = db;
    return chamadas;
  }

  it("chama obterGrupo com { link: false } (inviteLink=false) e só isso", async () => {
    montar();
    hoisted.obterGrupoMock.mockResolvedValue({ groupId: "g1@g.us", name: "Turma 01", amAdmin: true, participantCount: 1, participants: [{ phone: NOSSO, isAdmin: true }] });
    await conferirGrupos(prazo());
    expect(hoisted.obterGrupoMock.mock.calls.map((c) => c.slice(1))).toEqual([["g1@g.us", { link: false }]]);
  });

  it("continua lendo os participantes: quem entrou é gravado como sempre", async () => {
    const chamadas = montar();
    hoisted.obterGrupoMock.mockResolvedValue({
      groupId: "g1@g.us", name: "Turma 01", amAdmin: true, participantCount: 2,
      participants: [{ phone: NOSSO, isAdmin: true }, { phone: "5511" + "900000001", isAdmin: false }],
    });
    await conferirGrupos(prazo());
    const entrada = chamadas.find((c) => c.tabela === "participantes" && c.op === "insert")!.dados as { telefone: string }[];
    expect(entrada.map((e) => e.telefone)).toEqual(["5511" + "900000001"]);
  });
});

describe("troca de dono (links.ts): leitura leve antes da completa", () => {
  const CAIDA = { id: "caida", nome: "Conexão A", status: "desconectado", caiu_em: "2026-10-17T11:40:00.000Z" };
  const RESERVA = { id: "reserva", nome: "Conexão B", status: "conectado", telefone: "5511" + "999990002", zapbot_id: "z", zapbot_token_enc: "t", client_token_enc: "c" };
  const GRUPO = { id: "g1", nome: "Turma 01", group_id: "120@g.us", campanha_id: "c1", campanhas: { nome: "Lançamento", conexao_criadora_id: "caida" } };
  const agora = new Date("2026-10-17T12:00:30.000Z");
  const LEVE = { participantes: false, link: false };

  function montar() {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "conexoes" && filtro(c, "eq", "id") === "caida") return { data: CAIDA };
      if (c.tabela === "conexoes") return { data: [RESERVA] };
      if (c.tabela === "grupos" && c.op === "select") return { data: [GRUPO] };
      if (c.tabela === "grupos" && c.op === "update") return { data: [{ id: "g1" }] };
      if (c.tabela === "campanha_conexoes") return { data: [{ conexao_id: "reserva" }] };
      if (c.tabela === "participantes") return { data: [{ grupo_id: "g1", telefone: "5511" + "999990002" }] };
      if (c.tabela === "alertas") return { data: [] };
      return {};
    });
    return { db, chamadas };
  }
  const opcoesDasChamadas = () => hoisted.obterGrupoMock.mock.calls.map((c) => c[2]);
  const trocou = (cs: Chamada[]) => cs.some((c) => c.tabela === "grupos" && c.op === "update");
  const leve = (amAdmin: boolean) => ({ groupId: "120@g.us", name: "Turma 01", amAdmin, participantCount: 3, participants: [] });

  it("leve com amAdmin true: escolhe a conexão sem fazer a leitura completa", async () => {
    hoisted.obterGrupoMock.mockResolvedValueOnce(leve(true));
    const { db, chamadas } = montar();
    expect((await trocarDonoECorrigirLinks("caida", prazo(), db, agora)).movidos).toBe(1);
    expect(opcoesDasChamadas()).toEqual([LEVE]);
    expect(trocou(chamadas)).toBe(true);
  });

  it("leve com amAdmin false: faz a leitura completa de sempre e decide igual (admin pela lista → troca)", async () => {
    hoisted.obterGrupoMock
      .mockResolvedValueOnce(leve(false))
      .mockResolvedValueOnce({ groupId: "120@g.us", name: "Turma 01", amAdmin: false, participantCount: 3, participants: [{ phone: "5511" + "999990002", isAdmin: true }] });
    const { db, chamadas } = montar();
    expect((await trocarDonoECorrigirLinks("caida", prazo(), db, agora)).movidos).toBe(1);
    expect(opcoesDasChamadas()).toEqual([LEVE, undefined]);
    expect(hoisted.obterGrupoMock.mock.calls[1].length).toBe(2); // a completa é a chamada de hoje, sem opções
    expect(trocou(chamadas)).toBe(true);
  });

  it("leve com amAdmin false e completa sem admin: não troca (igual a hoje)", async () => {
    hoisted.obterGrupoMock
      .mockResolvedValueOnce(leve(false))
      .mockResolvedValueOnce({ groupId: "120@g.us", name: "Turma 01", amAdmin: false, participantCount: 3, participants: [{ phone: "5511" + "999990002", isAdmin: false }] });
    const { db, chamadas } = montar();
    expect((await trocarDonoECorrigirLinks("caida", prazo(), db, agora)).movidos).toBe(0);
    expect(opcoesDasChamadas()).toEqual([LEVE, undefined]);
    expect(trocou(chamadas)).toBe(false);
  });

  it("erro na leitura leve: segue para a completa (nunca escolhe conexão sem confirmação)", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    hoisted.obterGrupoMock.mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce(leve(true));
    const { db } = montar();
    expect((await trocarDonoECorrigirLinks("caida", prazo(), db, agora)).movidos).toBe(1);
    expect(opcoesDasChamadas()).toEqual([LEVE, undefined]);

    vi.clearAllMocks();
    hoisted.statusMock.mockResolvedValue({ connected: true, phone: "" });
    hoisted.obterGrupoMock.mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce(null);
    const segundo = montar();
    expect((await trocarDonoECorrigirLinks("caida", prazo(), segundo.db, agora)).movidos).toBe(0);
    expect(trocou(segundo.chamadas)).toBe(false);
    erro.mockRestore();
  });

  it("leve devolve null (grupo não encontrado): faz a completa antes de desistir", async () => {
    hoisted.obterGrupoMock.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    const { db, chamadas } = montar();
    expect((await trocarDonoECorrigirLinks("caida", prazo(), db, agora)).movidos).toBe(0);
    expect(opcoesDasChamadas()).toEqual([LEVE, undefined]);
    expect(trocou(chamadas)).toBe(false);
  });
});
