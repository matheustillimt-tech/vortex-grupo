import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, filtro, type Chamada, type Resposta } from "./apoio/db-falso";

const hoisted = vi.hoisted(() => ({
  adminAtual: undefined as unknown,
  exigirUsuarioMock: vi.fn(async () => ({ id: "u1", email: "u1@x.com" })),
  registrarHistoricoMock: vi.fn(async () => undefined),
  obterGrupoMock: vi.fn(),
  linkConviteMock: vi.fn(async () => "https://chat.whatsapp.com/abc"),
}));

vi.mock("@/src/lib/permissoes", async () => (await import("./apoio/permissoes")).permissoesFalsas());
vi.mock("@/src/lib/supabase/usuario", () => ({ exigirUsuario: hoisted.exigirUsuarioMock }));
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => hoisted.adminAtual }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/src/lib/historico", () => ({ registrarHistorico: hoisted.registrarHistoricoMock }));
vi.mock("@/src/lib/conexoes", () => ({ paraZapbot: () => ({ id: "z1", token: "t", clientToken: "c" }) }));
vi.mock("@/src/lib/zapbot/client", () => ({
  zapbot: () => ({ obterGrupo: hoisted.obterGrupoMock, linkConvite: hoisted.linkConviteMock }),
}));

import { desativarGrupos, importarGrupos } from "@/app/(painel)/campanhas/[id]/grupos/actions";

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
});

describe("desativarGrupos", () => {
  it("conexão só os grupos que o banco realmente desativou (select da update) e grava o histórico com essa conexão", async () => {
    const chamadas = usar((c) => (c.op === "update" ? { data: [{ id: G1 }] } : {}));
    const r = await desativarGrupos([G1, G2], CAMP);
    expect(r).toEqual({});
    const up = chamadas.find((c) => c.op === "update")!;
    expect(filtro(up, "in", "id")).toEqual([G1, G2]);
    expect(hoisted.registrarHistoricoMock).toHaveBeenCalledTimes(1);
    expect(hoisted.registrarHistoricoMock).toHaveBeenCalledWith(expect.objectContaining({ id: "u1" }), expect.objectContaining({ acao: "atualizar", area: "Grupos", resumo: "1 grupo(s) desativado(s)" }));
  });

  it("nenhum grupo desativado (filtro não bateu com nada): não grava histórico", async () => {
    usar((c) => (c.op === "update" ? { data: [] } : {}));
    const r = await desativarGrupos([G1], CAMP);
    expect(r).toEqual({});
    expect(hoisted.registrarHistoricoMock).not.toHaveBeenCalled();
  });

  it("marque pelo menos um grupo: nem toca no banco nem no histórico", async () => {
    usar();
    const r = await desativarGrupos([], CAMP);
    expect(r.erro).toBeTruthy();
    expect(hoisted.registrarHistoricoMock).not.toHaveBeenCalled();
  });
});

describe("importarGrupos", () => {
  it("conexão só os grupos de fato importados, não o total de escolhidos", async () => {
    const chamadas = usar((c) => {
      if (c.tabela === "conexoes" && c.op === "select") return { data: { id: "c1", zapbot_id: "z1", zapbot_token_enc: "a", client_token_enc: "b" } };
      if (c.tabela === "grupos" && c.op === "insert") return { data: { id: "novo1" } };
      return {};
    });
    hoisted.obterGrupoMock.mockResolvedValueOnce({ groupId: "g1", name: "Grupo 1", participants: [] }).mockResolvedValueOnce(null);
    const r = await importarGrupos(CAMP, [
      { conexaoId: "c1", groupId: "g1" },
      { conexaoId: "c1", groupId: "g2" },
    ]);
    // o segundo "escolhido" devolve `g: null` do Zapbot e a função retorna erro ali mesmo (sem continuar o loop) —
    // então só o primeiro é de fato importado antes do erro.
    expect(r.erro).toBeTruthy();
    const ins = chamadas.find((c) => c.tabela === "grupos" && c.op === "insert");
    expect(ins).toBeTruthy();
    // O erro no meio do loop interrompe a função antes do histórico (que só é gravado depois do loop inteiro).
    expect(hoisted.registrarHistoricoMock).not.toHaveBeenCalled();
  });

  it("grava o histórico com a contagem de importados quando todos os escolhidos entram", async () => {
    usar((c) => {
      if (c.tabela === "conexoes" && c.op === "select") return { data: { id: "c1", zapbot_id: "z1", zapbot_token_enc: "a", client_token_enc: "b" } };
      if (c.tabela === "grupos" && c.op === "insert") return { data: { id: "novo1" } };
      return {};
    });
    hoisted.obterGrupoMock.mockResolvedValue({ groupId: "g1", name: "Grupo 1", participants: [] });
    const r = await importarGrupos(CAMP, [{ conexaoId: "c1", groupId: "g1" }]);
    expect(r).toEqual({});
    expect(hoisted.registrarHistoricoMock).toHaveBeenCalledTimes(1);
    expect(hoisted.registrarHistoricoMock).toHaveBeenCalledWith(expect.objectContaining({ id: "u1" }), expect.objectContaining({ acao: "adicionar", area: "Grupos", resumo: "1 grupo(s) importado(s)" }));
  });

  it("nenhum escolhido reconhecido (conexão não encontrada): não grava histórico", async () => {
    usar(() => ({ data: null }));
    const r = await importarGrupos(CAMP, [{ conexaoId: "sem-conexao", groupId: "g1" }]);
    expect(r).toEqual({});
    expect(hoisted.registrarHistoricoMock).not.toHaveBeenCalled();
  });

  it("lista vazia de escolhidos: não grava histórico", async () => {
    usar();
    const r = await importarGrupos(CAMP, []);
    expect(r).toEqual({});
    expect(hoisted.registrarHistoricoMock).not.toHaveBeenCalled();
  });
});

describe("importarGrupos — seguir o padrão da campanha", () => {
  function montarImport() {
    return usar((c) => {
      if (c.tabela === "conexoes" && c.op === "select") return { data: { id: "c1", zapbot_id: "z1", zapbot_token_enc: "a", client_token_enc: "b" } };
      if (c.tabela === "grupos" && c.op === "insert") return { data: { id: "novo1" } };
      if (c.tabela === "campanhas" && c.op === "select") return { data: { limite_por_grupo: 1000, padrao_nome: "🟨 É HOJE 20H 🟨", caractere_numeracao: "", numero_no_inicio: false } };
      return {};
    });
  }

  it("marcado: agenda Trocar nome só nos grupos importados, com o padrão numerado", async () => {
    const chamadas = montarImport();
    hoisted.obterGrupoMock.mockResolvedValue({ groupId: "g1", name: "Grupo antigo", participants: [] });
    const r = await importarGrupos(CAMP, [{ conexaoId: "c1", groupId: "g1" }], true);
    expect(r).toEqual({});
    const exec = chamadas.find((c) => c.tabela === "execucoes" && c.op === "insert")!;
    expect(exec.dados).toMatchObject({ tipo: "nome", origem: "massa", alvo_grupos: ["novo1"], conteudo: { padrao: "🟨 É HOJE 20H 🟨 #{n}" } });
  });

  it("desmarcado: mantém o nome que o grupo já tinha", async () => {
    const chamadas = montarImport();
    hoisted.obterGrupoMock.mockResolvedValue({ groupId: "g1", name: "Grupo antigo", participants: [] });
    await importarGrupos(CAMP, [{ conexaoId: "c1", groupId: "g1" }]);
    expect(chamadas.some((c) => c.tabela === "execucoes")).toBe(false);
  });
});
