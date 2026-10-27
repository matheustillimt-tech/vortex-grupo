import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, type Chamada } from "./apoio/db-falso";

const hoisted = vi.hoisted(() => ({ dbAtual: undefined as unknown }));
vi.mock("@/src/lib/supabase/usuario", () => ({ dbUsuario: async () => hoisted.dbAtual }));

import { carregarOpcoesAssistente } from "@/app/(painel)/automacoes/opcoes-assistente";

const CAMP = "11111111-1111-1111-1111-111111111111";

function consultaCampanhas(chamadas: Chamada[]) {
  return chamadas.find((c) => c.tabela === "campanhas")!;
}

beforeEach(() => vi.clearAllMocks());

describe("carregarOpcoesAssistente", () => {
  it("sem campanha (automação nova): só as não arquivadas, sem .or", async () => {
    const { db, chamadas } = dbFalso(() => ({ data: [] }));
    hoisted.dbAtual = db;
    await carregarOpcoesAssistente();
    const c = consultaCampanhas(chamadas);
    expect(c.filtros).toContainEqual(["eq", "arquivada", false]);
    expect(c.filtros.some((f) => f[0] === "or")).toBe(false);
  });

  it("edição com uuid: inclui a campanha da automação mesmo arquivada", async () => {
    const { db, chamadas } = dbFalso(() => ({ data: [] }));
    hoisted.dbAtual = db;
    await carregarOpcoesAssistente(CAMP);
    expect(consultaCampanhas(chamadas).filtros).toContainEqual(["or", `arquivada.eq.false,id.eq.${CAMP}`]);
  });

  it("valor que não é uuid nunca é interpolado no filtro", async () => {
    const { db, chamadas } = dbFalso(() => ({ data: [] }));
    hoisted.dbAtual = db;
    await carregarOpcoesAssistente("x,arquivada.eq.true");
    const c = consultaCampanhas(chamadas);
    expect(c.filtros.some((f) => f[0] === "or")).toBe(false);
    expect(c.filtros).toContainEqual(["eq", "arquivada", false]);
  });
});
