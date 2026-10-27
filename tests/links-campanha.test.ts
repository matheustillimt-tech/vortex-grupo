import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, filtro, type Chamada, type Resposta } from "./apoio/db-falso";

const hoisted = vi.hoisted(() => ({
  dbAtual: undefined as unknown,
  dispararAutomacoesMock: vi.fn(async (..._a: unknown[]) => 0),
  alertarMock: vi.fn(async (_a: unknown, _db?: unknown) => undefined),
  statusMock: vi.fn(async (..._a: unknown[]) => ({ connected: true, phone: "" }) as { connected: boolean; phone: string }),
  obterGrupoMock: vi.fn(async (..._a: unknown[]) => null as unknown),
}));

vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => hoisted.dbAtual }));
vi.mock("@/src/lib/automacoes", () => ({ dispararAutomacoes: hoisted.dispararAutomacoesMock, dispararPorPessoas: vi.fn(async () => 0), telefonesProtegidos: async () => new Set<string>() }));
vi.mock("@/src/lib/jobs/alertas", () => ({ alertar: hoisted.alertarMock }));
vi.mock("@/src/lib/conexoes", () => ({ paraZapbot: (c: { id: string }) => ({ id: c.id, token: "t", clientToken: "c" }) }));
vi.mock("@/src/lib/zapbot/client", () => ({ zapbot: () => ({ status: hoisted.statusMock, obterGrupo: hoisted.obterGrupoMock }) }));

import { NextRequest } from "next/server";
import { GET } from "@/app/l/[slug]/route";
import { conferirGrupos } from "@/src/lib/jobs/conferir-grupos";
import { atualizarLinksPeriodicos, MINIMO_CAIDA_MS, pedirRedefinicaoAoEncher, RETENTAR_TROCA_MS, trocaDeDonoVencida, trocarDonoECorrigirLinks } from "@/src/lib/jobs/links";

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.statusMock.mockResolvedValue({ connected: true, phone: "" });
  hoisted.obterGrupoMock.mockResolvedValue(null);
});

const prazo = (ms = 60_000) => ({ ate: Date.now() + ms });
const alertas = () => hoisted.alertarMock.mock.calls.map((c) => c[0] as { tipo: string; texto: string; campanhaId: string | null; conexaoId?: string });
const execucoes = (cs: Chamada[]) => cs.filter((c) => c.tabela === "execucoes" && c.op === "insert").map((c) => c.dados as Record<string, unknown>);

describe("trocaDeDonoVencida (só conexão caída há 10 min, uma vez por queda)", () => {
  const agora = new Date("2026-10-17T12:00:00.000Z");
  const ha = (ms: number) => new Date(agora.getTime() - ms).toISOString();
  it("sem caiu_em (conexão antiga, desconectada à mão): nunca", () => {
    expect(trocaDeDonoVencida({ caiu_em: null }, agora)).toBe(false);
    expect(trocaDeDonoVencida({}, agora)).toBe(false);
  });
  it("caída há menos de 10 min (pode ser só oscilação): ainda não", () => {
    expect(MINIMO_CAIDA_MS).toBe(10 * 60_000);
    expect(trocaDeDonoVencida({ caiu_em: ha(9 * 60_000 + 59_000) }, agora)).toBe(false);
  });
  it("caída há 10 min ou mais e ainda não trocada nesta queda: sim", () => {
    expect(trocaDeDonoVencida({ caiu_em: ha(MINIMO_CAIDA_MS) }, agora)).toBe(true);
    expect(trocaDeDonoVencida({ caiu_em: ha(MINIMO_CAIDA_MS), grupos_trocados_em: ha(2 * 3_600_000) }, agora)).toBe(true);
  });
  it("já tentada nesta queda há menos de 10 min: ainda não repete", () => {
    expect(trocaDeDonoVencida({ caiu_em: ha(20 * 60_000), grupos_trocados_em: ha(5 * 60_000) }, agora)).toBe(false);
    expect(trocaDeDonoVencida({ caiu_em: ha(30 * 60_000), grupos_trocados_em: ha(RETENTAR_TROCA_MS - 1_000) }, agora)).toBe(false);
  });
  it("continua caída: tenta de novo a cada 10 min (chip reserva que entrou depois assume os grupos)", () => {
    expect(trocaDeDonoVencida({ caiu_em: ha(30 * 60_000), grupos_trocados_em: ha(RETENTAR_TROCA_MS) }, agora)).toBe(true);
    expect(trocaDeDonoVencida({ caiu_em: ha(3 * 3_600_000), grupos_trocados_em: ha(15 * 60_000) }, agora)).toBe(true);
  });
});

describe("trocarDonoECorrigirLinks (Atualização de links)", () => {
  const CAIDA = { id: "caida", nome: "Conexão A", status: "desconectado", caiu_em: "2026-10-17T11:40:00.000Z" };
  const RESERVA = { id: "reserva", nome: "Conexão B", status: "conectado", telefone: "5511" + "999990002", zapbot_id: "z", zapbot_token_enc: "t", client_token_enc: "c" };
  const GRUPO = { id: "g1", nome: "Turma 01", group_id: "120@g.us", campanha_id: "c1", campanhas: { nome: "Lançamento", conexao_criadora_id: "caida" } };

  function montar(o: {
    caida?: unknown;
    grupos?: unknown[];
    associadas?: string[];
    reservas?: unknown[];
    admins?: { grupo_id: string; telefone: string }[];
    troca?: Resposta;
    alertaJa?: boolean;
  } = {}) {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "conexoes" && filtro(c, "eq", "id") === "caida") return { data: o.caida === undefined ? CAIDA : o.caida };
      if (c.tabela === "conexoes") return { data: o.reservas ?? [RESERVA] };
      if (c.tabela === "grupos" && c.op === "select") return { data: o.grupos ?? [GRUPO] };
      if (c.tabela === "grupos" && c.op === "update") return o.troca ?? { data: [{ id: "g1" }] };
      if (c.tabela === "campanha_conexoes") return { data: (o.associadas ?? ["reserva"]).map((id) => ({ conexao_id: id })) };
      if (c.tabela === "participantes") return { data: o.admins ?? [{ grupo_id: "g1", telefone: "5511" + "999990002" }] };
      if (c.tabela === "alertas") return { data: o.alertaJa ? [{ id: "a" }] : [] };
      return {};
    });
    return { db, chamadas };
  }
  const agora = new Date("2026-10-17T12:00:30.000Z");
  const adminNoZapbot = () => hoisted.obterGrupoMock.mockResolvedValue({ groupId: "120@g.us", name: "Turma 01", amAdmin: true, participantCount: 3, participants: [] });

  it("só lê grupos ativos da conexão caída em campanhas com a seção ligada e não arquivadas", async () => {
    const { db, chamadas } = montar({ grupos: [] });
    expect(await trocarDonoECorrigirLinks("caida", prazo(), db, agora)).toEqual({ completo: true, movidos: 0 });
    const leitura = chamadas.find((c) => c.tabela === "grupos" && c.op === "select")!;
    expect(filtro(leitura, "eq", "conexao_id")).toBe("caida");
    expect(filtro(leitura, "eq", "ativo")).toBe(true);
    expect(filtro(leitura, "eq", "campanhas.atualizar_links_banimento")).toBe(true);
    expect(filtro(leitura, "eq", "campanhas.arquivada")).toBe(false);
  });

  it("regressão: nenhuma campanha com a seção ligada → nenhum grupo muda, nenhuma execução, nenhum alerta, nenhuma chamada ao Zapbot", async () => {
    const { db, chamadas } = montar({ grupos: [] });
    await trocarDonoECorrigirLinks("caida", prazo(), db, agora);
    expect(chamadas.some((c) => c.tabela === "grupos" && c.op === "update")).toBe(false);
    expect(execucoes(chamadas)).toEqual([]);
    expect(alertas()).toEqual([]);
    expect(hoisted.statusMock).not.toHaveBeenCalled();
    expect(hoisted.obterGrupoMock).not.toHaveBeenCalled();
  });

  it("conexão voltou (não está mais desconectada): nada muda", async () => {
    const { db, chamadas } = montar({ caida: { ...CAIDA, status: "conectado" } });
    expect(await trocarDonoECorrigirLinks("caida", prazo(), db, agora)).toEqual({ completo: true, movidos: 0 });
    expect(chamadas.some((c) => c.tabela === "grupos")).toBe(false);
  });

  it("reserva conectada (banco e Zapbot) e admin (banco e Zapbot): troca o dono, agenda UMA atualização dos links e alerta o que mudou", async () => {
    adminNoZapbot();
    const { db, chamadas } = montar();
    expect(await trocarDonoECorrigirLinks("caida", prazo(), db, agora)).toEqual({ completo: true, movidos: 1 });
    const reservas = chamadas.find((c) => c.tabela === "conexoes" && c.op === "select" && filtro(c, "in", "id"))!;
    expect(filtro(reservas, "eq", "status")).toBe("conectado");
    expect(filtro(reservas, "in", "id")).toEqual(["reserva"]); // a caída (criadora) nunca é reserva
    const troca = chamadas.find((c) => c.tabela === "grupos" && c.op === "update")!;
    expect(troca.dados).toEqual({ conexao_id: "reserva" });
    expect(filtro(troca, "eq", "conexao_id")).toBe("caida"); // não briga com outra troca
    expect(filtro(troca, "eq", "id")).toBe("g1");
    // A fila da conta caída para o grupo passa pra conta nova (só `fila`).
    const fila = chamadas.find((c) => c.tabela === "tarefas" && c.op === "update")!;
    expect(fila.dados).toEqual({ conexao_id: "reserva" });
    expect([filtro(fila, "eq", "grupo_id"), filtro(fila, "eq", "conexao_id"), filtro(fila, "eq", "status")]).toEqual(["g1", "caida", "fila"]);
    expect(execucoes(chamadas)).toEqual([{
      campanha_id: "c1", origem: "campanha", tipo: "atualizar_links", conteudo: {}, agendada_para: agora.toISOString(),
      alvo_grupos: ["g1"], gatilho_chave: "banimento:caida:2026-10-17T12:00:00.000Z",
    }]);
    expect(alertas()).toEqual([{
      tipo: "numero_caiu", campanhaId: "c1", conexaoId: "caida",
      texto: "1 grupo(s) da campanha Lançamento passaram da conexão Conexão A, que caiu, para outra conexão admin (Conexão B: 1); o link de cada um é atualizado pela conexão nova",
    }]);
  });

  it("admin pelo nono dígito: a lista do Zapbot confirma mesmo sem amAdmin", async () => {
    hoisted.obterGrupoMock.mockResolvedValue({ groupId: "120@g.us", name: "Turma 01", amAdmin: false, participantCount: 3, participants: [{ phone: "551199990002", isAdmin: true }] });
    const { db } = montar({ admins: [{ grupo_id: "g1", telefone: "551199990002" }] });
    expect((await trocarDonoECorrigirLinks("caida", prazo(), db, agora)).movidos).toBe(1);
  });

  it("reserva 'conectado' no banco mas desconectada no Zapbot agora: não troca e alerta sem reserva", async () => {
    adminNoZapbot();
    hoisted.statusMock.mockResolvedValue({ connected: false, phone: "" });
    const { db, chamadas } = montar();
    expect(await trocarDonoECorrigirLinks("caida", prazo(), db, agora)).toEqual({ completo: true, movidos: 0 });
    expect(chamadas.some((c) => c.tabela === "grupos" && c.op === "update")).toBe(false);
    expect(execucoes(chamadas)).toEqual([]);
    expect(alertas()).toEqual([{ tipo: "criacao_erro", campanhaId: "c1", conexaoId: "caida", texto: "1 grupos da campanha Lançamento ficaram sem conexão reserva para atualizar o link" }]);
  });

  it("reserva admin no banco, mas o Zapbot diz que não é admin agora: não troca", async () => {
    hoisted.obterGrupoMock.mockResolvedValue({ groupId: "120@g.us", name: "Turma 01", amAdmin: false, participantCount: 3, participants: [{ phone: "5511" + "999990002", isAdmin: false }] });
    const { db, chamadas } = montar();
    await trocarDonoECorrigirLinks("caida", prazo(), db, agora);
    expect(chamadas.some((c) => c.tabela === "grupos" && c.op === "update")).toBe(false);
    expect(alertas().map((a) => a.tipo)).toEqual(["criacao_erro"]);
  });

  it("reserva conectada mas não é admin no banco: nem pergunta ao Zapbot e não troca", async () => {
    const { db, chamadas } = montar({ admins: [] });
    await trocarDonoECorrigirLinks("caida", prazo(), db, agora);
    expect(hoisted.obterGrupoMock).not.toHaveBeenCalled();
    expect(chamadas.some((c) => c.tabela === "grupos" && c.op === "update")).toBe(false);
  });

  it("Zapbot falha ao ler o grupo: não troca (sem confirmação não mexe)", async () => {
    hoisted.obterGrupoMock.mockRejectedValue(new Error("timeout"));
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { db, chamadas } = montar();
    await trocarDonoECorrigirLinks("caida", prazo(), db, agora);
    erro.mockRestore();
    expect(chamadas.some((c) => c.tabela === "grupos" && c.op === "update")).toBe(false);
  });

  it("campanha sem outra conexão: alerta sem reserva (texto da seção), uma vez por queda", async () => {
    const { db } = montar({ associadas: [] });
    await trocarDonoECorrigirLinks("caida", prazo(), db, agora);
    expect(alertas()).toEqual([{ tipo: "criacao_erro", campanhaId: "c1", conexaoId: "caida", texto: "1 grupos da campanha Lançamento ficaram sem conexão reserva para atualizar o link" }]);
    vi.clearAllMocks();
    const segunda = montar({ associadas: [], alertaJa: true });
    await trocarDonoECorrigirLinks("caida", prazo(), segunda.db, agora);
    expect(alertas()).toEqual([]);
    const busca = segunda.chamadas.find((c) => c.tabela === "alertas")!;
    expect(filtro(busca, "gte", "created_at")).toBe(CAIDA.caiu_em);
    expect([filtro(busca, "eq", "tipo"), filtro(busca, "eq", "conexao_id"), filtro(busca, "eq", "campanha_id"), filtro(busca, "eq", "texto")]).toEqual(["criacao_erro", "caida", "c1", undefined]);
  });

  it("outra troca levou o grupo antes (update sem linha): sem execução nem alerta de troca", async () => {
    adminNoZapbot();
    const { db, chamadas } = montar({ troca: { data: [] } });
    expect((await trocarDonoECorrigirLinks("caida", prazo(), db, agora)).movidos).toBe(0);
    expect(execucoes(chamadas)).toEqual([]);
    expect(alertas()).toEqual([]);
  });

  it("execução já existe (23505): não alerta erro; outro erro: alerta que os links não foram agendados", async () => {
    adminNoZapbot();
    const dup = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "execucoes") return { error: { message: "dup", code: "23505" } };
      if (c.tabela === "conexoes" && filtro(c, "eq", "id") === "caida") return { data: CAIDA };
      if (c.tabela === "conexoes") return { data: [RESERVA] };
      if (c.tabela === "grupos" && c.op === "select") return { data: [GRUPO] };
      if (c.tabela === "grupos") return { data: [{ id: "g1" }] };
      if (c.tabela === "campanha_conexoes") return { data: [{ conexao_id: "reserva" }] };
      if (c.tabela === "participantes") return { data: [{ grupo_id: "g1", telefone: "5511" + "999990002" }] };
      return {};
    });
    await trocarDonoECorrigirLinks("caida", prazo(), dup.db, agora);
    expect(alertas().map((a) => a.tipo)).toEqual(["numero_caiu"]);
  });

  it("sem tempo no tick: para antes de começar e devolve completo false (o monitor continua depois)", async () => {
    const { db, chamadas } = montar();
    expect(await trocarDonoECorrigirLinks("caida", prazo(1_000), db, agora)).toEqual({ completo: false, movidos: 0 });
    expect(chamadas.some((c) => c.tabela === "grupos" && c.op === "update")).toBe(false);
  });

  it("falha no banco numa campanha: não lança, devolve completo false", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { db } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "conexoes") return { data: CAIDA };
      if (c.tabela === "grupos") return { data: [GRUPO] };
      if (c.tabela === "campanha_conexoes") return { error: { message: "fora do ar" } };
      return {};
    });
    await expect(trocarDonoECorrigirLinks("caida", prazo(), db, agora)).resolves.toEqual({ completo: false, movidos: 0 });
    erro.mockRestore();
  });
});

describe("atualizarLinksPeriodicos (Atualização periódica de links)", () => {
  const agora = new Date("2026-10-17T12:30:00.000Z");
  function montar(o: { vencidas?: unknown[]; tomada?: unknown[]; exec?: Resposta; rpc?: Resposta } = {}) {
    return dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "rpc:campanhas_links_vencidas") return o.rpc ?? { data: o.vencidas ?? [{ id: "c1", links_por_dia: 1, links_atualizados_em: null }] };
      if (c.tabela === "campanhas" && c.op === "update") return { data: o.tomada ?? [{ id: "c1" }] };
      if (c.tabela === "execucoes") return o.exec ?? {};
      return {};
    });
  }

  it("pede ao banco só as campanhas vencidas (filtro no banco: nenhuma campanha que não precisa ocupa a vez)", async () => {
    const { db, chamadas } = montar({ vencidas: [] });
    expect(await atualizarLinksPeriodicos(prazo(), db, agora)).toBe(0);
    expect(chamadas.map((c) => [c.tabela, c.dados])).toEqual([["rpc:campanhas_links_vencidas", { p_limite: 20 }]]);
    expect(execucoes(chamadas)).toEqual([]);
  });

  it("vencida: reivindica com update condicional e cria UMA execução atualizar_links de todos os grupos", async () => {
    const { db, chamadas } = montar();
    expect(await atualizarLinksPeriodicos(prazo(), db, agora)).toBe(1);
    const tomada = chamadas.find((c) => c.tabela === "campanhas" && c.op === "update")!;
    expect(tomada.dados).toEqual({ links_atualizados_em: agora.toISOString() });
    expect(filtro(tomada, "eq", "links_periodicos")).toBe(true);
    expect(filtro(tomada, "eq", "links_por_dia")).toBe(1);
    expect(tomada.filtros.find((f) => f[0] === "or")?.[1]).toBe("links_atualizados_em.is.null,links_atualizados_em.lte.2026-10-16T12:30:00.000Z");
    expect(execucoes(chamadas)).toEqual([{
      campanha_id: "c1", origem: "campanha", tipo: "atualizar_links", conteudo: {}, agendada_para: agora.toISOString(), alvo_grupos: null,
      gatilho_chave: "periodico:2026-10-17T12:00:00.000Z",
    }]);
  });

  it("24 por dia: a reivindicação usa o intervalo de 1 h", async () => {
    const { db, chamadas } = montar({ vencidas: [{ id: "c1", links_por_dia: 24, links_atualizados_em: "2026-10-17T11:20:00.000Z" }] });
    expect(await atualizarLinksPeriodicos(prazo(), db, agora)).toBe(1);
    const tomada = chamadas.find((c) => c.tabela === "campanhas" && c.op === "update")!;
    expect(tomada.filtros.find((f) => f[0] === "or")?.[1]).toBe("links_atualizados_em.is.null,links_atualizados_em.lte.2026-10-17T11:30:00.000Z");
  });

  it("dois ticks ao mesmo tempo: quem perde a reivindicação (update sem linha) não cria execução", async () => {
    const { db, chamadas } = montar({ tomada: [] });
    expect(await atualizarLinksPeriodicos(prazo(), db, agora)).toBe(0);
    expect(execucoes(chamadas)).toEqual([]);
  });

  it("mesma janela (índice único, 23505): não conexão e não é erro", async () => {
    const { db } = montar({ exec: { error: { message: "dup", code: "23505" } } });
    await expect(atualizarLinksPeriodicos(prazo(), db, agora)).resolves.toBe(0);
  });

  it("erro ao criar a execução: devolve a vez (só se a marca é a dele) e segue com as outras campanhas", async () => {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "rpc:campanhas_links_vencidas") return { data: [{ id: "c1", links_por_dia: 1, links_atualizados_em: null }, { id: "c2", links_por_dia: 1, links_atualizados_em: null }] };
      if (c.tabela === "campanhas" && c.op === "update") return { data: [{ id: filtro(c, "eq", "id") }] };
      if (c.tabela === "execucoes") return (c.dados as { campanha_id: string }).campanha_id === "c1" ? { error: { message: "fora do ar" } } : {};
      return {};
    });
    await expect(atualizarLinksPeriodicos(prazo(), db, agora)).rejects.toThrow(/campanha c1: execução: fora do ar \(1 criada/);
    const devolve = chamadas.filter((c) => c.tabela === "campanhas" && c.op === "update")[1];
    expect(devolve.dados).toEqual({ links_atualizados_em: null });
    expect(filtro(devolve, "eq", "links_atualizados_em")).toBe(agora.toISOString());
    expect(execucoes(chamadas).map((e) => e.campanha_id)).toEqual(["c1", "c2"]);
  });

  it("erro na RPC lança; sem tempo no tick, nem consulta", async () => {
    const ruim = montar({ rpc: { error: { message: "fora do ar" } } });
    await expect(atualizarLinksPeriodicos(prazo(), ruim.db, agora)).rejects.toThrow(/fora do ar/);
    const { db, chamadas } = montar();
    expect(await atualizarLinksPeriodicos(prazo(1_000), db, agora)).toBe(0);
    expect(chamadas).toEqual([]);
  });
});

describe("pedirRedefinicaoAoEncher", () => {
  it("UMA execução redefinir_link só do grupo, chave pelo conferido_em lido", async () => {
    const { db, chamadas } = dbFalso();
    await pedirRedefinicaoAoEncher(db, { campanhaId: "c1", grupoId: "g1", grupoNome: "Turma 01", conferidoEm: "2026-10-17T11:58:00+00:00" });
    const [e] = execucoes(chamadas);
    expect(e).toMatchObject({ campanha_id: "c1", origem: "campanha", tipo: "redefinir_link", conteudo: {}, alvo_grupos: ["g1"], gatilho_chave: "cheio:g1:2026-10-17T11:58:00.000Z" });
    await pedirRedefinicaoAoEncher(db, { campanhaId: "c1", grupoId: "g1", grupoNome: "Turma 01", conferidoEm: null });
    expect(execucoes(chamadas)[1].gatilho_chave).toBe("cheio:g1:nunca");
  });

  it("já pedida neste enchimento (23505): silêncio; outro erro: log + alerta, nunca lança", async () => {
    const dup = dbFalso(() => ({ error: { message: "dup", code: "23505" } }));
    await pedirRedefinicaoAoEncher(dup.db, { campanhaId: "c1", grupoId: "g1", grupoNome: "Turma 01", conferidoEm: null });
    expect(alertas()).toEqual([]);
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const ruim = dbFalso(() => ({ error: { message: "fora do ar" } }));
    await expect(pedirRedefinicaoAoEncher(ruim.db, { campanhaId: "c1", grupoId: "g1", grupoNome: "Turma 01", conferidoEm: null, conexaoId: "con1" })).resolves.toBeUndefined();
    erro.mockRestore();
    expect(alertas()).toEqual([{ tipo: "criacao_erro", campanhaId: "c1", conexaoId: "con1", texto: "Grupo Turma 01 encheu, mas a redefinição do link de convite não foi agendada: fora do ar" }]);
  });
});

describe("Redefinir link de convite: link público (/l/[slug])", () => {
  const grupo = { id: "g1", nome: "Turma 01", numero: 1, cheio: false, cheio_manual: null as boolean | null, ativo: true, link_convite: "https://chat.whatsapp.com/ABC", participantes: 10, conferido_em: "2026-10-17T11:58:00.000Z" };
  function montar(o: { ligada?: boolean; virou?: boolean; cheioManual?: boolean | null; exec?: Resposta } = {}) {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "campanhas") return { data: { id: "c1", limite_por_grupo: 10, arquivada: false, ...(o.ligada === undefined ? {} : { redefinir_link_cheio: o.ligada }) } };
      if (c.tabela === "grupos" && c.op === "update") return { data: o.virou === false ? [] : [{ id: "g1" }] };
      if (c.tabela === "grupos") return { data: [{ ...grupo, cheio_manual: o.cheioManual ?? null }] };
      if (c.tabela === "execucoes") return o.exec ?? {};
      return {};
    });
    hoisted.dbAtual = db;
    return chamadas;
  }
  const pedir = () => GET(new NextRequest("https://grupos.test/l/aulao", { headers: { "user-agent": "Safari" } }), { params: Promise.resolve({ slug: "aulao" }) });

  it("seção ligada e o clique virou o grupo pra cheio: agenda redefinir_link só desse grupo", async () => {
    const chamadas = montar({ ligada: true });
    const res = await pedir();
    expect(res.headers.get("location")).toBe("https://chat.whatsapp.com/ABC");
    expect(execucoes(chamadas)).toEqual([expect.objectContaining({ tipo: "redefinir_link", origem: "campanha", alvo_grupos: ["g1"], gatilho_chave: "cheio:g1:2026-10-17T11:58:00.000Z" })]);
  });

  it("regressão: seção desligada (ou coluna ausente) não cria execução", async () => {
    const desligada = montar({ ligada: false });
    await pedir();
    expect(execucoes(desligada)).toEqual([]);
    const semColuna = montar();
    await pedir();
    expect(execucoes(semColuna)).toEqual([]);
    expect(hoisted.dispararAutomacoesMock).toHaveBeenCalledTimes(2); // os dois viraram cheio (como antes)
    expect(alertas().map((a) => a.tipo)).toEqual(["grupo_cheio", "grupo_cheio"]);
  });

  it("outro clique já tinha virado: não redefine de novo", async () => {
    const chamadas = montar({ ligada: true, virou: false });
    await pedir();
    expect(execucoes(chamadas)).toEqual([]);
  });

  it("falha ao agendar: redireciona mesmo assim e alerta", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    montar({ ligada: true, exec: { error: { message: "fora do ar" } } });
    const res = await pedir();
    erro.mockRestore();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://chat.whatsapp.com/ABC");
    expect(alertas().map((a) => a.texto)).toContain("Grupo Turma 01 encheu, mas a redefinição do link de convite não foi agendada: fora do ar");
  });
});

describe("Redefinir link de convite: conferência", () => {
  function montar(o: { ligada?: boolean; cheioAntes?: boolean; cheioManual?: boolean | null }) {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "conexoes" && c.op === "select") return { data: [{ id: "con1", status: "conectado", proxima_conferencia_em: "2026-10-16T00:00:00.000Z" }] };
      if (c.tabela === "conexoes" && c.op === "update") return { data: [{ id: "con1" }] };
      if (c.tabela === "grupos" && c.op === "select") {
        return { data: [{
          id: "g1", campanha_id: "c1", group_id: "120@g.us", nome: "Turma 01", cheio: o.cheioAntes ?? false, cheio_manual: o.cheioManual ?? null, conferido_em: "2026-10-17T11:58:00.000Z",
          campanhas: { nome: "Camp", limite_por_grupo: 2, crm_webhook_url: null, slug: "aulao", ...(o.ligada === undefined ? {} : { redefinir_link_cheio: o.ligada }) },
        }] };
      }
      if (c.tabela === "participantes" && c.op === "select") return { data: [] };
      if (c.tabela === "tags") return { data: { id: "tag-saiu" } };
      return {};
    });
    hoisted.dbAtual = db;
    hoisted.obterGrupoMock.mockResolvedValue({ name: "Turma 01", participants: [{ phone: "5511" + "999990001", isAdmin: true }, { phone: "5511" + "999990002", isAdmin: false }] });
    return chamadas;
  }

  it("seção ligada e o grupo virou cheio: redefinir_link com a MESMA chave que o link usaria (conferido_em lido antes de gravar)", async () => {
    const chamadas = montar({ ligada: true });
    expect(await conferirGrupos(prazo())).toBe(1);
    expect(execucoes(chamadas)).toEqual([expect.objectContaining({ tipo: "redefinir_link", alvo_grupos: ["g1"], gatilho_chave: "cheio:g1:2026-10-17T11:58:00.000Z" })]);
  });

  it("regressão: seção desligada ou sem a coluna, nada novo", async () => {
    const desligada = montar({ ligada: false });
    await conferirGrupos(prazo());
    expect(execucoes(desligada)).toEqual([]);
    expect(hoisted.dispararAutomacoesMock).toHaveBeenCalledTimes(1); // chegou no "encheu" (alerta e automações como antes)
    const semColuna = montar({});
    await conferirGrupos(prazo());
    expect(execucoes(semColuna)).toEqual([]);
    expect(hoisted.dispararAutomacoesMock).toHaveBeenCalledTimes(2);
    expect(alertas().map((a) => a.tipo)).toEqual(["grupo_cheio", "grupo_cheio"]);
  });

  it("já estava cheio ou foi marcado à mão: não redefine", async () => {
    const cheio = montar({ ligada: true, cheioAntes: true });
    await conferirGrupos(prazo());
    expect(execucoes(cheio)).toEqual([]);
    const manual = montar({ ligada: true, cheioManual: true });
    await conferirGrupos(prazo());
    expect(execucoes(manual)).toEqual([]);
  });
});

describe("troca de dono: fila e reservas", () => {
  it("sem troca (outra troca levou o grupo), a fila não é mexida; tarefas em erro/processando nunca", async () => {
    hoisted.obterGrupoMock.mockResolvedValue({ groupId: "120@g.us", name: "Turma 01", amAdmin: true, participantCount: 3, participants: [] });
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "conexoes" && filtro(c, "eq", "id") === "caida") return { data: { id: "caida", nome: "Conexão A", status: "desconectado", caiu_em: null } };
      if (c.tabela === "conexoes") return { data: [{ id: "reserva", nome: "Conexão B", status: "conectado", telefone: "5511" + "999990002" }] };
      if (c.tabela === "grupos" && c.op === "select") return { data: [{ id: "g1", nome: "T", group_id: "120@g.us", campanha_id: "c1", campanhas: { nome: "L", conexao_criadora_id: null } }] };
      if (c.tabela === "grupos") return { data: [] };
      if (c.tabela === "campanha_conexoes") return { data: [{ conexao_id: "reserva" }] };
      if (c.tabela === "participantes") return { data: [{ grupo_id: "g1", telefone: "5511" + "999990002" }] };
      return {};
    });
    await trocarDonoECorrigirLinks("caida", prazo(), db, new Date());
    expect(chamadas.some((c) => c.tabela === "tarefas")).toBe(false);
  });

  it("falha ao passar a fila: a troca vale e o alerta avisa", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    hoisted.obterGrupoMock.mockResolvedValue({ groupId: "120@g.us", name: "Turma 01", amAdmin: true, participantCount: 3, participants: [] });
    const { db } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "conexoes" && filtro(c, "eq", "id") === "caida") return { data: { id: "caida", nome: "Conexão A", status: "desconectado", caiu_em: null } };
      if (c.tabela === "conexoes") return { data: [{ id: "reserva", nome: "Conexão B", status: "conectado", telefone: "5511" + "999990002" }] };
      if (c.tabela === "grupos" && c.op === "select") return { data: [{ id: "g1", nome: "T", group_id: "120@g.us", campanha_id: "c1", campanhas: { nome: "L", conexao_criadora_id: null } }] };
      if (c.tabela === "grupos") return { data: [{ id: "g1" }] };
      if (c.tabela === "tarefas") return { error: { message: "fora do ar" } };
      if (c.tabela === "campanha_conexoes") return { data: [{ conexao_id: "reserva" }] };
      if (c.tabela === "participantes") return { data: [{ grupo_id: "g1", telefone: "5511" + "999990002" }] };
      return {};
    });
    expect((await trocarDonoECorrigirLinks("caida", prazo(), db, new Date())).movidos).toBe(1);
    erro.mockRestore();
    expect(alertas()[0].texto).toMatch(/1 grupo\(s\) ficaram com envios na fila da conexão caída/);
  });
});
