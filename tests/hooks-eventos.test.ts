import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { dbFalso, filtro, type Chamada, type Resposta } from "./apoio/db-falso";

const h = vi.hoisted(() => ({
  db: undefined as unknown,
  alertar: vi.fn(async (_a: unknown, _db?: unknown) => undefined),
  dispararAutomacoes: vi.fn(async (..._a: unknown[]) => 0),
  obterGrupo: vi.fn(async (..._a: unknown[]) => null as unknown),
  status: vi.fn(async (..._a: unknown[]) => ({ connected: false, phone: "" }) as { connected: boolean; phone: string; error?: string }),
  zapbotCriar: {
    criarGrupo: vi.fn(async () => "120@g.us"),
    participantes: vi.fn(async () => undefined),
    configurarGrupo: vi.fn(async () => undefined),
    criarComunidade: vi.fn(async () => "999@g.us"),
    ligarGrupo: vi.fn(async () => undefined),
    linkConvite: vi.fn(async () => "https://chat.whatsapp.com/X"),
  },
}));

vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => h.db }));
vi.mock("@/src/lib/jobs/alertas", () => ({ alertar: h.alertar }));
vi.mock("@/src/lib/automacoes", () => ({ dispararAutomacoes: h.dispararAutomacoes, dispararPorPessoas: vi.fn(async () => 0), telefonesProtegidos: vi.fn(async () => new Set<string>()) }));
vi.mock("@/src/lib/conexoes", () => ({ paraZapbot: (c: { id: string }) => ({ id: c.id, token: "t", clientToken: "c" }), credenciais: vi.fn() }));
vi.mock("@/src/lib/jobs/grupo-novo", () => ({ criarGatilhosGrupoNovo: vi.fn(async () => 0) }));
vi.mock("@/src/lib/zapbot/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/src/lib/zapbot/client")>();
  return { ...real, zapbot: () => ({ ...h.zapbotCriar, obterGrupo: h.obterGrupo, status: h.status, reiniciar: vi.fn(async () => undefined) }) };
});

import { assinatura } from "@/src/lib/webhooks-assinatura";
import {
  DESCRICAO_EVENTO,
  EVENTOS_ANTIGOS,
  EVENTOS_INDISPONIVEIS,
  EXEMPLOS_SOLICITACOES,
  LOTE_SOLICITACOES_HOOK,
  sha1Hex,
  EVENTOS_WEBHOOK,
  eventoAcaoConcluida,
  eventoContaDeslogada,
  eventoContaPareada,
  eventoFalhaDisparo,
  eventoGrupoCheio,
  eventoGrupoCriado,
  eventoGrupoSuspenso,
  eventoMensagemRecebida,
  eventoSemConta,
  eventosDaBusca,
  eventosSolicitacoes,
  GRUPOS_EVENTOS,
  horaDeMetricas,
  ICONE_EVENTO,
  lerMensagemRecebida,
  ROTULO_EVENTO,
  textoEventos,
  type Evento,
} from "@/src/lib/regras/webhooks";
import { criarEmissor, enfileirarEventos, type WebhookComUrl } from "@/src/lib/webhooks";
import { processarEventos } from "@/src/lib/jobs/eventos";
import { conferirGrupos } from "@/src/lib/jobs/conferir-grupos";
import { monitorarConexoes } from "@/src/lib/jobs/monitor";
import { iniciarExecucoesVencidas } from "@/src/lib/jobs/execucoes";
import { processarTarefas } from "@/src/lib/jobs/tarefas";
import { processarAcoes } from "@/src/lib/jobs/acoes";
import { enviarMetricasHook, MAXIMO_MENSAGENS_POR_CAMPANHA } from "@/src/lib/jobs/metricas-hook";
import { processarEventoZapbot } from "@/src/lib/zapbot/evento";
import { NextRequest } from "next/server";
import { GET as link } from "@/app/l/[slug]/route";

const NOVOS = EVENTOS_WEBHOOK.filter((ev) => !EVENTOS_ANTIGOS.includes(ev));
/** Webhook criado antes desta etapa: só os 4 eventos de antes, todas as campanhas. */
const ANTIGO: WebhookComUrl = { id: "w-antigo", url: "https://hook.test/antigo", eventos: ["entrou", "saiu", "alerta", "compra"], campanhas: null, ativo: true, arquivado: false };
/** Escuta todos os eventos novos, todas as campanhas. */
const TUDO: WebhookComUrl = { id: "w-tudo", url: "https://hook.test/tudo", eventos: [...EVENTOS_WEBHOOK], campanhas: null, ativo: true, arquivado: false };
/** Escuta os novos, mas só da campanha c2 (eventos da c1 não chegam). */
const OUTRA: WebhookComUrl = { id: "w-outra", url: "https://hook.test/outra", eventos: [...EVENTOS_WEBHOOK], campanhas: ["c2"], ativo: true, arquivado: false };
const INATIVO: WebhookComUrl = { ...TUDO, id: "w-inativo", ativo: false };

type Linha = { webhook_id: string | null; chave: string | null; campanha_id: string | null; url: string; payload: Record<string, unknown> };

/** Linhas gravadas em `eventos_saida` (insert e upsert). */
function linhas(cs: Chamada[]): Linha[] {
  return cs.filter((c) => c.tabela === "eventos_saida" && (c.op === "insert" || c.op === "upsert")).flatMap((c) => c.dados as Linha[]);
}
const doEvento = (cs: Chamada[], evento: string) => linhas(cs).filter((l) => l.payload.evento === evento);

const prazo = () => ({ ate: Date.now() + 60_000 });
const WEBHOOKS = [ANTIGO, TUDO, OUTRA, INATIVO];

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------- Regras ----------

describe("catálogo de eventos", () => {
  it("cada evento está em exatamente um grupo da tela, com rótulo e ícone; grupos na ordem da tela", () => {
    expect(GRUPOS_EVENTOS.map((g) => g.titulo)).toEqual(["CAMPANHA", "GRUPOS", "MENSAGENS", "CONEXÕES", "OUTROS"]);
    const todos = GRUPOS_EVENTOS.flatMap((g) => g.eventos);
    expect([...todos].sort()).toEqual([...EVENTOS_WEBHOOK].sort());
    expect(new Set(todos).size).toBe(todos.length);
    for (const ev of EVENTOS_WEBHOOK) {
      expect(ROTULO_EVENTO[ev]).toBeTruthy();
      expect(ICONE_EVENTO[ev]).toBeTruthy();
    }
  });

  it("rótulos e ícones do brief", () => {
    expect(ROTULO_EVENTO.metricas_campanha).toBe("Métricas da campanha");
    expect(ROTULO_EVENTO.metricas_mensagens).toBe("Métricas de mensagens da campanha");
    expect(ROTULO_EVENTO.sem_conta).toBe("Campanha sem conexão associada");
    expect(ROTULO_EVENTO.falha_disparo).toBe("Falha em disparo agendado");
    expect(ROTULO_EVENTO.mensagem_recebida).toBe("Mensagem recebida (PV)");
    expect(ICONE_EVENTO).toMatchObject({ metricas_campanha: "analytics", metricas_mensagens: "visibility", sem_conta: "link_off", falha_disparo: "event_busy", acao_concluida: "task_alt", entrou: "person_add", saiu: "person_remove", grupo_criado: "group_add", grupo_cheio: "groups", grupo_suspenso: "block", mensagem_recebida: "move_to_inbox", conta_pareada: "phonelink_ring", conta_deslogada: "phonelink_erase" });
    expect(EVENTOS_INDISPONIVEIS.map((e) => e.rotulo)).toEqual([
      "Bloqueio de crescimento do grupo",
      "Status de mensagem (PV)",
      "Conexão banida",
      "Restrição temporária",
      "Novo QR Code gerado",
      "QR Code expirado",
    ]);
  });

  it("busca sem acento e cartão", () => {
    expect(eventosDaBusca("metricas")).toEqual(["metricas_campanha", "metricas_mensagens"]);
    expect(eventosDaBusca("")).toHaveLength(EVENTOS_WEBHOOK.length);
    expect(textoEventos(["entrou", "saiu"])).toBe("Envia eventos de Membro adicionado, Membro removido");
  });

  it("horário das métricas: 7h, 12h e 17h de Brasília, nos 15 primeiros minutos", () => {
    expect(horaDeMetricas(new Date("2026-10-17T10:00:00Z"))).toBe(7); // 07:00 BRT
    expect(horaDeMetricas(new Date("2026-10-17T15:14:00Z"))).toBe(12);
    expect(horaDeMetricas(new Date("2026-10-17T20:05:00Z"))).toBe(17);
    expect(horaDeMetricas(new Date("2026-10-17T10:15:00Z"))).toBeNull();
    expect(horaDeMetricas(new Date("2026-10-17T11:00:00Z"))).toBeNull();
  });

  it("chaves de idempotência", () => {
    const agora = new Date("2026-10-17T12:00:00Z");
    expect(eventoSemConta({ campanhaId: "c1", motivo: "x" }, agora).chave).toBe("sem_conta:c1:2026-10-17");
    expect(eventoAcaoConcluida({ campanhaId: "c1", execucaoId: "e1", tipo: "mensagem", total: 2, enviadas: 2, erros: 0 }).chave).toBe("acao:e1");
    expect(eventoGrupoCriado({ campanhaId: "c1", grupoId: "g1", grupoNome: "T", groupId: "1@g.us", numero: 1, link: null, conexaoId: "con1" }).chave).toBe("grupo_criado:g1");
    expect(eventoGrupoCheio({ campanhaId: "c1", grupoId: "g1", grupoNome: "T", participantes: 9, conferidoEm: null, origem: "link" }).chave).toBe("grupo_cheio:g1:nunca");
    expect(eventoGrupoSuspenso({ campanhaId: "c1", grupoId: "g1", grupoNome: "T" }, agora).dados.descricao).toBe("O grupo deixou de aparecer na conexão (suspenso ou apagado)");
  });

  it("mensagem recebida: só PV de outra pessoa; texto até 4096", () => {
    const base = { type: "ReceivedCallback", phone: "5511" + "999990000", messageId: "M1" };
    expect(lerMensagemRecebida({ ...base, text: { message: "oi" } })).toEqual({ telefone: "5511" + "999990000", tipo: "text", texto: "oi", messageId: "M1" });
    expect(lerMensagemRecebida({ ...base, image: { caption: "foto" } })).toMatchObject({ tipo: "image", texto: "foto" });
    expect(lerMensagemRecebida({ ...base, isGroup: true, text: { message: "oi" } })).toBeNull();
    expect(lerMensagemRecebida({ ...base, fromMe: true, text: { message: "oi" } })).toBeNull();
    expect(lerMensagemRecebida({ ...base, phone: "120363@g.us", text: { message: "oi" } })).toBeNull();
    expect(lerMensagemRecebida({ type: "ReceivedCallback" })).toBeNull();
    expect(lerMensagemRecebida({ ...base, text: { message: "x".repeat(5000) } })!.texto).toHaveLength(4096);
  });
});

// ---------- Regressão: webhook antigo ----------

describe("regressão: webhook antigo (4 eventos)", () => {
  it("nenhum evento novo casa com ele", async () => {
    const { db, chamadas } = dbFalso();
    const agora = new Date();
    await enfileirarEventos(db, [
      eventoSemConta({ campanhaId: "c1", motivo: "x" }, agora),
      eventoFalhaDisparo({ campanhaId: "c1", execucaoId: "e1", tipo: "mensagem", motivo: "bloqueada", texto: "t" }),
      eventoAcaoConcluida({ campanhaId: "c1", execucaoId: "e1", tipo: "mensagem", total: 1, enviadas: 1, erros: 0 }),
      eventoGrupoCriado({ campanhaId: "c1", grupoId: "g1", grupoNome: "T", groupId: "1@g.us", numero: 1, link: null, conexaoId: "con1" }),
      eventoGrupoCheio({ campanhaId: "c1", grupoId: "g1", grupoNome: "T", participantes: 9, conferidoEm: null, origem: "link" }),
      eventoGrupoSuspenso({ campanhaId: "c1", grupoId: "g1", grupoNome: "T" }, agora),
      eventoMensagemRecebida({ conexaoId: "con1", conta: "A", telefone: "55", tipo: "text", texto: "oi", messageId: "M" }),
      eventoContaPareada({ conexaoId: "con1", nome: "A", telefone: "55" }),
      eventoContaDeslogada({ conexaoId: "con1", nome: "A", telefone: "55", motivo: "x" }),
      { evento: "metricas_campanha", campanhaId: "c1", dados: {}, chave: "metricas:c1:2026-10-17:7" },
      { evento: "metricas_mensagens", campanhaId: "c1", dados: {}, chave: "metricas_mensagens:c1:2026-10-17:7" },
      ...eventosSolicitacoes({ campanhaId: "c1", grupoId: "g1", grupoNome: "T", tipo: "pendentes", itens: [{ telefone: "55", pedidoEm: null }] }),
    ], [ANTIGO]);
    expect(linhas(chamadas)).toEqual([]);
    expect(NOVOS).toHaveLength(12);
  });

  it("entrou/saiu/alerta/compra: mesmo payload de antes (só `evento`, os dados e `em`)", async () => {
    const { db, chamadas } = dbFalso();
    await enfileirarEventos(db, [
      { evento: "entrou", campanhaId: "c1", dados: { telefone: "5511" + "999990000", campanha: "aulao", campanha_nome: "Aulão", grupo: "Turma 01" } },
      { evento: "compra", campanhaId: null, dados: { telefone: "5511" + "999990000", produtos: ["x"] }, chave: "compra:v1" },
    ], [ANTIGO]);
    const ls = linhas(chamadas);
    expect(ls.map((l) => l.payload)).toEqual([
      { evento: "compra", telefone: "5511" + "999990000", produtos: ["x"], em: expect.any(String) },
      { evento: "entrou", telefone: "5511" + "999990000", campanha: "aulao", campanha_nome: "Aulão", grupo: "Turma 01", em: expect.any(String) },
    ]);
    // Ordem das chaves do JSON também igual (o corpo assinado é byte a byte o de antes).
    expect(Object.keys(ls[1].payload)).toEqual(["evento", "telefone", "campanha", "campanha_nome", "grupo", "em"]);
  });
});

// ---------- Entrega: X-Vortex-Grupo-Token ----------

describe("processarEventos: X-Vortex-Grupo-Token", () => {
  afterEach(() => vi.unstubAllGlobals());

  function fila(eventos: { id: string; url: string; payload: unknown; tentativas: number; webhook_id: string | null }[], segredos: { id: string; segredo: string; token?: string | null }[]) {
    const { db } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "rpc:pegar_eventos") return { data: eventos };
      if (c.tabela === "webhooks") return { data: segredos };
      return {};
    });
    h.db = db;
  }

  it("webhook antigo (sem token): nenhum cabeçalho novo; corpo e assinatura iguais aos de antes", async () => {
    const payload = { evento: "entrou", telefone: "x", em: "2026-10-16T00:00:00.000Z" };
    const segredo = "a".repeat(48);
    fila([{ id: "e1", url: "https://hook.test/w1", payload, tentativas: 0, webhook_id: "w1" }], [{ id: "w1", segredo, token: null }]);
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await processarEventos(prazo());
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.body).toBe(JSON.stringify(payload));
    expect(init.headers).toEqual({ "Content-Type": "application/json", "X-Vortex-Grupo-Assinatura": `sha256=${assinatura(segredo, JSON.stringify(payload))}` });
  });

  it("webhook com token: X-Vortex-Grupo-Token = token (nunca o segredo do HMAC); assinatura com o segredo", async () => {
    const payload = { evento: "entrou", telefone: "x", campanha: "aulao", campanha_nome: "Aulão", grupo: "T", em: "2026-10-16T00:00:00.000Z" };
    const segredo = "a".repeat(48);
    const token = "b".repeat(48);
    fila([{ id: "e1", url: "https://hook.test/w1", payload, tentativas: 0, webhook_id: "w1" }], [{ id: "w1", segredo, token }]);
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await processarEventos(prazo());
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(init.body).toBe(JSON.stringify(payload));
    expect(headers["X-Vortex-Grupo-Assinatura"]).toBe(`sha256=${assinatura(segredo, JSON.stringify(payload))}`);
    expect(Object.keys(headers).sort()).toEqual(["Content-Type", "X-Vortex-Grupo-Assinatura", "X-Vortex-Grupo-Token"]);
    expect(headers["X-Vortex-Grupo-Token"]).toBe(token);
  });

  it("endereço legado (CRM/alertas da campanha): sem X-Vortex-Grupo-Token nem assinatura, como antes", async () => {
    fila([{ id: "e1", url: "https://crm.test/hook", payload: { evento: "entrou" }, tentativas: 0, webhook_id: null }], []);
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await processarEventos(prazo());
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
  });
});

// ---------- Emissor ----------

describe("criarEmissor", () => {
  it("lê os webhooks uma vez por rodada (só se houver evento) e nunca lança", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, chamadas } = dbFalso((c) => (c.tabela === "webhooks" ? { data: [TUDO] } : c.tabela === "eventos_saida" ? { error: { message: "caiu" } } : {}));
    const e = criarEmissor(db);
    await e.enviar();
    expect(chamadas).toEqual([]);
    e.adicionar(eventoContaPareada({ conexaoId: "a", telefone: null }));
    e.adicionar(eventoContaPareada({ conexaoId: "b", telefone: null }));
    await expect(e.enviar()).resolves.toBeUndefined();
    expect(chamadas.filter((c) => c.tabela === "webhooks")).toHaveLength(1);
    expect(erro).toHaveBeenCalled();
    erro.mockRestore();
  });
});

// ---------- Pontos de emissão ----------

describe("conferirGrupos: grupo suspenso e grupo cheio", () => {
  const NOSSO = "5511" + "999990000";
  function montar(o: { sumiu?: boolean; n?: number }) {
    const telefones = [NOSSO, ...Array.from({ length: (o.n ?? 3) - 1 }, (_, i) => `55119${String(i).padStart(8, "0")}`)];
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "conexoes" && c.op === "select") return { data: [{ id: "con1", status: "conectado", telefone: NOSSO, proxima_conferencia_em: "2026-10-16T00:00:00.000Z" }] };
      if (c.tabela === "conexoes" && c.op === "update") return { data: [{ id: "con1" }] };
      if (c.tabela === "grupos" && c.op === "select") {
        return { data: [{ id: "g1", campanha_id: "c1", group_id: "g1@g.us", nome: "Turma 01", cheio: false, cheio_manual: null, conferido_em: "2026-10-17T10:00:00.000Z", leitura_suspeita_desde: null, campanhas: { nome: "Camp", limite_por_grupo: 3, crm_webhook_url: null, slug: "aulao" } }] };
      }
      if (c.tabela === "participantes" && c.op === "select") return { data: telefones.map((telefone) => ({ telefone, admin: telefone === NOSSO })) };
      if (c.tabela === "webhooks") return { data: WEBHOOKS };
      return {};
    });
    h.db = db;
    h.obterGrupo.mockResolvedValue(o.sumiu ? null : { name: "Turma 01", participants: telefones.map((phone) => ({ phone, isAdmin: phone === NOSSO })) });
    return chamadas;
  }

  it("grupo sumiu: grupo_suspenso só pros que pediram (chave diária), uma leitura de webhooks", async () => {
    const cs = montar({ sumiu: true });
    await conferirGrupos(prazo());
    const ls = doEvento(cs, "grupo_suspenso");
    expect(ls.map((l) => l.webhook_id)).toEqual(["w-tudo"]);
    expect(ls[0].chave).toMatch(/^grupo_suspenso:g1:\d{4}-\d{2}-\d{2}$/);
    expect(ls[0].payload).toMatchObject({ grupo: "Turma 01", campanha: "aulao", descricao: "O grupo deixou de aparecer na conexão (suspenso ou apagado)" });
    expect(cs.filter((c) => c.tabela === "webhooks")).toHaveLength(1);
  });

  it("encheu: grupo_cheio com a chave do enchimento (conferido_em de antes)", async () => {
    const cs = montar({ n: 3 });
    await conferirGrupos(prazo());
    const ls = doEvento(cs, "grupo_cheio");
    expect(ls.map((l) => [l.webhook_id, l.chave])).toEqual([["w-tudo", "grupo_cheio:g1:2026-10-17T10:00:00.000Z"]]);
    expect(ls[0].payload).toMatchObject({ participantes: 3, origem: "conferencia" });
  });

  it("enfileirar falhando não derruba a conferência", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const cs = montar({ sumiu: true });
    const db = h.db as { from: (t: string) => unknown };
    const original = db.from;
    db.from = (t: string) => {
      if (t === "eventos_saida") throw new Error("fora do ar");
      return original(t);
    };
    await expect(conferirGrupos(prazo())).resolves.toBe(1);
    expect(cs.some((c) => c.tabela === "grupos" && c.op === "update")).toBe(true);
    erro.mockRestore();
  });
});

describe("link: grupo cheio pela estimativa", () => {
  it("quem virou o grupo pra cheio enfileira grupo_cheio (mesma chave da conferência)", async () => {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "campanhas") return { data: { id: "c1", limite_por_grupo: 10, arquivada: false } };
      if (c.tabela === "grupos" && c.op === "update") return { data: [{ id: "g1" }] };
      if (c.tabela === "grupos") return { data: [{ id: "g1", nome: "Turma 01", numero: 1, cheio: false, ativo: true, link_convite: "https://chat.whatsapp.com/ABC", participantes: 10, conferido_em: "2026-10-17T10:00:00.000Z" }] };
      if (c.tabela === "webhooks") return { data: WEBHOOKS };
      return {};
    });
    h.db = db;
    const res = await link(new NextRequest("https://grupos.test/l/aulao", { headers: { "user-agent": "Safari" } }), { params: Promise.resolve({ slug: "aulao" }) });
    expect(res.status).toBe(302);
    const ls = doEvento(chamadas, "grupo_cheio");
    expect(ls.map((l) => [l.webhook_id, l.chave])).toEqual([["w-tudo", "grupo_cheio:g1:2026-10-17T10:00:00.000Z"]]);
    expect(ls[0].payload).toMatchObject({ origem: "link", campanha: "aulao" });
  });
});

describe("monitorarConexoes: conexão deslogada", () => {
  function montar(status: string) {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "conexoes" && c.op === "select") return { data: [{ id: "con1", nome: "Conexão A", telefone: "5511" + "988887777", status, proximo_status_em: "2026-10-17T00:00:00.000Z" }] };
      if (c.tabela === "conexoes" && c.op === "update") return { data: [{ id: "con1" }] };
      if (c.tabela === "webhooks") return { data: WEBHOOKS };
      return { data: [] };
    });
    h.db = db;
    return chamadas;
  }

  it("conectado → desconectado: conta_deslogada junto do alerta numero_caiu", async () => {
    h.status.mockResolvedValue({ connected: false, phone: "", error: "Sessão encerrada" });
    const cs = montar("conectado");
    await monitorarConexoes(prazo());
    const ls = doEvento(cs, "conta_deslogada");
    expect(ls.map((l) => l.webhook_id)).toEqual(["w-tudo"]);
    expect(ls[0].payload).toMatchObject({ conta_id: "con1", conta: "Conexão A", telefone: "5511" + "988887777", motivo: "Sessão encerrada" });
    expect(h.alertar.mock.calls.map((c) => (c[0] as { tipo: string }).tipo)).toEqual(["numero_caiu"]);
  });

  it("rodada que lança no meio ainda enfileira o que já juntou (enviar no finally)", async () => {
    h.status.mockResolvedValue({ connected: false, phone: "", error: "Sessão encerrada" });
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "conexoes" && c.op === "select") {
        return { data: [
          { id: "con1", nome: "Conexão A", telefone: "551", status: "conectado", proximo_status_em: "2026-10-17T00:00:00.000Z" },
          { id: "con2", nome: "Conexão B", telefone: "552", status: "conectado", proximo_status_em: "2026-10-17T00:00:00.000Z" },
        ] };
      }
      if (c.tabela === "conexoes" && c.op === "update") return { data: [{ id: "x" }] };
      if (c.tabela === "webhooks") return { data: WEBHOOKS };
      return { data: [] };
    });
    // A reivindicação da 2ª conta explode fora do try/catch por conta.
    let reivindicacoes = 0;
    const from = (db as { from: (t: string) => Record<string, unknown> }).from;
    (db as { from: unknown }).from = (t: string) => {
      const q = from(t);
      if (t !== "conexoes") return q;
      const update = q.update as (d: unknown) => unknown;
      q.update = (d: Record<string, unknown>) => {
        if ("proximo_status_em" in d && ++reivindicacoes === 2) throw new Error("caiu");
        return update(d);
      };
      return q;
    };
    h.db = db;
    await expect(monitorarConexoes(prazo())).rejects.toThrow("caiu");
    expect(doEvento(chamadas, "conta_deslogada").map((l) => l.payload.conta_id)).toEqual(["con1"]);
  });

  it("já estava desconectado: nada", async () => {
    h.status.mockResolvedValue({ connected: false, phone: "" });
    const cs = montar("desconectado");
    await monitorarConexoes(prazo());
    expect(doEvento(cs, "conta_deslogada")).toEqual([]);
    expect(cs.some((c) => c.tabela === "webhooks")).toBe(false);
  });
});

describe("processarEventoZapbot: conexão pareada e mensagem recebida", () => {
  it("ConnectedCallback que muda o status: conta_pareada", async () => {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "conexoes" && c.op === "update") return { data: [{ nome: "Conexão A", telefone: "5511" + "988887777" }] };
      if (c.tabela === "webhooks") return { data: WEBHOOKS };
      return {};
    });
    await processarEventoZapbot("con1", { type: "ConnectedCallback", phone: "5511" + "988887777" }, db);
    const up = chamadas.filter((c) => c.tabela === "conexoes" && c.op === "update");
    expect(up).toHaveLength(1);
    expect(filtro(up[0], "neq", "status")).toBe("conectado");
    const ls = doEvento(chamadas, "conta_pareada");
    expect(ls.map((l) => l.webhook_id)).toEqual(["w-tudo"]);
    expect(ls[0].payload).toMatchObject({ conta_id: "con1", conta: "Conexão A", telefone: "5511" + "988887777" });
  });

  it("ConnectedCallback de conexão já conectada: update de sempre, sem evento", async () => {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => (c.tabela === "conexoes" ? { data: [] } : {}));
    await processarEventoZapbot("con1", { type: "ConnectedCallback", phone: "55" }, db);
    const up = chamadas.filter((c) => c.tabela === "conexoes" && c.op === "update");
    expect(up).toHaveLength(2);
    expect(up[1].dados).toEqual({ status: "conectado", telefone: "55", ultimo_erro: null, caiu_em: null });
    expect(chamadas.some((c) => c.tabela === "webhooks" || c.tabela === "eventos_saida")).toBe(false);
  });

  it("PV recebido com hook escutando: mensagem_recebida (uma leitura de webhooks, nada além da fila)", async () => {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "webhooks") return { data: [TUDO] };
      if (c.tabela === "conexoes") return { data: { nome: "Conexão A" } };
      return {};
    });
    await processarEventoZapbot("con1", { type: "ReceivedCallback", phone: "5511" + "999990000", messageId: "M1", text: { message: "oi" } }, db);
    const leitura = chamadas.find((c) => c.tabela === "webhooks")!;
    expect(filtro(leitura, "contains", "eventos")).toEqual(["mensagem_recebida"]);
    const ls = doEvento(chamadas, "mensagem_recebida");
    expect(ls).toHaveLength(1);
    expect(ls[0].payload).toMatchObject({ conta: "Conexão A", telefone: "5511" + "999990000", tipo: "text", texto: "oi", messageId: "M1" });
    expect(chamadas.filter((c) => c.op !== "select" && c.tabela !== "eventos_saida")).toEqual([]);
  });

  it("PV sem hook escutando: só a leitura, nada gravado; de grupo: nem lê", async () => {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => (c.tabela === "webhooks" ? { data: [] } : {}));
    await processarEventoZapbot("con1", { type: "ReceivedCallback", phone: "5511" + "999990000", text: { message: "oi" } }, db);
    expect(chamadas.map((c) => c.tabela)).toEqual(["webhooks"]);
    await processarEventoZapbot("con1", { type: "ReceivedCallback", phone: "120363@g.us", isGroup: true, text: { message: "oi" } }, db);
    expect(chamadas).toHaveLength(1);
  });
});

describe("iniciarExecucoesVencidas: falha em disparo e ação concluída", () => {
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://grupos.test"));
  afterEach(() => vi.unstubAllEnvs());
  function montar(destino: string) {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "execucoes" && c.op === "update" && (c.dados as { status?: string }).status === "enviando") {
        return { data: [{ id: "e1", campanha_id: "c1", tipo: "mover_grupos", origem: "avulsa", gatilho_chave: null, conteudo: { campanha_destino: destino }, alvo_grupos: null, alvo_contas: null, agendada_para: new Date().toISOString() }] };
      }
      if (c.tabela === "campanhas" && filtro(c, "eq", "id") === "c1") return { data: { nome: "Camp", slug: "aulao", data_aula: null, link_aula: null, comunidade_id: null, caractere_numeracao: "" } };
      if (c.tabela === "campanhas") return { data: { id: destino, arquivada: false, inicio_contagem: 1 } };
      if (c.tabela === "webhooks") return { data: WEBHOOKS };
      return { data: [] };
    });
    h.db = db;
    return chamadas;
  }

  it("bloqueada (onde nasce o alerta execucao_bloqueada): falha_disparo", async () => {
    const cs = montar("c1");
    await iniciarExecucoesVencidas();
    const ls = doEvento(cs, "falha_disparo");
    expect(ls.map((l) => l.webhook_id)).toEqual(["w-tudo"]);
    expect(ls[0].payload).toMatchObject({ execucao_id: "e1", motivo: "bloqueada", campanha_nome: "Camp" });
    expect(h.alertar.mock.calls.map((c) => (c[0] as { tipo: string }).tipo)).toEqual(["execucao_bloqueada"]);
  });

  it("concluída sem tarefas: acao_concluida com a chave acao:{id}", async () => {
    const cs = montar("c9");
    await iniciarExecucoesVencidas();
    const ls = doEvento(cs, "acao_concluida");
    expect(ls.map((l) => [l.webhook_id, l.chave])).toEqual([["w-tudo", "acao:e1"]]);
  });
});

describe("processarTarefas: ação concluída e falha em disparo", () => {
  it("execução fecha com erro em 1 de 3 grupos: acao_concluida (totais) + falha_disparo, junto do alerta tarefa_erro", async () => {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "rpc:pegar_tarefas") return { data: [] };
      if (c.tabela === "execucoes" && c.op === "select") return { data: [{ id: "e1", campanha_id: "c1", tipo: "mensagem", origem: "avulsa", gatilho_chave: null, agendada_para: new Date().toISOString(), iniciada_em: new Date().toISOString(), campanhas: { nome: "Camp" } }] };
      if (c.tabela === "execucoes" && c.op === "update") return { data: [{ id: "e1" }] };
      if (c.tabela === "tarefas" && c.filtros.some((f) => f[0] === "in")) return { count: 0 };
      if (c.tabela === "tarefas" && filtro(c, "eq", "status") === "erro") return { count: 1 };
      if (c.tabela === "tarefas") return { count: 3 };
      if (c.tabela === "webhooks") return { data: WEBHOOKS };
      return {};
    });
    h.db = db;
    await processarTarefas(prazo());
    const concluida = doEvento(chamadas, "acao_concluida");
    expect(concluida.map((l) => [l.webhook_id, l.chave])).toEqual([["w-tudo", "acao:e1"]]);
    expect(concluida[0].payload).toMatchObject({ total: 3, enviadas: 2, erros: 1, campanha_nome: "Camp" });
    expect(doEvento(chamadas, "falha_disparo")[0].payload).toMatchObject({ motivo: "erros", execucao_id: "e1" });
    expect(h.alertar.mock.calls.map((c) => (c[0] as { tipo: string }).tipo)).toEqual(["tarefa_erro"]);
    expect(chamadas.filter((c) => c.tabela === "webhooks")).toHaveLength(1);
  });
});

describe("processarAcoes: sem conexão e grupo criado", () => {
  function montar(criador: Record<string, unknown> | null, camp: Record<string, unknown>) {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "rpc:pegar_acoes") return { data: [{ id: "a1", tipo: "criar_grupo", campanha_id: "c1", grupo_id: null, telefone: null, dados: {}, tentativas: 1 }] };
      if (c.tabela === "campanhas") return { data: camp };
      if (c.tabela === "conexoes") return { data: criador };
      if (c.tabela === "grupos" && c.op === "upsert") return { data: { id: "g9" } };
      if (c.tabela === "grupos") return { data: null };
      if (c.tabela === "webhooks") return { data: WEBHOOKS };
      return { data: [] };
    });
    h.db = db;
    return chamadas;
  }
  const camp = { id: "c1", slug: "aulao", nome: "Camp", conexao_criadora_id: "con1", descricao: "d", fechado: false, comunidade_id: null, usar_comunidade: false, padrao_nome: "Turma #" };

  it("número criador desconectado: sem_conta (chave diária) e a ação volta pra fila como antes", async () => {
    const cs = montar({ id: "con1", status: "desconectado" }, camp);
    await processarAcoes(prazo());
    const ls = doEvento(cs, "sem_conta");
    expect(ls.map((l) => l.webhook_id)).toEqual(["w-tudo"]);
    expect(ls[0].chave).toMatch(/^sem_conta:c1:\d{4}-\d{2}-\d{2}$/);
    expect(ls[0].payload).toMatchObject({ motivo: "Número criador desconectado", campanha: "aulao" });
    const fim = cs.filter((c) => c.tabela === "acoes" && c.op === "update").at(-1)!;
    expect(fim.dados).toMatchObject({ status: "fila", erro: "Número criador desconectado" });
  });

  it("campanha sem número criador: sem_conta", async () => {
    const cs = montar(null, { ...camp, conexao_criadora_id: null });
    await processarAcoes(prazo());
    expect(doEvento(cs, "sem_conta")[0].payload).toMatchObject({ motivo: "Campanha sem número criador" });
  });

  it("grupo criado e salvo: grupo_criado com a chave grupo_criado:{id}", async () => {
    const cs = montar({ id: "con1", status: "conectado" }, camp);
    await processarAcoes(prazo());
    const ls = doEvento(cs, "grupo_criado");
    expect(ls.map((l) => [l.webhook_id, l.chave])).toEqual([["w-tudo", "grupo_criado:g9"]]);
    expect(ls[0].payload).toMatchObject({ grupo_id: "g9", group_id: "120@g.us", link_convite: "https://chat.whatsapp.com/X", campanha: "aulao" });
  });
});

// ---------- Métricas ----------

describe("enviarMetricasHook", () => {
  /** Banco com o índice único (webhook_id, chave) de verdade: duplicata no upsert é ignorada. */
  function banco(webhooks: WebhookComUrl[]) {
    const fila = new Map<string, Linha>();
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "webhooks") return { data: webhooks };
      if (c.tabela === "campanhas") return { data: [{ id: "c1", nome: "Camp", slug: "aulao", termina_em: null }, { id: "c2", nome: "Outra", slug: "outra", termina_em: null }] };
      if (c.tabela === "rpc:resumo_campanhas") return { data: [{ campanha_id: "c1", cliques: 10, entradas: 4, saidas: 1, participantes: 50, admins: 2, grupos: 2, grupos_cheios: 0 }] };
      if (c.tabela === "execucoes") return { data: filtro(c, "eq", "campanha_id") === "c1" ? [{ id: "e1", campanha_id: "c1", tipo: "mensagem", iniciada_em: "2026-10-17T09:00:00.000Z" }] : [] };
      if (c.tabela === "rpc:resumo_execucoes") return { data: [{ execucao_id: "e1", total: 2, feitas: 2, erros: 0, pendentes: 0, entregues: 30, lidos: 12 }] };
      if (c.tabela === "eventos_saida" && c.op === "upsert") {
        for (const l of c.dados as Linha[]) {
          const k = `${l.webhook_id}|${l.chave}`;
          if (!fila.has(k)) fila.set(k, l);
        }
      }
      return {};
    });
    return { db, chamadas, fila };
  }
  const SETE = new Date("2026-10-17T10:02:00Z"); // 07:02 em Brasília

  it("teto de mensagens por campanha (uma consulta por campanha, com limit), não global", async () => {
    const { db, chamadas } = banco([TUDO]);
    await enviarMetricasHook(SETE, db);
    const execs = chamadas.filter((c) => c.tabela === "execucoes");
    expect(execs.map((c) => filtro(c, "eq", "campanha_id")).sort()).toEqual(["c1", "c2"]);
    for (const c of execs) expect(c.filtros.find((f) => f[0] === "limit")?.[1]).toBe(MAXIMO_MENSAGENS_POR_CAMPANHA);
  });

  it("fora do horário: não lê nada", async () => {
    const { db, chamadas } = banco([TUDO]);
    expect(await enviarMetricasHook(new Date("2026-10-17T13:00:00Z"), db)).toBe(0);
    expect(chamadas).toEqual([]);
  });

  it("ninguém escuta métricas (webhook antigo): só lê webhooks", async () => {
    const { db, chamadas } = banco([ANTIGO]);
    expect(await enviarMetricasHook(SETE, db)).toBe(0);
    expect(chamadas.map((c) => c.tabela)).toEqual(["webhooks"]);
  });

  it("às 7h: uma de cada por campanha ativa, com as chaves do horário; dois ticks na mesma hora não duplicam", async () => {
    const { db, fila } = banco([TUDO, OUTRA]);
    await enviarMetricasHook(SETE, db);
    await enviarMetricasHook(new Date("2026-10-17T10:03:00Z"), db);
    const ls = [...fila.values()];
    // TUDO: c1 e c2 × 2 eventos; OUTRA: só c2 × 2 eventos.
    expect(ls).toHaveLength(6);
    const c1 = ls.filter((l) => l.webhook_id === "w-tudo" && l.campanha_id === "c1");
    expect(c1.map((l) => l.chave).sort()).toEqual(["metricas:c1:2026-10-17:7", "metricas_mensagens:c1:2026-10-17:7"]);
    expect(c1.find((l) => l.payload.evento === "metricas_campanha")!.payload).toMatchObject({ campanha: "aulao", cliques: 10, entradas: 4, saidas: 1, participantes: 50, grupos: 2 });
    expect(c1.find((l) => l.payload.evento === "metricas_mensagens")!.payload).toMatchObject({ entregues: 30, lidos: 12, mensagens: [{ execucao_id: "e1", entregues: 30, lidos: 12 }] });
    expect(ls.filter((l) => l.webhook_id === "w-outra").every((l) => l.campanha_id === "c2")).toBe(true);
  });
});

// ---------- Migração do token do webhook ----------

describe("migrações 20261019140000 e 20261019140100 (passos 2 e 3 do token)", () => {
  it("não mexem no banco: só mantêm a numeração das migrações", () => {
    for (const nome of ["20261019140000_token_webhook_passo2.sql", "20261019140100_token_webhook_passo3.sql"]) {
      const sql = readFileSync(resolve(__dirname, "../supabase/migrations/" + nome), "utf8");
      const comandos = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").trim();
      expect(comandos).toBe("select 1;");
    }
  });
});

describe("migração 20261017200600_token_webhook", () => {
  const sql = readFileSync(resolve(__dirname, "../supabase/migrations/20261017200600_token_webhook.sql"), "utf8");
  it("coluna nova anulável (sem default), escondida de authenticated como o segredo; só aditiva", () => {
    expect(sql).toMatch(/alter table webhooks add column token text check \(token is null or token ~ '\^\[0-9a-f\]\{48\}\$'\)/);
    const comandos = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(comandos).not.toMatch(/not null|default/i);
    expect(sql).toMatch(/revoke select \(token\) on webhooks from authenticated/);
    expect(sql).not.toMatch(/drop column|rename|grant select[^;]*token/i);
    // A lista de colunas concedidas a authenticated (migração original) não tem segredo nem token.
    const original = readFileSync(resolve(__dirname, "../supabase/migrations/20261016210000_webhooks_historico.sql"), "utf8");
    const grant = original.match(/grant select \(([^)]*)\) on webhooks to authenticated/)![1];
    expect(grant).not.toMatch(/segredo|token/);
  });
});

// ---------- Migração ----------

describe("migração 20261017200400_hooks_eventos", () => {
  const sql = readFileSync(resolve(__dirname, "../supabase/migrations/20261017200400_hooks_eventos.sql"), "utf8");
  /** Os 15 eventos da Etapa 3K (o `solicitacoes_entrada` entrou depois, em 20261017240200). */
  const DA_3K = EVENTOS_WEBHOOK.filter((ev) => ev !== "solicitacoes_entrada");
  it("amplia o check mantendo os 4 de antes e todos os novos; sem coluna nova nem drop de coluna", () => {
    for (const ev of DA_3K) expect(sql).toContain(`'${ev}'`);
    expect(sql).toMatch(/from pg_constraint/);
    expect(sql).toMatch(/add constraint webhooks_eventos_check check/);
    expect(sql).not.toMatch(/add column|drop column|rename/i);
  });
  it("todo evento do código cabe no check (e vice-versa)", () => {
    const lista = [...sql.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).filter((v) => (EVENTOS_WEBHOOK as readonly string[]).includes(v));
    expect(new Set(lista)).toEqual(new Set<Evento>(DA_3K));
  });
});

// ---------- Solicitações de entrada em grupos (Etapa 3N, Tarefa 3) ----------

describe("evento solicitacoes_entrada: catálogo e descrições", () => {
  it("no fim da lista (a ordem dos 15 de antes não muda), no grupo CAMPANHA, fora dos indisponíveis; 16 eventos", () => {
    expect(EVENTOS_WEBHOOK.slice(0, 15)).toEqual([
      "entrou", "saiu", "alerta", "compra", "metricas_campanha", "metricas_mensagens", "sem_conta", "falha_disparo", "acao_concluida",
      "grupo_criado", "grupo_cheio", "grupo_suspenso", "mensagem_recebida", "conta_pareada", "conta_deslogada",
    ]);
    expect(EVENTOS_WEBHOOK[15]).toBe("solicitacoes_entrada");
    expect(EVENTOS_WEBHOOK).toHaveLength(16);
    expect(EVENTOS_ANTIGOS).toEqual(["entrou", "saiu", "alerta", "compra"]);
    expect(ROTULO_EVENTO.solicitacoes_entrada).toBe("Solicitações de entrada em grupos");
    expect(ICONE_EVENTO.solicitacoes_entrada).toBe("pending_actions");
    expect(GRUPOS_EVENTOS.find((g) => g.titulo === "CAMPANHA")!.eventos).toContain("solicitacoes_entrada");
    expect(EVENTOS_INDISPONIVEIS.some((e) => /Solicitações/.test(e.rotulo))).toBe(false);
    expect(eventosDaBusca("solicitacoes")).toEqual(["solicitacoes_entrada"]);
  });

  it("todo evento tem descrição (o que vem no payload); textos do brief", () => {
    for (const ev of EVENTOS_WEBHOOK) expect(DESCRICAO_EVENTO[ev], ev).toBeTruthy();
    expect(DESCRICAO_EVENTO.entrou).toBe("Nome da campanha, nome do grupo e WhatsApp do participante");
    expect(DESCRICAO_EVENTO.saiu).toBe(DESCRICAO_EVENTO.entrou);
    expect(DESCRICAO_EVENTO.solicitacoes_entrada).toBe(
      "Pedidos de entrada novos e as decisões (aprovada, recusada, cancelada, expirada), lidos quando a aba abre ou pela conferência a cada 2 minutos.",
    );
  });

  it("payload de grupo_suspenso não muda com a descrição nova da tela", () => {
    expect(eventoGrupoSuspenso({ campanhaId: "c1", grupoId: "g1", grupoNome: "T" }).dados.descricao).toBe("O grupo deixou de aparecer na conexão (suspenso ou apagado)");
  });

  it("exemplos do passo de teste: os dois `tipo`", () => {
    expect(EXEMPLOS_SOLICITACOES.map((e) => e.tipo)).toEqual(["pendentes", "decisao"]);
    for (const e of EXEMPLOS_SOLICITACOES) expect(e.payload).toMatchObject({ evento: "solicitacoes_entrada", tipo: e.tipo });
  });
});

describe("eventosSolicitacoes (builder)", () => {
  const tel = (i: number) => `55119${String(i).padStart(8, "0")}`;
  const base = { campanhaId: "c1", campanhaSlug: "aulao", campanhaNome: "Aulão", grupoId: "g1", grupoNome: "Turma 01", groupId: "1@g.us", agora: "2026-10-17T12:00:00.000Z" };
  const itens = Array.from({ length: 250 }, (_, i) => ({ telefone: tel(i), pedidoEm: null, decisao: i % 2 ? "aprovada" : "recusada", origem: "manual", motivo: null }));

  it("sha1Hex confere com o SHA-1 de verdade", () => {
    expect(sha1Hex("abc")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
    expect(sha1Hex("")).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709");
    expect(sha1Hex("a".repeat(1000))).toBe("291e9a6c66994949b57ba5e650361e98fc36b1ba");
  });

  it("lote de 250 vira 3 eventos (100, 100, 50) com chaves distintas e estáveis; nenhum telefone na chave", () => {
    const evs = eventosSolicitacoes({ ...base, tipo: "decisao", itens });
    expect(LOTE_SOLICITACOES_HOOK).toBe(100);
    expect(evs.map((e) => e.dados.total)).toEqual([100, 100, 50]);
    expect(new Set(evs.map((e) => e.chave)).size).toBe(3);
    for (const e of evs) {
      expect(e.chave).toMatch(/^solicitacoes:decisao:g1:[0-9a-f]{16}$/);
      for (const i of itens) expect(e.chave).not.toContain(i.telefone);
    }
    // Mesma lista, noutra ordem e noutra hora do mesmo dia: mesmas chaves (a próxima rodada não repete).
    const de_novo = eventosSolicitacoes({ ...base, agora: "2026-10-17T20:00:00.000Z", tipo: "decisao", itens: [...itens].reverse() });
    expect(de_novo.map((e) => e.chave)).toEqual(evs.map((e) => e.chave));
    expect(de_novo.map((e) => e.dados)).toEqual(evs.map((e) => e.dados));
    // Outra decisão pro mesmo telefone: outra chave.
    const outra = eventosSolicitacoes({ ...base, tipo: "decisao", itens: [{ ...itens[0], decisao: "expirada" }] });
    const mesma = eventosSolicitacoes({ ...base, tipo: "decisao", itens: [itens[0]] });
    expect(outra[0].chave).not.toBe(mesma[0].chave);
    // `pendentes` e `decisao` do mesmo telefone não colidem.
    expect(eventosSolicitacoes({ ...base, tipo: "pendentes", itens: [itens[0]] })[0].chave).not.toBe(mesma[0].chave);
  });

  it("payload: dados do grupo e da campanha; `pendentes` sem campos de decisão", () => {
    const [p] = eventosSolicitacoes({ ...base, tipo: "pendentes", itens: [{ telefone: tel(1), pedidoEm: "2026-10-17T11:00:00.000Z", decisao: "aprovada" }, { telefone: tel(1), pedidoEm: null }] });
    expect(p).toMatchObject({ evento: "solicitacoes_entrada", campanhaId: "c1" });
    expect(p.dados).toEqual({
      tipo: "pendentes",
      campanha: "aulao",
      campanha_nome: "Aulão",
      grupo_id: "g1",
      grupo: "Turma 01",
      group_id: "1@g.us",
      total: 1,
      solicitacoes: [{ telefone: tel(1), pedido_em: "2026-10-17T11:00:00.000Z" }],
    });
    const [d] = eventosSolicitacoes({ ...base, tipo: "decisao", itens: [{ telefone: tel(2), pedidoEm: null, decisao: "cancelada", origem: "whatsapp", motivo: "x" }] });
    expect(d.dados.solicitacoes).toEqual([{ telefone: tel(2), pedido_em: null, decisao: "cancelada", origem: "whatsapp", motivo: "x" }]);
    expect(eventosSolicitacoes({ ...base, tipo: "decisao", itens: [] })).toEqual([]);
  });

  it("pedido sem `pedido_em` feito de novo noutro dia: chave nova", () => {
    const um = eventosSolicitacoes({ ...base, tipo: "pendentes", itens: [{ telefone: tel(1), pedidoEm: null }] });
    const outroDia = eventosSolicitacoes({ ...base, agora: "2026-10-19T12:00:00.000Z", tipo: "pendentes", itens: [{ telefone: tel(1), pedidoEm: null }] });
    expect(outroDia[0].chave).not.toBe(um[0].chave);
  });

  it("webhook antigo e webhook de outra campanha não recebem; o assinado recebe com a chave", async () => {
    const { db, chamadas } = dbFalso();
    await enfileirarEventos(db, eventosSolicitacoes({ ...base, tipo: "pendentes", itens: [{ telefone: tel(1), pedidoEm: null }] }), WEBHOOKS);
    expect(linhas(chamadas).map((l) => l.webhook_id)).toEqual(["w-tudo"]);
    expect(linhas(chamadas)[0].chave).toMatch(/^solicitacoes:pendentes:g1:/);
  });
});

describe("migração 20261017240200_hook_solicitacoes", () => {
  const pasta = resolve(__dirname, "../supabase/migrations");
  const sql = readFileSync(resolve(pasta, "20261017240200_hook_solicitacoes.sql"), "utf8");

  it("só aditiva: mesmo bloco do pg_constraint, mantém os 15 de antes e entra o novo; sem coluna nem drop de coluna", () => {
    for (const ev of EVENTOS_WEBHOOK) expect(sql).toContain(`'${ev}'`);
    const lista = [...sql.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).filter((v) => (EVENTOS_WEBHOOK as readonly string[]).includes(v));
    expect(new Set(lista)).toEqual(new Set<Evento>(EVENTOS_WEBHOOK));
    expect(sql).toMatch(/from pg_constraint/);
    expect(sql).toMatch(/add constraint webhooks_eventos_check check/);
    expect(sql).not.toMatch(/add column|drop column|rename|drop table/i);
  });

  describe("no Postgres (PGlite)", () => {
    let d: PGlite;
    const um = async <T>(q: string, args: unknown[] = []) => (await d.query<T>(q, args)).rows[0];
    beforeAll(async () => {
      d = new PGlite({ extensions: { pgcrypto } });
      await d.exec(`
        create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
        create schema extensions; create schema auth; create table auth.users (id uuid primary key);
        create or replace function auth.uid() returns uuid language sql stable as $$ select (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::uuid $$;
        create schema storage; create table storage.buckets (id text primary key, name text not null, public boolean default false);
        create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text);
        alter table storage.objects enable row level security;
        alter default privileges in schema public grant all on tables to anon, authenticated, service_role;`);
      const todas = readdirSync(pasta).filter((x) => x.endsWith(".sql")).sort();
      for (const f of todas.filter((x) => x < "20261017240200")) await d.exec(readFileSync(resolve(pasta, f), "utf8"));
      // Webhooks gravados antes: um antigo (4 eventos) e um com os 15 da 3K.
      await d.query("insert into webhooks (nome, url, segredo, eventos) values ('antigo', 'https://a.test', 'x', array['entrou','saiu','alerta','compra'])");
      await d.query(`insert into webhooks (nome, url, segredo, eventos) values ('3k', 'https://b.test', 'x', $1)`, [EVENTOS_WEBHOOK.filter((e) => e !== "solicitacoes_entrada")]);
      await expect(d.query("insert into webhooks (nome, url, segredo, eventos) values ('cedo', 'https://c.test', 'x', array['solicitacoes_entrada'])")).rejects.toThrow(/check/);
      for (const f of todas.filter((x) => x >= "20261017240200")) await d.exec(readFileSync(resolve(pasta, f), "utf8"));
    }, 120_000);
    afterAll(async () => {
      await d?.close();
    });

    it("as linhas de antes continuam iguais", async () => {
      expect(await um("select eventos from webhooks where nome = 'antigo'")).toEqual({ eventos: ["entrou", "saiu", "alerta", "compra"] });
      expect(((await um<{ eventos: string[] }>("select eventos from webhooks where nome = '3k'")).eventos)).toHaveLength(15);
    });

    it("aceita os 16 (cada um sozinho e todos juntos); recusa evento desconhecido", async () => {
      for (const ev of EVENTOS_WEBHOOK) await d.query("insert into webhooks (nome, url, segredo, eventos) values ($1, 'https://d.test', 'x', array[$1])", [ev]);
      await d.query("insert into webhooks (nome, url, segredo, eventos) values ('todos', 'https://d.test', 'x', $1)", [[...EVENTOS_WEBHOOK]]);
      await expect(d.query("insert into webhooks (nome, url, segredo, eventos) values ('x', 'https://d.test', 'x', array['qr_code'])")).rejects.toThrow(/check/);
      });

    it("um check de eventos só, com o nome fixo", async () => {
      const r = await d.query<{ conname: string }>("select conname from pg_constraint where conrelid = 'webhooks'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%eventos%'");
      expect(r.rows.map((x) => x.conname)).toEqual(["webhooks_eventos_check"]);
    });
  });
});
