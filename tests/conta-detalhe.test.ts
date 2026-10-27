import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, filtro, type Chamada, type Resposta } from "./apoio/db-falso";
import { liberarTudo, negarTudo, SEM_PERMISSAO, usarMembro } from "./apoio/permissoes";

/** Etapa 3K, Tarefa 4: abas Ações, Grupos e Contatos do detalhe da conta. */

const CONTA = "11111111-1111-1111-1111-111111111111";

const hoisted = vi.hoisted(() => ({
  dbAtual: undefined as unknown,
  listarGruposMock: vi.fn(async () => [] as { groupId: string; name: string; participantCount: number; amAdmin: boolean; avatarUrl?: string | null }[]),
  contatosMock: vi.fn(async () => [] as { phone: string; name: string; short: string; notify: string }[]),
  reenfileirarBloqueadosMock: vi.fn(async (..._a: unknown[]) => 0),
  credenciaisMock: vi.fn(async () => ({ id: "z1", token: "t", clientToken: "c" })),
}));

vi.mock("@/src/lib/permissoes", async () => (await import("./apoio/permissoes")).permissoesFalsas());
vi.mock("@/src/lib/supabase/usuario", () => ({ dbUsuario: async () => hoisted.dbAtual, exigirUsuario: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => hoisted.dbAtual }));
vi.mock("@/src/lib/conexoes", () => ({ credenciais: hoisted.credenciaisMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/src/lib/historico", () => ({ registrarHistorico: vi.fn() }));
vi.mock("@/src/lib/zapbot/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/src/lib/zapbot/client")>();
  return { ...real, zapbot: () => ({ listarGrupos: hoisted.listarGruposMock, contatos: hoisted.contatosMock }) };
});
vi.mock("@/src/lib/bloqueio", () => ({
  bloquearTelefones: vi.fn(),
  desbloquearTelefone: vi.fn(),
  reenfileirarBloqueados: hoisted.reenfileirarBloqueadosMock,
}));

import { lerFiltrosDaTelaAcoes } from "@/app/(painel)/_acoes/comum";
import { analisarGrupos } from "@/app/(painel)/leads/actions";
import { atualizarGruposDaConta, listarContatosConta } from "@/app/(painel)/numeros/[id]/actions";
import { filtrarContatos } from "@/app/(painel)/numeros/[id]/contatos-conta";
import { filtrarGruposDaConta, proximoCursor } from "@/app/(painel)/numeros/[id]/grupos-conta";

/** A trava atômica (update condicional em `conexoes`) ganha por padrão: devolve a linha. */
function usar(responder?: (c: Chamada) => Resposta) {
  const f = dbFalso((c) => {
    const r = responder?.(c) ?? {};
    if (c.tabela === "conexoes" && c.op === "update" && r.data === undefined && !r.error) return { data: [{ id: CONTA }] };
    return r;
  });
  hoisted.dbAtual = f.db;
  return { chamadas: f.chamadas };
}

beforeEach(() => {
  vi.clearAllMocks();
  liberarTudo();
  hoisted.listarGruposMock.mockResolvedValue([]);
  hoisted.contatosMock.mockResolvedValue([]);
  hoisted.reenfileirarBloqueadosMock.mockResolvedValue(0);
});

describe("lerFiltrosDaTelaAcoes (leitura da query de TelaAcoes — tela global /acoes e aba Ações do detalhe da conexão)", () => {
  it("regressão: sem prefixo (tela global), lê exatamente as chaves de hoje", () => {
    const { filtros, automacaoId } = lerFiltrosDaTelaAcoes({ aba: "falhas", agrupar: "nao", por: "50", pagina: "3" }, false);
    expect(filtros).toEqual({ aba: "falhas", tipos: null, agrupar: false, inicio: "", fim: "", por: 50, pagina: 3 });
    expect(automacaoId).toBeNull();
    // `sub*` presente não deveria afetar a tela global: só a versão embutida lê as chaves com prefixo.
    expect(lerFiltrosDaTelaAcoes({ subaba: "falhas" }, false).filtros.aba).toBe("todas");
  });

  it("sem parâmetro nenhum (tela global): os mesmos padrões de hoje", () => {
    const { filtros, automacaoId } = lerFiltrosDaTelaAcoes({}, false);
    expect(filtros).toEqual({ aba: "todas", tipos: null, agrupar: true, inicio: "", fim: "", por: 10, pagina: 1 });
    expect(automacaoId).toBeNull();
  });

  it("embutida (aba Ações do detalhe da conexão): lê as mesmas chaves com o prefixo 'sub'", () => {
    const { filtros } = lerFiltrosDaTelaAcoes({ subaba: "falhas", subagrupar: "nao", subpor: "50", subpagina: "2" }, true);
    expect(filtros).toEqual({ aba: "falhas", tipos: null, agrupar: false, inicio: "", fim: "", por: 50, pagina: 2 });
    // sem prefixo (aba de cima do detalhe da conta) não é lido pela versão embutida.
    expect(lerFiltrosDaTelaAcoes({ aba: "falhas" }, true).filtros.aba).toBe("todas");
  });

  it("`automacao` nunca leva prefixo — vale nas duas versões", () => {
    const A = "aaaaaaaa-1111-2222-3333-444444444444";
    expect(lerFiltrosDaTelaAcoes({ automacao: A }, false).automacaoId).toBe(A);
    expect(lerFiltrosDaTelaAcoes({ automacao: A }, true).automacaoId).toBe(A);
  });
});

describe("atualizarGruposDaConta", () => {
  it("upsert dos grupos atuais e apaga da `conta_grupos` os que a conexão não participa mais", async () => {
    hoisted.listarGruposMock.mockResolvedValue([{ groupId: "551199999999-111@g.us", name: "Grupo 1", participantCount: 12, amAdmin: true }]);
    const { chamadas } = usar((c) => (c.tabela === "conexoes" && c.op === "select" ? { data: { grupos_atualizados_em: null, status: "conectado" } } : {}));

    const r = await atualizarGruposDaConta(CONTA);

    expect(r.erro).toBeUndefined();
    expect(r.atualizados).toBe(1);
    const up = chamadas.find((c) => c.tabela === "conta_grupos" && c.op === "upsert")!;
    expect(up.dados).toEqual([{ conexao_id: CONTA, group_id: "551199999999-111@g.us", nome: "Grupo 1", participantes: 12, admin: true, atualizado_em: expect.any(String) }]);
    const del = chamadas.find((c) => c.tabela === "conta_grupos" && c.op === "delete")!;
    expect(filtro(del, "eq", "conexao_id")).toBe(CONTA);
    // Prune por data (o que não foi regravado nesta leitura), sem lista de ids na URL.
    const agora = (up.dados as { atualizado_em: string }[])[0].atualizado_em;
    expect(filtro(del, "lt", "atualizado_em")).toBe(agora);
    expect(del.filtros.some((f) => f[0] === "not")).toBe(false);
  });

  it("foto (Etapa 3M): só grava foto_url nas linhas em que o GET groups trouxe avatarUrl, em lote separado", async () => {
    const FOTO = "https://pps.whatsapp.net/v/t61/g2.jpg";
    hoisted.listarGruposMock.mockResolvedValue([
      { groupId: "g1@g.us", name: "Sem campo", participantCount: 1, amAdmin: true },
      { groupId: "g2@g.us", name: "Com foto", participantCount: 2, amAdmin: true, avatarUrl: FOTO },
      { groupId: "g3@g.us", name: "Sem foto", participantCount: 3, amAdmin: false, avatarUrl: null },
    ]);
    const { chamadas } = usar((c) => (c.tabela === "conexoes" && c.op === "select" ? { data: { grupos_atualizados_em: null, status: "conectado" } } : {}));
    expect((await atualizarGruposDaConta(CONTA)).atualizados).toBe(3);
    const ups = chamadas.filter((c) => c.tabela === "conta_grupos" && c.op === "upsert").map((c) => c.dados as Record<string, unknown>[]);
    expect(ups).toHaveLength(2);
    expect(ups[0].map((l) => [l.group_id, "foto_url" in l])).toEqual([["g1@g.us", false]]);
    expect(ups[1].map((l) => [l.group_id, l.foto_url])).toEqual([["g2@g.us", FOTO], ["g3@g.us", null]]);
  });

  it("trava atômica: update condicional ANTES do Zapbot; outro clique ganhou = recusa sem chamar o Zapbot", async () => {
    const { chamadas } = usar((c) => {
      if (c.tabela === "conexoes" && c.op === "select") return { data: { grupos_atualizados_em: null, status: "conectado" } };
      if (c.tabela === "conexoes" && c.op === "update") return { data: [] };
      return {};
    });
    const r = await atualizarGruposDaConta(CONTA);
    expect(r.erro).toBe("Aguarde 2 minutos entre duas atualizações.");
    expect(hoisted.listarGruposMock).not.toHaveBeenCalled();
    const trava = chamadas.find((c) => c.tabela === "conexoes" && c.op === "update")!;
    expect(trava.dados).toEqual({ grupos_atualizados_em: expect.any(String) });
    expect(String(trava.filtros.find((f) => f[0] === "or")?.[1])).toMatch(/^grupos_atualizados_em\.is\.null,grupos_atualizados_em\.lte\./);
  });

  it("Zapbot falhou: solta a trava (volta ao valor anterior)", async () => {
    hoisted.listarGruposMock.mockRejectedValue(new Error("fora"));
    const { chamadas } = usar((c) => (c.tabela === "conexoes" && c.op === "select" ? { data: { grupos_atualizados_em: null, status: "conectado" } } : {}));
    const r = await atualizarGruposDaConta(CONTA);
    expect(r.erro).toBeTruthy();
    const ups = chamadas.filter((c) => c.tabela === "conexoes" && c.op === "update");
    expect(ups).toHaveLength(2);
    expect(ups[1].dados).toEqual({ grupos_atualizados_em: null });
    expect(filtro(ups[1], "eq", "grupos_atualizados_em")).toBe((ups[0].dados as { grupos_atualizados_em: string }).grupos_atualizados_em);
  });

  it("conexão desconectada: recusa sem chamar o Zapbot", async () => {
    usar((c) => (c.tabela === "conexoes" && c.op === "select" ? { data: { grupos_atualizados_em: null, status: "desconectado" } } : {}));
    const r = await atualizarGruposDaConta(CONTA);
    expect(r.erro).toBe("Conecte a conexão pra atualizar os grupos.");
    expect(hoisted.listarGruposMock).not.toHaveBeenCalled();
  });

  it("travado (2 minutos): recusa sem chamar o Zapbot", async () => {
    usar((c) => (c.tabela === "conexoes" && c.op === "select" ? { data: { grupos_atualizados_em: new Date().toISOString(), status: "conectado" } } : {}));
    const r = await atualizarGruposDaConta(CONTA);
    expect(r.erro).toBe("Aguarde 2 minutos entre duas atualizações.");
    expect(hoisted.listarGruposMock).not.toHaveBeenCalled();
  });

  it("sem permissão contas/editar: recusa", async () => {
    negarTudo();
    const r = await atualizarGruposDaConta(CONTA);
    expect(r.erro).toBe(SEM_PERMISSAO);
  });
});

describe("analisarGrupos — 'Escanear' com conexaoId (aba Grupos do detalhe da conexão)", () => {
  it("filtra pela conexão (passa conexaoId pro reenfileirar) e pede contas/editar (não antispam)", async () => {
    hoisted.reenfileirarBloqueadosMock.mockResolvedValue(2);
    const { chamadas } = usar((c) => {
      if (c.tabela === "conexoes" && c.op === "select") return { data: { grupos_escaneados_em: null } };
      if (c.tabela === "bloqueados_efetivos") return { data: [{ telefone: "5511" + "988887777" }] };
      return {};
    });

    const r = await analisarGrupos(undefined, CONTA);

    expect(r.erro).toBeUndefined();
    expect(hoisted.reenfileirarBloqueadosMock).toHaveBeenCalledWith(expect.anything(), ["5511" + "988887777"], CONTA);
    const upd = chamadas.find((c) => c.tabela === "conexoes" && c.op === "update")!;
    expect(upd.dados).toEqual({ grupos_escaneados_em: expect.any(String) });
  });

  it("continuação (`depois`): não passa pela trava e segue do cursor", async () => {
    const { chamadas } = usar((c) => {
      if (c.tabela === "conexoes" && c.op === "select") return { data: { grupos_escaneados_em: new Date().toISOString() } };
      if (c.tabela === "bloqueados_efetivos") return { data: [{ telefone: "5511" + "988887778" }] };
      return {};
    });
    const r = await analisarGrupos("5511" + "988887777", CONTA);
    expect(r.erro).toBeUndefined();
    expect(chamadas.some((c) => c.tabela === "conexoes")).toBe(false);
    expect(filtro(chamadas.find((c) => c.tabela === "bloqueados_efetivos")!, "gt", "telefone")).toBe("5511" + "988887777");
  });

  it("trava atômica: outro clique ganhou o update condicional = recusa sem reenfileirar", async () => {
    usar((c) => {
      if (c.tabela === "conexoes" && c.op === "select") return { data: { grupos_escaneados_em: null } };
      if (c.tabela === "conexoes" && c.op === "update") return { data: [] };
      return {};
    });
    const r = await analisarGrupos(undefined, CONTA);
    expect(r.erro).toBe("Aguarde 2 minutos entre duas atualizações.");
    expect(hoisted.reenfileirarBloqueadosMock).not.toHaveBeenCalled();
  });

  it("com conexaoId também exige antispam/editar", async () => {
    usarMembro({ papel: "membro", permissoes: { contas: "editar", antispam: "ver" } });
    const { chamadas } = usar();
    const r = await analisarGrupos(undefined, CONTA);
    expect(r.erro).toBe(SEM_PERMISSAO);
    expect(chamadas).toHaveLength(0);
  });

  it("travado (2 minutos): recusa sem reenfileirar", async () => {
    usar((c) => (c.tabela === "conexoes" && c.op === "select" ? { data: { grupos_escaneados_em: new Date().toISOString() } } : {}));
    const r = await analisarGrupos(undefined, CONTA);
    expect(r.erro).toBe("Aguarde 2 minutos entre duas atualizações.");
    expect(hoisted.reenfileirarBloqueadosMock).not.toHaveBeenCalled();
  });

  it("sem conexaoId (botão global do Anti-spam): continua sem trava nem conexão — comportamento de hoje", async () => {
    const { chamadas } = usar((c) => (c.tabela === "bloqueados_efetivos" ? { data: [] } : {}));
    const r = await analisarGrupos();
    expect(r.erro).toBeUndefined();
    expect(chamadas.some((c) => c.tabela === "conexoes")).toBe(false);
  });

  it("sem permissão contas/editar (com conexaoId): recusa", async () => {
    negarTudo();
    const r = await analisarGrupos(undefined, CONTA);
    expect(r.erro).toBe(SEM_PERMISSAO);
  });
});

describe("botão Escanear escondido sem Anti-spam/editar", () => {
  it("a página calcula podeEscanear com contas/editar e antispam/editar; o componente só mostra o botão com ele", () => {
    const pasta = path.resolve(__dirname, "../app/(painel)/numeros/[id]");
    const pagina = readFileSync(path.join(pasta, "page.tsx"), "utf8");
    expect(pagina).toMatch(/podeEscanear = podeEditarContas && \(await permitido\("antispam", "editar"\)\)/);
    expect(pagina).toContain("podeEscanear={podeEscanear}");
    const comp = readFileSync(path.join(pasta, "grupos-conta.tsx"), "utf8");
    expect(comp).toMatch(/\{podeEscanear && \(\s*<Botao/);
    expect(comp).toContain("analisarGrupos(proximo, contaId)");
  });
});

describe("proximoCursor (Escanear parcial continua de onde parou)", () => {
  it("só guarda o cursor quando a análise foi parcial", () => {
    expect(proximoCursor({ parcial: true, proximo: "5511" })).toBe("5511");
    expect(proximoCursor({ parcial: false, proximo: "5511" })).toBeUndefined();
    expect(proximoCursor({ parcial: true })).toBeUndefined();
  });
});

describe("listarContatosConta", () => {
  it("conexão desconectada: pede pra conectar sem chamar o Zapbot", async () => {
    usar((c) => (c.tabela === "conexoes" && c.op === "select" ? { data: { status: "desconectado" } } : {}));
    const r = await listarContatosConta(CONTA);
    expect(r.erro).toBe("Conecte a conexão para ver os contatos.");
    expect(hoisted.contatosMock).not.toHaveBeenCalled();
  });

  it("erro do Zapbot: mensagem genérica, sem lançar", async () => {
    usar((c) => (c.tabela === "conexoes" && c.op === "select" ? { data: { status: "conectado" } } : {}));
    hoisted.contatosMock.mockRejectedValue(new Error("fora do ar"));
    const r = await listarContatosConta(CONTA);
    expect(r.erro).toBe("Não foi possível ler os contatos agora.");
  });

  it("nome = name ou notify; telefone mascarado sem leads/ver", async () => {
    usarMembro({ papel: "membro", permissoes: { leads: "nenhum" } });
    usar((c) => (c.tabela === "conexoes" && c.op === "select" ? { data: { status: "conectado" } } : {}));
    hoisted.contatosMock.mockResolvedValue([
      { phone: "5511" + "988887777", name: "Fulano", short: "", notify: "" },
      { phone: "5511" + "977776666", name: "", short: "", notify: "Apelido" },
    ]);
    const r = await listarContatosConta(CONTA);
    expect(r.contatos).toEqual([
      { phone: "+55 •• •••• 7777", nome: "Fulano" },
      { phone: "+55 •• •••• 6666", nome: "Apelido" },
    ]);
  });

  it("sem leads/ver e telefone que não dá pra mascarar: mostra •••, nunca o número cru", async () => {
    usarMembro({ papel: "membro", permissoes: { leads: "nenhum" } });
    usar((c) => (c.tabela === "conexoes" && c.op === "select" ? { data: { status: "conectado" } } : {}));
    hoisted.contatosMock.mockResolvedValue([{ phone: "abc", name: "X", short: "", notify: "" }]);
    const r = await listarContatosConta(CONTA);
    expect(r.contatos).toEqual([{ phone: "•••", nome: "X" }]);
  });

  it("telefone cheio com leads/ver", async () => {
    liberarTudo();
    usar((c) => (c.tabela === "conexoes" && c.op === "select" ? { data: { status: "conectado" } } : {}));
    hoisted.contatosMock.mockResolvedValue([{ phone: "5511" + "988887777", name: "Fulano", short: "", notify: "" }]);
    const r = await listarContatosConta(CONTA);
    expect(r.contatos).toEqual([{ phone: "5511" + "988887777", nome: "Fulano" }]);
  });
});

describe("filtrarContatos (busca da aba Contatos)", () => {
  const contatos = [
    { phone: "5511" + "988887777", nome: "Ana" },
    { phone: "5511" + "966665555", nome: "Bruno" },
  ];

  it("sem busca devolve tudo", () => {
    expect(filtrarContatos(contatos, "")).toEqual(contatos);
  });

  it("filtra por nome (sem acento/maiúscula)", () => {
    expect(filtrarContatos(contatos, "ana")).toEqual([contatos[0]]);
  });

  it("filtra por dígitos do número", () => {
    expect(filtrarContatos(contatos, "7777")).toEqual([contatos[0]]);
  });
});

describe("filtrarGruposDaConta (busca da aba Grupos)", () => {
  const linhas = [
    { groupId: "g1", nome: "Grupo Alfa", participantes: 1, campanhaNome: null, cheio: null, ativo: null, linkConvite: null },
    { groupId: "g2", nome: "Grupo Beta", participantes: 2, campanhaNome: null, cheio: null, ativo: null, linkConvite: null },
  ];

  it("sem busca devolve tudo", () => {
    expect(filtrarGruposDaConta(linhas, "")).toEqual(linhas);
  });

  it("filtra por nome (sem acento/maiúscula)", () => {
    expect(filtrarGruposDaConta(linhas, "beta")).toEqual([linhas[1]]);
  });
});
