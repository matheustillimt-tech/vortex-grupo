import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, filtro, type Chamada, type Resposta } from "./apoio/db-falso";
import { liberarTudo, SEM_PERMISSAO, usarMembro } from "./apoio/permissoes";

/** Etapa 3K, Tarefa 3: as 4 ações novas do assistente ("Relatório de status de mensagens", "Histórico de mensagens
 *  enviadas", "Entrar no Grupo", "Privacidade Avançada na Conversa"). */

const hoisted = vi.hoisted(() => ({
  dbAtual: undefined as unknown,
  historico: vi.fn(async (..._a: unknown[]) => undefined),
  alertar: vi.fn(async (..._a: unknown[]) => undefined),
  entrarNoGrupo: vi.fn(async (..._a: unknown[]) => undefined),
}));

vi.mock("@/src/lib/permissoes", async () => (await import("./apoio/permissoes")).permissoesFalsas());
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => hoisted.dbAtual }));
vi.mock("@/src/lib/supabase/usuario", () => ({ exigirUsuario: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/src/lib/historico", () => ({ registrarHistorico: hoisted.historico }));
vi.mock("@/src/lib/jobs/alertas", () => ({ alertar: hoisted.alertar }));
vi.mock("@/src/lib/jobs/grupo-novo", () => ({ criarGatilhosGrupoNovo: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/src/lib/conexoes", () => ({ paraZapbot: vi.fn(), credenciais: vi.fn(async () => ({ id: "i", token: "t", clientToken: "c" })) }));
vi.mock("@/src/lib/zapbot/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/src/lib/zapbot/client")>();
  return { ...real, zapbot: () => ({ entrarNoGrupo: hoisted.entrarNoGrupo }) };
});

import { criarAcao, listarExecucoesRelatorio } from "@/app/(painel)/acoes/actions";
import { criarAcaoComo } from "@/src/lib/acoes/criar";
import { entradaAcaoDaApi } from "@/src/lib/regras/api";
import { executarTarefa } from "@/src/lib/jobs/executar-tarefa";
import { decidirFoto } from "@/src/lib/regras/foto";
import { erroDefinitivoEntrar, jaParticipa, processarAcoes } from "@/src/lib/jobs/acoes";
import {
  ACOES_ASSISTENTE,
  estadoAcaoInicial,
  estadoComPreset,
  hrefRelatorio,
  montarEntradaAcao,
  passosDoTipo,
  pendenciaDoPassoAcao,
  PASSOS_ACAO,
  TIPOS_SO_PAINEL,
  validarEntradaAcao,
  validarIntervalo,
  validarLinkConvite,
  type CampanhaDoAssistente,
  type EstadoAcao,
} from "@/src/lib/regras/assistente-acao";
import { validarConteudo } from "@/src/lib/regras/conteudo";
import { acoesPermitidas, linhasDoEvento, validarAutomacao, type EntradaAutomacao } from "@/src/lib/regras/automacoes";
import { ZapbotError } from "@/src/lib/zapbot/client";
import { PROVA } from "@/src/lib/zapbot/prova";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const K1 = "66666666-6666-6666-6666-666666666661";
const K2 = "66666666-6666-6666-6666-666666666662";
const K3 = "66666666-6666-6666-6666-666666666663";
const E1 = "77777777-7777-7777-7777-777777777771";
const LINK = "https://chat.whatsapp.com/AbCdEfGhIj1234567890";
const AGORA = new Date("2026-10-17T12:00:00Z");
const IMAGEM = "https://exemplo.supabase.co/storage/v1/object/public/midias/c1/1760000000000-capa.png";
const CAMPANHAS: CampanhaDoAssistente[] = [
  { id: A, nome: "Aula A", descricao: null, projeto_id: null },
  { id: B, nome: "Aula B", descricao: null, projeto_id: null },
];
const estado = (p: Partial<EstadoAcao>): EstadoAcao => ({ ...estadoAcaoInicial(), ...p });

beforeEach(() => {
  vi.clearAllMocks();
  liberarTudo();
});

describe("regras do assistente", () => {
  it("ícones e rótulos das 4 novas (e de \"Trocar imagem\", Etapa 3M)", () => {
    const novas = ACOES_ASSISTENTE.filter((a) => (TIPOS_SO_PAINEL as readonly string[]).includes(a.tipo));
    expect(novas).toEqual([
      { tipo: "relatorio_status", rotulo: "Relatório de status de mensagens", icone: "download" },
      { tipo: "historico_enviadas", rotulo: "Histórico de mensagens enviadas", icone: "history" },
      { tipo: "entrar_grupo", rotulo: "Entrar no Grupo", icone: "group_add" },
      { tipo: "privacidade_avancada", rotulo: "Privacidade Avançada na Conversa", icone: "privacy_tip" },
    ]);
  });

  it("passos por ação: relatórios sem Contas/Grupos, Entrar no Grupo sem Categoria/Campanha/Grupos, o resto igual", () => {
    expect(passosDoTipo("relatorio_status")).toEqual(["categoria", "campanha", "acao", "conteudo", "confirmar"]);
    expect(passosDoTipo("historico_enviadas")).toEqual(["categoria", "campanha", "acao", "conteudo", "confirmar"]);
    expect(passosDoTipo("entrar_grupo")).toEqual(["acao", "contas", "conteudo", "confirmar"]);
    expect(passosDoTipo("privacidade_avancada")).toBe(PASSOS_ACAO);
    expect(passosDoTipo("mensagem")).toBe(PASSOS_ACAO);
    expect(passosDoTipo(null)).toBe(PASSOS_ACAO);
  });

  it("preset da URL começa no passo seguinte à Ação de cada fluxo", () => {
    expect(estadoComPreset(A, "relatorio_status").passo).toBe("conteudo");
    expect(estadoComPreset(A, "entrar_grupo").passo).toBe("contas");
    expect(estadoComPreset(A, "mensagem").passo).toBe("contas");
  });

  it("validarLinkConvite: só https://chat.whatsapp.com/<código de 10 a 40>", () => {
    expect(validarLinkConvite(` ${LINK} `)).toBe(LINK);
    expect(validarLinkConvite("http://chat.whatsapp.com/AbCdEfGhIj12")).toBeNull();
    expect(validarLinkConvite("https://chat.whatsapp.com/curto")).toBeNull();
    expect(validarLinkConvite("https://chat.whatsapp.com/AbCdEfGhIj12/extra")).toBeNull();
    expect(validarLinkConvite("https://evil.com/chat.whatsapp.com/AbCdEfGhIj12")).toBeNull();
    expect(validarLinkConvite(`https://chat.whatsapp.com/${"a".repeat(41)}`)).toBeNull();
    expect(validarLinkConvite(42)).toBeNull();
  });

  it("validarIntervalo: dias de Brasília, fim não antes do início, até 90 dias", () => {
    expect(validarIntervalo("2026-10-01", "2026-10-17")).toEqual({ ok: true, desde: "2026-10-01T03:00:00.000Z", ate: "2026-10-18T03:00:00.000Z" });
    expect(validarIntervalo("2026-07-20", "2026-10-17").ok).toBe(true); // 90 dias contando os dois
    expect(validarIntervalo("2026-07-19", "2026-10-17")).toEqual({ ok: false, erro: "O intervalo vai até 90 dias." });
    expect(validarIntervalo("2026-10-17", "2026-10-01")).toEqual({ ok: false, erro: "O fim do intervalo vem antes do início." });
    expect(validarIntervalo("", "2026-10-01")).toEqual({ ok: false, erro: "Escolha o início do intervalo." });
    expect(validarIntervalo("2026-02-30", "2026-03-01")).toEqual({ ok: false, erro: "Data inválida." });
  });

  it("Privacidade: conteúdo ATIVAR/DESATIVAR obrigatório", () => {
    expect(validarConteudo("privacidade_avancada", {})).toEqual({ ok: false, erro: "Escolha ATIVAR ou DESATIVAR." });
    expect(validarConteudo("privacidade_avancada", { valor: false })).toEqual({ ok: true, valor: { valor: false } });
    expect(PROVA.privacidadeEmGrupo).toBe(false);
    expect(PROVA.privacidadeMotivo).toBe("O Zapbot ainda não conferiu esta opção em grupos no aparelho.");
  });

  it("Entrar no Grupo: pendências de Conexões e Conteúdo; Categoria/Campanha não seguram", () => {
    const e = estado({ tipo: "entrar_grupo", contasTodas: false, contas: [], conteudo: { link: "x" } });
    expect(pendenciaDoPassoAcao("categoria", e, CAMPANHAS, AGORA)).toBeNull();
    expect(pendenciaDoPassoAcao("campanha", e, CAMPANHAS, AGORA)).toBeNull();
    expect(pendenciaDoPassoAcao("contas", e, CAMPANHAS, AGORA)).toBe("Escolha ao menos uma conexão.");
    expect(pendenciaDoPassoAcao("conteudo", e, CAMPANHAS, AGORA)).toBe("Link de convite inválido: use https://chat.whatsapp.com/…");
    const ok = { ...e, contas: [K1], conteudo: { link: LINK } };
    expect(pendenciaDoPassoAcao("contas", ok, CAMPANHAS, AGORA)).toBeNull();
    expect(pendenciaDoPassoAcao("conteudo", ok, CAMPANHAS, AGORA)).toBeNull();
    expect(montarEntradaAcao(ok, CAMPANHAS)).toEqual({
      categoria: "campanha", campanhas: [], projetoId: null, tipo: "entrar_grupo", contas: [K1], grupos: null, conteudo: { link: LINK }, importante: false, quando: "agora",
    });
  });

  it("relatórios: não viram entrada; o Confirmar abre o CSV certo", () => {
    const st = estado({ categoria: "campanha", campanhas: [A], tipo: "relatorio_status", conteudo: { execucoes: [] } });
    expect(pendenciaDoPassoAcao("conteudo", st, CAMPANHAS, AGORA)).toBe("Marque ao menos uma ação.");
    expect(hrefRelatorio(st, CAMPANHAS)).toBeNull();
    const st2 = { ...st, conteudo: { execucoes: [E1] } };
    expect(pendenciaDoPassoAcao("conteudo", st2, CAMPANHAS, AGORA)).toBeNull();
    expect(hrefRelatorio(st2, CAMPANHAS)).toBe(`/api/exportar/status-mensagens?execucoes=${E1}`);
    expect(montarEntradaAcao(st2, CAMPANHAS)).toBeNull();
    expect(pendenciaDoPassoAcao("conteudo", { ...st, conteudo: { execucoes: Array.from({ length: 51 }, (_, i) => `77777777-7777-7777-7777-${String(i).padStart(12, "0")}`) } }, CAMPANHAS, AGORA)).toBe(
      "No máximo 50 ações por relatório.",
    );

    const hi = estado({ categoria: "campanha", campanhas: [A, B], tipo: "historico_enviadas", conteudo: { inicio: "2026-10-01", fim: "2026-10-17" } });
    expect(pendenciaDoPassoAcao("conteudo", hi, CAMPANHAS, AGORA)).toBeNull();
    expect(hrefRelatorio(hi, CAMPANHAS)).toBe(`/api/exportar/mensagens-enviadas?inicio=2026-10-01&fim=2026-10-17&campanhas=${A},${B}`);
    expect(validarEntradaAcao({ ...montarEntradaAcao({ ...hi, tipo: "abrir" }, CAMPANHAS), tipo: "historico_enviadas" }, AGORA)).toEqual({
      ok: false,
      erro: "Relatório não vira ação: use GERAR RELATÓRIO.",
    });
  });

  it("validarEntradaAcao de Entrar no Grupo: conexões obrigatórias, sem agendar, sem encadear", () => {
    const base = { categoria: "campanha", campanhas: [], projetoId: null, tipo: "entrar_grupo", contas: [K1, K1], grupos: null, conteudo: { link: LINK }, importante: false, quando: "agora" };
    const v = validarEntradaAcao(base, AGORA);
    expect(v).toMatchObject({ ok: true, valor: { tipo: "entrar_grupo", contas: [K1], conteudo: { link: LINK }, seguintes: [] } });
    expect(validarEntradaAcao({ ...base, contas: null }, AGORA)).toEqual({ ok: false, erro: "Escolha ao menos uma conexão." });
    expect(validarEntradaAcao({ ...base, quando: "2026-10-20T10:00" }, AGORA)).toEqual({ ok: false, erro: "Entrar no Grupo não é agendado: roda no próximo minuto." });
    expect(validarEntradaAcao({ ...base, conteudo: { link: "https://x.com/abc" } }, AGORA)).toEqual({ ok: false, erro: "Link de convite inválido: use https://chat.whatsapp.com/…" });
    expect(validarEntradaAcao({ ...base, seguintes: [{ tipo: "abrir", conteudo: {} }] }, AGORA)).toEqual({ ok: false, erro: "Entrar no Grupo não aceita ações encadeadas." });
  });

  it("ação encadeada não pode ser relatório nem Entrar no Grupo (Privacidade pode)", () => {
    const base = { categoria: "campanha", campanhas: [A], projetoId: null, tipo: "abrir", contas: null, grupos: null, conteudo: {}, importante: false, quando: "agora" };
    expect(validarEntradaAcao({ ...base, seguintes: [{ tipo: "entrar_grupo", conteudo: { link: LINK } }] }, AGORA)).toEqual({ ok: false, erro: "Ação 2: essa ação não pode ser encadeada." });
    expect(validarEntradaAcao({ ...base, seguintes: [{ tipo: "privacidade_avancada", conteudo: { valor: true } }] }, AGORA)).toMatchObject({
      ok: true,
      valor: { seguintes: [{ tipo: "privacidade_avancada", conteudo: { valor: true }, importante: false }] },
    });
  });
});

describe("Privacidade Avançada: tarefa no grupo", () => {
  it("chama limit-sharing (privacidadeAvancada) com o groupId e o valor", async () => {
    const z = { privacidadeAvancada: vi.fn(async () => {}), status: vi.fn() } as unknown as Parameters<typeof executarTarefa>[0];
    const c = { id: "i", token: "t", clientToken: "ct" };
    expect(await executarTarefa(z, c, "privacidade_avancada", { valor: true }, { groupId: "120@g.us", numero: 1 })).toEqual({ messageId: null });
    await executarTarefa(z, c, "privacidade_avancada", { valor: false }, { groupId: "120@g.us", numero: 1 });
    expect((z as unknown as { privacidadeAvancada: ReturnType<typeof vi.fn> }).privacidadeAvancada.mock.calls).toEqual([
      [c, "120@g.us", true],
      [c, "120@g.us", false],
    ]);
  });
});

/** Banco do "Entrar no Grupo": contas (id → status), pendentes na fila e o insert em `acoes`. */
function bancoEntrar(contas: Record<string, string>, pendentes: string[] = [], erroInsert?: { message: string; code?: string }) {
  let n = 0;
  return dbFalso((c: Chamada): Resposta => {
    if (c.tabela === "conexoes") {
      const ids = (filtro(c, "in", "id") as string[] | undefined) ?? [];
      return { data: ids.filter((id) => contas[id]).map((id) => ({ id, status: contas[id] })) };
    }
    if (c.tabela === "acoes" && c.op === "select") return { data: pendentes.map((conexao_id) => ({ dados: { link: LINK, conexao_id } })) };
    if (c.tabela === "acoes" && c.op === "insert") return erroInsert ? { error: erroInsert } : { data: (c.dados as unknown[]).map(() => ({ id: `a${++n}` })) };
    return {};
  });
}

const entradaEntrar = (contas: string[]) => ({ categoria: "campanha" as const, campanhas: [], projetoId: null, tipo: "entrar_grupo" as const, contas, grupos: null, conteudo: { link: LINK }, importante: false, quando: "agora" });

describe("Entrar no Grupo: criar (assistente)", () => {
  it("uma linha `acoes` por conexão conectada, com {link, conexao_id}; sem execução; histórico sem o link", async () => {
    const { db, chamadas } = bancoEntrar({ [K1]: "conectado", [K2]: "desconectado", [K3]: "conectado" });
    hoisted.dbAtual = db;
    const r = await criarAcao(entradaEntrar([K1, K2, K3]));
    expect(r).toEqual({ ok: true, ids: ["a1", "a2"] });
    const insert = chamadas.find((c) => c.tabela === "acoes" && c.op === "insert")!;
    expect(insert.dados).toEqual([
      { tipo: "entrar_grupo", dados: { link: LINK, conexao_id: K1 }, origem: "painel" },
      { tipo: "entrar_grupo", dados: { link: LINK, conexao_id: K3 }, origem: "painel" },
    ]);
    expect(chamadas.some((c) => c.tabela === "execucoes")).toBe(false);
    const resumo = (hoisted.historico.mock.calls[0][1] as { resumo: string }).resumo;
    expect(resumo).toBe("Entrar no Grupo pelo convite com 2 conexões (1 fora: desconectada ou já na fila)");
    expect(resumo).not.toContain("chat.whatsapp.com");
  });

  it("dedupe: conexão com o mesmo convite já na fila fica de fora; todas na fila → erro sem inserir", async () => {
    const { db, chamadas } = bancoEntrar({ [K1]: "conectado", [K2]: "conectado" }, [K1]);
    hoisted.dbAtual = db;
    expect(await criarAcao(entradaEntrar([K1, K2]))).toEqual({ ok: true, ids: ["a1"] });
    expect((chamadas.find((c) => c.op === "insert")!.dados as { dados: { conexao_id: string } }[]).map((l) => l.dados.conexao_id)).toEqual([K2]);

    const outro = bancoEntrar({ [K1]: "conectado" }, [K1]);
    hoisted.dbAtual = outro.db;
    expect(await criarAcao(entradaEntrar([K1]))).toEqual({ erro: "Essas conexões já estão na fila pra entrar nesse grupo." });
    expect(outro.chamadas.some((c) => c.op === "insert")).toBe(false);
  });

  it("corrida com o índice único (23505) vira a mesma mensagem", async () => {
    hoisted.dbAtual = bancoEntrar({ [K1]: "conectado" }, [], { message: "duplicate", code: "23505" }).db;
    expect(await criarAcao(entradaEntrar([K1]))).toEqual({ erro: "Essas conexões já estão na fila pra entrar nesse grupo." });
  });

  it("nenhuma conectada ou conexão que não existe: erro", async () => {
    hoisted.dbAtual = bancoEntrar({ [K1]: "desconectado" }).db;
    expect(await criarAcao(entradaEntrar([K1]))).toEqual({ erro: "Nenhuma das conexões escolhidas está conectada." });
    hoisted.dbAtual = bancoEntrar({ [K1]: "conectado" }).db;
    expect(await criarAcao(entradaEntrar([K1, K2]))).toEqual({ erro: "Conexão não encontrada." });
  });

  it("exige também Contas/editar (mexe nas conexões, não em campanha)", async () => {
    usarMembro({ papel: "membro", permissoes: { campanhas: "editar", contas: "ver" } });
    const { db, chamadas } = bancoEntrar({ [K1]: "conectado" });
    hoisted.dbAtual = db;
    expect(await criarAcao(entradaEntrar([K1]))).toEqual({ erro: SEM_PERMISSAO });
    expect(chamadas).toHaveLength(0);
    usarMembro({ papel: "membro", permissoes: { campanhas: "editar", contas: "editar" } });
    expect(await criarAcao(entradaEntrar([K1]))).toEqual({ ok: true, ids: ["a1"] });
  });

  it("as outras ações não pedem Contas/editar (como antes)", async () => {
    usarMembro({ papel: "membro", permissoes: { campanhas: "editar", contas: "nenhum" } });
    let n = 0;
    hoisted.dbAtual = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "campanhas") return { data: [{ id: A, arquivada: false }] };
      if (c.tabela === "execucoes" && c.op === "insert") return { data: (c.dados as unknown[]).map(() => ({ id: `e${++n}` })) };
      return {};
    }).db;
    expect(await criarAcao({ categoria: "campanha", campanhas: [A], projetoId: null, tipo: "abrir", contas: null, grupos: null, conteudo: {}, importante: false, quando: "agora" })).toEqual({ ok: true, ids: ["e1"] });
  });

  it("sem Campanhas/editar → recusa sem ler o banco", async () => {
    usarMembro({ papel: "membro", permissoes: { campanhas: "ver" } });
    const { db, chamadas } = bancoEntrar({ [K1]: "conectado" });
    hoisted.dbAtual = db;
    expect(await criarAcao(entradaEntrar([K1]))).toEqual({ erro: SEM_PERMISSAO });
    expect(chamadas).toHaveLength(0);
  });
});

describe("API v1/MCP não ganham as ações novas (resposta igual à de antes)", () => {
  it.each(["relatorio_status", "historico_enviadas", "entrar_grupo", "privacidade_avancada"])("%s → \"Escolha a ação.\" sem tocar no banco", async (tipo) => {
    const { db, chamadas } = dbFalso();
    hoisted.dbAtual = db;
    const conteudo = tipo === "privacidade_avancada" ? { valor: true } : tipo === "imagem" ? { url: IMAGEM } : { link: LINK };
    const t = entradaAcaoDaApi({ campanhas: [A], tipo, conteudo });
    expect(t.ok).toBe(true);
    const r = await criarAcaoComo({ tipo: "api", chave: { id: "k", nome: "Chave" } }, null, (t as { entrada: unknown }).entrada);
    expect(r).toEqual({ erro: "Escolha a ação." });
    expect(chamadas).toHaveLength(0);
  });

  it("pelo painel, Privacidade Avançada vira execução por campanha como as outras", async () => {
    let n = 0;
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "campanhas") return { data: [{ id: A, arquivada: false }] };
      if (c.tabela === "execucoes" && c.op === "insert") return { data: (c.dados as unknown[]).map(() => ({ id: `e${++n}` })) };
      return {};
    });
    hoisted.dbAtual = db;
    const r = await criarAcao({ categoria: "campanha", campanhas: [A], projetoId: null, tipo: "privacidade_avancada", contas: null, grupos: null, conteudo: { valor: true }, importante: false, quando: "agora" });
    expect(r).toEqual({ ok: true, ids: ["e1"] });
    expect(chamadas.find((c) => c.tabela === "execucoes")!.dados).toEqual([expect.objectContaining({ tipo: "privacidade_avancada", conteudo: { valor: true }, origem: "avulsa" })]);
  });
});

describe("Relatório de status: lista de ações do passo Conteúdo", () => {
  it("mensagens/enquetes enviadas das campanhas, últimos 90 dias, com resumo", async () => {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta =>
      c.tabela === "execucoes"
        ? { data: [{ id: E1, campanha_id: A, tipo: "enquete", conteudo: { pergunta: "Vem?", opcoes: ["S", "N"], max_respostas: 1 }, agendada_para: "2026-10-16T12:00:00Z", status: "concluida" }] }
        : {},
    );
    hoisted.dbAtual = db;
    const r = await listarExecucoesRelatorio([A, "lixo"]);
    expect(r).toEqual({ execucoes: [{ id: E1, campanha_id: A, tipo: "enquete", resumo: "Vem?", agendada_para: "2026-10-16T12:00:00Z", status: "concluida" }] });
    const q = chamadas[0];
    expect(filtro(q, "in", "campanha_id")).toEqual([A]);
    expect(filtro(q, "in", "tipo")).toEqual(["mensagem", "enquete"]);
    expect(filtro(q, "in", "status")).toEqual(["enviando", "concluida"]);
    const desde = Date.parse(filtro(q, "gte", "agendada_para") as string);
    expect(Math.round((Date.now() - desde) / 86_400_000)).toBe(90);
  });

  it("sem Campanhas/ver → recusa", async () => {
    usarMembro({ papel: "membro", permissoes: { campanhas: "nenhum" } });
    expect(await listarExecucoesRelatorio([A])).toEqual({ erro: SEM_PERMISSAO });
  });
});

describe("Entrar no Grupo: job (processarAcoes)", () => {
  function bancoJob(acao: Record<string, unknown>, conta: { nome: string; status: string } | null = { nome: "Conexão 1", status: "conectado" }) {
    return dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "rpc:pegar_acoes") return { data: [acao] };
      if (c.tabela === "conexoes") return { data: conta };
      return {};
    });
  }
  const acao = (p: Record<string, unknown> = {}) => ({ id: "ac1", tipo: "entrar_grupo", campanha_id: null, grupo_id: null, telefone: null, dados: { link: LINK, conexao_id: K1 }, tentativas: 1, origem: "painel", ...p });
  const prazo = () => ({ ate: Date.now() + 60_000 });
  const atualizacao = (chamadas: Chamada[]) => chamadas.filter((c) => c.tabela === "acoes" && c.op === "update").at(-1)!.dados as Record<string, unknown>;

  it("ok: join-group uma vez com o link, ação ok e histórico \"Conexão {nome} entrou no grupo pelo convite\"", async () => {
    const { db, chamadas } = bancoJob(acao());
    hoisted.dbAtual = db;
    await processarAcoes(prazo());
    expect(hoisted.entrarNoGrupo).toHaveBeenCalledTimes(1);
    expect(hoisted.entrarNoGrupo).toHaveBeenCalledWith({ id: "i", token: "t", clientToken: "c" }, LINK);
    expect(atualizacao(chamadas)).toMatchObject({ status: "ok", erro: null });
    expect(hoisted.historico).toHaveBeenCalledWith(null, expect.objectContaining({ acao: "executar", area: "Ações", resumo: "Conexão Conexão 1 entrou no grupo pelo convite" }));
    expect(hoisted.alertar).not.toHaveBeenCalled();
  });

  it("convite recusado (400): erro definitivo na primeira, com alerta criacao_erro", async () => {
    hoisted.entrarNoGrupo.mockRejectedValueOnce(new ZapbotError(400, "invalid invite", {}));
    const { db, chamadas } = bancoJob(acao());
    hoisted.dbAtual = db;
    await processarAcoes(prazo());
    expect(atualizacao(chamadas)).toMatchObject({ status: "erro", erro: "invalid invite" });
    expect(hoisted.alertar).toHaveBeenCalledWith(
      expect.objectContaining({ tipo: "criacao_erro", texto: "A conexão Conexão 1 não conseguiu entrar no grupo pelo convite: invalid invite", conexaoId: K1 }),
      expect.anything(),
    );
    expect(hoisted.historico).not.toHaveBeenCalled();
  });

  it("erro passageiro (5xx / conexão desconectada) volta pra fila até a 3ª tentativa, sem alerta antes", async () => {
    hoisted.entrarNoGrupo.mockRejectedValueOnce(new ZapbotError(503, "fora do ar", {}));
    const um = bancoJob(acao());
    hoisted.dbAtual = um.db;
    await processarAcoes(prazo());
    expect(atualizacao(um.chamadas)).toMatchObject({ status: "fila" });
    expect(hoisted.alertar).not.toHaveBeenCalled();

    const dois = bancoJob(acao({ tentativas: 3 }), { nome: "Conexão 1", status: "desconectado" });
    hoisted.dbAtual = dois.db;
    await processarAcoes(prazo());
    expect(atualizacao(dois.chamadas)).toMatchObject({ status: "erro", erro: "Conexão desconectada." });
    expect(hoisted.alertar).toHaveBeenCalledTimes(1);
  });

  it("conexão que já participa do grupo: sucesso, sem alerta, histórico \"já estava\"", async () => {
    hoisted.entrarNoGrupo.mockRejectedValueOnce(new ZapbotError(409, "already a participant of this group", {}));
    const { db, chamadas } = bancoJob(acao());
    hoisted.dbAtual = db;
    await processarAcoes(prazo());
    expect(atualizacao(chamadas)).toMatchObject({ status: "ok", erro: null });
    expect(hoisted.alertar).not.toHaveBeenCalled();
    expect(hoisted.historico).toHaveBeenCalledWith(null, expect.objectContaining({ resumo: "Conexão Conexão 1 já estava no grupo do convite" }));
  });

  it("jaParticipa: só erro 4xx com o texto de já participante", () => {
    expect(jaParticipa(new ZapbotError(400, "Already in group", {}))).toBe(true);
    expect(jaParticipa(new ZapbotError(409, "already joined", {}))).toBe(true);
    expect(jaParticipa(new ZapbotError(400, "Você já é participante deste grupo", {}))).toBe(true);
    expect(jaParticipa(new ZapbotError(400, "invalid invite", {}))).toBe(false);
    expect(jaParticipa(new ZapbotError(500, "already a participant", {}))).toBe(false);
    expect(jaParticipa(new Error("already a participant"))).toBe(false);
  });

  it("erroDefinitivoEntrar só para 4xx que não é do número/servidor", () => {
    expect(erroDefinitivoEntrar(new ZapbotError(400, "x", {}))).toBe(true);
    expect(erroDefinitivoEntrar(new ZapbotError(409, "x", {}))).toBe(true);
    for (const s of [401, 404, 408, 429, 500, 503]) expect(erroDefinitivoEntrar(new ZapbotError(s, "x", {}))).toBe(false);
    expect(erroDefinitivoEntrar(new Error("x"))).toBe(false);
  });

  it("regressão: remover segue pelo caminho de antes (sem join-group)", async () => {
    const { db } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "rpc:pegar_acoes") return { data: [{ id: "r1", tipo: "remover", campanha_id: "c1", grupo_id: "g1", telefone: "5511" + "900000001", dados: {}, tentativas: 1, origem: "automacao", automacao_id: null }] };
      return {};
    });
    hoisted.dbAtual = db;
    await processarAcoes(prazo());
    expect(hoisted.entrarNoGrupo).not.toHaveBeenCalled();
  });
});

/** Etapa 3M, Tarefa 2: "Trocar imagem" (assistente de ação) e "Atualizar foto do grupo" (automações). */
describe("Trocar imagem: assistente", () => {
  it("logo depois de \"Trocar descrição\", com todos os passos e o conteúdo validado no servidor", () => {
    const tipos = ACOES_ASSISTENTE.map((a) => a.tipo);
    expect(tipos.indexOf("imagem")).toBe(tipos.indexOf("descricao") + 1);
    expect(passosDoTipo("imagem")).toBe(PASSOS_ACAO);
    const base = { categoria: "campanha", campanhas: [A], projetoId: null, tipo: "imagem", contas: null, grupos: null, importante: false, quando: "agora" };
    expect(validarEntradaAcao({ ...base, conteudo: { url: "" } }, AGORA)).toEqual({ ok: false, erro: "Escolha a imagem do grupo." });
    expect(validarEntradaAcao({ ...base, conteudo: { url: "http://exemplo.com/a.png" } }, AGORA)).toEqual({ ok: false, erro: "A imagem do grupo precisa ser enviada pelo Vórtex Grupo." });
    expect(validarEntradaAcao({ ...base, conteudo: { url: "https://169.254.169.254/latest" } }, AGORA).ok).toBe(false);
    expect(validarEntradaAcao({ ...base, conteudo: { url: IMAGEM, nome_arquivo: "capa.png" } }, AGORA)).toMatchObject({ ok: true, valor: { tipo: "imagem", conteudo: { url: IMAGEM, nome_arquivo: "capa.png" } } });
    // Também como ação encadeada ("Adicionar outra ação").
    expect(validarEntradaAcao({ ...base, tipo: "abrir", conteudo: {}, seguintes: [{ tipo: "imagem", conteudo: { url: "http://x/a.png" } }] }, AGORA)).toEqual({ ok: false, erro: "Ação 2: A imagem do grupo precisa ser enviada pelo Vórtex Grupo." });
    expect(pendenciaDoPassoAcao("conteudo", estado({ categoria: "campanha", campanhas: [A], tipo: "imagem", conteudo: { url: "" } }), CAMPANHAS)).toBe("Escolha a imagem do grupo.");
  });

  it("pelo painel vira execução `imagem` por campanha, como as outras ações de grupo", async () => {
    let n = 0;
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "campanhas") return { data: [{ id: A, arquivada: false }] };
      if (c.tabela === "execucoes" && c.op === "insert") return { data: (c.dados as unknown[]).map(() => ({ id: `e${++n}` })) };
      return {};
    });
    hoisted.dbAtual = db;
    const r = await criarAcao({ categoria: "campanha", campanhas: [A], projetoId: null, tipo: "imagem", contas: null, grupos: null, conteudo: { url: IMAGEM, nome_arquivo: "capa.png" }, importante: false, quando: "agora" });
    expect(r).toEqual({ ok: true, ids: ["e1"] });
    expect(chamadas.find((c) => c.tabela === "execucoes")!.dados).toEqual([expect.objectContaining({ tipo: "imagem", conteudo: { url: IMAGEM, nome_arquivo: "capa.png" }, origem: "avulsa" })]);
  });
});

describe("Trocar imagem: tarefa no grupo", () => {
  const c = { id: "i", token: "t", clientToken: "ct" };
  const g = { groupId: "120@g.us", numero: 3 };

  it("regressão 17/10: devolve foto_atualizada_em = agora junto da foto_url (a conferência não apaga a foto recém-posta)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-17T20:13:00.000Z"));
    try {
      const z = { trocarFoto: vi.fn(async () => {}), status: vi.fn() } as unknown as Parameters<typeof executarTarefa>[0];
      const r = await executarTarefa(z, c, "imagem", { url: IMAGEM }, g);
      expect(r.grupo).toEqual({ foto_url: IMAGEM, foto_atualizada_em: "2026-10-17T20:13:00.000Z" });
      // Conferência 2 min depois, sem avatarUrl no GET: mantém (não pergunta na /avatar nem apaga).
      expect(decidirFoto({ noBanco: r.grupo!.foto_url, atualizadaEm: r.grupo!.foto_atualizada_em, conferidaEm: null, avatarUrl: undefined, agora: "2026-10-17T20:15:25.000Z" })).toEqual({ tipo: "nada" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("imagem recusada pelo WhatsApp (502) vira erro definitivo (400) com a regra; outro 502 segue repetível", async () => {
    const recusa = { trocarFoto: vi.fn(async () => { throw new ZapbotError(502, "the given data is not a valid image", {}); }), status: vi.fn() } as unknown as Parameters<typeof executarTarefa>[0];
    const e = await executarTarefa(recusa, c, "imagem", { url: IMAGEM }, g).catch((x) => x);
    expect(e).toBeInstanceOf(ZapbotError);
    expect(e.status).toBe(400);
    expect(e.message).toMatch(/192 × 192 px/);
    const outro = { trocarFoto: vi.fn(async () => { throw new ZapbotError(502, "HTTP 502", {}); }), status: vi.fn() } as unknown as Parameters<typeof executarTarefa>[0];
    const e2 = await executarTarefa(outro, c, "imagem", { url: IMAGEM }, g).catch((x) => x);
    expect(e2.status).toBe(502);
    expect(e2.message).toBe("HTTP 502");
    const baixar = { trocarFoto: vi.fn(async () => { throw new ZapbotError(502, "não foi possível ler a imagem: download media: status 503", {}); }), status: vi.fn() } as unknown as Parameters<typeof executarTarefa>[0];
    const e3 = await executarTarefa(baixar, c, "imagem", { url: IMAGEM }, g).catch((x) => x);
    expect(e3.status).toBe(502);
    expect(e3.message).toMatch(/status 503/);
  });

  it("chama group-picture (trocarFoto) com o groupId e a URL e devolve foto_url pro banco", async () => {
    const z = { trocarFoto: vi.fn(async () => {}), status: vi.fn() } as unknown as Parameters<typeof executarTarefa>[0];
    expect(await executarTarefa(z, c, "imagem", { url: IMAGEM, nome_arquivo: "capa.png" }, g)).toEqual({ messageId: null, grupo: { foto_url: IMAGEM, foto_atualizada_em: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) } });
    expect((z as unknown as { trocarFoto: ReturnType<typeof vi.fn> }).trocarFoto.mock.calls).toEqual([[c, "120@g.us", IMAGEM]]);
  });

  it("com o cliente de verdade: PUT group-picture {groupId, image}", async () => {
    const { ZapbotClient } = await import("@/src/lib/zapbot/client");
    const fetchFalso = vi.fn(async (..._a: unknown[]) => new Response(JSON.stringify({ value: true }), { status: 200 }));
    const real = new ZapbotClient({ baseUrl: "https://api.zapbot.online", email: "e@x.com", password: "p", jwt: "jwt", fetch: fetchFalso as unknown as typeof fetch, sleep: async () => {} });
    expect(await executarTarefa(real, c, "imagem", { url: IMAGEM }, g)).toEqual({ messageId: null, grupo: { foto_url: IMAGEM, foto_atualizada_em: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) } });
    expect(fetchFalso).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFalso.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/group-picture$/);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({ groupId: "120@g.us", image: IMAGEM });
  });

  it("404 com o número conectado vira \"grupo sumiu\" (desativa o grupo), como os outros tipos", async () => {
    const aoSumir = vi.fn(async () => {});
    const z = {
      trocarFoto: vi.fn(async () => { throw new ZapbotError(404, "not found", {}); }),
      status: vi.fn(async () => ({ connected: true, phone: "5537" + "999999999" })),
    } as unknown as Parameters<typeof executarTarefa>[0];
    await expect(executarTarefa(z, c, "imagem", { url: IMAGEM }, g, aoSumir)).rejects.toMatchObject({ status: 400, message: "O grupo não existe mais no WhatsApp." });
    expect(aoSumir).toHaveBeenCalledTimes(1);
  });

  it("404 com o número desconectado segue como 404 (número), sem desativar o grupo", async () => {
    const aoSumir = vi.fn(async () => {});
    const z = {
      trocarFoto: vi.fn(async () => { throw new ZapbotError(404, "not found", {}); }),
      status: vi.fn(async () => ({ connected: false, phone: null })),
    } as unknown as Parameters<typeof executarTarefa>[0];
    await expect(executarTarefa(z, c, "imagem", { url: IMAGEM }, g, aoSumir)).rejects.toMatchObject({ status: 404 });
    expect(aoSumir).not.toHaveBeenCalled();
  });
});

describe("Atualizar foto do grupo: automações", () => {
  const CAMP = "11111111-1111-4111-8111-111111111111";
  const base: EntradaAutomacao = { nome: "Foto", campanha_id: CAMP, gatilho: "grupo_criado", quando: null, alvo_grupos: null, pasta: null, provedor: null, produto: null, acoes: [] };
  const acao = { tipo: "imagem" as const, conteudo: { url: IMAGEM, nome_arquivo: "capa.png" }, atraso_min: 0 };

  it("entra em cronograma, grupo cheio e grupo criado; entrou, saiu e checkout continuam sem ela", () => {
    for (const g of ["cronograma", "grupo_cheio", "grupo_criado"] as const) expect(acoesPermitidas(g)).toContain("imagem");
    for (const g of ["entrou", "saiu", "checkout"] as const) expect(acoesPermitidas(g)).not.toContain("imagem");
  });

  it("grupo_criado aceita \"Atualizar foto do grupo\" (conteúdo validado); entrou recusa", () => {
    const r = validarAutomacao({ ...base, acoes: [acao] }, AGORA);
    expect(r).toMatchObject({ ok: true, valor: { acoes: [{ tipo: "imagem", conteudo: { url: IMAGEM, nome_arquivo: "capa.png" }, atraso_min: 0 }] } });
    expect(validarAutomacao({ ...base, acoes: [{ ...acao, conteudo: { url: "http://x/a.png" } }] }, AGORA)).toEqual({ ok: false, erro: "Ação 1: A imagem do grupo precisa ser enviada pelo Vórtex Grupo." });
    expect(validarAutomacao({ ...base, gatilho: "entrou", acoes: [acao] }, AGORA)).toEqual({ ok: false, erro: "Ação 1: não vale para este gatilho." });
  });

  it("o motor cria a execução `imagem` só pro grupo do evento, como as outras ações de grupo", () => {
    const linhas = linhasDoEvento({ id: "au1", campanha_id: CAMP }, [{ ...acao, id: "x1" }], "grupo-1", AGORA);
    expect(linhas).toEqual([expect.objectContaining({ tipo: "imagem", conteudo: { url: IMAGEM, nome_arquivo: "capa.png" }, alvo_grupos: ["grupo-1"], origem: "automacao" })]);
  });
});
