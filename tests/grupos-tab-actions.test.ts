import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, filtro, type Chamada, type Resposta } from "./apoio/db-falso";
import { liberarTudo, usarMembro } from "./apoio/permissoes";

const hoisted = vi.hoisted(() => ({
  adminAtual: undefined as unknown,
  registrarHistoricoMock: vi.fn(async () => undefined),
  exigirUsuarioMock: vi.fn(async () => ({ id: "u1", email: "u1@x.com" })),
}));

vi.mock("@/src/lib/permissoes", async () => (await import("./apoio/permissoes")).permissoesFalsas());
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => hoisted.adminAtual }));
vi.mock("@/src/lib/supabase/usuario", () => ({ exigirUsuario: hoisted.exigirUsuarioMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/src/lib/historico", () => ({ registrarHistorico: hoisted.registrarHistoricoMock }));

import {
  atualizarLeads,
  atualizarLinkConviteGrupo,
  atualizarLinksGrupos,
  editarNomeGrupo,
  gruposDuplicados,
  marcarCheioManual,
  participantesDuplicados,
  redefinirLinkConviteGrupo,
  salvarValoresGrupo,
  valoresDoGrupo,
} from "@/app/(painel)/campanhas/[id]/grupos/actions";

const CAMP = "999" + "99999-2222-3333-4444-555555555555";
const G1 = "11111111-1111-1111-1111-111111111111";
const G2 = "22222222-2222-2222-2222-222222222222";

function usar(responder?: (c: Chamada) => Resposta) {
  const f = dbFalso(responder);
  hoisted.adminAtual = f.db;
  return f.chamadas;
}

beforeEach(() => {
  vi.clearAllMocks();
  liberarTudo();
});

describe("atualizarLinksGrupos", () => {
  it("cria uma execução avulsa atualizar_links para todos os grupos ativos (alvo_grupos null)", async () => {
    const chamadas = usar((c) => (c.op === "insert" ? { data: [{ id: "e1" }] } : {}));
    const r = await atualizarLinksGrupos(CAMP);
    expect(r).toEqual({});
    const ins = chamadas.find((c) => c.tabela === "execucoes" && c.op === "insert")!;
    expect(ins.dados).toMatchObject({ campanha_id: CAMP, origem: "avulsa", tipo: "atualizar_links", alvo_grupos: null });
    expect(hoisted.registrarHistoricoMock).toHaveBeenCalledTimes(1);
  });

  it("sem permissão de editar: recusa sem tocar no banco", async () => {
    usarMembro({ papel: "membro", permissoes: { campanhas: "ver" } });
    const chamadas = usar();
    const r = await atualizarLinksGrupos(CAMP);
    expect(r.erro).toBeTruthy();
    expect(chamadas).toHaveLength(0);
  });

  it("banco recusa o insert: devolve erro", async () => {
    usar(() => ({ error: { message: "fora do ar" } }));
    const r = await atualizarLinksGrupos(CAMP);
    expect(r.erro).toBeTruthy();
    expect(hoisted.registrarHistoricoMock).not.toHaveBeenCalled();
  });
});

/** Nos testes de linha (atualizar/redefinir link, editar nome): o grupo confere como desta campanha. */
function responderGrupoDaCampanha(c: Chamada): Resposta {
  if (c.tabela === "grupos" && c.op === "select") return { data: { id: G1 } };
  if (c.tabela === "execucoes" && c.op === "insert") return { data: [{ id: "e1" }] };
  return {};
}

describe("atualizarLinkConviteGrupo / redefinirLinkConviteGrupo", () => {
  it("atualizar: execução atualizar_links só para esse grupo", async () => {
    const chamadas = usar(responderGrupoDaCampanha);
    const r = await atualizarLinkConviteGrupo(G1, CAMP);
    expect(r).toEqual({});
    const ins = chamadas.find((c) => c.tabela === "execucoes" && c.op === "insert")!;
    expect(ins.dados).toMatchObject({ tipo: "atualizar_links", alvo_grupos: [G1] });
  });

  it("atualizar: grupo de outra campanha (ou inexistente): erro, sem criar a execução", async () => {
    const chamadas = usar((c) => (c.tabela === "grupos" && c.op === "select" ? { data: null } : {}));
    const r = await atualizarLinkConviteGrupo(G1, CAMP);
    expect(r.erro).toBeTruthy();
    expect(chamadas.some((c) => c.tabela === "execucoes")).toBe(false);
  });

  it("redefinir: execução redefinir_link só para esse grupo", async () => {
    const chamadas = usar(responderGrupoDaCampanha);
    const r = await redefinirLinkConviteGrupo(G1, CAMP);
    expect(r).toEqual({});
    const ins = chamadas.find((c) => c.tabela === "execucoes" && c.op === "insert")!;
    expect(ins.dados).toMatchObject({ tipo: "redefinir_link", alvo_grupos: [G1] });
  });

  it("redefinir: grupo de outra campanha (ou inexistente): erro, sem criar a execução", async () => {
    const chamadas = usar((c) => (c.tabela === "grupos" && c.op === "select" ? { data: null } : {}));
    const r = await redefinirLinkConviteGrupo(G1, CAMP);
    expect(r.erro).toBeTruthy();
    expect(chamadas.some((c) => c.tabela === "execucoes")).toBe(false);
  });
});

describe("editarNomeGrupo", () => {
  it("cria execução nome com o padrão informado, só para o grupo", async () => {
    const chamadas = usar(responderGrupoDaCampanha);
    const r = await editarNomeGrupo(G1, CAMP, "Novo Nome");
    expect(r).toEqual({});
    const ins = chamadas.find((c) => c.tabela === "execucoes" && c.op === "insert")!;
    expect(ins.dados).toMatchObject({ tipo: "nome", conteudo: { padrao: "Novo Nome" }, alvo_grupos: [G1] });
  });

  it("nome vazio: recusa (validarConteudo) sem tocar no banco", async () => {
    const chamadas = usar(responderGrupoDaCampanha);
    const r = await editarNomeGrupo(G1, CAMP, "   ");
    expect(r.erro).toBeTruthy();
    expect(chamadas.some((c) => c.tabela === "execucoes")).toBe(false);
  });

  it("grupo de outra campanha (ou inexistente): erro, sem criar a execução", async () => {
    const chamadas = usar((c) => (c.tabela === "grupos" && c.op === "select" ? { data: null } : {}));
    const r = await editarNomeGrupo(G1, CAMP, "Novo Nome");
    expect(r.erro).toBeTruthy();
    expect(chamadas.some((c) => c.tabela === "execucoes")).toBe(false);
  });
});

describe("marcarCheioManual", () => {
  it("valor true: grava cheio_manual e cheio juntos (link muda na hora)", async () => {
    const chamadas = usar((c) => (c.op === "update" ? { data: [{ id: G1 }] } : {}));
    const r = await marcarCheioManual([G1], CAMP, true);
    expect(r).toEqual({});
    const up = chamadas.find((c) => c.op === "update")!;
    expect(up.dados).toEqual({ cheio_manual: true, cheio: true });
  });

  it("valor null (Automático): só limpa cheio_manual, não toca em cheio", async () => {
    const chamadas = usar((c) => (c.op === "update" ? { data: [{ id: G1 }] } : {}));
    const r = await marcarCheioManual([G1], CAMP, null);
    expect(r).toEqual({});
    const up = chamadas.find((c) => c.op === "update")!;
    expect(up.dados).toEqual({ cheio_manual: null });
  });

  it("lista vazia: recusa sem tocar no banco", async () => {
    const chamadas = usar();
    const r = await marcarCheioManual([], CAMP, true);
    expect(r.erro).toBeTruthy();
    expect(chamadas).toHaveLength(0);
  });

  it("nenhum grupo de fato atualizado: não grava histórico", async () => {
    usar((c) => (c.op === "update" ? { data: [] } : {}));
    await marcarCheioManual([G1], CAMP, true);
    expect(hoisted.registrarHistoricoMock).not.toHaveBeenCalled();
  });
});

describe("atualizarLeads", () => {
  it("sem pedido anterior: limpa conferido_em dos grupos ativos e marca a campanha", async () => {
    const chamadas = usar((c) => {
      if (c.tabela === "campanhas" && c.op === "select") return { data: { leads_atualizados_em: null } };
      return {};
    });
    const r = await atualizarLeads(CAMP);
    expect(r).toEqual({});
    const upCamp = chamadas.find((c) => c.tabela === "campanhas" && c.op === "update")!;
    expect(upCamp.dados).toHaveProperty("leads_atualizados_em");
    const upGrupos = chamadas.find((c) => c.tabela === "grupos" && c.op === "update")!;
    expect(upGrupos.dados).toEqual({ conferido_em: null });
    expect(filtro(upGrupos, "eq", "campanha_id")).toBe(CAMP);
    expect(filtro(upGrupos, "eq", "ativo")).toBe(true);
    expect(hoisted.registrarHistoricoMock).toHaveBeenCalledTimes(1);
  });

  it("pedido há menos de 2 minutos: recusa (travado) sem escrever nada", async () => {
    const ha30s = new Date(Date.now() - 30_000).toISOString();
    const chamadas = usar((c) => (c.tabela === "campanhas" && c.op === "select" ? { data: { leads_atualizados_em: ha30s } } : {}));
    const r = await atualizarLeads(CAMP);
    expect(r.erro).toBeTruthy();
    expect(chamadas.filter((c) => c.op === "update")).toHaveLength(0);
  });

  it("pedido há mais de 2 minutos: deixa passar de novo", async () => {
    const ha3min = new Date(Date.now() - 3 * 60_000).toISOString();
    const chamadas = usar((c) => (c.tabela === "campanhas" && c.op === "select" ? { data: { leads_atualizados_em: ha3min } } : {}));
    const r = await atualizarLeads(CAMP);
    expect(r).toEqual({});
    expect(chamadas.filter((c) => c.op === "update")).toHaveLength(2);
  });

  it("campanha não encontrada: erro", async () => {
    usar((c) => (c.tabela === "campanhas" && c.op === "select" ? { data: null } : {}));
    const r = await atualizarLeads(CAMP);
    expect(r.erro).toBeTruthy();
  });
});

describe("participantesDuplicados", () => {
  it("devolve a lista da RPC", async () => {
    const chamadas = usar((c) => (c.tabela === "rpc:participantes_duplicados_campanha" ? { data: [{ telefone: "5537" + "999990000", grupos: ["G1", "G2"] }] } : {}));
    const r = await participantesDuplicados(CAMP);
    expect(r.duplicados).toEqual([{ telefone: "5537" + "999990000", grupos: ["G1", "G2"] }]);
    expect((chamadas[0].dados as { p_campanha: string }).p_campanha).toBe(CAMP);
  });

  it("campanha inválida: erro sem consultar o banco", async () => {
    const chamadas = usar();
    const r = await participantesDuplicados("não-é-uuid");
    expect(r.erro).toBeTruthy();
    expect(chamadas).toHaveLength(0);
  });

  it("erro na RPC: devolve erro", async () => {
    usar(() => ({ error: { message: "fora do ar" } }));
    const r = await participantesDuplicados(CAMP);
    expect(r.erro).toBeTruthy();
  });
});

describe("gruposDuplicados", () => {
  it("devolve a lista já agrupada e limitada pela RPC (não lê a tabela grupos direto)", async () => {
    const chamadas = usar((c) =>
      c.tabela === "rpc:grupos_duplicados_campanha" ? { data: [{ nome: "Aulão", grupos: [{ id: G1, numero: 1 }, { id: G2, numero: 2 }] }] } : {},
    );
    const r = await gruposDuplicados(CAMP);
    expect(r.duplicados).toEqual([{ nome: "Aulão", grupos: [{ id: G1, numero: 1 }, { id: G2, numero: 2 }] }]);
    expect((chamadas[0].dados as { p_campanha: string }).p_campanha).toBe(CAMP);
    expect(chamadas.some((c) => c.tabela === "grupos")).toBe(false);
  });

  it("nenhum nome repetido: lista vazia", async () => {
    usar((c) => (c.tabela === "rpc:grupos_duplicados_campanha" ? { data: [] } : {}));
    const r = await gruposDuplicados(CAMP);
    expect(r.duplicados).toEqual([]);
  });

  it("erro na RPC: devolve erro", async () => {
    usar(() => ({ error: { message: "fora do ar" } }));
    const r = await gruposDuplicados(CAMP);
    expect(r.erro).toBeTruthy();
  });
});

describe("valoresDoGrupo / salvarValoresGrupo", () => {
  it("valoresDoGrupo: grupo não encontrado na campanha: erro sem ler grupo_variaveis", async () => {
    const chamadas = usar((c) => (c.tabela === "grupos" && c.op === "select" ? { data: null } : {}));
    const r = await valoresDoGrupo(G1, CAMP);
    expect(r.erro).toBeTruthy();
    expect(chamadas.some((c) => c.tabela === "grupo_variaveis")).toBe(false);
  });

  it("valoresDoGrupo: devolve os valores do grupo", async () => {
    usar((c) => {
      if (c.tabela === "grupos" && c.op === "select") return { data: { id: G1 } };
      if (c.tabela === "grupo_variaveis") return { data: [{ chave: "cupom", valor: "G1VIP" }] };
      return {};
    });
    const r = await valoresDoGrupo(G1, CAMP);
    expect(r.valores).toEqual([{ chave: "cupom", valor: "G1VIP" }]);
  });

  it("salvarValoresGrupo: valor vazio remove a linha (herda a campanha)", async () => {
    const chamadas = usar((c) => (c.tabela === "grupos" && c.op === "select" ? { data: { id: G1 } } : {}));
    const r = await salvarValoresGrupo(G1, CAMP, [{ chave: "cupom", valor: "" }]);
    expect(r).toEqual({});
    const del = chamadas.find((c) => c.tabela === "grupo_variaveis" && c.op === "delete")!;
    expect(filtro(del, "in", "chave")).toEqual(["cupom"]);
    expect(chamadas.some((c) => c.tabela === "grupo_variaveis" && c.op === "upsert")).toBe(false);
  });

  it("salvarValoresGrupo: valor preenchido grava (upsert)", async () => {
    const chamadas = usar((c) => {
      if (c.tabela === "grupos" && c.op === "select") return { data: { id: G1 } };
      if (c.tabela === "variaveis_globais") return { data: [] };
      return {};
    });
    const r = await salvarValoresGrupo(G1, CAMP, [{ chave: "cupom", valor: "G1VIP" }]);
    expect(r).toEqual({});
    const up = chamadas.find((c) => c.tabela === "grupo_variaveis" && c.op === "upsert")!;
    expect(up.dados).toEqual([{ grupo_id: G1, chave: "cupom", valor: "G1VIP" }]);
  });

  it("salvarValoresGrupo: valor inválido pro tipo da variável global: nada é salvo", async () => {
    const chamadas = usar((c) => {
      if (c.tabela === "grupos" && c.op === "select") return { data: { id: G1 } };
      if (c.tabela === "variaveis_globais") return { data: [{ chave: "preco", tipo: "numero" }] };
      return {};
    });
    const r = await salvarValoresGrupo(G1, CAMP, [{ chave: "preco", valor: "abc" }]);
    expect(r.erro).toBeTruthy();
    expect(r.erros?.preco).toBeTruthy();
    expect(chamadas.some((c) => c.op === "upsert" || c.op === "delete")).toBe(false);
  });

  it("salvarValoresGrupo: grupo de outra campanha: erro", async () => {
    usar((c) => (c.tabela === "grupos" && c.op === "select" ? { data: null } : {}));
    const r = await salvarValoresGrupo(G1, CAMP, [{ chave: "cupom", valor: "x" }]);
    expect(r.erro).toBeTruthy();
  });
});
