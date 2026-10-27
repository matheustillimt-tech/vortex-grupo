import { describe, expect, it } from "vitest";
import {
  campanhasAnterioresValidas,
  candidatosDaRodada,
  motivoDaOrigem,
  operacoesDeTags,
  planoDaRodada,
  remocoesAnteriores,
  type DadosRodada,
} from "@/src/lib/regras/pessoas";

const base: DadosRodada = { grupoId: "g1", entraram: [], sairam: [], protegidos: [], bloqueados: [], abertos: [], pendentes: [] };
const m = (telefone: string, admin = false) => ({ telefone, admin });

describe("motivoDaOrigem", () => {
  it.each([
    ["bloqueado", "bloqueado"],
    ["duplicado", "duplicado"],
    ["venda hotmart", "comprador"],
    [null, "manual"],
    ["qualquer", "manual"],
    ["campanha_anterior", "manual"],
  ] as const)("%s → %s", (origem, esperado) => {
    expect(motivoDaOrigem(origem)).toBe(esperado);
  });
});

describe("candidatosDaRodada", () => {
  it("tira admin e número conectado (pela variante do 9)", () => {
    expect(candidatosDaRodada([m("553711110001"), m("553711110002", true), m("553711110003")], ["5537" + "911110003"])).toEqual(["553711110001"]);
  });
});

describe("planoDaRodada", () => {
  it("bloqueado que entra é removido e não ganha tag (bate pela variante do 9)", () => {
    const p = planoDaRodada({ ...base, entraram: [m("553711110001"), m("553711110002")], bloqueados: ["5537" + "911110001"] });
    expect(p.removerBloqueio).toEqual(["553711110001"]);
    expect(p.removerDuplicado).toEqual([]);
    expect(p.ganhamCampanha).toEqual(["553711110002"]);
  });

  it("quem já está aberto em outro grupo da campanha é o duplicado", () => {
    const p = planoDaRodada({
      ...base,
      entraram: [m("553711110001"), m("553711110002")],
      abertos: [{ telefone: "5537" + "911110001", grupoId: "g2" }, { telefone: "553711110002", grupoId: "g1" }],
    });
    expect(p.removerDuplicado).toEqual(["553711110001"]);
    expect(p.ganhamCampanha).toEqual(["553711110002"]);
  });

  it("bloqueado e duplicado ao mesmo tempo sai só como bloqueado", () => {
    const p = planoDaRodada({ ...base, entraram: [m("553711110001")], bloqueados: ["553711110001"], abertos: [{ telefone: "553711110001", grupoId: "g2" }] });
    expect(p.removerBloqueio).toEqual(["553711110001"]);
    expect(p.removerDuplicado).toEqual([]);
  });

  it("admin e protegido nunca são removidos nem ganham tag", () => {
    const p = planoDaRodada({
      ...base,
      entraram: [m("553711110001", true), m("553711110002")],
      protegidos: ["553711110002"],
      bloqueados: ["553711110001", "553711110002"],
      abertos: [{ telefone: "553711110002", grupoId: "g2" }],
    });
    expect(p).toEqual({ removerBloqueio: [], removerDuplicado: [], ganhamCampanha: [], sairamSozinhos: [], ganhamSaiu: [] });
  });

  it("quem sumiu com remoção pendente não saiu sozinho", () => {
    const p = planoDaRodada({ ...base, sairam: [m("553711110001"), m("553711110002")], pendentes: ["5537" + "911110002"] });
    expect(p.sairamSozinhos).toEqual(["553711110001"]);
    expect(p.ganhamSaiu).toEqual(["553711110001"]);
  });

  it("admin e protegido que saem registram a saída mas não ganham Saiu", () => {
    const p = planoDaRodada({ ...base, sairam: [m("553711110001", true), m("553711110002")], protegidos: ["553711110002"] });
    expect(p.sairamSozinhos).toEqual(["553711110001", "553711110002"]);
    expect(p.ganhamSaiu).toEqual([]);
  });
});

describe("operacoesDeTags (Gerenciamento de Tags)", () => {
  const cfg = { ativo: true, entrouAdicionar: "a", entrouRemover: "b", saiuAdicionar: "c", saiuRemover: null };
  it("desligada ou sem config: nada", () => {
    expect(operacoesDeTags(undefined, ["1"], ["2"])).toEqual([]);
    expect(operacoesDeTags({ ...cfg, ativo: false }, ["1"], ["2"])).toEqual([]);
  });
  it("ligada: só as tags preenchidas e só com gente", () => {
    expect(operacoesDeTags(cfg, ["1"], [])).toEqual([{ rpc: "por_tag", tag: "a", telefones: ["1"] }, { rpc: "tirar_tag", tag: "b", telefones: ["1"] }]);
    expect(operacoesDeTags(cfg, [], ["2"])).toEqual([{ rpc: "por_tag", tag: "c", telefones: ["2"] }]);
  });
});

describe("Remover Lead de Campanhas Anteriores", () => {
  it("campanhasAnterioresValidas: sem a própria e sem repetir", () => {
    expect(campanhasAnterioresValidas(["x", "c1", "x", "y"], "c1")).toEqual(["x", "y"]);
    expect(campanhasAnterioresValidas(null, "c1")).toEqual([]);
  });
  it("remocoesAnteriores: agrupa por grupo, ignora o grupo da rodada, junta variantes do 9 e respeita o teto", () => {
    const r = remocoesAnteriores(
      [
        { telefone: "5537" + "911110001", grupoId: "ga", campanhaId: "x" },
        { telefone: "553711110001", grupoId: "ga", campanhaId: "x" },
        { telefone: "553711110002", grupoId: "ga", campanhaId: "x" },
        { telefone: "553711110003", grupoId: "gb", campanhaId: "y" },
        { telefone: "553711110004", grupoId: "g1", campanhaId: "x" },
      ],
      "g1",
      2,
    );
    expect(r).toEqual({ grupos: [{ grupoId: "ga", campanhaId: "x", telefones: ["5537" + "911110001", "553711110002"] }], excedente: 1 });
  });
});
