import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, type Chamada, type Resposta } from "./apoio/db-falso";
import {
  ACOES_HISTORICO, AREAS_HISTORICO, acaoValida, agruparPorDia, areaValida, dataHistoricoValida, horaDoRegistro,
  lerFiltrosHistorico, linkDoRegistro, nomeOuEmailHistorico, urlHistorico, type FiltrosHistorico,
} from "@/src/lib/regras/historico";

const hoisted = vi.hoisted(() => ({ adminAtual: undefined as unknown }));
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => hoisted.adminAtual }));

import { registrarHistorico } from "@/src/lib/historico";

function usar(responder?: (c: Chamada) => Resposta) {
  const f = dbFalso(responder);
  hoisted.adminAtual = f.db;
  return f.chamadas;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("registrarHistorico", () => {
  it("grava com o usuário, a ação, a área e o resumo cortado em 300", async () => {
    const chamadas = usar();
    await registrarHistorico({ id: "u1", email: "a@x.com" }, { acao: "adicionar", area: "Campanhas", resumo: "x".repeat(400), refId: "r1" });
    const ins = chamadas.find((c) => c.op === "insert")!;
    expect(ins.tabela).toBe("historico");
    expect(ins.dados).toMatchObject({ usuario_id: "u1", usuario_email: "a@x.com", acao: "adicionar", area: "Campanhas", ref_id: "r1" });
    expect((ins.dados as { resumo: string }).resumo).toHaveLength(300);
  });

  it("sem refId grava ref_id null", async () => {
    const chamadas = usar();
    await registrarHistorico({ id: "u1" }, { acao: "atualizar", area: "Grupos", resumo: "ok" });
    const ins = chamadas.find((c) => c.op === "insert")!;
    expect(ins.dados).toMatchObject({ ref_id: null });
  });

  it("sem usuário grava com os campos de usuário nulos", async () => {
    const chamadas = usar();
    await registrarHistorico(null, { acao: "remover", area: "Leads", resumo: "ok" });
    const ins = chamadas.find((c) => c.op === "insert")!;
    expect(ins.dados).toMatchObject({ usuario_id: null, usuario_email: null });
  });

  it("usuário sem e-mail grava usuario_email null", async () => {
    const chamadas = usar();
    await registrarHistorico({ id: "u1" }, { acao: "remover", area: "Leads", resumo: "ok" });
    const ins = chamadas.find((c) => c.op === "insert")!;
    expect(ins.dados).toMatchObject({ usuario_id: "u1", usuario_email: null });
  });

  it("nunca lança: erro do banco só vira console.error, sem o resumo", async () => {
    usar(() => ({ error: { message: "x" } }));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(registrarHistorico({ id: "u1" }, { acao: "executar", area: "Ações", resumo: "detalhe-sensivel" })).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.join(" ")).not.toContain("detalhe-sensivel");
    spy.mockRestore();
  });

  it("nunca lança: exceção inesperada também só vira console.error", async () => {
    hoisted.adminAtual = {
      from() {
        throw new Error("boom");
      },
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(registrarHistorico({ id: "u1" }, { acao: "executar", area: "Ações", resumo: "ok" })).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe("areaValida", () => {
  it("aceita só as áreas da lista fixa", () => {
    for (const a of AREAS_HISTORICO) expect(areaValida(a)).toBe(true);
    expect(areaValida("Qualquer coisa")).toBe(false);
    expect(areaValida(undefined)).toBe(false);
    expect(areaValida(42)).toBe(false);
  });
});

describe("horaDoRegistro", () => {
  it("formata hh:mm:ss em Brasília", () => {
    expect(horaDoRegistro("2026-10-15T23:30:05-03:00")).toBe("23:30:05");
    expect(horaDoRegistro("2026-10-16T02:30:05Z")).toBe("23:30:05");
  });
});

describe("agruparPorDia", () => {
  it("agrupa por dia de Brasília e formata o rótulo (mês dia, ano), do mais recente pro mais antigo", () => {
    const linhas = [
      { created_at: "2026-10-15T23:30:00-03:00" },
      { created_at: "2026-10-15T10:00:00-03:00" },
      { created_at: "2026-10-14T10:00:00-03:00" },
    ];
    const grupos = agruparPorDia(linhas);
    expect(grupos.map((g) => g.rotulo)).toEqual(["outubro 15, 2026", "outubro 14, 2026"]);
    expect(grupos[0].linhas).toHaveLength(2);
    expect(grupos[1].linhas).toHaveLength(1);
  });

  it("horário perto da virada em UTC ainda cai no dia certo de Brasília (UTC-3)", () => {
    const linhas = [{ created_at: "2026-10-16T02:30:00Z" }]; // 23:30 de 15/10 em Brasília
    const grupos = agruparPorDia(linhas);
    expect(grupos[0].rotulo).toBe("outubro 15, 2026");
  });

  it("lista vazia não gera grupo nenhum", () => {
    expect(agruparPorDia([])).toEqual([]);
  });
});

describe("nomeOuEmailHistorico", () => {
  const membros = [{ usuario_id: "u1", nome: "Ana Paula" }];

  it("com membro, mostra o nome", () => {
    expect(nomeOuEmailHistorico("u1", "ana@x.com", membros)).toBe("Ana Paula");
  });

  it("sem membro (ex-membro ou usuario_id nulo), cai pra parte local do e-mail (Etapa 3N, Task 7)", () => {
    expect(nomeOuEmailHistorico("u2", "fulano@x.com", membros)).toBe("fulano");
    expect(nomeOuEmailHistorico(null, "sistema@x.com", membros)).toBe("sistema");
  });

  it("sem membro e sem e-mail, mostra um traço", () => {
    expect(nomeOuEmailHistorico(null, null, membros)).toBe("—");
  });
});

describe("acaoValida", () => {
  it("aceita só as ações da lista fixa", () => {
    for (const a of ACOES_HISTORICO) expect(acaoValida(a)).toBe(true);
    expect(acaoValida("qualquer")).toBe(false);
    expect(acaoValida(undefined)).toBe(false);
  });
});

describe("dataHistoricoValida", () => {
  it("aceita só AAAA-MM-DD", () => {
    expect(dataHistoricoValida("2026-10-17")).toBe(true);
    expect(dataHistoricoValida("17/10/2026")).toBe(false);
    expect(dataHistoricoValida("")).toBe(false);
  });

  it("rejeita data impossível mesmo com o formato certo", () => {
    expect(dataHistoricoValida("2026-02-31")).toBe(false);
    expect(dataHistoricoValida("2026-13-01")).toBe(false);
    expect(dataHistoricoValida("2026-00-10")).toBe(false);
    expect(dataHistoricoValida("2026-02-29")).toBe(false); // 2026 não é bissexto
    expect(dataHistoricoValida("2024-02-29")).toBe(true); // 2024 é bissexto
  });
});

describe("linkDoRegistro", () => {
  const UUID = "11111111-1111-1111-1111-111111111111";
  it("Campanhas, Automações, Modelos e Projetos com ref_id uuid vão para a página do objeto", () => {
    expect(linkDoRegistro("Campanhas", UUID)).toBe(`/campanhas/${UUID}`);
    expect(linkDoRegistro("Automações", UUID)).toBe(`/automacoes/${UUID}`);
    expect(linkDoRegistro("Modelos", UUID)).toBe(`/modelos/${UUID}`);
    expect(linkDoRegistro("Projetos", UUID)).toBe(`/projetos/${UUID}`);
  });
  it("área sem rota conhecida não gera link", () => {
    expect(linkDoRegistro("Equipe", UUID)).toBeNull();
  });
  it("ref_id que não é uuid não gera link, mesmo numa área conhecida", () => {
    expect(linkDoRegistro("Campanhas", "não-é-uuid")).toBeNull();
    expect(linkDoRegistro("Campanhas", null)).toBeNull();
  });
});

describe("lerFiltrosHistorico", () => {
  it("valor inválido vira filtro vazio em vez de erro no banco", () => {
    const f = lerFiltrosHistorico({ area: "Qualquer coisa", acao: "voar", membro: "não-uuid", desde: "17/10/2026", ate: "x", id: "ref-1", pagina: "2" });
    expect(f).toEqual({ q: "", area: "", acao: "", membroId: "", desde: "", ate: "", refId: "ref-1", pagina: 2 });
  });
  it("lê os filtros válidos", () => {
    const UUID = "11111111-1111-1111-1111-111111111111";
    const f = lerFiltrosHistorico({ q: "oi", area: "Campanhas", acao: "adicionar", membro: UUID, desde: "2026-10-01", ate: "2026-10-17" });
    expect(f).toEqual({ q: "oi", area: "Campanhas", acao: "adicionar", membroId: UUID, desde: "2026-10-01", ate: "2026-10-17", refId: "", pagina: 1 });
  });
});

describe("urlHistorico", () => {
  const BASE: FiltrosHistorico = { q: "", area: "", acao: "", membroId: "", desde: "", ate: "", refId: "", pagina: 1 };
  it("sem filtro nenhum fica só a rota", () => {
    expect(urlHistorico(BASE, {})).toBe("/historico");
  });
  it("monta a query com os filtros presentes e volta pra página 1 ao trocar filtro", () => {
    expect(urlHistorico({ ...BASE, pagina: 3 }, { area: "Campanhas" })).toBe("/historico?area=Campanhas");
  });
  it("preserva a página quando ela é o que está mudando", () => {
    expect(urlHistorico({ ...BASE, area: "Campanhas" }, { pagina: 2 })).toBe("/historico?area=Campanhas&pagina=2");
  });
});
