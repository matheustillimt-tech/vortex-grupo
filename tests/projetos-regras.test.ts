import { describe, expect, it } from "vitest";
import { algumTemPosicao, CORES_PROJETO, filtroProjeto, moverProjeto, ordenarPorPosicao, validarProjeto, type ProjetoEntrada } from "@/src/lib/regras/projetos";

describe("CORES_PROJETO", () => {
  it("tem as 8 cores com rótulo pt-BR e classes", () => {
    expect(Object.keys(CORES_PROJETO)).toEqual(["amarelo", "verde", "azul", "roxo", "rosa", "vermelho", "laranja", "cinza"]);
    for (const cor of Object.values(CORES_PROJETO)) {
      expect(cor.rotulo).toBeTruthy();
      expect(cor.classe).toMatch(/^bg-/);
      expect(cor.borda).toMatch(/^border-/);
      expect(cor.texto).toMatch(/^text-/);
    }
  });
});

const base: ProjetoEntrada = { nome: "Lançamento", descricao: "", cor: "amarelo" };

describe("validarProjeto", () => {
  it("aceita e normaliza nome e descrição", () => {
    const r = validarProjeto({ ...base, nome: "  Lançamento  ", descricao: "  texto  " });
    expect(r).toEqual({ ok: true, valor: { nome: "Lançamento", descricao: "texto", cor: "amarelo" } });
  });

  it.each([
    [{ nome: "" }, "Dê um nome de até 60 caracteres."],
    [{ nome: "  " }, "Dê um nome de até 60 caracteres."],
    [{ nome: "x".repeat(61) }, "Dê um nome de até 60 caracteres."],
    [{ descricao: "x".repeat(201) }, "A descrição aceita até 200 caracteres."],
    [{ cor: "preto" }, "Escolha uma cor válida."],
  ])("recusa %j", (patch, erro) => {
    const r = validarProjeto({ ...base, ...patch } as ProjetoEntrada);
    expect(r).toEqual({ ok: false, erro });
  });

  it("nome de 60 e descrição de 200 caracteres são aceitos (limite exato)", () => {
    const r = validarProjeto({ nome: "x".repeat(60), descricao: "y".repeat(200), cor: "verde" });
    expect(r.ok).toBe(true);
  });
});

describe("filtroProjeto", () => {
  const ID = "11111111-1111-4111-8111-111111111111";

  it("ausente ou vazio vira todos", () => {
    expect(filtroProjeto(undefined)).toEqual({ tipo: "todos" });
    expect(filtroProjeto("")).toEqual({ tipo: "todos" });
  });

  it("'sem' vira sem projeto", () => {
    expect(filtroProjeto("sem")).toEqual({ tipo: "sem" });
  });

  it("um uuid vira o filtro de projeto", () => {
    expect(filtroProjeto(ID)).toEqual({ tipo: "projeto", id: ID });
  });

  it("valor desconhecido ou lista vira todos pelo primeiro item", () => {
    expect(filtroProjeto("qualquer-coisa")).toEqual({ tipo: "todos" });
    expect(filtroProjeto([ID, "outro"])).toEqual({ tipo: "projeto", id: ID });
  });
});

describe("ordenarPorPosicao (Etapa 3N, Task 7)", () => {
  it("todos com posicao nula: ordem de hoje (created_at desc) — regressão", () => {
    const itens = [
      { id: "a", posicao: null, created_at: "2026-01-01T00:00:00Z" },
      { id: "b", posicao: null, created_at: "2026-01-03T00:00:00Z" },
      { id: "c", posicao: null, created_at: "2026-01-02T00:00:00Z" },
    ];
    expect(ordenarPorPosicao(itens).map((i) => i.id)).toEqual(["b", "c", "a"]);
  });

  it("quem tem posicao vem primeiro, por ela; o resto por created_at desc", () => {
    const itens = [
      { id: "a", posicao: null, created_at: "2026-01-01T00:00:00Z" },
      { id: "b", posicao: 1, created_at: "2026-01-02T00:00:00Z" },
      { id: "c", posicao: 0, created_at: "2026-01-03T00:00:00Z" },
      { id: "d", posicao: null, created_at: "2026-01-04T00:00:00Z" },
    ];
    expect(ordenarPorPosicao(itens).map((i) => i.id)).toEqual(["c", "b", "d", "a"]);
  });
});

describe("algumTemPosicao", () => {
  it("falso quando todos nulos, verdadeiro com pelo menos um definido", () => {
    expect(algumTemPosicao([{ posicao: null }, { posicao: null }])).toBe(false);
    expect(algumTemPosicao([{ posicao: null }, { posicao: 0 }])).toBe(true);
  });
});

describe("moverProjeto", () => {
  const ordem = ["a", "b", "c"];

  it("cima e baixo trocam com o vizinho, sem buraco nem repetição", () => {
    expect(moverProjeto(ordem, "b", "cima")).toEqual(["b", "a", "c"]);
    expect(moverProjeto(ordem, "b", "baixo")).toEqual(["a", "c", "b"]);
  });

  it("na ponta, não há vizinho: devolve null", () => {
    expect(moverProjeto(ordem, "a", "cima")).toBeNull();
    expect(moverProjeto(ordem, "c", "baixo")).toBeNull();
  });

  it("id fora da lista: devolve null", () => {
    expect(moverProjeto(ordem, "z", "cima")).toBeNull();
  });

  it("é sempre uma permutação (mesmo conjunto de ids)", () => {
    const nova = moverProjeto(ordem, "a", "baixo")!;
    expect([...nova].sort()).toEqual([...ordem].sort());
  });

  it("combinado com ordenarPorPosicao: A,B,C,D todos nulos, mover D pra cima dá A,B,D,C (regressão item 2)", () => {
    const itens = [
      { id: "a", posicao: null, created_at: "2026-01-04T00:00:00Z" },
      { id: "b", posicao: null, created_at: "2026-01-03T00:00:00Z" },
      { id: "c", posicao: null, created_at: "2026-01-02T00:00:00Z" },
      { id: "d", posicao: null, created_at: "2026-01-01T00:00:00Z" },
    ];
    const ordemAtual = ordenarPorPosicao(itens).map((i) => i.id);
    expect(ordemAtual).toEqual(["a", "b", "c", "d"]);
    const novaOrdem = moverProjeto(ordemAtual, "d", "cima");
    expect(novaOrdem).toEqual(["a", "b", "d", "c"]);
  });
});
