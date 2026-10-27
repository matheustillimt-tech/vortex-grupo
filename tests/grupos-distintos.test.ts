import { describe, expect, it } from "vitest";
import { gruposDistintos } from "@/src/lib/regras/grupos-distintos";

describe("gruposDistintos", () => {
  it("conexão cada group_id uma vez e soma participantes uma vez por grupo", () => {
    const r = gruposDistintos([
      { group_id: "g1", participantes: 100, campanha_id: "c1" },
      { group_id: "g1", participantes: 100, campanha_id: "c2" }, // mesmo grupo reaproveitado em outra campanha
      { group_id: "g2", participantes: 50, campanha_id: "c1" },
    ]);
    expect(r).toEqual({ grupos: 2, participantes: 150 });
  });

  it("ignora linhas sem group_id", () => {
    expect(gruposDistintos([{ group_id: null, participantes: 10, campanha_id: "c1" }])).toEqual({ grupos: 0, participantes: 0 });
  });

  it("vazio", () => {
    expect(gruposDistintos([])).toEqual({ grupos: 0, participantes: 0 });
  });
});
