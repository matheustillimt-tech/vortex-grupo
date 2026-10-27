import { describe, expect, it } from "vitest";
import { distribuirEntreChips, podeDistribuir } from "@/src/lib/regras/distribuir-chips";

const g = (n: number, dono: string) => ({ grupoId: `g${n}`, conexaoId: dono });

describe("distribuirEntreChips", () => {
  it("14 grupos de um dono só, os dois chips admin em todos: 7 e 7", () => {
    const grupos = Array.from({ length: 14 }, (_, i) => g(i + 1, "A"));
    const aptos = new Map(grupos.map((x) => [x.grupoId, ["A", "B"]]));
    const r = distribuirEntreChips(grupos, aptos, new Map());
    expect(r.filter((x) => x.conexaoId === "A")).toHaveLength(7);
    expect(r.filter((x) => x.conexaoId === "B")).toHaveLength(7);
  });
  it("leva em conta o que já está na fila de cada chip", () => {
    const grupos = [g(1, "A"), g(2, "A")];
    const aptos = new Map(grupos.map((x) => [x.grupoId, ["A", "B"]]));
    const r = distribuirEntreChips(grupos, aptos, new Map([["A", 5]]));
    expect(r.map((x) => x.conexaoId)).toEqual(["B", "B"]);
  });
  it("chip que não é admin do grupo (ou caiu) não recebe; sem apto nenhum, fica com o dono", () => {
    const grupos = [g(1, "A"), g(2, "A"), g(3, "A")];
    const aptos = new Map([["g1", ["A"]], ["g2", ["B"]]]);
    const r = distribuirEntreChips(grupos, aptos, new Map([["A", 9]]));
    expect(r.map((x) => x.conexaoId)).toEqual(["A", "B", "A"]);
  });
});

describe("podeDistribuir", () => {
  it("só mensagem e enquete sem contas escolhidas", () => {
    expect(podeDistribuir("mensagem", null)).toBe(true);
    expect(podeDistribuir("enquete", [])).toBe(true);
    expect(podeDistribuir("mensagem", ["A"])).toBe(false);
    expect(podeDistribuir("nome", null)).toBe(false);
    expect(podeDistribuir("imagem", null)).toBe(false);
  });
});

describe("lerChipsDivisao", async () => {
  const { lerChipsDivisao } = await import("@/src/lib/regras/secoes-campanha");
  const id = "11111111-1111-4111-8111-111111111111";
  it("aceita vazio (todos) e tira repetidos; recusa o que não é uuid", () => {
    expect(lerChipsDivisao([])).toEqual({ ok: true, ids: [] });
    expect(lerChipsDivisao([id, id])).toEqual({ ok: true, ids: [id] });
    expect(lerChipsDivisao(["x"]).ok).toBe(false);
    expect(lerChipsDivisao("x").ok).toBe(false);
  });
});
