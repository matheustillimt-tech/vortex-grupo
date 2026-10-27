import { describe, expect, it } from "vitest";
import { execucoesGrupoNovo, ultimasImportantes, type ExecucaoPassada } from "@/src/lib/regras/grupo-novo";

const e = (id: string, quando: string, extra: Partial<ExecucaoPassada> = {}): ExecucaoPassada => ({
  id, tipo: "mensagem", origem: "sequencia", status: "concluida", importante: true, agendada_para: quando, conteudo_final: { formato: "texto", texto: id }, ...extra,
});

describe("ultimasImportantes", () => {
  it("as 3 mais recentes, entregues da mais antiga pra mais nova", () => {
    const lista = [e("a", "2026-10-18T12:00:00Z"), e("d", "2026-10-21T12:00:00Z"), e("b", "2026-10-19T12:00:00Z"), e("c", "2026-10-20T12:00:00Z")];
    expect(ultimasImportantes(lista).map((x) => x.id)).toEqual(["b", "c", "d"]);
  });
  it("ignora não importantes, não concluídas, cópias de grupo novo e ações", () => {
    const lista = [
      e("ok", "2026-10-18T12:00:00Z"),
      e("normal", "2026-10-19T12:00:00Z", { importante: false }),
      e("agendada", "2026-10-19T12:00:00Z", { status: "agendada" }),
      e("copia", "2026-10-20T12:00:00Z", { origem: "grupo_novo" }),
      e("nome", "2026-10-20T12:00:00Z", { tipo: "nome" }),
      e("enquete", "2026-10-21T12:00:00Z", { tipo: "enquete" }),
    ];
    expect(ultimasImportantes(lista).map((x) => x.id)).toEqual(["ok", "enquete"]);
  });

  it("ignora importante com conexão ou grupo específico como alvo: um grupo novo não era nenhum dos alvos", () => {
    const lista = [
      e("geral", "2026-10-18T12:00:00Z"),
      e("so-conta", "2026-10-19T12:00:00Z", { alvo_contas: ["k1"] }),
      e("so-grupo", "2026-10-20T12:00:00Z", { alvo_grupos: ["g1"] }),
      e("ambos", "2026-10-21T12:00:00Z", { alvo_contas: ["k1"], alvo_grupos: ["g1"] }),
      e("geral-de-novo", "2026-10-22T12:00:00Z", { alvo_contas: null, alvo_grupos: null }),
    ];
    expect(ultimasImportantes(lista).map((x) => x.id)).toEqual(["geral", "geral-de-novo"]);
  });
});

describe("execucoesGrupoNovo", () => {
  const agora = new Date("2026-10-21T15:00:00Z");
  it("mensagem fixa primeiro, depois as importantes, 1 s entre elas, só pro grupo novo", () => {
    const linhas = execucoesGrupoNovo({ campanhaId: "c1", grupoId: "g9", mensagemFixa: "Bem-vindo! Aula {data_aula}", importantes: [e("b", "2026-10-19T12:00:00Z"), e("c", "2026-10-20T12:00:00Z")], agora });
    expect(linhas.map((l) => [l.tipo, (l.conteudo as { texto: string }).texto, l.agendada_para])).toEqual([
      ["mensagem", "Bem-vindo! Aula {data_aula}", "2026-10-21T15:00:00.000Z"],
      ["mensagem", "b", "2026-10-21T15:00:01.000Z"],
      ["mensagem", "c", "2026-10-21T15:00:02.000Z"],
    ]);
    expect(linhas.every((l) => l.origem === "grupo_novo" && l.alvo_grupos[0] === "g9" && l.campanha_id === "c1" && l.importante === false)).toBe(true);
  });
  it("sem mensagem fixa e sem importantes: nada", () => {
    expect(execucoesGrupoNovo({ campanhaId: "c1", grupoId: "g9", mensagemFixa: "  ", importantes: [], agora })).toEqual([]);
  });
});
