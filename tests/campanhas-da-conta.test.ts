import { describe, expect, it } from "vitest";
import { desmarcarTodasFiltradas, selecionarTodasFiltradas, type CampanhaSelecionavel } from "@/src/lib/regras/campanhas-da-conta";

const CRIA: CampanhaSelecionavel = { id: "cria", criadora: true };
const A: CampanhaSelecionavel = { id: "a", criadora: false };
const B: CampanhaSelecionavel = { id: "b", criadora: false };
const C: CampanhaSelecionavel = { id: "c", criadora: false };

describe("selecionarTodasFiltradas", () => {
  it("marca só a lista filtrada, nunca a criadora", () => {
    const r = selecionarTodasFiltradas(new Set(), [CRIA, A, B]);
    expect([...r].sort()).toEqual(["a", "b"]);
  });

  it("não toca marcações fora da lista filtrada (busca ativa)", () => {
    const r = selecionarTodasFiltradas(new Set(["c"]), [A, B]); // "c" ficou de fora da busca
    expect([...r].sort()).toEqual(["a", "b", "c"]);
  });

  it("lista filtrada vazia não muda nada", () => {
    const r = selecionarTodasFiltradas(new Set(["a"]), []);
    expect([...r]).toEqual(["a"]);
  });
});

describe("desmarcarTodasFiltradas", () => {
  it("desmarca só a lista filtrada, nunca a criadora (mesmo que ela estivesse marcada)", () => {
    const r = desmarcarTodasFiltradas(new Set(["cria", "a", "b", "c"]), [CRIA, A, B]);
    expect([...r].sort()).toEqual(["c", "cria"]);
  });

  it("não toca marcações fora da lista filtrada", () => {
    const r = desmarcarTodasFiltradas(new Set(["a", "c"]), [A, B]); // "c" ficou de fora da busca
    expect([...r].sort()).toEqual(["c"]);
  });

  it("lista filtrada vazia não muda nada", () => {
    const r = desmarcarTodasFiltradas(new Set(["a"]), []);
    expect([...r]).toEqual(["a"]);
  });
});
