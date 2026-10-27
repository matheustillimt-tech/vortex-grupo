import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, type Chamada, type Resposta } from "./apoio/db-falso";

const hoisted = vi.hoisted(() => ({
  dbAtual: undefined as unknown,
  dispararAutomacoesMock: vi.fn(async (..._a: unknown[]) => 0),
  alertarMock: vi.fn(async (_a: unknown, _db?: unknown) => undefined),
  obterGrupoMock: vi.fn(async (..._a: unknown[]) => null as unknown),
}));

vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => hoisted.dbAtual }));
vi.mock("@/src/lib/automacoes", () => ({ dispararAutomacoes: hoisted.dispararAutomacoesMock, dispararPorPessoas: vi.fn(async () => 0), telefonesProtegidos: async () => new Set<string>() }));
vi.mock("@/src/lib/jobs/alertas", () => ({ alertar: hoisted.alertarMock }));
vi.mock("@/src/lib/conexoes", () => ({ paraZapbot: (c: { id: string }) => ({ id: c.id, token: "t", clientToken: "c" }) }));
vi.mock("@/src/lib/zapbot/client", () => ({ zapbot: () => ({ obterGrupo: hoisted.obterGrupoMock, pedidosPendentes: async () => [] }) }));

import { NextRequest } from "next/server";
import { GET } from "@/app/l/[slug]/route";
import { conferirGrupos } from "@/src/lib/jobs/conferir-grupos";

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.dispararAutomacoesMock.mockResolvedValue(0);
});

const tipos = () => hoisted.alertarMock.mock.calls.map((c) => (c[0] as { tipo: string }).tipo);

describe("link (/l/[slug]): grupo vira cheio pela estimativa", () => {
  const grupo = { id: "g1", nome: "Turma 01", numero: 1, cheio: false, ativo: true, link_convite: "https://chat.whatsapp.com/ABC", participantes: 10, conferido_em: null };
  function montar(virou: boolean) {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "campanhas") return { data: { id: "c1", limite_por_grupo: 10, arquivada: false } };
      if (c.tabela === "grupos" && c.op === "update") return { data: virou ? [{ id: "g1" }] : [] };
      if (c.tabela === "grupos") return { data: [grupo] };
      return {};
    });
    hoisted.dbAtual = db;
    return chamadas;
  }
  const pedir = () => GET(new NextRequest("https://grupos.test/l/aulao", { headers: { "user-agent": "Safari" } }), { params: Promise.resolve({ slug: "aulao" }) });

  it("quem virou o grupo pra cheio dispara as automações de grupo cheio", async () => {
    montar(true);
    const res = await pedir();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://chat.whatsapp.com/ABC");
    expect(hoisted.dispararAutomacoesMock).toHaveBeenCalledTimes(1);
    expect(hoisted.dispararAutomacoesMock.mock.calls[0][0]).toEqual({ campanhaId: "c1", gatilho: "grupo_cheio", grupoId: "g1" });
    expect(tipos()).toEqual(["grupo_cheio"]);
  });

  it("outro clique já tinha virado (update sem linha): não dispara", async () => {
    montar(false);
    await pedir();
    expect(hoisted.dispararAutomacoesMock).not.toHaveBeenCalled();
  });

  it("falha nas automações: redireciona mesmo assim e avisa com alerta criacao_erro", async () => {
    montar(true);
    hoisted.dispararAutomacoesMock.mockRejectedValueOnce(new Error("fora do ar"));
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await pedir();
    erro.mockRestore();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://chat.whatsapp.com/ABC");
    expect(hoisted.alertarMock.mock.calls[1][0]).toEqual({ tipo: "criacao_erro", campanhaId: "c1", texto: "Grupo Turma 01 encheu, mas as automações não foram agendadas: fora do ar" });
  });
});

describe("link (/l/[slug]): reservar vaga para solicitações pendentes (Etapa 3N)", () => {
  // 5 pessoas, limite 10, sem cliques: só fica cheio se os 5 pedidos reservados contarem.
  const grupo = { id: "g1", nome: "Turma 01", numero: 1, cheio: false, cheio_manual: null, ativo: true, link_convite: "https://chat.whatsapp.com/ABC", participantes: 5, conferido_em: null, pendentes_reservados: 5, pendentes_lidos_em: null as string | null };
  function montar(campanha: Record<string, unknown>) {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "campanhas") return { data: { id: "c1", limite_por_grupo: 10, arquivada: false, ...campanha } };
      if (c.tabela === "grupos" && c.op === "update") return { data: [{ id: "g1" }] };
      if (c.tabela === "grupos") return { data: [grupo] };
      return {};
    });
    hoisted.dbAtual = db;
    return chamadas;
  }
  const pedir = () => GET(new NextRequest("https://grupos.test/l/aulao", { headers: { "user-agent": "Safari" } }), { params: Promise.resolve({ slug: "aulao" }) });
  const marcouCheio = (cs: Chamada[]) => cs.some((c) => c.tabela === "grupos" && c.op === "update");

  it("reserva desligada (ou ausente) ignora a coluna: a conexão de hoje", async () => {
    for (const campanha of [{}, { reservar_vaga_pendentes: false }]) {
      const chamadas = montar(campanha);
      const res = await pedir();
      expect(res.headers.get("location")).toBe("https://chat.whatsapp.com/ABC");
      expect(marcouCheio(chamadas)).toBe(false);
    }
  });

  it("reserva ligada e lida há até 15 min: os pendentes reservados contam contra o limite da campanha", async () => {
    grupo.pendentes_lidos_em = new Date(Date.now() - 60_000).toISOString();
    const chamadas = montar({ reservar_vaga_pendentes: true });
    await pedir();
    expect(marcouCheio(chamadas)).toBe(true);
  });

  it("cheio só por causa da reserva: sai da rotação, mas sem alerta, automações, Hook nem redefinir link (revisão final A)", async () => {
    grupo.pendentes_lidos_em = new Date(Date.now() - 60_000).toISOString();
    const chamadas = montar({ reservar_vaga_pendentes: true, redefinir_link_cheio: true });
    await pedir();
    expect(marcouCheio(chamadas)).toBe(true);
    expect(hoisted.alertarMock).not.toHaveBeenCalled();
    expect(hoisted.dispararAutomacoesMock).not.toHaveBeenCalled();
    expect(chamadas.some((c) => c.tabela === "execucoes" || c.tabela === "webhook_entregas" || c.tabela === "eventos_saida")).toBe(false);
  });

  it("reserva ligada e o grupo cheio também sem a reserva: dispara como sempre", async () => {
    grupo.pendentes_lidos_em = new Date(Date.now() - 60_000).toISOString();
    const antes = grupo.participantes;
    grupo.participantes = 10;
    montar({ reservar_vaga_pendentes: true });
    await pedir();
    grupo.participantes = antes;
    expect(hoisted.dispararAutomacoesMock).toHaveBeenCalledTimes(1);
    expect(tipos()).toEqual(["grupo_cheio"]);
  });

  it("reserva ligada mas velha (mais de 15 min) ou nunca lida: vale 0", async () => {
    for (const lidos of [new Date(Date.now() - 16 * 60_000).toISOString(), null]) {
      grupo.pendentes_lidos_em = lidos;
      const chamadas = montar({ reservar_vaga_pendentes: true });
      await pedir();
      expect(marcouCheio(chamadas)).toBe(false);
    }
  });
});

describe("conferirGrupos: grupo passa a cheio pela contagem real", () => {
  function montar(cheioAntes: boolean) {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "conexoes" && c.op === "select") return { data: [{ id: "con1", status: "conectado", proxima_conferencia_em: "2026-10-16T00:00:00.000Z" }] };
      if (c.tabela === "conexoes" && c.op === "update") return { data: [{ id: "con1" }] };
      if (c.tabela === "grupos" && c.op === "select") {
        return { data: [{ id: "g1", campanha_id: "c1", group_id: "120@g.us", nome: "Turma 01", cheio: cheioAntes, conferido_em: null, campanhas: { nome: "Camp", limite_por_grupo: 2, crm_webhook_url: null, slug: "aulao" } }] };
      }
      if (c.tabela === "participantes" && c.op === "select") return { data: [] };
      if (c.tabela === "tags") return { data: { id: "tag-saiu" } };
      return {};
    });
    hoisted.dbAtual = db;
    hoisted.obterGrupoMock.mockResolvedValue({ name: "Turma 01", participants: [{ phone: "5511" + "999990001", isAdmin: true }, { phone: "5511" + "999990002", isAdmin: false }] });
    return chamadas;
  }
  const prazo = () => ({ ate: Date.now() + 60_000 });

  it("transição não cheio → cheio: alerta e dispara as automações de grupo cheio", async () => {
    const chamadas = montar(false);
    expect(await conferirGrupos(prazo())).toBe(1);
    expect(hoisted.dispararAutomacoesMock).toHaveBeenCalledTimes(1);
    expect(hoisted.dispararAutomacoesMock.mock.calls[0][0]).toEqual({ campanhaId: "c1", gatilho: "grupo_cheio", grupoId: "g1" });
    expect(tipos()).toEqual(["grupo_cheio"]);
    expect(chamadas.some((c) => c.tabela === "conexoes" && c.op === "update" && "ultimo_erro" in (c.dados as object))).toBe(false);
  });

  it("já estava cheio: não dispara de novo", async () => {
    montar(true);
    await conferirGrupos(prazo());
    expect(hoisted.dispararAutomacoesMock).not.toHaveBeenCalled();
  });

  it("falha nas automações: avisa com alerta criacao_erro e a conferência segue ok", async () => {
    montar(false);
    hoisted.dispararAutomacoesMock.mockRejectedValueOnce(new Error("fora do ar"));
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await conferirGrupos(prazo())).toBe(1);
    erro.mockRestore();
    expect(hoisted.alertarMock.mock.calls[1][0]).toEqual({ tipo: "criacao_erro", campanhaId: "c1", texto: "Grupo Turma 01 encheu, mas as automações não foram agendadas: fora do ar", conexaoId: "con1" });
  });
});

describe("conferirGrupos: cheio só por causa da reserva (Etapa 3N, revisão final A)", () => {
  /** 2 pessoas, limite 5: só fica cheio com os reservados (lidos há 1 min, grupo com aprovação). */
  function montar(o: { cheioAntes: boolean; reservados: number; abertos?: number; membros?: number; reserva?: boolean }) {
    const membros = Array.from({ length: o.membros ?? 2 }, (_, i) => ({ phone: `55119999900${String(i + 1).padStart(2, "0")}`, isAdmin: i === 0 }));
    const abertos = membros.slice(0, o.abertos ?? membros.length).map((m) => ({ telefone: m.phone, admin: m.isAdmin }));
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "conexoes" && c.op === "select") return { data: [{ id: "con1", status: "conectado", proxima_conferencia_em: "2026-10-16T00:00:00.000Z" }] };
      if (c.tabela === "conexoes" && c.op === "update") return { data: [{ id: "con1" }] };
      if (c.tabela === "grupos" && c.op === "select") {
        return {
          data: [{
            id: "g1", campanha_id: "c1", group_id: "120@g.us", nome: "Turma 01", cheio: o.cheioAntes, conferido_em: null,
            pendentes_reservados: o.reservados, pendentes_lidos_em: new Date(Date.now() - 60_000).toISOString(),
            campanhas: { nome: "Camp", limite_por_grupo: 5, crm_webhook_url: null, slug: "aulao", aprovacao_entrada: true, reservar_vaga_pendentes: o.reserva ?? true, redefinir_link_cheio: true },
          }],
        };
      }
      if (c.tabela === "participantes" && c.op === "select") return { data: abertos };
      if (c.tabela === "tags") return { data: { id: "tag-saiu" } };
      return {};
    });
    hoisted.dbAtual = db;
    hoisted.obterGrupoMock.mockResolvedValue({ name: "Turma 01", requireApproval: true, participants: membros });
    return chamadas;
  }
  const prazo = () => ({ ate: Date.now() + 60_000 });
  const cheioGravado = (cs: Chamada[]) => (cs.find((c) => c.tabela === "grupos" && c.op === "update" && "cheio" in (c.dados as object))!.dados as { cheio: boolean }).cheio;
  const efeitos = (cs: Chamada[]) => ({
    alertas: tipos().filter((t) => t === "grupo_cheio").length,
    automacoes: hoisted.dispararAutomacoesMock.mock.calls.length,
    redefinir: cs.filter((c) => c.tabela === "execucoes" && c.op === "insert").length,
  });

  it("não cheio → cheio só pela reserva: grava cheio (vale pro link), sem alerta, automações nem redefinir link", async () => {
    const chamadas = montar({ cheioAntes: false, reservados: 3 });
    await conferirGrupos(prazo());
    expect(cheioGravado(chamadas)).toBe(true);
    expect(efeitos(chamadas)).toEqual({ alertas: 0, automacoes: 0, redefinir: 0 });
  });

  it("já marcado cheio pela reserva e agora enche de verdade: dispara uma vez", async () => {
    // Antes: 2 abertos no banco (não lotava); agora 5 no WhatsApp.
    const chamadas = montar({ cheioAntes: true, reservados: 3, membros: 5, abertos: 2 });
    await conferirGrupos(prazo());
    expect(cheioGravado(chamadas)).toBe(true);
    expect(efeitos(chamadas)).toEqual({ alertas: 1, automacoes: 1, redefinir: 1 });
  });

  it("já estava cheio de verdade (contagem anterior lotada): não dispara de novo", async () => {
    const chamadas = montar({ cheioAntes: true, reservados: 3, membros: 5, abertos: 5 });
    await conferirGrupos(prazo());
    expect(efeitos(chamadas)).toEqual({ alertas: 0, automacoes: 0, redefinir: 0 });
  });

  it("reserva desligada: enchimento real dispara como sempre; estava cheio, não", async () => {
    let chamadas = montar({ cheioAntes: false, reservados: 0, membros: 5, reserva: false });
    await conferirGrupos(prazo());
    expect(efeitos(chamadas)).toEqual({ alertas: 1, automacoes: 1, redefinir: 1 });
    vi.clearAllMocks();
    chamadas = montar({ cheioAntes: true, reservados: 0, membros: 5, abertos: 2, reserva: false });
    await conferirGrupos(prazo());
    expect(efeitos(chamadas)).toEqual({ alertas: 0, automacoes: 0, redefinir: 0 });
  });
});
