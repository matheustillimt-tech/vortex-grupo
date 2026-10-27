import { describe, expect, it } from "vitest";
import { nomeDoGrupo } from "@/src/lib/regras/nome-grupo";
import { estaCheio, ocupacaoEstimada, precisaGrupoNovo } from "@/src/lib/regras/ocupacao";
import { escolherGrupo, type GrupoLink } from "@/src/lib/regras/escolha";
import { diffParticipantes } from "@/src/lib/regras/participantes";

describe("nomeDoGrupo", () => {
  it("troca {n} com dois dígitos", () => {
    expect(nomeDoGrupo("AULÃO #{n}", 1)).toBe("AULÃO #01");
    expect(nomeDoGrupo("AULÃO #{n}", 12)).toBe("AULÃO #12");
  });
  it("sem {n} acrescenta o número no fim", () => {
    expect(nomeDoGrupo("Aulão", 3)).toBe("Aulão 03");
  });
  it("corta em 25 caracteres", () => {
    expect(nomeDoGrupo("COMO FAÇO 100 MIL MENSAL #{n}", 7)).toHaveLength(25);
  });
});

describe("ocupação", () => {
  it("soma 60% dos cliques recentes, arredondando pra cima", () => {
    expect(ocupacaoEstimada(900, 150)).toBe(990);
    expect(ocupacaoEstimada(10, 1)).toBe(11);
  });
  it("cheio quando a estimativa atinge o limite", () => {
    expect(estaCheio(900, 167, 1000)).toBe(true);
    expect(estaCheio(900, 100, 1000)).toBe(false);
  });
  it("pede grupo novo quando a folga acaba e não há criação na fila", () => {
    expect(precisaGrupoNovo(0, 1, false)).toBe(true);
    expect(precisaGrupoNovo(1, 1, false)).toBe(false);
    expect(precisaGrupoNovo(0, 1, true)).toBe(false);
    expect(precisaGrupoNovo(1, 2, false)).toBe(true);
  });
});

describe("escolherGrupo", () => {
  const g = (id: string, numero: number, extra: Partial<GrupoLink> = {}): GrupoLink => ({
    id, numero, cheio: false, ativo: true, link_convite: `https://chat.whatsapp.com/${id}`, ...extra,
  });

  it("escolhe o de menor número com vaga", () => {
    expect(escolherGrupo([g("b", 2), g("a", 1, { cheio: true }), g("c", 3)], null)?.id).toBe("b");
  });
  it("respeita o cookie se o grupo ainda tem vaga", () => {
    expect(escolherGrupo([g("a", 1), g("b", 2)], "b")?.id).toBe("b");
  });
  it("ignora cookie de grupo cheio ou inativo", () => {
    expect(escolherGrupo([g("a", 1), g("b", 2, { cheio: true })], "b")?.id).toBe("a");
    expect(escolherGrupo([g("a", 1), g("b", 2, { ativo: false })], "b")?.id).toBe("a");
  });
  it("ignora grupo sem link", () => {
    expect(escolherGrupo([g("a", 1, { link_convite: null }), g("b", 2)], null)?.id).toBe("b");
  });
  it("nenhum com vaga → null", () => {
    expect(escolherGrupo([g("a", 1, { cheio: true })], null)).toBeNull();
  });

  it("sem tipo (regressão) é igual a tipo campanha", () => {
    const grupos = [g("b", 2), g("a", 1, { cheio: true }), g("c", 3)];
    expect(escolherGrupo(grupos, null)?.id).toBe(escolherGrupo(grupos, null, "campanha")?.id);
  });
  it.each(["campanha", "lista", "viral"] as const)("tipo %s escolhe o de menor número com vaga, igual campanha", (tipo) => {
    expect(escolherGrupo([g("b", 2), g("a", 1, { cheio: true }), g("c", 3)], null, tipo)?.id).toBe("b");
  });
  it("tipo aleatorio sorteia entre os grupos com vaga", () => {
    const grupos = [g("a", 1), g("b", 2), g("c", 3, { cheio: true })];
    expect(escolherGrupo(grupos, null, "aleatorio", () => 0)?.id).toBe("a");
    expect(escolherGrupo(grupos, null, "aleatorio", () => 0.9)?.id).toBe("b");
  });
  it("tipo aleatorio ainda respeita o cookie de retorno", () => {
    expect(escolherGrupo([g("a", 1), g("b", 2)], "b", "aleatorio", () => 0)?.id).toBe("b");
  });
  it("tipo aleatorio: nenhum com vaga → null", () => {
    expect(escolherGrupo([g("a", 1, { cheio: true })], null, "aleatorio")).toBeNull();
  });
});

describe("diffParticipantes", () => {
  it("acha quem entrou, quem saiu e quem mudou de admin", () => {
    const banco = [{ telefone: "1", admin: false }, { telefone: "2", admin: false }, { telefone: "3", admin: true }];
    const whats = [{ telefone: "2", admin: true }, { telefone: "3", admin: true }, { telefone: "4", admin: false }];
    expect(diffParticipantes(banco, whats)).toEqual({
      entraram: [{ telefone: "4", admin: false }],
      sairam: ["1"],
      adminMudou: [{ telefone: "2", admin: true }],
    });
  });
});
