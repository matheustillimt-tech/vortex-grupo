import { describe, expect, it } from "vitest";
import { normalizarIds, normalizarIdsUuid } from "@/src/lib/regras/lote";

describe("normalizarIds", () => {
  it("remove duplicados mantendo a primeira ocorrência", () => {
    expect(normalizarIds(["a", "b", "a", "c", "b"], 100)).toEqual(["a", "b", "c"]);
  });

  it("corta no máximo informado", () => {
    const ids = Array.from({ length: 150 }, (_, i) => `id-${i}`);
    const out = normalizarIds(ids, 100);
    expect(out).toHaveLength(100);
    expect(out[0]).toBe("id-0");
    expect(out[99]).toBe("id-99");
  });

  it("ignora valores que não são string ou são vazios", () => {
    expect(normalizarIds(["a", "", "b", 1, null, undefined, {}], 100)).toEqual(["a", "b"]);
  });

  it("qualquer coisa que não seja array vira lista vazia", () => {
    expect(normalizarIds(undefined, 100)).toEqual([]);
    expect(normalizarIds(null, 100)).toEqual([]);
    expect(normalizarIds("a", 100)).toEqual([]);
    expect(normalizarIds({ 0: "a" }, 100)).toEqual([]);
  });
});

describe("normalizarIdsUuid", () => {
  const ID1 = "11111111-2222-3333-4444-555555555555";
  const ID2 = "66666666-7777-8888-9999-000000000000";

  it("mantém só os uuids válidos, sem duplicar", () => {
    expect(normalizarIdsUuid([ID1, "lixo", ID1, ID2, "", 1, null], 300)).toEqual([ID1, ID2]);
  });

  it("corta no máximo informado", () => {
    const ids = Array.from({ length: 5 }, (_, i) => `11111111-2222-3333-4444-55555555550${i}`);
    expect(normalizarIdsUuid(ids, 3)).toHaveLength(3);
  });

  it("qualquer coisa que não seja array vira lista vazia", () => {
    expect(normalizarIdsUuid(undefined, 300)).toEqual([]);
    expect(normalizarIdsUuid("a", 300)).toEqual([]);
  });
});
