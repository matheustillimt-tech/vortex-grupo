import { describe, expect, it } from "vitest";
import { carregarCampanhasComResumo } from "@/app/(painel)/campanhas/dados";
import { dbFalso, filtro } from "./apoio/db-falso";

describe("carregarCampanhasComResumo e o filtro de projeto", () => {
  const PROJETO_ID = "cccccccc-3333-4333-8333-333333333333";

  it("sem filtro (ou 'todos'): não filtra por projeto_id", async () => {
    const { db, chamadas } = dbFalso();
    await carregarCampanhasComResumo(db, { desde: "2026-01-01T00:00:00.000Z", filtro: { tipo: "todos" } });
    const consulta = chamadas.find((c) => c.tabela === "campanhas")!;
    expect(consulta.filtros.some((f) => f[0] === "eq" && f[1] === "projeto_id")).toBe(false);
    expect(consulta.filtros.some((f) => f[0] === "is" && f[1] === "projeto_id")).toBe(false);
  });

  it("filtro 'sem': usa .is('projeto_id', null)", async () => {
    const { db, chamadas } = dbFalso();
    await carregarCampanhasComResumo(db, { desde: "2026-01-01T00:00:00.000Z", filtro: { tipo: "sem" } });
    const consulta = chamadas.find((c) => c.tabela === "campanhas")!;
    expect(filtro(consulta, "is", "projeto_id")).toBeNull();
  });

  it("filtro 'projeto': usa .eq('projeto_id', id)", async () => {
    const { db, chamadas } = dbFalso();
    await carregarCampanhasComResumo(db, { desde: "2026-01-01T00:00:00.000Z", filtro: { tipo: "projeto", id: PROJETO_ID } });
    const consulta = chamadas.find((c) => c.tabela === "campanhas")!;
    expect(filtro(consulta, "eq", "projeto_id")).toBe(PROJETO_ID);
  });

  it("junta o projeto (id, nome, cor) de cada campanha pro selo do cartão", async () => {
    const linha = { id: "c1", nome: "Aulão", descricao: "", arquivada: false, created_at: "2026-01-01T00:00:00Z", projeto: { id: PROJETO_ID, nome: "Lançamento", cor: "azul" } };
    const { db } = dbFalso((c) => (c.tabela === "campanhas" ? { data: [linha] } : {}));
    const { campanhas } = await carregarCampanhasComResumo(db, { desde: "2026-01-01T00:00:00.000Z" });
    expect(campanhas).toEqual([linha]);
  });
});
