import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, type Chamada, type Resposta } from "./apoio/db-falso";

const hoisted = vi.hoisted(() => ({
  dbAtual: undefined as unknown,
  exigirUsuarioMock: vi.fn(async () => ({ id: "u1" })),
  revalidar: vi.fn(),
  redirectMock: vi.fn(),
  historicoMock: vi.fn(),
}));

vi.mock("@/src/lib/permissoes", async () => (await import("./apoio/permissoes")).permissoesFalsas());
vi.mock("@/src/lib/supabase/usuario", () => ({
  exigirUsuario: hoisted.exigirUsuarioMock,
  dbUsuario: async () => hoisted.dbAtual,
}));
vi.mock("next/cache", () => ({ revalidatePath: hoisted.revalidar }));
vi.mock("next/navigation", () => ({ redirect: hoisted.redirectMock }));
vi.mock("@/src/lib/historico", () => ({ registrarHistorico: hoisted.historicoMock }));

import { salvarCampanha } from "@/app/(painel)/campanhas/actions";
import type { CampanhaEntrada } from "@/src/lib/regras/campanha";

const CAMPANHA_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const PROJETO_ID = "bbbbbbbb-2222-4222-8222-222222222222";

const entradaBase: CampanhaEntrada = {
  nome: "Aulão", slug: "aulao", padrao_nome: "AULÃO #{n}", descricao: "", fechado: true,
  limite_por_grupo: 1000, folga: 1, conexao_criadora_id: "c1", admins: [], usar_comunidade: false, crm_webhook_url: "",
  projeto_id: null,
};

function usar(responder: (c: Chamada) => Resposta) {
  const f = dbFalso(responder);
  hoisted.dbAtual = f.db;
  return { chamadas: f.chamadas };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("salvarCampanha e projeto", () => {
  it("sem projeto: não consulta a tabela projetos", async () => {
    const { chamadas } = usar((c) => (c.tabela === "campanhas" ? { data: { id: CAMPANHA_ID } } : {}));
    const r = await salvarCampanha(null, entradaBase);
    expect(r.erro).toBeUndefined();
    expect(chamadas.some((c) => c.tabela === "projetos")).toBe(false);
  });

  it("projeto_id inválido (não é uuid nem null): recusa antes de tocar no banco", async () => {
    const { chamadas } = usar(() => ({}));
    const r = await salvarCampanha(null, { ...entradaBase, projeto_id: "não-é-uuid" });
    expect(r).toEqual({ erro: "Projeto inválido." });
    expect(chamadas).toEqual([]);
  });

  it("projeto inexistente: erro 'Projeto não encontrado.' e não cria a campanha", async () => {
    const { chamadas } = usar((c) => (c.tabela === "projetos" ? { data: null } : {}));
    const r = await salvarCampanha(null, { ...entradaBase, projeto_id: PROJETO_ID });
    expect(r).toEqual({ erro: "Projeto não encontrado." });
    expect(chamadas.some((c) => c.tabela === "campanhas")).toBe(false);
  });

  it("projeto existente: grava projeto_id, revalida /projetos/[id] e registra no histórico", async () => {
    const { chamadas } = usar((c) => {
      if (c.tabela === "projetos") return { data: { id: PROJETO_ID, nome: "Lançamento" } };
      if (c.tabela === "campanhas") return { data: { id: CAMPANHA_ID } };
      return {};
    });
    const r = await salvarCampanha(null, { ...entradaBase, projeto_id: PROJETO_ID });
    expect(r.erro).toBeUndefined();

    const ins = chamadas.find((c) => c.tabela === "campanhas" && c.op === "insert")!;
    expect((ins.dados as Record<string, unknown>).projeto_id).toBe(PROJETO_ID);

    expect(hoisted.revalidar).toHaveBeenCalledWith("/projetos");
    expect(hoisted.revalidar).toHaveBeenCalledWith(`/projetos/${PROJETO_ID}`);

    expect(hoisted.historicoMock).toHaveBeenCalledWith(
      { id: "u1" },
      expect.objectContaining({ resumo: expect.stringContaining("no projeto Lançamento") }),
    );
  });
});
