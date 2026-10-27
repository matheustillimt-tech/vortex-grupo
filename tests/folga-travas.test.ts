import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, filtro, type Chamada, type Resposta } from "./apoio/db-falso";

const hoisted = vi.hoisted(() => ({ dbAtual: undefined as unknown }));
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => hoisted.dbAtual }));

import { garantirFolga, MOTIVO_JA_TEM_VAGA, motivoJaTemVaga } from "@/src/lib/jobs/novos-grupos";

function montar(camp: Record<string, unknown>, o: { comVaga?: number; total?: number; cliques?: number; erroCliques?: boolean } = {}) {
  const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
    if (c.tabela === "campanhas") return { data: [{ id: "c1", folga: 1, conexoes: { status: "conectado" }, ...camp }] };
    // Sem o filtro "cheio": é a contagem de todos os grupos da campanha (o primeiro é sempre manual).
    if (c.tabela === "grupos") return { count: filtro(c, "eq", "cheio") === undefined ? (o.total ?? 1) : (o.comVaga ?? 0) };
    if (c.tabela === "acoes" && c.op === "select") return { count: 0 };
    if (c.tabela === "cliques") return o.erroCliques ? { error: { message: "fora" } } : { count: o.cliques ?? 0 };
    return {};
  });
  hoisted.dbAtual = db;
  return chamadas;
}
const enfileirou = (cs: Chamada[]) => cs.some((c) => c.tabela === "acoes" && c.op === "insert");

beforeEach(() => vi.clearAllMocks());

describe("garantirFolga — travas de criação (Etapa 3E)", () => {
  it("sem travas (padrão): enfileira como antes, sem contar cliques", async () => {
    const cs = montar({});
    expect(await garantirFolga()).toBe(1);
    expect(cs.find((c) => c.tabela === "acoes" && c.op === "insert")?.dados).toEqual({ tipo: "criar_grupo", campanha_id: "c1", origem: "folga" });
    expect(cs.some((c) => c.tabela === "cliques")).toBe(false);
  });

  it("campanha sem nenhum grupo ainda: não enfileira (o primeiro grupo é criado à mão na aba Grupos)", async () => {
    const cs = montar({}, { total: 0 });
    expect(await garantirFolga()).toBe(0);
    expect(enfileirou(cs)).toBe(false);
  });

  it("'Não criar grupos' ligado: não enfileira", async () => {
    const cs = montar({ nao_criar_grupos: true });
    expect(await garantirFolga()).toBe(0);
    expect(enfileirou(cs)).toBe(false);
  });

  it("cliques da última hora no limite: não enfileira; abaixo: enfileira", async () => {
    const travada = montar({ limite_cliques_sem_criar: 30 }, { cliques: 30 });
    await garantirFolga();
    expect(enfileirou(travada)).toBe(false);
    const cs = montar({ limite_cliques_sem_criar: 30 }, { cliques: 29 });
    await garantirFolga();
    expect(enfileirou(cs)).toBe(true);
  });

  it("falha ao contar os cliques: não enfileira nesta rodada (tenta no próximo minuto)", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const cs = montar({ limite_cliques_sem_criar: 30 }, { erroCliques: true });
    expect(await garantirFolga()).toBe(0);
    expect(enfileirou(cs)).toBe(false);
    erro.mockRestore();
  });
});

describe("motivoJaTemVaga — conferência na hora de criar (21/10/2026)", () => {
  const db = (comVaga: number | null, erro = false) =>
    dbFalso((c: Chamada): Resposta => (c.tabela === "grupos" ? (erro ? { error: { message: "fora" } } : { count: comVaga }) : {})).db;

  it("grupo importado/reativado com vaga depois do pedido: cancela a criação", async () => {
    expect(await motivoJaTemVaga(db(1), "c1", 1)).toBe(MOTIVO_JA_TEM_VAGA);
  });

  it("ainda sem vaga: deixa criar", async () => {
    expect(await motivoJaTemVaga(db(0), "c1", 1)).toBeNull();
    expect(await motivoJaTemVaga(db(null), "c1", 1)).toBeNull();
  });

  it("folga 2 com só 1 grupo com vaga: deixa criar", async () => {
    expect(await motivoJaTemVaga(db(1), "c1", 2)).toBeNull();
  });

  it("falha ao contar: lança (a fila tenta de novo)", async () => {
    await expect(motivoJaTemVaga(db(0, true), "c1", 1)).rejects.toThrow("fora");
  });
});
