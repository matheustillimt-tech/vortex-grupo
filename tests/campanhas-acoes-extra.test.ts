import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, filtro, type Chamada, type Resposta } from "./apoio/db-falso";

const hoisted = vi.hoisted(() => ({
  dbAtual: undefined as unknown,
  exigirUsuarioMock: vi.fn(async () => ({ id: "u1" })),
  revalidar: vi.fn(),
  redirectMock: vi.fn(),
  historicoMock: vi.fn(),
}));

vi.mock("@/src/lib/permissoes", async () => (await import("./apoio/permissoes")).permissoesFalsas());
vi.mock("@/src/lib/supabase/usuario", () => ({
  exigirUsuario: hoisted.exigirUsuarioMock,
  dbUsuario: async () => hoisted.dbAtual,
}));
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => hoisted.dbAtual }));
vi.mock("next/cache", () => ({ revalidatePath: hoisted.revalidar }));
vi.mock("next/navigation", () => ({ redirect: hoisted.redirectMock }));
vi.mock("@/src/lib/historico", () => ({ registrarHistorico: hoisted.historicoMock }));

import * as acoesCampanhas from "@/app/(painel)/campanhas/actions";
import { arquivarVarias, criarCampanha, duplicarCampanha, excluirCampanha, fixarCampanha, salvarCampanha } from "@/app/(painel)/campanhas/actions";
import type { CampanhaEntrada } from "@/src/lib/regras/campanha";

const CAMPANHA_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const NOVA_ID = "bbbbbbbb-2222-4222-8222-222222222222";

function usar(responder: (c: Chamada) => Resposta) {
  const f = dbFalso(responder);
  hoisted.dbAtual = f.db;
  return { chamadas: f.chamadas };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("criarCampanha", () => {
  it("recusa nome vazio sem tocar no banco", async () => {
    const { chamadas } = usar(() => ({}));
    const r = await criarCampanha("   ", "campanha");
    expect(r).toEqual({ erro: "Dê um nome à campanha." });
    expect(chamadas).toEqual([]);
  });

  it("recusa tipo inválido", async () => {
    const { chamadas } = usar(() => ({}));
    const r = await criarCampanha("Aulão", "evento");
    expect(r).toEqual({ erro: "Tipo de campanha inválido." });
    expect(chamadas).toEqual([]);
  });

  it("gera o slug do nome, usa a primeira conexão conectada e cria com o tipo escolhido", async () => {
    const { chamadas } = usar((c) => {
      if (c.tabela === "campanhas" && c.op === "select") return { data: null }; // slug livre
      if (c.tabela === "conexoes") return { data: [{ id: "c2", status: "pendente" }, { id: "c1", status: "conectado" }] };
      if (c.tabela === "campanhas" && c.op === "insert") return { data: { id: CAMPANHA_ID } };
      return {};
    });
    await criarCampanha("Aulão de Outubro", "viral");
    const ins = chamadas.find((c) => c.tabela === "campanhas" && c.op === "insert")!;
    const dados = ins.dados as Record<string, unknown>;
    expect(dados.slug).toBe("aulao-de-outubro");
    expect(dados.tipo).toBe("viral");
    expect(dados.conexao_criadora_id).toBeNull(); // nasce sem número: a pessoa escolhe em Conexões associadas
    expect(hoisted.historicoMock).toHaveBeenCalled();
  });

  it("endereço já usado: acrescenta -2", async () => {
    const { chamadas } = usar((c) => {
      if (c.tabela === "campanhas" && c.op === "select") {
        const slug = filtro(c, "eq", "slug");
        return { data: slug === "aulao" ? { id: "outra" } : null };
      }
      if (c.tabela === "conexoes") return { data: [{ id: "c1", status: "conectado" }] };
      if (c.tabela === "campanhas" && c.op === "insert") return { data: { id: CAMPANHA_ID } };
      return {};
    });
    await criarCampanha("Aulão", "campanha");
    const ins = chamadas.find((c) => c.tabela === "campanhas" && c.op === "insert")!;
    expect((ins.dados as Record<string, unknown>).slug).toBe("aulao-2");
  });
});

describe("criarCampanha com projeto", () => {
  const PROJETO = "cccccccc-3333-4333-8333-333333333333";
  function responder(projeto: Resposta) {
    return (c: Chamada): Resposta => {
      if (c.tabela === "projetos") return projeto;
      if (c.tabela === "campanhas" && c.op === "select") return { data: null };
      if (c.tabela === "conexoes") return { data: [{ id: "c1", status: "conectado" }] };
      if (c.tabela === "campanhas" && c.op === "insert") return { data: { id: CAMPANHA_ID } };
      return {};
    };
  }

  it("projeto ativo: cria com projeto_id", async () => {
    const { chamadas } = usar(responder({ data: { id: PROJETO, arquivado: false, nome: "Lançamento" } }));
    await criarCampanha("Aulão", "campanha", PROJETO);
    const ins = chamadas.find((c) => c.tabela === "campanhas" && c.op === "insert")!;
    expect((ins.dados as Record<string, unknown>).projeto_id).toBe(PROJETO);
  });

  it("projeto que não é uuid: recusa sem tocar no banco", async () => {
    const { chamadas } = usar(() => ({}));
    expect(await criarCampanha("Aulão", "campanha", "lixo")).toEqual({ erro: "Projeto inválido." });
    expect(chamadas).toEqual([]);
  });

  it("projeto inexistente: recusa, não cria", async () => {
    const { chamadas } = usar(responder({ data: null }));
    expect(await criarCampanha("Aulão", "campanha", PROJETO)).toEqual({ erro: "Projeto não encontrado." });
    expect(chamadas.some((c) => c.tabela === "campanhas" && c.op === "insert")).toBe(false);
  });

  it("projeto arquivado: recusa, não cria", async () => {
    const { chamadas } = usar(responder({ data: { id: PROJETO, arquivado: true } }));
    expect(await criarCampanha("Aulão", "campanha", PROJETO)).toEqual({ erro: "Esse projeto está arquivado; escolha outro." });
    expect(chamadas.some((c) => c.tabela === "campanhas" && c.op === "insert")).toBe(false);
  });

  it("sem projeto (null ou vazio): cria com projeto_id null, sem consultar projetos", async () => {
    const { chamadas } = usar(responder({ data: null }));
    await criarCampanha("Aulão", "campanha", "");
    const ins = chamadas.find((c) => c.tabela === "campanhas" && c.op === "insert")!;
    expect((ins.dados as Record<string, unknown>).projeto_id).toBeNull();
    expect(chamadas.some((c) => c.tabela === "projetos")).toBe(false);
  });
});

describe("duplicarCampanha", () => {
  const ORIGINAL = {
    id: CAMPANHA_ID, nome: "Aulão", slug: "aulao", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T00:00:00Z",
    fixada: true, comunidade_id: "com1", padrao_nome: "GRUPO #{n}", descricao: "", fechado: true, limite_por_grupo: 1000,
    folga: 1, conexao_criadora_id: "c1", usar_comunidade: false, crm_webhook_url: null, projeto_id: null, arquivada: false,
    tipo: "campanha",
  };

  it("campanha inexistente: erro, sem criar nada", async () => {
    const { chamadas } = usar((c) => (c.tabela === "campanhas" && c.op === "select" ? { data: null } : {}));
    const r = await duplicarCampanha(CAMPANHA_ID);
    expect(r).toEqual({ erro: "Campanha não encontrada." });
    expect(chamadas.some((c) => c.op === "insert")).toBe(false);
  });

  it("copia a campanha sem id/slug/created_at/updated_at/fixada/comunidade_id e sem grupos", async () => {
    const { chamadas } = usar((c) => {
      if (c.tabela === "campanhas" && c.op === "select") {
        if (filtro(c, "eq", "slug") !== undefined) return { data: null }; // slug sempre livre
        return { data: ORIGINAL };
      }
      if (c.tabela === "campanha_conexoes" && c.op === "select") return { data: [{ conexao_id: "c9" }] };
      if (c.tabela === "campanha_variaveis" && c.op === "select") return { data: [{ chave: "x", valor: "1" }] };
      if (c.tabela === "campanhas" && c.op === "insert") return { data: { id: NOVA_ID } };
      return {};
    });
    await duplicarCampanha(CAMPANHA_ID);

    const ins = chamadas.find((c) => c.tabela === "campanhas" && c.op === "insert")!;
    const dados = ins.dados as Record<string, unknown>;
    expect(dados.nome).toBe("Cópia de Aulão");
    expect(dados.slug).toBe("copia-de-aulao");
    expect(dados).not.toHaveProperty("id");
    expect(dados).not.toHaveProperty("created_at");
    expect(dados).not.toHaveProperty("updated_at");
    expect(dados.fixada).toBeUndefined();
    expect(dados.comunidade_id).toBeUndefined();
    expect(dados.padrao_nome).toBe("GRUPO #{n}");

    const conexoesIns = chamadas.find((c) => c.tabela === "campanha_conexoes" && c.op === "insert");
    expect((conexoesIns!.dados as { campanha_id: string; conexao_id: string }[])[0]).toEqual({ campanha_id: NOVA_ID, conexao_id: "c9" });
    const variaveisIns = chamadas.find((c) => c.tabela === "campanha_variaveis" && c.op === "insert");
    expect((variaveisIns!.dados as { campanha_id: string; chave: string; valor: string }[])[0]).toEqual({ campanha_id: NOVA_ID, chave: "x", valor: "1" });
    expect(chamadas.some((c) => c.tabela === "grupos")).toBe(false);
    expect(chamadas.some((c) => c.tabela === "execucoes")).toBe(false);

    expect(hoisted.historicoMock).toHaveBeenCalledWith(
      { id: "u1" },
      expect.objectContaining({ resumo: expect.stringContaining("cópia de \"Aulão\"") }),
    );
    expect(hoisted.redirectMock).toHaveBeenCalledWith(`/campanhas/${NOVA_ID}`);
  });
});

describe("salvarCampanha (editar) com término no passado", () => {
  const entradaBase: CampanhaEntrada = {
    nome: "Aulão", slug: "aulao", padrao_nome: "AULÃO #{n}", descricao: "", fechado: true,
    limite_por_grupo: 1000, folga: 1, conexao_criadora_id: "c1", admins: [], usar_comunidade: false, crm_webhook_url: "",
    projeto_id: null,
  };

  it("aceita terminar a campanha numa data já passada (não é validado contra 'agora')", async () => {
    const { chamadas } = usar((c) => (c.tabela === "campanhas" && c.op === "update" ? { data: { id: CAMPANHA_ID } } : {}));
    const r = await salvarCampanha(CAMPANHA_ID, { ...entradaBase, termina_em: "2020-01-01T00:00" });
    expect(r.erro).toBeUndefined();
    const upd = chamadas.find((c) => c.tabela === "campanhas" && c.op === "update")!;
    expect((upd.dados as Record<string, unknown>).termina_em).toBe("2020-01-01T03:00:00.000Z");
  });
});

describe("salvarCampanha (nova) valida adminsNumeros", () => {
  const entrada: CampanhaEntrada = {
    nome: "Aulão", slug: "aulao", padrao_nome: "AULÃO #{n}", descricao: "", fechado: true,
    limite_por_grupo: 1000, folga: 1, conexao_criadora_id: "c1", admins: [], usar_comunidade: false, crm_webhook_url: "",
    projeto_id: null,
  };

  it("número inválido: recusa antes de criar a campanha", async () => {
    const { chamadas } = usar(() => ({}));
    const r = await salvarCampanha(null, entrada, ["abc"]);
    expect(r.erro).toBeTruthy();
    expect(chamadas).toEqual([]);
  });

  it("não é lista: recusa", async () => {
    const { chamadas } = usar(() => ({}));
    const r = await salvarCampanha(null, entrada, "5511" + "999990001" as never);
    expect(r.erro).toBe("Lista de administradores inválida.");
    expect(chamadas).toEqual([]);
  });

  it("grava os números normalizados e sem repetidos", async () => {
    const { chamadas } = usar((c) => (c.tabela === "campanhas" && c.op === "insert" ? { data: { id: NOVA_ID } } : {}));
    await salvarCampanha(null, entrada, ["5511" + "999990001", "5511" + "999990001"]);
    const ins = chamadas.find((c) => c.tabela === "campanha_admins_numeros" && c.op === "insert")!;
    expect(ins.dados).toEqual([{ campanha_id: NOVA_ID, telefone: "5511" + "999990001", criado_por: "u1" }]);
  });
});

describe("fixarCampanha", () => {
  it("atualiza fixada e grava histórico", async () => {
    const { chamadas } = usar(() => ({}));
    const r = await fixarCampanha(CAMPANHA_ID, true);
    expect(r.erro).toBeUndefined();
    const upd = chamadas.find((c) => c.tabela === "campanhas" && c.op === "update")!;
    expect(upd.dados).toEqual({ fixada: true });
    expect(hoisted.historicoMock).toHaveBeenCalledWith({ id: "u1" }, expect.objectContaining({ resumo: "Campanha fixada no topo" }));
  });
});

describe("arquivarVarias", () => {
  it("sem ids: não toca no banco", async () => {
    const { chamadas } = usar(() => ({}));
    const r = await arquivarVarias([], true);
    expect(r).toEqual({});
    expect(chamadas).toEqual([]);
  });

  it("arquiva todas as ids marcadas com .in", async () => {
    const { chamadas } = usar(() => ({}));
    await arquivarVarias(["a", "b"], true);
    const upd = chamadas.find((c) => c.tabela === "campanhas" && c.op === "update")!;
    expect(filtro(upd, "in", "id")).toEqual(["a", "b"]);
    expect(upd.dados).toEqual({ arquivada: true });
  });
});

describe("excluirCampanha", () => {
  it("campanha inexistente: erro", async () => {
    usar((c) => (c.tabela === "campanhas" && c.op === "select" ? { data: null } : {}));
    const r = await excluirCampanha(CAMPANHA_ID, "Aulão");
    expect(r).toEqual({ erro: "Campanha não encontrada." });
  });

  it("nome digitado errado: recusa, sem excluir", async () => {
    const { chamadas } = usar((c) => (c.tabela === "campanhas" && c.op === "select" ? { data: { id: CAMPANHA_ID, nome: "Aulão" } } : {}));
    const r = await excluirCampanha(CAMPANHA_ID, "aulao");
    expect(r).toEqual({ erro: "O nome digitado não é idêntico ao nome da campanha." });
    expect(chamadas.some((c) => c.op === "delete")).toBe(false);
  });

  it("execução enviando: recusa, sem excluir", async () => {
    const { chamadas } = usar((c) => {
      if (c.tabela === "campanhas" && c.op === "select") return { data: { id: CAMPANHA_ID, nome: "Aulão" } };
      if (c.tabela === "execucoes") return { data: [{ id: "e1" }] };
      return {};
    });
    const r = await excluirCampanha(CAMPANHA_ID, "Aulão");
    expect(r).toEqual({ erro: "Há um envio em andamento nesta campanha; espere terminar para excluir." });
    expect(chamadas.some((c) => c.op === "delete")).toBe(false);
  });

  it("nome certo e sem envio em andamento: grava histórico antes de excluir e redireciona", async () => {
    const ordem: string[] = [];
    hoisted.historicoMock.mockImplementation(async () => { ordem.push("historico"); });
    const { chamadas } = usar((c) => {
      if (c.tabela === "campanhas" && c.op === "select") return { data: { id: CAMPANHA_ID, nome: "Aulão" } };
      if (c.tabela === "execucoes") return { data: [] };
      if (c.tabela === "campanhas" && c.op === "delete") { ordem.push("delete"); return {}; }
      return {};
    });
    const r = await excluirCampanha(CAMPANHA_ID, "Aulão");
    expect(r).toBeUndefined();
    expect(ordem).toEqual(["historico", "delete"]);
    expect(chamadas.some((c) => c.tabela === "campanhas" && c.op === "delete")).toBe(true);
    expect(hoisted.redirectMock).toHaveBeenCalledWith("/campanhas");
  });
});

describe("Remover compradores removido (decisão do dono, 19/10/2026)", () => {
  it("as actions de regra de compra não existem mais", () => {
    expect(acoesCampanhas).not.toHaveProperty("adicionarRegraCompra");
    expect(acoesCampanhas).not.toHaveProperty("removerRegraCompra");
  });

  it("duplicar não lê nem grava regras_compra e não escreve nenhuma coluna vip_*", async () => {
    const { chamadas } = usar((c) => {
      if (c.tabela === "campanhas" && c.op === "select") return filtro(c, "eq", "slug") !== undefined ? { data: null } : { data: { id: CAMPANHA_ID, nome: "A", slug: "a" } };
      if (c.tabela === "campanhas" && c.op === "insert") return { data: { id: NOVA_ID } };
      return {};
    });
    await duplicarCampanha(CAMPANHA_ID);
    const ins = chamadas.find((c) => c.tabela === "campanhas" && c.op === "insert")!;
    expect(Object.keys(ins.dados as Record<string, unknown>).some((k) => k.startsWith("vip_"))).toBe(false);
    expect(chamadas.some((c) => c.tabela === "regras_compra")).toBe(false);
  });
});
