import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, filtro, type Chamada, type Resposta } from "./apoio/db-falso";
import { liberarTudo, SEM_PERMISSAO, usarMembro } from "./apoio/permissoes";

const hoisted = vi.hoisted(() => ({ dbAtual: undefined as unknown }));

vi.mock("@/src/lib/permissoes", async () => (await import("./apoio/permissoes")).permissoesFalsas());
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => hoisted.dbAtual }));
vi.mock("@/src/lib/supabase/usuario", () => ({ exigirUsuario: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/src/lib/automacoes", () => ({ sincronizarCronograma: vi.fn(async () => undefined), removerPendentes: vi.fn(async () => undefined) }));

import {
  alternarAutomacoes,
  cancelarTudoAutomacao,
  duplicarAutomacoes,
  exportarAutomacaoJsonAcao,
  importarAutomacaoJson,
  salvarAutomacao,
} from "@/app/(painel)/automacoes/actions";

beforeEach(() => {
  vi.clearAllMocks();
  liberarTudo();
});

describe("salvarAutomacao: grava provedor/produto da automação de checkout", () => {
  it("insere provedor e produto na tabela automacoes", async () => {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "campanhas" && c.op === "select") return { data: { arquivada: false } };
      if (c.tabela === "automacoes" && c.op === "insert") return { data: { id: "a1" } };
      if (c.tabela === "automacao_acoes" && c.op === "insert") return { data: [{ id: "x1" }] };
      return {};
    });
    hoisted.dbAtual = db;

    const entrada = {
      nome: "Sai quem comprou",
      campanha_id: "11111111-1111-1111-1111-111111111111",
      gatilho: "checkout",
      quando: null,
      alvo_grupos: null,
      pasta: null,
      provedor: "hotmart",
      produto: "Curso X",
      acoes: [{ tipo: "remover_participante" as const, conteudo: {}, atraso_min: 0 }],
    };
    const r = await salvarAutomacao(null, entrada, false);
    expect(r.erro).toBeUndefined();
    expect(r.id).toBe("a1");

    const insereAutomacao = chamadas.find((c) => c.tabela === "automacoes" && c.op === "insert");
    expect(insereAutomacao?.dados).toMatchObject({ provedor: "hotmart", produto: "Curso X" });
  });
});

describe("salvarAutomacao: campanha arquivada", () => {
  const entrada = {
    nome: "Boas-vindas",
    campanha_id: "11111111-1111-1111-1111-111111111111",
    gatilho: "checkout",
    quando: null,
    alvo_grupos: null,
    pasta: null,
    provedor: "hotmart",
    produto: "Curso X",
    acoes: [{ tipo: "remover_participante" as const, conteudo: {}, atraso_min: 0 }],
  };

  it("automação nova numa campanha arquivada é recusada antes de gravar", async () => {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "campanhas" && c.op === "select") return { data: { arquivada: true } };
      return {};
    });
    hoisted.dbAtual = db;
    const r = await salvarAutomacao(null, entrada, false);
    expect(r.erro).toBe("Essa campanha está arquivada: escolha outra.");
    expect(chamadas.some((c) => c.op === "insert")).toBe(false);
  });

  it("campanha inexistente é recusada", async () => {
    const { db } = dbFalso(() => ({}));
    hoisted.dbAtual = db;
    const r = await salvarAutomacao(null, entrada, false);
    expect(r.erro).toBe("Campanha não encontrada.");
  });

  it("edição que mantém a campanha (mesmo arquivada) não confere a campanha de novo", async () => {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "automacoes" && c.op === "select") return { data: { ativo: false, gatilho: "checkout", campanha_id: entrada.campanha_id, quando: null } };
      if (c.tabela === "automacoes" && c.op === "update") return { data: { id: "a1" } };
      if (c.tabela === "automacao_acoes" && c.op === "select") return { data: [] };
      if (c.tabela === "automacao_acoes" && c.op === "insert") return { data: [{ id: "x1" }] };
      return {};
    });
    hoisted.dbAtual = db;
    const r = await salvarAutomacao("a1", entrada, false);
    expect(r.erro).toBeUndefined();
    expect(chamadas.some((c) => c.tabela === "campanhas")).toBe(false);
  });

  it("editar uma automação de checkout pra cronograma zera provedor, produto e checkout_evento", async () => {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "automacoes" && c.op === "select") return { data: { ativo: false, gatilho: "checkout", campanha_id: entrada.campanha_id, quando: null } };
      if (c.tabela === "automacoes" && c.op === "update") return { data: { id: "a1" } };
      if (c.tabela === "automacao_acoes" && c.op === "select") return { data: [] };
      if (c.tabela === "automacao_acoes" && c.op === "insert") return { data: [{ id: "x1" }] };
      return {};
    });
    hoisted.dbAtual = db;
    const entradaCronograma = {
      nome: "Agora é cronograma",
      campanha_id: entrada.campanha_id,
      gatilho: "cronograma",
      quando: "2099-01-01T10:00:00Z",
      alvo_grupos: null,
      pasta: null,
      provedor: "hotmart",
      produto: "Curso X",
      checkout_evento: "aprovada",
      acoes: [{ tipo: "abrir" as const, conteudo: {}, atraso_min: 0 }],
    };
    const r = await salvarAutomacao("a1", entradaCronograma, false);
    expect(r.erro).toBeUndefined();
    const update = chamadas.find((c) => c.tabela === "automacoes" && c.op === "update");
    expect(update?.dados).toMatchObject({ provedor: null, produto: null, checkout_evento: null, gatilho: "cronograma" });
  });
});

describe("duplicarAutomacoes: copia provedor/produto da automação original", () => {
  it("insere a cópia com o mesmo provedor e produto", async () => {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "automacoes" && c.op === "select") {
        return {
          data: {
            nome: "Sai quem comprou",
            campanha_id: "c1",
            gatilho: "checkout",
            quando: null,
            alvo_grupos: null,
            pasta: null,
            provedor: "hotmart",
            produto: "Curso X",
            automacao_acoes: [{ ordem: 0, tipo: "remover_participante", conteudo: {}, atraso_min: 0 }],
          },
        };
      }
      if (c.tabela === "automacoes" && c.op === "insert") return { data: { id: "a2" } };
      if (c.tabela === "automacao_acoes" && c.op === "insert") return { data: [{ id: "x2" }] };
      return {};
    });
    hoisted.dbAtual = db;

    const r = await duplicarAutomacoes(["a1"]);
    expect(r.erros).toEqual([]);
    expect(r.feitas).toBe(1);

    const insereCopia = chamadas.find((c) => c.tabela === "automacoes" && c.op === "insert");
    expect(insereCopia?.dados).toMatchObject({ provedor: "hotmart", produto: "Curso X", nome: "Cópia de Sai quem comprou" });
  });
});

describe("cancelarTudoAutomacao: cancela as agendadas da automação", () => {
  it("cancela e registra no histórico, contando quantas mexeu", async () => {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "automacoes" && c.op === "select") return { data: { nome: "Boas-vindas", campanha_id: "c1" } };
      if (c.tabela === "execucoes" && c.op === "update") return { data: [{ id: "e1" }, { id: "e2" }] };
      return {};
    });
    hoisted.dbAtual = db;

    const r = await cancelarTudoAutomacao("11111111-1111-1111-1111-111111111111");
    expect(r.erro).toBeUndefined();
    expect(r.feitas).toBe(2);
    const update = chamadas.find((c) => c.tabela === "execucoes" && c.op === "update");
    expect(update?.dados).toEqual({ status: "cancelada" });
    expect(filtro(update!, "eq", "automacao_id")).toBe("11111111-1111-1111-1111-111111111111");
    expect(filtro(update!, "eq", "status")).toBe("agendada");
  });

  it("automação não encontrada", async () => {
    const { db } = dbFalso(() => ({ data: null }));
    hoisted.dbAtual = db;
    const r = await cancelarTudoAutomacao("11111111-1111-1111-1111-111111111111");
    expect(r.erro).toBe("Automação não encontrada.");
    expect(r.feitas).toBe(0);
  });
});

describe("exportarAutomacaoJsonAcao: monta o JSON sem id, campanha, conexões ou grupos", () => {
  it("devolve nome e gatilho/ações na ordem", async () => {
    const { db } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "automacoes" && c.op === "select") {
        return {
          data: {
            nome: "Sai quem comprou",
            gatilho: "checkout",
            quando: null,
            provedor: "hotmart",
            produto: "Curso X",
            checkout_evento: null,
            automacao_acoes: [{ ordem: 0, tipo: "remover_participante", conteudo: {}, atraso_min: 0 }],
          },
        };
      }
      return {};
    });
    hoisted.dbAtual = db;

    const r = await exportarAutomacaoJsonAcao("11111111-1111-1111-1111-111111111111");
    expect(r.erro).toBeUndefined();
    expect(r.json).toEqual({
      versao: 1,
      nome: "Sai quem comprou",
      gatilho: "checkout",
      quando: null,
      provedor: "hotmart",
      produto: "Curso X",
      checkout_evento: null,
      acoes: [{ tipo: "remover_participante", conteudo: {}, ordem: 0 }],
    });
    expect(r.json).not.toHaveProperty("id");
    expect(r.json).not.toHaveProperty("campanha_id");
  });
});

describe("importarAutomacaoJson: valida com as mesmas regras do salvar e nasce desativada", () => {
  const JSON_VALIDO = JSON.stringify({
    versao: 1,
    nome: "Sai quem comprou",
    gatilho: "checkout",
    provedor: "hotmart",
    produto: "Curso X",
    acoes: [{ tipo: "remover_participante", conteudo: {}, ordem: 0 }],
  });

  it("importa, sempre ativo: false", async () => {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "campanhas" && c.op === "select") return { data: { arquivada: false } };
      if (c.tabela === "automacoes" && c.op === "insert") return { data: { id: "a9" } };
      if (c.tabela === "automacao_acoes" && c.op === "insert") return { data: [{ id: "x9" }] };
      return {};
    });
    hoisted.dbAtual = db;

    const r = await importarAutomacaoJson("22222222-2222-2222-2222-222222222222", JSON_VALIDO);
    expect(r.erro).toBeUndefined();
    expect(r.id).toBe("a9");
    const insereAutomacao = chamadas.find((c) => c.tabela === "automacoes" && c.op === "insert");
    expect(insereAutomacao?.dados).toMatchObject({ nome: "Sai quem comprou", campanha_id: "22222222-2222-2222-2222-222222222222", ativo: false });
  });

  it("imagem do grupo: só imagem do bucket `midias` do nosso Supabase (link de outro site é recusado)", async () => {
    const comImagem = (url: string) =>
      JSON.stringify({ versao: 1, nome: "Foto", gatilho: "grupo_criado", acoes: [{ tipo: "imagem", conteudo: { url }, ordem: 0 }] });
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "campanhas" && c.op === "select") return { data: { arquivada: false } };
      if (c.tabela === "automacoes" && c.op === "insert") return { data: { id: "a9" } };
      if (c.tabela === "automacao_acoes" && c.op === "insert") return { data: [{ id: "x9" }] };
      return {};
    });
    hoisted.dbAtual = db;
    const ruim = await importarAutomacaoJson("22222222-2222-2222-2222-222222222222", comImagem("https://exemplo.com/a.png"));
    expect(ruim.erro).toBe("Ação 1: A imagem do grupo precisa ser enviada pelo Vórtex Grupo.");
    expect(chamadas.some((c) => c.op === "insert")).toBe(false);
    const boa = await importarAutomacaoJson("22222222-2222-2222-2222-222222222222", comImagem("https://exemplo.supabase.co/storage/v1/object/public/midias/c1/capa.png"));
    expect(boa.erro).toBeUndefined();
  });

  it("versão desconhecida é recusada antes de olhar o resto", async () => {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "campanhas" && c.op === "select") return { data: { arquivada: false } };
      return {};
    });
    hoisted.dbAtual = db;
    const r = await importarAutomacaoJson("22222222-2222-2222-2222-222222222222", JSON.stringify({ versao: 2, nome: "x", gatilho: "cronograma", acoes: [] }));
    expect(r.erro).toMatch(/[Vv]ersão/);
    expect(chamadas.some((c) => c.op === "insert")).toBe(false);
  });

  it("sem campanha de destino: recusa antes de ler o JSON", async () => {
    const { db } = dbFalso(() => ({}));
    hoisted.dbAtual = db;
    const r = await importarAutomacaoJson("", JSON_VALIDO);
    expect(r.erro).toBe("Escolha a campanha de destino.");
  });

  it("arquivo maior que 200 KB é recusado", async () => {
    const { db } = dbFalso(() => ({}));
    hoisted.dbAtual = db;
    const r = await importarAutomacaoJson("22222222-2222-2222-2222-222222222222", "a".repeat(201 * 1024));
    expect(r.erro).toMatch(/200 KB/);
  });

  it("JSON malformado dá erro claro", async () => {
    const { db } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "campanhas" && c.op === "select") return { data: { arquivada: false } };
      return {};
    });
    hoisted.dbAtual = db;
    const r = await importarAutomacaoJson("22222222-2222-2222-2222-222222222222", "{ nao é json");
    expect(r.erro).toMatch(/JSON inválido/);
  });

  it("campanha arquivada é recusada", async () => {
    const { db } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "campanhas" && c.op === "select") return { data: { arquivada: true } };
      return {};
    });
    hoisted.dbAtual = db;
    const r = await importarAutomacaoJson("22222222-2222-2222-2222-222222222222", JSON_VALIDO);
    expect(r.erro).toBe("Essa campanha está arquivada: escolha outra.");
  });

  it("reaproveita a validação do salvar: ação fora do que o gatilho aceita é recusada", async () => {
    const { db } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "campanhas" && c.op === "select") return { data: { arquivada: false } };
      return {};
    });
    hoisted.dbAtual = db;
    const bruto = JSON.stringify({ versao: 1, nome: "x", gatilho: "checkout", produto: "P", acoes: [{ tipo: "mensagem", conteudo: {}, ordem: 0 }] });
    const r = await importarAutomacaoJson("22222222-2222-2222-2222-222222222222", bruto);
    expect(r.erro).toMatch(/não vale para este gatilho/);
  });
});

// Etapa 3F, Tarefa 3, Ruling 4: toda referência aninhada (grupos/contas da campanha, tag da Tag Condicional,
// campanha de destino do "mover grupos") é conferida no banco, tanto no salvar quanto no importar JSON — o
// assistente só oferece opções válidas, mas o servidor não confia nisso.
describe("salvarAutomacao / importarAutomacaoJson: referências aninhadas conferidas no banco", () => {
  const CAMP = "11111111-1111-1111-1111-111111111111";
  const DESTINO = "22222222-2222-2222-2222-222222222222";
  const DESTINO_ARQUIVADA = "22222222-2222-2222-2222-222222222223";
  const G1 = "33333333-3333-3333-3333-333333333331";
  const G_OUTRO = "33333333-3333-3333-3333-333333333332";
  const K1 = "44444444-4444-4444-4444-444444444441";
  const K_OUTRO = "44444444-4444-4444-4444-444444444442";
  const TAG1 = "55555555-5555-5555-5555-555555555551";
  const TAG_INEXISTENTE = "55555555-5555-5555-5555-555555555552";

  type CampanhaLinha = { arquivada: boolean; conexao_criadora_id?: string | null };

  function banco(opts: {
    campanhas?: Record<string, CampanhaLinha>;
    gruposDaCampanha?: { id: string; campanha_id: string }[];
    gruposAtivos?: { campanha_id: string; conexao_id: string }[];
    associadas?: Record<string, string[]>;
    tagsExistentes?: string[];
    /** Linha de `automacoes` pro `alternarUma` (reativar pela lista) carregar. */
    automacaoRow?: Record<string, unknown>;
  } = {}) {
    return dbFalso((c: Chamada): Resposta => {
      const eqId = filtro(c, "eq", "id") as string | undefined;
      const inId = filtro(c, "in", "id") as string[] | undefined;
      if (c.tabela === "campanhas" && c.op === "select") {
        if (eqId) return { data: opts.campanhas?.[eqId] ?? null };
        return {};
      }
      if (c.tabela === "campanha_conexoes") {
        const campId = filtro(c, "eq", "campanha_id") as string;
        return { data: (opts.associadas?.[campId] ?? []).map((k) => ({ conexao_id: k })) };
      }
      if (c.tabela === "grupos") {
        const campId = filtro(c, "eq", "campanha_id") as string;
        if (inId) {
          const validos = (opts.gruposDaCampanha ?? []).filter((g) => g.campanha_id === campId && inId.includes(g.id));
          return { data: validos.map((g) => ({ id: g.id })) };
        }
        return { data: (opts.gruposAtivos ?? []).filter((g) => g.campanha_id === campId).map((g) => ({ conexao_id: g.conexao_id })) };
      }
      if (c.tabela === "conexoes") return { data: (inId ?? []).map((id) => ({ id, nome: id, telefone: null, status: "conectado" })) };
      if (c.tabela === "tags") return { data: (opts.tagsExistentes ?? []).filter((t) => inId?.includes(t)).map((id) => ({ id })) };
      if (c.tabela === "automacoes" && c.op === "select") return { data: opts.automacaoRow ?? null };
      if (c.tabela === "automacoes" && c.op === "insert") return { data: { id: "a1" } };
      if (c.tabela === "automacoes" && c.op === "update") return { data: { id: "a1" } };
      if (c.tabela === "automacao_acoes" && c.op === "insert") return { data: [{ id: "x1" }] };
      return {};
    });
  }

  it("grupo alvo que não é da campanha é recusado", async () => {
    hoisted.dbAtual = banco({ campanhas: { [CAMP]: { arquivada: false } }, gruposDaCampanha: [{ id: G1, campanha_id: CAMP }] }).db;
    const entrada = {
      nome: "x", campanha_id: CAMP, gatilho: "cronograma", quando: "2099-01-01T10:00:00Z",
      alvo_grupos: [G_OUTRO], pasta: null, provedor: null, produto: null,
      acoes: [{ tipo: "abrir" as const, conteudo: {}, atraso_min: 0 }],
    };
    expect(await salvarAutomacao(null, entrada, false)).toEqual({ erro: "Grupo escolhido não é desta campanha." });
  });

  it("grupo alvo da campanha é aceito", async () => {
    hoisted.dbAtual = banco({ campanhas: { [CAMP]: { arquivada: false } }, gruposDaCampanha: [{ id: G1, campanha_id: CAMP }] }).db;
    const entrada = {
      nome: "x", campanha_id: CAMP, gatilho: "cronograma", quando: "2099-01-01T10:00:00Z",
      alvo_grupos: [G1], pasta: null, provedor: null, produto: null,
      acoes: [{ tipo: "abrir" as const, conteudo: {}, atraso_min: 0 }],
    };
    const r = await salvarAutomacao(null, entrada, false);
    expect(r.erro).toBeUndefined();
  });

  it("conexão alvo que não é da campanha é recusada", async () => {
    hoisted.dbAtual = banco({ campanhas: { [CAMP]: { arquivada: false } }, associadas: { [CAMP]: [K1] } }).db;
    const entrada = {
      nome: "x", campanha_id: CAMP, gatilho: "grupo_cheio", quando: null,
      alvo_grupos: null, alvo_contas: [K_OUTRO], pasta: null, provedor: null, produto: null,
      acoes: [{ tipo: "abrir" as const, conteudo: {}, atraso_min: 0 }],
    };
    expect(await salvarAutomacao(null, entrada, false)).toEqual({ erro: "Conexão escolhida não é desta campanha." });
  });

  it("conexão associada à campanha é aceita", async () => {
    hoisted.dbAtual = banco({ campanhas: { [CAMP]: { arquivada: false } }, associadas: { [CAMP]: [K1] } }).db;
    const entrada = {
      nome: "x", campanha_id: CAMP, gatilho: "grupo_cheio", quando: null,
      alvo_grupos: null, alvo_contas: [K1], pasta: null, provedor: null, produto: null,
      acoes: [{ tipo: "abrir" as const, conteudo: {}, atraso_min: 0 }],
    };
    const r = await salvarAutomacao(null, entrada, false);
    expect(r.erro).toBeUndefined();
  });

  it("tag da Tag Condicional que não existe é recusada (salvar)", async () => {
    hoisted.dbAtual = banco({ campanhas: { [CAMP]: { arquivada: false } }, tagsExistentes: [TAG1] }).db;
    const entrada = {
      nome: "x", campanha_id: CAMP, gatilho: "checkout", quando: null, alvo_grupos: null, pasta: null,
      provedor: null, produto: "Curso X",
      acoes: [
        { tipo: "tag_condicional" as const, conteudo: { tag_id: TAG_INEXISTENTE, tem: true }, atraso_min: 0 },
        { tipo: "remover_participante" as const, conteudo: {}, atraso_min: 0 },
      ],
    };
    expect(await salvarAutomacao(null, entrada, false)).toEqual({ erro: "Tag escolhida não existe." });
  });

  it("tag existente é aceita (salvar)", async () => {
    hoisted.dbAtual = banco({ campanhas: { [CAMP]: { arquivada: false } }, tagsExistentes: [TAG1] }).db;
    const entrada = {
      nome: "x", campanha_id: CAMP, gatilho: "checkout", quando: null, alvo_grupos: null, pasta: null,
      provedor: null, produto: "Curso X",
      acoes: [
        { tipo: "tag_condicional" as const, conteudo: { tag_id: TAG1, tem: true }, atraso_min: 0 },
        { tipo: "remover_participante" as const, conteudo: {}, atraso_min: 0 },
      ],
    };
    const r = await salvarAutomacao(null, entrada, false);
    expect(r.erro).toBeUndefined();
  });

  it("campanha de destino de 'mover grupos' inexistente ou arquivada é recusada (salvar)", async () => {
    hoisted.dbAtual = banco({ campanhas: { [CAMP]: { arquivada: false }, [DESTINO_ARQUIVADA]: { arquivada: true } } }).db;
    const entradaInexistente = {
      nome: "x", campanha_id: CAMP, gatilho: "cronograma", quando: "2099-01-01T10:00:00Z", alvo_grupos: null, pasta: null,
      provedor: null, produto: null,
      acoes: [{ tipo: "mover_grupos" as const, conteudo: { campanha_destino: DESTINO }, atraso_min: 0 }],
    };
    expect(await salvarAutomacao(null, entradaInexistente, false)).toEqual({ erro: "Campanha de destino não encontrada." });

    const entradaArquivada = { ...entradaInexistente, acoes: [{ tipo: "mover_grupos" as const, conteudo: { campanha_destino: DESTINO_ARQUIVADA }, atraso_min: 0 }] };
    expect(await salvarAutomacao(null, entradaArquivada, false)).toEqual({ erro: "Campanha de destino está arquivada." });
  });

  it("importarAutomacaoJson confere a mesma tag inexistente", async () => {
    hoisted.dbAtual = banco({ campanhas: { [CAMP]: { arquivada: false } }, tagsExistentes: [TAG1] }).db;
    const bruto = JSON.stringify({
      versao: 1, nome: "x", gatilho: "checkout", produto: "P",
      acoes: [
        { tipo: "tag_condicional", conteudo: { tag_id: TAG_INEXISTENTE, tem: true }, ordem: 0 },
        { tipo: "remover_participante", conteudo: {}, ordem: 1 },
      ],
    });
    const r = await importarAutomacaoJson(CAMP, bruto);
    expect(r.erro).toBe("Tag escolhida não existe.");
  });

  it("importarAutomacaoJson confere a mesma campanha de destino inexistente", async () => {
    hoisted.dbAtual = banco({ campanhas: { [CAMP]: { arquivada: false } } }).db;
    const bruto = JSON.stringify({
      versao: 1, nome: "x", gatilho: "cronograma", quando: "2099-01-01T10:00:00Z",
      acoes: [{ tipo: "mover_grupos", conteudo: { campanha_destino: DESTINO }, ordem: 0 }],
    });
    const r = await importarAutomacaoJson(CAMP, bruto);
    expect(r.erro).toBe("Campanha de destino não encontrada.");
  });

  // Ruling da revisão final: reativar pela lista (`alternarAutomacoes`) confere as mesmas referências — a conta,
  // o grupo, a tag ou o destino do "mover grupos" podem ter mudado desde que a automação foi salva.
  it("alternarAutomacoes recusa ativar quando a conexão salva não é mais da campanha", async () => {
    hoisted.dbAtual = banco({
      campanhas: { [CAMP]: { arquivada: false } },
      associadas: { [CAMP]: [K1] },
      automacaoRow: {
        nome: "Fala com quem comprou", campanha_id: CAMP, gatilho: "grupo_cheio", quando: null,
        alvo_grupos: null, alvo_contas: [K_OUTRO], pasta: null, provedor: null, produto: null,
        automacao_acoes: [{ ordem: 0, tipo: "abrir", conteudo: {}, atraso_min: 0 }],
      },
    }).db;
    const r = await alternarAutomacoes(["a1"], true);
    expect(r.feitas).toBe(0);
    expect(r.erros[0]).toMatch(/Conexão escolhida não é desta campanha\. Edite antes de ativar\./);
  });

  it("alternarAutomacoes recusa ativar quando a tag salva não existe mais", async () => {
    hoisted.dbAtual = banco({
      campanhas: { [CAMP]: { arquivada: false } },
      tagsExistentes: [TAG1],
      automacaoRow: {
        nome: "Tag condicional", campanha_id: CAMP, gatilho: "checkout", quando: null,
        alvo_grupos: null, alvo_contas: null, pasta: null, provedor: null, produto: "Curso X",
        automacao_acoes: [
          { ordem: 0, tipo: "tag_condicional", conteudo: { tag_id: TAG_INEXISTENTE, tem: true }, atraso_min: 0 },
          { ordem: 1, tipo: "remover_participante", conteudo: {}, atraso_min: 0 },
        ],
      },
    }).db;
    const r = await alternarAutomacoes(["a1"], true);
    expect(r.feitas).toBe(0);
    expect(r.erros[0]).toMatch(/Tag escolhida não existe\. Edite antes de ativar\./);
  });

  it("alternarAutomacoes ativa quando as referências ainda são válidas", async () => {
    hoisted.dbAtual = banco({
      campanhas: { [CAMP]: { arquivada: false } },
      associadas: { [CAMP]: [K1] },
      automacaoRow: {
        nome: "Fala com quem comprou", campanha_id: CAMP, gatilho: "grupo_cheio", quando: null,
        alvo_grupos: null, alvo_contas: [K1], pasta: null, provedor: null, produto: null,
        automacao_acoes: [{ ordem: 0, tipo: "abrir", conteudo: {}, atraso_min: 0 }],
      },
    }).db;
    const r = await alternarAutomacoes(["a1"], true);
    expect(r.erros).toEqual([]);
    expect(r.feitas).toBe(1);
  });
});

// Etapa 3J (revisão final): ação de blacklist (adicionar/remover) exige "Anti-spam: editar" além de
// "Automações: editar" — ela muda a blacklist por fora da tela de Anti-spam. Vale pro salvar e pro importar JSON.
describe("salvarAutomacao / importarAutomacaoJson: ações de blacklist exigem Anti-spam: editar", () => {
  const CAMP = "11111111-1111-1111-1111-111111111111";
  const LISTA = "44444444-4444-4444-4444-444444444444";
  const entradaComBlacklist = {
    nome: "Bloqueia golpista",
    campanha_id: CAMP,
    gatilho: "entrou" as const,
    quando: null,
    alvo_grupos: null,
    pasta: null,
    provedor: null,
    produto: null,
    acoes: [{ tipo: "adicionar_blacklist" as const, conteudo: { blacklist_id: LISTA }, atraso_min: 0 }],
  };

  function bancoComBlacklist() {
    return dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "campanhas" && c.op === "select") return { data: { arquivada: false } };
      if (c.tabela === "blacklists" && c.op === "select") return { data: [{ id: LISTA }] };
      if (c.tabela === "automacoes" && c.op === "insert") return { data: { id: "a1" } };
      if (c.tabela === "automacao_acoes" && c.op === "insert") return { data: [{ id: "x1" }] };
      return {};
    });
  }

  it("salvar: automações editar sem antispam editar é recusado antes de gravar", async () => {
    usarMembro({ papel: "membro", permissoes: { automacoes: "editar", antispam: "ver" } });
    const { db, chamadas } = bancoComBlacklist();
    hoisted.dbAtual = db;
    const r = await salvarAutomacao(null, entradaComBlacklist, false);
    expect(r.erro).toBe(SEM_PERMISSAO);
    expect(chamadas.some((c) => c.op === "insert")).toBe(false);
  });

  it("salvar: com as duas permissões, grava normalmente", async () => {
    usarMembro({ papel: "membro", permissoes: { automacoes: "editar", antispam: "editar" } });
    const { db, chamadas } = bancoComBlacklist();
    hoisted.dbAtual = db;
    const r = await salvarAutomacao(null, entradaComBlacklist, false);
    expect(r.erro).toBeUndefined();
    expect(chamadas.some((c) => c.tabela === "automacoes" && c.op === "insert")).toBe(true);
  });

  it("salvar: sem ação de blacklist, antispam não é exigido", async () => {
    usarMembro({ papel: "membro", permissoes: { automacoes: "editar", antispam: "nenhum" } });
    const { db } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "campanhas" && c.op === "select") return { data: { arquivada: false } };
      if (c.tabela === "automacoes" && c.op === "insert") return { data: { id: "a1" } };
      if (c.tabela === "automacao_acoes" && c.op === "insert") return { data: [{ id: "x1" }] };
      return {};
    });
    hoisted.dbAtual = db;
    const r = await salvarAutomacao(null, { ...entradaComBlacklist, acoes: [{ tipo: "remover_participante" as const, conteudo: {}, atraso_min: 0 }] }, false);
    expect(r.erro).toBeUndefined();
  });

  it("importar JSON: sem antispam editar é recusado", async () => {
    usarMembro({ papel: "membro", permissoes: { automacoes: "editar", antispam: "ver" } });
    const { db, chamadas } = bancoComBlacklist();
    hoisted.dbAtual = db;
    const bruto = JSON.stringify({ versao: 1, nome: "x", gatilho: "entrou", acoes: [{ tipo: "adicionar_blacklist", conteudo: { blacklist_id: LISTA }, ordem: 0 }] });
    const r = await importarAutomacaoJson(CAMP, bruto);
    expect(r.erro).toBe(SEM_PERMISSAO);
    expect(chamadas.some((c) => c.op === "insert")).toBe(false);
  });

  it("importar JSON: com antispam editar, importa normalmente", async () => {
    usarMembro({ papel: "membro", permissoes: { automacoes: "editar", antispam: "editar" } });
    const { db, chamadas } = bancoComBlacklist();
    hoisted.dbAtual = db;
    const bruto = JSON.stringify({ versao: 1, nome: "x", gatilho: "entrou", acoes: [{ tipo: "remover_blacklist", conteudo: { blacklist_id: LISTA }, ordem: 0 }] });
    const r = await importarAutomacaoJson(CAMP, bruto);
    expect(r.erro).toBeUndefined();
    expect(chamadas.some((c) => c.tabela === "automacoes" && c.op === "insert")).toBe(true);
  });
});
