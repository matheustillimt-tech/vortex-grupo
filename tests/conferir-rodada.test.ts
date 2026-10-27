import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, filtro, type Chamada, type Resposta } from "./apoio/db-falso";

const hoisted = vi.hoisted(() => ({
  dbAtual: undefined as unknown,
  dispararPorPessoasMock: vi.fn(async (..._a: unknown[]) => 0),
  telefonesProtegidosMock: vi.fn(async (..._a: unknown[]) => new Set<string>()),
  alertarMock: vi.fn(async (_a: unknown, _db?: unknown) => undefined),
  obterGrupoMock: vi.fn(async (..._a: unknown[]) => null as unknown),
  fotoDoGrupoMock: vi.fn(async (..._a: unknown[]) => null as unknown),
  pedidosPendentesMock: vi.fn(async (..._a: unknown[]) => [] as unknown),
  revisarPedidosMock: vi.fn(async (..._a: unknown[]) => null as unknown),
}));

vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => hoisted.dbAtual }));
vi.mock("@/src/lib/automacoes", () => ({
  dispararAutomacoes: vi.fn(async () => 0),
  dispararPorPessoas: hoisted.dispararPorPessoasMock,
  telefonesProtegidos: hoisted.telefonesProtegidosMock,
}));
vi.mock("@/src/lib/jobs/alertas", () => ({ alertar: hoisted.alertarMock }));
vi.mock("@/src/lib/conexoes", () => ({ paraZapbot: (c: { id: string }) => ({ id: c.id, token: "t", clientToken: "c" }) }));
vi.mock("@/src/lib/zapbot/client", () => ({
  zapbot: () => ({ obterGrupo: hoisted.obterGrupoMock, fotoDoGrupo: hoisted.fotoDoGrupoMock, pedidosPendentes: hoisted.pedidosPendentesMock, revisarPedidos: hoisted.revisarPedidosMock }),
}));

import { conferirGrupos } from "@/src/lib/jobs/conferir-grupos";

const NOSSO = "5511" + "999990000";
const BLOQ = "5511" + "900000066";
const prazo = () => ({ ate: Date.now() + 60_000 });

type Opcoes = {
  abertos: { telefone: string; admin: boolean }[];
  membros: { phone: string; isAdmin: boolean }[];
  bloqueados?: string[];
  pendentes?: string[];
  emOutroGrupo?: string[];
  crm?: string | null;
  webhooksCadastrados?: { id: string; url: string; eventos: string[]; campanhas: string[] | null; ativo: boolean; arquivado: boolean }[];
  leituraSuspeitaDesde?: string | null;
  /** Quantas leituras de bloqueados falham (a partir da primeira). */
  falharBloqueados?: number;
  /** Ids dos grupos da conexão (todos com a mesma leitura). */
  grupos?: string[];
  /** `campanhas.checar_duplicados` (Etapa 3J); sem passar, a linha não traz a coluna (como antes da migração). */
  checarDuplicados?: boolean;
  /** Outras colunas das seções da campanha (Etapa 3J, Tarefa 2): tags e campanhas anteriores. */
  secoes?: Record<string, unknown>;
  /** Participações abertas devolvidas pela consulta das campanhas anteriores. */
  emAnteriores?: { telefone: string; grupo_id: string; campanha_id: string }[];
  /** `grupos.foto_url` (Etapa 3M); sem passar, a linha não traz a coluna (como antes da migração). */
  fotoNoBanco?: string | null;
  /** `grupos.foto_atualizada_em` / `grupos.foto_conferida_em` (Etapa 3M); sem passar, a linha não traz a coluna. */
  fotoAtualizadaEm?: string | null;
  fotoConferidaEm?: string | null;
  /** `avatarUrl` na leitura do grupo; sem passar, a chave não vem (grupo sem foto). */
  avatarUrl?: string | null;
  /** `requireApproval` na leitura do grupo (Etapa 3M, Tarefa 4); sem passar, a chave não vem. */
  requireApproval?: boolean;
  /** Colunas extras da linha do grupo (Etapa 3N: `pendentes_reservados`, `pendentes_lidos_em`). */
  grupoExtra?: Record<string, unknown>;
  /** `limite_por_grupo` da campanha (padrão 1000). */
  limite?: number;
  /** Campanha de cada grupo (padrão "c1" pra todos). */
  campanhaPorGrupo?: Record<string, string>;
  /** Resposta do `select` de `solicitacoes_vistas` (leitura de um grupo: `eq grupo_id`; expiração: `lt ultimo_visto_em`). */
  vistos?: (c: Chamada) => Resposta | undefined;
};

function montar(o: Opcoes) {
  let falhas = o.falharBloqueados ?? 0;
  const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
    if (c.tabela === "conexoes" && c.op === "select") return { data: [{ id: "con1", status: "conectado", telefone: NOSSO, proxima_conferencia_em: "2026-10-16T00:00:00.000Z" }] };
    if (c.tabela === "conexoes" && c.op === "update") return { data: [{ id: "con1" }] };
    if (c.tabela === "grupos" && c.op === "select") {
      return {
        data: (o.grupos ?? ["g1"]).map((id) => ({ id, campanha_id: o.campanhaPorGrupo?.[id] ?? "c1", group_id: `${id}@g.us`, nome: "Turma 01", cheio: false, conferido_em: null, leitura_suspeita_desde: o.leituraSuspeitaDesde ?? null, ...(o.fotoNoBanco === undefined ? {} : { foto_url: o.fotoNoBanco }), ...(o.fotoAtualizadaEm === undefined ? {} : { foto_atualizada_em: o.fotoAtualizadaEm }), ...(o.fotoConferidaEm === undefined ? {} : { foto_conferida_em: o.fotoConferidaEm }), ...(o.grupoExtra ?? {}), campanhas: { nome: "Camp", limite_por_grupo: o.limite ?? 1000, crm_webhook_url: o.crm ?? null, slug: "aulao", ...(o.checarDuplicados === undefined ? {} : { checar_duplicados: o.checarDuplicados }), ...(o.secoes ?? {}) } })),
      };
    }
    if (c.tabela === "participantes" && c.op === "select") {
      if (filtro(c, "eq", "grupos.campanha_id")) return { data: (o.emOutroGrupo ?? []).map((telefone) => ({ telefone, grupo_id: "g2" })) };
      if (filtro(c, "in", "grupos.campanha_id")) return { data: (o.emAnteriores ?? []).map((x) => ({ telefone: x.telefone, grupo_id: x.grupo_id, grupos: { campanha_id: x.campanha_id, ativo: true } })) };
      return { data: o.abertos };
    }
    if (c.tabela === "bloqueados_efetivos") return falhas-- > 0 ? { error: { message: "caiu" } } : { data: (o.bloqueados ?? []).map((telefone) => ({ telefone })) };
    if (c.tabela === "acoes" && c.op === "select") return { data: (o.pendentes ?? []).map((telefone) => ({ telefone })) };
    if (c.tabela === "tags") return { data: { id: "tag-saiu" } };
    if (c.tabela === "rpc:tag_da_campanha") return { data: "tag-camp" };
    if (c.tabela === "webhooks" && c.op === "select") return { data: o.webhooksCadastrados ?? [] };
    if (c.tabela === "solicitacoes_vistas" && c.op === "select" && o.vistos) return o.vistos(c) ?? {};
    return {};
  });
  hoisted.dbAtual = db;
  hoisted.obterGrupoMock.mockResolvedValue({
    name: "Turma 01",
    participants: o.membros,
    ...(o.avatarUrl === undefined ? {} : { avatarUrl: o.avatarUrl }),
    ...(o.requireApproval === undefined ? {} : { requireApproval: o.requireApproval }),
  });
  return chamadas;
}

const remocoes = (cs: Chamada[]) => cs.filter((c) => c.tabela === "acoes" && c.op === "insert").map((c) => c.dados as { telefone: string; origem: string });
const disparos = () => hoisted.dispararPorPessoasMock.mock.calls.map((c) => c[0] as { gatilho: string; telefones: string[] });
const pessoa = (phone: string) => ({ phone, isAdmin: false });
const aberto = (telefone: string, admin = false) => ({ telefone, admin });

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.dispararPorPessoasMock.mockResolvedValue(0);
  hoisted.telefonesProtegidosMock.mockResolvedValue(new Set());
  hoisted.pedidosPendentesMock.mockResolvedValue([]);
  hoisted.revisarPedidosMock.mockResolvedValue(null);
});

describe("conferirGrupos: bloqueio, duplicado e tags da rodada", () => {
  it("bloqueado que entra: grava a entrada, enfileira a remoção, alerta e não dispara 'entrou' pra ele", async () => {
    const chamadas = montar({ abertos: [aberto(NOSSO, true)], membros: [{ phone: NOSSO, isAdmin: true }, pessoa(BLOQ), pessoa("5511" + "900000001")], bloqueados: [BLOQ] });
    expect(await conferirGrupos(prazo())).toBe(1);
    expect(remocoes(chamadas)).toEqual([expect.objectContaining({ telefone: BLOQ, origem: "bloqueado", grupo_id: "g1", campanha_id: "c1" })]);
    const entrada = chamadas.find((c) => c.tabela === "participantes" && c.op === "insert")!.dados as { telefone: string }[];
    expect(entrada.map((e) => e.telefone)).toEqual([BLOQ, "5511" + "900000001"]);
    expect(disparos()).toEqual([expect.objectContaining({ gatilho: "entrou", telefones: ["5511" + "900000001"] })]);
    expect(hoisted.alertarMock.mock.calls.map((c) => (c[0] as { tipo: string }).tipo)).toEqual(["bloqueado_removido"]);
  });

  it("duplicado (aberto em outro grupo da campanha): remoção na fila sem alerta e sem 'entrou'", async () => {
    const chamadas = montar({ abertos: [aberto(NOSSO, true)], membros: [{ phone: NOSSO, isAdmin: true }, pessoa("5511" + "900000001")], emOutroGrupo: ["5511" + "900000001"] });
    await conferirGrupos(prazo());
    expect(remocoes(chamadas)).toEqual([expect.objectContaining({ telefone: "5511" + "900000001", origem: "duplicado" })]);
    expect(disparos()).toEqual([]);
    expect(hoisted.alertarMock).not.toHaveBeenCalled();
  });

  it("número conectado no sistema que entra não é checado nem removido", async () => {
    hoisted.telefonesProtegidosMock.mockResolvedValue(new Set(["5511" + "977770000", "551177770000"]));
    const chamadas = montar({ abertos: [aberto(NOSSO, true)], membros: [{ phone: NOSSO, isAdmin: true }, pessoa("551177770000")], bloqueados: ["551177770000"] });
    await conferirGrupos(prazo());
    expect(remocoes(chamadas)).toEqual([]);
    expect(chamadas.some((c) => c.tabela === "bloqueados_efetivos")).toBe(false);
  });

  it("saída com remoção pendente fica aberta; só quem saiu sozinho fecha com motivo, dispara 'saiu' e vai pro CRM", async () => {
    const chamadas = montar({
      abertos: [aberto(NOSSO, true), aberto("5511" + "900000001"), aberto(BLOQ)],
      membros: [{ phone: NOSSO, isAdmin: true }],
      pendentes: [BLOQ],
      crm: "https://crm.test/hook",
    });
    await conferirGrupos(prazo());
    const saida = chamadas.filter((c) => c.tabela === "participantes" && c.op === "update");
    expect(saida).toHaveLength(1);
    expect(saida[0].dados).toMatchObject({ motivo_saida: "sozinho" });
    expect(filtro(saida[0], "in", "telefone")).toEqual(["5511" + "900000001"]);
    expect(disparos()).toEqual([expect.objectContaining({ gatilho: "saiu", telefones: ["5511" + "900000001"] })]);
    const crm = chamadas.find((c) => c.tabela === "eventos_saida")!.dados as { payload: { evento: string; telefone: string } }[];
    expect(crm.map((e) => [e.payload.evento, e.payload.telefone])).toEqual([["saiu", "5511" + "900000001"]]);
    const porTag = chamadas.filter((c) => c.tabela === "rpc:por_tag").map((c) => c.dados);
    expect(porTag).toEqual([{ p_telefones: ["5511" + "900000001"], p_tag: "tag-saiu", p_campanha: "c1" }]);
  });

  it("webhook cadastrado de 'todas as campanhas' recebe entrou/saiu mesmo sem crm_webhook_url na campanha", async () => {
    const chamadas = montar({
      abertos: [aberto(NOSSO, true), aberto("5511" + "900000001")],
      membros: [{ phone: NOSSO, isAdmin: true }, pessoa("5511" + "900000002")],
      webhooksCadastrados: [{ id: "w1", url: "https://hook.test/w1", eventos: ["entrou", "saiu"], campanhas: null, ativo: true, arquivado: false }],
    });
    await conferirGrupos(prazo());
    const linhas = chamadas.filter((c) => c.tabela === "eventos_saida").flatMap((c) => c.dados as { webhook_id?: string; url: string; payload: { evento: string; telefone: string } }[]);
    expect(linhas.map((l) => [l.webhook_id, l.payload.evento, l.payload.telefone]).sort()).toEqual([
      ["w1", "entrou", "5511" + "900000002"],
      ["w1", "saiu", "5511" + "900000001"],
    ]);
  });

  it("webhook cadastrado restrito a outra campanha não casa", async () => {
    const chamadas = montar({
      abertos: [aberto(NOSSO, true), aberto("5511" + "900000001")],
      membros: [{ phone: NOSSO, isAdmin: true }, pessoa("5511" + "900000002")],
      webhooksCadastrados: [{ id: "w1", url: "https://hook.test/w1", eventos: ["entrou"], campanhas: ["outra-campanha"], ativo: true, arquivado: false }],
    });
    await conferirGrupos(prazo());
    expect(chamadas.some((c) => c.tabela === "eventos_saida")).toBe(false);
  });

  it("vários entrou/saiu no mesmo grupo enfileiram num insert só (não um por telefone)", async () => {
    const chamadas = montar({
      abertos: [aberto(NOSSO, true), aberto("5511" + "900000010"), aberto("5511" + "900000011")],
      membros: [{ phone: NOSSO, isAdmin: true }, pessoa("5511" + "900000001"), pessoa("5511" + "900000002")],
      crm: "https://crm.test/hook",
    });
    await conferirGrupos(prazo());
    const inserts = chamadas.filter((c) => c.tabela === "eventos_saida");
    expect(inserts).toHaveLength(1); // entrou (duas pessoas) + saiu (duas pessoas) num insert só
    const linhas = inserts[0].dados as { payload: { evento: string; telefone: string } }[];
    expect(linhas.map((l) => [l.payload.evento, l.payload.telefone]).sort()).toEqual([
      ["entrou", "5511" + "900000001"],
      ["entrou", "5511" + "900000002"],
      ["saiu", "5511" + "900000010"],
      ["saiu", "5511" + "900000011"],
    ]);
  });

  it("CRM: bloqueado e duplicado que entram não viram evento 'entrou'", async () => {
    const chamadas = montar({
      abertos: [aberto(NOSSO, true)],
      membros: [{ phone: NOSSO, isAdmin: true }, pessoa(BLOQ), pessoa("5511" + "900000002"), pessoa("5511" + "900000003")],
      bloqueados: [BLOQ],
      emOutroGrupo: ["5511" + "900000002"],
      crm: "https://crm.test/hook",
    });
    await conferirGrupos(prazo());
    const crm = chamadas.find((c) => c.tabela === "eventos_saida")!.dados as { payload: { evento: string; telefone: string } }[];
    expect(crm.map((e) => [e.payload.evento, e.payload.telefone])).toEqual([["entrou", "5511" + "900000003"]]);
  });

  it("leitura estranha ignorada: não trata a rodada (nem remoção, nem tag)", async () => {
    const chamadas = montar({ abertos: [aberto(NOSSO, true), aberto("5511" + "900000001")], membros: [pessoa(BLOQ)], bloqueados: [BLOQ] });
    await conferirGrupos(prazo());
    expect(chamadas.some((c) => ["acoes", "bloqueados_efetivos", "tags"].includes(c.tabela) || c.tabela.startsWith("rpc:"))).toBe(false);
  });

  it("entrada em massa (sem automações de pessoas): remove bloqueado, mantém duplicado e alerta quantos ficaram", async () => {
    const velhos = Array.from({ length: 10 }, (_, i) => aberto(`55119000100${String(i).padStart(2, "0")}`));
    const novos = Array.from({ length: 12 }, (_, i) => pessoa(`55119000200${String(i).padStart(2, "0")}`));
    const chamadas = montar({
      abertos: [aberto(NOSSO, true), ...velhos],
      membros: [{ phone: NOSSO, isAdmin: true }, ...velhos.map((m) => pessoa(m.telefone)), ...novos, pessoa(BLOQ)],
      bloqueados: [BLOQ],
      emOutroGrupo: [novos[0].phone],
    });
    await conferirGrupos(prazo());
    expect(disparos()).toEqual([]);
    expect(remocoes(chamadas)).toEqual([expect.objectContaining({ telefone: BLOQ, origem: "bloqueado" })]);
    const textos = hoisted.alertarMock.mock.calls.map((c) => (c[0] as { texto: string }).texto);
    expect(textos.filter((t) => /1 duplicado não foi removido/.test(t))).toHaveLength(1);
  });

  it("leitura estranha aceita: também não remove duplicado", async () => {
    const velhos = Array.from({ length: 19 }, (_, i) => aberto(`55119000100${String(i).padStart(2, "0")}`));
    const chamadas = montar({
      abertos: [aberto(NOSSO, true), ...velhos],
      membros: [{ phone: NOSSO, isAdmin: true }, ...velhos.slice(0, 4).map((m) => pessoa(m.telefone)), pessoa("5511" + "900000001")],
      emOutroGrupo: ["5511" + "900000001"],
      leituraSuspeitaDesde: new Date(Date.now() - 11 * 60_000).toISOString(),
    });
    await conferirGrupos(prazo());
    expect(remocoes(chamadas)).toEqual([]);
    expect(chamadas.some((c) => c.tabela === "participantes" && c.op === "update")).toBe(true);
  });

  it("remoção de bloqueado/duplicado vence 60 s depois da rodada", async () => {
    const chamadas = montar({ abertos: [aberto(NOSSO, true)], membros: [{ phone: NOSSO, isAdmin: true }, pessoa(BLOQ)], bloqueados: [BLOQ] });
    await conferirGrupos(prazo());
    const entrada = chamadas.find((c) => c.tabela === "participantes" && c.op === "insert")!.dados as { entrou_em: string }[];
    const r = remocoes(chamadas)[0] as unknown as { executar_apos: string };
    expect(Date.parse(r.executar_apos) - Date.parse(entrada[0].entrou_em)).toBe(60_000);
  });

  it("rodada sem mudança não lê os números conectados", async () => {
    montar({ abertos: [aberto(NOSSO, true), aberto("5511" + "900000001")], membros: [{ phone: NOSSO, isAdmin: true }, pessoa("5511" + "900000001")] });
    await conferirGrupos(prazo());
    expect(hoisted.telefonesProtegidosMock).not.toHaveBeenCalled();
  });

  it("falha num grupo não para os outros: registra o erro, pula as escritas dele e segue", async () => {
    const chamadas = montar({ grupos: ["g1", "g2"], abertos: [aberto(NOSSO, true)], membros: [{ phone: NOSSO, isAdmin: true }, pessoa("5511" + "900000001")], falharBloqueados: 1 });
    expect(await conferirGrupos(prazo())).toBe(1);
    const escritas = chamadas.filter((c) => c.tabela === "participantes" && c.op === "insert").map((c) => (c.dados as { grupo_id: string }[])[0].grupo_id);
    expect(escritas).toEqual(["g2"]);
    const grupos = chamadas.filter((c) => c.tabela === "grupos" && c.op === "update").map((c) => filtro(c, "eq", "id"));
    expect(grupos).toEqual(["g2"]);
    const erro = chamadas.find((c) => c.tabela === "conexoes" && c.op === "update" && (c.dados as { ultimo_erro?: string }).ultimo_erro);
    expect((erro!.dados as { ultimo_erro: string }).ultimo_erro).toMatch(/Turma 01.*caiu/);
  });

  it("falha ao tratar a rodada: nada do grupo é gravado e o erro vai pra conexão", async () => {
    const chamadas = montar({ abertos: [aberto(NOSSO, true)], membros: [{ phone: NOSSO, isAdmin: true }, pessoa("5511" + "900000001")], falharBloqueados: 1 });
    await conferirGrupos(prazo());
    expect(chamadas.some((c) => (c.tabela === "participantes" || c.tabela === "grupos") && c.op !== "select")).toBe(false);
    expect(disparos()).toEqual([]);
    const erro = chamadas.find((c) => c.tabela === "conexoes" && c.op === "update" && (c.dados as { ultimo_erro?: string }).ultimo_erro);
    expect((erro!.dados as { ultimo_erro: string }).ultimo_erro).toMatch(/caiu/);
  });
});

describe("conferirGrupos: seção Checar participantes duplicados (Etapa 3J)", () => {
  it("desligada: duplicado fica no grupo, entra como 'entrou' e não gera alerta", async () => {
    const chamadas = montar({ abertos: [aberto(NOSSO, true)], membros: [{ phone: NOSSO, isAdmin: true }, pessoa("5511" + "900000001")], emOutroGrupo: ["5511" + "900000001"], checarDuplicados: false });
    await conferirGrupos(prazo());
    expect(remocoes(chamadas)).toEqual([]);
    expect(disparos()).toEqual([expect.objectContaining({ gatilho: "entrou", telefones: ["5511" + "900000001"] })]);
    expect(hoisted.alertarMock).not.toHaveBeenCalled();
  });

  it("ligada (true): remove o duplicado como sempre", async () => {
    const chamadas = montar({ abertos: [aberto(NOSSO, true)], membros: [{ phone: NOSSO, isAdmin: true }, pessoa("5511" + "900000001")], emOutroGrupo: ["5511" + "900000001"], checarDuplicados: true });
    await conferirGrupos(prazo());
    expect(remocoes(chamadas)).toEqual([expect.objectContaining({ telefone: "5511" + "900000001", origem: "duplicado" })]);
  });
});

describe("conferirGrupos: Gerenciamento de Tags (Etapa 3J)", () => {
  const TAGS = { tag_entrou_adicionar: "t-entrou-add", tag_entrou_remover: "t-entrou-rem", tag_saiu_adicionar: "t-saiu-add", tag_saiu_remover: "t-saiu-rem" };
  const rpcs = (cs: Chamada[], nome: string) => cs.filter((c) => c.tabela === `rpc:${nome}`).map((c) => c.dados);
  const rodadaEntraESai = (secoes: Record<string, unknown>) =>
    montar({
      abertos: [aberto(NOSSO, true), aberto("5511" + "900000010")],
      membros: [{ phone: NOSSO, isAdmin: true }, pessoa("5511" + "900000001")],
      secoes,
    });

  it("ligada: quem entra ganha/perde as tags de entrar e quem sai as de sair (sem campanha), além das automáticas", async () => {
    const chamadas = rodadaEntraESai({ tags_ativo: true, ...TAGS });
    await conferirGrupos(prazo());
    expect(rpcs(chamadas, "por_tag")).toEqual([
      { p_telefones: ["5511" + "900000001"], p_tag: "tag-camp", p_campanha: null },
      { p_telefones: ["5511" + "900000010"], p_tag: "tag-saiu", p_campanha: "c1" },
      { p_telefones: ["5511" + "900000001"], p_tag: "t-entrou-add", p_campanha: null },
      { p_telefones: ["5511" + "900000010"], p_tag: "t-saiu-add", p_campanha: null },
    ]);
    expect(rpcs(chamadas, "tirar_tag")).toEqual([
      { p_telefones: ["5511" + "900000001"], p_tag: "tag-saiu", p_campanha: "c1" },
      { p_telefones: ["5511" + "900000001"], p_tag: "t-entrou-rem", p_campanha: null },
      { p_telefones: ["5511" + "900000010"], p_tag: "t-saiu-rem", p_campanha: null },
    ]);
  });

  it("desligada (com tags escolhidas): só as automáticas, como sempre", async () => {
    const chamadas = rodadaEntraESai({ tags_ativo: false, ...TAGS });
    await conferirGrupos(prazo());
    const tags = [...rpcs(chamadas, "por_tag"), ...rpcs(chamadas, "tirar_tag")].map((d) => (d as { p_tag: string }).p_tag);
    expect(tags.sort()).toEqual(["tag-camp", "tag-saiu", "tag-saiu"]);
  });

  it("sem as colunas (antes da migração): igual a hoje", async () => {
    const chamadas = rodadaEntraESai({});
    await conferirGrupos(prazo());
    expect(rpcs(chamadas, "por_tag")).toHaveLength(2);
    expect(rpcs(chamadas, "tirar_tag")).toHaveLength(1);
  });

  it("tag apagada (null) é pulada; as outras continuam", async () => {
    const chamadas = rodadaEntraESai({ tags_ativo: true, ...TAGS, tag_entrou_adicionar: null, tag_saiu_remover: null });
    await conferirGrupos(prazo());
    const tags = [...rpcs(chamadas, "por_tag"), ...rpcs(chamadas, "tirar_tag")].map((d) => (d as { p_tag: string }).p_tag);
    expect(tags).not.toContain("t-entrou-add");
    expect(tags).not.toContain("t-saiu-rem");
    expect(tags).toEqual(expect.arrayContaining(["t-entrou-rem", "t-saiu-add"]));
  });

  it("bloqueado e admin que entram não ganham as tags da seção", async () => {
    const chamadas = montar({
      abertos: [aberto(NOSSO, true)],
      membros: [{ phone: NOSSO, isAdmin: true }, pessoa(BLOQ), { phone: "5511" + "900000002", isAdmin: true }],
      bloqueados: [BLOQ],
      secoes: { tags_ativo: true, ...TAGS },
    });
    await conferirGrupos(prazo());
    expect(rpcs(chamadas, "por_tag").some((d) => (d as { p_tag: string }).p_tag === "t-entrou-add")).toBe(false);
  });
});

describe("conferirGrupos: Remover Lead de Campanhas Anteriores (Etapa 3J)", () => {
  const ANTIGA = "c-antiga";
  const ligada = { remover_anteriores_ativo: true, campanhas_anteriores: [ANTIGA] };
  const consultaAnteriores = (cs: Chamada[]) => cs.find((c) => c.tabela === "participantes" && c.op === "select" && filtro(c, "in", "grupos.campanha_id"));

  it("quem entra sai dos grupos ativos da campanha antiga em 5 min (origem campanha_anterior, campanha do grupo antigo)", async () => {
    const chamadas = montar({
      abertos: [aberto(NOSSO, true)],
      membros: [{ phone: NOSSO, isAdmin: true }, pessoa("5511" + "900000001")],
      secoes: ligada,
      emAnteriores: [{ telefone: "551100000001", grupo_id: "g-antigo", campanha_id: ANTIGA }],
    });
    await conferirGrupos(prazo());
    const consulta = consultaAnteriores(chamadas)!;
    expect(filtro(consulta, "in", "grupos.campanha_id")).toEqual([ANTIGA]);
    expect(filtro(consulta, "eq", "grupos.ativo")).toBe(true);
    expect(filtro(consulta, "eq", "admin")).toBe(false);
    expect(filtro(consulta, "is", "saiu_em")).toBeNull();
    expect(filtro(consulta, "in", "telefone")).toEqual(["5511" + "900000001", "551100000001"]);
    const r = remocoes(chamadas);
    expect(r).toEqual([expect.objectContaining({ telefone: "551100000001", grupo_id: "g-antigo", campanha_id: ANTIGA, origem: "campanha_anterior" })]);
    const entrada = chamadas.find((c) => c.tabela === "participantes" && c.op === "insert")!.dados as { entrou_em: string }[];
    expect(Date.parse((r[0] as unknown as { executar_apos: string }).executar_apos) - Date.parse(entrada[0].entrou_em)).toBe(5 * 60_000);
    // Quem entrou continua no grupo novo (dispara "entrou" normalmente).
    expect(disparos()).toEqual([expect.objectContaining({ gatilho: "entrou", telefones: ["5511" + "900000001"] })]);
  });

  it("desligada (com lista) ou ligada com lista vazia: nem consulta", async () => {
    for (const secoes of [{ remover_anteriores_ativo: false, campanhas_anteriores: [ANTIGA] }, { remover_anteriores_ativo: true, campanhas_anteriores: [] }, {}]) {
      const chamadas = montar({ abertos: [aberto(NOSSO, true)], membros: [{ phone: NOSSO, isAdmin: true }, pessoa("5511" + "900000001")], secoes, emAnteriores: [{ telefone: "5511" + "900000001", grupo_id: "g-antigo", campanha_id: ANTIGA }] });
      await conferirGrupos(prazo());
      expect(consultaAnteriores(chamadas)).toBeUndefined();
      expect(remocoes(chamadas)).toEqual([]);
    }
  });

  it("nunca a própria campanha: fora da consulta e, se vier, ignorada", async () => {
    const chamadas = montar({
      abertos: [aberto(NOSSO, true)],
      membros: [{ phone: NOSSO, isAdmin: true }, pessoa("5511" + "900000001")],
      secoes: { remover_anteriores_ativo: true, campanhas_anteriores: ["c1", ANTIGA] },
      emAnteriores: [{ telefone: "5511" + "900000001", grupo_id: "g2", campanha_id: "c1" }],
    });
    await conferirGrupos(prazo());
    expect(filtro(consultaAnteriores(chamadas)!, "in", "grupos.campanha_id")).toEqual([ANTIGA]);
    expect(remocoes(chamadas)).toEqual([]);
  });

  it("admin e número conectado que entram não tiram ninguém de campanha anterior", async () => {
    hoisted.telefonesProtegidosMock.mockResolvedValue(new Set(["5511" + "977770000"]));
    const chamadas = montar({
      abertos: [aberto(NOSSO, true)],
      membros: [{ phone: NOSSO, isAdmin: true }, pessoa("5511" + "977770000"), { phone: "5511" + "900000002", isAdmin: true }],
      secoes: ligada,
      emAnteriores: [{ telefone: "5511" + "977770000", grupo_id: "g-antigo", campanha_id: ANTIGA }],
    });
    await conferirGrupos(prazo());
    expect(consultaAnteriores(chamadas)).toBeUndefined();
    expect(remocoes(chamadas)).toEqual([]);
  });

  it("bloqueado e duplicado (já vão sair deste grupo) não tiram ninguém da campanha anterior", async () => {
    const chamadas = montar({
      abertos: [aberto(NOSSO, true)],
      membros: [{ phone: NOSSO, isAdmin: true }, pessoa(BLOQ), pessoa("5511" + "900000002")],
      bloqueados: [BLOQ],
      emOutroGrupo: ["5511" + "900000002"],
      secoes: ligada,
    });
    await conferirGrupos(prazo());
    expect(consultaAnteriores(chamadas)).toBeUndefined();
    expect(remocoes(chamadas).map((r) => r.origem).sort()).toEqual(["bloqueado", "duplicado"]);
  });

  it("rodada suspeita (entrada em massa): não remove de campanha anterior", async () => {
    const velhos = Array.from({ length: 10 }, (_, i) => aberto(`55119000100${String(i).padStart(2, "0")}`));
    const novos = Array.from({ length: 12 }, (_, i) => pessoa(`55119000200${String(i).padStart(2, "0")}`));
    const chamadas = montar({
      abertos: [aberto(NOSSO, true), ...velhos],
      membros: [{ phone: NOSSO, isAdmin: true }, ...velhos.map((m) => pessoa(m.telefone)), ...novos],
      secoes: ligada,
      emAnteriores: [{ telefone: novos[0].phone, grupo_id: "g-antigo", campanha_id: ANTIGA }],
    });
    await conferirGrupos(prazo());
    expect(consultaAnteriores(chamadas)).toBeUndefined();
    expect(remocoes(chamadas)).toEqual([]);
  });

  it("passa de 500 numa rodada: enfileira 500 e alerta o resto", async () => {
    const muitos = Array.from({ length: 503 }, (_, i) => ({ telefone: "5511" + "900000001", grupo_id: `g-antigo-${i}`, campanha_id: ANTIGA }));
    const chamadas = montar({
      abertos: [aberto(NOSSO, true)],
      membros: [{ phone: NOSSO, isAdmin: true }, pessoa("5511" + "900000001")],
      secoes: ligada,
      emAnteriores: muitos,
    });
    await conferirGrupos(prazo());
    expect(remocoes(chamadas)).toHaveLength(500);
    const alertas = hoisted.alertarMock.mock.calls.map((c) => c[0] as { tipo: string; texto: string });
    expect(alertas).toEqual([expect.objectContaining({ tipo: "criacao_erro", texto: expect.stringMatching(/3 remoções de campanhas anteriores passaram do teto de 500/) })]);
  });
});

describe("conferirGrupos: foto real do grupo (Etapa 3M)", () => {
  const FOTO = "https://pps.whatsapp.net/v/t61/foto-1.jpg";
  const FOTO_NOVA = "https://pps.whatsapp.net/v/t61/foto-2.jpg";
  const updatesGrupo = (cs: Chamada[]) => cs.filter((c) => c.tabela === "grupos" && c.op === "update").map((c) => c.dados as Record<string, unknown>);
  const rodadaNormal = { abertos: [aberto(NOSSO, true), aberto("5511" + "900000001")], membros: [{ phone: NOSSO, isAdmin: true }, pessoa("5511" + "900000001")] };

  it("foto nova no GET do grupo: grava foto_url e foto_atualizada_em no mesmo update, sem chamar /avatar", async () => {
    const chamadas = montar({ ...rodadaNormal, fotoNoBanco: null, avatarUrl: FOTO });
    await conferirGrupos(prazo());
    const [u] = updatesGrupo(chamadas);
    expect(updatesGrupo(chamadas)).toHaveLength(1);
    expect(u).toMatchObject({ foto_url: FOTO, participantes: 2, leitura_suspeita_desde: null });
    expect(u.foto_atualizada_em).toBe(u.conferido_em);
    expect(hoisted.fotoDoGrupoMock).not.toHaveBeenCalled();
  });

  it("foto trocada no WhatsApp: regrava a URL nova", async () => {
    const chamadas = montar({ ...rodadaNormal, fotoNoBanco: FOTO, avatarUrl: FOTO_NOVA });
    await conferirGrupos(prazo());
    expect(updatesGrupo(chamadas)[0]).toMatchObject({ foto_url: FOTO_NOVA });
  });

  it("mesma foto: não reescreve (update idêntico ao de hoje)", async () => {
    const chamadas = montar({ ...rodadaNormal, fotoNoBanco: FOTO, avatarUrl: FOTO });
    await conferirGrupos(prazo());
    expect(Object.keys(updatesGrupo(chamadas)[0]).sort()).toEqual(["cheio", "conferido_em", "leitura_suspeita_desde", "nome", "participantes"]);
  });

  it("mesmo caminho com parâmetros assinados diferentes: não reescreve", async () => {
    const chamadas = montar({ ...rodadaNormal, fotoNoBanco: FOTO + "?oh=AAA&oe=1", avatarUrl: FOTO + "?oh=BBB&oe=2" });
    await conferirGrupos(prazo());
    expect("foto_url" in updatesGrupo(chamadas)[0]).toBe(false);
  });

  it("chave some do GET mas a foto foi gravada há menos de 24 h: mantém, sem chamar /avatar", async () => {
    const chamadas = montar({ ...rodadaNormal, fotoNoBanco: FOTO, fotoAtualizadaEm: new Date(Date.now() - 60 * 60_000).toISOString() });
    await conferirGrupos(prazo());
    expect("foto_url" in updatesGrupo(chamadas)[0]).toBe(false);
    expect(hoisted.fotoDoGrupoMock).not.toHaveBeenCalled();
  });

  it("chave some do GET, foto com mais de 24 h: confirma na rota /avatar antes de apagar (e marca foto_conferida_em)", async () => {
    const velha = new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString();
    const chamadas = montar({ ...rodadaNormal, fotoNoBanco: FOTO, fotoAtualizadaEm: velha, fotoConferidaEm: null });
    hoisted.fotoDoGrupoMock.mockResolvedValueOnce(null);
    await conferirGrupos(prazo());
    expect(hoisted.fotoDoGrupoMock).toHaveBeenCalledTimes(1);
    expect(hoisted.fotoDoGrupoMock.mock.calls[0][1]).toBe("g1@g.us");
    expect((hoisted.fotoDoGrupoMock.mock.calls[0][2] as { prazoTotalMs: number }).prazoTotalMs).toBeLessThanOrEqual(50_000);
    const [u] = updatesGrupo(chamadas);
    expect(u).toMatchObject({ foto_url: null });
    expect(u.foto_conferida_em).toBe(u.conferido_em);
  });

  it("/avatar confirma que a foto continua (mesmo caminho): mantém e só marca foto_conferida_em", async () => {
    const velha = new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString();
    const chamadas = montar({ ...rodadaNormal, fotoNoBanco: FOTO, fotoAtualizadaEm: velha });
    hoisted.fotoDoGrupoMock.mockResolvedValueOnce(FOTO + "?oh=novo");
    await conferirGrupos(prazo());
    const [u] = updatesGrupo(chamadas);
    expect("foto_url" in u).toBe(false);
    expect(u.foto_conferida_em).toBe(u.conferido_em);
  });

  it("/avatar falha: mantém a foto gravada (e não pergunta de novo no mesmo dia)", async () => {
    const velha = new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString();
    const chamadas = montar({ ...rodadaNormal, fotoNoBanco: FOTO, fotoAtualizadaEm: velha });
    hoisted.fotoDoGrupoMock.mockRejectedValueOnce(new Error("HTTP 500"));
    await conferirGrupos(prazo());
    const [u] = updatesGrupo(chamadas);
    expect("foto_url" in u).toBe(false);
    expect(u.foto_conferida_em).toBe(u.conferido_em);
  });

  it("já perguntou na rota /avatar nas últimas 24 h: mantém sem perguntar", async () => {
    const velha = new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString();
    const chamadas = montar({ ...rodadaNormal, fotoNoBanco: FOTO, fotoAtualizadaEm: velha, fotoConferidaEm: new Date(Date.now() - 60 * 60_000).toISOString() });
    await conferirGrupos(prazo());
    expect("foto_url" in updatesGrupo(chamadas)[0]).toBe(false);
    expect(hoisted.fotoDoGrupoMock).not.toHaveBeenCalled();
  });

  it("sem tempo no tick pra confirmar: nem pergunta nem marca (tenta na próxima rodada)", async () => {
    const velha = new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString();
    const chamadas = montar({ ...rodadaNormal, fotoNoBanco: FOTO, fotoAtualizadaEm: velha });
    await conferirGrupos({ ate: Date.now() + 19_000 });
    const [u] = updatesGrupo(chamadas);
    expect(hoisted.fotoDoGrupoMock).not.toHaveBeenCalled();
    expect("foto_url" in u || "foto_conferida_em" in u).toBe(false);
  });

  it("avatarUrl que não é https conexão como ausente (confirma antes de apagar)", async () => {
    const chamadas = montar({ ...rodadaNormal, fotoNoBanco: FOTO, avatarUrl: null });
    hoisted.fotoDoGrupoMock.mockResolvedValueOnce(null);
    await conferirGrupos(prazo());
    expect(hoisted.fotoDoGrupoMock).toHaveBeenCalledTimes(1);
    expect(updatesGrupo(chamadas)[0]).toMatchObject({ foto_url: null });
  });

  it("rodada ignorada (leitura estranha) não grava foto", async () => {
    const chamadas = montar({ abertos: [aberto(NOSSO, true), aberto("5511" + "900000001")], membros: [pessoa(BLOQ)], fotoNoBanco: null, avatarUrl: FOTO });
    await conferirGrupos(prazo());
    expect(updatesGrupo(chamadas).some((u) => "foto_url" in u)).toBe(false);
    expect(hoisted.fotoDoGrupoMock).not.toHaveBeenCalled();
  });

  it("grupo que sumiu (404) não grava foto", async () => {
    const chamadas = montar({ ...rodadaNormal, fotoNoBanco: FOTO });
    hoisted.obterGrupoMock.mockResolvedValue(null);
    await conferirGrupos(prazo());
    expect(updatesGrupo(chamadas)).toEqual([{ ativo: false, suspenso: true }]);
  });

  it("regressão: grupo sem foto (coluna nula ou ausente, chave ausente) faz as mesmas chamadas e escritas de hoje", async () => {
    const semColuna = montar(rodadaNormal);
    await conferirGrupos(prazo());
    const comColuna = montar({ ...rodadaNormal, fotoNoBanco: null });
    await conferirGrupos(prazo());
    const forma = (cs: Chamada[]) => cs.map((c) => [c.tabela, c.op, c.op === "update" && c.tabela === "grupos" ? Object.keys(c.dados as object).sort() : null]);
    expect(forma(comColuna)).toEqual(forma(semColuna));
    expect(Object.keys(updatesGrupo(comColuna)[0]).sort()).toEqual(["cheio", "conferido_em", "leitura_suspeita_desde", "nome", "participantes"]);
    expect(hoisted.fotoDoGrupoMock).not.toHaveBeenCalled();
  });
});

describe("conferirGrupos: regras automáticas de pedidos de entrada (Etapa 3M, Tarefa 4)", () => {
  const LIVRE = "5511" + "900000001";
  const rodadaNormal = { abertos: [aberto(NOSSO, true), aberto(LIVRE)], membros: [{ phone: NOSSO, isAdmin: true }, pessoa(LIVRE)] };
  const regras = (o: { recusar?: boolean; aprovar?: boolean; aprovacao?: boolean } = {}) => ({
    recusar_bloqueados: o.recusar ?? false,
    aprovar_automaticamente: o.aprovar ?? false,
    aprovacao_entrada: o.aprovacao ?? false,
  });
  const decisoes = (cs: Chamada[]) => cs.filter((c) => c.tabela === "solicitacoes_entrada" && c.op === "insert").flatMap((c) => c.dados as { telefone: string; decisao: string; origem: string; motivo: string }[]);
  const forma = (cs: Chamada[]) => cs.map((c) => [c.tabela, c.op, c.op === "update" && c.tabela === "grupos" ? Object.keys(c.dados as object).sort() : null]);

  it("regressão: as duas colunas false (ou ausentes) não chamam `pending` nem `group-review`: mesmas chamadas Zapbot e escritas de hoje", async () => {
    const semColunas = montar({ ...rodadaNormal, requireApproval: true });
    await conferirGrupos(prazo());
    const zapbotAntes = hoisted.obterGrupoMock.mock.calls.length;
    const comColunasFalse = montar({ ...rodadaNormal, requireApproval: true, secoes: regras({ aprovacao: true }) });
    await conferirGrupos(prazo());
    expect(forma(comColunasFalse)).toEqual(forma(semColunas));
    expect(hoisted.obterGrupoMock.mock.calls.length).toBe(2 * zapbotAntes);
    expect(hoisted.pedidosPendentesMock).not.toHaveBeenCalled();
    expect(hoisted.revisarPedidosMock).not.toHaveBeenCalled();
    expect(comColunasFalse.some((c) => c.tabela === "solicitacoes_entrada")).toBe(false);
  });

  it("regra ligada: só chama `pending` em grupo com aprovação ligada no WhatsApp", async () => {
    montar({ ...rodadaNormal, requireApproval: false, secoes: regras({ recusar: true, aprovar: true, aprovacao: true }) });
    await conferirGrupos(prazo());
    expect(hoisted.pedidosPendentesMock).not.toHaveBeenCalled();

    montar({ ...rodadaNormal, requireApproval: true, secoes: regras({ recusar: true }) });
    await conferirGrupos(prazo());
    expect(hoisted.pedidosPendentesMock).toHaveBeenCalledTimes(1);
    expect(hoisted.pedidosPendentesMock.mock.calls[0][1]).toBe("g1@g.us");
  });

  it("sem `requireApproval` na resposta: vale o `aprovacao_entrada` da campanha", async () => {
    montar({ ...rodadaNormal, secoes: regras({ recusar: true, aprovacao: false }) });
    await conferirGrupos(prazo());
    expect(hoisted.pedidosPendentesMock).not.toHaveBeenCalled();
    montar({ ...rodadaNormal, secoes: regras({ recusar: true, aprovacao: true }) });
    await conferirGrupos(prazo());
    expect(hoisted.pedidosPendentesMock).toHaveBeenCalledTimes(1);
  });

  it("recusa o bloqueado e aprova o livre (nunca o bloqueado nem o LID), com origem automática", async () => {
    const chamadas = montar({ ...rodadaNormal, requireApproval: true, bloqueados: [BLOQ], secoes: regras({ recusar: true, aprovar: true, aprovacao: true }) });
    hoisted.pedidosPendentesMock.mockResolvedValue([
      { telefone: "5511" + "900000077", pedidoEm: null },
      { telefone: BLOQ, pedidoEm: null },
      { telefone: "123456789012345@lid", pedidoEm: null },
    ]);
    await conferirGrupos(prazo());
    const chamadasRevisao = hoisted.revisarPedidosMock.mock.calls.map((c) => [c[2], c[3]]);
    expect(chamadasRevisao).toEqual([
      [[BLOQ], "reject"],
      [["5511" + "900000077"], "approve"],
    ]);
    expect(decisoes(chamadas).map((d) => [d.telefone, d.decisao, d.origem, d.motivo])).toEqual([
      [BLOQ, "recusada", "automatica", "Bloqueado"],
      ["5511" + "900000077", "aprovada", "automatica", "Aprovação automática"],
    ]);
  });

  it("só 'aprovar automaticamente': bloqueado não é aprovado nem recusado", async () => {
    montar({ ...rodadaNormal, requireApproval: true, bloqueados: [BLOQ], secoes: regras({ aprovar: true, aprovacao: true }) });
    hoisted.pedidosPendentesMock.mockResolvedValue([{ telefone: BLOQ, pedidoEm: null }]);
    await conferirGrupos(prazo());
    expect(hoisted.revisarPedidosMock).not.toHaveBeenCalled();
  });

  it("rodada suspeita (entrada em massa): lê e registra os pedidos, mas não decide nada (Etapa 3N)", async () => {
    const velhos = Array.from({ length: 10 }, (_, i) => aberto(`55119000100${String(i).padStart(2, "0")}`));
    const novos = Array.from({ length: 12 }, (_, i) => pessoa(`55119000200${String(i).padStart(2, "0")}`));
    const chamadas = montar({
      abertos: [aberto(NOSSO, true), ...velhos],
      membros: [{ phone: NOSSO, isAdmin: true }, ...velhos.map((m) => pessoa(m.telefone)), ...novos],
      requireApproval: true,
      bloqueados: [BLOQ],
      secoes: regras({ recusar: true, aprovar: true, aprovacao: true }),
    });
    hoisted.pedidosPendentesMock.mockResolvedValue([{ telefone: "5511" + "900000077", pedidoEm: null }, { telefone: BLOQ, pedidoEm: null }]);
    await conferirGrupos(prazo());
    expect(hoisted.pedidosPendentesMock).toHaveBeenCalledTimes(1);
    expect(hoisted.revisarPedidosMock).not.toHaveBeenCalled();
    expect(decisoes(chamadas)).toEqual([]);
    const vistos = chamadas.filter((c) => c.tabela === "solicitacoes_vistas" && c.op === "upsert").flatMap((c) => c.dados as { telefone: string }[]);
    expect(vistos.map((v) => v.telefone)).toEqual(["5511" + "900000077", BLOQ]);
  });

  it("rodada ignorada (leitura estranha) não decide nada", async () => {
    montar({ abertos: [aberto(NOSSO, true), aberto(LIVRE)], membros: [pessoa(BLOQ)], requireApproval: true, secoes: regras({ recusar: true, aprovacao: true }) });
    await conferirGrupos(prazo());
    expect(hoisted.pedidosPendentesMock).not.toHaveBeenCalled();
  });

  it("falha num grupo vira alerta e não aborta a rodada nem os outros grupos", async () => {
    const chamadas = montar({ ...rodadaNormal, requireApproval: true, grupos: ["g1", "g2"], secoes: regras({ recusar: true, aprovacao: true }) });
    hoisted.pedidosPendentesMock.mockRejectedValueOnce(new Error("HTTP 500")).mockResolvedValueOnce([]);
    expect(await conferirGrupos(prazo())).toBe(1);
    expect(hoisted.pedidosPendentesMock).toHaveBeenCalledTimes(2);
    expect(chamadas.filter((c) => c.tabela === "grupos" && c.op === "update")).toHaveLength(2);
    const textos = hoisted.alertarMock.mock.calls.map((c) => (c[0] as { texto: string }).texto);
    expect(textos).toContain("Grupo Turma 01: não foi possível responder os pedidos de entrada: HTTP 500");
    expect(chamadas.some((c) => c.tabela === "conexoes" && c.op === "update" && "ultimo_erro" in (c.dados as object))).toBe(false);
  });

  it("aprovação automática: quem já está aberto em outro grupo da campanha não é aprovado", async () => {
    const chamadas = montar({ ...rodadaNormal, requireApproval: true, emOutroGrupo: ["551100000077"], secoes: regras({ aprovar: true, aprovacao: true }) });
    hoisted.pedidosPendentesMock.mockResolvedValue([
      { telefone: "5511" + "900000077", pedidoEm: null },
      { telefone: "5511" + "900000078", pedidoEm: null },
    ]);
    await conferirGrupos(prazo());
    expect(hoisted.revisarPedidosMock.mock.calls.map((c) => [c[2], c[3]])).toEqual([[["5511" + "900000078"], "approve"]]);
    const consulta = chamadas.find((c) => c.tabela === "participantes" && filtro(c, "eq", "grupos.campanha_id") === "c1")!;
    expect(filtro(consulta, "neq", "grupo_id")).toBe("g1");
    expect(filtro(consulta, "is", "saiu_em")).toBeNull();
  });

  it("aprovação automática: com 'Remover Lead de Campanhas Anteriores' ligada, quem está aberto numa anterior não é aprovado", async () => {
    const ANTIGA = "c-antiga";
    const pedidos = [{ telefone: "5511" + "900000077", pedidoEm: null }, { telefone: "5511" + "900000078", pedidoEm: null }];
    const emAnteriores = [{ telefone: "5511" + "900000077", grupo_id: "g-velho", campanha_id: ANTIGA }];

    montar({ ...rodadaNormal, requireApproval: true, emAnteriores, secoes: { ...regras({ aprovar: true, aprovacao: true }), remover_anteriores_ativo: true, campanhas_anteriores: [ANTIGA, "c1"] } });
    hoisted.pedidosPendentesMock.mockResolvedValue(pedidos);
    await conferirGrupos(prazo());
    expect(hoisted.revisarPedidosMock.mock.calls.map((c) => c[2])).toEqual([["5511" + "900000078"]]);

    // Seção desligada (mesmo com a lista): nem consulta as anteriores.
    vi.clearAllMocks();
    hoisted.revisarPedidosMock.mockResolvedValue(null);
    const chamadas = montar({ ...rodadaNormal, requireApproval: true, emAnteriores, secoes: { ...regras({ aprovar: true, aprovacao: true }), remover_anteriores_ativo: false, campanhas_anteriores: [ANTIGA] } });
    hoisted.pedidosPendentesMock.mockResolvedValue(pedidos);
    await conferirGrupos(prazo());
    expect(hoisted.revisarPedidosMock.mock.calls.map((c) => c[2])).toEqual([["5511" + "900000077", "5511" + "900000078"]]);
    expect(chamadas.some((c) => c.tabela === "participantes" && filtro(c, "in", "grupos.campanha_id"))).toBe(false);
  });

  it("aprovação automática: no máximo max(9, metade do grupo) por rodada (a próxima leitura não vira entrada em massa)", async () => {
    montar({ ...rodadaNormal, requireApproval: true, secoes: regras({ aprovar: true, aprovacao: true }) });
    hoisted.pedidosPendentesMock.mockResolvedValue(Array.from({ length: 30 }, (_, i) => ({ telefone: `55119100000${String(i).padStart(2, "0")}`, pedidoEm: null })));
    await conferirGrupos(prazo());
    expect((hoisted.revisarPedidosMock.mock.calls[0][2] as string[]).length).toBe(9);
  });

  it("toda chamada ao Zapbot da regra leva o que sobra do prazo do tick menos a margem", async () => {
    montar({ ...rodadaNormal, requireApproval: true, bloqueados: [BLOQ], secoes: regras({ recusar: true, aprovar: true, aprovacao: true }) });
    hoisted.pedidosPendentesMock.mockResolvedValue([{ telefone: BLOQ, pedidoEm: null }, { telefone: "5511" + "900000077", pedidoEm: null }]);
    const p = { ate: Date.now() + 40_000 };
    await conferirGrupos(p);
    const leitura = hoisted.pedidosPendentesMock.mock.calls[0][2] as { prazoTotalMs: number; timeoutMs: number };
    expect(leitura.prazoTotalMs).toBeGreaterThan(30_000);
    expect(leitura.prazoTotalMs).toBeLessThanOrEqual(35_000);
    expect(leitura.timeoutMs).toBeLessThanOrEqual(15_000);
    expect(hoisted.revisarPedidosMock).toHaveBeenCalledTimes(2);
    for (const c of hoisted.revisarPedidosMock.mock.calls) {
      const o = c[4] as { prazoTotalMs: number };
      expect(o.prazoTotalMs).toBeGreaterThan(0);
      expect(o.prazoTotalMs).toBeLessThanOrEqual(35_000);
    }
  });

  it("no máximo 10 grupos por conexão por rodada", async () => {
    montar({ ...rodadaNormal, requireApproval: true, grupos: Array.from({ length: 12 }, (_, i) => `g${i}`), secoes: regras({ recusar: true, aprovacao: true }) });
    await conferirGrupos(prazo());
    expect(hoisted.pedidosPendentesMock).toHaveBeenCalledTimes(10);
  });

  it("sem folga no prazo do tick (≤ 20 s) não roda", async () => {
    montar({ ...rodadaNormal, requireApproval: true, secoes: regras({ recusar: true, aprovacao: true }) });
    expect(await conferirGrupos({ ate: Date.now() + 19_000 })).toBe(1);
    expect(hoisted.pedidosPendentesMock).not.toHaveBeenCalled();
  });
});

describe("conferirGrupos: reserva de vaga e aprovação por tag (Etapa 3N)", () => {
  const LIVRE = "5511" + "900000001";
  const rodadaNormal = { abertos: [aberto(NOSSO, true), aberto(LIVRE)], membros: [{ phone: NOSSO, isAdmin: true }, pessoa(LIVRE)] };
  const todasFalse = { recusar_bloqueados: false, aprovar_automaticamente: false, aprovacao_entrada: true, aprovar_por_tag: false, aprovar_tags: [], reservar_vaga_pendentes: false };
  const forma = (cs: Chamada[]) => cs.map((c) => [c.tabela, c.op, c.op === "update" && c.tabela === "grupos" ? Object.keys(c.dados as object).sort() : null]);
  const vistosEscritos = (cs: Chamada[]) => cs.filter((c) => c.tabela === "solicitacoes_vistas" && c.op !== "select");
  const updGrupo = (cs: Chamada[]) => cs.filter((c) => c.tabela === "grupos" && c.op === "update").map((c) => c.dados as Record<string, unknown>);

  it("regressão: todas as flags false (com as colunas novas) = mesmas chamadas Zapbot de hoje, sem `pending` e sem escrita em solicitacoes_vistas", async () => {
    const semColunas = montar({ ...rodadaNormal, requireApproval: true, secoes: { aprovacao_entrada: true } });
    await conferirGrupos(prazo());
    const zapbotAntes = hoisted.obterGrupoMock.mock.calls.length;
    const comColunas = montar({ ...rodadaNormal, requireApproval: true, grupoExtra: { pendentes_reservados: 0, pendentes_lidos_em: null }, secoes: todasFalse });
    await conferirGrupos(prazo());
    expect(forma(comColunas)).toEqual(forma(semColunas));
    expect(hoisted.obterGrupoMock.mock.calls.length).toBe(2 * zapbotAntes);
    expect(hoisted.pedidosPendentesMock).not.toHaveBeenCalled();
    expect(hoisted.revisarPedidosMock).not.toHaveBeenCalled();
    expect(vistosEscritos(comColunas)).toEqual([]);
    expect(comColunas.some((c) => c.tabela === "solicitacoes_entrada")).toBe(false);
    // O update do grupo é o de hoje (sem pendentes_reservados).
    expect(Object.keys(updGrupo(comColunas)[0]).sort()).toEqual(["cheio", "conferido_em", "leitura_suspeita_desde", "nome", "participantes"]);
  });

  it("só a reserva ligada: lê `pending`, registra e grava pendentes_reservados, sem decidir nada", async () => {
    const chamadas = montar({ ...rodadaNormal, requireApproval: true, bloqueados: [BLOQ], grupoExtra: { pendentes_reservados: 0 }, secoes: { ...todasFalse, reservar_vaga_pendentes: true } });
    hoisted.pedidosPendentesMock.mockResolvedValue([{ telefone: "5511" + "900000077", pedidoEm: new Date().toISOString() }, { telefone: BLOQ, pedidoEm: null }]);
    await conferirGrupos(prazo());
    expect(hoisted.pedidosPendentesMock).toHaveBeenCalledTimes(1);
    expect(hoisted.revisarPedidosMock).not.toHaveBeenCalled();
    expect(chamadas.some((c) => c.tabela === "solicitacoes_entrada" && c.op === "insert")).toBe(false);
    expect(vistosEscritos(chamadas).map((c) => c.op)).toEqual(["upsert"]);
    // O bloqueado não segura vaga (nunca vai ser aprovado).
    expect(updGrupo(chamadas).find((d) => "pendentes_reservados" in d)).toMatchObject({ pendentes_reservados: 1 });
  });

  it("reserva ligada e lida há até 15 min: os reservados contam contra o limite da campanha (grupo vira cheio); desligada, a coluna é ignorada", async () => {
    // 2 pessoas, limite 5, 3 reservados: cheio só com a reserva ligada, fresca e com aprovação no grupo.
    const fresca = new Date(Date.now() - 60_000).toISOString();
    let chamadas = montar({ ...rodadaNormal, limite: 5, requireApproval: true, grupoExtra: { pendentes_reservados: 3, pendentes_lidos_em: fresca }, secoes: { ...todasFalse, reservar_vaga_pendentes: true } });
    await conferirGrupos(prazo());
    expect(updGrupo(chamadas)[0]).toMatchObject({ cheio: true });

    vi.clearAllMocks();
    chamadas = montar({ ...rodadaNormal, limite: 5, requireApproval: true, grupoExtra: { pendentes_reservados: 3, pendentes_lidos_em: fresca }, secoes: todasFalse });
    await conferirGrupos(prazo());
    expect(updGrupo(chamadas)[0]).toMatchObject({ cheio: false });
  });

  it("reserva velha (lida há mais de 15 min ou nunca lida) ou grupo sem aprovação: vale 0", async () => {
    const casos: [Record<string, unknown>, boolean][] = [
      [{ pendentes_reservados: 3, pendentes_lidos_em: new Date(Date.now() - 16 * 60_000).toISOString() }, true],
      [{ pendentes_reservados: 3, pendentes_lidos_em: null }, true],
      [{ pendentes_reservados: 3, pendentes_lidos_em: new Date().toISOString() }, false],
    ];
    for (const [extra, aprovacao] of casos) {
      vi.clearAllMocks();
      const chamadas = montar({ ...rodadaNormal, limite: 5, requireApproval: aprovacao, grupoExtra: extra, secoes: { ...todasFalse, reservar_vaga_pendentes: true } });
      await conferirGrupos(prazo());
      expect(updGrupo(chamadas)[0], JSON.stringify(extra)).toMatchObject({ cheio: false });
    }
  });

  it("reserva desligada com a coluna > 0: zera uma vez; com a coluna 0, nenhuma escrita a mais", async () => {
    let chamadas = montar({ ...rodadaNormal, requireApproval: true, grupoExtra: { pendentes_reservados: 4 }, secoes: todasFalse });
    await conferirGrupos(prazo());
    expect(updGrupo(chamadas).filter((d) => "pendentes_reservados" in d)).toEqual([{ pendentes_reservados: 0 }]);
    expect(hoisted.pedidosPendentesMock).not.toHaveBeenCalled();

    chamadas = montar({ ...rodadaNormal, requireApproval: true, grupoExtra: { pendentes_reservados: 0 }, secoes: todasFalse });
    await conferirGrupos(prazo());
    expect(updGrupo(chamadas).filter((d) => "pendentes_reservados" in d)).toEqual([]);
  });

  it("aprovação automática com a reserva ligada: as vagas da aprovação não descontam os próprios pedidos reservados", async () => {
    // limite 3, 2 pessoas, 5 reservados: o grupo está "cheio" pela reserva, mas sobra 1 vaga real pra aprovar.
    montar({ ...rodadaNormal, limite: 3, requireApproval: true, grupoExtra: { pendentes_reservados: 5 }, secoes: { ...todasFalse, aprovar_automaticamente: true, reservar_vaga_pendentes: true } });
    hoisted.pedidosPendentesMock.mockResolvedValue([{ telefone: "5511" + "900000077", pedidoEm: null }, { telefone: "5511" + "900000078", pedidoEm: null }]);
    await conferirGrupos(prazo());
    expect(hoisted.revisarPedidosMock.mock.calls.map((c) => c[2])).toEqual([["5511" + "900000077"]]);
  });

  it("aprovação por tag ligada (com tag) também lê os pendentes; sem tag escolhida, não", async () => {
    montar({ ...rodadaNormal, requireApproval: true, secoes: { ...todasFalse, aprovar_por_tag: true, aprovar_tags: [] } });
    await conferirGrupos(prazo());
    expect(hoisted.pedidosPendentesMock).not.toHaveBeenCalled();
    montar({ ...rodadaNormal, requireApproval: true, secoes: { ...todasFalse, aprovar_por_tag: true, aprovar_tags: ["77777777-7777-7777-7777-777777777777"] } });
    await conferirGrupos(prazo());
    expect(hoisted.pedidosPendentesMock).toHaveBeenCalledTimes(1);
  });

  it("expira os vistos parados há 48 h uma vez por tick (só banco)", async () => {
    const chamadas = montar({ ...rodadaNormal, secoes: todasFalse });
    await conferirGrupos(prazo());
    const sel = chamadas.filter((c) => c.tabela === "solicitacoes_vistas" && c.op === "select");
    expect(sel).toHaveLength(1);
    expect(sel[0].filtros.some((f) => f[0] === "lt" && f[1] === "ultimo_visto_em")).toBe(true);
  });
});

describe("conferirGrupos: Hook \"Solicitações de entrada em grupos\" (Etapa 3N, Tarefa 3)", () => {
  const LIVRE = "5511" + "900000001";
  const rodadaNormal = { abertos: [aberto(NOSSO, true), aberto(LIVRE)], membros: [{ phone: NOSSO, isAdmin: true }, pessoa(LIVRE)] };
  const todasFalse = { recusar_bloqueados: false, aprovar_automaticamente: false, aprovacao_entrada: true, aprovar_por_tag: false, aprovar_tags: [], reservar_vaga_pendentes: false };
  const forma = (cs: Chamada[]) => cs.map((c) => [c.tabela, c.op, c.op === "update" && c.tabela === "grupos" ? Object.keys(c.dados as object).sort() : null]);
  const hook = (o: { id?: string; eventos?: string[]; campanhas?: string[] | null; ativo?: boolean; arquivado?: boolean } = {}) => ({
    id: o.id ?? "w-solic",
    url: "https://hook.test/solic",
    eventos: o.eventos ?? ["solicitacoes_entrada"],
    campanhas: o.campanhas === undefined ? null : o.campanhas,
    ativo: o.ativo ?? true,
    arquivado: o.arquivado ?? false,
  });
  const ANTIGO = hook({ id: "w-antigo", eventos: ["entrou", "saiu", "alerta", "compra"] });
  type Saida = { webhook_id: string; chave: string; campanha_id: string; payload: { evento: string; tipo: string; grupo_id: string; solicitacoes: { telefone: string; decisao?: string }[] } };
  const saidas = (cs: Chamada[]) =>
    cs.filter((c) => c.tabela === "eventos_saida" && (c.op === "upsert" || c.op === "insert")).flatMap((c) => c.dados as Saida[]).filter((l) => l.payload.evento === "solicitacoes_entrada");

  it("regressão: sem webhook assinado (nenhum, só o antigo, inativo ou arquivado) e sem flags = mesmas chamadas de hoje, sem `pending`", async () => {
    const hoje = montar({ ...rodadaNormal, requireApproval: true, secoes: todasFalse });
    await conferirGrupos(prazo());
    for (const ws of [[ANTIGO], [hook({ ativo: false })], [hook({ arquivado: true })], [hook({ campanhas: ["outra"] })]]) {
      const cs = montar({ ...rodadaNormal, requireApproval: true, secoes: todasFalse, webhooksCadastrados: ws });
      await conferirGrupos(prazo());
      expect(forma(cs), JSON.stringify(ws)).toEqual(forma(hoje));
      expect(saidas(cs)).toEqual([]);
    }
    expect(hoisted.pedidosPendentesMock).not.toHaveBeenCalled();
    expect(hoisted.revisarPedidosMock).not.toHaveBeenCalled();
  });

  it("com webhook só da campanha X: lê `pending` só nos grupos da X e emite `pendentes` em lote; nenhuma decisão", async () => {
    const cs = montar({
      ...rodadaNormal,
      requireApproval: true,
      secoes: todasFalse,
      grupos: ["g1", "g2", "g3"],
      campanhaPorGrupo: { g1: "c1", g2: "c2", g3: "c2" },
      webhooksCadastrados: [hook({ campanhas: ["c2"] }), ANTIGO],
    });
    hoisted.pedidosPendentesMock.mockResolvedValue([{ telefone: "5511" + "900000077", pedidoEm: null }, { telefone: "5511" + "900000078", pedidoEm: null }]);
    await conferirGrupos(prazo());
    // Grupos só com o Hook: a ordem gira a cada tick.
    expect(hoisted.pedidosPendentesMock.mock.calls.map((c) => c[1]).sort()).toEqual(["g2@g.us", "g3@g.us"]);
    expect(hoisted.revisarPedidosMock).not.toHaveBeenCalled();
    expect(cs.some((c) => c.tabela === "solicitacoes_entrada" && c.op === "insert")).toBe(false);
    const ls = saidas(cs);
    expect(ls.map((l) => [l.webhook_id, l.campanha_id, l.payload.tipo, l.payload.grupo_id, l.payload.solicitacoes.length]).sort()).toEqual([
      ["w-solic", "c2", "pendentes", "g2", 2],
      ["w-solic", "c2", "pendentes", "g3", 2],
    ]);
    expect(ls.every((l) => /^solicitacoes:pendentes:g[23]:[0-9a-f]{16}$/.test(l.chave))).toBe(true);
    // Uma leitura de webhooks por rodada.
    expect(cs.filter((c) => c.tabela === "webhooks")).toHaveLength(1);
  });

  it("webhook assinado, mas grupo sem aprovação: não lê `pending`", async () => {
    montar({ ...rodadaNormal, requireApproval: false, secoes: todasFalse, webhooksCadastrados: [hook()] });
    await conferirGrupos(prazo());
    expect(hoisted.pedidosPendentesMock).not.toHaveBeenCalled();
  });

  it("o mesmo pedido na rodada seguinte (já visto): nenhum evento novo", async () => {
    const pedido = { telefone: "5511" + "900000077", pedidoEm: null };
    hoisted.pedidosPendentesMock.mockResolvedValue([pedido]);
    const cs = montar({
      ...rodadaNormal,
      requireApproval: true,
      secoes: todasFalse,
      webhooksCadastrados: [hook()],
      vistos: (c) => (filtro(c, "eq", "grupo_id") ? { data: [{ telefone: pedido.telefone, pedido_em: null, visto_em: new Date().toISOString(), ultimo_visto_em: new Date().toISOString() }] } : undefined),
    });
    await conferirGrupos(prazo());
    expect(hoisted.pedidosPendentesMock).toHaveBeenCalledTimes(1);
    expect(saidas(cs)).toEqual([]);
  });

  it("expiradas viram `decisao` pelo mesmo emissor (uma leitura de webhooks); sem ninguém assinando, nada", async () => {
    const vencido = (c: Chamada) =>
      filtro(c, "lt", "ultimo_visto_em")
        ? { data: [{ grupo_id: "g1", campanha_id: "c1", telefone: "5511" + "900000077", pedido_em: null, visto_em: "2026-10-10T10:00:00.000Z", grupos: { nome: "Turma 01", group_id: "g1@g.us" }, campanhas: { slug: "aulao", nome: "Camp" } }] }
        : undefined;
    let cs = montar({ ...rodadaNormal, requireApproval: false, secoes: todasFalse, webhooksCadastrados: [hook()], vistos: vencido });
    await conferirGrupos(prazo());
    expect(saidas(cs).map((l) => [l.payload.tipo, l.payload.solicitacoes])).toEqual([["decisao", [{ telefone: "5511" + "900000077", pedido_em: null, decisao: "expirada", origem: "whatsapp", motivo: "Sem leitura há 48 horas" }]]]);
    expect(cs.filter((c) => c.tabela === "webhooks")).toHaveLength(1);

    cs = montar({ ...rodadaNormal, requireApproval: false, secoes: todasFalse, webhooksCadastrados: [ANTIGO], vistos: vencido });
    await conferirGrupos(prazo());
    expect(cs.some((c) => c.tabela === "eventos_saida")).toBe(false);
    expect(cs.some((c) => c.tabela === "solicitacoes_entrada" && c.op === "insert")).toBe(true);
  });

  it("enfileirar falhando não derruba a conferência nem a leitura", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const cs = montar({ ...rodadaNormal, requireApproval: true, secoes: todasFalse, webhooksCadastrados: [hook()] });
    hoisted.pedidosPendentesMock.mockResolvedValue([{ telefone: "5511" + "900000077", pedidoEm: null }]);
    const db = hoisted.dbAtual as { from: (t: string) => unknown };
    const original = db.from;
    db.from = (t: string) => {
      if (t === "eventos_saida") throw new Error("fora do ar");
      return original(t);
    };
    await expect(conferirGrupos(prazo())).resolves.toBe(1);
    expect(cs.some((c) => c.tabela === "solicitacoes_vistas" && c.op === "upsert")).toBe(true);
    erro.mockRestore();
  });
});

describe("conferirGrupos: teto de leitura com Hook (Etapa 3N, Tarefa 3, correção 1)", () => {
  const LIVRE = "5511" + "900000001";
  const rodadaNormal = { abertos: [aberto(NOSSO, true), aberto(LIVRE)], membros: [{ phone: NOSSO, isAdmin: true }, pessoa(LIVRE)] };
  const hookX = { id: "w-x", url: "https://hook.test/x", eventos: ["solicitacoes_entrada"], campanhas: ["cx"], ativo: true, arquivado: false };
  const lidos = () => hoisted.pedidosPendentesMock.mock.calls.map((c) => String(c[1]).replace("@g.us", ""));

  it("grupos com regra têm prioridade: 8 da X (só Hook, listados antes) + 6 da Y (recusar ligado) = os 6 da Y e 4 da X", async () => {
    const xs = Array.from({ length: 8 }, (_, i) => `x${i}`);
    const ys = Array.from({ length: 6 }, (_, i) => `y${i}`);
    const campanhaPorGrupo = Object.fromEntries([...xs.map((g) => [g, "cx"]), ...ys.map((g) => [g, "cy"])]);
    montar({ ...rodadaNormal, requireApproval: true, grupos: [...xs, ...ys], campanhaPorGrupo, webhooksCadastrados: [hookX], secoes: { aprovacao_entrada: true } });
    // A linha de cada grupo traz a campanha dele; a regra "recusar" só na Y.
    const db = hoisted.dbAtual as { from: (t: string) => unknown };
    const original = db.from;
    db.from = (t: string) => {
      const q = original(t) as Record<string, unknown>;
      if (t !== "grupos") return q;
      const then = q.then as (ok: (v: { data: unknown }) => unknown, f?: unknown) => Promise<unknown>;
      q.then = (ok: (v: unknown) => unknown, f?: (e: unknown) => unknown) =>
        then.call(q, (r: { data: unknown }) => {
          if (Array.isArray(r.data)) r.data = (r.data as { campanha_id: string; campanhas: Record<string, unknown> }[]).map((g) => ({ ...g, campanhas: { ...g.campanhas, recusar_bloqueados: g.campanha_id === "cy" } }));
          return ok(r);
        }, f);
      return q;
    };
    for (let tick = 0; tick < 3; tick++) {
      vi.clearAllMocks();
      hoisted.pedidosPendentesMock.mockResolvedValue([]);
      const agora = Date.UTC(2026, 9, 17, 12, tick);
      const spy = vi.spyOn(Date, "now").mockReturnValue(agora);
      await conferirGrupos({ ate: agora + 60_000 });
      spy.mockRestore();
      const l = lidos();
      expect(l.filter((g) => g.startsWith("y")).sort()).toEqual(ys);
      expect(l.filter((g) => g.startsWith("x"))).toHaveLength(4);
      // Os da Y vêm antes de qualquer um da X.
      expect(l.slice(0, 6).every((g) => g.startsWith("y"))).toBe(true);
    }
  });

  it("grupos só com Hook giram entre os ticks: com 12, todos são lidos em 3 ticks seguidos", async () => {
    const gs = Array.from({ length: 12 }, (_, i) => `x${String(i).padStart(2, "0")}`);
    const vistos = new Set<string>();
    for (let tick = 0; tick < 3; tick++) {
      vi.clearAllMocks();
      hoisted.pedidosPendentesMock.mockResolvedValue([]);
      montar({ ...rodadaNormal, requireApproval: true, grupos: gs, campanhaPorGrupo: Object.fromEntries(gs.map((g) => [g, "cx"])), webhooksCadastrados: [hookX], secoes: { aprovacao_entrada: true } });
      const agora = Date.UTC(2026, 9, 17, 12, 0) + tick * 4 * 60_000;
      const spy = vi.spyOn(Date, "now").mockReturnValue(agora);
      await conferirGrupos({ ate: agora + 60_000 });
      spy.mockRestore();
      expect(lidos()).toHaveLength(10);
      for (const g of lidos()) vistos.add(g);
    }
    expect([...vistos].sort()).toEqual(gs);
  });

  it("regra ligada com a reserva desligada e reservados > 0 (lido na rodada): zera a coluna uma vez", async () => {
    const cs = montar({ ...rodadaNormal, requireApproval: true, grupoExtra: { pendentes_reservados: 3 }, secoes: { aprovacao_entrada: true, recusar_bloqueados: true, reservar_vaga_pendentes: false } });
    await conferirGrupos(prazo());
    expect(hoisted.pedidosPendentesMock).toHaveBeenCalledTimes(1);
    const zerou = cs.filter((c) => c.tabela === "grupos" && c.op === "update").map((c) => c.dados as Record<string, unknown>).filter((d) => "pendentes_reservados" in d);
    expect(zerou).toEqual([{ pendentes_reservados: 0 }]);
  });
});
