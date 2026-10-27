import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ dbAtual: undefined as unknown }));

vi.mock("@/src/lib/supabase/admin", () => ({
  dbAdmin: () => hoisted.dbAtual,
}));

import { campanhasDoNumero } from "@/src/lib/jobs/monitor";

/** Banco falso: cada tabela resolve um resultado fixo (ou lança, pra testar a resiliência). */
function construirDb(resultados: Record<string, { data: unknown; error: unknown } | "lança">) {
  const from = vi.fn((tabela: string) => {
    const consulta: Record<string, unknown> = {};
    consulta.select = vi.fn(() => consulta);
    consulta.eq = vi.fn(() => consulta);
    consulta.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
      const r = resultados[tabela];
      if (r === "lança") return reject(new Error(`${tabela} fora do ar`));
      return resolve(r ?? { data: [], error: null });
    };
    return consulta;
  });
  return { from };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("campanhasDoNumero", () => {
  it("junta campanha criadora, admin e dona de grupo ativo, sem duplicar", async () => {
    hoisted.dbAtual = construirDb({
      campanhas: { data: [{ id: "c1" }], error: null },
      campanha_conexoes: { data: [{ campanha_id: "c1" }, { campanha_id: "c2" }], error: null },
      grupos: { data: [{ campanha_id: "c3" }], error: null },
    });

    const r = await campanhasDoNumero("con1");

    expect(new Set(r)).toEqual(new Set(["c1", "c2", "c3"]));
    expect(r.length).toBe(3);
  });

  it("sem nenhuma campanha ligada ao número: devolve lista vazia", async () => {
    hoisted.dbAtual = construirDb({});

    expect(await campanhasDoNumero("con1")).toEqual([]);
  });

  it("nunca lança: se a busca falhar, devolve lista vazia", async () => {
    hoisted.dbAtual = construirDb({ campanhas: "lança" });

    await expect(campanhasDoNumero("con1")).resolves.toEqual([]);
  });
});
