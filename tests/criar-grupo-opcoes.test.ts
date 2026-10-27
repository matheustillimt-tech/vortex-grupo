import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, filtro, type Chamada, type Resposta } from "./apoio/db-falso";

const hoisted = vi.hoisted(() => ({
  dbAtual: undefined as unknown,
  zapbotFake: {
    criarGrupo: vi.fn(async (..._a: unknown[]) => "120@g.us"),
    participantes: vi.fn(async (..._a: unknown[]) => undefined),
    participantesComResultado: vi.fn(async (..._a: unknown[]): Promise<string[] | null> => null),
    configurarGrupo: vi.fn(async (..._a: unknown[]) => undefined),
    criarComunidade: vi.fn(async (..._a: unknown[]) => "999@g.us"),
    ligarGrupo: vi.fn(async (..._a: unknown[]) => undefined),
    linkConvite: vi.fn(async (..._a: unknown[]) => "https://chat.whatsapp.com/X"),
    modoEntrada: vi.fn(async (..._a: unknown[]) => undefined),
    mensagensTemporarias: vi.fn(async (..._a: unknown[]) => undefined),
    trocarFoto: vi.fn(async (..._a: unknown[]) => undefined),
  },
  alertarMock: vi.fn(async (_a: unknown, _db?: unknown) => undefined),
}));

vi.mock("@/src/lib/jobs/alertas", () => ({ alertar: hoisted.alertarMock }));
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => hoisted.dbAtual }));
vi.mock("@/src/lib/zapbot/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/src/lib/zapbot/client")>();
  return { ...real, zapbot: () => hoisted.zapbotFake };
});
vi.mock("@/src/lib/conexoes", () => ({ paraZapbot: (c: { id: string }) => ({ id: c.id, token: "t", clientToken: "c" }), credenciais: vi.fn() }));
vi.mock("@/src/lib/jobs/grupo-novo", () => ({ criarGatilhosGrupoNovo: vi.fn(async () => 0) }));
vi.mock("@/src/lib/automacoes", () => ({ dispararAutomacoes: vi.fn(async () => 0) }));

import { processarAcoes } from "@/src/lib/jobs/acoes";

const CAMP_ANTIGA = { conexao_criadora_id: "con1", descricao: "desc", fechado: true, comunidade_id: null, usar_comunidade: false, padrao_nome: "AULÃO #{n}", nome: "Campanha X", mensagem_fixa: null };

type Montagem = {
  camp?: Record<string, unknown>;
  ultimoNumero?: number | null;
  ultimaCriacaoDaConta?: string | null;
  cliquesUltimaHora?: number;
  origem?: string;
  dados?: Record<string, unknown>;
  tentativas?: number;
  erroExecucoes?: boolean;
  adminsNumeros?: string[];
  /** Contingência: criadora fora do ar e conexões associadas (com a conexão embutida). */
  criadoraCaida?: boolean;
  associadas?: { id: string; nome: string; status: string; telefone: string }[];
};

function montar(o: Montagem = {}) {
  const acao = { id: "ac1", tipo: "criar_grupo", campanha_id: "c1", grupo_id: null, telefone: null, dados: o.dados ?? {}, tentativas: o.tentativas ?? 1, origem: o.origem ?? "folga" };
  const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
    if (c.tabela === "rpc:pegar_acoes") return { data: [acao] };
    if (c.tabela === "campanhas" && c.op === "select") return { data: { ...CAMP_ANTIGA, ...o.camp } };
    if (c.tabela === "conexoes") return { data: { id: "con1", nome: "Chip 1", status: o.criadoraCaida ? "desconectado" : "conectado" } };
    if (c.tabela === "campanha_conexoes") return { data: (o.associadas ?? []).map((x) => ({ conexoes: x })) };
    if (c.tabela === "campanha_admins_numeros" && c.op === "select") return { data: (o.adminsNumeros ?? []).map((telefone) => ({ telefone })) };
    if (c.tabela === "cliques") return { count: o.cliquesUltimaHora ?? 0 };
    if (c.tabela === "grupos" && c.op === "upsert") return { data: { id: "grupo-1" } };
    if (c.tabela === "grupos" && c.op === "select" && filtro(c, "eq", "conexao_id")) return { data: o.ultimaCriacaoDaConta ? { created_at: o.ultimaCriacaoDaConta } : null };
    if (c.tabela === "grupos" && c.op === "select") return { data: o.ultimoNumero == null ? null : { numero: o.ultimoNumero } };
    if (c.tabela === "execucoes" && c.op === "insert" && o.erroExecucoes) return { error: { message: "banco fora" } };
    return {};
  });
  hoisted.dbAtual = db;
  return chamadas;
}

const prazo = () => ({ ate: Date.now() + 60_000 });
const finalDaAcao = (cs: Chamada[]) => cs.filter((c) => c.tabela === "acoes" && c.op === "update").at(-1)?.dados as Record<string, unknown>;
const upsertGrupo = (cs: Chamada[]) => cs.find((c) => c.tabela === "grupos" && c.op === "upsert")?.dados as Record<string, unknown> | undefined;
const execucoesInseridas = (cs: Chamada[]) => cs.filter((c) => c.tabela === "execucoes" && c.op === "insert").map((c) => c.dados as Record<string, unknown>);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("criar grupo — regressão com as opções padrão (Etapa 3E)", () => {
  it("campanha sem as colunas novas (ou com os padrões): mesmo nome, mesmo número, fechado como hoje, sem chamadas extras", async () => {
    for (const camp of [{}, { caractere_numeracao: "", inicio_contagem: 1, numero_no_inicio: false, nao_criar_grupos: false, limite_cliques_sem_criar: null, criar_aberto_fechar_24h: false, mensagens_temporarias: "nao", aprovacao_entrada: false, modo_criacao: "normal" }]) {
      vi.clearAllMocks();
      const cs = montar({ camp, ultimoNumero: 4 });
      expect(await processarAcoes(prazo())).toBe(1);
      expect(upsertGrupo(cs)).toMatchObject({ nome: "AULÃO #05", numero: 5 });
      expect(hoisted.zapbotFake.criarGrupo).toHaveBeenCalledWith(expect.anything(), "AULÃO #05", []);
      expect(hoisted.zapbotFake.configurarGrupo).toHaveBeenCalledWith(expect.anything(), { groupId: "120@g.us", name: "AULÃO #05", description: "desc", announce: true });
      expect(hoisted.zapbotFake.modoEntrada).not.toHaveBeenCalled();
      expect(hoisted.zapbotFake.mensagensTemporarias).not.toHaveBeenCalled();
      expect(execucoesInseridas(cs)).toHaveLength(0);
      expect(cs.some((c) => c.tabela === "cliques")).toBe(false);
      expect(finalDaAcao(cs)).toMatchObject({ status: "ok", erro: null });
      // Etapa 3K: sem administradores por número, as mesmas chamadas ao Zapbot de hoje e `dados` sem a marca nova.
      expect(hoisted.zapbotFake.participantes).not.toHaveBeenCalled();
      expect(hoisted.zapbotFake.participantesComResultado).not.toHaveBeenCalled();
      expect(hoisted.zapbotFake.criarGrupo).toHaveBeenCalledTimes(1);
      expect(hoisted.zapbotFake.configurarGrupo).toHaveBeenCalledTimes(1);
      expect(hoisted.zapbotFake.linkConvite).toHaveBeenCalledTimes(1);
      expect(hoisted.alertarMock).not.toHaveBeenCalled();
      expect((finalDaAcao(cs).dados as Record<string, unknown>).adminsNumeros).toBeUndefined();
      // Etapa 3M: sem "Imagem do grupo", nenhuma troca de foto e nenhuma escrita nova em `grupos`.
      expect(hoisted.zapbotFake.trocarFoto).not.toHaveBeenCalled();
      expect(cs.some((c) => c.tabela === "grupos" && c.op === "update")).toBe(false);
      expect((finalDaAcao(cs).dados as Record<string, unknown>).foto).toBeUndefined();
    }
  });

  it("primeiro grupo da campanha continua sendo o 01", async () => {
    const cs = montar({ ultimoNumero: null });
    await processarAcoes(prazo());
    expect(upsertGrupo(cs)).toMatchObject({ nome: "AULÃO #01", numero: 1 });
  });
});

describe("criar grupo — opções de criação (Etapa 3E)", () => {
  it("caractere, início da contagem e número no início", async () => {
    const cs = montar({ camp: { padrao_nome: "Aulão", caractere_numeracao: "!", inicio_contagem: 10, numero_no_inicio: true }, ultimoNumero: null });
    await processarAcoes(prazo());
    expect(upsertGrupo(cs)).toMatchObject({ nome: "!10 Aulão", numero: 10 });
  });

  it("aprovação de entrada e mensagens temporárias depois de criar", async () => {
    montar({ camp: { aprovacao_entrada: true, mensagens_temporarias: "7d" } });
    await processarAcoes(prazo());
    expect(hoisted.zapbotFake.modoEntrada).toHaveBeenCalledWith(expect.anything(), "120@g.us", true);
    expect(hoisted.zapbotFake.mensagensTemporarias).toHaveBeenCalledWith(expect.anything(), "120@g.us", 604800);
  });

  it("criar aberto e fechar em 24 h: nasce aberto e agenda a execução 'fechar' só pro grupo novo", async () => {
    const antes = Date.now();
    const cs = montar({ camp: { fechado: true, criar_aberto_fechar_24h: true } });
    await processarAcoes(prazo());
    expect(hoisted.zapbotFake.configurarGrupo).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ announce: false }));
    const [fechar] = execucoesInseridas(cs);
    expect(fechar).toMatchObject({ campanha_id: "c1", origem: "grupo_novo", tipo: "fechar", alvo_grupos: ["grupo-1"], importante: false });
    const quando = new Date(fechar.agendada_para as string).getTime();
    expect(quando - antes).toBeGreaterThanOrEqual(24 * 3600_000);
    expect(quando - Date.now()).toBeLessThanOrEqual(24 * 3600_000);
  });

  it("falhas depois de criar viram alerta com a conexão; o grupo fica salvo e a ação termina ok", async () => {
    hoisted.zapbotFake.modoEntrada.mockRejectedValueOnce(new Error("group-mode 500"));
    hoisted.zapbotFake.mensagensTemporarias.mockRejectedValueOnce(new Error("disappearing 500"));
    const cs = montar({ camp: { aprovacao_entrada: true, mensagens_temporarias: "24h", criar_aberto_fechar_24h: true }, erroExecucoes: true });
    expect(await processarAcoes(prazo())).toBe(1);
    expect(upsertGrupo(cs)).toBeTruthy();
    expect(cs.some((c) => c.tabela === "grupos" && c.op === "delete")).toBe(false);
    expect(finalDaAcao(cs)).toMatchObject({ status: "ok", erro: null, dados: expect.objectContaining({ aprovacao: true, temporarias: true, fecharAgendado: true }) });
    const textos = hoisted.alertarMock.mock.calls.map((c) => c[0] as { tipo: string; texto: string; conexaoId: string });
    expect(textos).toHaveLength(3);
    expect(textos.every((a) => a.tipo === "criacao_erro" && a.conexaoId === "con1")).toBe(true);
    expect(textos.map((a) => a.texto)).toEqual([
      "Grupo AULÃO #01 criado, mas a aprovação de entrada não foi ligada: group-mode 500",
      "Grupo AULÃO #01 criado, mas as mensagens temporárias não foram ligadas: disappearing 500",
      "Grupo AULÃO #01 criado, mas o fechamento em 24 h não foi agendado (o grupo ficou aberto): banco fora",
    ]);
  });

  it("retentativa com os passos já marcados não chama de novo", async () => {
    const dados = { groupId: "120@g.us", promovidos: true, configurado: true, link: "https://chat.whatsapp.com/X", numero: 1, nome: "AULÃO #01", aprovacao: true, temporarias: true, fecharAgendado: true, gatilhos: true, automacoes: true };
    const cs = montar({ camp: { aprovacao_entrada: true, mensagens_temporarias: "24h", criar_aberto_fechar_24h: true }, dados, tentativas: 2 });
    await processarAcoes(prazo());
    expect(hoisted.zapbotFake.criarGrupo).not.toHaveBeenCalled();
    expect(hoisted.zapbotFake.modoEntrada).not.toHaveBeenCalled();
    expect(hoisted.zapbotFake.mensagensTemporarias).not.toHaveBeenCalled();
    expect(execucoesInseridas(cs)).toHaveLength(0);
  });

  it("'Não criar grupos': a ação automática termina ok com a nota, sem chamar o Zapbot", async () => {
    const cs = montar({ camp: { nao_criar_grupos: true } });
    await processarAcoes(prazo());
    expect(hoisted.zapbotFake.criarGrupo).not.toHaveBeenCalled();
    expect(finalDaAcao(cs)).toMatchObject({ status: "ok", erro: expect.stringMatching(/Não criar grupos/) });
  });

  it("cliques altos: não cria; abaixo do limite cria", async () => {
    const travada = montar({ camp: { limite_cliques_sem_criar: 100 }, cliquesUltimaHora: 100 });
    await processarAcoes(prazo());
    expect(hoisted.zapbotFake.criarGrupo).not.toHaveBeenCalled();
    expect(finalDaAcao(travada)).toMatchObject({ status: "ok", erro: expect.stringMatching(/Cliques altos/) });
    montar({ camp: { limite_cliques_sem_criar: 100 }, cliquesUltimaHora: 99 });
    await processarAcoes(prazo());
    expect(hoisted.zapbotFake.criarGrupo).toHaveBeenCalledTimes(1);
  });

  it("botão manual cria mesmo com as travas ligadas", async () => {
    montar({ camp: { nao_criar_grupos: true }, origem: "manual" });
    await processarAcoes(prazo());
    expect(hoisted.zapbotFake.criarGrupo).toHaveBeenCalledTimes(1);
  });

  it("travas não valem pra retentativa de grupo já criado no WhatsApp", async () => {
    const cs = montar({ camp: { nao_criar_grupos: true }, dados: { groupId: "120@g.us", numero: 1, nome: "AULÃO #01" }, tentativas: 2 });
    await processarAcoes(prazo());
    expect(upsertGrupo(cs)).toMatchObject({ group_id: "120@g.us" });
    expect(finalDaAcao(cs)).toMatchObject({ status: "ok", erro: null });
  });

  it("modo seguro: conexão criou grupo há 3 min → volta pra fila até completar 10 min, sem gastar tentativa", async () => {
    const ultima = new Date(Date.now() - 3 * 60_000);
    const cs = montar({ camp: { modo_criacao: "seguro" }, ultimaCriacaoDaConta: ultima.toISOString(), tentativas: 2 });
    await processarAcoes(prazo());
    expect(hoisted.zapbotFake.criarGrupo).not.toHaveBeenCalled();
    expect(finalDaAcao(cs)).toEqual({ status: "fila", executar_apos: new Date(ultima.getTime() + 10 * 60_000).toISOString(), tentativas: 1, erro: null, dados: {} });
  });

  it("modo seguro: última criação há mais de 10 min → cria", async () => {
    montar({ camp: { modo_criacao: "seguro" }, ultimaCriacaoDaConta: new Date(Date.now() - 11 * 60_000).toISOString() });
    await processarAcoes(prazo());
    expect(hoisted.zapbotFake.criarGrupo).toHaveBeenCalledTimes(1);
  });

  it("modo normal não consulta a última criação da conexão", async () => {
    const cs = montar({ ultimaCriacaoDaConta: new Date().toISOString() });
    await processarAcoes(prazo());
    expect(hoisted.zapbotFake.criarGrupo).toHaveBeenCalledTimes(1);
    expect(cs.some((c) => c.tabela === "grupos" && filtro(c, "eq", "conexao_id"))).toBe(false);
  });
});

describe("criar grupo — administradores por número (Etapa 3K, Tarefa 1)", () => {
  const z = () => hoisted.zapbotFake.participantesComResultado;
  const chamadas = () => z().mock.calls.map((c) => [c[2], c[3]]);
  const textosAlertas = () => hoisted.alertarMock.mock.calls.map((c) => (c[0] as { tipo: string; texto: string })).map((a) => `${a.tipo}: ${a.texto}`);
  beforeEach(() => {
    z().mockReset();
    z().mockImplementation(async () => null);
  });

  it("depois de criar e promover as conexões, adiciona e promove os números de 5 em 5; participantes iniciais só contam as conexões", async () => {
    const numeros = Array.from({ length: 7 }, (_, i) => `551199999000${i}`);
    const cs = montar({ adminsNumeros: numeros });
    await processarAcoes(prazo());
    expect(chamadas()).toEqual([
      [numeros.slice(0, 5), "add"],
      [numeros.slice(0, 5), "promote"],
      [numeros.slice(5), "add"],
      [numeros.slice(5), "promote"],
    ]);
    // Grupo do teste não tem contas: criarGrupo continua só com as contas (nenhum número entra na criação).
    expect(hoisted.zapbotFake.criarGrupo).toHaveBeenCalledWith(expect.anything(), "AULÃO #01", []);
    expect(hoisted.zapbotFake.participantes).not.toHaveBeenCalled();
    expect(upsertGrupo(cs)).toMatchObject({ participantes: 1 });
    const dados = finalDaAcao(cs).dados as Record<string, unknown>;
    expect(finalDaAcao(cs)).toMatchObject({ status: "ok", erro: null });
    expect(dados.adminsNumeros).toBe(true);
    expect(dados.adminsNumerosFeitos).toBeUndefined();
    expect(hoisted.alertarMock).not.toHaveBeenCalled();
  });

  it("resposta 200 com um número que falhou no add: alerta só ele, não tenta promover ele, a criação segue", async () => {
    z().mockImplementation(async (...a: unknown[]) => {
      const tels = a[2] as string[];
      return a[3] === "add" ? tels.filter((t) => t !== "5511" + "999990002") : tels;
    });
    const cs = montar({ adminsNumeros: ["5511" + "999990001", "5511" + "999990002", "5511" + "999990003"] });
    expect(await processarAcoes(prazo())).toBe(1);
    expect(chamadas()).toEqual([
      [["5511" + "999990001", "5511" + "999990002", "5511" + "999990003"], "add"],
      [["5511" + "999990001", "5511" + "999990003"], "promote"],
    ]);
    expect(textosAlertas()).toEqual(["criacao_erro: Não foi possível tornar +55 •• •••• 0002 administrador do grupo AULÃO #01"]);
    expect(finalDaAcao(cs)).toMatchObject({ status: "ok", erro: null, dados: expect.objectContaining({ adminsNumeros: true, gatilhos: true, automacoes: true }) });
  });

  it("resposta 200 com um número que falhou no promote (resposta sem o nono dígito conexão como o mesmo número)", async () => {
    z().mockImplementation(async (...a: unknown[]) => (a[3] === "promote" ? ["551199990001"] : (a[2] as string[])));
    montar({ adminsNumeros: ["5511" + "999990001", "5511" + "999990002"] });
    await processarAcoes(prazo());
    expect(textosAlertas()).toEqual(["criacao_erro: Não foi possível tornar +55 •• •••• 0002 administrador do grupo AULÃO #01"]);
  });

  it("a chamada do lote falha: refaz número a número, alerta quem falhou e segue", async () => {
    z().mockImplementation(async (...a: unknown[]) => {
      const tels = a[2] as string[];
      if (tels.includes("5511" + "999990002")) throw new Error("não deu");
      return null;
    });
    const cs = montar({ adminsNumeros: ["5511" + "999990001", "5511" + "999990002", "5511" + "999990003"] });
    expect(await processarAcoes(prazo())).toBe(1);
    const promovidos = chamadas().filter(([, acao]) => acao === "promote").map(([t]) => t);
    expect(promovidos).toEqual([["5511" + "999990001", "5511" + "999990003"]]);
    expect(textosAlertas()).toEqual(["criacao_erro: Não foi possível tornar +55 •• •••• 0002 administrador do grupo AULÃO #01"]);
    expect(upsertGrupo(cs)).toBeTruthy();
    expect(finalDaAcao(cs)).toMatchObject({ status: "ok", erro: null });
  });

  it("prazo do tick acabando no meio: volta pra fila sem gastar tentativa e a retomada segue dos lotes feitos", async () => {
    const numeros = Array.from({ length: 7 }, (_, i) => `551199999000${i}`);
    let agora = Date.now();
    const espiao = vi.spyOn(Date, "now").mockImplementation(() => agora);
    const limite = { ate: agora + 60_000 };
    // Depois do 1º lote, o relógio pula pra perto do fim do prazo.
    z().mockImplementation(async (...a: unknown[]) => {
      if (a[3] === "promote") agora = limite.ate - 1000;
      return null;
    });
    const cs = montar({ adminsNumeros: numeros, tentativas: 2 });
    await processarAcoes(limite);
    espiao.mockRestore();
    const final = finalDaAcao(cs);
    expect(final).toMatchObject({ status: "fila", tentativas: 1, erro: null });
    expect((final.dados as Record<string, unknown>).adminsNumerosFeitos).toEqual(numeros.slice(0, 5));
    expect((final.dados as Record<string, unknown>).adminsNumeros).toBeUndefined();
    expect(chamadas()).toHaveLength(2);

    // Retomada: só o 2º lote, sem criar de novo.
    vi.clearAllMocks();
    z().mockImplementation(async () => null);
    const cs2 = montar({ adminsNumeros: numeros, dados: final.dados as Record<string, unknown>, tentativas: 2 });
    await processarAcoes(prazo());
    expect(hoisted.zapbotFake.criarGrupo).not.toHaveBeenCalled();
    expect(chamadas()).toEqual([
      [numeros.slice(5), "add"],
      [numeros.slice(5), "promote"],
    ]);
    expect(finalDaAcao(cs2)).toMatchObject({ status: "ok", dados: expect.objectContaining({ adminsNumeros: true }) });
    expect((finalDaAcao(cs2).dados as Record<string, unknown>).adminsNumerosFeitos).toBeUndefined();
  });

  it("retentativa com adminsNumeros já marcado não chama de novo", async () => {
    const dados = { groupId: "120@g.us", promovidos: true, configurado: true, link: "https://chat.whatsapp.com/X", numero: 1, nome: "AULÃO #01", adminsNumeros: true, gatilhos: true, automacoes: true };
    const cs = montar({ adminsNumeros: ["5511" + "999990001"], dados, tentativas: 2 });
    await processarAcoes(prazo());
    expect(z()).not.toHaveBeenCalled();
    expect(cs.some((c) => c.tabela === "campanha_admins_numeros")).toBe(false);
  });
});

describe("criar grupo — imagem do grupo (Etapa 3M, Tarefa 2)", () => {
  const IMAGEM = "https://exemplo.supabase.co/storage/v1/object/public/midias/c1/1760000000000-capa.png";
  const fotoNoBanco = (cs: Chamada[]) => cs.filter((c) => c.tabela === "grupos" && c.op === "update").map((c) => ({ dados: c.dados, id: filtro(c, "eq", "id") }));

  it("com imagem: troca a foto uma vez, antes da aprovação/temporárias, e grava foto_url no grupo salvo", async () => {
    const cs = montar({ camp: { imagem_grupo_url: IMAGEM, aprovacao_entrada: true } });
    expect(await processarAcoes(prazo())).toBe(1);
    expect(hoisted.zapbotFake.trocarFoto).toHaveBeenCalledTimes(1);
    expect(hoisted.zapbotFake.trocarFoto).toHaveBeenCalledWith(expect.anything(), "120@g.us", IMAGEM);
    expect(hoisted.zapbotFake.trocarFoto.mock.invocationCallOrder[0]).toBeLessThan(hoisted.zapbotFake.modoEntrada.mock.invocationCallOrder[0]);
    expect(fotoNoBanco(cs)).toEqual([{ dados: { foto_url: IMAGEM, foto_atualizada_em: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) }, id: "grupo-1" }]);
    expect(finalDaAcao(cs)).toMatchObject({ status: "ok", erro: null, dados: expect.objectContaining({ foto: true }) });
    expect(hoisted.alertarMock).not.toHaveBeenCalled();
  });

  it("falha da foto vira alerta e o grupo segue (salvo, ação ok, próximos passos rodam)", async () => {
    hoisted.zapbotFake.trocarFoto.mockRejectedValueOnce(new Error("group-picture 500"));
    const cs = montar({ camp: { imagem_grupo_url: IMAGEM, aprovacao_entrada: true } });
    expect(await processarAcoes(prazo())).toBe(1);
    expect(upsertGrupo(cs)).toBeTruthy();
    expect(hoisted.zapbotFake.modoEntrada).toHaveBeenCalledTimes(1);
    expect(fotoNoBanco(cs)).toEqual([]);
    expect(finalDaAcao(cs)).toMatchObject({ status: "ok", erro: null, dados: expect.objectContaining({ foto: true, aprovacao: true }) });
    const alertas = hoisted.alertarMock.mock.calls.map((c) => c[0] as { tipo: string; texto: string; conexaoId: string });
    expect(alertas).toEqual([expect.objectContaining({ tipo: "criacao_erro", conexaoId: "con1", texto: "Grupo AULÃO #01 criado, mas a foto não foi trocada: group-picture 500" })]);
  });

  it("imagem recusada pelo WhatsApp: o alerta diz a regra do lado mínimo, não a mensagem crua", async () => {
    hoisted.zapbotFake.trocarFoto.mockRejectedValueOnce(new Error("the given data is not a valid image"));
    const cs = montar({ camp: { imagem_grupo_url: IMAGEM } });
    expect(await processarAcoes(prazo())).toBe(1);
    expect(fotoNoBanco(cs)).toEqual([]);
    const textos = hoisted.alertarMock.mock.calls.map((c) => (c[0] as { texto: string }).texto);
    expect(textos).toEqual([expect.stringMatching(/^Grupo AULÃO #01 criado, mas a foto não foi trocada: O WhatsApp recusou a imagem.*192 × 192 px/)]);
  });

  it("retentativa com a foto já marcada não troca de novo", async () => {
    const dados = { groupId: "120@g.us", promovidos: true, configurado: true, link: "https://chat.whatsapp.com/X", numero: 1, nome: "AULÃO #01", foto: true, gatilhos: true, automacoes: true };
    montar({ camp: { imagem_grupo_url: IMAGEM }, dados, tentativas: 2 });
    await processarAcoes(prazo());
    expect(hoisted.zapbotFake.trocarFoto).not.toHaveBeenCalled();
  });

  it("imagem que não é https de host público (linha estragada) = sem foto, nenhuma chamada", async () => {
    for (const ruim of ["http://x/a.png", "https://127.0.0.1/a.png", ""]) {
      vi.clearAllMocks();
      montar({ camp: { imagem_grupo_url: ruim } });
      await processarAcoes(prazo());
      expect(hoisted.zapbotFake.trocarFoto).not.toHaveBeenCalled();
    }
  });
});

describe("criar grupo — contingência da conexão criadora", () => {
  it("criadora caída: a associada conectada cria o grupo, fica gravada e avisa", async () => {
    const cs = montar({ criadoraCaida: true, associadas: [{ id: "con2", nome: "Chip 2", status: "conectado", telefone: "5537" + "900000002" }] });
    await processarAcoes(prazo());
    expect(upsertGrupo(cs)).toMatchObject({ conexao_id: "con2" });
    expect(hoisted.zapbotFake.criarGrupo).toHaveBeenCalledWith(expect.objectContaining({ id: "con2" }), expect.anything(), []);
    expect((finalDaAcao(cs).dados as Record<string, unknown>).criadorId).toBe("con2");
    expect(hoisted.alertarMock).toHaveBeenCalledWith(expect.objectContaining({ tipo: "numero_caiu", conexaoId: "con2" }), expect.anything());
  });

  it("criadora caída e nenhuma associada conectada: não cria e a ação falha como antes", async () => {
    const cs = montar({ criadoraCaida: true, associadas: [{ id: "con2", nome: "Chip 2", status: "desconectado", telefone: "5537" + "900000002" }] });
    await processarAcoes(prazo());
    expect(hoisted.zapbotFake.criarGrupo).not.toHaveBeenCalled();
    expect(upsertGrupo(cs)).toBeUndefined();
  });
});
