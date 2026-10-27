import { describe, expect, it } from "vitest";
import { dbFalso, type Chamada, type Resposta } from "./apoio/db-falso";
import { carregarAcoes } from "@/app/(painel)/_acoes/comum";
import { textoConfirmacao, textoExclusao } from "@/app/(painel)/_acoes/textos";
import { dataHoraCurta } from "@/src/lib/regras/abas-mensagens";

const E1 = "11111111-1111-1111-1111-111111111111";
const CAMP = "33333333-3333-3333-3333-333333333333";

function banco() {
  return dbFalso((c: Chamada): Resposta => {
    if (c.tabela === "rpc:listar_acoes") return { data: [{ id: E1, total: 1 }] };
    if (c.tabela === "rpc:resumo_execucoes") return { data: [{ execucao_id: E1, total: 10, feitas: 3, erros: 0, pendentes: 7, entregues: 2, lidos: 1 }] };
    if (c.tabela === "execucoes") {
      return {
        data: [{
          id: E1, campanha_id: CAMP, tipo: "mensagem", origem: "sequencia", status: "enviando", motivo: null,
          agendada_para: "2026-10-20T23:00:00Z", iniciada_em: "2026-10-20T23:00:05Z", created_at: "2026-10-19T12:00:00Z",
          conteudo: { formato: "texto", texto: "oi" }, conteudo_final: null, importante: false,
        }],
      };
    }
    if (c.tabela === "tarefas") {
      return {
        data: [
          { id: "t1", execucao_id: E1, grupo_id: "g1", conexao_id: "c1", status: "enviado", enviado_em: "2026-10-20T23:01:00Z" },
          { id: "t2", execucao_id: E1, grupo_id: "g2", conexao_id: "c1", status: "fila", enviado_em: null },
        ],
      };
    }
    if (c.tabela === "campanhas") return { data: [{ id: CAMP, nome: "Lançamento" }] };
    if (c.tabela === "grupos") return { data: [{ id: "g1", nome: "Grupo 1" }, { id: "g2", nome: "Grupo 2" }] };
    if (c.tabela === "conexoes") return { data: [{ id: "c1", nome: "Chip 1" }] };
    return {};
  });
}

const base = { campanhaId: null, tipos: null, aba: "todas", inicioIso: null, fimIso: null, porPagina: 10, pagina: 1 };

describe("carregarAcoes: origem, agendada e andamento", () => {
  it("Agrupar: Sim — traz origem e agendada_para no cartão, sem andamento separado", async () => {
    const { db } = banco();
    const { linhas } = await carregarAcoes(db, { ...base, agrupar: true });
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ origem: "sequencia", agendadaPara: "2026-10-20T23:00:00Z", entregues: 2, lidos: 1 });
    expect(linhas[0].detalheAcao).toBeUndefined();
  });

  it("repassa `automacaoId` como `p_automacao` pro `listar_acoes` (contadores-links da lista de automações)", async () => {
    const { db, chamadas } = banco();
    await carregarAcoes(db, { ...base, agrupar: true, automacaoId: "a1" });
    const rpc = chamadas.find((c) => c.tabela === "rpc:listar_acoes");
    expect((rpc?.dados as { p_automacao: unknown })?.p_automacao).toBe("a1");
  });

  it("sem `automacaoId`: manda `p_automacao` null (sem filtrar)", async () => {
    const { db, chamadas } = banco();
    await carregarAcoes(db, { ...base, agrupar: true });
    const rpc = chamadas.find((c) => c.tabela === "rpc:listar_acoes");
    expect((rpc?.dados as { p_automacao: unknown })?.p_automacao).toBeNull();
  });

  it("repassa `conexaoId` como `p_conexao` (aba Ações do detalhe da conexão, Etapa 3G Tarefa 3)", async () => {
    const { db, chamadas } = banco();
    await carregarAcoes(db, { ...base, agrupar: true, conexaoId: "c1" });
    const rpc = chamadas.find((c) => c.tabela === "rpc:listar_acoes");
    expect((rpc?.dados as { p_conexao: unknown })?.p_conexao).toBe("c1");
  });

  it("sem `conexaoId`: manda `p_conexao` null (sem filtrar)", async () => {
    const { db, chamadas } = banco();
    await carregarAcoes(db, { ...base, agrupar: true });
    const rpc = chamadas.find((c) => c.tabela === "rpc:listar_acoes");
    expect((rpc?.dados as { p_conexao: unknown })?.p_conexao).toBeNull();
  });

  it("Agrupar: Não — cada tarefa leva o andamento da ação inteira (3/10) e o placar de entregues/lidos", async () => {
    const { db } = banco();
    const { linhas } = await carregarAcoes(db, { ...base, agrupar: false });
    expect(linhas).toHaveLength(2);
    for (const l of linhas) expect(l).toMatchObject({ origem: "sequencia", agendadaPara: "2026-10-20T23:00:00Z", detalheAcao: "3/10", entregues: 2, lidos: 1 });
  });
});

describe("textos da lista de Ações", () => {
  it("exclusão conexão apagadas, canceladas e puladas", () => {
    expect(textoExclusao({ apagadas: 2, canceladas: 0, puladas: 0, erros: [] })).toBe("2 excluída(s).");
    const t = textoExclusao({ apagadas: 1, canceladas: 2, puladas: 1, erros: [] });
    expect(t).toContain("2 de sequência/automação cancelada(s)");
    expect(t).toContain("1 em andamento");
  });

  it("com Agrupar: Não, Cancelar/Reprocessar/Excluir avisam que vale pra ação inteira", () => {
    for (const k of ["cancelar", "reprocessar", "excluir"] as const) {
      expect(textoConfirmacao(k, 1, false)).toContain("ação inteira (todos os grupos dela)");
      expect(textoConfirmacao(k, 1, true) ?? "").not.toContain("ação inteira");
    }
    expect(textoConfirmacao("reprocessar", 1, true)).toBeNull();
    expect(textoConfirmacao("enviar", 1, false)).toBeNull();
  });

  it("dataHoraCurta: dd/mm hh:mm no horário de Brasília", () => {
    expect(dataHoraCurta("2026-10-20T23:00:00Z")).toBe("20/10 20:00");
  });
});

describe("carregarAcoes: podeReprocessar escondido quando a seguinte já está agendada/enviando", () => {
  function bancoComFalhaESeguinte(statusSeguinte: string | null) {
    return dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "rpc:listar_acoes") return { data: [{ id: E1, total: 1 }] };
      if (c.tabela === "rpc:resumo_execucoes") return { data: [] };
      if (c.tabela === "execucoes" && (c.filtros ?? []).some((f) => f[0] === "in" && f[1] === "id")) {
        return {
          data: [{
            id: E1, campanha_id: CAMP, tipo: "mensagem", origem: "avulsa", status: "concluida", motivo: null,
            agendada_para: "2026-10-20T23:00:00Z", iniciada_em: "2026-10-20T23:00:05Z", created_at: "2026-10-19T12:00:00Z",
            conteudo: { formato: "texto", texto: "oi" }, conteudo_final: null, importante: false, depois_de: null,
          }],
        };
      }
      if (c.tabela === "execucoes" && (c.filtros ?? []).some((f) => f[0] === "in" && f[1] === "depois_de")) {
        return { data: statusSeguinte ? [{ depois_de: E1 }] : [] };
      }
      if (c.tabela === "tarefas") {
        return { data: [{ id: "t1", execucao_id: E1, grupo_id: "g1", conexao_id: "c1", status: "erro", enviado_em: null }] };
      }
      if (c.tabela === "campanhas") return { data: [{ id: CAMP, nome: "Lançamento" }] };
      if (c.tabela === "grupos") return { data: [{ id: "g1", nome: "Grupo 1" }] };
      if (c.tabela === "conexoes") return { data: [{ id: "c1", nome: "Chip 1" }] };
      return {};
    });
  }

  it("seguinte agendada: podeReprocessar fica falso mesmo com falha", async () => {
    const { db } = bancoComFalhaESeguinte("agendada");
    const { linhas } = await carregarAcoes(db, { ...base, agrupar: true });
    expect(linhas[0].podeReprocessar).toBe(false);
  });

  it("sem seguinte pendente: podeReprocessar normal (true, tem falha)", async () => {
    const { db } = bancoComFalhaESeguinte(null);
    const { linhas } = await carregarAcoes(db, { ...base, agrupar: true });
    expect(linhas[0].podeReprocessar).toBe(true);
  });

  it("Agrupar: Não — a trava vale igual pra cada tarefa", async () => {
    const { db } = bancoComFalhaESeguinte("agendada");
    const { linhas } = await carregarAcoes(db, { ...base, agrupar: false });
    expect(linhas.every((l) => l.podeReprocessar === false)).toBe(true);
  });
});
