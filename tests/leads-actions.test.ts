import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, filtro, type Chamada, type Resposta } from "./apoio/db-falso";

const hoisted = vi.hoisted(() => ({
  dbAtual: undefined as unknown,
  reenfileirarBloqueadosMock: vi.fn(async (..._a: unknown[]) => 0),
  desbloquearTelefoneMock: vi.fn(async (..._a: unknown[]) => undefined),
}));

vi.mock("@/src/lib/permissoes", async () => (await import("./apoio/permissoes")).permissoesFalsas());
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => hoisted.dbAtual }));
vi.mock("@/src/lib/supabase/usuario", () => ({ exigirUsuario: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/src/lib/bloqueio", () => ({
  bloquearTelefones: vi.fn(async () => ({ novos: 0, jaEstavam: 0, remocoes: 0, ignorados: [] })),
  desbloquearTelefone: hoisted.desbloquearTelefoneMock,
  reenfileirarBloqueados: hoisted.reenfileirarBloqueadosMock,
}));

import { analisarGrupos, desbloquear, desbloquearVarios } from "@/app/(painel)/leads/actions";

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

function paginaDe(n: number) {
  return Array.from({ length: n }, (_, i) => ({ telefone: `553799900${String(i).padStart(4, "0")}` }));
}

describe("analisarGrupos", () => {
  it("passa pelas páginas de 1000 até a última (menor que 1000) e soma as remoções, sem escrever em bloqueados", async () => {
    let chamada = 0;
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "bloqueados_efetivos" && c.op === "select") {
        chamada++;
        return { data: chamada === 1 ? paginaDe(1000) : paginaDe(200) };
      }
      return {};
    });
    hoisted.dbAtual = db;
    hoisted.reenfileirarBloqueadosMock.mockResolvedValueOnce(3).mockResolvedValueOnce(1);

    const r = await analisarGrupos();

    expect(r.erro).toBeUndefined();
    expect(r.resumo).toEqual({ processados: 1200, remocoes: 4, parcial: false });
    expect(hoisted.reenfileirarBloqueadosMock).toHaveBeenCalledTimes(2);
    expect(chamadas.filter((c) => ["bloqueados", "bloqueados_efetivos"].includes(c.tabela) && c.op !== "select")).toEqual([]);
    const h = chamadas.find((c) => c.tabela === "historico" && c.op === "insert")!;
    expect(h.dados).toMatchObject({ acao: "executar", area: "Anti-spam" });
  });

  it("sem nenhuma remoção (nada mudou): não grava no histórico", async () => {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => (c.tabela === "bloqueados_efetivos" && c.op === "select" ? { data: paginaDe(5) } : {}));
    hoisted.dbAtual = db;
    hoisted.reenfileirarBloqueadosMock.mockResolvedValue(0);

    const r = await analisarGrupos();

    expect(r.resumo).toEqual({ processados: 5, remocoes: 0, parcial: false });
    expect(chamadas.some((c) => c.tabela === "historico")).toBe(false);
  });

  it("para no orçamento de tempo e devolve parcial: true com o que já foi processado", async () => {
    const { db } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "bloqueados_efetivos" && c.op === "select") return { data: paginaDe(1000) };
      return {};
    });
    hoisted.dbAtual = db;
    hoisted.reenfileirarBloqueadosMock.mockResolvedValue(0);

    const agora = Date.now();
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(agora) // prazo = agora + orçamento
      .mockReturnValueOnce(agora) // 1ª checagem: dentro do prazo
      .mockReturnValue(agora + 999_999); // 2ª checagem em diante: já passou do prazo

    const r = await analisarGrupos();

    expect(r.resumo).toMatchObject({ processados: 1000, parcial: true, proximo: paginaDe(1000)[999].telefone });
    expect(hoisted.reenfileirarBloqueadosMock).toHaveBeenCalledTimes(1);
  });

  it("lê em ordem de telefone, a partir do cursor da página anterior", async () => {
    let chamada = 0;
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "bloqueados_efetivos" && c.op === "select") {
        chamada++;
        return { data: chamada === 1 ? paginaDe(1000) : paginaDe(10) };
      }
      return {};
    });
    hoisted.dbAtual = db;
    hoisted.reenfileirarBloqueadosMock.mockResolvedValue(0);

    const r = await analisarGrupos();

    const leituras = chamadas.filter((c) => c.tabela === "bloqueados_efetivos");
    expect(leituras).toHaveLength(2);
    for (const l of leituras) {
      expect(l.filtros).toContainEqual(["order", "telefone", { ascending: true }]);
      expect(l.filtros).toContainEqual(["limit", 1000]);
    }
    expect(filtro(leituras[0], "gt", "telefone")).toBeUndefined();
    expect(filtro(leituras[1], "gt", "telefone")).toBe(paginaDe(1000)[999].telefone);
    expect(r.resumo).toEqual({ processados: 1010, remocoes: 0, parcial: false });
  });

  it("continua de onde parou quando recebe o cursor (depois)", async () => {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => (c.tabela === "bloqueados_efetivos" ? { data: paginaDe(5) } : {}));
    hoisted.dbAtual = db;
    hoisted.reenfileirarBloqueadosMock.mockResolvedValue(2);

    const r = await analisarGrupos("5537" + "999000999");

    expect(filtro(chamadas.find((c) => c.tabela === "bloqueados_efetivos")!, "gt", "telefone")).toBe("5537" + "999000999");
    expect(r.resumo).toEqual({ processados: 5, remocoes: 2, parcial: false });
  });

  it("parcial antes de ler qualquer página devolve o mesmo cursor recebido", async () => {
    const { db, chamadas } = dbFalso();
    hoisted.dbAtual = db;
    const agora = Date.now();
    vi.spyOn(Date, "now").mockReturnValueOnce(agora).mockReturnValue(agora + 999_999);

    const r = await analisarGrupos("5537" + "999000999");

    expect(chamadas).toEqual([]);
    expect(r.resumo).toEqual({ processados: 0, remocoes: 0, parcial: true, proximo: "5537" + "999000999" });
  });

  it("cursor inválido devolve erro sem ler o banco", async () => {
    const { db, chamadas } = dbFalso();
    hoisted.dbAtual = db;
    const r = await analisarGrupos("abc' or 1=1");
    expect(r.erro).toBe("Ponto de continuação inválido.");
    expect(chamadas).toEqual([]);
  });
});

describe("desbloquear", () => {
  it("normaliza o telefone antes de desbloquear", async () => {
    hoisted.dbAtual = dbFalso().db;
    const r = await desbloquear("+55 (37) " + "98000-1001");
    expect(r).toEqual({});
    expect(hoisted.desbloquearTelefoneMock).toHaveBeenCalledWith(expect.anything(), "5537" + "980001001");
  });

  it("telefone inválido devolve erro sem chamar o banco", async () => {
    const r = await desbloquear("123");
    expect(r).toEqual({ erro: "Telefone inválido." });
    expect(hoisted.desbloquearTelefoneMock).not.toHaveBeenCalled();
  });
});

describe("desbloquearVarios", () => {
  it("valida com normalizarTelefone, remove inválidos/duplicados e corta em 100", async () => {
    const { db } = dbFalso();
    hoisted.dbAtual = db;
    const brutos = Array.from({ length: 150 }, (_, i) => `5537999${String(i).padStart(6, "0")}`);
    const comLixo = ["abc", "", ...brutos, ...brutos.slice(0, 5)]; // inválidos + duplicados no meio

    const r = await desbloquearVarios(comLixo);

    expect(r.erro).toBeUndefined();
    expect(r.desbloqueados).toBe(100);
    expect(hoisted.desbloquearTelefoneMock).toHaveBeenCalledTimes(100);
  });

  it("nenhum telefone válido devolve erro sem chamar o banco", async () => {
    const r = await desbloquearVarios(["abc", 123, null, {}]);
    expect(r.erro).toBeDefined();
    expect(hoisted.desbloquearTelefoneMock).not.toHaveBeenCalled();
  });

  it("entrada que não é array devolve erro", async () => {
    const r = await desbloquearVarios("não é lista");
    expect(r.erro).toBeDefined();
  });
});
