import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, filtro, type Chamada, type Resposta } from "./apoio/db-falso";

const hoisted = vi.hoisted(() => ({
  dbAtual: undefined as unknown,
  exigirUsuarioMock: vi.fn(async () => ({ id: "u1" })),
  revalidar: vi.fn(),
  historicoMock: vi.fn(),
}));

vi.mock("@/src/lib/permissoes", async () => (await import("./apoio/permissoes")).permissoesFalsas());
vi.mock("@/src/lib/supabase/usuario", () => ({ exigirUsuario: hoisted.exigirUsuarioMock, dbUsuario: async () => hoisted.dbAtual }));
vi.mock("next/cache", () => ({ revalidatePath: hoisted.revalidar }));
vi.mock("@/src/lib/historico", () => ({ registrarHistorico: hoisted.historicoMock }));

import { aplicarPadraoEmCampanhas, copiarPadraoDeCampanha, lerPadraoCampanhaAtual, salvarPadraoCampanha } from "@/app/(painel)/campanhas/actions";
import { negarTudo, liberarTudo } from "./apoio/permissoes";
import type { PadraoCampanhaEntrada } from "@/src/lib/regras/padrao-campanha";

const CAMP1 = "aaaaaaaa-1111-4111-8111-111111111111";
const CAMP2 = "bbbbbbbb-2222-4222-8222-222222222222";
const C1 = "c1c1c1c1-1111-4111-8111-111111111111";
const C2 = "c2c2c2c2-2222-4222-8222-222222222222";
const CRIADORA = "dddddddd-4444-4444-8444-444444444444";

const padraoBase: PadraoCampanhaEntrada = {
  ativo: true, fechado: true, limite_por_grupo: 500, folga: 2, padrao_nome: "TURMA #{n}", usar_comunidade: false, admins: [C1],
};

function usar(responder: (c: Chamada) => Resposta) {
  const f = dbFalso(responder);
  hoisted.dbAtual = f.db;
  return { chamadas: f.chamadas };
}

beforeEach(() => {
  vi.clearAllMocks();
  liberarTudo();
});

describe("salvarPadraoCampanha", () => {
  it("sem permissão: recusa", async () => {
    negarTudo();
    const r = await salvarPadraoCampanha(padraoBase);
    expect(r.erro).toBeTruthy();
  });

  it("entrada inválida: recusa antes de tocar no banco", async () => {
    const { chamadas } = usar(() => ({}));
    const r = await salvarPadraoCampanha({ ...padraoBase, folga: 0 });
    expect(r).toEqual({ erro: "A folga vai de 1 a 10 grupos." });
    expect(chamadas).toEqual([]);
  });

  it("grava em configuracoes (upsert), revalida e registra no histórico", async () => {
    const { chamadas } = usar(() => ({}));
    const r = await salvarPadraoCampanha(padraoBase);
    expect(r).toEqual({});
    const up = chamadas.find((c) => c.tabela === "configuracoes" && c.op === "upsert")!;
    expect(up.dados).toEqual({ chave: "padrao_campanha", valor: { ...padraoBase } });
    expect(hoisted.revalidar).toHaveBeenCalledWith("/campanhas");
    expect(hoisted.historicoMock).toHaveBeenCalled();
  });
});

describe("copiarPadraoDeCampanha", () => {
  it("campanha não encontrada: erro", async () => {
    usar((c) => (c.tabela === "campanhas" ? { data: null } : {}));
    const r = await copiarPadraoDeCampanha(CAMP1);
    expect(r).toEqual({ erro: "Campanha não encontrada." });
  });

  it("devolve os campos de criação de grupos + admins, sem 'ativo'", async () => {
    usar((c) => {
      if (c.tabela === "campanhas") return { data: { fechado: false, limite_por_grupo: 800, folga: 3, padrao_nome: "AULA #{n}", usar_comunidade: true } };
      if (c.tabela === "campanha_conexoes") return { data: [{ conexao_id: C1 }, { conexao_id: C2 }] };
      if (c.tabela === "campanha_admins_numeros") return { data: [] };
      return {};
    });
    const r = await copiarPadraoDeCampanha(CAMP1);
    expect(r).toEqual({ valor: { fechado: false, limite_por_grupo: 800, folga: 3, padrao_nome: "AULA #{n}", usar_comunidade: true, admins: [C1, C2], admins_numeros: [] } });
    expect((r.valor as Record<string, unknown>).ativo).toBeUndefined();
  });

  it("Etapa 3K: também lê as colunas novas e os administradores por número", async () => {
    usar((c) => {
      if (c.tabela === "campanhas") {
        return { data: { fechado: false, limite_por_grupo: 800, folga: 3, padrao_nome: "AULA #{n}", usar_comunidade: true, cookie_redirecionamento: false, modo_criacao: "seguro" } };
      }
      if (c.tabela === "campanha_conexoes") return { data: [] };
      if (c.tabela === "campanha_admins_numeros") return { data: [{ telefone: "5511" + "999990001" }] };
      return {};
    });
    const r = await copiarPadraoDeCampanha(CAMP1);
    expect(r.valor).toMatchObject({ cookie_redirecionamento: false, modo_criacao: "seguro", admins_numeros: ["5511" + "999990001"] });
  });
});

describe("aplicarPadraoEmCampanhas", () => {
  const campos = { fechado: true, limite_por_grupo: 500, folga: 2, padrao_nome: "TURMA #{n}", usar_comunidade: false, admins: [C1, C2] };
  const camps = [
    { id: CAMP1, nome: "Aulão", conexao_criadora_id: C1 },
    { id: CAMP2, nome: "Live", conexao_criadora_id: CRIADORA },
  ];
  function responder(extra: (c: Chamada) => Resposta | undefined = () => undefined) {
    return (c: Chamada): Resposta => {
      const r = extra(c);
      if (r) return r;
      if (c.tabela === "conexoes") return { data: [{ id: C1 }, { id: C2 }] };
      if (c.tabela === "campanhas" && c.op === "update") return { data: camps };
      if (c.tabela === "rpc:aplicar_contas_campanha") return { data: [{ adicionadas: 1, removidas: 1, reassociadas: 2, canceladas: 1, mantidas: 0 }] };
      return {};
    };
  }

  it("sem ids: erro, não toca no banco", async () => {
    const { chamadas } = usar(() => ({}));
    const r = await aplicarPadraoEmCampanhas(campos, []);
    expect(r).toEqual({ erro: "Escolha ao menos uma campanha." });
    expect(chamadas).toEqual([]);
  });

  it("mais de 200 campanhas: recusa", async () => {
    const ids = Array.from({ length: 201 }, (_, i) => `c${i}`);
    const r = await aplicarPadraoEmCampanhas(campos, ids);
    expect(r).toEqual({ erro: "No máximo 200 campanhas por vez." });
  });

  it("id de campanha que não é uuid: recusa sem tocar no banco", async () => {
    const { chamadas } = usar(() => ({}));
    expect((await aplicarPadraoEmCampanhas(campos, [CAMP1, "x"])).erro).toBeTruthy();
    expect(chamadas).toEqual([]);
  });

  it("admin que não é uuid: recusa sem tocar no banco", async () => {
    const { chamadas } = usar(() => ({}));
    expect(await aplicarPadraoEmCampanhas({ ...campos, admins: ["c1"] }, [CAMP1])).toEqual({ erro: "Conexão de administrador inválida." });
    expect(chamadas).toEqual([]);
  });

  it("nunca grava nome nem descricao — só os campos de criação de grupos", async () => {
    const { chamadas } = usar(responder());
    const r = await aplicarPadraoEmCampanhas(campos, [CAMP1, CAMP2]);
    expect(r.aplicadas).toBe(2);
    const upd = chamadas.find((c) => c.tabela === "campanhas" && c.op === "update")!;
    expect(upd.dados).toEqual({ fechado: true, limite_por_grupo: 500, folga: 2, padrao_nome: "TURMA #{n}", usar_comunidade: false });
    expect(filtro(upd, "in", "id")).toEqual([CAMP1, CAMP2]);
  });

  it("troca as conexões pela RPC atômica, por campanha, sem a criadora; nunca delete/insert direto", async () => {
    const { chamadas } = usar(responder());
    const r = await aplicarPadraoEmCampanhas(campos, [CAMP1, CAMP2]);
    const rpcs = chamadas.filter((c) => c.tabela === "rpc:aplicar_contas_campanha");
    expect(rpcs.map((c) => c.dados)).toEqual([
      { p_campanha: CAMP1, p_contas: [C2] }, // C1 é a criadora da CAMP1
      { p_campanha: CAMP2, p_contas: [C1, C2] },
    ]);
    expect(chamadas.some((c) => c.tabela === "campanha_conexoes")).toBe(false);
    expect(r.aviso).toContain("4 ação(ões)");
    expect(r.aviso).toContain("2 ação(ões) agendada(s) foram canceladas");
  });

  it("filtra as conexões do padrão pelas que existem em conexoes", async () => {
    const { chamadas } = usar(
      responder((c) => {
        if (c.tabela === "conexoes") return { data: [{ id: C2 }] };
        if (c.tabela === "campanhas" && c.op === "update") return { data: [camps[1]] };
        return undefined;
      }),
    );
    await aplicarPadraoEmCampanhas(campos, [CAMP2]);
    const rpc = chamadas.find((c) => c.tabela === "rpc:aplicar_contas_campanha")!;
    expect(rpc.dados).toEqual({ p_campanha: CAMP2, p_contas: [C2] });
  });

  it("nenhuma conexão do padrão existe mais: recusa antes de mexer nas campanhas", async () => {
    const { chamadas } = usar(responder((c) => (c.tabela === "conexoes" ? { data: [] } : undefined)));
    const r = await aplicarPadraoEmCampanhas(campos, [CAMP1]);
    expect(r.erro).toMatch(/Nenhuma das conexões/);
    expect(chamadas.some((c) => c.tabela === "campanhas")).toBe(false);
  });

  it("padrão sem admins: não mexe nas conexões associadas (nem RPC, nem campanha_conexoes)", async () => {
    const { chamadas } = usar(responder());
    const r = await aplicarPadraoEmCampanhas({ ...campos, admins: [] }, [CAMP1, CAMP2]);
    expect(r).toEqual({ aplicadas: 2 });
    expect(chamadas.some((c) => c.tabela.startsWith("rpc:") || c.tabela === "campanha_conexoes" || c.tabela === "conexoes")).toBe(false);
  });

  it("um registro no histórico por campanha, com refId", async () => {
    usar(responder());
    await aplicarPadraoEmCampanhas(campos, [CAMP1, CAMP2]);
    expect(hoisted.historicoMock).toHaveBeenCalledTimes(2);
    expect(hoisted.historicoMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ refId: CAMP1, resumo: expect.stringContaining('"Aulão"') }));
    expect(hoisted.historicoMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ refId: CAMP2, resumo: expect.stringContaining('"Live"') }));
  });

  it("RPC falha numa campanha: segue nas outras e avisa qual falhou", async () => {
    usar(responder((c) => (c.tabela === "rpc:aplicar_contas_campanha" && (c.dados as { p_campanha: string }).p_campanha === CAMP1 ? { error: { message: "x" } } : undefined)));
    const r = await aplicarPadraoEmCampanhas(campos, [CAMP1, CAMP2]);
    expect(r.aplicadas).toBe(2);
    expect(r.aviso).toContain("Não foi possível trocar as conexões associadas de: Aulão.");
    expect(hoisted.historicoMock).toHaveBeenCalledTimes(2);
  });

  it("campanha que não existe: avisa quantas não foram encontradas", async () => {
    usar(responder((c) => (c.tabela === "campanhas" && c.op === "update" ? { data: [camps[1]] } : undefined)));
    const r = await aplicarPadraoEmCampanhas(campos, [CAMP1, CAMP2]);
    expect(r.aplicadas).toBe(1);
    expect(r.aviso).toContain("1 campanha(s) não foram encontradas.");
  });

  describe("Etapa 3K: administradores por número — acrescenta sem apagar", () => {
    const comNumeros = { ...campos, admins: [], admins_numeros: ["5511" + "999990003"] };

    it("upsert pros números do padrão, sem apagar os que a campanha já tem (não chama delete)", async () => {
      const { chamadas } = usar(
        responder((c) => {
          if (c.tabela === "campanha_conexoes") return { data: [] };
          if (c.tabela === "conexoes") return { data: [] };
          return undefined;
        }),
      );
      const r = await aplicarPadraoEmCampanhas(comNumeros, [CAMP1, CAMP2]);
      expect(r.aplicadas).toBe(2);
      expect(chamadas.some((c) => c.tabela === "campanha_admins_numeros" && c.op === "delete")).toBe(false);
      const ups = chamadas.filter((c) => c.tabela === "campanha_admins_numeros" && c.op === "upsert");
      expect(ups).toHaveLength(2);
      expect(ups[0].dados).toEqual([{ campanha_id: CAMP1, telefone: "5511" + "999990003", criado_por: "u1" }]);
      expect(ups[1].dados).toEqual([{ campanha_id: CAMP2, telefone: "5511" + "999990003", criado_por: "u1" }]);
    });

    it("número do padrão que é a conexão criadora da campanha: não grava pra essa campanha (sem erro)", async () => {
      const { chamadas } = usar(
        responder((c) => {
          if (c.tabela === "campanha_conexoes") return { data: [] };
          // Mesma resposta pra qualquer consulta em `conexoes` nesse cenário (o padrão não tem admins de conta,
          // então a única consulta que resta é a de telefones pra conferir o conflito dos números).
          if (c.tabela === "conexoes") return { data: [{ id: C1, telefone: "5511" + "999990003" }] };
          return undefined;
        }),
      );
      const r = await aplicarPadraoEmCampanhas(comNumeros, [CAMP1, CAMP2]);
      expect(r.aplicadas).toBe(2);
      expect(chamadas.some((c) => c.tabela === "campanha_admins_numeros" && c.op !== "select")).toBe(false);
    });

    it("erro ao ler as conexões de uma campanha: pula só ela e avisa (sem gravar número que pode colidir)", async () => {
      const { chamadas } = usar(
        responder((c) => {
          if (c.tabela === "campanha_conexoes" && filtro(c, "eq", "campanha_id") === CAMP1) return { error: { message: "caiu" } };
          if (c.tabela === "campanha_conexoes") return { data: [] };
          if (c.tabela === "conexoes" && filtro(c, "in", "id") && (filtro(c, "in", "id") as string[]).includes(CRIADORA)) return { error: { message: "caiu" } };
          if (c.tabela === "conexoes") return { data: [] };
          return undefined;
        }),
      );
      const r = await aplicarPadraoEmCampanhas(comNumeros, [CAMP1, CAMP2]);
      expect(r.aplicadas).toBe(2);
      // CAMP1 (erro em campanha_conexoes) e CAMP2 (erro em conexoes): nenhuma grava.
      expect(chamadas.some((c) => c.tabela === "campanha_admins_numeros" && c.op === "upsert")).toBe(false);
      expect(r.aviso).toContain("Não foi possível salvar os administradores por número de: Aulão, Live.");
    });

    it("sem admins_numeros no padrão: não toca em campanha_admins_numeros", async () => {
      const { chamadas } = usar(responder());
      await aplicarPadraoEmCampanhas(campos, [CAMP1, CAMP2]);
      expect(chamadas.some((c) => c.tabela === "campanha_admins_numeros")).toBe(false);
    });
  });
});

describe("lerPadraoCampanhaAtual", () => {
  it("sem permissão: null, sem consultar o banco", async () => {
    negarTudo();
    const { chamadas } = usar(() => ({}));
    expect(await lerPadraoCampanhaAtual()).toBeNull();
    expect(chamadas).toEqual([]);
  });

  it("sem linha salva: null", async () => {
    usar(() => ({ data: null }));
    expect(await lerPadraoCampanhaAtual()).toBeNull();
  });

  it("linha salva válida: devolve o padrão", async () => {
    usar(() => ({ data: { valor: padraoBase } }));
    expect(await lerPadraoCampanhaAtual()).toEqual(padraoBase);
  });
});

describe("texto de confirmação do Aplicar padrão", () => {
  it("diz que todas as opções sobrescrevem as das campanhas, inclusive Não criar grupos e Atualização periódica", async () => {
    const { textoConfirmacaoAplicar } = await import("@/app/(painel)/campanhas/padrao-criacao");
    const t = textoConfirmacaoAplicar(3, true);
    expect(t).toContain("Aplicar este padrão em 3 campanha(s)?");
    expect(t).toContain("Todas as opções do padrão substituem as das campanhas");
    expect(t).toContain("Não criar grupos ou comunidades");
    expect(t).toContain("Atualização periódica de links");
    expect(t).toContain("será desligado nas campanhas");
  });
});

/** Etapa 3M, Tarefa 2: "Imagem do grupo" no padrão. */
describe("Padrão de criação: imagem do grupo", () => {
  const IMAGEM = "https://exemplo.supabase.co/storage/v1/object/public/midias/padrao-campanha/1760000000000-capa.png";

  it("salvar: grava a imagem (vazio = null) e recusa http sem tocar no banco", async () => {
    let { chamadas } = usar(() => ({}));
    expect(await salvarPadraoCampanha({ ...padraoBase, imagem_grupo_url: IMAGEM })).toEqual({});
    expect((chamadas.find((c) => c.tabela === "configuracoes")!.dados as { valor: { imagem_grupo_url: unknown } }).valor.imagem_grupo_url).toBe(IMAGEM);

    ({ chamadas } = usar(() => ({})));
    await salvarPadraoCampanha({ ...padraoBase, imagem_grupo_url: "" });
    expect((chamadas.find((c) => c.tabela === "configuracoes")!.dados as { valor: { imagem_grupo_url: unknown } }).valor.imagem_grupo_url).toBeNull();

    ({ chamadas } = usar(() => ({})));
    expect(await salvarPadraoCampanha({ ...padraoBase, imagem_grupo_url: "http://x/a.png" })).toEqual({ erro: "Imagem do grupo inválida: envie a imagem pelo Vórtex Grupo." });
    expect(chamadas).toEqual([]);
  });

  it("copiar de campanha existente: traz a imagem da campanha", async () => {
    usar((c) => {
      if (c.tabela === "campanhas") return { data: { fechado: true, limite_por_grupo: 800, folga: 3, padrao_nome: "AULA #{n}", usar_comunidade: false, imagem_grupo_url: IMAGEM } };
      if (c.tabela === "campanha_conexoes" || c.tabela === "campanha_admins_numeros") return { data: [] };
      return {};
    });
    const r = await copiarPadraoDeCampanha(CAMP1);
    expect(r.valor).toMatchObject({ imagem_grupo_url: IMAGEM });
  });

  it("aplicar em campanhas existentes: ignora a imagem (nunca grava imagem_grupo_url)", async () => {
    const { chamadas } = usar((c) => (c.tabela === "campanhas" && c.op === "update" ? { data: [{ id: CAMP1, nome: "Aulão", conexao_criadora_id: CRIADORA }] } : {}));
    const r = await aplicarPadraoEmCampanhas({ fechado: true, limite_por_grupo: 500, folga: 2, padrao_nome: "TURMA #{n}", usar_comunidade: false, admins: [], imagem_grupo_url: IMAGEM }, [CAMP1]);
    expect(r.aplicadas).toBe(1);
    const upd = chamadas.find((c) => c.tabela === "campanhas" && c.op === "update")!;
    expect(upd.dados).not.toHaveProperty("imagem_grupo_url");
    expect(upd.dados).toEqual({ fechado: true, limite_por_grupo: 500, folga: 2, padrao_nome: "TURMA #{n}", usar_comunidade: false });
  });
});
