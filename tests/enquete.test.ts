import { describe, expect, it } from "vitest";
import { placarEnquete } from "@/src/lib/regras/enquete";

describe("placarEnquete", () => {
  it("mantém a ordem das opções, zera as sem voto e calcula % sobre quem votou", () => {
    expect(placarEnquete(["Sim", "Não", "Talvez"], [{ opcao: "Talvez", votos: "1" }, { opcao: "Sim", votos: 3 }], 4)).toEqual([
      { opcao: "Sim", votos: 3, pct: 75 },
      { opcao: "Não", votos: 0, pct: 0 },
      { opcao: "Talvez", votos: 1, pct: 25 },
    ]);
  });
  it("sem votos: tudo zero", () => {
    expect(placarEnquete(["A", "B"], [], 0)).toEqual([{ opcao: "A", votos: 0, pct: 0 }, { opcao: "B", votos: 0, pct: 0 }]);
  });
});
