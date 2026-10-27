import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, filtro, type Chamada, type Resposta } from "./apoio/db-falso";
import { liberarTudo, usarMembro } from "./apoio/permissoes";
import { PADRAO_CRIACAO } from "@/src/lib/regras/criacao-grupos";

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
  listarGruposAtivosDaCampanha,
  moverGrupos,
  salvarAdministradores,
  salvarAlterarEmLote,
  salvarAlterarGruposEmLote,
  salvarCriacaoDeGrupos,
  salvarInformacoesCriacao,
  type AlterarEmLoteEntrada,
  type InformacoesCriacaoEntrada,
} from "@/app/(painel)/campanhas/[id]/grupos/actions";

const CAMP = "999" + "99999-2222-3333-4444-555555555555";
const DESTINO = "88888888-2222-3333-4444-555555555555";
const CRIADORA = "11111111-1111-1111-1111-111111111111";
const ADMIN1 = "22222222-2222-2222-2222-222222222222";
const ADMIN2 = "33333333-3333-3333-3333-333333333333";
const G1 = "44444444-4444-4444-4444-444444444444";
const G2 = "55555555-5555-5555-5555-555555555555";

function usar(responder?: (c: Chamada) => Resposta) {
  const f = dbFalso(responder);
  hoisted.adminAtual = f.db;
  return f.chamadas;
}

beforeEach(() => {
  vi.clearAllMocks();
  liberarTudo();
});

const INFORMACOES_VALIDAS: InformacoesCriacaoEntrada = {
  ...PADRAO_CRIACAO,
  padrao_nome: "AULÃO #{n}",
  descricao: "desc",
  fechado: true,
  limite_por_grupo: 1000,
  folga: 1,
  usar_comunidade: false,
};

describe("salvarInformacoesCriacao (diálogo 'Criação de grupos')", () => {
  it("salva todos os campos da campanha, sem criar execução nenhuma", async () => {
    const chamadas = usar(() => ({}));
    const r = await salvarInformacoesCriacao(CAMP, INFORMACOES_VALIDAS);
    expect(r).toEqual({});
    expect(chamadas).toHaveLength(1);
    const up = chamadas[0];
    expect(up.tabela).toBe("campanhas");
    expect(up.op).toBe("update");
    expect(filtro(up, "eq", "id")).toBe(CAMP);
    expect(up.dados).toMatchObject({ padrao_nome: "AULÃO #{n}", descricao: "desc", fechado: true, caractere_numeracao: "", modo_criacao: "normal" });
    expect(hoisted.registrarHistoricoMock).toHaveBeenCalledTimes(1);
  });

  it("padrão de nome vazio: recusa sem tocar no banco", async () => {
    const chamadas = usar();
    const r = await salvarInformacoesCriacao(CAMP, { ...INFORMACOES_VALIDAS, padrao_nome: "   " });
    expect(r.erro).toBeTruthy();
    expect(chamadas).toHaveLength(0);
  });

  it("'Recusar automaticamente números bloqueados' (Etapa 3M): grava recusar_bloqueados; ausente na entrada não mexe; não booleano recusa", async () => {
    let chamadas = usar(() => ({}));
    expect(await salvarInformacoesCriacao(CAMP, { ...INFORMACOES_VALIDAS, recusar_bloqueados: true })).toEqual({});
    expect(chamadas[0].dados).toMatchObject({ recusar_bloqueados: true });
    chamadas = usar(() => ({}));
    const { recusar_bloqueados: _r, ...semCampo } = INFORMACOES_VALIDAS;
    expect(await salvarInformacoesCriacao(CAMP, semCampo as InformacoesCriacaoEntrada)).toEqual({});
    expect("recusar_bloqueados" in (chamadas[0].dados as object)).toBe(false);
    chamadas = usar();
    expect((await salvarInformacoesCriacao(CAMP, { ...INFORMACOES_VALIDAS, recusar_bloqueados: "sim" as never })).erro).toBeTruthy();
    expect(chamadas).toHaveLength(0);
  });

  it("opção de criação inválida (caractere com mais de 3 caracteres): recusa sem tocar no banco", async () => {
    const chamadas = usar();
    const r = await salvarInformacoesCriacao(CAMP, { ...INFORMACOES_VALIDAS, caractere_numeracao: "####" });
    expect(r.erro).toBe("O caractere da numeração vai até 3 caracteres.");
    expect(chamadas).toHaveLength(0);
  });

  it("campanha inválida (não uuid): recusa sem tocar no banco", async () => {
    const chamadas = usar();
    const r = await salvarInformacoesCriacao("não-é-uuid", INFORMACOES_VALIDAS);
    expect(r.erro).toBeTruthy();
    expect(chamadas).toHaveLength(0);
  });

  it("descrição com mais de 2048 caracteres: recusa sem tocar no banco", async () => {
    const chamadas = usar();
    const r = await salvarInformacoesCriacao(CAMP, { ...INFORMACOES_VALIDAS, descricao: "a".repeat(2049) });
    expect(r.erro).toBe("A descrição vai até 2048 caracteres.");
    expect(chamadas).toHaveLength(0);
  });

  it("fechado não é booleano de verdade: recusa sem tocar no banco", async () => {
    const chamadas = usar();
    const r = await salvarInformacoesCriacao(CAMP, { ...INFORMACOES_VALIDAS, fechado: "sim" as never });
    expect(r.erro).toBeTruthy();
    expect(chamadas).toHaveLength(0);
  });

  it("opção de criação com booleano errado (nao_criar_grupos): recusa sem tocar no banco", async () => {
    const chamadas = usar();
    const r = await salvarInformacoesCriacao(CAMP, { ...INFORMACOES_VALIDAS, nao_criar_grupos: "sim" as never });
    expect(r.erro).toBeTruthy();
    expect(chamadas).toHaveLength(0);
  });

  it("sem permissão de editar: recusa sem tocar no banco", async () => {
    usarMembro({ papel: "membro", permissoes: { campanhas: "ver" } });
    const chamadas = usar();
    const r = await salvarInformacoesCriacao(CAMP, INFORMACOES_VALIDAS);
    expect(r.erro).toBeTruthy();
    expect(chamadas).toHaveLength(0);
  });
});

describe("salvarAdministradores (aba Administradores dos dois diálogos, via RPC aplicar_contas_campanha)", () => {
  it("filtra conexões inexistentes e a criadora, e chama a RPC só com o que sobrou", async () => {
    const chamadas = usar((c) => {
      if (c.tabela === "campanhas" && c.op === "select") return { data: { conexao_criadora_id: CRIADORA } };
      if (c.tabela === "conexoes" && c.op === "select") return { data: [{ id: ADMIN1 }] }; // ADMIN2 não existe mais
      if (c.tabela === "campanha_conexoes" && c.op === "select") return { data: [] };
      if (c.tabela === "rpc:aplicar_contas_campanha") return { data: [{ adicionadas: 1, removidas: 0, reassociadas: 0, canceladas: 0, mantidas: 0 }] };
      return {};
    });
    const r = await salvarAdministradores(CAMP, [ADMIN1, ADMIN2, ADMIN1, CRIADORA]);
    expect(r.erro).toBeUndefined();
    const rpc = chamadas.find((c) => c.tabela === "rpc:aplicar_contas_campanha")!;
    expect(rpc.dados).toEqual({ p_campanha: CAMP, p_contas: [ADMIN1] });
    expect(hoisted.registrarHistoricoMock).toHaveBeenCalledTimes(1);
  });

  it("conjunto de admins idêntico ao de hoje: não chama a RPC nem grava histórico", async () => {
    const chamadas = usar((c) => {
      if (c.tabela === "campanhas" && c.op === "select") return { data: { conexao_criadora_id: CRIADORA } };
      if (c.tabela === "conexoes" && c.op === "select") return { data: [{ id: ADMIN1 }, { id: ADMIN2 }] };
      if (c.tabela === "campanha_conexoes" && c.op === "select") return { data: [{ conexao_id: ADMIN1 }, { conexao_id: ADMIN2 }] };
      return {};
    });
    const r = await salvarAdministradores(CAMP, [ADMIN1, ADMIN2]);
    expect(r).toEqual({});
    expect(chamadas.find((c) => c.tabela === "rpc:aplicar_contas_campanha")).toBeUndefined();
    expect(hoisted.registrarHistoricoMock).not.toHaveBeenCalled();
  });

  it("conexão inválida (não uuid): recusa sem tocar no banco", async () => {
    const chamadas = usar();
    const r = await salvarAdministradores(CAMP, ["não-é-uuid"]);
    expect(r.erro).toBeTruthy();
    expect(chamadas).toHaveLength(0);
  });

  it("campanha inválida (não uuid): recusa sem tocar no banco", async () => {
    const chamadas = usar();
    const r = await salvarAdministradores("não-é-uuid", [ADMIN1]);
    expect(r.erro).toBeTruthy();
    expect(chamadas).toHaveLength(0);
  });

  it("campanha não encontrada: erro", async () => {
    usar((c) => (c.tabela === "campanhas" ? { data: null } : {}));
    const r = await salvarAdministradores(CAMP, [ADMIN1]);
    expect(r.erro).toBeTruthy();
  });
});

const ALTERAR_VALIDO: AlterarEmLoteEntrada = {
  padrao_nome: "AULÃO #{n}",
  descricao: "desc nova",
  fechado: true,
  aprovacao_entrada: false,
  caractere_numeracao: "",
  mensagens_temporarias: "nao",
  imagem_grupo_url: null,
  forcar: false,
};

describe("salvarAlterarEmLote (diálogo 'Alterar grupos em lote')", () => {
  it("nada mudou: salva a campanha mas não cria execução nenhuma", async () => {
    const chamadas = usar((c) => {
      if (c.tabela === "campanhas" && c.op === "select") {
        return { data: { padrao_nome: ALTERAR_VALIDO.padrao_nome, descricao: ALTERAR_VALIDO.descricao, fechado: true, aprovacao_entrada: false, caractere_numeracao: "", mensagens_temporarias: "nao", numero_no_inicio: false } };
      }
      return {};
    });
    const r = await salvarAlterarEmLote(CAMP, ALTERAR_VALIDO);
    expect(r).toEqual({});
    expect(chamadas.filter((c) => c.tabela === "execucoes")).toHaveLength(0);
    expect(hoisted.registrarHistoricoMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ resumo: expect.stringContaining("nada mudou") }));
  });

  it("nome, descrição e configuração mudaram: cria as 3 execuções ANTES de salvar a campanha, pros grupos ativos (alvo_grupos null)", async () => {
    const chamadas = usar((c) => {
      if (c.tabela === "campanhas" && c.op === "select") {
        return { data: { padrao_nome: "Nome antigo", descricao: "desc antiga", fechado: false, aprovacao_entrada: true, caractere_numeracao: "#", mensagens_temporarias: "24h", numero_no_inicio: false } };
      }
      return {};
    });
    const r = await salvarAlterarEmLote(CAMP, ALTERAR_VALIDO);
    expect(r).toEqual({});
    const execs = chamadas.filter((c) => c.tabela === "execucoes" && c.op === "insert");
    expect(execs).toHaveLength(3);
    const update = chamadas.find((c) => c.tabela === "campanhas" && c.op === "update")!;
    // As 3 execuções (índices 1,2,3 — o índice 0 é o select da campanha) vêm antes do update da campanha.
    expect(chamadas.indexOf(update)).toBeGreaterThan(chamadas.lastIndexOf(execs[execs.length - 1]));
    const porTipo = new Map(execs.map((e) => [(e.dados as { tipo: string }).tipo, e.dados as Record<string, unknown>]));
    expect(porTipo.get("nome")).toMatchObject({ origem: "massa", alvo_grupos: null, conteudo: { padrao: "AULÃO #{n}" } });
    expect(porTipo.get("descricao")).toMatchObject({ origem: "massa", alvo_grupos: null, conteudo: { texto: "desc nova" } });
    // Só as chaves que mudaram entram na configuração (fix da revisão final).
    expect(porTipo.get("configuracao")).toMatchObject({
      origem: "massa",
      alvo_grupos: null,
      conteudo: { so_admins_enviam: true, aprovacao_entrada: false, temporarias: "nao" },
    });
  });

  it("só a aprovação mudou: a execução de configuração só leva essa chave (não announce, não temporárias)", async () => {
    const chamadas = usar((c) => {
      if (c.tabela === "campanhas" && c.op === "select") {
        return { data: { padrao_nome: ALTERAR_VALIDO.padrao_nome, descricao: ALTERAR_VALIDO.descricao, fechado: true, aprovacao_entrada: true, caractere_numeracao: "", mensagens_temporarias: "nao", numero_no_inicio: false } };
      }
      return {};
    });
    const r = await salvarAlterarEmLote(CAMP, { ...ALTERAR_VALIDO, aprovacao_entrada: false });
    expect(r).toEqual({});
    const execs = chamadas.filter((c) => c.tabela === "execucoes" && c.op === "insert");
    expect(execs).toHaveLength(1);
    expect((execs[0].dados as { tipo: string }).tipo).toBe("configuracao");
    expect((execs[0].dados as { conteudo: unknown }).conteudo).toEqual({ aprovacao_entrada: false });
  });

  it("padrão sem {n}: a execução de nome recebe o padrão com {n} no fim (ou no início, com numero_no_inicio)", async () => {
    const chamadas1 = usar((c) => {
      if (c.tabela === "campanhas" && c.op === "select") {
        return { data: { padrao_nome: "Nome antigo", descricao: ALTERAR_VALIDO.descricao, fechado: true, aprovacao_entrada: false, caractere_numeracao: "", mensagens_temporarias: "nao", numero_no_inicio: false } };
      }
      return {};
    });
    await salvarAlterarEmLote(CAMP, { ...ALTERAR_VALIDO, padrao_nome: "GRUPO VIP" });
    const exec1 = chamadas1.find((c) => c.tabela === "execucoes" && c.op === "insert")!;
    expect((exec1.dados as { conteudo: { padrao: string } }).conteudo.padrao).toBe("GRUPO VIP {n}");

    const chamadas2 = usar((c) => {
      if (c.tabela === "campanhas" && c.op === "select") {
        return { data: { padrao_nome: "Nome antigo", descricao: ALTERAR_VALIDO.descricao, fechado: true, aprovacao_entrada: false, caractere_numeracao: "", mensagens_temporarias: "nao", numero_no_inicio: true } };
      }
      return {};
    });
    await salvarAlterarEmLote(CAMP, { ...ALTERAR_VALIDO, padrao_nome: "GRUPO VIP" });
    const exec2 = chamadas2.find((c) => c.tabela === "execucoes" && c.op === "insert")!;
    expect((exec2.dados as { conteudo: { padrao: string } }).conteudo.padrao).toBe("{n} GRUPO VIP");
  });

  it("execução falha no meio: devolve o erro, não salva a campanha, e diz que a execução já criada continua valendo", async () => {
    let chamadaExec = 0;
    const chamadas = usar((c) => {
      if (c.tabela === "campanhas" && c.op === "select") {
        return { data: { padrao_nome: "Nome antigo", descricao: "desc antiga", fechado: false, aprovacao_entrada: true, caractere_numeracao: "#", mensagens_temporarias: "24h", numero_no_inicio: false } };
      }
      if (c.tabela === "execucoes" && c.op === "insert") {
        chamadaExec++;
        if (chamadaExec === 2) return { error: { message: "caiu" } }; // a 2ª execução (descrição) falha
      }
      return {};
    });
    const r = await salvarAlterarEmLote(CAMP, ALTERAR_VALIDO);
    expect(r.erro).toMatch(/a campanha não foi salva/);
    expect(r.erro).toMatch(/nome.*já foi criada/);
    expect(chamadas.find((c) => c.tabela === "campanhas" && c.op === "update")).toBeUndefined();
  });

  it("forçar aplicar mesmo sem mudança: cria as 3 execuções mesmo com tudo igual", async () => {
    const chamadas = usar((c) => {
      if (c.tabela === "campanhas" && c.op === "select") {
        return { data: { padrao_nome: ALTERAR_VALIDO.padrao_nome, descricao: ALTERAR_VALIDO.descricao, fechado: ALTERAR_VALIDO.fechado, aprovacao_entrada: ALTERAR_VALIDO.aprovacao_entrada, caractere_numeracao: "", mensagens_temporarias: "nao", numero_no_inicio: false } };
      }
      return {};
    });
    const r = await salvarAlterarEmLote(CAMP, { ...ALTERAR_VALIDO, forcar: true });
    expect(r).toEqual({});
    expect(chamadas.filter((c) => c.tabela === "execucoes" && c.op === "insert")).toHaveLength(3);
  });

  it("padrão de nome vazio: recusa sem tocar no banco", async () => {
    const chamadas = usar();
    const r = await salvarAlterarEmLote(CAMP, { ...ALTERAR_VALIDO, padrao_nome: "   " });
    expect(r.erro).toBeTruthy();
    expect(chamadas).toHaveLength(0);
  });

  it("descrição com mais de 2048 caracteres: recusa sem tocar no banco", async () => {
    const chamadas = usar();
    const r = await salvarAlterarEmLote(CAMP, { ...ALTERAR_VALIDO, descricao: "a".repeat(2049) });
    expect(r.erro).toBe("A descrição vai até 2048 caracteres.");
    expect(chamadas).toHaveLength(0);
  });

  it("booleano errado (forcar): recusa sem tocar no banco", async () => {
    const chamadas = usar();
    const r = await salvarAlterarEmLote(CAMP, { ...ALTERAR_VALIDO, forcar: "sim" as never });
    expect(r.erro).toBeTruthy();
    expect(chamadas).toHaveLength(0);
  });

  it("campanha inválida (não uuid): recusa sem tocar no banco", async () => {
    const chamadas = usar();
    const r = await salvarAlterarEmLote("não-é-uuid", ALTERAR_VALIDO);
    expect(r.erro).toBeTruthy();
    expect(chamadas).toHaveLength(0);
  });

  it("sem permissão de editar: recusa sem tocar no banco", async () => {
    usarMembro({ papel: "membro", permissoes: { campanhas: "ver" } });
    const chamadas = usar();
    const r = await salvarAlterarEmLote(CAMP, ALTERAR_VALIDO);
    expect(r.erro).toBeTruthy();
    expect(chamadas).toHaveLength(0);
  });
});

describe("salvarCriacaoDeGrupos / salvarAlterarGruposEmLote (as duas abas numa action só)", () => {
  it("salvarCriacaoDeGrupos salva informações e administradores numa chamada", async () => {
    usar((c) => {
      if (c.tabela === "campanhas" && c.op === "select") return { data: { conexao_criadora_id: CRIADORA } };
      if (c.tabela === "conexoes" && c.op === "select") return { data: [{ id: ADMIN1 }] };
      if (c.tabela === "campanha_conexoes" && c.op === "select") return { data: [] };
      if (c.tabela === "rpc:aplicar_contas_campanha") return { data: [{ adicionadas: 1, removidas: 0, reassociadas: 0, canceladas: 0, mantidas: 0 }] };
      return {};
    });
    const r = await salvarCriacaoDeGrupos(CAMP, INFORMACOES_VALIDAS, [ADMIN1]);
    expect(r).toEqual({});
  });

  it("salvarCriacaoDeGrupos: se a 2ª parte (administradores) falhar, diz que a 1ª já foi salva", async () => {
    usar((c) => {
      if (c.tabela === "campanhas" && c.op === "select") return { data: { conexao_criadora_id: CRIADORA } };
      if (c.tabela === "conexoes" && c.op === "select") return { error: { message: "caiu" } };
      return {};
    });
    const r = await salvarCriacaoDeGrupos(CAMP, INFORMACOES_VALIDAS, [ADMIN1]);
    expect(r.erro).toMatch(/opções de criação foram salvas/i);
  });

  it("salvarAlterarGruposEmLote salva as opções em lote e administradores numa chamada", async () => {
    usar((c) => {
      if (c.tabela === "campanhas" && c.op === "select" && c.filtros.length) {
        // primeira leitura (salvarAlterarEmLote) ou segunda (salvarAdministradores)
        return { data: { padrao_nome: ALTERAR_VALIDO.padrao_nome, descricao: ALTERAR_VALIDO.descricao, fechado: true, aprovacao_entrada: false, caractere_numeracao: "", mensagens_temporarias: "nao", numero_no_inicio: false, conexao_criadora_id: CRIADORA } };
      }
      if (c.tabela === "conexoes" && c.op === "select") return { data: [{ id: ADMIN1 }] };
      if (c.tabela === "campanha_conexoes" && c.op === "select") return { data: [] };
      if (c.tabela === "rpc:aplicar_contas_campanha") return { data: [{ adicionadas: 1, removidas: 0, reassociadas: 0, canceladas: 0, mantidas: 0 }] };
      return {};
    });
    const r = await salvarAlterarGruposEmLote(CAMP, ALTERAR_VALIDO, [ADMIN1]);
    expect(r).toEqual({});
  });
});

describe("listarGruposAtivosDaCampanha (passo 'Grupos' do assistente, origem Campanha)", () => {
  it("devolve só os grupos ativos, ordenados por número", async () => {
    usar((c) => {
      if (c.tabela === "grupos" && c.op === "select") return { data: [{ id: "g1", nome: "Grupo 1", numero: 1, participantes: 10 }] };
      return {};
    });
    const r = await listarGruposAtivosDaCampanha(CAMP);
    expect(r.grupos).toEqual([{ id: "g1", nome: "Grupo 1", numero: 1, participantes: 10 }]);
  });

  it("campanha inválida: erro sem tocar no banco", async () => {
    const chamadas = usar();
    const r = await listarGruposAtivosDaCampanha("não-é-uuid");
    expect(r.erro).toBeTruthy();
    expect(chamadas).toHaveLength(0);
  });
});

describe("moverGrupos: validação de ids e campanha de origem arquivada (revisão final)", () => {
  it("grupo inválido na lista: recusa sem tocar no banco", async () => {
    const chamadas = usar();
    const r = await moverGrupos(CAMP, ["não-é-uuid"], DESTINO);
    expect(r.erro).toBeTruthy();
    expect(chamadas).toHaveLength(0);
  });

  it("mais grupos que o máximo do lote: recusa sem tocar no banco", async () => {
    const chamadas = usar();
    const muitos = Array.from({ length: 101 }, (_, i) => `11111111-1111-1111-1111-${String(i).padStart(12, "0")}`);
    const r = await moverGrupos(CAMP, muitos, DESTINO);
    expect(r.erro).toBeTruthy();
    expect(chamadas).toHaveLength(0);
  });

  it("campanha de origem arquivada: recusa", async () => {
    usar((c) => {
      if (c.tabela === "campanhas" && c.op === "select") {
        return { data: [{ id: CAMP, arquivada: true, inicio_contagem: 1 }, { id: DESTINO, arquivada: false, inicio_contagem: 1 }] };
      }
      return {};
    });
    const r = await moverGrupos(CAMP, [G1], DESTINO);
    expect(r.erro).toMatch(/origem/);
  });

  it("campanha de destino arquivada: recusa (comportamento de antes)", async () => {
    usar((c) => {
      if (c.tabela === "campanhas" && c.op === "select") {
        return { data: [{ id: CAMP, arquivada: false, inicio_contagem: 1 }, { id: DESTINO, arquivada: true, inicio_contagem: 1 }] };
      }
      return {};
    });
    const r = await moverGrupos(CAMP, [G1], DESTINO);
    expect(r.erro).toMatch(/destino/);
  });

  it("origem e destino ativas: move os grupos normalmente", async () => {
    const chamadas = usar((c) => {
      if (c.tabela === "campanhas" && c.op === "select") {
        return { data: [{ id: CAMP, arquivada: false, inicio_contagem: 1 }, { id: DESTINO, arquivada: false, inicio_contagem: 1 }] };
      }
      if (c.tabela === "grupos" && c.op === "select") return { data: [{ id: G1 }, { id: G2 }] };
      return {};
    });
    const r = await moverGrupos(CAMP, [G1, G2], DESTINO);
    expect(r).toEqual({});
    expect(chamadas.filter((c) => c.tabela === "grupos" && c.op === "update")).toHaveLength(2);
  });
});

/** Etapa 3M, Tarefa 2: "Imagem do grupo" nos dois diálogos. */
describe("Imagem do grupo (Criação de grupos e Alterar grupos em lote)", () => {
  const IMAGEM = "https://exemplo.supabase.co/storage/v1/object/public/midias/c1/1760000000000-capa.png";
  const OUTRA = "https://exemplo.supabase.co/storage/v1/object/public/midias/c1/1760000000001-nova.png";
  const IGUAL = { padrao_nome: ALTERAR_VALIDO.padrao_nome, descricao: ALTERAR_VALIDO.descricao, fechado: true, aprovacao_entrada: false, caractere_numeracao: "", mensagens_temporarias: "nao", numero_no_inicio: false };
  const comAntes = (imagem: string | null) =>
    usar((c) => (c.tabela === "campanhas" && c.op === "select" ? { data: { ...IGUAL, imagem_grupo_url: imagem } } : {}));
  const execucoes = (cs: Chamada[]) => cs.filter((c) => c.tabela === "execucoes" && c.op === "insert").map((c) => c.dados as Record<string, unknown>);
  const updateCampanha = (cs: Chamada[]) => cs.find((c) => c.tabela === "campanhas" && c.op === "update")?.dados as Record<string, unknown> | undefined;

  it("imagem nova: cria a execução `imagem` em massa (todos os ativos) ANTES de salvar a campanha", async () => {
    const cs = comAntes(null);
    expect(await salvarAlterarEmLote(CAMP, { ...ALTERAR_VALIDO, imagem_grupo_url: IMAGEM, imagem_nome_arquivo: "capa.png" })).toEqual({});
    const execs = execucoes(cs);
    expect(execs).toEqual([expect.objectContaining({ origem: "massa", tipo: "imagem", alvo_grupos: null, conteudo: { url: IMAGEM, nome_arquivo: "capa.png" } })]);
    const iExec = cs.findIndex((c) => c.tabela === "execucoes");
    const iUpdate = cs.findIndex((c) => c.tabela === "campanhas" && c.op === "update");
    expect(iUpdate).toBeGreaterThan(iExec);
    expect(updateCampanha(cs)).toMatchObject({ imagem_grupo_url: IMAGEM });
  });

  it("imagem trocada por outra também cria; a mesma imagem sem forçar não cria", async () => {
    let cs = comAntes(IMAGEM);
    await salvarAlterarEmLote(CAMP, { ...ALTERAR_VALIDO, imagem_grupo_url: OUTRA });
    expect(execucoes(cs).map((e) => e.tipo)).toEqual(["imagem"]);

    cs = comAntes(IMAGEM);
    expect(await salvarAlterarEmLote(CAMP, { ...ALTERAR_VALIDO, imagem_grupo_url: IMAGEM })).toEqual({});
    expect(execucoes(cs)).toHaveLength(0);
    expect(updateCampanha(cs)).toMatchObject({ imagem_grupo_url: IMAGEM });
  });

  it("forçar cria a execução da imagem mesmo sem mudança", async () => {
    const cs = comAntes(IMAGEM);
    await salvarAlterarEmLote(CAMP, { ...ALTERAR_VALIDO, imagem_grupo_url: IMAGEM, forcar: true });
    expect(execucoes(cs).map((e) => e.tipo)).toEqual(["nome", "descricao", "configuracao", "imagem"]);
  });

  it("tirar a imagem: não cria execução (o WhatsApp não deixa apagar), só grava null na campanha", async () => {
    const cs = comAntes(IMAGEM);
    expect(await salvarAlterarEmLote(CAMP, { ...ALTERAR_VALIDO, imagem_grupo_url: null, forcar: true })).toEqual({});
    expect(execucoes(cs).map((e) => e.tipo)).not.toContain("imagem");
    expect(updateCampanha(cs)).toMatchObject({ imagem_grupo_url: null });
    const cs2 = comAntes(IMAGEM);
    await salvarAlterarEmLote(CAMP, { ...ALTERAR_VALIDO, imagem_grupo_url: "" });
    expect(execucoes(cs2)).toHaveLength(0);
    expect(updateCampanha(cs2)).toMatchObject({ imagem_grupo_url: null });
  });

  it("falha ao criar a execução da imagem: mensagem de erro parcial e a campanha não é salva", async () => {
    const cs = usar((c) => {
      if (c.tabela === "campanhas" && c.op === "select") return { data: { ...IGUAL, descricao: "desc antiga", imagem_grupo_url: null } };
      if (c.tabela === "execucoes" && c.op === "insert" && (c.dados as { tipo: string }).tipo === "imagem") return { error: { message: "caiu" } };
      return {};
    });
    const r = await salvarAlterarEmLote(CAMP, { ...ALTERAR_VALIDO, imagem_grupo_url: IMAGEM });
    expect(r.erro).toBe("Não foi possível salvar a ação. A(s) execução(ões) de descrição já foram criadas e continuam valendo; a campanha não foi salva.");
    expect(updateCampanha(cs)).toBeUndefined();
  });

  it("URL que não é https (ou host privado): recusa sem tocar no banco", async () => {
    for (const ruim of ["http://x/a.png", "https://10.0.0.1/a.png", "data:image/png;base64,AA"]) {
      const cs = usar();
      expect(await salvarAlterarEmLote(CAMP, { ...ALTERAR_VALIDO, imagem_grupo_url: ruim })).toEqual({ erro: "Imagem do grupo inválida: envie a imagem pelo Vórtex Grupo." });
      expect(cs).toHaveLength(0);
    }
  });

  it("Criação de grupos: grava imagem_grupo_url (vazio = null) sem criar execução; http é recusado", async () => {
    let cs = usar(() => ({}));
    expect(await salvarInformacoesCriacao(CAMP, { ...INFORMACOES_VALIDAS, imagem_grupo_url: IMAGEM })).toEqual({});
    expect(cs).toHaveLength(1);
    expect(updateCampanha(cs)).toMatchObject({ imagem_grupo_url: IMAGEM });

    cs = usar(() => ({}));
    await salvarInformacoesCriacao(CAMP, { ...INFORMACOES_VALIDAS, imagem_grupo_url: "  " });
    expect(updateCampanha(cs)).toMatchObject({ imagem_grupo_url: null });

    cs = usar();
    expect(await salvarInformacoesCriacao(CAMP, { ...INFORMACOES_VALIDAS, imagem_grupo_url: "http://x/a.png" })).toMatchObject({ erro: "Imagem do grupo inválida: envie a imagem pelo Vórtex Grupo." });
    expect(cs).toHaveLength(0);
  });

  it("sem permissão de editar: recusa sem tocar no banco", async () => {
    usarMembro({ papel: "membro", permissoes: { campanhas: "ver" } });
    const cs = usar();
    expect((await salvarAlterarEmLote(CAMP, { ...ALTERAR_VALIDO, imagem_grupo_url: IMAGEM })).erro).toBeTruthy();
    expect(cs).toHaveLength(0);
  });
});
