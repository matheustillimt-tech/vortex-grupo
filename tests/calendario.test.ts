import { describe, expect, it } from "vitest";
import { agruparPorDia, corDaSituacao, itemDaExecucao, projetarPassos, situacaoDaExecucao } from "@/src/lib/regras/calendario";

describe("situacaoDaExecucao", () => {
  it("cada status vira uma situação, com placar quando há tarefas", () => {
    expect(situacaoDaExecucao("agendada", undefined)).toEqual({ situacao: "agendado", detalhe: null });
    expect(situacaoDaExecucao("enviando", { total: 30, feitas: 12, erros: 0, pendentes: 18 })).toEqual({ situacao: "executando", detalhe: "12/30" });
    expect(situacaoDaExecucao("concluida", { total: 30, feitas: 28, erros: 2, pendentes: 0 })).toEqual({ situacao: "feito", detalhe: "28/30 · 2 com erro" });
    expect(situacaoDaExecucao("concluida", { total: 3, feitas: 0, erros: 3, pendentes: 0 })).toEqual({ situacao: "falhou", detalhe: "0/3" });
    expect(situacaoDaExecucao("concluida", undefined)).toEqual({ situacao: "feito", detalhe: "nenhum grupo" });
    expect(situacaoDaExecucao("pulada", undefined).situacao).toBe("pulado");
    expect(situacaoDaExecucao("bloqueada", undefined).situacao).toBe("bloqueado");
    expect(situacaoDaExecucao("cancelada", undefined).situacao).toBe("cancelado");
  });
});

describe("corDaSituacao", () => {
  it("feito sem erro é verde; feito com erro ou sem grupo é aviso", () => {
    const cor = (status: string, r?: { total: number; feitas: number; erros: number; pendentes: number }) => {
      const s = situacaoDaExecucao(status, r);
      return corDaSituacao(s.situacao, s.detalhe);
    };
    expect(cor("concluida", { total: 30, feitas: 30, erros: 0, pendentes: 0 })).toBe("ok");
    expect(cor("concluida", { total: 30, feitas: 28, erros: 2, pendentes: 0 })).toBe("aviso");
    expect(cor("concluida", undefined)).toBe("aviso");
    expect(cor("concluida", { total: 3, feitas: 0, erros: 3, pendentes: 0 })).toBe("erro");
    expect(cor("enviando", { total: 30, feitas: 12, erros: 0, pendentes: 18 })).toBe("aviso");
    expect(cor("agendada")).toBe("neutro");
    expect(cor("bloqueada")).toBe("erro");
    expect(cor("cancelada")).toBe("neutro");
  });
});

describe("projetarPassos", () => {
  const campanha = { id: "c1", data_aula: "2026-10-21T23:00:00Z" };
  const passos = [
    { id: "p1", dia_relativo: -1, hora: "10:00", tipo: "mensagem" as const, conteudo: { texto: "amanhã tem" } },
    { id: "p2", dia_relativo: 0, hora: "19:50", tipo: "abrir" as const, conteudo: {} },
    { id: "p3", dia_relativo: 0, hora: "20:00", tipo: "mensagem" as const, conteudo: { texto: "começou" } },
  ];
  it("só os não materializados; futuro projetado, passado pulado", () => {
    const agora = new Date("2026-10-21T12:00:00Z");
    const r = projetarPassos(campanha, passos, new Set(["p2"]), agora);
    expect(r.map((i) => [i.passoId, i.situacao, i.quando, i.resumo])).toEqual([
      ["p1", "pulado", "2026-10-20T13:00:00.000Z", "amanhã tem"],
      ["p3", "projetado", "2026-10-21T23:00:00.000Z", "começou"],
    ]);
    expect(r[0]).toMatchObject({ execucaoId: null, origem: "sequencia", campanhaId: "c1" });
  });
});

describe("agruparPorDia", () => {
  it("dias de Brasília em ordem e itens por horário", () => {
    const base = { chave: "", campanhaId: "c", passoId: null, tipo: "mensagem" as const, origem: "avulsa", resumo: "", situacao: "agendado" as const, detalhe: null };
    const itens = [
      { ...base, chave: "b", execucaoId: "b", quando: "2026-10-22T01:00:00Z" }, // 21/10 22h em Brasília
      { ...base, chave: "a", execucaoId: "a", quando: "2026-10-21T13:00:00Z" },
      { ...base, chave: "c", execucaoId: "c", quando: "2026-10-22T12:00:00Z" },
    ];
    const r = agruparPorDia(itens);
    expect(r.map((d) => [d.dia, d.itens.map((i) => i.chave)])).toEqual([
      ["2026-10-21", ["a", "b"]],
      ["2026-10-22", ["c"]],
    ]);
    expect(r[0].rotulo).toMatch(/21\/10/);
  });
});

describe("itemDaExecucao", () => {
  it("usa o conteúdo final quando já foi resolvido", () => {
    const i = itemDaExecucao(
      { id: "e1", campanha_id: "c1", tipo: "mensagem", origem: "massa", status: "agendada", agendada_para: "2026-10-21T13:00:00Z", conteudo: { texto: "{cupom}" }, conteudo_final: { texto: "V10" } },
      undefined,
    );
    expect(i).toMatchObject({ chave: "e-e1", execucaoId: "e1", resumo: "V10", situacao: "agendado", origem: "massa" });
  });
});
