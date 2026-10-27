import { beforeEach, describe, expect, it, vi } from "vitest";
import { liberarTudo, negarTudo, SEM_PERMISSAO, usarMembro } from "./apoio/permissoes";

/** Recusa sem permissão: pelo menos uma ação por arquivo `"use server"`. Nenhum banco pode ser tocado. */

const hoisted = vi.hoisted(() => ({
  dbAdmin: vi.fn(() => {
    throw new Error("não devia tocar no banco (admin)");
  }),
  dbUsuario: vi.fn(async () => {
    throw new Error("não devia tocar no banco (usuário)");
  }),
  historico: vi.fn(),
}));

vi.mock("@/src/lib/permissoes", async () => (await import("./apoio/permissoes")).permissoesFalsas());
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: hoisted.dbAdmin }));
vi.mock("@/src/lib/supabase/usuario", () => ({ exigirUsuario: vi.fn(async () => ({ id: "u1" })), dbUsuario: hoisted.dbUsuario }));
vi.mock("@/src/lib/historico", () => ({ registrarHistorico: hoisted.historico }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import * as execucoes from "@/app/(painel)/_acoes/execucoes";
import * as acoes from "@/app/(painel)/acoes/actions";
import * as automacoes from "@/app/(painel)/automacoes/actions";
import * as configuracoes from "@/app/(painel)/campanhas/[id]/configuracoes/actions";
import * as grupos from "@/app/(painel)/campanhas/[id]/grupos/actions";
import * as campanhas from "@/app/(painel)/campanhas/actions";
import * as equipe from "@/app/(painel)/equipe/actions";
import * as leads from "@/app/(painel)/leads/actions";
import * as modelos from "@/app/(painel)/modelos/actions";
import * as numeros from "@/app/(painel)/numeros/actions";
import * as projetos from "@/app/(painel)/projetos/actions";
import * as sequencias from "@/app/(painel)/sequencias/actions";
import * as variaveis from "@/app/(painel)/variaveis/actions";
import * as webhooks from "@/app/(painel)/hooks/actions";
import * as integracoes from "@/app/(painel)/webhooks/actions";
import * as deeplinks from "@/app/(painel)/deeplinks/actions";

const ID = "11111111-2222-3333-4444-555555555555";
const recusa = { erro: SEM_PERMISSAO };

beforeEach(() => {
  vi.clearAllMocks();
  negarTudo();
});

function semBanco() {
  expect(hoisted.dbAdmin).not.toHaveBeenCalled();
  expect(hoisted.dbUsuario).not.toHaveBeenCalled();
  expect(hoisted.historico).not.toHaveBeenCalled();
}

describe("ações recusam sem permissão", () => {
  it("campanhas/actions", async () => {
    expect(await campanhas.arquivarCampanha(ID, true)).toEqual(recusa);
    semBanco();
  });

  it("campanhas/[id]/configuracoes", async () => {
    expect(await configuracoes.removerVariavel(ID, "nome")).toEqual(recusa);
    semBanco();
  });

  it("campanhas/[id]/grupos (inclusive a de leitura, que pede 'ver')", async () => {
    expect(await grupos.criarGrupoAgora(ID)).toEqual(recusa);
    expect(await grupos.listarImportaveis(ID)).toEqual(recusa);
    await expect(grupos.tentarDeNovo(ID, ID)).rejects.toThrow(SEM_PERMISSAO);
    semBanco();
  });

  it("acoes (assistente Adicionar ação)", async () => {
    const entrada = { categoria: "campanha" as const, campanhas: [ID], projetoId: null, tipo: "abrir" as const, contas: null, grupos: null, conteudo: {}, importante: false, quando: "agora" };
    expect(await acoes.criarAcao(entrada)).toEqual(recusa);
    expect(await acoes.dadosDaCampanhaAcao(ID)).toEqual(recusa);
    expect(await acoes.listarGruposAcao(ID, {})).toEqual(recusa);
    semBanco();
  });

  it("_acoes/execucoes (as que lançam e as em lote)", async () => {
    await expect(execucoes.cancelarExecucao(ID, ID)).rejects.toThrow(SEM_PERMISSAO);
    expect(await execucoes.cancelarEmLote([ID], ID)).toEqual({ feitas: 0, erros: [SEM_PERMISSAO] });
    semBanco();
  });

  it("automacoes", async () => {
    expect(await automacoes.moverParaPasta([ID], "x")).toEqual(recusa);
    expect(await automacoes.excluirAutomacoes([ID])).toEqual({ feitas: 0, erros: [SEM_PERMISSAO] });
    semBanco();
  });

  it("sequencias (área Automações)", async () => {
    expect(await sequencias.renomearSequencia(ID, "Nova")).toEqual(recusa);
    await expect(sequencias.excluirSequencia(ID)).rejects.toThrow(SEM_PERMISSAO);
    semBanco();
  });

  it("leads: tags pedem Leads; bloqueio pede Anti-spam", async () => {
    usarMembro({ papel: "membro", permissoes: { leads: "editar", antispam: "ver" } });
    expect(await leads.bloquearPessoa("5537" + "999990000", "spam")).toEqual(recusa);
    expect(await leads.analisarGrupos()).toEqual(recusa);
    semBanco();

    usarMembro({ papel: "membro", permissoes: { leads: "ver", antispam: "editar" } });
    expect(await leads.criarTag("VIP")).toEqual(recusa);
    await expect(leads.tirarTagDaPessoa("5537" + "999990000", ID, null)).rejects.toThrow(SEM_PERMISSAO);
    semBanco();
  });

  it("numeros (área Conexões)", async () => {
    expect(await numeros.excluirConexao(ID)).toEqual(recusa);
    expect(await numeros.desconectarConexao(ID)).toEqual(recusa);
    expect(await numeros.finalizarSessaoConexao(ID)).toEqual(recusa);
    expect(await numeros.definirProjetoConexao(ID, null)).toEqual(recusa);
    expect(await numeros.definirCampanhasDaConta(ID, [ID])).toEqual(recusa);
    semBanco();
  });

  it("modelos", async () => {
    expect(await modelos.excluirModelos([ID])).toEqual(recusa);
    semBanco();
  });

  it("variaveis", async () => {
    expect(await variaveis.excluirVariavelGlobal(ID)).toEqual(recusa);
    semBanco();
  });

  it("webhooks", async () => {
    expect(await webhooks.excluirWebhook(ID)).toEqual(recusa);
    semBanco();
  });

  it("webhooks de checkout (Etapa 3H)", async () => {
    expect(await integracoes.criarIntegracao({ nome: "Hotmart", plataforma: "hotmart" })).toEqual(recusa);
    expect(await integracoes.arquivarIntegracao(ID, true)).toEqual(recusa);
    expect(await integracoes.regerarLinkIntegracao(ID)).toEqual(recusa);
    semBanco();
  });

  it("projetos", async () => {
    expect(await projetos.excluirProjeto(ID)).toEqual(recusa);
    semBanco();
  });

  it("deeplinks (Etapa 3H, Tarefa 2): área campanhas/editar", async () => {
    expect(await deeplinks.criarDeeplink({ nome: "Bio", destino: "https://chat.whatsapp.com/ABC", slug: "bio", pasta: null })).toEqual(recusa);
    expect(await deeplinks.moverDeeplinks([ID], "Pasta")).toEqual(recusa);
    expect(await deeplinks.excluirDeeplinks([ID])).toEqual(recusa);
    semBanco();
  });

  it("equipe: só Administrador, com a mensagem da tela", async () => {
    liberarTudo();
    usarMembro({ papel: "membro", permissoes: {} }); // Membro com tudo "editar" ainda não muda a equipe
    expect(await equipe.removerAcesso(ID)).toEqual({ erro: "Só Administradores mudam a equipe." });
    semBanco();
  });

  it("'ver' não basta pra mudar nada", async () => {
    usarMembro({ papel: "membro", permissoes: { webhooks: "ver", projetos: "ver" } });
    expect(await webhooks.alternarWebhook(ID, false)).toEqual(recusa);
    expect(await integracoes.regerarLinkIntegracao(ID)).toEqual(recusa);
    expect(await projetos.arquivarProjeto(ID, true)).toEqual(recusa);
    semBanco();
  });
});
