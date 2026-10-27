import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rodadaSuspeita } from "@/src/lib/regras/automacoes";
import {
  FILTROS_HISTORICO,
  MOTIVO_AUTOMATICO,
  MOTIVO_TAG,
  ROTULO_DECISAO,
  ROTULO_FILTRO_HISTORICO,
  ROTULO_ORIGEM,
  condicaoFiltroHistorico,
  ehPedidoLid,
  ehTelefoneBR,
  filtrarPorNumero,
  lerFiltroHistorico,
  mensagemDecisao,
  planoAutomatico,
  reconciliarLeitura,
  reservadosDoGrupo,
  reservadosEmVigor,
  resumoHistoricoDecisao,
  separarPedidos,
  tetoEntradaSegura,
  vagasDoGrupo,
} from "@/src/lib/regras/solicitacoes";

/** Etapa 3M, Tarefa 4: regras puras das solicitações de entrada e a migração. */

const LIVRE = "5511" + "900000001";
const LIVRE2 = "5511" + "900000002";
const BLOQ = "5511" + "900000066";
const BLOQ_SEM_9 = "551100000066"; // mesmo número sem o nono dígito
const LID = "123456789012345@lid";
const ESTRANHO = "12345"; // fora do formato de telefone

const p = (telefone: string) => ({ telefone });

describe("ehPedidoLid", () => {
  it("…@lid e fora de ^[0-9]{10,15}$ são LID; telefone normal não", () => {
    expect(ehPedidoLid(LID)).toBe(true);
    expect(ehPedidoLid(ESTRANHO)).toBe(true);
    expect(ehPedidoLid("5511900000001234567")).toBe(true);
    expect(ehPedidoLid(LIVRE)).toBe(false);
    expect(ehPedidoLid("1155559999")).toBe(false);
  });

  it("LID sem o sufixo @lid (15 dígitos, mesmo começando com 55) é LID", () => {
    expect(ehPedidoLid("120363012345678")).toBe(true);
    expect(ehPedidoLid("551199" + "999999999")).toBe(true);
    expect(ehPedidoLid("55119" + "999999999")).toBe(true); // 14 dígitos com 55: não é BR válido
    expect(ehPedidoLid("5500900000001")).toBe(true); // DDD 00
  });

  it("brasileiro válido (55 + DDD + 8 ou 9 dígitos) não é LID", () => {
    expect(ehPedidoLid("5511" + "900000001")).toBe(false);
    expect(ehPedidoLid("551133334444")).toBe(false);
  });

  it("estrangeiro com DDI conhecido e até 13 dígitos não é LID; com 14+ ou DDI desconhecido é", () => {
    expect(ehPedidoLid("351" + "912345678")).toBe(false); // Portugal
    expect(ehPedidoLid("4915112345678")).toBe(false); // Alemanha, 13
    expect(ehPedidoLid("12025550123")).toBe(false); // EUA
    expect(ehPedidoLid("49151123456789")).toBe(true); // 14 dígitos
    expect(ehPedidoLid("99812345678")).toBe(true); // DDI fora da lista
  });
});

describe("ehTelefoneBR", () => {
  it("só 55 + DDD (sem zero) + 8 ou 9 dígitos", () => {
    expect(ehTelefoneBR("5511" + "900000001")).toBe(true);
    expect(ehTelefoneBR("551133334444")).toBe(true);
    for (const t of ["11" + "900000001", "5501900000001", "5510" + "900000001", "55119000000012", "351" + "912345678", "123456789012345@lid", "55119abc00001"]) {
      expect(ehTelefoneBR(t), t).toBe(false);
    }
  });
});

describe("separarPedidos", () => {
  it("bloqueado (nas duas formas do nono dígito), bloqueado por LID, LID e livre", () => {
    const s = separarPedidos([p(LIVRE), p(BLOQ), p(LID), p(ESTRANHO), p("999888777666@lid")], { bloqueados: [BLOQ_SEM_9], lidsBloqueados: ["999888777666@lid"] });
    expect(s.livres.map((x) => x.telefone)).toEqual([LIVRE]);
    expect(s.bloqueados.map((x) => x.telefone)).toEqual([BLOQ, "999888777666@lid"]);
    expect(s.soLid.map((x) => x.telefone)).toEqual([LID, ESTRANHO]);
  });

  it("mantém o objeto original (com os outros campos)", () => {
    const pedido = { telefone: LIVRE, pedidoEm: "2026-10-17T10:00:00.000Z" };
    expect(separarPedidos([pedido], { bloqueados: [], lidsBloqueados: [] }).livres[0]).toBe(pedido);
  });
});

describe("planoAutomatico", () => {
  const sep = separarPedidos([p(LIVRE), p(LIVRE2), p(BLOQ), p(LID)], { bloqueados: [BLOQ], lidsBloqueados: [] });
  const base = { pedidos: sep, recusarBloqueados: false, aprovarAutomaticamente: false, vagas: 100, suspeita: false, membros: 1000 };

  it("as duas regras desligadas: nada", () => {
    expect(planoAutomatico(base)).toEqual({ aprovar: [], recusar: [], motivo: {} });
  });

  it("só aprovar automaticamente: bloqueado nunca vai pra aprovar (nem pra recusar); LID nunca é aprovado", () => {
    const r = planoAutomatico({ ...base, aprovarAutomaticamente: true });
    expect(r.aprovar).toEqual([LIVRE, LIVRE2]);
    expect(r.aprovar).not.toContain(BLOQ);
    expect(r.aprovar).not.toContain(LID);
    expect(r.recusar).toEqual([]);
  });

  it("bloqueado que por engano está em 'livres' continua fora de aprovar", () => {
    const errado = { livres: [p(LIVRE), p(BLOQ), p(LID)], bloqueados: [p(BLOQ)], soLid: [] };
    expect(planoAutomatico({ ...base, pedidos: errado, aprovarAutomaticamente: true }).aprovar).toEqual([LIVRE]);
  });

  it("recusar bloqueados: só os bloqueados vão pra recusar; LID não", () => {
    expect(planoAutomatico({ ...base, recusarBloqueados: true })).toEqual({ aprovar: [], recusar: [BLOQ], motivo: {} });
  });

  it("vagas limitam a aprovação; grupo cheio (0 vagas) não aprova; teto de 50", () => {
    expect(planoAutomatico({ ...base, aprovarAutomaticamente: true, vagas: 1 }).aprovar).toEqual([LIVRE]);
    expect(planoAutomatico({ ...base, aprovarAutomaticamente: true, vagas: 0 }).aprovar).toEqual([]);
    expect(planoAutomatico({ ...base, aprovarAutomaticamente: true, vagas: -5 }).aprovar).toEqual([]);
    const muitos = Array.from({ length: 80 }, (_, i) => p(`55119${String(i).padStart(8, "0")}`));
    const r = planoAutomatico({ ...base, pedidos: { livres: muitos, bloqueados: [], soLid: [] }, aprovarAutomaticamente: true, vagas: 1000 });
    expect(r.aprovar).toHaveLength(50);
  });

  it("aprovação automática só aprova telefone brasileiro válido (estrangeiro e LID sem sufixo ficam pendentes)", () => {
    const livres = [p(LIVRE), p("351" + "912345678"), p("120363012345678"), p("551133334444")];
    const r = planoAutomatico({ ...base, pedidos: { livres, bloqueados: [], soLid: [] }, aprovarAutomaticamente: true });
    expect(r.aprovar).toEqual([LIVRE, "551133334444"]);
  });

  it("quem já está aberto em outro grupo da campanha (ou nas anteriores) não é aprovado, nas duas formas do nono dígito", () => {
    const r = planoAutomatico({ ...base, aprovarAutomaticamente: true, jaParticipam: ["551100000001"] });
    expect(r.aprovar).toEqual([LIVRE2]);
  });

  it("teto por grupo: max(9, metade de quem já está), pra nunca parecer entrada em massa", () => {
    const muitos = Array.from({ length: 80 }, (_, i) => p(`55119${String(i).padStart(8, "0")}`));
    const plano = (membros: number) => planoAutomatico({ ...base, pedidos: { livres: muitos, bloqueados: [], soLid: [] }, aprovarAutomaticamente: true, vagas: 1000, membros });
    expect(plano(4).aprovar).toHaveLength(9);
    expect(plano(19).aprovar).toHaveLength(9);
    expect(plano(30).aprovar).toHaveLength(15);
    expect(plano(500).aprovar).toHaveLength(50);
  });

  it("tetoEntradaSegura nunca dispara a trava de entrada em massa na rodada seguinte", () => {
    for (let membros = 0; membros <= 300; membros++) {
      const n = tetoEntradaSegura(membros);
      const lista = Array.from({ length: membros + n }, (_, i) => `55119${String(i).padStart(8, "0")}`);
      expect(rodadaSuspeita({ conhecidos: membros, lista, entraram: n, sairam: 0, telefonesConexao: [] }), `membros=${membros}`).toBeNull();
    }
    expect(tetoEntradaSegura(Number.NaN)).toBe(9);
  });

  it("rodada suspeita: nada, com as duas regras ligadas", () => {
    expect(planoAutomatico({ ...base, recusarBloqueados: true, aprovarAutomaticamente: true, suspeita: true })).toEqual({ aprovar: [], recusar: [], motivo: {} });
  });
});

describe("vagasDoGrupo", () => {
  it("limite − membros; cheio = 0; nunca negativo", () => {
    expect(vagasDoGrupo(1000, 990, false)).toBe(10);
    expect(vagasDoGrupo(1000, 990, true)).toBe(0);
    expect(vagasDoGrupo(100, 150, false)).toBe(0);
    expect(vagasDoGrupo(null, 1, false)).toBe(0);
  });
});

describe("filtrarPorNumero", () => {
  const lista = [{ telefone: "5511" + "987654321" }, { telefone: "5521" + "912345678" }, { telefone: null }];
  it("busca vazia devolve tudo", () => {
    expect(filtrarPorNumero(lista, "  ")).toHaveLength(3);
  });
  it("número completo (com máscara, sem 55 ou sem o nono dígito) acha; pedaço do número não", () => {
    expect(filtrarPorNumero(lista, "+55 (11) " + "98765-4321")).toEqual([lista[0]]);
    expect(filtrarPorNumero(lista, "11" + "987654321")).toEqual([lista[0]]);
    expect(filtrarPorNumero(lista, "551187654321")).toEqual([lista[0]]);
    expect(filtrarPorNumero(lista, "98765")).toEqual([]);
  });
});

describe("textos", () => {
  it("resposta dos botões e histórico", () => {
    expect(mensagemDecisao("aprovada", { ok: 3, bloqueados: 1, falhas: 2 })).toBe("3 aprovada(s); 1 não aprovada(s) por bloqueio; 2 falharam");
    expect(mensagemDecisao("recusada", { ok: 3, bloqueados: 0, falhas: 0 })).toBe("3 recusada(s); 0 falharam");
    expect(resumoHistoricoDecisao(3, 0)).toBe("Solicitações de entrada: +3 aprovadas, −0 recusadas");
  });
});

// Migração de verdade (todas, em ordem) num Postgres em memória.
describe("migração 20261017220200_solicitacoes_entrada", () => {
  let d: PGlite;
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
    const pasta = path.resolve(__dirname, "../supabase/migrations");
    for (const f of readdirSync(pasta).filter((x) => x.endsWith(".sql")).sort()) await d.exec(readFileSync(path.join(pasta, f), "utf8"));
  }, 120_000);
  afterAll(async () => {
    await d?.close();
  });

  const um = async <T>(sql: string, args: unknown[] = []) => (await d.query<T>(sql, args)).rows[0];
  let conexao: string;
  let campanha: string;
  let grupo: string;
  beforeAll(async () => {
    conexao = (await um<{ id: string }>("insert into conexoes (nome, webhook_secret, status, zapbot_token_enc) values ('n1', 's', 'conectado', 'x') returning id")).id;
    campanha = (await um<{ id: string }>("insert into campanhas (nome, slug, conexao_criadora_id) values ('sol', 'sol', $1) returning id", [conexao])).id;
    grupo = (await um<{ id: string }>("insert into grupos (campanha_id, conexao_id, group_id, nome, numero) values ($1, $2, 'g-sol@g.us', 'Turma', 1) returning id", [campanha, conexao])).id;
  });

  it("colunas novas nascem false (nenhum pedido lido nem respondido = hoje)", async () => {
    expect(await um("select recusar_bloqueados, aprovar_automaticamente, aprovacao_entrada from campanhas where id = $1", [campanha])).toEqual({
      recusar_bloqueados: false,
      aprovar_automaticamente: false,
      aprovacao_entrada: false,
    });
  });

  it("solicitacoes_entrada: checks de decisão/origem/resultado; grupo apagado vira null; campanha apagada leva junto", async () => {
    const linha = { telefone: "5511" + "900000001", decisao: "aprovada", origem: "manual", resultado: "ok" };
    const ins = (o: Record<string, unknown>) =>
      d.query("insert into solicitacoes_entrada (campanha_id, grupo_id, grupo_nome, telefone, decisao, origem, resultado) values ($1, $2, 'Turma', $3, $4, $5, $6) returning id", [
        campanha, grupo, o.telefone, o.decisao, o.origem, o.resultado,
      ]);
    await ins(linha);
    await expect(ins({ ...linha, decisao: "talvez" })).rejects.toThrow(/check/);
    await expect(ins({ ...linha, origem: "api" })).rejects.toThrow(/check/);
    await expect(ins({ ...linha, resultado: "parcial" })).rejects.toThrow(/check/);
    expect(await um("select count(*)::int as n from solicitacoes_entrada where campanha_id = $1", [campanha])).toEqual({ n: 1 });
    await d.query("delete from grupos where id = $1", [grupo]);
    expect(await um("select grupo_id, grupo_nome from solicitacoes_entrada where campanha_id = $1", [campanha])).toEqual({ grupo_id: null, grupo_nome: "Turma" });
    await d.query("delete from campanhas where id = $1", [campanha]);
    expect(await um("select count(*)::int as n from solicitacoes_entrada")).toEqual({ n: 0 });
  });

  it("grants: authenticated só lê; service_role lê e insere; anon nada; authenticated não insere nem apaga", async () => {
    const c = (await um<{ id: string }>("insert into campanhas (nome, slug, conexao_criadora_id) values ('sol2', 'sol2', $1) returning id", [conexao])).id;
    const inserir = () => d.query("insert into solicitacoes_entrada (campanha_id, telefone, decisao, origem, resultado) values ($1, '5511" + "900000009', 'recusada', 'automatica', 'erro')", [c]);
    await d.query("set role service_role");
    try {
      await inserir();
      expect((await d.query("select id from solicitacoes_entrada where campanha_id = $1", [c])).rows.length).toBeGreaterThan(0);
    } finally {
      await d.query("reset role");
    }
    await d.query("set role authenticated");
    try {
      expect((await d.query("select id from solicitacoes_entrada where campanha_id = $1", [c])).rows.length).toBeGreaterThan(0);
      await expect(inserir()).rejects.toThrow(/permission denied/);
      await expect(d.query("delete from solicitacoes_entrada where campanha_id = $1", [c])).rejects.toThrow(/permission denied/);
    } finally {
      await d.query("reset role");
    }
    await d.query("set role anon");
    try {
      await expect(d.query("select id from solicitacoes_entrada")).rejects.toThrow(/permission denied/);
    } finally {
      await d.query("reset role");
    }
  });

  it("exportacoes.tipo: os 3 de hoje continuam e 'solicitacoes' entra", async () => {
    for (const tipo of ["leads", "status_mensagens", "historico_mensagens", "solicitacoes"]) {
      await d.query("insert into exportacoes (tipo, filtros, nome_arquivo) values ($1, '{}', 'x.csv')", [tipo]);
    }
    await expect(d.query("insert into exportacoes (tipo, filtros, nome_arquivo) values ('outro', '{}', 'x.csv')")).rejects.toThrow(/check/);
  });
});

describe("planoAutomatico com aprovação por tag (Etapa 3N)", () => {
  const ESTRANGEIRO = "14155550100"; // EUA: não é BR, mas não é LID
  const LID_SEM_SUFIXO = "551234567890123"; // 15 dígitos começando com 55
  const sep = separarPedidos([p(LIVRE), p(LIVRE2), p(BLOQ), p(LID), p(ESTRANGEIRO), p(LID_SEM_SUFIXO)], { bloqueados: [BLOQ_SEM_9], lidsBloqueados: [] });
  const base = { pedidos: sep, recusarBloqueados: false, aprovarAutomaticamente: false, vagas: 100, suspeita: false, membros: 1000 };

  it("bloqueado com tag nunca é aprovado (nem pela forma sem o nono dígito); LID com tag nunca", () => {
    const r = planoAutomatico({ ...base, aprovarPorTag: true, comTag: [BLOQ_SEM_9, BLOQ, LID, "123456789012345", LID_SEM_SUFIXO, LIVRE] });
    expect(r.aprovar).toEqual([LIVRE]);
    expect(r.motivo).toEqual({ [LIVRE]: MOTIVO_TAG });
  });

  it("tag não exige número BR nem passa por jaParticipam (a tag é escolha explícita)", () => {
    const r = planoAutomatico({ ...base, aprovarPorTag: true, comTag: [ESTRANGEIRO, LIVRE2], jaParticipam: [LIVRE2] });
    expect(r.aprovar).toEqual([LIVRE2, ESTRANGEIRO]);
  });

  it("tag casa nas duas formas do nono dígito", () => {
    expect(planoAutomatico({ ...base, aprovarPorTag: true, comTag: ["551100000001"] }).aprovar).toEqual([LIVRE]);
  });

  it("união com a regra de hoje, sem repetir, com o motivo de cada um (tag tem preferência)", () => {
    const r = planoAutomatico({ ...base, aprovarAutomaticamente: true, aprovarPorTag: true, comTag: [LIVRE2, ESTRANGEIRO] });
    expect(r.aprovar).toEqual([LIVRE, LIVRE2, ESTRANGEIRO]);
    expect(r.motivo).toEqual({ [LIVRE]: MOTIVO_AUTOMATICO, [LIVRE2]: MOTIVO_TAG, [ESTRANGEIRO]: MOTIVO_TAG });
  });

  it("interruptor desligado ignora a lista de tags", () => {
    expect(planoAutomatico({ ...base, aprovarPorTag: false, comTag: [LIVRE] }).aprovar).toEqual([]);
  });

  it("respeita vagas, teto de entrada segura e rodada suspeita", () => {
    const muitos = Array.from({ length: 30 }, (_, i) => `55119100000${String(i).padStart(2, "0")}`);
    const s2 = { livres: muitos.map(p), bloqueados: [], soLid: [] };
    expect(planoAutomatico({ ...base, pedidos: s2, aprovarPorTag: true, comTag: muitos, vagas: 2 }).aprovar).toHaveLength(2);
    expect(planoAutomatico({ ...base, pedidos: s2, aprovarPorTag: true, comTag: muitos, vagas: 0 }).aprovar).toEqual([]);
    expect(planoAutomatico({ ...base, pedidos: s2, aprovarPorTag: true, comTag: muitos, membros: 4 }).aprovar).toHaveLength(9);
    expect(planoAutomatico({ ...base, pedidos: s2, aprovarPorTag: true, comTag: muitos, suspeita: true })).toEqual({ aprovar: [], recusar: [], motivo: {} });
  });
});

describe("reservadosDoGrupo", () => {
  const agora = "2026-10-17T12:00:00.000Z";
  it("conexão os pedidos de até 48 h (pedido_em; sem ele, visto_em)", () => {
    expect(
      reservadosDoGrupo(
        [
          { pedido_em: "2026-10-17T11:00:00.000Z", visto_em: "2026-10-17T11:59:00.000Z" },
          { pedido_em: "2026-10-15T12:00:00.000Z", visto_em: "2026-10-17T11:59:00.000Z" }, // exatamente 48 h: conta
          { pedido_em: "2026-10-15T11:59:00.000Z", visto_em: "2026-10-17T11:59:00.000Z" }, // pediu há mais de 48 h
          { pedido_em: null, visto_em: "2026-10-16T12:00:00.000Z" },
          { pedido_em: null, visto_em: "2026-10-14T12:00:00.000Z" },
        ],
        agora,
      ),
    ).toBe(3);
    expect(reservadosDoGrupo([], agora)).toBe(0);
  });
});

describe("reservadosEmVigor", () => {
  const agora = "2026-10-17T12:00:00.000Z";
  it("só com a reserva ligada e lida há até 15 min", () => {
    expect(reservadosEmVigor({ ligada: true, reservados: 4, lidosEm: "2026-10-17T11:45:00.000Z", agora })).toBe(4);
    expect(reservadosEmVigor({ ligada: true, reservados: 4, lidosEm: "2026-10-17T11:44:59.000Z", agora })).toBe(0);
    expect(reservadosEmVigor({ ligada: true, reservados: 4, lidosEm: null, agora })).toBe(0);
    expect(reservadosEmVigor({ ligada: false, reservados: 4, lidosEm: agora, agora })).toBe(0);
    expect(reservadosEmVigor({ ligada: true, reservados: -2, lidosEm: agora, agora })).toBe(0);
    expect(reservadosEmVigor({ ligada: true, reservados: null, lidosEm: agora, agora })).toBe(0);
  });
});

describe("reconciliarLeitura", () => {
  const V = (telefone: string, visto_em = "2026-10-17T10:00:00.000Z") => ({ telefone, visto_em, pedido_em: null });
  const base = { participantesNovos: [], decididos: [] };

  it("leitura parcial não fecha nada (só aponta os novos)", () => {
    const r = reconciliarLeitura({ ...base, vistos: [V(LIVRE)], lidos: [p(LIVRE2)], completa: false });
    expect(r).toEqual({ novos: [LIVRE2], sumiram: [], manter: [V(LIVRE)], descartados: [] });
  });

  it("sumiu e entrou depois de visto_em (em qualquer forma do nono dígito) = aprovada pelo WhatsApp", () => {
    const r = reconciliarLeitura({ ...base, vistos: [V(LIVRE)], lidos: [], completa: true, participantesNovos: [{ telefone: "551100000001", entrou_em: "2026-10-17T10:01:00.000Z" }] });
    expect(r.sumiram).toEqual([{ telefone: LIVRE, decisao: "aprovada" }]);
  });

  it("entrada ANTES de visto_em não conexão: sumiu sem entrar = cancelada", () => {
    const r = reconciliarLeitura({ ...base, vistos: [V(LIVRE)], lidos: [], completa: true, participantesNovos: [{ telefone: LIVRE, entrou_em: "2026-10-17T09:00:00.000Z" }] });
    expect(r.sumiram).toEqual([{ telefone: LIVRE, decisao: "cancelada" }]);
  });

  it("LID que sumiu fica em manter (nunca cancelada)", () => {
    const r = reconciliarLeitura({ ...base, vistos: [V(LID), V("120363012345678")], lidos: [], completa: true });
    expect(r.sumiram).toEqual([]);
    expect(r.manter.map((v) => v.telefone)).toEqual([LID, "120363012345678"]);
  });

  it("decidido pelo Vórtex Grupo depois de visto_em não duplica (vai pra descartados)", () => {
    const r = reconciliarLeitura({
      ...base,
      vistos: [V(LIVRE), V(LIVRE2)],
      lidos: [],
      completa: true,
      decididos: [{ telefone: LIVRE, created_at: "2026-10-17T10:05:00.000Z" }],
      participantesNovos: [{ telefone: LIVRE, entrou_em: "2026-10-17T10:06:00.000Z" }],
    });
    expect(r.descartados).toEqual([LIVRE]);
    expect(r.sumiram).toEqual([{ telefone: LIVRE2, decisao: "cancelada" }]);
  });

  it("quem continua na lista fica em `manter`; sem participantes frescos (aba Pendentes) ninguém é cancelado", () => {
    const r = reconciliarLeitura({ ...base, vistos: [V(LIVRE), V(LIVRE2)], lidos: [p(LIVRE)], completa: true, participantesFrescos: false });
    expect(r.manter.map((v) => v.telefone)).toEqual([LIVRE, LIVRE2]);
    expect(r.sumiram).toEqual([]);
    const r2 = reconciliarLeitura({ ...base, vistos: [V(LIVRE2)], lidos: [], completa: true, participantesFrescos: false, participantesNovos: [{ telefone: LIVRE2, entrou_em: "2026-10-17T11:00:00.000Z" }] });
    expect(r2.sumiram).toEqual([{ telefone: LIVRE2, decisao: "aprovada" }]);
  });
});

describe("filtros do Histórico de solicitações", () => {
  it("botões e rótulos", () => {
    expect(FILTROS_HISTORICO.map((f) => ROTULO_FILTRO_HISTORICO[f])).toEqual(["TODAS", "APROVADAS", "REJEITADAS", "CANCELADAS", "EXPIRADAS"]);
  });
  it("mapeamento de cada filtro pras linhas de solicitacoes_entrada", () => {
    expect(condicaoFiltroHistorico("todas")).toEqual({});
    expect(condicaoFiltroHistorico("aprovadas")).toEqual({ decisao: "aprovada", resultado: "ok" });
    expect(condicaoFiltroHistorico("rejeitadas")).toEqual({ decisao: "recusada", resultado: "ok" });
    expect(condicaoFiltroHistorico("canceladas")).toEqual({ decisao: "cancelada" });
    expect(condicaoFiltroHistorico("expiradas")).toEqual({ decisao: "expirada" });
  });
  it("lerFiltroHistorico: valor desconhecido ou ausente = todas", () => {
    expect(lerFiltroHistorico("APROVADAS")).toBe("aprovadas");
    expect(lerFiltroHistorico(" expiradas ")).toBe("expiradas");
    expect(lerFiltroHistorico("outra")).toBe("todas");
    expect(lerFiltroHistorico(undefined)).toBe("todas");
    expect(lerFiltroHistorico(["aprovadas"])).toBe("todas");
  });
  it("rótulos novos de decisão e origem (os de antes continuam)", () => {
    expect(ROTULO_DECISAO).toEqual({ aprovada: "Aprovada", recusada: "Recusada", cancelada: "Cancelada", expirada: "Expirada" });
    expect(ROTULO_ORIGEM).toEqual({ manual: "Manual", automatica: "Automática", whatsapp: "Pelo WhatsApp" });
  });
});

describe("migração 20261017240100_solicitacoes_v2", () => {
  let d: PGlite;
  const um = async <T>(sql: string, args: unknown[] = []) => (await d.query<T>(sql, args)).rows[0];
  const antes = { campanha: "", grupo: "", conexao: "" };
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
    const pasta = path.resolve(__dirname, "../supabase/migrations");
    const todas = readdirSync(pasta).filter((x) => x.endsWith(".sql")).sort();
    // Linhas "de antes": gravadas antes da migração nova, pra provar que ela é só aditiva.
    for (const f of todas.filter((x) => x < "20261017240100")) await d.exec(readFileSync(path.join(pasta, f), "utf8"));
    antes.conexao = (await um<{ id: string }>("insert into conexoes (nome, webhook_secret, status, zapbot_token_enc) values ('n1', 's', 'conectado', 'x') returning id")).id;
    antes.campanha = (await um<{ id: string }>("insert into campanhas (nome, slug, conexao_criadora_id) values ('v2', 'v2', $1) returning id", [antes.conexao])).id;
    antes.grupo = (await um<{ id: string }>("insert into grupos (campanha_id, conexao_id, group_id, nome, numero) values ($1, $2, 'g-v2@g.us', 'Turma', 1) returning id", [antes.campanha, antes.conexao])).id;
    await d.query("insert into solicitacoes_entrada (campanha_id, grupo_id, telefone, decisao, origem, resultado) values ($1, $2, '5511" + "900000001', 'aprovada', 'manual', 'ok')", [antes.campanha, antes.grupo]);
    for (const f of todas.filter((x) => x >= "20261017240100")) await d.exec(readFileSync(path.join(pasta, f), "utf8"));
  }, 120_000);
  afterAll(async () => {
    await d?.close();
  });

  it("colunas novas nascem desligadas/vazias/0 (a conexão e as chamadas de hoje)", async () => {
    expect(await um("select reservar_vaga_pendentes, aprovar_por_tag, aprovar_tags from campanhas where id = $1", [antes.campanha])).toEqual({
      reservar_vaga_pendentes: false,
      aprovar_por_tag: false,
      aprovar_tags: [],
    });
    expect(await um("select pendentes_reservados, pendentes_lidos_em from grupos where id = $1", [antes.grupo])).toEqual({ pendentes_reservados: 0, pendentes_lidos_em: null });
    await expect(d.query("update grupos set pendentes_reservados = -1 where id = $1", [antes.grupo])).rejects.toThrow(/check/);
  });

  it("aprovar_tags: até 20, sem FK (qualquer uuid é aceito; a action confere)", async () => {
    const vinte = Array.from({ length: 20 }, () => "gen_random_uuid()").join(", ");
    await d.query(`update campanhas set aprovar_tags = array[${vinte}] where id = $1`, [antes.campanha]);
    await expect(d.query(`update campanhas set aprovar_tags = array[${vinte}, gen_random_uuid()] where id = $1`, [antes.campanha])).rejects.toThrow(/check/);
    const fks = await d.query(
      `select conname from pg_constraint where contype = 'f' and conrelid = 'campanhas'::regclass
         and conkey && (select array_agg(attnum) from pg_attribute where attrelid = 'campanhas'::regclass and attname in ('aprovar_tags', 'aprovar_por_tag', 'reservar_vaga_pendentes'))`,
    );
    expect(fks.rows).toEqual([]);
  });

  it("solicitacoes_vistas: chave (grupo, telefone), sem campanha na chave (não vira junção grupos×campanhas); cascatas", async () => {
    const pk = await d.query<{ col: string }>(
      `select a.attname as col from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
        where c.conrelid = 'solicitacoes_vistas'::regclass and c.contype = 'p' order by a.attname`,
    );
    expect(pk.rows.map((r) => r.col)).toEqual(["grupo_id", "telefone"]);
    const fks = await d.query<{ alvo: string }>("select confrelid::regclass::text as alvo from pg_constraint where conrelid = 'solicitacoes_vistas'::regclass and contype = 'f' order by 1");
    expect(fks.rows.map((r) => r.alvo)).toEqual(["campanhas", "grupos"]);
    const ins = () => d.query("insert into solicitacoes_vistas (grupo_id, campanha_id, telefone) values ($1, $2, '5511" + "900000002')", [antes.grupo, antes.campanha]);
    await ins();
    await expect(ins()).rejects.toThrow(/duplicate|unique/);
    const v = await um<{ visto_em: string; ultimo_visto_em: string; pedido_em: string | null }>("select visto_em, ultimo_visto_em, pedido_em from solicitacoes_vistas where telefone = '5511" + "900000002'");
    expect(v.visto_em).not.toBeNull();
    expect(v.ultimo_visto_em).not.toBeNull();
    expect(v.pedido_em).toBeNull();
    expect(await um("select count(*)::int as n from pg_indexes where indexname = 'solicitacoes_vistas_ultimo_visto'")).toEqual({ n: 1 });
    const g2 = (await um<{ id: string }>("insert into grupos (campanha_id, conexao_id, group_id, nome, numero) values ($1, $2, 'g-v2b@g.us', 'Turma 2', 2) returning id", [antes.campanha, antes.conexao])).id;
    await d.query("insert into solicitacoes_vistas (grupo_id, campanha_id, telefone) values ($1, $2, '5511" + "900000003')", [g2, antes.campanha]);
    await d.query("delete from grupos where id = $1", [g2]);
    expect(await um("select count(*)::int as n from solicitacoes_vistas where telefone = '5511" + "900000003'")).toEqual({ n: 0 });
  });

  it("solicitacoes_vistas: RLS ligada; authenticated só lê; anon nada; service_role escreve", async () => {
    const priv = async (r: string, pr: string) => (await um<{ ok: boolean }>(`select has_table_privilege('${r}', 'solicitacoes_vistas', '${pr}') as ok`)).ok;
    expect(await priv("authenticated", "select")).toBe(true);
    for (const pr of ["insert", "update", "delete"]) expect(await priv("authenticated", pr)).toBe(false);
    expect(await priv("anon", "select")).toBe(false);
    for (const pr of ["select", "insert", "update", "delete"]) expect(await priv("service_role", pr)).toBe(true);
    expect(await um("select relrowsecurity from pg_class where relname = 'solicitacoes_vistas'")).toEqual({ relrowsecurity: true });
  });

  it("solicitacoes_entrada: a linha de antes continua; decisões e origens antigas valem; entram cancelada, expirada e whatsapp", async () => {
    expect(await um("select decisao, origem from solicitacoes_entrada where campanha_id = $1", [antes.campanha])).toEqual({ decisao: "aprovada", origem: "manual" });
    const ins = (decisao: string, origem: string) =>
      d.query("insert into solicitacoes_entrada (campanha_id, telefone, decisao, origem, resultado) values ($1, '5511" + "900000009', $2, $3, 'ok')", [antes.campanha, decisao, origem]);
    for (const dec of ["aprovada", "recusada", "cancelada", "expirada"]) for (const o of ["manual", "automatica", "whatsapp"]) await ins(dec, o);
    await expect(ins("talvez", "manual")).rejects.toThrow(/check/);
    await expect(ins("aprovada", "api")).rejects.toThrow(/check/);
    const nomes = await d.query<{ conname: string }>("select conname from pg_constraint where conrelid = 'solicitacoes_entrada'::regclass and contype = 'c' order by 1");
    expect(nomes.rows.map((r) => r.conname)).toEqual(["solicitacoes_entrada_decisao_check", "solicitacoes_entrada_origem_check", "solicitacoes_entrada_resultado_check"]);
  });
});

describe("telas (estático)", () => {
  const ler = (r: string) => readFileSync(path.resolve(__dirname, "..", r), "utf8");
  it("as três páginas da aba guardam com bloqueio('campanhas')", () => {
    for (const r of ["page.tsx", "processadas/page.tsx", "configuracoes/page.tsx"]) {
      expect(ler(`app/(painel)/campanhas/[id]/solicitacoes/${r}`), r).toContain('await bloqueio("campanhas")');
    }
  });
  it("a nota 'O WhatsApp não deixa o Vórtex Grupo responder pedidos de entrada…' some dos diálogos e o interruptor funciona", () => {
    for (const r of ["app/(painel)/campanhas/[id]/grupos/criacao.tsx", "app/(painel)/campanhas/padrao-criacao.tsx", "app/(painel)/campanhas/[id]/grupos/actions.ts"]) {
      expect(ler(r), r).not.toContain("não deixa o Vórtex Grupo responder pedidos");
    }
    expect(ler("app/(painel)/campanhas/[id]/grupos/criacao.tsx")).toContain('set("recusar_bloqueados"');
    expect(ler("app/(painel)/campanhas/padrao-criacao.tsx")).toContain('set("recusar_bloqueados"');
  });
});
