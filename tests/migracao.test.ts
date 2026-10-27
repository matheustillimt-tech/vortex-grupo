import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Roda as migrações de verdade num Postgres em memória (PGlite), com o mínimo que o Supabase já traz pronto.
const PRE_SUPABASE = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema extensions;
  create schema auth;
  create table auth.users (id uuid primary key);
  -- Simula auth.uid(): lê o "sub" de request.jwt.claims (como o Supabase faz via PostgREST).
  create or replace function auth.uid() returns uuid language sql stable as $$
    select (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::uuid
  $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text not null, public boolean default false);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text);
  alter table storage.objects enable row level security;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
`;

const PASTA = path.resolve(__dirname, "../supabase/migrations");
const INICIAL = readFileSync(path.join(PASTA, "20261015120000_inicial.sql"), "utf8");
const FASE2A = readFileSync(path.join(PASTA, "20261016120000_fase2a.sql"), "utf8");
const RESUMO = readFileSync(path.join(PASTA, "20261016140000_resumo_campanhas.sql"), "utf8");
const GRUPOS_MENSAGENS = readFileSync(path.join(PASTA, "20261016150000_grupos_mensagens.sql"), "utf8");
const METRICAS_GERAIS = readFileSync(path.join(PASTA, "20261016160000_metricas_gerais.sql"), "utf8");
const AUTOMACOES = readFileSync(path.join(PASTA, "20261016170000_automacoes.sql"), "utf8");
const AUTOMACOES2 = readFileSync(path.join(PASTA, "20261016180000_automacoes_parte2.sql"), "utf8");
const BLOCO2B = readFileSync(path.join(PASTA, "20261016190000_bloco2b.sql"), "utf8");
const MODELOS_VARIAVEIS = readFileSync(path.join(PASTA, "20261016200000_modelos_variaveis.sql"), "utf8");
const WEBHOOKS_HISTORICO = readFileSync(path.join(PASTA, "20261016210000_webhooks_historico.sql"), "utf8");
const PROJETOS = readFileSync(path.join(PASTA, "20261016220000_projetos.sql"), "utf8");
const MEMBROS = readFileSync(path.join(PASTA, "20261016230000_membros.sql"), "utf8");
const ALERTAS_CONEXAO = readFileSync(path.join(PASTA, "20261017090000_alertas_conexao.sql"), "utf8");
const LISTAR_ACOES = readFileSync(path.join(PASTA, "20261017100000_listar_acoes.sql"), "utf8");
const ACOES_V2 = readFileSync(path.join(PASTA, "20261017110000_acoes_v2.sql"), "utf8");
const CAMPANHA_EXTRAS = readFileSync(path.join(PASTA, "20261017120000_campanha_extras.sql"), "utf8");
const CAMPANHA_CONTAS = readFileSync(path.join(PASTA, "20261017120100_campanha_contas.sql"), "utf8");
const GRUPOS_EXTRAS = readFileSync(path.join(PASTA, "20261017130000_grupos_extras.sql"), "utf8");
const AUTOMACOES_V3 = readFileSync(path.join(PASTA, "20261017140000_automacoes_v3.sql"), "utf8");
const LISTAR_ACOES_AUTOMACAO = readFileSync(path.join(PASTA, "20261017140100_listar_acoes_automacao.sql"), "utf8");
const AUTOMACOES_CONTAS_VENDAS = readFileSync(path.join(PASTA, "20261017140200_automacoes_contas_vendas.sql"), "utf8");
const RECIBOS_PESSOA = readFileSync(path.join(PASTA, "20261017150000_recibos_pessoa.sql"), "utf8");
const ANALISES_RPC = readFileSync(path.join(PASTA, "20261017150100_analises_rpc.sql"), "utf8");
const DIAGNOSTICO_TODOS = readFileSync(path.join(PASTA, "20261020130000_diagnostico_todos_grupos.sql"), "utf8");
const CONEXOES_PROJETO = readFileSync(path.join(PASTA, "20261017150200_conexoes_projeto.sql"), "utf8");
const CONTA_CAMPANHAS = readFileSync(path.join(PASTA, "20261017150300_conta_campanhas.sql"), "utf8");
const INTEGRACOES = readFileSync(path.join(PASTA, "20261017160000_integracoes.sql"), "utf8");
const DEEPLINKS = readFileSync(path.join(PASTA, "20261017160100_deeplinks.sql"), "utf8");
const BLACKLISTS = readFileSync(path.join(PASTA, "20261017160200_blacklists.sql"), "utf8");
const API = readFileSync(path.join(PASTA, "20261017170000_api.sql"), "utf8");
const CONTATOS = readFileSync(path.join(PASTA, "20261017180000_contatos.sql"), "utf8");
const CAMPANHA_SECOES = readFileSync(path.join(PASTA, "20261017190000_campanha_secoes.sql"), "utf8");
const LINKS_ENTREGAS = readFileSync(path.join(PASTA, "20261017190100_links_entregas.sql"), "utf8");
const AUTOMACOES_PESSOA = readFileSync(path.join(PASTA, "20261017190200_automacoes_pessoa.sql"), "utf8");
const ACOES_ENCADEADAS = readFileSync(path.join(PASTA, "20261017190300_acoes_encadeadas.sql"), "utf8");
const LINKS_ENTREGAS_AJUSTES = readFileSync(path.join(PASTA, "20261017190400_links_entregas_ajustes.sql"), "utf8");
const LISTAR_ACOES_ENCADEADAS = readFileSync(path.join(PASTA, "20261017190500_listar_acoes_encadeadas.sql"), "utf8");
const ADMINS_NUMEROS = readFileSync(path.join(PASTA, "20261017200000_admins_numeros.sql"), "utf8");
const MOTIVO_CONEXAO = readFileSync(path.join(PASTA, "20261019150000_motivo_conexao_saiu.sql"), "utf8");

/** Migrações até Projetos (2J), antes de Membros (2K) — usado pra montar um banco limpo e inserir em auth.users
 *  antes de rodar a migração de Membros nos testes dela. */
const MIGRACOES_ATE_PROJETOS = [INICIAL, FASE2A, RESUMO, GRUPOS_MENSAGENS, METRICAS_GERAIS, AUTOMACOES, AUTOMACOES2, BLOCO2B, MODELOS_VARIAVEIS, WEBHOOKS_HISTORICO, PROJETOS];

async function bancoAtéProjetos(): Promise<PGlite> {
  const d = new PGlite({ extensions: { pgcrypto } });
  await d.exec(PRE_SUPABASE);
  for (const m of MIGRACOES_ATE_PROJETOS) await d.exec(m);
  return d;
}

let db: PGlite;
/** Ids das linhas da Fase 1 gravadas antes da migração 2A (provam que a renomeação não perde nada). */
let antigos: { mensagem: string; agendada: string; envio: string; grupo: string };

async function um<T>(sql: string, params: unknown[] = []): Promise<T> {
  const r = await db.query<T>(sql, params);
  return r.rows[0];
}

/** Como `um`, mas num banco (PGlite) à parte do `db` global — usado pelos testes de Membros. */
async function um2<T>(d: PGlite, sql: string, params: unknown[] = []): Promise<T> {
  const r = await d.query<T>(sql, params);
  return r.rows[0];
}

async function comoPapel<T>(papel: string, f: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${papel}`);
  try {
    return await f();
  } finally {
    await db.exec("reset role");
  }
}

async function seed() {
  const { id: conexao } = await um<{ id: string }>("insert into conexoes (nome, webhook_secret, status, zapbot_token_enc) values ('n1', 's', 'conectado', 'cifrado') returning id");
  const novaCampanha = async (slug: string) => (await um<{ id: string }>("insert into campanhas (nome, slug, conexao_criadora_id) values ($1, $1, $2) returning id", [slug, conexao])).id;
  const novoGrupo = async (campanha: string, n: number) =>
    (await um<{ id: string }>("insert into grupos (campanha_id, conexao_id, group_id, nome, numero) values ($1, $2, $3, $3, $4) returning id", [campanha, conexao, `g-${campanha}-${n}`, n])).id;
  return { conexao, novaCampanha, novoGrupo };
}

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(PRE_SUPABASE);
  await db.exec(INICIAL);
  // Dados no formato da Fase 1, gravados antes da migração 2A.
  const { conexao, novaCampanha, novoGrupo } = await seed();
  const camp = await novaCampanha("antiga");
  const grupo = await novoGrupo(camp, 1);
  const { id: mensagem } = await um<{ id: string }>(
    "insert into mensagens (campanha_id, tipo, texto, midia_url, nome_arquivo, status) values ($1, 'documento', 'guia', 'https://x/a.pdf', 'a.pdf', 'concluida') returning id",
    [camp],
  );
  const { id: agendada } = await um<{ id: string }>(
    "insert into mensagens (campanha_id, tipo, texto, mencionar_todos, agendada_para) values ($1, 'texto', 'amanhã', true, now() + interval '1 day') returning id",
    [camp],
  );
  const { id: envio } = await um<{ id: string }>(
    "insert into envios (mensagem_id, grupo_id, conexao_id, status, message_id, enviado_em) values ($1, $2, $3, 'enviado', 'MSG1', now()) returning id",
    [mensagem, grupo, conexao],
  );
  antigos = { mensagem, agendada, envio, grupo };
  await db.exec(FASE2A);
  await db.exec(RESUMO);
  await db.exec(GRUPOS_MENSAGENS);
  await db.exec(METRICAS_GERAIS);
  await db.exec(AUTOMACOES);
  await db.exec(AUTOMACOES2);
  await db.exec(BLOCO2B);
  await db.exec(MODELOS_VARIAVEIS);
  await db.exec(WEBHOOKS_HISTORICO);
  await db.exec(PROJETOS);
  await db.exec(MEMBROS);
  await db.exec(ALERTAS_CONEXAO);
  await db.exec(LISTAR_ACOES);
  await db.exec(ACOES_V2);
  await db.exec(CAMPANHA_EXTRAS);
  await db.exec(CAMPANHA_CONTAS);
  await db.exec(GRUPOS_EXTRAS);
  await db.exec(AUTOMACOES_V3);
  await db.exec(LISTAR_ACOES_AUTOMACAO);
  await db.exec(AUTOMACOES_CONTAS_VENDAS);
  await db.exec(RECIBOS_PESSOA);
  await db.exec(ANALISES_RPC);
  await db.exec(CONEXOES_PROJETO);
  await db.exec(CONTA_CAMPANHAS);
  await db.exec(INTEGRACOES);
  await db.exec(DEEPLINKS);
  await db.exec(BLACKLISTS);
  await db.exec(API);
  await db.exec(CONTATOS);
  await db.exec(CAMPANHA_SECOES);
  await db.exec(LINKS_ENTREGAS);
  await db.exec(AUTOMACOES_PESSOA);
  await db.exec(ACOES_ENCADEADAS);
  await db.exec(LINKS_ENTREGAS_AJUSTES);
  await db.exec(LISTAR_ACOES_ENCADEADAS);
  await db.exec(ADMINS_NUMEROS);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("migrações (inicial + Fase 2A + Bloco 2B)", () => {
  it("cria as 41 tabelas (com integracoes_checkout, deeplinks, blacklists e blacklist_numeros da Etapa 3H; api_chaves e api_uso da 3H2; contatos da 3I; campanha_admins_numeros da 3K)", async () => {
    const r = await um<{ n: number }>("select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'");
    expect(r.n).toBe(41);
    const p = await um<{ n: number }>("select count(*)::int as n from provedores_checkout");
    expect(p.n).toBe(4);
  });

  it("mensagens e envios da Fase 1 viram execucoes e tarefas sem perder nada", async () => {
    const e = await um<{ tipo: string; origem: string; status: string; conteudo: unknown; conteudo_final: unknown }>(
      "select tipo, origem, status, conteudo, conteudo_final from execucoes where id = $1",
      [antigos.mensagem],
    );
    const conteudo = { formato: "documento", texto: "guia", midia_url: "https://x/a.pdf", nome_arquivo: "a.pdf", mencionar_todos: false };
    expect(e).toEqual({ tipo: "mensagem", origem: "avulsa", status: "concluida", conteudo, conteudo_final: conteudo });

    const a = await um<{ status: string; conteudo: { formato: string; mencionar_todos: boolean }; conteudo_final: unknown }>(
      "select status, conteudo, conteudo_final from execucoes where id = $1",
      [antigos.agendada],
    );
    expect(a.status).toBe("agendada");
    expect(a.conteudo).toMatchObject({ formato: "texto", texto: "amanhã", mencionar_todos: true });
    expect(a.conteudo_final).toBeNull();

    const t = await um<{ execucao_id: string; tipo: string; prioridade: number; status: string; message_id: string; entregues: number }>(
      "select execucao_id, tipo, prioridade, status, message_id, entregues from tarefas where id = $1",
      [antigos.envio],
    );
    expect(t).toEqual({ execucao_id: antigos.mensagem, tipo: "mensagem", prioridade: 1, status: "enviado", message_id: "MSG1", entregues: 0 });
  });

  it("filas pegam o item vencido uma vez só (service role)", async () => {
    const { conexao, novaCampanha, novoGrupo } = await seed();
    const camp = await novaCampanha("filas");
    const grupo = await novoGrupo(camp, 1);
    const { id: exec } = await um<{ id: string }>("insert into execucoes (campanha_id, conteudo) values ($1, '{}') returning id", [camp]);
    await db.query("insert into tarefas (execucao_id, grupo_id, conexao_id, enviar_apos) values ($1, $2, $3, now() - interval '1 minute')", [exec, grupo, conexao]);
    await db.query("insert into acoes (tipo, campanha_id, origem) values ('criar_grupo', $1, 'teste')", [camp]);
    await db.query("insert into eventos_saida (campanha_id, url, payload) values ($1, 'https://exemplo.test', '{}')", [camp]);

    await comoPapel("service_role", async () => {
      for (const f of ["pegar_tarefas", "pegar_acoes", "pegar_eventos"]) {
        const primeira = await db.query(`select * from ${f}(10)`);
        expect(primeira.rows.length, f).toBe(1);
        const segunda = await db.query(`select * from ${f}(10)`);
        expect(segunda.rows.length, f).toBe(0);
      }
    });
  });

  it("pegar_tarefas: no mesmo horário, ação (prioridade 0) antes de mensagem (1)", async () => {
    const { conexao, novaCampanha, novoGrupo } = await seed();
    const camp = await novaCampanha("prioridade");
    const g1 = await novoGrupo(camp, 1);
    const g2 = await novoGrupo(camp, 2);
    const { id: msg } = await um<{ id: string }>("insert into execucoes (campanha_id, tipo) values ($1, 'mensagem') returning id", [camp]);
    const { id: nome } = await um<{ id: string }>("insert into execucoes (campanha_id, tipo) values ($1, 'nome') returning id", [camp]);
    // Mesmo horário exato nas três (now() mudaria entre um insert e outro).
    const quando = new Date(Date.now() - 30_000).toISOString();
    const inserir = "insert into tarefas (execucao_id, grupo_id, conexao_id, tipo, prioridade, enviar_apos) values ($1, $2, $3, $4, $5, $6)";
    await db.query(inserir, [msg, g1, conexao, "mensagem", 1, quando]);
    await db.query(inserir, [msg, g2, conexao, "mensagem", 1, quando]);
    await db.query(inserir, [nome, g1, conexao, "nome", 0, quando]);
    // Limite 1: a única que sai tem que ser a de prioridade 0.
    const r = await comoPapel("service_role", () => db.query<{ tipo: string }>("select tipo from pegar_tarefas(1)"));
    expect(r.rows).toEqual([{ tipo: "nome" }]);
    await db.query("update tarefas set status = 'enviado' where execucao_id in ($1, $2)", [msg, nome]);
  });

  it("tarefa presa em 'processando' há 10 min vira erro com aviso", async () => {
    const { conexao, novaCampanha, novoGrupo } = await seed();
    const camp = await novaCampanha("preso");
    const grupo = await novoGrupo(camp, 1);
    const { id: exec } = await um<{ id: string }>("insert into execucoes (campanha_id) values ($1) returning id", [camp]);
    const { id } = await um<{ id: string }>(
      "insert into tarefas (execucao_id, grupo_id, conexao_id, status, pego_em) values ($1, $2, $3, 'processando', now() - interval '10 minutes') returning id",
      [exec, grupo, conexao],
    );
    await comoPapel("service_role", () => db.query("select * from pegar_tarefas(10)"));
    const e = await um<{ status: string; erro: string }>("select status, erro from tarefas where id = $1", [id]);
    expect(e.status).toBe("erro");
    expect(e.erro).toContain("Tarefa interrompida");
  });

  it("somar_recibos soma entregue e lido pelo message_id", async () => {
    await comoPapel("service_role", async () => {
      await db.query("select somar_recibos(array['MSG1', 'OUTRO'], false)");
      await db.query("select somar_recibos(array['MSG1'], false)");
      await db.query("select somar_recibos(array['MSG1'], true)");
    });
    const t = await um<{ entregues: number; lidos: number }>("select entregues, lidos from tarefas where id = $1", [antigos.envio]);
    expect(t).toEqual({ entregues: 2, lidos: 1 });
  });

  it("resumo_execucoes agrega por execução (equipe logada)", async () => {
    const r = await comoPapel("authenticated", () =>
      db.query<{ total: number; feitas: number; erros: number; pendentes: number; entregues: number; lidos: number }>(
        "select total::int, feitas::int, erros::int, pendentes::int, entregues::int, lidos::int from resumo_execucoes(array[$1::uuid])",
        [antigos.mensagem],
      ),
    );
    expect(r.rows).toEqual([{ total: 1, feitas: 1, erros: 0, pendentes: 0, entregues: 2, lidos: 1 }]);
  });

  it("resultado_enquete soma os votos por opção", async () => {
    const r0 = await um<{ campanha_id: string }>("select campanha_id from execucoes where id = $1", [antigos.mensagem]);
    const { id: enquete } = await um<{ id: string }>("insert into execucoes (campanha_id, tipo) values ($1, 'enquete') returning id", [r0.campanha_id]);
    const votar = (tel: string, opcoes: string[]) =>
      db.query("insert into enquete_votos (execucao_id, grupo_id, telefone, opcoes) values ($1, $2, $3, $4)", [enquete, antigos.grupo, tel, opcoes]);
    await votar("5511", ["Sim"]);
    await votar("5522", ["Sim", "Talvez"]);
    await expect(votar("5511", ["Não"])).rejects.toThrow(/enquete_votos_pkey/);
    const r = await comoPapel("authenticated", () =>
      db.query<{ opcao: string; votos: number }>("select opcao, votos::int from resultado_enquete($1) order by opcao", [enquete]),
    );
    expect(r.rows).toEqual([{ opcao: "Sim", votos: 2 }, { opcao: "Talvez", votos: 1 }]);
  });

  it("um passo vira no máximo uma execução por campanha; avulsas não colidem", async () => {
    const { novaCampanha } = await seed();
    const camp = await novaCampanha("unico-passo");
    const { id: seq } = await um<{ id: string }>("insert into sequencias (nome) values ('Webinário') returning id");
    const { id: passo } = await um<{ id: string }>(
      "insert into sequencia_passos (sequencia_id, dia_relativo, hora, tipo) values ($1, 0, '19:50', 'abrir') returning id",
      [seq],
    );
    await db.query("insert into execucoes (campanha_id, origem, passo_id, tipo) values ($1, 'sequencia', $2, 'abrir')", [camp, passo]);
    await expect(db.query("insert into execucoes (campanha_id, origem, passo_id, tipo) values ($1, 'sequencia', $2, 'abrir')", [camp, passo])).rejects.toThrow(
      /execucoes_passo_unico/,
    );
    // ON CONFLICT DO NOTHING (o upsert do PostgREST com ignoreDuplicates) não falha nem duplica.
    await db.query("insert into execucoes (campanha_id, origem, passo_id, tipo) values ($1, 'sequencia', $2, 'abrir') on conflict (campanha_id, passo_id) do nothing", [camp, passo]);
    await db.query("insert into execucoes (campanha_id) values ($1), ($1)", [camp]);
    await expect(db.query("insert into execucoes (campanha_id, origem, passo_id) values ($1, 'avulsa', $2)", [camp, passo])).rejects.toThrow(
      /execucoes_passo_so_sequencia/,
    );
    const n = await um<{ n: number }>("select count(*)::int as n from execucoes where campanha_id = $1", [camp]);
    expect(n.n).toBe(3);
  });

  it("execucoes.iniciada_em: timestamptz opcional (vazia nas linhas antigas, gravada quando o tick pega)", async () => {
    const col = await um<{ data_type: string; is_nullable: string }>(
      "select data_type, is_nullable from information_schema.columns where table_name = 'execucoes' and column_name = 'iniciada_em'",
    );
    expect(col).toEqual({ data_type: "timestamp with time zone", is_nullable: "YES" });
    const antiga = await um<{ iniciada_em: string | null }>("select iniciada_em from execucoes where id = $1", [antigos.mensagem]);
    expect(antiga.iniciada_em).toBeNull();
    await db.query("update execucoes set status = 'enviando', iniciada_em = now() where id = $1", [antigos.agendada]);
    const pega = await um<{ ok: boolean }>("select iniciada_em is not null as ok from execucoes where id = $1", [antigos.agendada]);
    expect(pega.ok).toBe(true);
    await db.query("update execucoes set status = 'agendada', iniciada_em = null where id = $1", [antigos.agendada]);
  });

  it("variável personalizada só aceita chave de letras minúsculas e _", async () => {
    const { novaCampanha } = await seed();
    const camp = await novaCampanha("variaveis");
    await db.query("insert into campanha_variaveis (campanha_id, chave, valor) values ($1, 'cupom', 'VORTEX10')", [camp]);
    await expect(db.query("insert into campanha_variaveis (campanha_id, chave, valor) values ($1, 'Cupom 2', 'x')", [camp])).rejects.toThrow(/check/);
  });

  it("só um criar_grupo pendente por campanha, mesmo com um em erro", async () => {
    const { novaCampanha } = await seed();
    const camp = await novaCampanha("unico-criar");
    await db.query("insert into acoes (tipo, campanha_id, status) values ('criar_grupo', $1, 'erro')", [camp]);
    await expect(db.query("insert into acoes (tipo, campanha_id) values ('criar_grupo', $1)", [camp])).rejects.toThrow(/acoes_um_criar_por_campanha/);
  });

  it("não duplica remover do mesmo participante", async () => {
    const { novaCampanha, novoGrupo } = await seed();
    const camp = await novaCampanha("unico-remover");
    const grupo = await novoGrupo(camp, 1);
    await db.query("insert into acoes (tipo, grupo_id, telefone) values ('remover', $1, '5511" + "999990000')", [grupo]);
    await expect(db.query("insert into acoes (tipo, grupo_id, telefone) values ('remover', $1, '5511" + "999990000')", [grupo])).rejects.toThrow(
      /acoes_um_remover_por_participante/,
    );
  });

  it("equipe logada não lê token do Zapbot nem segredos, nem mexe nas filas", async () => {
    await seed();
    await comoPapel("authenticated", async () => {
      const ok = await db.query("select id, nome, status from conexoes");
      expect(ok.rows.length).toBeGreaterThan(0);
      await expect(db.query("select zapbot_token_enc from conexoes")).rejects.toThrow(/permission denied/);
      await expect(db.query("select client_token_enc from conexoes")).rejects.toThrow(/permission denied/);
      await expect(db.query("select * from provedores_checkout")).rejects.toThrow(/permission denied/);
      await expect(db.query("select * from pegar_tarefas(1)")).rejects.toThrow(/permission denied/);
      await expect(db.query("select somar_recibos(array['x'], true)")).rejects.toThrow(/permission denied/);
    });
  });

  it("metricas_campanha agrupa por dia de Brasília", async () => {
    const { novaCampanha, novoGrupo } = await seed();
    const camp = await novaCampanha("metricas");
    const grupo = await novoGrupo(camp, 1);
    // 02:00Z do dia 15 é 23:00 do dia 14 em Brasília.
    for (const t of ["2026-10-14T12:00:00Z", "2026-10-15T02:00:00Z", "2026-10-15T12:00:00Z"]) {
      await db.query("insert into cliques (campanha_id, visitante, created_at) values ($1, 'v', $2)", [camp, t]);
    }
    const part = (tel: string, entrou: string, extra: { saiu?: string; admin?: boolean; importado?: boolean } = {}) =>
      db.query("insert into participantes (grupo_id, telefone, entrou_em, saiu_em, admin, importado) values ($1, $2, $3, $4, $5, $6)", [
        grupo, tel, entrou, extra.saiu ?? null, extra.admin ?? false, extra.importado ?? false,
      ]);
    await part("1", "2026-10-14T13:00:00Z", { saiu: "2026-10-15T13:00:00Z" });
    await part("2", "2026-10-15T13:00:00Z");
    await part("3", "2026-10-15T13:00:00Z", { admin: true, saiu: "2026-10-15T14:00:00Z" }); // admin não conta
    await part("4", "2026-10-15T13:00:00Z", { importado: true }); // importado não conta como entrada
    await part("5", "2026-10-01T13:00:00Z"); // antes do período

    const r = await comoPapel("authenticated", () =>
      db.query<{ dia: string; cliques: number; entradas: number; saidas: number }>(
        "select dia::text as dia, cliques::int, entradas::int, saidas::int from metricas_campanha($1, '2026-10-10T00:00:00Z')",
        [camp],
      ),
    );
    expect(r.rows).toEqual([
      { dia: "2026-10-14", cliques: 2, entradas: 1, saidas: 0 },
      { dia: "2026-10-15", cliques: 1, entradas: 1, saidas: 1 },
    ]);
  });
});

describe("cliques_por_campanha", () => {
  it("agrupa cliques por campanha desde p_desde (equipe logada)", async () => {
    const { novaCampanha } = await seed();
    const a = await novaCampanha("cpc-a");
    const b = await novaCampanha("cpc-b");
    const antigo = new Date(Date.now() - 10 * 86_400_000).toISOString();
    await db.query("insert into cliques (campanha_id, visitante, created_at) values ($1, 'x', now()), ($1, 'y', now()), ($2, 'z', now()), ($1, 'w', $3)", [a, b, antigo]);
    const desde = new Date(Date.now() - 60_000).toISOString();
    const r = await comoPapel("authenticated", () =>
      db.query<{ campanha_id: string; cliques: number }>("select campanha_id, cliques::int from cliques_por_campanha($1) order by cliques desc", [desde]),
    );
    expect(r.rows).toEqual([{ campanha_id: a, cliques: 2 }, { campanha_id: b, cliques: 1 }]);
    // Arquiva pra não entrar na soma global de metricas_gerais (que roda a seguir e soma todo clique recente
    // de campanha não arquivada).
    await db.query("update campanhas set arquivada = true where id in ($1, $2)", [a, b]);
  });
});

describe("metricas_gerais", () => {
  it("soma as campanhas não arquivadas por dia (arquivada não conta)", async () => {
    const { novaCampanha, novoGrupo } = await seed();
    const a = await novaCampanha("mg-a");
    const b = await novaCampanha("mg-b");
    const arq = await novaCampanha("mg-arquivada");
    await db.query("update campanhas set arquivada = true where id = $1", [arq]);
    const ga = await novoGrupo(a, 1);
    const gb = await novoGrupo(b, 1);
    const garq = await novoGrupo(arq, 1);
    const desde = new Date(Date.now() - 60_000).toISOString();
    await db.query("insert into cliques (campanha_id, visitante) values ($1, 'x'), ($2, 'y'), ($3, 'z')", [a, b, arq]);
    await db.query("insert into participantes (grupo_id, telefone) values ($1, '1'), ($2, '2'), ($3, '3')", [ga, gb, garq]);
    await db.query("insert into participantes (grupo_id, telefone, saiu_em) values ($1, '4', now())", [garq]);
    const r = await um<{ cliques: number; entradas: number; saidas: number }>(
      "select sum(cliques)::int as cliques, sum(entradas)::int as entradas, sum(saidas)::int as saidas from metricas_gerais($1)",
      [desde],
    );
    expect(r).toEqual({ cliques: 2, entradas: 2, saidas: 0 });
  });
});

describe("migrações sem 'expor tabelas novas automaticamente'", () => {
  it("os grants explícitos bastam pra service role e equipe logada", async () => {
    const limpo = new PGlite({ extensions: { pgcrypto } });
    try {
      await limpo.exec(PRE_SUPABASE.replace(/alter default privileges[^;]*;/, ""));
      await limpo.exec(INICIAL);
      await limpo.exec(FASE2A);
      await limpo.exec(RESUMO);
      await limpo.exec(GRUPOS_MENSAGENS);
      await limpo.exec(METRICAS_GERAIS);
      await limpo.exec(AUTOMACOES);
      await limpo.exec(AUTOMACOES2);
      await limpo.exec(BLOCO2B);
      await limpo.exec(MODELOS_VARIAVEIS);
      await limpo.exec(WEBHOOKS_HISTORICO);
      await limpo.exec(PROJETOS);
      await limpo.exec(MEMBROS);
      await limpo.exec(LISTAR_ACOES);
      await limpo.exec(ALERTAS_CONEXAO);
      await limpo.exec(ACOES_V2);
      await limpo.exec(CAMPANHA_EXTRAS);
      await limpo.exec(CAMPANHA_CONTAS);
      await limpo.exec(GRUPOS_EXTRAS);
      await limpo.exec(CONTATOS);
      await limpo.exec("set role service_role");
      await limpo.query("select * from grupo_variaveis");
      await limpo.query("insert into conexoes (nome, webhook_secret) values ('n', 's')");
      await limpo.query("insert into campanhas (nome, slug) values ('c', 'c1')");
      await limpo.query("insert into cliques (campanha_id, visitante) select id, 'v' from campanhas");
      await limpo.query("insert into alertas (tipo, texto) values ('numero_caiu', 'n caiu')");
      await limpo.query("select * from pegar_tarefas(1)");
      await limpo.query("select somar_recibos(array['x'], false)");
      await limpo.query("select * from pegar_acoes(1)");
      await limpo.query("select * from pegar_eventos(1)");
      await limpo.query("select segredo from provedores_checkout");
      await limpo.exec("reset role; set role authenticated");
      await limpo.query("select id, nome from conexoes");
      await limpo.query("select * from campanhas");
      await limpo.query("insert into sequencias (nome) values ('s')");
      await limpo.query("select * from sequencia_passos");
      await limpo.query("select * from modelos");
      await limpo.query("select * from campanha_variaveis");
      await limpo.query("select * from enquete_votos");
      await limpo.query("update alertas set visto = true");
      await limpo.query("select * from execucoes");
      await limpo.query("select * from tarefas");
      await limpo.query("select * from resumo_execucoes(array[gen_random_uuid()])");
      await limpo.query("select * from resultado_enquete(gen_random_uuid())");
      await limpo.query("select * from metricas_campanha(gen_random_uuid(), now())");
      await limpo.query("select * from resumo_campanhas(now())");
      await limpo.query("select * from resumo_grupos(gen_random_uuid())");
      await limpo.query("select * from listar_execucoes(gen_random_uuid(), 'todas', null, null, 10, 0)");
      await limpo.query("select * from listar_acoes(null, null, null, 'todas', null, null, 10, 0)");
      await limpo.query("select * from metricas_gerais(now())");
      await limpo.query("select * from cliques_por_campanha(now())");
      await limpo.query("select * from resumo_automacoes(array[gen_random_uuid()])");
      await limpo.query("select * from automacoes");
      await limpo.query("select * from bloqueados");
      await limpo.query("insert into tags (nome) values ('vip')");
      await limpo.query("select * from pessoa_tags");
      await limpo.query("select * from listar_pessoas(null, null, null, null, null, 10, 0)");
      await limpo.query("select contar_pessoas(null, null, null, null, null)");
      await limpo.query("select * from contar_pessoas_por_tag()");
      await limpo.query("select * from variaveis_globais");
      await limpo.query("insert into projetos (nome) values ('p')");
      await limpo.query("select * from resumo_projetos(array[gen_random_uuid()])");
      await limpo.query("select * from membros");
      await limpo.query("select * from grupo_variaveis");
      await limpo.query("select * from contatos");
      await limpo.query("insert into contatos (telefone, nome) values ('5511" + "999990000', 'Ana')");
      await limpo.query("select * from listar_leads(null, null, 10, 0)");
      await limpo.query("select contar_leads(null, null)");
      await expect(limpo.query("select zapbot_token_enc from conexoes")).rejects.toThrow(/permission denied/);
      await limpo.exec("reset role; set role anon");
      await expect(limpo.query("select * from bloqueados")).rejects.toThrow(/permission denied/);
      await expect(limpo.query("select * from membros")).rejects.toThrow(/permission denied/);
      await expect(limpo.query("select * from grupo_variaveis")).rejects.toThrow(/permission denied/);
      await expect(limpo.query("select * from contatos")).rejects.toThrow(/permission denied/);
      await expect(limpo.query("select * from listar_leads(null, null, 10, 0)")).rejects.toThrow(/permission denied/);
    } finally {
      await limpo.close();
    }
  }, 60_000);
});

describe("resumo_campanhas", () => {
  it("soma o período e o total atual por campanha", async () => {
    const { conexao, novaCampanha, novoGrupo } = await seed();
    const camp = await novaCampanha("resumo");
    const g1 = await novoGrupo(camp, 1);
    const g2 = await novoGrupo(camp, 2);
    await db.query("update grupos set cheio = true where id = $1", [g2]);
    await db.query("insert into cliques (campanha_id, visitante, created_at) values ($1, 'a', now()), ($1, 'b', now()), ($1, 'c', now() - interval '40 days')", [camp]);
    const ins = "insert into participantes (grupo_id, telefone, admin, importado, entrou_em, saiu_em) values ($1, $2, $3, $4, $5, $6)";
    await db.query(ins, [g1, "1", false, false, new Date().toISOString(), null]); // entrou no período, está dentro
    await db.query(ins, [g1, "2", true, false, new Date().toISOString(), null]); // admin: não conta entrada, conta admin
    await db.query(ins, [g2, "3", false, true, new Date().toISOString(), null]); // importado: não conta entrada
    await db.query(ins, [g2, "4", false, false, new Date().toISOString(), new Date().toISOString()]); // entrou e saiu
    const r = await um<Record<string, number>>(
      "select cliques::int, entradas::int, saidas::int, participantes::int, admins::int, grupos::int, grupos_cheios::int from resumo_campanhas(now() - interval '7 days', $1)",
      [camp],
    );
    expect(r).toEqual({ cliques: 2, entradas: 2, saidas: 1, participantes: 3, admins: 1, grupos: 2, grupos_cheios: 1 });
    void conexao;
  });

  it("campanha sem nenhum dado retorna tudo zero", async () => {
    const { novaCampanha } = await seed();
    const camp = await novaCampanha("resumo-vazia");
    const r = await um<Record<string, number>>(
      "select cliques::int, entradas::int, saidas::int, participantes::int, admins::int, grupos::int, grupos_cheios::int from resumo_campanhas(now() - interval '7 days', $1)",
      [camp],
    );
    expect(r).toEqual({ cliques: 0, entradas: 0, saidas: 0, participantes: 0, admins: 0, grupos: 0, grupos_cheios: 0 });
  });
});

describe("resumo_grupos e listar_execucoes", () => {
  it("números por grupo", async () => {
    const { novaCampanha, novoGrupo } = await seed();
    const camp = await novaCampanha("rg");
    const g1 = await novoGrupo(camp, 1);
    const g2 = await novoGrupo(camp, 2);
    await db.query("insert into cliques (campanha_id, grupo_id, visitante) values ($1, $2, 'a'), ($1, $2, 'b'), ($1, null, 'c')", [camp, g1]);
    const ins = "insert into participantes (grupo_id, telefone, admin, saiu_em) values ($1, $2, $3, $4)";
    await db.query(ins, [g1, "1", true, null]);
    await db.query(ins, [g1, "2", false, null]);
    await db.query(ins, [g1, "3", false, new Date().toISOString()]);
    const r = await db.query<{ grupo_id: string; cliques: number; admins: number; leads: number }>(
      "select grupo_id, cliques::int, admins::int, leads::int from resumo_grupos($1) order by grupo_id = $2 desc",
      [camp, g1],
    );
    expect(r.rows).toEqual([
      { grupo_id: g1, cliques: 2, admins: 1, leads: 1 },
      { grupo_id: g2, cliques: 0, admins: 0, leads: 0 },
    ]);
  });

  it("filtra mensagens por aba, intervalo e pagina com o total", async () => {
    const { conexao, novaCampanha, novoGrupo } = await seed();
    const camp = await novaCampanha("le");
    const g = await novoGrupo(camp, 1);
    const nova = async (status: string, quando: string, tipo = "mensagem") =>
      (await um<{ id: string }>("insert into execucoes (campanha_id, tipo, status, agendada_para) values ($1, $2, $3, $4) returning id", [camp, tipo, status, quando])).id;
    const passado = new Date(Date.now() - 3600_000).toISOString();
    const futuro = new Date(Date.now() + 3600_000).toISOString();
    const fila = await nova("agendada", passado);
    const agendado = await nova("agendada", futuro);
    const enviando = await nova("enviando", passado);
    const ok = await nova("concluida", passado);
    const comErro = await nova("concluida", passado, "enquete");
    const bloqueada = await nova("bloqueada", passado);
    await nova("cancelada", passado);
    await nova("concluida", passado, "nome"); // outro tipo: fora da aba Mensagens
    await db.query("insert into tarefas (execucao_id, grupo_id, conexao_id, status) values ($1, $2, $3, 'erro')", [comErro, g, conexao]);
    await db.query("insert into tarefas (execucao_id, grupo_id, conexao_id, status) values ($1, $2, $3, 'enviado')", [ok, g, conexao]);
    const ids = async (aba: string) =>
      (await db.query<{ id: string }>("select id from listar_execucoes($1, $2, null, null, 50, 0)", [camp, aba])).rows.map((x) => x.id).sort();
    expect(await ids("fila")).toEqual([fila]);
    expect(await ids("agendado")).toEqual([agendado]);
    expect(await ids("processando")).toEqual([enviando]);
    expect(await ids("sucesso")).toEqual([ok]);
    expect(await ids("falhas")).toEqual([bloqueada, comErro].sort());
    expect((await ids("todas")).length).toBe(6);
    const pag = await db.query<{ id: string; total: number }>("select id, total::int from listar_execucoes($1, 'todas', null, null, 2, 0)", [camp]);
    expect(pag.rows.length).toBe(2);
    expect(pag.rows[0].total).toBe(6);
    const intervalo = await db.query("select id from listar_execucoes($1, 'todas', $2, null, 50, 0)", [camp, new Date(Date.now() + 1000).toISOString()]);
    expect(intervalo.rows.map((x) => (x as { id: string }).id)).toEqual([agendado]);
  });
});

describe("listar_acoes", () => {
  it("campanha, conta e tipos são opcionais (null = sem filtro)", async () => {
    const { conexao, novaCampanha, novoGrupo } = await seed();
    const camp1 = await novaCampanha("la1");
    const camp2 = await novaCampanha("la2");
    const g1 = await novoGrupo(camp1, 1);
    const g2 = await novoGrupo(camp2, 1);
    const { id: conexao2 } = await um<{ id: string }>("insert into conexoes (nome, webhook_secret) values ('n2', 's2') returning id");
    const nova = async (campanha: string, tipo: string) =>
      (await um<{ id: string }>("insert into execucoes (campanha_id, tipo, status, agendada_para) values ($1, $2, 'concluida', now() - interval '1 hour') returning id", [campanha, tipo])).id;
    const e1 = await nova(camp1, "mensagem");
    const e2 = await nova(camp2, "nome");
    await db.query("insert into tarefas (execucao_id, grupo_id, conexao_id, status) values ($1, $2, $3, 'enviado')", [e1, g1, conexao]);
    await db.query("insert into tarefas (execucao_id, grupo_id, conexao_id, status) values ($1, $2, $3, 'enviado')", [e2, g2, conexao2]);

    // Banco compartilhado pelo arquivo inteiro: "sem filtro" soma linhas de outros testes também, então aqui só
    // confere que as duas aparecem (não que são as únicas). Campanha/conta recém-criadas são exclusivas desta
    // linha, então essas dão pra conferir à risca.
    const todas = await db.query<{ id: string }>("select id from listar_acoes(null, null, null, 'todas', null, null, 300, 0)");
    expect(todas.rows.map((r) => r.id)).toEqual(expect.arrayContaining([e1, e2]));

    const porCampanha = await db.query<{ id: string }>("select id from listar_acoes($1, null, null, 'todas', null, null, 300, 0)", [camp1]);
    expect(porCampanha.rows.map((r) => r.id)).toEqual([e1]);

    const porConexao = await db.query<{ id: string }>("select id from listar_acoes(null, $1, null, 'todas', null, null, 300, 0)", [conexao2]);
    expect(porConexao.rows.map((r) => r.id)).toEqual([e2]);

    const porTipo = await db.query<{ id: string }>("select id from listar_acoes(null, null, $1, 'todas', null, null, 300, 0)", [["nome"]]);
    expect(porTipo.rows.map((r) => r.id)).toEqual(expect.arrayContaining([e2]));
  });

  it("mesmas abas de listar_execucoes, sem o corte fixo de tipo", async () => {
    const { conexao, novaCampanha, novoGrupo } = await seed();
    const camp = await novaCampanha("la-abas");
    const g = await novoGrupo(camp, 1);
    const nova = async (status: string, quando: string, tipo = "nome") =>
      (await um<{ id: string }>("insert into execucoes (campanha_id, tipo, status, agendada_para) values ($1, $2, $3, $4) returning id", [camp, tipo, status, quando])).id;
    const passado = new Date(Date.now() - 3600_000).toISOString();
    const futuro = new Date(Date.now() + 3600_000).toISOString();
    const fila = await nova("agendada", passado);
    const agendado = await nova("agendada", futuro);
    const enviando = await nova("enviando", passado);
    const ok = await nova("concluida", passado);
    const comErro = await nova("concluida", passado);
    const bloqueada = await nova("bloqueada", passado);
    await nova("cancelada", passado);
    await db.query("insert into tarefas (execucao_id, grupo_id, conexao_id, status) values ($1, $2, $3, 'erro')", [comErro, g, conexao]);
    await db.query("insert into tarefas (execucao_id, grupo_id, conexao_id, status) values ($1, $2, $3, 'enviado')", [ok, g, conexao]);
    const ids = async (aba: string) =>
      (await db.query<{ id: string }>("select id from listar_acoes($1, null, null, $2, null, null, 50, 0)", [camp, aba])).rows.map((x) => x.id).sort();
    expect(await ids("fila")).toEqual([fila]);
    expect(await ids("agendado")).toEqual([agendado]);
    expect(await ids("processando")).toEqual([enviando]);
    expect(await ids("sucesso")).toEqual([ok]);
    expect(await ids("falhas")).toEqual([bloqueada, comErro].sort());
    expect((await ids("todas")).length).toBe(6);
  });

  it("pagina com o total e corta o limite em 300", async () => {
    const { novaCampanha } = await seed();
    const camp = await novaCampanha("la-pag");
    await db.query(
      "insert into execucoes (campanha_id, tipo, status, agendada_para) select $1, 'nome', 'agendada', now() - interval '1 hour' from generate_series(1, 305)",
      [camp],
    );
    const pag = await db.query<{ id: string; total: number }>("select id, total::int from listar_acoes($1, null, null, 'todas', null, null, 2, 0)", [camp]);
    expect(pag.rows.length).toBe(2);
    expect(pag.rows[0].total).toBe(305);
    const excesso = await db.query<{ id: string }>("select id from listar_acoes($1, null, null, 'todas', null, null, 1000, 0)", [camp]);
    expect(excesso.rows.length).toBe(300);
  });

  it("índices da lista geral: execucoes (agendada_para desc, id) e tarefas (conexao_id)", async () => {
    const a = await um<{ indexdef: string } | undefined>("select indexdef from pg_indexes where indexname = 'execucoes_agendada'");
    expect(a?.indexdef).toMatch(/\(agendada_para DESC, id\)$/);
    const t = await um<{ indexdef: string } | undefined>("select indexdef from pg_indexes where indexname = 'tarefas_conexao'");
    expect(t?.indexdef).toMatch(/\(conexao_id\)$/);
  });

  it("Excluir de sequência = cancelar: a linha cancelada some da lista e o upsert da sequência não a recria", async () => {
    const { novaCampanha } = await seed();
    const camp = await novaCampanha("la-tumulo");
    const { id: seq } = await um<{ id: string }>("insert into sequencias (nome) values ('Túmulo') returning id");
    const { id: passo } = await um<{ id: string }>(
      "insert into sequencia_passos (sequencia_id, dia_relativo, hora, tipo) values ($1, 0, '19:50', 'abrir') returning id",
      [seq],
    );
    const inserir = "insert into execucoes (campanha_id, origem, passo_id, tipo, agendada_para) values ($1, 'sequencia', $2, 'abrir', now() + interval '1 hour') on conflict (campanha_id, passo_id) do nothing";
    await db.query(inserir, [camp, passo]);
    await db.query("update execucoes set status = 'cancelada' where campanha_id = $1 and passo_id = $2 and status <> 'enviando'", [camp, passo]);
    await db.query(inserir, [camp, passo]);
    const linhas = await db.query<{ status: string }>("select status from execucoes where campanha_id = $1 and passo_id = $2", [camp, passo]);
    expect(linhas.rows.map((r) => r.status)).toEqual(["cancelada"]);
    const lista = await db.query<{ id: string }>("select id from listar_acoes($1, null, null, 'todas', null, null, 10, 0)", [camp]);
    expect(lista.rows).toEqual([]);
  });
});

describe("listar_acoes: p_automacao (Etapa 3F, Tarefa 2 — contadores-links da lista de automações)", () => {
  it("chamada antiga (8 parâmetros, sem p_automacao) continua funcionando: default null, sem filtrar", async () => {
    const { novaCampanha } = await seed();
    const camp = await novaCampanha("la-automacao-compat");
    const e = await um<{ id: string }>("insert into execucoes (campanha_id, tipo, status, agendada_para) values ($1, 'nome', 'agendada', now() - interval '1 hour') returning id", [camp]);
    const r = await db.query<{ id: string }>("select id from listar_acoes($1, null, null, 'todas', null, null, 300, 0)", [camp]);
    expect(r.rows.map((x) => x.id)).toEqual([e.id]);
  });

  it("filtra pela automação (9º parâmetro) quando dado, e não filtra quando null", async () => {
    const { novaCampanha } = await seed();
    const camp = await novaCampanha("la-automacao");
    const { id: auto1 } = await um<{ id: string }>(
      "insert into automacoes (nome, campanha_id, gatilho, quando) values ('A1', $1, 'cronograma', now()) returning id",
      [camp],
    );
    const { id: auto2 } = await um<{ id: string }>(
      "insert into automacoes (nome, campanha_id, gatilho, quando) values ('A2', $1, 'cronograma', now()) returning id",
      [camp],
    );
    const nova = async (automacaoId: string | null) =>
      (await um<{ id: string }>(
        "insert into execucoes (campanha_id, tipo, status, agendada_para, automacao_id) values ($1, 'nome', 'agendada', now() - interval '1 hour', $2) returning id",
        [camp, automacaoId],
      )).id;
    const e1 = await nova(auto1);
    const e2 = await nova(auto2);
    const eSemAutomacao = await nova(null);

    const porAuto1 = await db.query<{ id: string }>("select id from listar_acoes($1, null, null, 'todas', null, null, 300, 0, $2)", [camp, auto1]);
    expect(porAuto1.rows.map((r) => r.id)).toEqual([e1]);

    const porAuto2 = await db.query<{ id: string }>("select id from listar_acoes($1, null, null, 'todas', null, null, 300, 0, $2)", [camp, auto2]);
    expect(porAuto2.rows.map((r) => r.id)).toEqual([e2]);

    const semFiltro = await db.query<{ id: string }>("select id from listar_acoes($1, null, null, 'todas', null, null, 300, 0, null)", [camp]);
    expect(semFiltro.rows.map((r) => r.id).sort()).toEqual([e1, e2, eSemAutomacao].sort());
  });
});

describe("automações", () => {
  it("cronograma exige quando; execução única por ação e disparo; placar", async () => {
    const { conexao, novaCampanha, novoGrupo } = await seed();
    const camp = await novaCampanha("auto");
    const g = await novoGrupo(camp, 1);
    await expect(db.query("insert into automacoes (nome, campanha_id, gatilho) values ('x', $1, 'cronograma')", [camp])).rejects.toThrow();
    const { id: a } = await um<{ id: string }>("insert into automacoes (nome, campanha_id, gatilho, quando, ativo) values ('a', $1, 'cronograma', now() + interval '1 day', true) returning id", [camp]);
    const { id: acao } = await um<{ id: string }>("insert into automacao_acoes (automacao_id, tipo, conteudo) values ($1, 'abrir', '{}') returning id", [a]);
    const ins = "insert into execucoes (campanha_id, tipo, origem, status, automacao_id, automacao_acao_id, gatilho_chave) values ($1, 'abrir', 'automacao', $2, $3, $4, $5) returning id";
    const { id: e1 } = await um<{ id: string }>(ins, [camp, "concluida", a, acao, "cronograma"]);
    await expect(db.query(ins, [camp, "agendada", a, acao, "cronograma"])).rejects.toThrow();
    await um(ins, [camp, "agendada", a, acao, g]);
    await db.query("insert into tarefas (execucao_id, grupo_id, conexao_id, status) values ($1, $2, $3, 'erro')", [e1, g, conexao]);
    const r = await um<Record<string, number>>(
      "select total::int, agendadas::int, enviando::int, concluidas::int, falhas::int from resumo_automacoes(array[$1::uuid])",
      [a],
    );
    expect(r).toEqual({ total: 2, agendadas: 1, enviando: 0, concluidas: 0, falhas: 1 });
  });

  it("ON CONFLICT DO NOTHING (o upsert do PostgREST com ignoreDuplicates) não falha: índice não é parcial", async () => {
    const { novaCampanha } = await seed();
    const camp = await novaCampanha("auto-conflito");
    const { id: a } = await um<{ id: string }>("insert into automacoes (nome, campanha_id, gatilho, quando, ativo) values ('a', $1, 'cronograma', now() + interval '1 day', true) returning id", [camp]);
    const { id: acao } = await um<{ id: string }>("insert into automacao_acoes (automacao_id, tipo, conteudo) values ($1, 'abrir', '{}') returning id", [a]);
    const ins = "insert into execucoes (campanha_id, tipo, origem, status, automacao_id, automacao_acao_id, gatilho_chave) values ($1, 'abrir', 'automacao', 'agendada', $2, $3, $4) on conflict (automacao_acao_id, gatilho_chave) do nothing";
    await db.query(ins, [camp, a, acao, "cronograma"]);
    // Segunda vez (mesmo par ação+gatilho_chave): PostgREST faria esse upsert com onConflict/ignoreDuplicates;
    // se o índice fosse parcial (WHERE automacao_acao_id is not null), o Postgres não acharia esse arbiter e lançaria.
    await db.query(ins, [camp, a, acao, "cronograma"]);
    const { total } = await um<{ total: number }>("select count(*)::int as total from execucoes where automacao_acao_id = $1", [acao]);
    expect(total).toBe(1);

    // Linhas sem automação (ambas colunas NULL) nunca colidem entre si — NULL nunca é igual a NULL.
    const { id: e1 } = await um<{ id: string }>("insert into execucoes (campanha_id) values ($1) returning id", [camp]);
    const { id: e2 } = await um<{ id: string }>("insert into execucoes (campanha_id) values ($1) returning id", [camp]);
    expect(e1).not.toBe(e2);
  });
});

describe("automações parte 2 (pessoas e checkout)", () => {
  it("checkout exige provedor e produto", async () => {
    const { novaCampanha } = await seed();
    const camp = await novaCampanha("auto-checkout");
    await expect(
      db.query("insert into automacoes (nome, campanha_id, gatilho) values ('x', $1, 'checkout')", [camp]),
    ).rejects.toThrow(/automacoes_checkout_campos/);
    const { id: a } = await um<{ id: string }>(
      "insert into automacoes (nome, campanha_id, gatilho, provedor, produto) values ('a', $1, 'checkout', 'hotmart', 'Formação') returning id",
      [camp],
    );
    expect(a).toBeTruthy();
  });

  it("tipo remover_participante é aceito em automacao_acoes", async () => {
    const { novaCampanha } = await seed();
    const camp = await novaCampanha("auto-remover-tipo");
    const { id: a } = await um<{ id: string }>(
      "insert into automacoes (nome, campanha_id, gatilho) values ('a', $1, 'entrou') returning id",
      [camp],
    );
    const { id: acao } = await um<{ id: string }>(
      "insert into automacao_acoes (automacao_id, tipo, conteudo) values ($1, 'remover_participante', '{}') returning id",
      [a],
    );
    expect(acao).toBeTruthy();
  });

  it("pegar_acoes não pega ação com executar_apos no futuro", async () => {
    const { novaCampanha, novoGrupo } = await seed();
    const camp = await novaCampanha("auto-executar-apos");
    const grupo = await novoGrupo(camp, 1);
    await comoPapel("service_role", async () => {
      await db.query(
        "insert into acoes (tipo, grupo_id, telefone, executar_apos) values ('remover', $1, '5511" + "999990001', now() + interval '1 hour')",
        [grupo],
      );
      const pegas = await db.query("select * from pegar_acoes(10)");
      expect(pegas.rows.some((r: any) => r.telefone === "5511" + "999990001")).toBe(false);
    });
  });

  it("grupos.leitura_suspeita_desde: timestamptz opcional (vazia por padrão)", async () => {
    const { novaCampanha, novoGrupo } = await seed();
    const camp = await novaCampanha("leitura-suspeita");
    const grupo = await novoGrupo(camp, 1);
    expect(await um("select leitura_suspeita_desde from grupos where id = $1", [grupo])).toEqual({ leitura_suspeita_desde: null });
    await db.query("update grupos set leitura_suspeita_desde = '2026-10-16T12:00:00Z' where id = $1", [grupo]);
    const r = await um<{ desde: Date }>("select leitura_suspeita_desde as desde from grupos where id = $1", [grupo]);
    expect(new Date(r.desde).toISOString()).toBe("2026-10-16T12:00:00.000Z");
  });

  it("resumo_automacoes soma 1 execução concluída + 1 remoção ok", async () => {
    const { novaCampanha, novoGrupo } = await seed();
    const camp = await novaCampanha("auto-resumo-remocao");
    const grupo = await novoGrupo(camp, 1);
    const { id: a } = await um<{ id: string }>(
      "insert into automacoes (nome, campanha_id, gatilho) values ('a', $1, 'entrou') returning id",
      [camp],
    );
    const { id: acaoMsg } = await um<{ id: string }>(
      "insert into automacao_acoes (automacao_id, tipo, conteudo) values ($1, 'mensagem', '{}') returning id",
      [a],
    );
    const { id: acaoRemover } = await um<{ id: string }>(
      "insert into automacao_acoes (automacao_id, tipo, conteudo) values ($1, 'remover_participante', '{}') returning id",
      [a],
    );
    await um(
      "insert into execucoes (campanha_id, tipo, origem, status, automacao_id, automacao_acao_id, gatilho_chave) values ($1, 'mensagem', 'automacao', 'concluida', $2, $3, $4) returning id",
      [camp, a, acaoMsg, "g1:bucket"],
    );
    await um(
      "insert into acoes (tipo, grupo_id, telefone, status, automacao_id, automacao_acao_id, gatilho_chave) values ('remover', $1, '5511" + "999990002', 'ok', $2, $3, $4) returning id",
      [grupo, a, acaoRemover, "g1:5511" + "999990002"],
    );
    const r = await um<Record<string, number>>(
      "select total::int, concluidas::int from resumo_automacoes(array[$1::uuid])",
      [a],
    );
    expect(r).toEqual({ total: 2, concluidas: 2 });
  });
});

describe("Bloco 2B", () => {
  it("nasce com as tags fixas Comprador e Saiu", async () => {
    const r = await db.query<{ nome: string; tipo: string }>("select nome, tipo from tags where tipo in ('comprador', 'saiu') order by nome");
    expect(r.rows).toEqual([{ nome: "Comprador", tipo: "comprador" }, { nome: "Saiu", tipo: "saiu" }]);
  });

  it("variantes_telefone segue a regra do TS", async () => {
    const v = async (t: string) => (await um<{ v: string[] }>("select variantes_telefone($1) as v", [t])).v;
    expect(await v("5537" + "980001001")).toEqual(["5537" + "980001001", "553780001001"]);
    expect(await v("553780001001")).toEqual(["553780001001", "5537" + "980001001"]);
    expect(await v("12025550100")).toEqual(["12025550100"]);
  });

  it("tag_da_campanha cria uma vez, com o nome da campanha", async () => {
    const { novaCampanha } = await seed();
    const camp = await novaCampanha("tag-camp");
    const a = await um<{ id: string }>("select tag_da_campanha($1) as id", [camp]);
    const b = await um<{ id: string }>("select tag_da_campanha($1) as id", [camp]);
    expect(a.id).toBe(b.id);
    const t = await um<{ nome: string; tipo: string }>("select nome, tipo from tags where id = $1", [a.id]);
    expect(t).toEqual({ nome: "tag-camp", tipo: "campanha" });
  });

  it("por_tag não duplica e tirar_tag acha pela variante do 9", async () => {
    const { novaCampanha } = await seed();
    const camp = await novaCampanha("tag-saiu");
    const { id: saiu } = await um<{ id: string }>("select id from tags where tipo = 'saiu'");
    const { id: comprador } = await um<{ id: string }>("select id from tags where tipo = 'comprador'");
    await db.query("select por_tag(array['553711112222', '553711112222'], $1, $2)", [saiu, camp]);
    await db.query("select por_tag(array['553711112222'], $1, $2)", [saiu, camp]);
    await db.query("select por_tag(array['553711112222'], $1, null)", [comprador]);
    await db.query("select por_tag(array['553711112222'], $1, null)", [comprador]);
    const n = await um<{ n: number }>("select count(*)::int as n from pessoa_tags where telefone = '553711112222'");
    expect(n.n).toBe(2);
    await db.query("select tirar_tag(array['5537" + "911112222'], $1, $2)", [saiu, camp]);
    const r = await db.query<{ tag_id: string }>("select tag_id from pessoa_tags where telefone = '553711112222'");
    expect(r.rows).toEqual([{ tag_id: comprador }]);
  });

  it("listar_pessoas e contar_pessoas filtram e trazem as tags", async () => {
    const { novaCampanha, novoGrupo } = await seed();
    const camp = await novaCampanha("lista");
    const g1 = await novoGrupo(camp, 1);
    const g2 = await novoGrupo(camp, 2);
    const ins = "insert into participantes (grupo_id, telefone, admin, entrou_em, saiu_em, motivo_saida) values ($1, $2, $3, $4, $5, $6)";
    await db.query(ins, [g1, "553700000001", false, "2026-10-10T12:00:00Z", null, null]);
    await db.query(ins, [g2, "553700000002", false, "2026-10-11T12:00:00Z", "2026-10-12T12:00:00Z", "sozinho"]);
    await db.query(ins, [g1, "553700000003", true, "2026-10-09T12:00:00Z", null, null]); // admin não aparece
    const { id: tagCamp } = await um<{ id: string }>("select tag_da_campanha($1) as id", [camp]);
    await db.query("select por_tag(array['5537" + "900000001'], $1, null)", [tagCamp]); // gravada com o 9: acha pela variante

    const listar = (sit: string | null, tag: string | null, busca: string | null) =>
      db.query<{ telefone: string; grupo: string; motivo_saida: string | null; tags: string[] }>(
        "select telefone, grupo, motivo_saida, tags from listar_pessoas($1, null, $2, $3, $4, 50, 0)",
        [camp, sit, tag, busca],
      );
    expect((await listar(null, null, null)).rows).toEqual([
      { telefone: "553700000002", grupo: `g-${camp}-2`, motivo_saida: "sozinho", tags: [] },
      { telefone: "553700000001", grupo: `g-${camp}-1`, motivo_saida: null, tags: ["lista"] },
    ]);
    expect((await listar("dentro", null, null)).rows.map((r) => r.telefone)).toEqual(["553700000001"]);
    expect((await listar("saiu", null, null)).rows.map((r) => r.telefone)).toEqual(["553700000002"]);
    expect((await listar(null, tagCamp, null)).rows.map((r) => r.telefone)).toEqual(["553700000001"]);
    expect((await listar(null, null, "0002")).rows.map((r) => r.telefone)).toEqual(["553700000002"]);
    const c = await um<{ n: number }>("select contar_pessoas($1, null, null, null, null)::int as n", [camp]);
    expect(c.n).toBe(2);
  });

  it("contar_pessoas_por_tag conta pessoas distintas (variante do 9 e Saiu de duas campanhas contam uma vez)", async () => {
    const { novaCampanha } = await seed();
    const c1 = await novaCampanha("conta-tag-1");
    const c2 = await novaCampanha("conta-tag-2");
    const { id: manual } = await um<{ id: string }>("insert into tags (nome) values ('conta-tag-manual') returning id");
    const { id: saiu } = await um<{ id: string }>("select id from tags where tipo = 'saiu'");
    const antesSaiu = await db.query<{ pessoas: number }>("select pessoas::int from contar_pessoas_por_tag() where tag_id = $1", [saiu]);
    const base = antesSaiu.rows[0]?.pessoas ?? 0;
    await db.query("insert into pessoa_tags (telefone, tag_id) values ('553744445555', $1), ('5537" + "944445555', $1), ('553766667777', $1)", [manual]);
    await db.query("select por_tag(array['553788889999'], $1, $2)", [saiu, c1]);
    await db.query("select por_tag(array['553788889999'], $1, $2)", [saiu, c2]);
    const r = await db.query<{ tag_id: string; pessoas: number }>("select tag_id, pessoas::int from contar_pessoas_por_tag() where tag_id = any($1)", [[manual, saiu]]);
    const por = Object.fromEntries(r.rows.map((x) => [x.tag_id, x.pessoas]));
    expect(por[manual]).toBe(2);
    expect(por[saiu]).toBe(base + 1);
  });

  it("tem índice em participantes(telefone) pra todas as participações", async () => {
    const r = await db.query<{ indexdef: string }>("select indexdef from pg_indexes where indexname = 'participantes_telefone_todas'");
    expect(r.rows[0]?.indexdef).toMatch(/\(telefone\)$/);
  });

  it("aceita o alerta bloqueado_removido e recusa motivo de saída inválido", async () => {
    await db.query("insert into alertas (tipo, texto) values ('bloqueado_removido', 'x')");
    const { novaCampanha, novoGrupo } = await seed();
    const g = await novoGrupo(await novaCampanha("motivo"), 1);
    await expect(db.query("insert into participantes (grupo_id, telefone, motivo_saida) values ($1, '1', 'qualquer')", [g])).rejects.toThrow();
  });
});

describe("modelos e variáveis globais (Etapa 2H)", () => {
  it("modelo novo nasce arquivado = false com updated_at", async () => {
    const m = await um<{ arquivado: boolean; updated_at: string | null; pasta: string | null }>(
      "insert into modelos (nome, tipo) values ('m1', 'mensagem') returning arquivado, updated_at, pasta",
    );
    expect(m.arquivado).toBe(false);
    expect(m.updated_at).toBeTruthy();
    expect(m.pasta).toBeNull();
  });

  it("variaveis_globais recusa chave inválida e repetida", async () => {
    await expect(db.query("insert into variaveis_globais (chave) values ('Chave Inválida')")).rejects.toThrow(/check/);
    await db.query("insert into variaveis_globais (chave) values ('cupom')");
    await expect(db.query("insert into variaveis_globais (chave) values ('cupom')")).rejects.toThrow(/variaveis_globais_chave_key/);
  });

  it("authenticated lê e escreve em variaveis_globais", async () => {
    await comoPapel("authenticated", async () => {
      await db.query("insert into variaveis_globais (chave, tipo) values ('vip_link', 'link')");
      const r = await db.query<{ chave: string; tipo: string }>("select chave, tipo from variaveis_globais where chave = 'vip_link'");
      expect(r.rows).toEqual([{ chave: "vip_link", tipo: "link" }]);
      await db.query("update variaveis_globais set categoria = 'vip' where chave = 'vip_link'");
      await db.query("delete from variaveis_globais where chave = 'vip_link'");
    });
  });
});

describe("webhooks e histórico (Etapa 2I)", () => {
  it("recusa url sem https e evento desconhecido", async () => {
    await expect(
      db.query("insert into webhooks (nome, url, eventos, segredo) values ('w', 'http://exemplo.test', array['entrou'], 's')"),
    ).rejects.toThrow(/check/);
    await expect(
      db.query("insert into webhooks (nome, url, eventos, segredo) values ('w', 'https://exemplo.test', array['desconhecido'], 's')"),
    ).rejects.toThrow(/check/);
  });

  it("authenticated não lê a coluna segredo (permission denied) mas lê as outras", async () => {
    const { id } = await um<{ id: string }>(
      "insert into webhooks (nome, url, eventos, segredo) values ('w', 'https://exemplo.test', array['entrou'], 'segredo-123') returning id",
    );
    await comoPapel("authenticated", async () => {
      const ok = await db.query<{ id: string; nome: string; ativo: boolean }>("select id, nome, ativo from webhooks where id = $1", [id]);
      expect(ok.rows).toEqual([{ id, nome: "w", ativo: true }]);
      await expect(db.query("select segredo from webhooks where id = $1", [id])).rejects.toThrow(/permission denied/);
      await expect(db.query("select * from webhooks where id = $1", [id])).rejects.toThrow(/permission denied/);
    });
  });

  it("authenticated não insere em historico (só service role)", async () => {
    await comoPapel("service_role", async () => {
      await db.query(
        "insert into historico (acao, area, resumo) values ('adicionar', 'webhooks', 'criou o webhook w')",
      );
    });
    await comoPapel("authenticated", async () => {
      const r = await db.query("select * from historico");
      expect(r.rows.length).toBeGreaterThan(0);
      await expect(
        db.query("insert into historico (acao, area, resumo) values ('adicionar', 'webhooks', 'x')"),
      ).rejects.toThrow(/permission denied/);
    });
  });

  it("eventos_saida aceita campanha_id nulo com webhook_id", async () => {
    const { id: webhook } = await um<{ id: string }>(
      "insert into webhooks (nome, url, eventos, segredo) values ('w2', 'https://exemplo.test', array['alerta'], 's') returning id",
    );
    const { id } = await um<{ id: string }>(
      "insert into eventos_saida (webhook_id, url, payload) values ($1, 'https://exemplo.test', '{}') returning id",
      [webhook],
    );
    const e = await um<{ campanha_id: string | null; webhook_id: string }>(
      "select campanha_id, webhook_id from eventos_saida where id = $1",
      [id],
    );
    expect(e).toEqual({ campanha_id: null, webhook_id: webhook });
  });

  it("anon não lê webhooks nem grava em historico", async () => {
    await um<{ id: string }>(
      "insert into webhooks (nome, url, eventos, segredo) values ('w-anon', 'https://exemplo.test', array['entrou'], 's') returning id",
    );
    await comoPapel("anon", async () => {
      await expect(db.query("select id from webhooks")).rejects.toThrow(/permission denied/);
      await expect(
        db.query("insert into historico (acao, area, resumo) values ('adicionar', 'webhooks', 'x')"),
      ).rejects.toThrow(/permission denied/);
      await expect(db.query("select * from historico")).rejects.toThrow(/permission denied/);
    });
  });

  it("chave repetida pro mesmo webhook_id é rejeitada (idempotência); chave nula pode repetir", async () => {
    const { id: webhook } = await um<{ id: string }>(
      "insert into webhooks (nome, url, eventos, segredo) values ('w3', 'https://exemplo.test', array['compra'], 's') returning id",
    );
    await db.query("insert into eventos_saida (webhook_id, url, payload, chave) values ($1, 'https://exemplo.test', '{}', 'compra:v1')", [webhook]);
    await expect(
      db.query("insert into eventos_saida (webhook_id, url, payload, chave) values ($1, 'https://exemplo.test', '{}', 'compra:v1')", [webhook]),
    ).rejects.toThrow(/duplicate key|unique/);
    // Chave nula (a maioria dos eventos, sem idempotência) nunca conflita, mesmo repetida pro mesmo webhook_id.
    await db.query("insert into eventos_saida (webhook_id, url, payload) values ($1, 'https://exemplo.test', '{}')", [webhook]);
    await db.query("insert into eventos_saida (webhook_id, url, payload) values ($1, 'https://exemplo.test', '{}')", [webhook]);
  });
});

describe("projetos (Etapa 2J)", () => {
  it("recusa cor inválida e aceita o padrão amarelo", async () => {
    await expect(db.query("insert into projetos (nome, cor) values ('p', 'roxo-claro')")).rejects.toThrow(/check/);
    const { cor } = await um<{ cor: string }>("insert into projetos (nome) values ('padrao') returning cor");
    expect(cor).toBe("amarelo");
  });

  it("excluir o projeto zera projeto_id nas campanhas (FK set null)", async () => {
    const { conexao, novaCampanha } = await seed();
    const { id: projeto } = await um<{ id: string }>("insert into projetos (nome) values ('fk') returning id");
    const camp = await novaCampanha("proj-fk");
    await db.query("update campanhas set projeto_id = $1 where id = $2", [projeto, camp]);
    await db.query("delete from projetos where id = $1", [projeto]);
    const r = await um<{ projeto_id: string | null }>("select projeto_id from campanhas where id = $1", [camp]);
    expect(r.projeto_id).toBeNull();
    void conexao;
  });

  it("anon não lê nem grava em projetos", async () => {
    const { id } = await um<{ id: string }>("insert into projetos (nome) values ('p-anon') returning id");
    await comoPapel("anon", async () => {
      await expect(db.query("select id from projetos")).rejects.toThrow(/permission denied/);
      await expect(db.query("insert into projetos (nome) values ('x')")).rejects.toThrow(/permission denied/);
    });
    void id;
  });

  it("resumo_projetos conta campanhas não arquivadas, grupos ativos e leads atuais; traz zero pro projeto sem campanha", async () => {
    const { novaCampanha, novoGrupo } = await seed();
    const { id: projeto } = await um<{ id: string }>("insert into projetos (nome) values ('resumo') returning id");
    const { id: projetoVazio } = await um<{ id: string }>("insert into projetos (nome) values ('vazio') returning id");

    const camp = await novaCampanha("proj-resumo");
    await db.query("update campanhas set projeto_id = $1 where id = $2", [projeto, camp]);
    const campArquivada = await novaCampanha("proj-resumo-arquivada");
    await db.query("update campanhas set projeto_id = $1, arquivada = true where id = $2", [projeto, campArquivada]);

    const g1 = await novoGrupo(camp, 1);
    const g2 = await novoGrupo(camp, 2);
    await db.query("update grupos set ativo = false where id = $1", [g2]);
    const gArq = await novoGrupo(campArquivada, 3);

    const ins = "insert into participantes (grupo_id, telefone, saiu_em) values ($1, $2, $3)";
    await db.query(ins, [g1, "1", null]); // conta: grupo ativo, dentro
    await db.query(ins, [g1, "2", new Date().toISOString()]); // não conta: já saiu
    await db.query(ins, [g2, "3", null]); // não conta: grupo inativo
    await db.query(ins, [gArq, "4", null]); // conta no grupo (grupo ativo), mesmo a campanha estando arquivada

    const r = await db.query<{ projeto_id: string; campanhas: number; grupos: number; leads: number }>(
      "select projeto_id, campanhas::int, grupos::int, leads::int from resumo_projetos(array[$1::uuid, $2::uuid]) order by campanhas desc",
      [projeto, projetoVazio],
    );
    expect(r.rows).toEqual([
      { projeto_id: projeto, campanhas: 1, grupos: 2, leads: 2 },
      { projeto_id: projetoVazio, campanhas: 0, grupos: 0, leads: 0 },
    ]);
  });
});

describe("membros (Etapa 2K)", () => {
  // Banco próprio por teste: precisa inserir em auth.users antes (quem já tinha acesso) e depois (trigger) de
  // rodar a migração de Membros, o que não dá pra fazer no `db` global (as migrações já rodaram no beforeAll).
  async function comoUsuario<T>(d: PGlite, usuarioId: string, f: () => Promise<T>): Promise<T> {
    await d.exec("set role authenticated");
    await d.exec(`set request.jwt.claims = '{"sub":"${usuarioId}"}'`);
    try {
      return await f();
    } finally {
      await d.exec("reset request.jwt.claims; reset role");
    }
  }

  it("usuário que já tinha acesso vira admin; usuário novo (trigger em auth.users) ganha linha membro", async () => {
    const d = await bancoAtéProjetos();
    try {
      const existente = "11111111-1111-4111-8111-111111111111";
      await d.query("insert into auth.users (id) values ($1)", [existente]);
      await d.exec(MEMBROS);
      const r1 = await um2<{ papel: string }>(d, "select papel from membros where usuario_id = $1", [existente]);
      expect(r1.papel).toBe("admin");

      const novo = "22222222-2222-4222-8222-222222222222";
      await d.query("insert into auth.users (id) values ($1)", [novo]);
      const r2 = await um2<{ papel: string; nome: string }>(d, "select papel, nome from membros where usuario_id = $1", [novo]);
      expect(r2).toEqual({ papel: "membro", nome: "" });
    } finally {
      await d.close();
    }
  });

  it("inserir o mesmo usuário duas vezes em auth.users não duplica (on conflict do nothing)", async () => {
    const d = await bancoAtéProjetos();
    try {
      const u = "33333333-3333-4333-8333-333333333333";
      await d.query("insert into auth.users (id) values ($1)", [u]);
      await d.exec(MEMBROS);
      // A migração já rodou (inseriu o existente como admin); o trigger roda só em inserts novos, então repetir
      // a mesma linha de auth.users violaria a PK, não a de membros — aqui conferimos que o registro existe uma vez só.
      const n = await um2<{ n: number }>(d, "select count(*)::int as n from membros where usuario_id = $1", [u]);
      expect(n.n).toBe(1);
    } finally {
      await d.close();
    }
  });

  it("papel inválido é recusado pelo check", async () => {
    const d = await bancoAtéProjetos();
    try {
      const u = "44444444-4444-4444-8444-444444444444";
      await d.query("insert into auth.users (id) values ($1)", [u]);
      await d.exec(MEMBROS);
      await expect(d.query("update membros set papel = 'super' where usuario_id = $1", [u])).rejects.toThrow(/check/);
    } finally {
      await d.close();
    }
  });

  it("permissoes precisa ser um objeto jsonb", async () => {
    const d = await bancoAtéProjetos();
    try {
      const u = "55555555-5555-4555-8555-555555555555";
      await d.query("insert into auth.users (id) values ($1)", [u]);
      await d.exec(MEMBROS);
      await expect(d.query("update membros set permissoes = '[1,2]'::jsonb where usuario_id = $1", [u])).rejects.toThrow(/check/);
      await d.query("update membros set permissoes = '{\"campanhas\":\"ver\"}'::jsonb where usuario_id = $1", [u]);
    } finally {
      await d.close();
    }
  });

  it("authenticated lê só a própria linha e não escreve; anon nada", async () => {
    const d = await bancoAtéProjetos();
    try {
      const eu = "66666666-6666-4666-8666-666666666666";
      const outro = "77777777-7777-4777-8777-777777777777";
      await d.query("insert into auth.users (id) values ($1), ($2)", [eu, outro]);
      await d.exec(MEMBROS);

      await comoUsuario(d, eu, async () => {
        const r = await d.query<{ usuario_id: string }>("select usuario_id from membros");
        expect(r.rows).toEqual([{ usuario_id: eu }]);
        await expect(d.query("update membros set nome = 'x' where usuario_id = $1", [eu])).rejects.toThrow(/permission denied/);
        await expect(d.query("delete from membros where usuario_id = $1", [eu])).rejects.toThrow(/permission denied/);
        await expect(
          d.query("insert into membros (usuario_id) values ($1)", ["88888888-8888-4888-8888-888888888888"]),
        ).rejects.toThrow(/permission denied/);
      });

      await d.exec("set role anon");
      try {
        await expect(d.query("select * from membros")).rejects.toThrow(/permission denied/);
      } finally {
        await d.exec("reset role");
      }
    } finally {
      await d.close();
    }
  });
});

describe("alertas.conexao_id (Etapa 3A, revisão)", () => {
  it("aceita conexao_id de uma conta existente e tem índice (conexao_id, created_at desc)", async () => {
    const { conexao } = await seed();
    const { id } = await um<{ id: string }>("insert into alertas (tipo, texto, conexao_id) values ('numero_caiu', 'Número n1 caiu', $1) returning id", [conexao]);
    const r = await um<{ conexao_id: string }>("select conexao_id from alertas where id = $1", [id]);
    expect(r.conexao_id).toBe(conexao);

    const idx = await um<{ indexdef: string } | undefined>("select indexdef from pg_indexes where indexname = 'alertas_conexao'");
    expect(idx?.indexdef).toMatch(/\(conexao_id, created_at DESC\)$/);
  });

  it("conexao_id é opcional (linhas antigas continuam null)", async () => {
    const { id } = await um<{ id: string }>("insert into alertas (tipo, texto) values ('grupo_cheio', 'x') returning id");
    const r = await um<{ conexao_id: string | null }>("select conexao_id from alertas where id = $1", [id]);
    expect(r.conexao_id).toBeNull();
  });

  it("conta excluída: o alerta fica (conexao_id vira null, igual campanha_id)", async () => {
    const { id: conexao2 } = await um<{ id: string }>(
      "insert into conexoes (nome, webhook_secret, status, zapbot_token_enc) values ('n-apagar', 's', 'conectado', 'cifrado') returning id",
    );
    const { id } = await um<{ id: string }>("insert into alertas (tipo, texto, conexao_id) values ('numero_caiu', 'Número n-apagar caiu', $1) returning id", [conexao2]);
    await db.query("delete from conexoes where id = $1", [conexao2]);
    const r = await um<{ conexao_id: string | null }>("select conexao_id from alertas where id = $1", [id]);
    expect(r.conexao_id).toBeNull();
  });
});

describe("acoes_v2 (Etapa 3C, Tarefa 1)", () => {
  it("execucoes.tipo aceita os 5 tipos novos e recusa um inventado", async () => {
    const { novaCampanha } = await seed();
    const camp = await novaCampanha("tipos-novos-execucao");
    for (const tipo of ["configuracao", "remover_participantes", "desativar_comunidade", "atualizar_links", "mover_grupos"]) {
      const r = await um<{ tipo: string }>("insert into execucoes (campanha_id, tipo) values ($1, $2) returning tipo", [camp, tipo]);
      expect(r.tipo).toBe(tipo);
    }
    await expect(db.query("insert into execucoes (campanha_id, tipo) values ($1, 'inventado')", [camp])).rejects.toThrow();
  });

  it("tarefas.tipo aceita os 5 tipos novos e recusa um inventado", async () => {
    const { conexao, novaCampanha, novoGrupo } = await seed();
    const camp = await novaCampanha("tipos-novos-tarefa");
    const { id: exec } = await um<{ id: string }>("insert into execucoes (campanha_id) values ($1) returning id", [camp]);
    const tipos = ["configuracao", "remover_participantes", "desativar_comunidade", "atualizar_links", "mover_grupos"];
    for (let i = 0; i < tipos.length; i++) {
      const grupo = await novoGrupo(camp, i + 1);
      const r = await um<{ tipo: string }>(
        "insert into tarefas (execucao_id, grupo_id, conexao_id, tipo) values ($1, $2, $3, $4) returning tipo",
        [exec, grupo, conexao, tipos[i]],
      );
      expect(r.tipo).toBe(tipos[i]);
    }
    const grupoInventado = await novoGrupo(camp, 99);
    await expect(
      db.query("insert into tarefas (execucao_id, grupo_id, conexao_id, tipo) values ($1, $2, $3, 'inventado')", [exec, grupoInventado, conexao]),
    ).rejects.toThrow();
  });

  // A 3C deixou `automacao_acoes.tipo` de fora; a 3F (automacoes_v3) ampliou com os tipos que o motor suporta.
  // "remover_participantes" (lista de telefones) continua sendo só de execução.
  it("automacao_acoes.tipo não ganha remover_participantes (ampliado só na 3F, com os tipos do motor)", async () => {
    const { novaCampanha } = await seed();
    const camp = await novaCampanha("automacao-sem-tipos-novos");
    const { id: automacao } = await um<{ id: string }>(
      "insert into automacoes (nome, campanha_id, gatilho) values ('a', $1, 'grupo_criado') returning id",
      [camp],
    );
    await expect(db.query("insert into automacao_acoes (automacao_id, tipo) values ($1, 'remover_participantes')", [automacao])).rejects.toThrow();
  });

  it("tarefas.progresso nasce em 0", async () => {
    const { conexao, novaCampanha, novoGrupo } = await seed();
    const camp = await novaCampanha("progresso");
    const grupo = await novoGrupo(camp, 1);
    const { id: exec } = await um<{ id: string }>("insert into execucoes (campanha_id) values ($1) returning id", [camp]);
    const { id } = await um<{ id: string }>("insert into tarefas (execucao_id, grupo_id, conexao_id) values ($1, $2, $3) returning id", [exec, grupo, conexao]);
    const r = await um<{ progresso: number }>("select progresso from tarefas where id = $1", [id]);
    expect(r.progresso).toBe(0);
  });

  it("execucoes.alvo_contas é opcional (null = todas as contas da campanha)", async () => {
    const { conexao, novaCampanha } = await seed();
    const camp = await novaCampanha("alvo-contas");
    const semAlvo = await um<{ alvo_contas: string[] | null }>("insert into execucoes (campanha_id) values ($1) returning alvo_contas", [camp]);
    expect(semAlvo.alvo_contas).toBeNull();
    const comAlvo = await um<{ alvo_contas: string[] | null }>(
      "insert into execucoes (campanha_id, alvo_contas) values ($1, array[$2]::uuid[]) returning alvo_contas",
      [camp, conexao],
    );
    expect(comAlvo.alvo_contas).toEqual([conexao]);
  });
});

describe("campanha_extras (Etapa 3D, Tarefa 1)", () => {
  it("tipo nasce 'campanha', aceita os outros 3 e recusa um inventado", async () => {
    const { novaCampanha } = await seed();
    const camp = await novaCampanha("tipo-padrao");
    const r = await um<{ tipo: string }>("select tipo from campanhas where id = $1", [camp]);
    expect(r.tipo).toBe("campanha");
    for (const tipo of ["lista", "viral", "aleatorio"]) {
      await db.query("update campanhas set tipo = $1 where id = $2", [tipo, camp]);
    }
    await expect(db.query("update campanhas set tipo = 'inventado' where id = $1", [camp])).rejects.toThrow(/check/);
  });

  it("link_apos_termino recusa url sem https; aceita null", async () => {
    const { novaCampanha } = await seed();
    const camp = await novaCampanha("link-termino");
    await expect(db.query("update campanhas set link_apos_termino = 'http://x' where id = $1", [camp])).rejects.toThrow(/check/);
    await db.query("update campanhas set link_apos_termino = 'https://x' where id = $1", [camp]);
    const r = await um<{ link_apos_termino: string }>("select link_apos_termino from campanhas where id = $1", [camp]);
    expect(r.link_apos_termino).toBe("https://x");
  });

  it("fixada, posicao, updated_at e reassociar_acoes nascem com o padrão certo", async () => {
    const { novaCampanha } = await seed();
    const camp = await novaCampanha("defaults-novos");
    const r = await um<{ fixada: boolean; posicao: number; updated_at: string; reassociar_acoes: boolean; termina_em: string | null }>(
      "select fixada, posicao, updated_at, reassociar_acoes, termina_em from campanhas where id = $1",
      [camp],
    );
    expect(r).toMatchObject({ fixada: false, posicao: 0, reassociar_acoes: true, termina_em: null });
    expect(r.updated_at).toBeTruthy();
  });

  it("updated_at muda a cada update de campanhas", async () => {
    const { novaCampanha } = await seed();
    const camp = await novaCampanha("updated-at-muda");
    const antes = await um<{ updated_at: string }>("select updated_at from campanhas where id = $1", [camp]);
    await db.query("update campanhas set nome = 'Outro nome' where id = $1", [camp]);
    const depois = await um<{ updated_at: string }>("select updated_at from campanhas where id = $1", [camp]);
    expect(new Date(depois.updated_at).getTime()).toBeGreaterThanOrEqual(new Date(antes.updated_at).getTime());
  });

  it("configuracoes: chave é única, valor é obrigatório", async () => {
    await db.query("insert into configuracoes (chave, valor) values ('padrao_campanha', '{}'::jsonb)");
    await expect(db.query("insert into configuracoes (chave, valor) values ('padrao_campanha', '{}'::jsonb)")).rejects.toThrow(/duplicate key|unique/);
    await expect(db.query("insert into configuracoes (chave) values ('sem_valor')")).rejects.toThrow(/null value/);
  });

  it("anon não lê nem grava em configuracoes; authenticated lê e escreve", async () => {
    await comoPapel("anon", async () => {
      await expect(db.query("select chave from configuracoes")).rejects.toThrow(/permission denied/);
      await expect(db.query("insert into configuracoes (chave, valor) values ('x', '{}'::jsonb)")).rejects.toThrow(/permission denied/);
    });
    await comoPapel("authenticated", async () => {
      await db.query("insert into configuracoes (chave, valor) values ('padrao_campanha_auth', '{\"ligado\":true}'::jsonb)");
      const r = await db.query<{ chave: string; valor: { ligado: boolean } }>("select chave, valor from configuracoes where chave = 'padrao_campanha_auth'");
      expect(r.rows).toEqual([{ chave: "padrao_campanha_auth", valor: { ligado: true } }]);
      await db.query("update configuracoes set valor = '{\"ligado\":false}'::jsonb where chave = 'padrao_campanha_auth'");
      await db.query("delete from configuracoes where chave = 'padrao_campanha_auth'");
    });
  });
});

describe("campanha_contas (Etapa 3D, revisão final)", () => {
  async function novaConta(nome: string): Promise<string> {
    return (await um<{ id: string }>("insert into conexoes (nome, webhook_secret, status, zapbot_token_enc) values ($1, 's', 'conectado', 'x') returning id", [nome])).id;
  }
  async function novaExec(camp: string, alvo: string[] | null, status = "agendada"): Promise<string> {
    return (await um<{ id: string }>("insert into execucoes (campanha_id, alvo_contas, status) values ($1, $2::uuid[], $3) returning id", [camp, alvo, status])).id;
  }
  async function exec(id: string) {
    return um<{ status: string; alvo_contas: string[] | null; motivo: string | null }>("select status, alvo_contas, motivo from execucoes where id = $1", [id]);
  }
  async function contasDa(camp: string): Promise<string[]> {
    const r = await db.query<{ conexao_id: string }>("select conexao_id from campanha_conexoes where campanha_id = $1 order by conexao_id", [camp]);
    return r.rows.map((x) => x.conexao_id);
  }

  it("remover_conta_das_execucoes: tira a conta do alvo das agendadas; última conta cancela com motivo; o resto não muda", async () => {
    const { novaCampanha } = await seed();
    const camp = await novaCampanha("remover-conta-rpc");
    const outraCamp = await novaCampanha("remover-conta-rpc-outra");
    const a = await novaConta("a");
    const b = await novaConta("b");
    const duas = await novaExec(camp, [a, b]);
    const so = await novaExec(camp, [a]);
    const todas = await novaExec(camp, null);
    const semA = await novaExec(camp, [b]);
    const concluida = await novaExec(camp, [a], "concluida");
    const deOutra = await novaExec(outraCamp, [a]);

    const r = await comoPapel("authenticated", () => um<{ reassociadas: number; canceladas: number }>("select * from remover_conta_das_execucoes($1, $2)", [camp, a]));
    expect(r).toEqual({ reassociadas: 1, canceladas: 1 });

    expect(await exec(duas)).toEqual({ status: "agendada", alvo_contas: [b], motivo: null });
    expect(await exec(so)).toEqual({ status: "cancelada", alvo_contas: [a], motivo: "A conta escolhida saiu da campanha." });
    expect((await exec(todas)).alvo_contas).toBeNull();
    expect(await exec(semA)).toEqual({ status: "agendada", alvo_contas: [b], motivo: null });
    expect(await exec(concluida)).toMatchObject({ status: "concluida", alvo_contas: [a] });
    expect(await exec(deOutra)).toMatchObject({ status: "agendada", alvo_contas: [a] });
  });

  it("aplicar_contas_campanha: insere as novas, apaga só as que saíram, ignora criadora e contas inexistentes, reassocia", async () => {
    const { conexao: criadora, novaCampanha } = await seed();
    const camp = await novaCampanha("aplicar-contas-rpc");
    const a = await novaConta("a2");
    const b = await novaConta("b2");
    const c = await novaConta("c2");
    await db.query("insert into campanha_conexoes (campanha_id, conexao_id) values ($1, $2), ($1, $3)", [camp, a, b]);
    const soA = await novaExec(camp, [a]);
    const aEc = await novaExec(camp, [a, c]);

    const inexistente = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const r = await comoPapel("authenticated", () =>
      um<Record<string, number>>("select * from aplicar_contas_campanha($1, $2::uuid[])", [camp, [b, c, criadora, inexistente, c]]),
    );
    expect(r).toEqual({ adicionadas: 1, removidas: 1, reassociadas: 1, canceladas: 1, mantidas: 0 });
    expect(await contasDa(camp)).toEqual([b, c].sort());
    expect(await exec(soA)).toMatchObject({ status: "cancelada", motivo: "A conta escolhida saiu da campanha." });
    expect(await exec(aEc)).toMatchObject({ status: "agendada", alvo_contas: [c] });
  });

  it("aplicar_contas_campanha: com reassociar_acoes desligado não mexe nas execuções e conta as que continuam usando a conta", async () => {
    const { novaCampanha } = await seed();
    const camp = await novaCampanha("aplicar-contas-sem-reassociar");
    await db.query("update campanhas set reassociar_acoes = false where id = $1", [camp]);
    const a = await novaConta("a3");
    const b = await novaConta("b3");
    await db.query("insert into campanha_conexoes (campanha_id, conexao_id) values ($1, $2)", [camp, a]);
    const soA = await novaExec(camp, [a]);
    const r = await um<Record<string, number>>("select * from aplicar_contas_campanha($1, $2::uuid[])", [camp, [b]]);
    expect(r).toEqual({ adicionadas: 1, removidas: 1, reassociadas: 0, canceladas: 0, mantidas: 1 });
    expect(await exec(soA)).toMatchObject({ status: "agendada", alvo_contas: [a] });
  });

  it("aplicar_contas_campanha: nunca apaga a linha da criadora; campanha inexistente dá erro", async () => {
    const { conexao: criadora, novaCampanha } = await seed();
    const camp = await novaCampanha("aplicar-contas-criadora");
    await db.query("insert into campanha_conexoes (campanha_id, conexao_id) values ($1, $2)", [camp, criadora]);
    const a = await novaConta("a4");
    await um("select * from aplicar_contas_campanha($1, $2::uuid[])", [camp, [a]]);
    expect(await contasDa(camp)).toEqual([a, criadora].sort());
    await expect(db.query("select * from aplicar_contas_campanha($1, $2::uuid[])", ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", [a]])).rejects.toThrow(/não encontrada/);
  });

  it("anon não executa as duas funções", async () => {
    const { novaCampanha } = await seed();
    const camp = await novaCampanha("rpc-contas-anon");
    await comoPapel("anon", async () => {
      await expect(db.query("select * from remover_conta_das_execucoes($1, $1)", [camp])).rejects.toThrow(/permission denied/);
      await expect(db.query("select * from aplicar_contas_campanha($1, '{}')", [camp])).rejects.toThrow(/permission denied/);
    });
  });

  describe("definir_campanhas_da_conta (revisão final — substitui a leitura-depois-escreve do app, sem corrida)", () => {
    it("entra nas campanhas pedidas, sai só das que não vieram, ignora a criadora e reassocia execuções", async () => {
      const { novaCampanha } = await seed();
      const entra = await novaCampanha("definir-conta-entra");
      const sai = await novaCampanha("definir-conta-sai");
      const criadora = await novaCampanha("definir-conta-criadora"); // conexao é criadora: nunca entra/sai daqui
      const conta = await novaConta("conta-definir");
      const outraConta = await novaConta("outra-conta-intocada");
      await db.query("update campanhas set conexao_criadora_id = $1 where id = $2", [conta, criadora]);
      await db.query("insert into campanha_conexoes (campanha_id, conexao_id) values ($1, $2), ($1, $3)", [sai, conta, outraConta]);
      // execuções de "sai": uma só com a conta (cancela) e outra com as duas (reassocia, fica só com a outra).
      const soConta = await novaExec(sai, [conta]);
      const ambas = await novaExec(sai, [conta, outraConta]);

      const r = await comoPapel("authenticated", () =>
        um<Record<string, number>>("select * from definir_campanhas_da_conta($1, $2::uuid[])", [conta, [entra, criadora]]),
      );
      expect(r).toEqual({ adicionadas: 1, removidas: 1, reassociadas: 1, canceladas: 1, mantidas: 0 });
      expect(await contasDa(entra)).toEqual([conta]);
      expect(await contasDa(sai)).toEqual([outraConta]); // a conta saiu; a outra continua intocada
      expect(await contasDa(criadora)).toEqual([]); // criadora nunca ganha linha em campanha_conexoes
      expect(await exec(soConta)).toMatchObject({ status: "cancelada", motivo: "A conta escolhida saiu da campanha." });
      expect(await exec(ambas)).toMatchObject({ status: "agendada", alvo_contas: [outraConta] });
    });

    it("pedir a mesma lista de novo não adiciona nem remove nada (idempotente)", async () => {
      const { novaCampanha } = await seed();
      const camp = await novaCampanha("definir-conta-idempotente");
      const conta = await novaConta("conta-idempotente");
      await um("select * from definir_campanhas_da_conta($1, $2::uuid[])", [conta, [camp]]);
      const r = await um<Record<string, number>>("select * from definir_campanhas_da_conta($1, $2::uuid[])", [conta, [camp]]);
      expect(r).toEqual({ adicionadas: 0, removidas: 0, reassociadas: 0, canceladas: 0, mantidas: 0 });
      expect(await contasDa(camp)).toEqual([conta]);
    });

    it("lista vazia tira a conta de todas as campanhas ATIVAS (menos onde ela é criadora)", async () => {
      const { novaCampanha } = await seed();
      const criadora = await novaCampanha("definir-conta-vazia-criadora");
      const outra = await novaCampanha("definir-conta-vazia-outra");
      const conta = await novaConta("conta-esvaziar");
      await db.query("update campanhas set conexao_criadora_id = $1 where id = $2", [conta, criadora]);
      await db.query("insert into campanha_conexoes (campanha_id, conexao_id) values ($1, $2)", [outra, conta]);
      const r = await um<Record<string, number>>("select * from definir_campanhas_da_conta($1, '{}'::uuid[])", [conta]);
      expect(r).toMatchObject({ removidas: 1 });
      expect(await contasDa(outra)).toEqual([]);
      expect(await contasDa(criadora)).toEqual([]);
    });

    it("ids inexistentes na lista são ignorados, sem erro", async () => {
      const { novaCampanha } = await seed();
      const camp = await novaCampanha("definir-conta-inexistente");
      const conta = await novaConta("conta-ids-inexistentes");
      const inexistente = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
      const r = await um<Record<string, number>>("select * from definir_campanhas_da_conta($1, $2::uuid[])", [conta, [camp, inexistente]]);
      expect(r).toMatchObject({ adicionadas: 1 });
      expect(await contasDa(camp)).toEqual([conta]);
    });

    it("campanha ARQUIVADA: a linha da conta nunca é tocada, nem apagada quando a lista vem vazia (correção crítica da revisão)", async () => {
      const { novaCampanha } = await seed();
      const ativa = await novaCampanha("definir-conta-arquivada-ativa");
      const arquivada = await novaCampanha("definir-conta-arquivada-arquivada");
      const conta = await novaConta("conta-com-campanha-arquivada");
      await db.query("update campanhas set arquivada = true where id = $1", [arquivada]);
      await db.query("insert into campanha_conexoes (campanha_id, conexao_id) values ($1, $2), ($3, $2)", [ativa, conta, arquivada]);
      // A aba só lista campanhas ativas: pedir a lista vazia (nada marcado) não pode tirar a conta da arquivada.
      const r = await um<Record<string, number>>("select * from definir_campanhas_da_conta($1, '{}'::uuid[])", [conta]);
      expect(r).toMatchObject({ removidas: 1 }); // só a "ativa" saiu
      expect(await contasDa(ativa)).toEqual([]);
      expect(await contasDa(arquivada)).toEqual([conta]); // intocada
      // Também não entra numa arquivada mesmo se o id vier na lista (pedido absurdo, mas não pode criar linha).
      const outraConta = await novaConta("conta-nao-entra-em-arquivada");
      const r2 = await um<Record<string, number>>("select * from definir_campanhas_da_conta($1, $2::uuid[])", [outraConta, [arquivada]]);
      expect(r2).toMatchObject({ adicionadas: 0 });
      expect(await contasDa(arquivada)).toEqual([conta]);
    });

    it("reassociar_acoes desligado: não mexe nas execuções da campanha de onde saiu, só conta as que continuam usando a conta em 'mantidas'", async () => {
      const { novaCampanha } = await seed();
      const semReassociar = await novaCampanha("definir-conta-sem-reassociar");
      await db.query("update campanhas set reassociar_acoes = false where id = $1", [semReassociar]);
      const conta = await novaConta("conta-sem-reassociar");
      await db.query("insert into campanha_conexoes (campanha_id, conexao_id) values ($1, $2)", [semReassociar, conta]);
      const soConta = await novaExec(semReassociar, [conta]);

      const r = await um<Record<string, number>>("select * from definir_campanhas_da_conta($1, '{}'::uuid[])", [conta]);
      expect(r).toEqual({ adicionadas: 0, removidas: 1, reassociadas: 0, canceladas: 0, mantidas: 1 });
      expect(await contasDa(semReassociar)).toEqual([]); // a conta saiu da campanha mesmo assim
      expect(await exec(soConta)).toMatchObject({ status: "agendada", alvo_contas: [conta] }); // execução intocada
    });

    it("mistura campanhas com reassociar_acoes ligado e desligado na mesma chamada", async () => {
      const { novaCampanha } = await seed();
      const com = await novaCampanha("definir-conta-mix-com");
      const sem = await novaCampanha("definir-conta-mix-sem");
      await db.query("update campanhas set reassociar_acoes = false where id = $1", [sem]);
      const conta = await novaConta("conta-mix");
      await db.query("insert into campanha_conexoes (campanha_id, conexao_id) values ($1, $2), ($3, $2)", [com, conta, sem]);
      const execCom = await novaExec(com, [conta]);
      const execSem = await novaExec(sem, [conta]);

      const r = await um<Record<string, number>>("select * from definir_campanhas_da_conta($1, '{}'::uuid[])", [conta]);
      expect(r).toEqual({ adicionadas: 0, removidas: 2, reassociadas: 0, canceladas: 1, mantidas: 1 });
      expect(await exec(execCom)).toMatchObject({ status: "cancelada" });
      expect(await exec(execSem)).toMatchObject({ status: "agendada" });
    });

    it("anon não executa; equipe logada sim", async () => {
      const { novaCampanha } = await seed();
      const camp = await novaCampanha("definir-conta-anon");
      const conta = await novaConta("conta-anon");
      await comoPapel("anon", async () => {
        await expect(db.query("select * from definir_campanhas_da_conta($1, '{}')", [conta])).rejects.toThrow(/permission denied/);
      });
      await comoPapel("authenticated", () => db.query("select * from definir_campanhas_da_conta($1, $2)", [conta, [camp]]));
    });
  });
});

describe("grupos_extras (Etapa 3E, Tarefa 1)", () => {
  it("campanhas: opções de criação nascem com os padrões que não mudam nada", async () => {
    const { novaCampanha } = await seed();
    const camp = await novaCampanha("grupos-extras-padrao");
    const r = await um<Record<string, unknown>>(
      "select caractere_numeracao, inicio_contagem, numero_no_inicio, nao_criar_grupos, limite_cliques_sem_criar, criar_aberto_fechar_24h, mensagens_temporarias, aprovacao_entrada, modo_criacao from campanhas where id = $1",
      [camp],
    );
    expect(r).toEqual({
      caractere_numeracao: "",
      inicio_contagem: 1,
      numero_no_inicio: false,
      nao_criar_grupos: false,
      limite_cliques_sem_criar: null,
      criar_aberto_fechar_24h: false,
      mensagens_temporarias: "nao",
      aprovacao_entrada: false,
      modo_criacao: "normal",
    });
  });

  it("campanhas: checks recusam valores fora do combinado", async () => {
    const { novaCampanha } = await seed();
    const camp = await novaCampanha("grupos-extras-checks");
    await db.query("update campanhas set caractere_numeracao = '###', inicio_contagem = 0, limite_cliques_sem_criar = 1, mensagens_temporarias = '90d', modo_criacao = 'seguro' where id = $1", [camp]);
    await expect(db.query("update campanhas set caractere_numeracao = '####' where id = $1", [camp])).rejects.toThrow(/check/);
    await expect(db.query("update campanhas set inicio_contagem = -1 where id = $1", [camp])).rejects.toThrow(/check/);
    await expect(db.query("update campanhas set limite_cliques_sem_criar = 0 where id = $1", [camp])).rejects.toThrow(/check/);
    await expect(db.query("update campanhas set mensagens_temporarias = '30d' where id = $1", [camp])).rejects.toThrow(/check/);
    await expect(db.query("update campanhas set modo_criacao = 'rapido' where id = $1", [camp])).rejects.toThrow(/check/);
    await expect(db.query("update campanhas set caractere_numeracao = null where id = $1", [camp])).rejects.toThrow(/null value/);
  });

  it("grupos: cheio_manual nasce null (automático) e suspenso false; grupos antigos ganham os mesmos padrões", async () => {
    const antigo = await um<{ cheio_manual: boolean | null; suspenso: boolean }>("select cheio_manual, suspenso from grupos where id = $1", [antigos.grupo]);
    expect(antigo).toEqual({ cheio_manual: null, suspenso: false });
    const { novaCampanha, novoGrupo } = await seed();
    const g = await novoGrupo(await novaCampanha("grupos-extras-grupo"), 1);
    await db.query("update grupos set cheio_manual = false where id = $1", [g]);
    const r = await um<{ cheio_manual: boolean | null; suspenso: boolean; cheio: boolean }>("select cheio_manual, suspenso, cheio from grupos where id = $1", [g]);
    expect(r).toEqual({ cheio_manual: false, suspenso: false, cheio: false });
  });

  it("grupo_variaveis: chave única por grupo, chave no formato das variáveis, apaga junto com o grupo", async () => {
    const { novaCampanha, novoGrupo } = await seed();
    const g = await novoGrupo(await novaCampanha("grupo-variaveis"), 1);
    await db.query("insert into grupo_variaveis (grupo_id, chave, valor) values ($1, 'cupom', 'X10')", [g]);
    await expect(db.query("insert into grupo_variaveis (grupo_id, chave, valor) values ($1, 'cupom', 'Y')", [g])).rejects.toThrow(/duplicate key|unique/);
    await expect(db.query("insert into grupo_variaveis (grupo_id, chave) values ($1, 'Cupom')", [g])).rejects.toThrow(/check/);
    const vazio = await um<{ valor: string }>("insert into grupo_variaveis (grupo_id, chave) values ($1, 'link_extra') returning valor", [g]);
    expect(vazio.valor).toBe("");
    await db.query("delete from grupos where id = $1", [g]);
    const r = await um<{ n: number }>("select count(*)::int as n from grupo_variaveis where grupo_id = $1", [g]);
    expect(r.n).toBe(0);
  });

  it("grupo_variaveis: anon sem acesso; authenticated lê e escreve", async () => {
    const { novaCampanha, novoGrupo } = await seed();
    const g = await novoGrupo(await novaCampanha("grupo-variaveis-rls"), 1);
    await comoPapel("anon", async () => {
      await expect(db.query("select * from grupo_variaveis")).rejects.toThrow(/permission denied/);
      await expect(db.query("insert into grupo_variaveis (grupo_id, chave) values ($1, 'abc')", [g])).rejects.toThrow(/permission denied/);
    });
    await comoPapel("authenticated", async () => {
      await db.query("insert into grupo_variaveis (grupo_id, chave, valor) values ($1, 'abc', 'v')", [g]);
      await db.query("update grupo_variaveis set valor = 'w' where grupo_id = $1", [g]);
      const r = await db.query<{ valor: string }>("select valor from grupo_variaveis where grupo_id = $1", [g]);
      expect(r.rows).toEqual([{ valor: "w" }]);
      await db.query("delete from grupo_variaveis where grupo_id = $1", [g]);
    });
  });

  it("tarefas.conteudo_grupo nasce null e pegar_tarefas devolve a coluna", async () => {
    const { conexao, novaCampanha, novoGrupo } = await seed();
    const camp = await novaCampanha("conteudo-grupo");
    const g = await novoGrupo(camp, 1);
    const { id: exec } = await um<{ id: string }>("insert into execucoes (campanha_id) values ($1) returning id", [camp]);
    await db.query("insert into tarefas (execucao_id, grupo_id, conexao_id, conteudo_grupo, enviar_apos) values ($1, $2, $3, $4, now() - interval '1 minute')", [exec, g, conexao, { texto: "oi X10" }]);
    const r = await db.query<{ execucao_id: string; conteudo_grupo: unknown }>("select * from pegar_tarefas(100)");
    expect(r.rows.find((t) => t.execucao_id === exec)?.conteudo_grupo).toEqual({ texto: "oi X10" });
  });
});

describe("automacoes_v3 (Etapa 3F, Tarefa 1)", () => {
  async function automacao(gatilho: string, extra = "", valores: unknown[] = []) {
    const { novaCampanha } = await seed();
    const camp = await novaCampanha(`v3-${gatilho.replace(/_/g, "-")}-${Math.random().toString(36).slice(2, 8)}`);
    const cols = extra ? `, ${extra}` : "";
    const params = valores.map((_, i) => `, $${i + 2}`).join("");
    return { camp, ...(await um<{ id: string }>(`insert into automacoes (nome, campanha_id, gatilho${cols}) values ('a', $1, '${gatilho}'${params}) returning id`, [camp, ...valores])) };
  }

  it("automacao_acoes aceita os tipos novos e continua aceitando os antigos; recusa o resto", async () => {
    const { id } = await automacao("grupo_criado");
    const tipos = [
      "mensagem", "enquete", "nome", "descricao", "abrir", "fechar", "admin_add", "admin_remover", "redefinir_link", "remover_participante",
      "configuracao", "atualizar_links", "desativar_comunidade", "mover_grupos", "tag_condicional",
    ];
    for (const tipo of tipos) await db.query("insert into automacao_acoes (automacao_id, tipo) values ($1, $2)", [id, tipo]);
    await expect(db.query("insert into automacao_acoes (automacao_id, tipo) values ($1, 'remover_participantes')", [id])).rejects.toThrow(/automacao_acoes_tipo_check/);
    await expect(db.query("insert into automacao_acoes (automacao_id, tipo) values ($1, 'xyz')", [id])).rejects.toThrow(/automacao_acoes_tipo_check/);
  });

  it("alvo_contas: nasce null (todas); lista vazia recusada", async () => {
    const { id } = await automacao("grupo_criado");
    expect(await um("select alvo_contas, checkout_evento from automacoes where id = $1", [id])).toEqual({ alvo_contas: null, checkout_evento: null });
    const conta = "66666666-6666-4666-8666-666666666666";
    await db.query("update automacoes set alvo_contas = $2 where id = $1", [id, [conta]]);
    expect(await um("select alvo_contas from automacoes where id = $1", [id])).toEqual({ alvo_contas: [conta] });
    await expect(db.query("update automacoes set alvo_contas = '{}' where id = $1", [id])).rejects.toThrow(/check/);
  });

  it("checkout: sem provedor = qualquer plataforma (só o produto é exigido); evento aprovada/recusada", async () => {
    const { id } = await automacao("checkout", "produto", ["Formação"]);
    expect(await um("select provedor, produto from automacoes where id = $1", [id])).toEqual({ provedor: null, produto: "Formação" });
    await expect(automacao("checkout")).rejects.toThrow(/automacoes_checkout_campos/);
    await expect(automacao("checkout", "provedor", ["stripe"])).rejects.toThrow(/check/);
    await db.query("update automacoes set checkout_evento = 'aprovada' where id = $1", [id]);
    await db.query("update automacoes set checkout_evento = 'recusada' where id = $1", [id]);
    await expect(db.query("update automacoes set checkout_evento = 'estornada' where id = $1", [id])).rejects.toThrow(/check/);
  });

  it("checkout_campos nas duas direções: fora do checkout, nem produto, nem plataforma, nem evento", async () => {
    await expect(automacao("entrou", "produto", ["Curso"])).rejects.toThrow(/automacoes_checkout_campos/);
    await expect(automacao("entrou", "provedor", ["hotmart"])).rejects.toThrow(/automacoes_checkout_campos/);
    await expect(automacao("entrou", "checkout_evento", ["aprovada"])).rejects.toThrow(/automacoes_checkout_campos/);
    const { id } = await automacao("checkout", "provedor, produto, checkout_evento", ["kiwify", "Curso", "aprovada"]);
    expect(await um("select provedor, checkout_evento from automacoes where id = $1", [id])).toEqual({ provedor: "kiwify", checkout_evento: "aprovada" });
  });

  it("só aditiva: automações e ações gravadas antes continuam iguais e válidas", async () => {
    const d = await bancoAtéProjetos();
    try {
      for (const m of [MEMBROS, ALERTAS_CONEXAO, LISTAR_ACOES, ACOES_V2, CAMPANHA_EXTRAS, CAMPANHA_CONTAS, GRUPOS_EXTRAS]) await d.exec(m);
      const { id: conexao } = await um2<{ id: string }>(d, "insert into conexoes (nome, webhook_secret, status, zapbot_token_enc) values ('n', 's', 'conectado', 'c') returning id");
      const { id: camp } = await um2<{ id: string }>(d, "insert into campanhas (nome, slug, conexao_criadora_id) values ('v3', 'v3-antiga', $1) returning id", [conexao]);
      const { id: ck } = await um2<{ id: string }>(d, "insert into automacoes (nome, campanha_id, gatilho, provedor, produto, ativo) values ('ck', $1, 'checkout', 'hotmart', 'Curso', true) returning id", [camp]);
      const { id: cr } = await um2<{ id: string }>(d, "insert into automacoes (nome, campanha_id, gatilho, quando, alvo_grupos) values ('cr', $1, 'cronograma', now(), null) returning id", [camp]);
      await d.query("insert into automacao_acoes (automacao_id, tipo) values ($1, 'remover_participante'), ($2, 'abrir')", [ck, cr]);
      // O check antigo deixava, fora do checkout, provedor sem produto: a v3 zera (campo não lido fora do checkout).
      await d.query("insert into automacoes (nome, campanha_id, gatilho, provedor) values ('zz', $1, 'entrou', 'hotmart')", [camp]);
      const antes = (await d.query("select * from automacoes where nome <> 'zz' order by nome")).rows;
      const acoesAntes = (await d.query("select * from automacao_acoes order by tipo")).rows;

      await d.exec(AUTOMACOES_V3);

      expect(await um2(d, "select provedor, produto from automacoes where nome = 'zz'")).toEqual({ provedor: null, produto: null });
      const depois = (await d.query("select * from automacoes where nome <> 'zz' order by nome")).rows as Record<string, unknown>[];
      expect(depois.map(({ alvo_contas, checkout_evento, ...resto }) => resto)).toEqual(antes);
      expect(depois.every((r) => r.alvo_contas === null && r.checkout_evento === null)).toBe(true);
      expect((await d.query("select * from automacao_acoes order by tipo")).rows).toEqual(acoesAntes);
      // As linhas antigas passam nos checks novos (validação explícita das constraints).
      await d.query("update automacoes set nome = nome");
      await d.query("update automacao_acoes set tipo = tipo");
    } finally {
      await d.close();
    }
  }, 60_000);
});

describe("automacoes_contas_vendas (Etapa 3F, revisão da Tarefa 1)", () => {
  async function cenario(reassociar: boolean) {
    const { conexao: criadora, novaCampanha } = await seed();
    const camp = await novaCampanha(`v3c-${Math.random().toString(36).slice(2, 8)}`);
    await db.query("update campanhas set reassociar_acoes = $2 where id = $1", [camp, reassociar]);
    const conta = async (n: string) => (await um<{ id: string }>("insert into conexoes (nome, webhook_secret, status, zapbot_token_enc) values ($1, 's', 'conectado', 'c') returning id", [n])).id;
    const c1 = await conta("c1");
    const c2 = await conta("c2");
    await db.query("select * from aplicar_contas_campanha($1, $2)", [camp, [c1, c2]]);
    const nova = async (nome: string, alvo: string[] | null) =>
      (await um<{ id: string }>("insert into automacoes (nome, campanha_id, gatilho, ativo, alvo_contas) values ($1, $2, 'grupo_criado', true, $3) returning id", [nome, camp, alvo])).id;
    return { camp, criadora, c1, c2, nova };
  }
  const ler = (id: string) => um<{ ativo: boolean; alvo_contas: string[] | null; motivo_desativada: string | null }>("select ativo, alvo_contas, motivo_desativada from automacoes where id = $1", [id]);

  it("motivo_desativada nasce null", async () => {
    const { nova } = await cenario(true);
    expect((await ler(await nova("a", null))).motivo_desativada).toBeNull();
  });

  it("conta sai (reassociar ligado): tira das automações; lista vazia desativa com motivo e guarda a lista; null (todas) não muda", async () => {
    const { camp, c1, c2, nova } = await cenario(true);
    const duas = await nova("duas", [c1, c2]);
    const so = await nova("so", [c2]);
    const todas = await nova("todas", null);
    const outra = await cenario(true);
    const deOutra = await outra.nova("outra", [outra.c2]);
    await db.query("select * from aplicar_contas_campanha($1, $2)", [camp, [c1]]);
    expect(await ler(duas)).toEqual({ ativo: true, alvo_contas: [c1], motivo_desativada: null });
    expect(await ler(so)).toEqual({ ativo: false, alvo_contas: [c2], motivo_desativada: "A conta escolhida saiu da campanha." });
    expect(await ler(todas)).toEqual({ ativo: true, alvo_contas: null, motivo_desativada: null });
    expect(await ler(deOutra)).toEqual({ ativo: true, alvo_contas: [outra.c2], motivo_desativada: null });
  });

  it("remover_conta_das_execucoes direto: mesmas contagens das execuções; automações tratadas junto", async () => {
    const { camp, c2, nova } = await cenario(true);
    const so = await nova("so", [c2]);
    await db.query("insert into execucoes (campanha_id, status, alvo_contas) values ($1, 'agendada', $2)", [camp, [c2]]);
    const r = await um("select * from remover_conta_das_execucoes($1, $2)", [camp, c2]);
    expect(r).toEqual({ reassociadas: 0, canceladas: 1 });
    expect((await ler(so)).ativo).toBe(false);
  });

  it("reassociar desligado: nada é mexido (execuções nem automações)", async () => {
    const { camp, c1, c2, nova } = await cenario(false);
    const so = await nova("so", [c2]);
    await db.query("select * from aplicar_contas_campanha($1, $2)", [camp, [c1]]);
    expect(await ler(so)).toEqual({ ativo: true, alvo_contas: [c2], motivo_desativada: null });
  });

  it("funções mantêm os grants: anon não executa", async () => {
    await comoPapel("anon", async () => {
      await expect(db.query("select * from remover_conta_das_execucoes(gen_random_uuid(), gen_random_uuid())")).rejects.toThrow(/permission denied/);
      await expect(db.query("select * from aplicar_contas_campanha(gen_random_uuid(), '{}')")).rejects.toThrow(/permission denied/);
    });
  });

  describe("registrar_venda", () => {
    const registrar = (evento: string, aprovada: boolean, telefone: string | null, produtos: string[], payload: unknown) =>
      comoPapel("service_role", () => db.query("select registrar_venda('kiwify', $1, $2, $3, $4, $5)", [evento, aprovada, telefone, produtos, payload]));
    const venda = (evento: string) =>
      um<Record<string, unknown>>("select aprovada, telefone, produtos, payload, processada_em, resultado from vendas where provedor = 'kiwify' and evento_id = $1", [evento]);

    it("nova: grava como veio", async () => {
      await registrar("k-nova", true, "5511" + "900000001", ["Curso"], { a: 1 });
      expect(await venda("k-nova")).toEqual({ aprovada: true, telefone: "5511" + "900000001", produtos: ["Curso"], payload: { a: 1 }, processada_em: null, resultado: null });
    });

    it("não aprovada já processada + aprovada depois (mesmo order_id): vira aprovada com os dados novos e volta pra fila", async () => {
      await registrar("k-1", false, null, ["Curso"], { s: "waiting" });
      await db.query("update vendas set processada_em = now(), resultado = 'ignorada (não é compra aprovada)' where evento_id = 'k-1'");
      await registrar("k-1", true, "5511" + "900000002", ["Curso", "Bônus"], { s: "paid" });
      expect(await venda("k-1")).toEqual({ aprovada: true, telefone: "5511" + "900000002", produtos: ["Curso", "Bônus"], payload: { s: "paid" }, processada_em: null, resultado: null });
    });

    it("aprovada nunca volta a não aprovada; aprovada repetida e não aprovada repetida não mudam nada", async () => {
      await registrar("k-2", true, "5511" + "900000003", ["Curso"], { s: "paid" });
      await db.query("update vendas set processada_em = '2026-10-17T10:00:00Z', resultado = 'ok' where evento_id = 'k-2'");
      await registrar("k-2", false, null, [], { s: "refunded" });
      await registrar("k-2", true, "5511" + "999999999", ["Outro"], { s: "paid2" });
      const r = await venda("k-2");
      expect(r).toMatchObject({ aprovada: true, telefone: "5511" + "900000003", produtos: ["Curso"], payload: { s: "paid" }, resultado: "ok" });
      expect(r.processada_em).not.toBeNull();
      await registrar("k-3", false, null, ["Curso"], { s: "a" });
      await db.query("update vendas set processada_em = now(), resultado = 'ignorada' where evento_id = 'k-3'");
      await registrar("k-3", false, "5511" + "900000004", ["Curso"], { s: "b" });
      expect(await venda("k-3")).toMatchObject({ aprovada: false, telefone: null, payload: { s: "a" }, resultado: "ignorada" });
    });

    it("só o service_role executa", async () => {
      for (const papel of ["anon", "authenticated"]) {
        await comoPapel(papel, async () => {
          await expect(db.query("select registrar_venda('kiwify', 'x', true, null, '{}', '{}')")).rejects.toThrow(/permission denied/);
        });
      }
    });
  });
});

describe("recibos_pessoa (Etapa 3G, Tarefa 1)", () => {
  /** Campanha com 2 grupos (10 e 0 participantes), uma execução e uma tarefa por grupo com message_id próprio. */
  async function cenario() {
    const { conexao, novaCampanha, novoGrupo } = await seed();
    const sufixo = Math.random().toString(36).slice(2, 8);
    const camp = await novaCampanha(`recibos-${sufixo}`);
    const g1 = await novoGrupo(camp, 1);
    const g2 = await novoGrupo(camp, 2);
    await db.query("update grupos set participantes = 10 where id = $1", [g1]);
    const { id: exec } = await um<{ id: string }>("insert into execucoes (campanha_id, status) values ($1, 'concluida') returning id", [camp]);
    const tarefa = async (g: string, msg: string) =>
      (await um<{ id: string }>("insert into tarefas (execucao_id, grupo_id, conexao_id, status, message_id, enviado_em) values ($1, $2, $3, 'enviado', $4, now()) returning id", [exec, g, conexao, msg])).id;
    const m1 = `M1-${sufixo}`;
    const m2 = `M2-${sufixo}`;
    const t1 = await tarefa(g1, m1);
    const t2 = await tarefa(g2, m2);
    return { camp, exec, g1, g2, m1, m2, t1, t2 };
  }
  const somar = (ids: string[], lido: boolean, tel: string | null, tipo: string | null) =>
    comoPapel("service_role", () => db.query("select somar_recibos($1, $2, $3, $4)", [ids, lido, tel, tipo]));
  const contagem = (id: string) => um<{ entregues: number; lidos: number }>("select entregues, lidos from tarefas where id = $1", [id]);

  it("com telefone: grava o recibo da pessoa e soma; aviso repetido não conta de novo", async () => {
    const { m1, t1 } = await cenario();
    await somar([m1], false, "5511" + "900000001", "recebeu");
    await somar([m1], false, "5511" + "900000001", "recebeu");
    await somar([m1], true, "5511" + "900000001", "visualizou");
    await somar([m1], true, "5511" + "900000001", "visualizou");
    await somar([m1], false, "5511" + "900000002", "recebeu");
    expect(await contagem(t1)).toEqual({ entregues: 2, lidos: 1 });
    const r = await db.query<{ telefone: string; tipo: string }>("select telefone, tipo from recibos where tarefa_id = $1 order by telefone, tipo", [t1]);
    expect(r.rows).toEqual([
      { telefone: "5511" + "900000001", tipo: "recebeu" },
      { telefone: "5511" + "900000001", tipo: "visualizou" },
      { telefone: "5511" + "900000002", tipo: "recebeu" },
    ]);
  });

  it("PLAYED vira 'reproduziu': grava a linha e não soma em lidos nem entregues", async () => {
    const { m1, t1 } = await cenario();
    await somar([m1], false, "5511" + "900000003", "reproduziu");
    await somar([m1], false, "5511" + "900000003", "reproduziu");
    expect(await contagem(t1)).toEqual({ entregues: 0, lidos: 0 });
    const r = await um<{ n: number }>("select count(*)::int as n from recibos where tarefa_id = $1 and tipo = 'reproduziu'", [t1]);
    expect(r.n).toBe(1);
    // Sem telefone, reproduziu não tem onde gravar nem o que somar.
    await somar([m1], false, null, "reproduziu");
    expect(await contagem(t1)).toEqual({ entregues: 0, lidos: 0 });
  });

  it("assinatura antiga (p_ids, p_lido) continua somando como antes, sem linha por pessoa", async () => {
    const { m1, m2, t1, t2 } = await cenario();
    await comoPapel("service_role", async () => {
      await db.query("select somar_recibos(array[$1, $2], false)", [m1, m2]);
      await db.query("select somar_recibos(p_ids => array[$1], p_lido => true)", [m1]);
    });
    expect(await contagem(t1)).toEqual({ entregues: 1, lidos: 1 });
    expect(await contagem(t2)).toEqual({ entregues: 1, lidos: 0 });
    const r = await um<{ n: number }>("select count(*)::int as n from recibos where tarefa_id in ($1, $2)", [t1, t2]);
    expect(r.n).toBe(0);
  });

  it("pessoa desconhecida (telefone null ou vazio) cai no comportamento antigo: soma, sem linha", async () => {
    const { m1, t1 } = await cenario();
    await somar([m1], false, null, "recebeu");
    await somar([m1], true, "  ", null);
    expect(await contagem(t1)).toEqual({ entregues: 1, lidos: 1 });
    expect((await um<{ n: number }>("select count(*)::int as n from recibos where tarefa_id = $1", [t1])).n).toBe(0);
  });

  it("tipo fora do combinado é recusado; message_id desconhecido não faz nada", async () => {
    const { m1 } = await cenario();
    await expect(somar([m1], false, "5511" + "900000009", "reagiu")).rejects.toThrow(/tipo de recibo inválido/);
    await somar(["nao-existe"], false, "5511" + "900000009", "recebeu");
    expect((await um<{ n: number }>("select count(*)::int as n from recibos where telefone = '5511" + "900000009'")).n).toBe(0);
  });

  it("só a chave primária: sem índices extras em recibos (nenhuma leitura usaria)", async () => {
    const r = await db.query<{ indexname: string }>("select indexname from pg_indexes where tablename = 'recibos' order by 1");
    expect(r.rows).toEqual([{ indexname: "recibos_pkey" }]);
  });

  it("apagar a tarefa apaga os recibos dela", async () => {
    const { m1, t1 } = await cenario();
    await somar([m1], false, "5511" + "900000010", "recebeu");
    await db.query("delete from tarefas where id = $1", [t1]);
    expect((await um<{ n: number }>("select count(*)::int as n from recibos where tarefa_id = $1", [t1])).n).toBe(0);
  });

  it("leadscore_campanha: pontos 10/20/40, ordem por pontos, busca por dígitos, chips e paginação com total", async () => {
    const { camp, m1, m2 } = await cenario();
    await somar([m1], false, "5511" + "911111111", "recebeu");
    await somar([m1], true, "5511" + "911111111", "visualizou");
    await somar([m1], false, "5511" + "911111111", "reproduziu");
    await somar([m2], false, "5511" + "922222222", "recebeu");
    await somar([m2], true, "5511" + "922222222", "visualizou");
    await somar([m1], false, "5511" + "933333333", "recebeu");
    type L = { telefone: string; pontos: number; recebeu: number; visualizou: number; reproduziu: number; total: number };
    const ler = (sql: string, params: unknown[]) =>
      comoPapel("authenticated", () => db.query<L>(`select telefone, pontos::int, recebeu::int, visualizou::int, reproduziu::int, total::int from ${sql}`, params));
    const tudo = await ler("leadscore_campanha($1, null, 25, 0)", [camp]);
    expect(tudo.rows).toEqual([
      { telefone: "5511" + "911111111", pontos: 70, recebeu: 1, visualizou: 1, reproduziu: 1, total: 3 },
      { telefone: "5511" + "922222222", pontos: 30, recebeu: 1, visualizou: 1, reproduziu: 0, total: 3 },
      { telefone: "5511" + "933333333", pontos: 10, recebeu: 1, visualizou: 0, reproduziu: 0, total: 3 },
    ]);
    const busca = await ler("leadscore_campanha($1, '(11) 92222', 25, 0)", [camp]);
    expect(busca.rows.map((l) => l.telefone)).toEqual(["5511" + "922222222"]);
    const pagina = await ler("leadscore_campanha($1, null, 1, 1)", [camp]);
    expect(pagina.rows).toEqual([{ telefone: "5511" + "922222222", pontos: 30, recebeu: 1, visualizou: 1, reproduziu: 0, total: 3 }]);
    const soReproduziu = await ler("leadscore_campanha($1, null, 25, 0, array['reproduziu'])", [camp]);
    expect(soReproduziu.rows).toEqual([{ telefone: "5511" + "911111111", pontos: 40, recebeu: 0, visualizou: 0, reproduziu: 1, total: 1 }]);
    const outra = await ler("leadscore_campanha(gen_random_uuid(), null, 25, 0)", []);
    expect(outra.rows).toEqual([]);
    // Exportação: o ranking inteiro numa chamada (um jsonb), na mesma ordem e com os mesmos chips/busca.
    const exportar = (args: string, params: unknown[]) =>
      comoPapel("authenticated", () => db.query<{ j: unknown }>(`select leadscore_exportar(${args}) as j`, params));
    expect((await exportar("$1", [camp])).rows[0].j).toEqual([
      { telefone: "5511" + "911111111", pontos: 70, recebeu: 1, visualizou: 1, reproduziu: 1 },
      { telefone: "5511" + "922222222", pontos: 30, recebeu: 1, visualizou: 1, reproduziu: 0 },
      { telefone: "5511" + "933333333", pontos: 10, recebeu: 1, visualizou: 0, reproduziu: 0 },
    ]);
    expect((await exportar("$1, null, array['reproduziu']", [camp])).rows[0].j).toEqual([{ telefone: "5511" + "911111111", pontos: 40, recebeu: 0, visualizou: 0, reproduziu: 1 }]);
    expect((await exportar("gen_random_uuid()", [])).rows[0].j).toEqual([]);
  });

  it("volume_recibos: agrupa por período de Brasília, com os vazios em zero; recusa agrupamento desconhecido", async () => {
    const { camp, m1, t1 } = await cenario();
    await somar([m1], false, "5511" + "944444444", "recebeu");
    await somar([m1], true, "5511" + "944444444", "visualizou");
    await somar([m1], false, "5511" + "955555555", "recebeu");
    // Um recibo de 2 dias atrás.
    await db.query("update recibos set em = now() - interval '2 days' where tarefa_id = $1 and telefone = '5511" + "955555555'", [t1]);
    type V = { periodo: string; recebeu: number; visualizou: number; reproduziu: number };
    const dias = await comoPapel("authenticated", () =>
      db.query<V>("select periodo, recebeu::int, visualizou::int, reproduziu::int from volume_recibos($1, 'dia', now() - interval '6 days')", [camp]),
    );
    expect(dias.rows.length).toBe(7);
    expect(dias.rows.at(-1)).toMatchObject({ recebeu: 1, visualizou: 1, reproduziu: 0 });
    expect(dias.rows.reduce((s, r) => s + r.recebeu, 0)).toBe(2);
    expect(dias.rows[0].periodo).toMatch(/^\d{4}-\d{2}-\d{2} 00:00$/);
    // O primeiro período começa às 00:00 de Brasília, não em p_inicio: um recibo logo depois da meia-noite do
    // primeiro dia (antes de p_inicio) entra nele.
    await db.query(
      "update recibos set em = (date_trunc('day', (now() - interval '6 days') at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo') + interval '1 minute' where tarefa_id = $1 and telefone = '5511" + "955555555'",
      [t1],
    );
    const primeiro = await db.query<V>("select periodo, recebeu::int, visualizou::int, reproduziu::int from volume_recibos($1, 'dia', now() - interval '6 days')", [camp]);
    expect(primeiro.rows[0].recebeu).toBe(1);
    const horas = await db.query<V>("select * from volume_recibos($1, 'hora', now() - interval '365 days')", [camp]);
    expect(horas.rows.length).toBeLessThanOrEqual(31 * 24 + 1);
    await expect(db.query("select * from volume_recibos($1, 'ano', now())", [camp])).rejects.toThrow(/agrupamento inválido/);
  });

  it("desempenho_grupos: pontos do critério ÷ participantes atuais (mínimo 1), filtro por disparo e por nome", async () => {
    const { camp, exec, g1, g2, m1, m2 } = await cenario();
    for (let i = 0; i < 5; i++) await somar([m1], true, `551197000000${i}`, "visualizou");
    await somar([m2], false, "5511" + "980000000", "recebeu");
    type D = { grupo_id: string; pontos: number; pontuacao: string; participantes: number };
    const ler = (criterio: string, execucao: string | null = null, busca: string | null = null) =>
      comoPapel("authenticated", () =>
        db.query<D>("select grupo_id, pontos::int, pontuacao::text, participantes from desempenho_grupos($1, $2, $3, 20, $4)", [camp, criterio, execucao, busca]),
      );
    // g1: 5×20 = 100 ÷ 10 = 10; g2: 10 ÷ max(0,1) = 10 → empate, desempata pelo número.
    expect((await ler("geral")).rows).toEqual([
      { grupo_id: g1, pontos: 100, pontuacao: "10.00", participantes: 10 },
      { grupo_id: g2, pontos: 10, pontuacao: "10.00", participantes: 0 },
    ]);
    expect((await ler("recebimento")).rows.map((r) => [r.grupo_id, r.pontos])).toEqual([[g2, 10], [g1, 0]]);
    expect((await ler("reproducao")).rows.map((r) => r.pontos)).toEqual([0, 0]);
    expect((await ler("geral", "00000000-0000-0000-0000-000000000000")).rows.map((r) => r.pontos)).toEqual([0, 0]);
    expect((await ler("geral", exec)).rows.map((r) => r.pontos)).toEqual([100, 10]);
    const nome = await um<{ nome: string }>("select nome from grupos where id = $1", [g2]);
    expect((await ler("geral", null, nome.nome)).rows.map((r) => r.grupo_id)).toEqual([g2]);
    expect((await ler("geral", null, "%")).rows).toEqual([]);
  });

  it("grants: anon nada; equipe logada lê recibos e as RPCs, mas não grava nem soma recibo; service_role soma", async () => {
    const { camp, m1 } = await cenario();
    await comoPapel("anon", async () => {
      await expect(db.query("select * from recibos")).rejects.toThrow(/permission denied/);
      await expect(db.query("select * from leadscore_campanha($1)", [camp])).rejects.toThrow(/permission denied/);
      await expect(db.query("select leadscore_exportar($1)", [camp])).rejects.toThrow(/permission denied/);
      await expect(db.query("select * from volume_recibos($1, 'dia', now())", [camp])).rejects.toThrow(/permission denied/);
      await expect(db.query("select * from desempenho_grupos($1)", [camp])).rejects.toThrow(/permission denied/);
      await expect(db.query("select somar_recibos(array['x'], false)")).rejects.toThrow(/permission denied/);
    });
    await comoPapel("authenticated", async () => {
      await db.query("select * from recibos limit 1");
      await expect(db.query("insert into recibos (tarefa_id, telefone, tipo) select id, '1', 'recebeu' from tarefas limit 1")).rejects.toThrow(/permission denied/);
      await expect(db.query("select somar_recibos(array[$1], false, '5511" + "900000000', 'recebeu')", [m1])).rejects.toThrow(/permission denied/);
    });
  });

  it("sem 'expor tabelas novas automaticamente': os grants explícitos bastam", async () => {
    const limpo = new PGlite({ extensions: { pgcrypto } });
    try {
      await limpo.exec(PRE_SUPABASE.replace(/alter default privileges[^;]*;/, ""));
      for (const m of [
        INICIAL, FASE2A, RESUMO, GRUPOS_MENSAGENS, METRICAS_GERAIS, AUTOMACOES, AUTOMACOES2, BLOCO2B, MODELOS_VARIAVEIS, WEBHOOKS_HISTORICO, PROJETOS, MEMBROS,
        ALERTAS_CONEXAO, LISTAR_ACOES, ACOES_V2, CAMPANHA_EXTRAS, CAMPANHA_CONTAS, GRUPOS_EXTRAS, AUTOMACOES_V3, LISTAR_ACOES_AUTOMACAO, AUTOMACOES_CONTAS_VENDAS, RECIBOS_PESSOA,
        ANALISES_RPC,
      ]) await limpo.exec(m);
      await limpo.exec("set role service_role");
      await limpo.query("select somar_recibos(array['x'], false)");
      await limpo.query("select somar_recibos(array['x'], true, '5511" + "900000000', 'visualizou')");
      await limpo.query("select * from recibos");
      await limpo.exec("reset role; set role authenticated");
      await limpo.query("select * from recibos");
      await limpo.query("select * from leadscore_campanha(gen_random_uuid())");
      await limpo.query("select leadscore_exportar(gen_random_uuid())");
      await limpo.query("select * from volume_recibos(gen_random_uuid(), 'semana', now() - interval '30 days')");
      await limpo.query("select * from desempenho_grupos(gen_random_uuid(), 'visualizacao')");
      await limpo.exec("reset role; set role anon");
      await expect(limpo.query("select * from recibos")).rejects.toThrow(/permission denied/);
    } finally {
      await limpo.close();
    }
  }, 60_000);
});

describe("analises_rpc (Etapa 3G, Tarefa 2)", () => {
  /** Campanha com 1 conexão (telefone com nono dígito), 1 grupo ativo, 2 participantes (1 admin aberto — com a
   *  variante SEM o nono dígito do telefone da conexão, pra testar `variantes_telefone` — e 1 que saiu) e 1
   *  clique com UTMs. */
  async function cenario() {
    const { conexao, novaCampanha, novoGrupo } = await seed();
    // Telefone da conexão SEM o nono dígito; o admin está gravado COM — só casam via variantes_telefone.
    await db.query("update conexoes set telefone = '551188880000' where id = $1", [conexao]);
    const sufixo = Math.random().toString(36).slice(2, 8);
    const camp = await novaCampanha(`analises-${sufixo}`);
    const g1 = await novoGrupo(camp, 1);
    await db.query(
      "insert into participantes (grupo_id, telefone, admin, entrou_em) values ($1, '5511" + "988880000', true, now() - interval '3 days')",
      [g1],
    );
    await db.query(
      "insert into participantes (grupo_id, telefone, entrou_em, saiu_em, motivo_saida) values ($1, '5511" + "977770000', now() - interval '5 days', now() - interval '1 day', 'manual')",
      [g1],
    );
    await db.query(
      "insert into cliques (campanha_id, grupo_id, visitante, utm_source) values ($1, $2, 'visitante-123456789', 'instagram')",
      [camp, g1],
    );
    return { conexao, camp, g1 };
  }
  const comoAutenticado = <T,>(f: () => Promise<T>) => comoPapel("authenticated", f);

  // variantes_telefone já tem teste próprio (Bloco 2B) — diagnostico_contas só reaproveita a função existente.

  it("atividades_campanha: uma linha por entrada e por saída, filtros de grupo/evento/data/busca, com total", async () => {
    const { camp } = await cenario();
    type L = { telefone: string; evento: string; total: number };
    const ler = (sql: string, params: unknown[]) => comoAutenticado(() => db.query<L>(`select telefone, evento, total::int from ${sql}`, params));
    const tudo = await ler("atividades_campanha($1)", [camp]);
    expect(tudo.rows.length).toBe(3); // 2 entradas + 1 saída
    expect(tudo.rows[0].total).toBe(3);
    const soSaida = await ler("atividades_campanha($1, null, null, 'saida')", [camp]);
    expect(soSaida.rows).toEqual([{ telefone: "5511" + "977770000", evento: "saida", total: 1 }]);
    const busca = await ler("atividades_campanha($1, '98888')", [camp]);
    expect(busca.rows.map((r) => r.telefone)).toEqual(["5511" + "988880000"]);
    const foraDoGrupo = await ler("atividades_campanha($1, null, gen_random_uuid())", [camp]);
    expect(foraDoGrupo.rows).toEqual([]);
    const futuro = await ler("atividades_campanha($1, null, null, null, now() + interval '1 day')", [camp]);
    expect(futuro.rows).toEqual([]);
  });

  it("cliques_campanha: lista com UTM e grupo, filtrada por grupo e data, com total", async () => {
    const { camp } = await cenario();
    type L = { visitante: string; grupo_numero: number; utm_source: string; total: number };
    const ler = (sql: string, params: unknown[]) =>
      comoAutenticado(() => db.query<L>(`select visitante, grupo_numero, utm_source, total::int from ${sql}`, params));
    const tudo = await ler("cliques_campanha($1)", [camp]);
    expect(tudo.rows).toEqual([{ visitante: "visitante-123456789", grupo_numero: 1, utm_source: "instagram", total: 1 }]);
    const foraDoGrupo = await ler("cliques_campanha($1, gen_random_uuid())", [camp]);
    expect(foraDoGrupo.rows).toEqual([]);
    const passado = await ler("cliques_campanha($1, null, null, now() - interval '1 day')", [camp]);
    expect(passado.rows).toEqual([]);
  });

  it("atividades_campanha e cliques_campanha: o teto de p_limite é 1000 (revisão final — igual a LIMITE_PAGINA_EXPORTACAO, que a exportação usa pra paginar)", async () => {
    const { camp, g1 } = await cenario();
    await db.query(
      "insert into participantes (grupo_id, telefone, entrou_em) select $1, '5511' || lpad(s::text, 9, '0'), now() from generate_series(1, 1001) s",
      [g1],
    );
    await db.query("insert into cliques (campanha_id, grupo_id, visitante) select $1, $2, 'v' || s from generate_series(1, 1001) s", [camp, g1]);
    const atividades = await comoAutenticado(() => db.query("select * from atividades_campanha($1, null, null, null, null, null, 5000)", [camp]));
    expect(atividades.rows.length).toBe(1000);
    const cliques = await comoAutenticado(() => db.query("select * from cliques_campanha($1, null, null, null, 5000)", [camp]));
    expect(cliques.rows.length).toBe(1000);
  });

  it("cliques_por_origem e cliques_por_grupo: agregados da sub-aba Análise", async () => {
    const { camp, g1 } = await cenario();
    await db.query("insert into cliques (campanha_id, grupo_id, visitante) values ($1, $2, 'sem-utm')", [camp, g1]);
    const origem = await comoAutenticado(() => db.query<{ origem: string; cliques: number }>("select origem, cliques::int from cliques_por_origem($1)", [camp]));
    expect(origem.rows).toEqual([
      { origem: "(direto)", cliques: 1 },
      { origem: "instagram", cliques: 1 },
    ]);
    const porGrupo = await comoAutenticado(() => db.query<{ numero: number; cliques: number }>("select numero, cliques::int from cliques_por_grupo($1)", [camp]));
    expect(porGrupo.rows).toEqual([{ numero: 1, cliques: 2 }]);
  });

  it("diagnostico_contas: admin de N/N grupos pelas duas formas do nono dígito, busca por nome, total", async () => {
    const { camp } = await cenario();
    type L = { nome: string; total_grupos: number; admin_grupos: number; algum_pendente: boolean; total: number };
    const ler = (sql: string, params: unknown[]) =>
      comoAutenticado(() => db.query<L>(`select nome, total_grupos::int, admin_grupos::int, algum_pendente, total::int from ${sql}`, params));
    const tudo = await ler("diagnostico_contas($1)", [camp]);
    expect(tudo.rows).toEqual([{ nome: "n1", total_grupos: 1, admin_grupos: 1, algum_pendente: true, total: 1 }]);
    const busca = await ler("diagnostico_contas($1, 'n1')", [camp]);
    expect(busca.rows.length).toBe(1);
    const semResultado = await ler("diagnostico_contas($1, 'inexistente')", [camp]);
    expect(semResultado.rows).toEqual([]);
    // Conferir o grupo apaga o "algum_pendente" e preenche a data.
    await db.query("update grupos set conferido_em = now() where campanha_id = $1", [camp]);
    const confirmado = await ler("diagnostico_contas($1)", [camp]);
    expect(confirmado.rows[0].algum_pendente).toBe(false);
  });

  it("diagnostico_contas: a reserva conta TODOS os grupos da campanha (não só os que é dona), com donos e criadora", async () => {
    await db.exec(DIAGNOSTICO_TODOS);
    const { camp, g1 } = await cenario();
    const { id: reserva } = await um<{ id: string }>("insert into conexoes (nome, webhook_secret, status, zapbot_token_enc, telefone) values ('reserva', 's', 'conectado', 'c', '5537" + "970002002') returning id");
    await db.query("insert into campanha_conexoes (campanha_id, conexao_id) values ($1, $2)", [camp, reserva]);
    const { id: g2 } = await um<{ id: string }>("insert into grupos (campanha_id, conexao_id, group_id, nome, numero) values ($1, $2, 'g-res-2', 'g2', 2) returning id", [camp, reserva]);
    // A reserva é admin do grupo dela (g2) e do g1 (dono = n1); n1 só é admin do g1.
    await db.query("insert into participantes (grupo_id, telefone, admin, entrou_em) values ($1, '553770002002', true, now()), ($2, '553770002002', true, now())", [g1, g2]);
    type L = { nome: string; total_grupos: number; admin_grupos: number; donos: number; criadora: boolean };
    const r = await comoAutenticado(() => db.query<L>("select nome, total_grupos::int, admin_grupos::int, donos::int, criadora from diagnostico_contas($1)", [camp]));
    expect(r.rows).toEqual([
      { nome: "n1", total_grupos: 2, admin_grupos: 1, donos: 1, criadora: true },
      { nome: "reserva", total_grupos: 2, admin_grupos: 2, donos: 1, criadora: false },
    ]);
  });

  it("grants: anon nada; equipe logada lê e chama as RPCs, mas não escreve em verificacoes_contas", async () => {
    const { camp, conexao } = await cenario();
    await db.query("insert into campanha_conexoes (campanha_id, conexao_id) values ($1, $2)", [camp, conexao]);
    await comoPapel("anon", async () => {
      await expect(db.query("select * from atividades_campanha($1)", [camp])).rejects.toThrow(/permission denied/);
      await expect(db.query("select * from cliques_campanha($1)", [camp])).rejects.toThrow(/permission denied/);
      await expect(db.query("select * from diagnostico_contas($1)", [camp])).rejects.toThrow(/permission denied/);
      await expect(db.query("select * from verificacoes_contas")).rejects.toThrow(/permission denied/);
    });
    await comoPapel("authenticated", async () => {
      await db.query("select * from atividades_campanha($1)", [camp]);
      await db.query("select * from cliques_campanha($1)", [camp]);
      await db.query("select * from cliques_por_origem($1)", [camp]);
      await db.query("select * from cliques_por_grupo($1)", [camp]);
      await db.query("select * from diagnostico_contas($1)", [camp]);
      await db.query("select * from verificacoes_contas");
      await expect(
        db.query("insert into verificacoes_contas (campanha_id, conexao_id) select $1, conexao_id from campanha_conexoes where campanha_id = $1 limit 1", [camp]),
      ).rejects.toThrow(/permission denied|row-level security/);
    });
  });
});

describe("conexoes_projeto (Etapa 3G, Tarefa 3)", () => {
  it("projeto_id é opcional, aponta pra projetos e some sozinho se o projeto for excluído", async () => {
    const { id: conexao } = await um<{ id: string }>("insert into conexoes (nome, webhook_secret) values ('com-projeto', 's') returning id");
    const semProjeto = await um<{ projeto_id: string | null }>("select projeto_id from conexoes where id = $1", [conexao]);
    expect(semProjeto.projeto_id).toBeNull();

    const { id: projeto } = await um<{ id: string }>("insert into projetos (nome) values ('Pasta da conta') returning id");
    await db.query("update conexoes set projeto_id = $1 where id = $2", [projeto, conexao]);
    const comProjeto = await um<{ projeto_id: string }>("select projeto_id from conexoes where id = $1", [conexao]);
    expect(comProjeto.projeto_id).toBe(projeto);

    await db.query("delete from projetos where id = $1", [projeto]);
    const depoisDeExcluir = await um<{ projeto_id: string | null }>("select projeto_id from conexoes where id = $1", [conexao]);
    expect(depoisDeExcluir.projeto_id).toBeNull();
  });

  it("equipe logada lê projeto_id (grant por coluna, como o resto de conexoes); grava só pelo service role", async () => {
    const { id: projeto } = await um<{ id: string }>("insert into projetos (nome) values ('Pasta 2') returning id");
    const { id: conexao } = await um<{ id: string }>("insert into conexoes (nome, webhook_secret) values ('equipe-projeto', 's') returning id");
    await comoPapel("service_role", () => db.query("update conexoes set projeto_id = $1 where id = $2", [projeto, conexao]));
    await comoPapel("authenticated", async () => {
      const r = await db.query<{ projeto_id: string }>("select projeto_id from conexoes where id = $1", [conexao]);
      expect(r.rows[0].projeto_id).toBe(projeto);
      await expect(db.query("update conexoes set projeto_id = null where id = $1", [conexao])).rejects.toThrow(/permission denied/);
    });
  });
});

describe("integracoes (Etapa 3H, Tarefa 1)", () => {
  /** Banco novo com todas as migrações até a anterior a esta (pra gravar uma venda antes de rodar a migração). */
  async function bancoAntesDasIntegracoes(): Promise<PGlite> {
    const d = new PGlite({ extensions: { pgcrypto } });
    await d.exec(PRE_SUPABASE);
    for (const m of [
      INICIAL, FASE2A, RESUMO, GRUPOS_MENSAGENS, METRICAS_GERAIS, AUTOMACOES, AUTOMACOES2, BLOCO2B, MODELOS_VARIAVEIS, WEBHOOKS_HISTORICO,
      PROJETOS, MEMBROS, ALERTAS_CONEXAO, LISTAR_ACOES, ACOES_V2, CAMPANHA_EXTRAS, CAMPANHA_CONTAS, GRUPOS_EXTRAS, AUTOMACOES_V3,
      LISTAR_ACOES_AUTOMACAO, AUTOMACOES_CONTAS_VENDAS, RECIBOS_PESSOA, ANALISES_RPC, CONEXOES_PROJETO, CONTA_CAMPANHAS,
    ]) await d.exec(m);
    return d;
  }

  it("cria uma integração por plataforma com o segredo ATUAL de provedores_checkout (links antigos continuam valendo) e liga as vendas antigas", async () => {
    const d = await bancoAntesDasIntegracoes();
    try {
      await d.query("insert into vendas (provedor, evento_id, aprovada, payload) values ('kiwify', 'antiga-1', true, '{}')");
      const antes = await d.query<{ provedor: string; segredo: string }>("select provedor, segredo from provedores_checkout order by provedor");
      await d.exec(INTEGRACOES);
      const depois = await d.query<{ nome: string; plataforma: string; segredo: string; arquivada: boolean }>(
        "select nome, plataforma, segredo, arquivada from integracoes_checkout order by plataforma",
      );
      expect(depois.rows.map((r) => ({ plataforma: r.plataforma, segredo: r.segredo }))).toEqual(antes.rows.map((r) => ({ plataforma: r.provedor, segredo: r.segredo })));
      expect(depois.rows.map((r) => r.nome)).toEqual(["Hotmart", "Kiwify", "Pagar.me", "Checkout próprio"]);
      expect(depois.rows.every((r) => !r.arquivada)).toBe(true);
      // provedores_checkout fica como estava (migração só adiciona).
      const ainda = await d.query<{ provedor: string; segredo: string }>("select provedor, segredo from provedores_checkout order by provedor");
      expect(ainda.rows).toEqual(antes.rows);
      const venda = await um2<{ plataforma: string }>(
        d,
        "select i.plataforma from vendas v join integracoes_checkout i on i.id = v.integracao_id where v.evento_id = 'antiga-1'",
      );
      expect(venda.plataforma).toBe("kiwify");
    } finally {
      await d.close();
    }
  }, 60_000);

  it("integração nova ganha segredo aleatório em hex; nome 1–60 e plataforma só das 4 que o Vórtex Grupo recebe", async () => {
    const r = await um<{ segredo: string }>("insert into integracoes_checkout (nome, plataforma) values ('Hotmart 2', 'hotmart') returning segredo");
    expect(r.segredo).toMatch(/^[0-9a-f]{48}$/);
    await expect(db.query("insert into integracoes_checkout (nome, plataforma) values ('', 'hotmart')")).rejects.toThrow(/check/);
    await expect(db.query("insert into integracoes_checkout (nome, plataforma) values ($1, 'hotmart')", ["x".repeat(61)])).rejects.toThrow(/check/);
    await expect(db.query("insert into integracoes_checkout (nome, plataforma) values ('Stripe', 'stripe')")).rejects.toThrow(/check/);
  });

  it("authenticated lê as outras colunas mas não a coluna segredo (permission denied) e não grava", async () => {
    const { id } = await um<{ id: string }>("insert into integracoes_checkout (nome, plataforma) values ('Kiwify 2', 'kiwify') returning id");
    await comoPapel("authenticated", async () => {
      const ok = await db.query<{ id: string; nome: string; plataforma: string; arquivada: boolean }>(
        "select id, created_at, nome, plataforma, arquivada from integracoes_checkout where id = $1",
        [id],
      );
      expect(ok.rows[0]).toMatchObject({ id, nome: "Kiwify 2", plataforma: "kiwify", arquivada: false });
      await expect(db.query("select segredo from integracoes_checkout where id = $1", [id])).rejects.toThrow(/permission denied/);
      await expect(db.query("select * from integracoes_checkout where id = $1", [id])).rejects.toThrow(/permission denied/);
      await expect(db.query("insert into integracoes_checkout (nome, plataforma) values ('x', 'kiwify')")).rejects.toThrow(/permission denied/);
      await expect(db.query("update integracoes_checkout set segredo = 'meu' where id = $1", [id])).rejects.toThrow(/permission denied/);
      await expect(db.query("update integracoes_checkout set arquivada = true where id = $1", [id])).rejects.toThrow(/permission denied/);
      await expect(db.query("delete from integracoes_checkout where id = $1", [id])).rejects.toThrow(/permission denied/);
      // A coluna nova de vendas é legível pela equipe (aba Eventos).
      await db.query("select integracao_id from vendas limit 1");
    });
  });

  it("anon não lê nada; service role lê o segredo e grava", async () => {
    const { id } = await um<{ id: string }>("insert into integracoes_checkout (nome, plataforma) values ('Pagar.me 2', 'pagarme') returning id");
    await comoPapel("anon", async () => {
      await expect(db.query("select id from integracoes_checkout")).rejects.toThrow(/permission denied/);
      await expect(db.query("select segredo from integracoes_checkout")).rejects.toThrow(/permission denied/);
    });
    await comoPapel("service_role", async () => {
      const r = await db.query<{ segredo: string }>("select segredo from integracoes_checkout where id = $1", [id]);
      expect(r.rows[0].segredo).toMatch(/^[0-9a-f]{48}$/);
      await db.query("update integracoes_checkout set segredo = 'novo', arquivada = true where id = $1", [id]);
    });
  });

  it("registrar_venda com integração grava integracao_id; a de 6 argumentos continua igual; anon/authenticated não chamam", async () => {
    const { id } = await um<{ id: string }>("select id from integracoes_checkout where plataforma = 'hotmart' order by created_at limit 1");
    await comoPapel("service_role", async () => {
      await db.query("select registrar_venda('hotmart', 'int-1', false, '5511" + "900000001', array['p1'], '{}'::jsonb, $1)", [id]);
      await db.query("select registrar_venda('hotmart', 'int-2', true, '5511" + "900000002', array['p1'], '{}'::jsonb)");
    });
    const v1 = await um<{ integracao_id: string; aprovada: boolean }>("select integracao_id, aprovada from vendas where evento_id = 'int-1'");
    expect(v1).toEqual({ integracao_id: id, aprovada: false });
    const v2 = await um<{ integracao_id: string | null }>("select integracao_id from vendas where evento_id = 'int-2'");
    expect(v2.integracao_id).toBeNull();
    // Virada pra aprovada: volta pra fila e mantém a integração.
    await db.query("update vendas set processada_em = now(), resultado = 'ignorada (não é compra aprovada)' where evento_id = 'int-1'");
    await comoPapel("service_role", () => db.query("select registrar_venda('hotmart', 'int-1', true, '5511" + "900000001', array['p1'], '{}'::jsonb, null)"));
    const virou = await um<{ integracao_id: string; aprovada: boolean; processada_em: string | null }>(
      "select integracao_id, aprovada, processada_em from vendas where evento_id = 'int-1'",
    );
    expect(virou).toEqual({ integracao_id: id, aprovada: true, processada_em: null });
    for (const papel of ["anon", "authenticated"]) {
      await comoPapel(papel, async () => {
        await expect(
          db.query("select registrar_venda('hotmart', 'int-3', true, null, array['p1'], '{}'::jsonb, $1)", [id]),
        ).rejects.toThrow(/permission denied/);
      });
    }
  });

  it("sem 'expor tabelas novas automaticamente': os grants explícitos bastam (e o segredo segue escondido)", async () => {
    const limpo = new PGlite({ extensions: { pgcrypto } });
    try {
      await limpo.exec(PRE_SUPABASE.replace(/alter default privileges[^;]*;/, ""));
      for (const m of [
        INICIAL, FASE2A, RESUMO, GRUPOS_MENSAGENS, METRICAS_GERAIS, AUTOMACOES, AUTOMACOES2, BLOCO2B, MODELOS_VARIAVEIS, WEBHOOKS_HISTORICO,
        PROJETOS, MEMBROS, ALERTAS_CONEXAO, LISTAR_ACOES, ACOES_V2, CAMPANHA_EXTRAS, CAMPANHA_CONTAS, GRUPOS_EXTRAS, AUTOMACOES_V3,
        LISTAR_ACOES_AUTOMACAO, AUTOMACOES_CONTAS_VENDAS, RECIBOS_PESSOA, ANALISES_RPC, CONEXOES_PROJETO, CONTA_CAMPANHAS, INTEGRACOES,
      ]) await limpo.exec(m);
      await limpo.exec("set role service_role");
      await limpo.query("select id, segredo from integracoes_checkout");
      await limpo.query("insert into integracoes_checkout (nome, plataforma) values ('x', 'kiwify')");
      await limpo.query("select registrar_venda('kiwify', 'e1', true, null, array['p'], '{}'::jsonb, null)");
      await limpo.exec("reset role; set role authenticated");
      await limpo.query("select id, created_at, nome, plataforma, arquivada from integracoes_checkout");
      await limpo.query("select integracao_id from vendas");
      await expect(limpo.query("select segredo from integracoes_checkout")).rejects.toThrow(/permission denied/);
      await limpo.exec("reset role; set role anon");
      await expect(limpo.query("select id from integracoes_checkout")).rejects.toThrow(/permission denied/);
    } finally {
      await limpo.close();
    }
  }, 60_000);

  it("excluir a integração não apaga a venda (integracao_id vira null)", async () => {
    const { id } = await um<{ id: string }>("insert into integracoes_checkout (nome, plataforma) values ('Temporária', 'vortex') returning id");
    await db.query("insert into vendas (provedor, evento_id, aprovada, payload, integracao_id) values ('vortex', 'tmp-1', true, '{}', $1)", [id]);
    await db.query("delete from integracoes_checkout where id = $1", [id]);
    const v = await um<{ integracao_id: string | null }>("select integracao_id from vendas where evento_id = 'tmp-1'");
    expect(v.integracao_id).toBeNull();
  });
});

describe("deeplinks (Etapa 3H, Tarefa 2)", () => {
  it("slug único, [a-z0-9-]{3,40}, sem as palavras reservadas; destino https até 500; cliques começa em 0", async () => {
    const { id, cliques } = await um<{ id: string; cliques: number }>(
      "insert into deeplinks (nome, destino, slug) values ('Bio', 'https://chat.whatsapp.com/ABC', 'bio-ig') returning id, cliques",
    );
    expect(cliques).toBe(0);
    await expect(db.query("insert into deeplinks (nome, destino, slug) values ('Outro', 'https://x', 'bio-ig')")).rejects.toThrow(/deeplinks_slug_key/);
    await expect(db.query("insert into deeplinks (nome, destino, slug) values ('Curto', 'https://x', 'ab')")).rejects.toThrow(/check/);
    await expect(db.query("insert into deeplinks (nome, destino, slug) values ('Maiúscula', 'https://x', 'ABC')")).rejects.toThrow(/check/);
    await expect(db.query("insert into deeplinks (nome, destino, slug) values ('Reservado', 'https://x', 'admin')")).rejects.toThrow(/check/);
    await expect(db.query("insert into deeplinks (nome, destino, slug) values ('Http', 'http://x', 'http-x')")).rejects.toThrow(/check/);
    await expect(db.query(`insert into deeplinks (nome, destino, slug) values ('Longo', 'https://x/${"a".repeat(500)}', 'longo-x')`)).rejects.toThrow(/check/);
    await db.query("delete from deeplinks where id = $1", [id]);
  });

  it("registrar_clique_deeplink soma o clique e devolve o destino; slug inexistente devolve null", async () => {
    const { id } = await um<{ id: string }>("insert into deeplinks (nome, destino, slug) values ('Bio', 'https://chat.whatsapp.com/XYZ', 'bio-clique') returning id");
    const r1 = await comoPapel("service_role", () => db.query<{ registrar_clique_deeplink: string }>("select registrar_clique_deeplink('bio-clique')"));
    expect(r1.rows[0].registrar_clique_deeplink).toBe("https://chat.whatsapp.com/XYZ");
    await comoPapel("service_role", () => db.query("select registrar_clique_deeplink('bio-clique')"));
    const { cliques } = await um<{ cliques: number }>("select cliques from deeplinks where id = $1", [id]);
    expect(cliques).toBe(2);
    const semSlug = await comoPapel("service_role", () => db.query<{ registrar_clique_deeplink: string | null }>("select registrar_clique_deeplink('nao-existe')"));
    expect(semSlug.rows[0].registrar_clique_deeplink).toBeNull();
    await db.query("delete from deeplinks where id = $1", [id]);
  });

  it("equipe logada lista, cria, move e exclui; anon não enxerga nada; só service role executa a RPC", async () => {
    await comoPapel("authenticated", async () => {
      const { id } = await um<{ id: string }>("insert into deeplinks (nome, destino, slug) values ('Equipe', 'https://x', 'equipe-rls') returning id");
      await db.query("update deeplinks set pasta = 'Redes' where id = $1", [id]);
      const lida = await um<{ pasta: string }>("select pasta from deeplinks where id = $1", [id]);
      expect(lida.pasta).toBe("Redes");
      await db.query("delete from deeplinks where id = $1", [id]);
    });
    await comoPapel("anon", async () => {
      await expect(db.query("select * from deeplinks")).rejects.toThrow(/permission denied/);
      await expect(db.query("select registrar_clique_deeplink('x')")).rejects.toThrow(/permission denied/);
    });
    await comoPapel("authenticated", async () => {
      await expect(db.query("select registrar_clique_deeplink('x')")).rejects.toThrow(/permission denied/);
    });
  });
});

describe("blacklists (Etapa 3H, Tarefa 3)", () => {
  it("sem blacklist, bloqueados_efetivos é exatamente a tabela bloqueados", async () => {
    await db.query("insert into bloqueados (telefone, origem) values ('5511" + "999990001', 'manual'), ('5511" + "999990002', 'csv')");
    const efetivos = await db.query<{ telefone: string }>("select telefone from bloqueados_efetivos order by telefone");
    const bloqueados = await db.query<{ telefone: string }>("select telefone from bloqueados order by telefone");
    expect(efetivos.rows).toEqual(bloqueados.rows);
    await db.query("delete from bloqueados where telefone in ('5511" + "999990001', '5511" + "999990002')");
  });

  it("número de lista ativa entra; lista desativada sai; repetido nas duas fontes aparece uma vez", async () => {
    await db.query("insert into bloqueados (telefone, origem) values ('5511" + "999990010', 'manual')");
    const { id } = await um<{ id: string }>("insert into blacklists (nome) values ('Golpistas') returning id");
    await db.query("insert into blacklist_numeros (blacklist_id, telefone) values ($1, '5511" + "999990010'), ($1, '5511" + "999990011')", [id]);
    const lidos = async () =>
      (await db.query<{ telefone: string }>("select telefone from bloqueados_efetivos where telefone like '551199999001%' order by telefone")).rows.map((r) => r.telefone);
    expect(await lidos()).toEqual(["5511" + "999990010", "5511" + "999990011"]);
    await db.query("update blacklists set ativa = false where id = $1", [id]);
    expect(await lidos()).toEqual(["5511" + "999990010"]);
    await db.query("delete from blacklists where id = $1", [id]);
    const sobrou = await um<{ n: number }>("select count(*)::int as n from blacklist_numeros where blacklist_id = $1", [id]);
    expect(sobrou.n).toBe(0);
    await db.query("delete from bloqueados where telefone = '5511" + "999990010'");
  });

  it("ativa começa true; nome 1-60; telefone só dígitos (11-15); par (lista, telefone) único", async () => {
    const { id, ativa } = await um<{ id: string; ativa: boolean }>("insert into blacklists (nome) values ('Lista') returning id, ativa");
    expect(ativa).toBe(true);
    await expect(db.query("insert into blacklists (nome) values ('')")).rejects.toThrow(/check/);
    await expect(db.query(`insert into blacklists (nome) values ('${"a".repeat(61)}')`)).rejects.toThrow(/check/);
    await expect(db.query("insert into blacklist_numeros (blacklist_id, telefone) values ($1, '+5511999')", [id])).rejects.toThrow(/check/);
    await db.query("insert into blacklist_numeros (blacklist_id, telefone) values ($1, '5511" + "999990020')", [id]);
    await expect(db.query("insert into blacklist_numeros (blacklist_id, telefone) values ($1, '5511" + "999990020')", [id])).rejects.toThrow(/blacklist_numeros_pkey/);
    await db.query("delete from blacklists where id = $1", [id]);
  });

  it("bloqueados.nome é opcional; aceita o alerta antispam_sem_conta", async () => {
    await db.query("insert into bloqueados (telefone, origem) values ('5511" + "999990030', 'manual')");
    await db.query("insert into bloqueados (telefone, origem, nome) values ('5511" + "999990031', 'manual', 'Fulano')");
    const r = await um<{ nome: string | null }>("select nome from bloqueados where telefone = '5511" + "999990031'");
    expect(r.nome).toBe("Fulano");
    await db.query("delete from bloqueados where telefone in ('5511" + "999990030', '5511" + "999990031')");
    await db.query("insert into alertas (tipo, texto) values ('antispam_sem_conta', 'x')");
    await db.query("delete from alertas where tipo = 'antispam_sem_conta'");
  });

  it("equipe logada lê e escreve (inclusive a view); anon não enxerga nada", async () => {
    await comoPapel("authenticated", async () => {
      const { id } = await um<{ id: string }>("insert into blacklists (nome) values ('Equipe') returning id");
      await db.query("insert into blacklist_numeros (blacklist_id, telefone) values ($1, '5511" + "999990040')", [id]);
      const v = await um<{ n: number }>("select count(*)::int as n from bloqueados_efetivos where telefone = '5511" + "999990040'");
      expect(v.n).toBe(1);
      await db.query("delete from blacklists where id = $1", [id]);
    });
    await comoPapel("anon", async () => {
      await expect(db.query("select * from blacklists")).rejects.toThrow(/permission denied/);
      await expect(db.query("select * from blacklist_numeros")).rejects.toThrow(/permission denied/);
      await expect(db.query("select * from bloqueados_efetivos")).rejects.toThrow(/permission denied/);
    });
  });

  it("sem 'expor tabelas novas automaticamente': os grants explícitos bastam", async () => {
    const limpo = new PGlite({ extensions: { pgcrypto } });
    try {
      await limpo.exec(PRE_SUPABASE.replace(/alter default privileges[^;]*;/, ""));
      for (const m of [
        INICIAL, FASE2A, RESUMO, GRUPOS_MENSAGENS, METRICAS_GERAIS, AUTOMACOES, AUTOMACOES2, BLOCO2B, MODELOS_VARIAVEIS, WEBHOOKS_HISTORICO,
        PROJETOS, MEMBROS, ALERTAS_CONEXAO, LISTAR_ACOES, ACOES_V2, CAMPANHA_EXTRAS, CAMPANHA_CONTAS, GRUPOS_EXTRAS, AUTOMACOES_V3,
        LISTAR_ACOES_AUTOMACAO, AUTOMACOES_CONTAS_VENDAS, RECIBOS_PESSOA, ANALISES_RPC, CONEXOES_PROJETO, CONTA_CAMPANHAS, INTEGRACOES,
        DEEPLINKS, BLACKLISTS,
      ]) await limpo.exec(m);
      for (const papel of ["service_role", "authenticated"]) {
        await limpo.exec(`reset role; set role ${papel}`);
        await limpo.query("insert into blacklists (nome) values ('x')");
        await limpo.query("insert into blacklist_numeros (blacklist_id, telefone) select id, '5511" + "999990050' from blacklists limit 1 on conflict do nothing");
        await limpo.query("select telefone from bloqueados_efetivos");
      }
      await limpo.exec("reset role; set role anon");
      await expect(limpo.query("select * from bloqueados_efetivos")).rejects.toThrow(/permission denied/);
    } finally {
      await limpo.close();
    }
  }, 60_000);
});

describe("api (Etapa 3H2, Tarefa 1)", () => {
  const HASH = (c: string) => c.repeat(64);
  const nova = async (hash: string, extra = "") =>
    (await um<{ id: string; tipo: string }>(`insert into api_chaves (nome, prefixo, hash, escopo${extra ? ", tipo" : ""}) values ('Zap', 'AbCd1234', $1, 'envio'${extra ? `, '${extra}'` : ""}) returning id, tipo`, [hash]));

  it("nome 1–60, prefixo de 8 alfanuméricos, hash SHA-256 hex único, escopo leitura/envio, tipo api (padrão) ou mcp", async () => {
    const a = await nova(HASH("a"));
    expect(a.tipo).toBe("api");
    expect((await nova(HASH("b"), "mcp")).tipo).toBe("mcp");
    await expect(nova(HASH("a"))).rejects.toThrow(/api_chaves_hash_key/);
    await expect(db.query("insert into api_chaves (nome, prefixo, hash, escopo) values ('', 'AbCd1234', $1, 'envio')", [HASH("c")])).rejects.toThrow(/check/);
    await expect(db.query("insert into api_chaves (nome, prefixo, hash, escopo) values ($1, 'AbCd1234', $2, 'envio')", ["x".repeat(61), HASH("c")])).rejects.toThrow(/check/);
    await expect(db.query("insert into api_chaves (nome, prefixo, hash, escopo) values ('x', 'vg_AbCd1', $1, 'envio')", [HASH("c")])).rejects.toThrow(/check/);
    await expect(db.query("insert into api_chaves (nome, prefixo, hash, escopo) values ('x', 'AbCd1234', 'vg_texto', 'envio')")).rejects.toThrow(/check/);
    await expect(db.query("insert into api_chaves (nome, prefixo, hash, escopo) values ('x', 'AbCd1234', $1, 'admin')", [HASH("c")])).rejects.toThrow(/check/);
    await expect(db.query("insert into api_chaves (nome, prefixo, hash, escopo, tipo) values ('x', 'AbCd1234', $1, 'envio', 'zap')", [HASH("c")])).rejects.toThrow(/check/);
  });

  it("api_registrar_uso soma no minuto atual, devolve o total, marca ultimo_uso e limpa minutos com mais de 1 hora", async () => {
    const { id } = await nova(HASH("d"));
    await db.query("insert into api_uso (chave_id, minuto, chamadas) values ($1, date_trunc('minute', now()) - interval '2 hours', 50)", [id]);
    await comoPapel("service_role", async () => {
      expect((await um<{ n: number }>("select api_registrar_uso($1) as n", [id])).n).toBe(1);
      expect((await um<{ n: number }>("select api_registrar_uso($1) as n", [id])).n).toBe(2);
      expect((await um<{ n: number }>("select api_registrar_uso($1) as n", [id])).n).toBe(3);
    });
    const linhas = await db.query<{ chamadas: number }>("select chamadas from api_uso where chave_id = $1", [id]);
    expect(linhas.rows).toEqual([{ chamadas: 3 }]);
    const c = await um<{ ultimo_uso: string | null }>("select ultimo_uso from api_chaves where id = $1", [id]);
    expect(c.ultimo_uso).not.toBeNull();
    // Apagar a chave apaga o contador.
    await db.query("delete from api_chaves where id = $1", [id]);
    expect((await um<{ n: number }>("select count(*)::int as n from api_uso where chave_id = $1", [id])).n).toBe(0);
  });

  it("authenticated lê as colunas sem o hash (permission denied no hash e no *), não grava e não chama a RPC", async () => {
    const { id } = await nova(HASH("e"));
    await comoPapel("authenticated", async () => {
      const ok = await db.query<{ id: string; nome: string; prefixo: string; escopo: string; tipo: string }>(
        "select id, created_at, nome, prefixo, escopo, tipo, criada_por, ultimo_uso, revogada_em from api_chaves where id = $1",
        [id],
      );
      expect(ok.rows[0]).toMatchObject({ id, nome: "Zap", prefixo: "AbCd1234", escopo: "envio", tipo: "api" });
      await expect(db.query("select hash from api_chaves where id = $1", [id])).rejects.toThrow(/permission denied/);
      await expect(db.query("select * from api_chaves where id = $1", [id])).rejects.toThrow(/permission denied/);
      await expect(db.query("insert into api_chaves (nome, prefixo, hash, escopo) values ('x', 'AbCd1234', $1, 'leitura')", [HASH("f")])).rejects.toThrow(/permission denied/);
      await expect(db.query("update api_chaves set revogada_em = now() where id = $1", [id])).rejects.toThrow(/permission denied/);
      await expect(db.query("delete from api_chaves where id = $1", [id])).rejects.toThrow(/permission denied/);
      await expect(db.query("select * from api_uso")).rejects.toThrow(/permission denied/);
      await expect(db.query("select api_registrar_uso($1)", [id])).rejects.toThrow(/permission denied/);
    });
  });

  it("anon não lê nada nem chama a RPC; service role lê o hash e revoga", async () => {
    const { id } = await nova(HASH("0"));
    await comoPapel("anon", async () => {
      await expect(db.query("select id from api_chaves")).rejects.toThrow(/permission denied/);
      await expect(db.query("select * from api_uso")).rejects.toThrow(/permission denied/);
      await expect(db.query("select api_registrar_uso($1)", [id])).rejects.toThrow(/permission denied/);
    });
    await comoPapel("service_role", async () => {
      const r = await um<{ hash: string }>("select hash from api_chaves where id = $1", [id]);
      expect(r.hash).toBe(HASH("0"));
      await db.query("update api_chaves set revogada_em = now() where id = $1", [id]);
    });
  });

  it("sem 'expor tabelas novas automaticamente': os grants explícitos bastam (e o hash segue escondido)", async () => {
    const limpo = new PGlite({ extensions: { pgcrypto } });
    try {
      await limpo.exec(PRE_SUPABASE.replace(/alter default privileges[^;]*;/, ""));
      for (const m of [
        INICIAL, FASE2A, RESUMO, GRUPOS_MENSAGENS, METRICAS_GERAIS, AUTOMACOES, AUTOMACOES2, BLOCO2B, MODELOS_VARIAVEIS, WEBHOOKS_HISTORICO,
        PROJETOS, MEMBROS, ALERTAS_CONEXAO, LISTAR_ACOES, ACOES_V2, CAMPANHA_EXTRAS, CAMPANHA_CONTAS, GRUPOS_EXTRAS, AUTOMACOES_V3,
        LISTAR_ACOES_AUTOMACAO, AUTOMACOES_CONTAS_VENDAS, RECIBOS_PESSOA, ANALISES_RPC, CONEXOES_PROJETO, CONTA_CAMPANHAS, INTEGRACOES,
        DEEPLINKS, BLACKLISTS, API,
      ]) await limpo.exec(m);
      await limpo.exec("set role service_role");
      const { rows } = await limpo.query<{ id: string }>("insert into api_chaves (nome, prefixo, hash, escopo) values ('x', 'AbCd1234', $1, 'leitura') returning id", [HASH("1")]);
      await limpo.query("select hash from api_chaves");
      await limpo.query("select api_registrar_uso($1)", [rows[0].id]);
      await limpo.query("select chamadas from api_uso");
      await limpo.exec("reset role; set role authenticated");
      await limpo.query("select id, created_at, nome, prefixo, escopo, tipo, criada_por, ultimo_uso, revogada_em from api_chaves");
      await expect(limpo.query("select hash from api_chaves")).rejects.toThrow(/permission denied/);
      await limpo.exec("reset role; set role anon");
      await expect(limpo.query("select id from api_chaves")).rejects.toThrow(/permission denied/);
    } finally {
      await limpo.close();
    }
  }, 60_000);
});

describe("contatos e listar_leads/contar_leads (Etapa 3I, Tarefa 1 — Leads como cadastro)", () => {
  it("uma linha por pessoa: união de participantes (sem admin) e contatos, nome e campos vindos de contatos", async () => {
    const { novaCampanha, novoGrupo } = await seed();
    const camp = await novaCampanha("leads-uniao");
    const g = await novoGrupo(camp, 1);
    // Participante sem cadastro em contatos.
    await db.query("insert into participantes (grupo_id, telefone) values ($1, '7711" + "900010001')", [g]);
    // Admin não entra na visão geral (mesma regra de pessoas_filtradas).
    await db.query("insert into participantes (grupo_id, telefone, admin) values ($1, '7711" + "900010002', true)", [g]);
    // Contato cadastrado à mão, nunca entrou em grupo.
    await db.query("insert into contatos (telefone, nome, campos) values ('7711" + "900010003', 'Beatriz', $1)", [JSON.stringify({ cidade: "SP" })]);
    // Participante com cadastro: nome/campos vêm de contatos, telefone é o mesmo.
    await db.query("insert into participantes (grupo_id, telefone) values ($1, '7711" + "900010004')", [g]);
    await db.query("insert into contatos (telefone, nome) values ('7711" + "900010004', 'Caio')", []);

    // Filtra pela busca (dígitos do prefixo), não por fora da RPC: o banco do arquivo inteiro acumula milhares de
    // linhas sem nome (nome nulo entra depois na ordenação "nulls last") e um "where" por fora, depois do
    // limite/deslocamento já aplicados dentro da função, poderia nunca alcançar esta página.
    const r = await comoPapel("authenticated", () =>
      db.query<{ telefone: string; nome: string | null; campos: Record<string, string> }>(
        "select telefone, nome, campos from listar_leads($1, null, 1000, 0) order by telefone",
        ["7711900010"],
      ),
    );
    expect(r.rows).toEqual([
      { telefone: "7711" + "900010001", nome: null, campos: {} },
      { telefone: "7711" + "900010003", nome: "Beatriz", campos: { cidade: "SP" } },
      { telefone: "7711" + "900010004", nome: "Caio", campos: {} },
    ]);
    const c = await um<{ n: number }>("select contar_leads($1, null) as n", ["7711900010"]);
    expect(Number(c.n)).toBe(3);
  });

  it("não duplica quem tem as duas formas do telefone (com e sem o nono dígito)", async () => {
    const { novaCampanha, novoGrupo } = await seed();
    const camp = await novaCampanha("leads-nono-digito");
    const g = await novoGrupo(camp, 1);
    await db.query("insert into participantes (grupo_id, telefone) values ($1, '551190002000')", [g]); // sem o 9
    await db.query("insert into contatos (telefone, nome) values ('5511" + "900020000', 'Duda')", []); // com o 9
    const r = await db.query<{ telefone: string }>("select telefone from listar_leads($1, null, 1000, 0)", ["9000200"]);
    expect(r.rows.length).toBe(1);
  });

  it("busca cobre dígitos do telefone e o nome (case-insensitive)", async () => {
    await db.query("insert into contatos (telefone, nome) values ('7711" + "900030000', 'Eduarda Lima')", []);
    const porTelefone = await db.query<{ telefone: string }>("select telefone from listar_leads($1, null, 10, 0)", ["900030000"]);
    expect(porTelefone.rows.map((r) => r.telefone)).toContain("7711" + "900030000");
    const porNome = await db.query<{ telefone: string }>("select telefone from listar_leads($1, null, 10, 0)", ["eduarda"]);
    expect(porNome.rows.map((r) => r.telefone)).toContain("7711" + "900030000");
    const semBatida = await db.query<{ telefone: string }>("select telefone from listar_leads($1, null, 10, 0)", ["ninguem-com-esse-nome"]);
    expect(semBatida.rows.map((r) => r.telefone)).not.toContain("7711" + "900030000");
  });

  it("busca com % ou _ não vira curinga quando a chamadora escapa (como a página faz antes de chamar a RPC)", async () => {
    await db.query("insert into contatos (telefone, nome) values ('7711" + "900040000', '100%')", []);
    // Sem escapar: "%" sozinho é curinga do ilike e bate em qualquer nome (a página nunca manda assim).
    const semEscapar = await db.query<{ telefone: string }>("select telefone from listar_leads($1, null, 10, 0)", ["%"]);
    expect(semEscapar.rows.length).toBeGreaterThan(1);
    // Escapado (o "\%" que a página manda pra buscar o "%" literal): só bate no nome "100%" — restrito a este
    // prefixo porque "100" sozinho também bate em dígitos de telefone de outros testes do mesmo banco.
    const escapado = await db.query<{ telefone: string }>(
      "select telefone from listar_leads($1, null, 10, 0) where telefone like '7711900040%'",
      ["100\\%"],
    );
    expect(escapado.rows.map((r) => r.telefone)).toEqual(["7711" + "900040000"]);
  });

  it("filtra por tag (pessoa_tags), igual à lógica de pessoas_filtradas", async () => {
    await db.query("insert into contatos (telefone, nome) values ('7711" + "900050000', 'Fábio')", []);
    const { id: tag } = await um<{ id: string }>("insert into tags (nome) values ('VIP leads') returning id");
    await db.query("insert into pessoa_tags (telefone, tag_id) values ('7711" + "900050000', $1)", [tag]);
    const r = await db.query<{ telefone: string; tags: string[] }>("select telefone, tags from listar_leads(null, $1, 10, 0)", [tag]);
    expect(r.rows.map((x) => x.telefone)).toEqual(["7711" + "900050000"]);
    expect(r.rows[0].tags).toEqual(["VIP leads"]);
  });

  it("nome com até 80 letras; updated_at muda sozinho ao atualizar (set_updated_at)", async () => {
    await expect(db.query("insert into contatos (telefone, nome) values ('7711" + "900060000', $1)", ["x".repeat(81)])).rejects.toThrow(/check/);
    const a = await um<{ updated_at: string }>("insert into contatos (telefone, nome) values ('7711" + "900060001', 'Gui') returning updated_at");
    await db.query("update contatos set nome = 'Gui Silva' where telefone = '7711" + "900060001'");
    const b = await um<{ updated_at: string }>("select updated_at from contatos where telefone = '7711" + "900060001'");
    expect(new Date(b.updated_at).getTime()).toBeGreaterThanOrEqual(new Date(a.updated_at).getTime());
  });

  it("anon não lê contatos nem chama listar_leads/contar_leads; authenticated lê e escreve", async () => {
    await comoPapel("anon", async () => {
      await expect(db.query("select * from contatos")).rejects.toThrow(/permission denied/);
      await expect(db.query("select * from listar_leads(null, null, 10, 0)")).rejects.toThrow(/permission denied/);
      await expect(db.query("select contar_leads(null, null)")).rejects.toThrow(/permission denied/);
    });
    await comoPapel("authenticated", async () => {
      await db.query("insert into contatos (telefone, nome) values ('7711" + "900070000', 'Hugo')");
      await db.query("update contatos set nome = 'Hugo Alves' where telefone = '7711" + "900070000'");
      await db.query("delete from contatos where telefone = '7711" + "900070000'");
    });
  });
});

describe("campanha_secoes (Etapa 3J, Tarefa 1)", () => {
  it("padrões mantêm o comportamento de hoje: o que já existe nasce ligado, o novo nasce desligado/vazio", async () => {
    const { novaCampanha } = await seed();
    const camp = await novaCampanha("secoes-padrao");
    const r = await um<Record<string, unknown>>(
      `select tags_ativo, tag_entrou_adicionar, tag_entrou_remover, tag_saiu_adicionar, tag_saiu_remover, cookie_redirecionamento,
        verificacao_colaboradores, confirmar_entrega, confirmar_entrega_desde, compradores_ativo, atualizar_links_banimento,
        links_periodicos, links_por_dia, links_atualizados_em, redefinir_link_cheio, remover_anteriores_ativo, campanhas_anteriores,
        deep_linking, pixel_meta_ativo, pixel_meta_id, checar_duplicados, usar_comunidade
       from campanhas where id = $1`,
      [camp],
    );
    expect(r).toEqual({
      tags_ativo: false, tag_entrou_adicionar: null, tag_entrou_remover: null, tag_saiu_adicionar: null, tag_saiu_remover: null,
      cookie_redirecionamento: true, verificacao_colaboradores: false, confirmar_entrega: false, confirmar_entrega_desde: null,
      compradores_ativo: true, atualizar_links_banimento: false, links_periodicos: false, links_por_dia: 1, links_atualizados_em: null,
      redefinir_link_cheio: false, remover_anteriores_ativo: false, campanhas_anteriores: [], deep_linking: false, pixel_meta_ativo: false,
      pixel_meta_id: null, checar_duplicados: true, usar_comunidade: false,
    });
  });

  it("campanha que já existia antes da migração ganha os mesmos padrões", async () => {
    const r = await um<{ cookie_redirecionamento: boolean; compradores_ativo: boolean; checar_duplicados: boolean; deep_linking: boolean }>(
      "select cookie_redirecionamento, compradores_ativo, checar_duplicados, deep_linking from campanhas where slug = 'antiga'",
    );
    expect(r).toEqual({ cookie_redirecionamento: true, compradores_ativo: true, checar_duplicados: true, deep_linking: false });
  });

  it("pixel_meta_id só aceita 10 a 20 dígitos (ou null)", async () => {
    const { novaCampanha } = await seed();
    const camp = await novaCampanha("secoes-pixel");
    await db.query("update campanhas set pixel_meta_id = '1234567890' where id = $1", [camp]);
    await db.query("update campanhas set pixel_meta_id = '12345678901234567890' where id = $1", [camp]);
    await db.query("update campanhas set pixel_meta_id = null where id = $1", [camp]);
    for (const ruim of ["123456789", "123456789012345678901", "12345abcde", "<script>1234"]) {
      await expect(db.query("update campanhas set pixel_meta_id = $1 where id = $2", [ruim, camp])).rejects.toThrow(/check/);
    }
  });

  it("links_por_dia entre 1 e 24", async () => {
    const { novaCampanha } = await seed();
    const camp = await novaCampanha("secoes-links-dia");
    await db.query("update campanhas set links_por_dia = 24 where id = $1", [camp]);
    await expect(db.query("update campanhas set links_por_dia = 0 where id = $1", [camp])).rejects.toThrow(/check/);
    await expect(db.query("update campanhas set links_por_dia = 25 where id = $1", [camp])).rejects.toThrow(/check/);
  });

  it("campanhas_anteriores: até 50 e nunca a própria campanha", async () => {
    const { novaCampanha } = await seed();
    const camp = await novaCampanha("secoes-anteriores");
    const outra = await novaCampanha("secoes-anteriores-outra");
    await db.query("update campanhas set campanhas_anteriores = array[$1::uuid] where id = $2", [outra, camp]);
    await expect(db.query("update campanhas set campanhas_anteriores = array[$1::uuid] where id = $1", [camp])).rejects.toThrow(/check/);
    await expect(
      db.query("update campanhas set campanhas_anteriores = (select array_agg(gen_random_uuid()) from generate_series(1, 51)) where id = $1", [camp]),
    ).rejects.toThrow(/check/);
  });

  it("tag apagada vira null nas colunas de tag (on delete set null)", async () => {
    const { novaCampanha } = await seed();
    const camp = await novaCampanha("secoes-tags");
    const { id: tag } = await um<{ id: string }>("insert into tags (nome) values ('Seções 3J') returning id");
    await db.query("update campanhas set tag_entrou_adicionar = $1, tag_saiu_remover = $1 where id = $2", [tag, camp]);
    await db.query("delete from tags where id = $1", [tag]);
    const r = await um<{ tag_entrou_adicionar: string | null; tag_saiu_remover: string | null }>("select tag_entrou_adicionar, tag_saiu_remover from campanhas where id = $1", [camp]);
    expect(r).toEqual({ tag_entrou_adicionar: null, tag_saiu_remover: null });
  });

  it("sem grant por coluna em campanhas (colunas novas herdam o da tabela); anon não vê nada (RLS); authenticated lê e grava", async () => {
    // Grant por coluna apareceria só pra algumas colunas; com o grant da tabela inteira, todas as colunas têm o
    // mesmo privilégio de update pra authenticated — inclusive as novas.
    const semUpdate = await um<{ n: number }>(
      `select count(*)::int as n from information_schema.columns c
        where c.table_schema = 'public' and c.table_name = 'campanhas'
          and not has_column_privilege('authenticated', 'public.campanhas', c.column_name, 'UPDATE')`,
    );
    expect(semUpdate.n).toBe(0);
    const { novaCampanha } = await seed();
    const camp = await novaCampanha("secoes-papeis");
    await comoPapel("anon", async () => {
      const r = await db.query("select deep_linking from campanhas where id = $1", [camp]).catch(() => ({ rows: [] }));
      expect(r.rows).toEqual([]);
      await db.query("update campanhas set deep_linking = true where id = $1", [camp]).catch(() => undefined);
    });
    const depoisAnon = await um<{ deep_linking: boolean }>("select deep_linking from campanhas where id = $1", [camp]);
    expect(depoisAnon.deep_linking).toBe(false);
    await comoPapel("authenticated", async () => {
      await db.query("update campanhas set deep_linking = true, checar_duplicados = false where id = $1", [camp]);
      const r = await db.query<{ deep_linking: boolean; checar_duplicados: boolean }>("select deep_linking, checar_duplicados from campanhas where id = $1", [camp]);
      expect(r.rows).toEqual([{ deep_linking: true, checar_duplicados: false }]);
    });
  });
});

describe("links_entregas (Etapa 3J, Tarefa 3)", () => {
  const sufixo = () => Math.random().toString(36).slice(2, 8);

  it("execucoes.origem aceita 'campanha' e continua aceitando os 5 valores antigos", async () => {
    const { novaCampanha } = await seed();
    const camp = await novaCampanha(`origem-${sufixo()}`);
    for (const origem of ["avulsa", "sequencia", "massa", "grupo_novo", "automacao", "campanha"]) {
      await db.query("insert into execucoes (campanha_id, origem, conteudo) values ($1, $2, '{}')", [camp, origem]);
    }
    await expect(db.query("insert into execucoes (campanha_id, origem, conteudo) values ($1, 'outra', '{}')", [camp])).rejects.toThrow(/check/);
  });

  it("execucoes_campanha_chave: uma por campanha e chave só na origem 'campanha'", async () => {
    const { novaCampanha } = await seed();
    const camp = await novaCampanha(`chave-${sufixo()}`);
    const outra = await novaCampanha(`chave-${sufixo()}`);
    const inserir = (c: string, origem: string) => db.query("insert into execucoes (campanha_id, origem, tipo, conteudo, gatilho_chave) values ($1, $2, 'atualizar_links', '{}', 'periodico:2026-10-17T12:00:00.000Z')", [c, origem]);
    await inserir(camp, "campanha");
    await expect(inserir(camp, "campanha")).rejects.toThrow(/execucoes_campanha_chave|duplicate/);
    await inserir(outra, "campanha");
    await inserir(camp, "avulsa"); // outras origens não entram no índice
    await inserir(camp, "avulsa");
  });

  it("colunas novas nascem vazias/desligadas; tarefas.entrega e o alerta novo com check; tipos antigos de alerta seguem valendo", async () => {
    const { conexao, novaCampanha, novoGrupo } = await seed();
    const camp = await novaCampanha(`colunas-${sufixo()}`);
    const g = await novoGrupo(camp, 1);
    const { id: exec } = await um<{ id: string }>("insert into execucoes (campanha_id, conteudo) values ($1, '{}') returning id", [camp]);
    const { id: t } = await um<{ id: string }>("insert into tarefas (execucao_id, grupo_id, conexao_id) values ($1, $2, $3) returning id", [exec, g, conexao]);
    expect(await um("select entrega from tarefas where id = $1", [t])).toEqual({ entrega: null });
    expect(await um("select entrega_alertada from execucoes where id = $1", [exec])).toEqual({ entrega_alertada: false });
    expect(await um("select caiu_em, grupos_trocados_em from conexoes where id = $1", [conexao])).toEqual({ caiu_em: null, grupos_trocados_em: null });
    for (const v of ["confirmada", "sem_observador", "nao_confirmada"]) await db.query("update tarefas set entrega = $1 where id = $2", [v, t]);
    await expect(db.query("update tarefas set entrega = 'talvez' where id = $1", [t])).rejects.toThrow(/check/);
    for (const tipo of ["grupo_cheio", "numero_caiu", "execucao_bloqueada", "tarefa_erro", "grupo_sumiu", "criacao_erro", "bloqueado_removido", "antispam_sem_conta", "entrega_nao_confirmada"]) {
      await db.query("insert into alertas (tipo, texto) values ($1, 'x')", [tipo]);
    }
    await expect(db.query("insert into alertas (tipo, texto) values ('outro', 'x')")).rejects.toThrow(/check/);
    await db.query("delete from alertas where texto = 'x'");
  });

  it("caiu_em e grupos_trocados_em não ficam visíveis pra authenticated (grant por coluna de conexoes)", async () => {
    const r = await um<{ caiu: boolean; trocados: boolean }>(
      "select has_column_privilege('authenticated', 'public.conexoes', 'caiu_em', 'SELECT') as caiu, has_column_privilege('authenticated', 'public.conexoes', 'grupos_trocados_em', 'SELECT') as trocados",
    );
    expect(r).toEqual({ caiu: false, trocados: false });
  });

  describe("conferir_entregas", () => {
    /** Campanha com a seção ligada há 2 h, conta A (envia, 55119 00000001) criadora e conta B (observadora,
     *  551100000002 sem o nono dígito no cadastro) associada. Grupos: g1 e g3 com B dentro; g2 só com A. */
    async function cenario(o: { ligada?: boolean; desde?: string } = {}) {
      const s = sufixo();
      const { id: a } = await um<{ id: string }>("insert into conexoes (nome, webhook_secret, status, telefone) values ('A', 's', 'conectado', '5511" + "900000001') returning id");
      const { id: b } = await um<{ id: string }>("insert into conexoes (nome, webhook_secret, status, telefone) values ('B', 's', 'conectado', '551100000002') returning id");
      const { id: camp } = await um<{ id: string }>(
        "insert into campanhas (nome, slug, conexao_criadora_id, confirmar_entrega, confirmar_entrega_desde) values ($1, $1, $2, $3, now() - ($4)::interval) returning id",
        [`entrega-${s}`, a, o.ligada ?? true, o.desde ?? "2 hours"],
      );
      await db.query("insert into campanha_conexoes (campanha_id, conexao_id) values ($1, $2)", [camp, b]);
      const grupo = async (n: number, comB: boolean) => {
        const { id } = await um<{ id: string }>("insert into grupos (campanha_id, conexao_id, group_id, nome, numero) values ($1, $2, $3, $3, $4) returning id", [camp, a, `ge-${s}-${n}`, n]);
        await db.query("insert into participantes (grupo_id, telefone, admin) values ($1, '5511" + "900000001', true)", [id]);
        if (comB) await db.query("insert into participantes (grupo_id, telefone) values ($1, '5511" + "900000002')", [id]);
        return id;
      };
      const g1 = await grupo(1, true);
      const g2 = await grupo(2, false);
      const g3 = await grupo(3, true);
      const { id: exec } = await um<{ id: string }>("insert into execucoes (campanha_id, status, conteudo) values ($1, 'concluida', '{}') returning id", [camp]);
      const tarefa = async (g: string, quando = "40 minutes", tipo = "mensagem") =>
        (await um<{ id: string }>(
          "insert into tarefas (execucao_id, grupo_id, conexao_id, tipo, status, message_id, enviado_em) values ($1, $2, $3, $4, 'enviado', $5, now() - ($6)::interval) returning id",
          [exec, g, a, tipo, `M-${s}-${Math.random()}`, quando],
        )).id;
      return { a, b, camp, exec, g1, g2, g3, tarefa };
    }
    const recibo = (t: string, tel: string, tipo = "recebeu") => db.query("insert into recibos (tarefa_id, telefone, tipo) values ($1, $2, $3)", [t, tel, tipo]);
    const conferir = () => comoPapel("service_role", async () => (await db.query<{ execucao_id: string; campanha_id: string; nao_confirmadas: number }>("select * from conferir_entregas(500)")).rows);
    const entrega = async (t: string) => (await um<{ entrega: string | null }>("select entrega from tarefas where id = $1", [t])).entrega;

    it("os três casos, uma vez por execução, e promoção quando o recibo chega depois", async () => {
      const c = await cenario();
      const t1 = await c.tarefa(c.g1);
      const t2 = await c.tarefa(c.g2);
      const t3 = await c.tarefa(c.g3, "40 minutes", "enquete");
      await recibo(t1, "5511" + "900000002"); // B, com o nono dígito: o cadastro não tem
      await recibo(t3, "5511" + "977776666"); // lead: não conta
      await recibo(t3, "5511" + "900000001"); // a própria conta que enviou: não é observadora

      const r = await conferir();
      expect(r.filter((x) => x.execucao_id === c.exec)).toEqual([{ execucao_id: c.exec, campanha_id: c.camp, nao_confirmadas: 1 }]);
      expect([await entrega(t1), await entrega(t2), await entrega(t3)]).toEqual(["confirmada", "sem_observador", "nao_confirmada"]);

      // Segunda volta: nada novo pra essa execução (o alerta sai uma vez só).
      expect((await conferir()).filter((x) => x.execucao_id === c.exec)).toEqual([]);

      // O recibo de B chega atrasado (até 24 h): promove, sem novo alerta.
      await recibo(t3, "5511" + "900000002", "visualizou");
      expect((await conferir()).filter((x) => x.execucao_id === c.exec)).toEqual([]);
      expect(await entrega(t3)).toBe("confirmada");
    });

    it("tarefa retentada que só sai depois do primeiro alerta: marcada, mas a execução não alerta de novo", async () => {
      const c = await cenario();
      await c.tarefa(c.g3);
      const ok = await c.tarefa(c.g1);
      await recibo(ok, "5511" + "900000002"); // prova de que os recibos de observador chegam nesta campanha
      expect((await conferir()).filter((x) => x.execucao_id === c.exec)).toHaveLength(1);
      await db.query("delete from participantes where grupo_id = $1 and telefone = '5511" + "900000002'", [c.g2]);
      await db.query("insert into participantes (grupo_id, telefone) values ($1, '5511" + "900000002')", [c.g2]);
      const tarde = await c.tarefa(c.g2, "35 minutes");
      expect((await conferir()).filter((x) => x.execucao_id === c.exec)).toEqual([]);
      expect(await entrega(tarde)).toBe("nao_confirmada");
    });

    it("só depois de 30 min, e só quando nenhuma tarefa da execução está na fila ou foi enviada há menos de 30 min", async () => {
      const c = await cenario();
      const velha = await c.tarefa(c.g3, "40 minutes");
      const nova = await c.tarefa(c.g1, "10 minutes");
      await conferir();
      expect([await entrega(velha), await entrega(nova)]).toEqual([null, null]);
      await db.query("update tarefas set enviado_em = now() - interval '45 minutes' where id = $1", [nova]);
      await db.query("insert into tarefas (execucao_id, grupo_id, conexao_id, status) values ($1, $2, $3, 'fila')", [c.exec, c.g2, c.a]);
      await conferir();
      expect(await entrega(velha)).toBeNull();
      await db.query("update tarefas set status = 'erro' where execucao_id = $1 and status = 'fila'", [c.exec]);
      await conferir();
      expect([await entrega(velha), await entrega(nova)]).toEqual(["nao_confirmada", "nao_confirmada"]);
    });

    it("regressão: seção desligada, mensagem enviada antes de ligar ou com mais de 25 h, e tarefa que não é mensagem ficam sem marca", async () => {
      const desligada = await cenario({ ligada: false });
      const t1 = await desligada.tarefa(desligada.g3);
      const antes = await cenario({ desde: "20 minutes" });
      const t2 = await antes.tarefa(antes.g3, "40 minutes");
      const velha = await cenario({ desde: "3 days" });
      const t3 = await velha.tarefa(velha.g3, "26 hours");
      const acao = await cenario();
      const t4 = await acao.tarefa(acao.g3, "40 minutes", "nome");
      const r = await conferir();
      expect(r.filter((x) => [desligada.exec, antes.exec, velha.exec, acao.exec].includes(x.execucao_id))).toEqual([]);
      expect([await entrega(t1), await entrega(t2), await entrega(t3), await entrega(t4)]).toEqual([null, null, null, null]);
      expect(await um("select count(*)::int as n from execucoes where id = any($1) and entrega_alertada", [[desligada.exec, antes.exec, velha.exec, acao.exec]])).toEqual({ n: 0 });
    });

    it("observador que saiu do grupo não conta", async () => {
      const c = await cenario();
      const t = await c.tarefa(c.g1);
      await db.query("update participantes set saiu_em = now() where grupo_id = $1 and telefone = '5511" + "900000002'", [c.g1]);
      await conferir();
      expect(await entrega(t)).toBe("sem_observador");
    });

    it("só o service role executa; entregas_das_execucoes conta por execução e a equipe lê", async () => {
      await comoPapel("authenticated", async () => {
        await expect(db.query("select * from conferir_entregas(10)")).rejects.toThrow(/permission denied/);
      });
      await comoPapel("anon", async () => {
        await expect(db.query("select * from entregas_das_execucoes(array[]::uuid[])")).rejects.toThrow(/permission denied/);
      });
      const c = await cenario();
      const t1 = await c.tarefa(c.g1);
      await c.tarefa(c.g2);
      await c.tarefa(c.g3);
      await recibo(t1, "5511" + "900000002");
      await conferir();
      const r = await comoPapel("authenticated", async () => (await db.query("select * from entregas_das_execucoes($1)", [[c.exec]])).rows);
      expect(r).toEqual([{ execucao_id: c.exec, confirmadas: 1, sem_observador: 1, nao_confirmadas: 1, total: 3 }]);
    });
  });
});

describe("automacoes_pessoa (Etapa 3J, Tarefa 4)", () => {
  const ANTIGOS = [
    "mensagem", "enquete", "nome", "descricao", "abrir", "fechar", "admin_add", "admin_remover", "redefinir_link", "remover_participante",
    "configuracao", "atualizar_links", "desativar_comunidade", "mover_grupos", "tag_condicional",
  ];
  const NOVOS = ["adicionar_tag", "remover_tag", "adicionar_blacklist", "remover_blacklist"];

  async function automacao() {
    const { novaCampanha } = await seed();
    const camp = await novaCampanha(`pessoa-${Math.random().toString(36).slice(2, 8)}`);
    return (await um<{ id: string }>("insert into automacoes (nome, campanha_id, gatilho) values ('a', $1, 'entrou') returning id", [camp])).id;
  }

  it("automacao_acoes aceita os 4 tipos novos e todos os 15 de antes; recusa o resto", async () => {
    const id = await automacao();
    for (const tipo of [...ANTIGOS, ...NOVOS]) await db.query("insert into automacao_acoes (automacao_id, tipo) values ($1, $2)", [id, tipo]);
    await expect(db.query("insert into automacao_acoes (automacao_id, tipo) values ($1, 'adicionar_tags')", [id])).rejects.toThrow(/automacao_acoes_tipo_check/);
    await expect(db.query("insert into automacao_acoes (automacao_id, tipo) values ($1, 'mover_grupo')", [id])).rejects.toThrow(/automacao_acoes_tipo_check/);
  });

  it("a constraint lista exatamente os 15 de antes + os 4 novos", async () => {
    const { def } = await um<{ def: string }>("select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'automacao_acoes_tipo_check'");
    const valores = [...def.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(valores.sort()).toEqual([...ANTIGOS, ...NOVOS].sort());
  });

  it("só aditiva: ações gravadas antes continuam iguais e válidas", async () => {
    const d = await bancoAtéProjetos();
    try {
      for (const m of [MEMBROS, ALERTAS_CONEXAO, LISTAR_ACOES, ACOES_V2, CAMPANHA_EXTRAS, CAMPANHA_CONTAS, GRUPOS_EXTRAS, AUTOMACOES_V3, LISTAR_ACOES_AUTOMACAO,
        AUTOMACOES_CONTAS_VENDAS, RECIBOS_PESSOA, ANALISES_RPC, CONEXOES_PROJETO, CONTA_CAMPANHAS, INTEGRACOES, DEEPLINKS, BLACKLISTS, API, CONTATOS, CAMPANHA_SECOES, LINKS_ENTREGAS]) {
        await d.exec(m);
      }
      const { id: conexao } = await um2<{ id: string }>(d, "insert into conexoes (nome, webhook_secret, status, zapbot_token_enc) values ('n', 's', 'conectado', 'c') returning id");
      const { id: camp } = await um2<{ id: string }>(d, "insert into campanhas (nome, slug, conexao_criadora_id) values ('p', 'p-antiga', $1) returning id", [conexao]);
      const { id: a } = await um2<{ id: string }>(d, "insert into automacoes (nome, campanha_id, gatilho) values ('a', $1, 'entrou') returning id", [camp]);
      for (const [ordem, tipo] of ANTIGOS.entries()) await d.query("insert into automacao_acoes (automacao_id, tipo, ordem) values ($1, $2, $3)", [a, tipo, ordem]);
      await expect(d.query("insert into automacao_acoes (automacao_id, tipo) values ($1, 'adicionar_tag')", [a])).rejects.toThrow(/automacao_acoes_tipo_check/);
      const antes = (await d.query("select * from automacao_acoes order by ordem")).rows;

      await d.exec(AUTOMACOES_PESSOA);

      expect((await d.query("select * from automacao_acoes order by ordem")).rows).toEqual(antes);
      await d.query("update automacao_acoes set tipo = tipo");
      await d.query("insert into automacao_acoes (automacao_id, tipo, ordem) values ($1, 'adicionar_blacklist', 99)", [a]);
    } finally {
      await d.close();
    }
  }, 60_000);

  it("o que o motor grava é idempotente: por_tag e blacklist on conflict do nothing não duplicam", async () => {
    const { id: tag } = await um<{ id: string }>("insert into tags (nome, tipo) values ('Pessoa 3J', 'manual') returning id");
    const { id: lista } = await um<{ id: string }>("insert into blacklists (nome) values ('Lista 3J') returning id");
    for (let i = 0; i < 2; i++) {
      await db.query("select por_tag(array['5511" + "977770001'], $1, null)", [tag]);
      await db.query("insert into blacklist_numeros (blacklist_id, telefone) values ($1, '5511" + "977770001') on conflict (blacklist_id, telefone) do nothing", [lista]);
    }
    expect(await um("select count(*)::int as n from pessoa_tags where tag_id = $1", [tag])).toEqual({ n: 1 });
    expect(await um("select count(*)::int as n from blacklist_numeros where blacklist_id = $1", [lista])).toEqual({ n: 1 });
    // Entra no anti-spam (lista ativa) e sai com o delete pelas variantes.
    expect(await um("select count(*)::int as n from bloqueados_efetivos where telefone = '5511" + "977770001'")).toEqual({ n: 1 });
    await db.query("delete from blacklist_numeros where blacklist_id = $1 and telefone = any($2)", [lista, ["5511" + "977770001", "551177770001"]]);
    expect(await um("select count(*)::int as n from bloqueados_efetivos where telefone = '5511" + "977770001'")).toEqual({ n: 0 });
  });
});

describe("acoes_encadeadas (Etapa 3J, Tarefa 5)", () => {
  async function campanha() {
    const { novaCampanha } = await seed();
    return novaCampanha(`enc-${Math.random().toString(36).slice(2, 8)}`);
  }

  it("depois_de nasce nulo; a corrente entra num único insert mesmo com a seguinte antes da anterior na lista", async () => {
    const camp = await campanha();
    const { id: solta } = await um<{ id: string }>("insert into execucoes (campanha_id, tipo) values ($1, 'abrir') returning id", [camp]);
    expect(await um("select depois_de from execucoes where id = $1", [solta])).toEqual({ depois_de: null });
    const [p1, p2, p3] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    // A FK é conferida no fim do comando: a ordem das linhas no insert não importa.
    await db.query(
      `insert into execucoes (id, campanha_id, tipo, depois_de) values ($3, $1, 'nome', $2), ($2, $1, 'fechar', $4), ($4, $1, 'mensagem', null)`,
      [camp, p2, p3, p1],
    );
    const r = await db.query<{ id: string; depois_de: string | null }>("select id, depois_de from execucoes where id = any($1)", [[p1, p2, p3]]);
    expect(Object.fromEntries(r.rows.map((l) => [l.id, l.depois_de]))).toEqual({ [p1]: null, [p2]: p1, [p3]: p2 });
  });

  it("insert com anterior inexistente falha inteiro (nada fica pela metade)", async () => {
    const camp = await campanha();
    const [p1, p2] = [crypto.randomUUID(), crypto.randomUUID()];
    await expect(
      db.query("insert into execucoes (id, campanha_id, tipo, depois_de) values ($2, $1, 'mensagem', null), ($3, $1, 'fechar', $4)", [camp, p1, p2, crypto.randomUUID()]),
    ).rejects.toThrow(/execucoes_depois_de_fkey/);
    expect(await um("select count(*)::int as n from execucoes where id = any($1)", [[p1, p2]])).toEqual({ n: 0 });
  });

  it("não aponta pra si mesma", async () => {
    const camp = await campanha();
    const id = crypto.randomUUID();
    await expect(db.query("insert into execucoes (id, campanha_id, tipo, depois_de) values ($2, $1, 'abrir', $2)", [camp, id])).rejects.toThrow(/execucoes_depois_de_outra/);
  });

  it("apagar a anterior solta a seguinte (on delete set null): nada fica preso nem dá erro de FK", async () => {
    const camp = await campanha();
    const { id: ant } = await um<{ id: string }>("insert into execucoes (campanha_id, tipo) values ($1, 'mensagem') returning id", [camp]);
    const { id: seg } = await um<{ id: string }>("insert into execucoes (campanha_id, tipo, depois_de) values ($1, 'fechar', $2) returning id", [camp, ant]);
    await db.query("delete from execucoes where id = $1", [ant]);
    expect(await um("select depois_de, status from execucoes where id = $1", [seg])).toEqual({ depois_de: null, status: "agendada" });
  });

  it("índices: parcial das que esperam e o da FK", async () => {
    const r = await db.query<{ indexname: string; indexdef: string }>("select indexname, indexdef from pg_indexes where tablename = 'execucoes' and indexname in ('execucoes_encadeadas_esperando', 'execucoes_depois_de') order by indexname");
    expect(r.rows.map((l) => l.indexname)).toEqual(["execucoes_depois_de", "execucoes_encadeadas_esperando"]);
    expect(r.rows[1].indexdef).toMatch(/WHERE \(\(depois_de IS NOT NULL\) AND \(status = 'agendada'::text\)\)/);
  });

  it("só aditiva: execuções gravadas antes continuam iguais (com depois_de nulo)", async () => {
    const d = await bancoAtéProjetos();
    try {
      for (const m of [MEMBROS, ALERTAS_CONEXAO, LISTAR_ACOES, ACOES_V2, CAMPANHA_EXTRAS, CAMPANHA_CONTAS, GRUPOS_EXTRAS, AUTOMACOES_V3, LISTAR_ACOES_AUTOMACAO,
        AUTOMACOES_CONTAS_VENDAS, RECIBOS_PESSOA, ANALISES_RPC, CONEXOES_PROJETO, CONTA_CAMPANHAS, INTEGRACOES, DEEPLINKS, BLACKLISTS, API, CONTATOS, CAMPANHA_SECOES, LINKS_ENTREGAS, AUTOMACOES_PESSOA]) {
        await d.exec(m);
      }
      const { id: conexao } = await um2<{ id: string }>(d, "insert into conexoes (nome, webhook_secret, status, zapbot_token_enc) values ('n', 's', 'conectado', 'c') returning id");
      const { id: camp } = await um2<{ id: string }>(d, "insert into campanhas (nome, slug, conexao_criadora_id) values ('p', 'p-enc', $1) returning id", [conexao]);
      for (const [tipo, status] of [["mensagem", "agendada"], ["fechar", "concluida"], ["abrir", "cancelada"]]) {
        await d.query("insert into execucoes (campanha_id, tipo, status) values ($1, $2, $3)", [camp, tipo, status]);
      }
      const antes = (await d.query("select * from execucoes order by tipo")).rows;

      await d.exec(ACOES_ENCADEADAS);
      await d.exec(LINKS_ENTREGAS_AJUSTES);

      const depois = (await d.query<Record<string, unknown>>("select * from execucoes order by tipo")).rows;
      expect(depois.map(({ depois_de, ...resto }) => (expect(depois_de).toBeNull(), resto))).toEqual(antes);
    } finally {
      await d.close();
    }
  }, 60_000);
});

describe("links_entregas_ajustes (Etapa 3J, Tarefa 3, revisão)", () => {
  const sufixo = () => Math.random().toString(36).slice(2, 8);

  describe("conferir_entregas: só alerta com prova de que os recibos chegam", () => {
    async function cenario() {
      const s = sufixo();
      const { id: a } = await um<{ id: string }>("insert into conexoes (nome, webhook_secret, status, telefone) values ('A', 's', 'conectado', $1) returning id", [`55119${s.length}${Math.floor(Math.random() * 1e7)}`.slice(0, 13).padEnd(13, "1")]);
      const { id: b } = await um<{ id: string }>("insert into conexoes (nome, webhook_secret, status, telefone) values ('B', 's', 'conectado', '5521" + "911112222') returning id");
      const { id: camp } = await um<{ id: string }>(
        "insert into campanhas (nome, slug, conexao_criadora_id, confirmar_entrega, confirmar_entrega_desde) values ($1, $1, $2, true, now() - interval '9 days') returning id",
        [`prova-${s}`, a],
      );
      await db.query("insert into campanha_conexoes (campanha_id, conexao_id) values ($1, $2)", [camp, b]);
      const { id: g } = await um<{ id: string }>("insert into grupos (campanha_id, conexao_id, group_id, nome, numero) values ($1, $2, $3, $3, 1) returning id", [camp, a, `gp-${s}`]);
      await db.query("insert into participantes (grupo_id, telefone) values ($1, '5521" + "911112222')", [g]);
      const execucao = async () => (await um<{ id: string }>("insert into execucoes (campanha_id, status, conteudo) values ($1, 'concluida', '{}') returning id", [camp])).id;
      const tarefa = async (exec: string, quando: string, entrega: string | null = null, conexao = a) =>
        (await um<{ id: string }>(
          "insert into tarefas (execucao_id, grupo_id, conexao_id, status, message_id, enviado_em, entrega) values ($1, $2, $3, 'enviado', $4, now() - ($5)::interval, $6) returning id",
          [exec, g, conexao, `P-${s}-${Math.random()}`, quando, entrega],
        )).id;
      return { a, b, camp, g, execucao, tarefa };
    }
    const conferir = () => comoPapel("service_role", async () => (await db.query<{ execucao_id: string }>("select * from conferir_entregas(500)")).rows);

    it("sem nenhuma entrega confirmada em 7 dias: marca a tarefa e não alerta (nem marca a execução)", async () => {
      const c = await cenario();
      const exec = await c.execucao();
      const t = await c.tarefa(exec, "40 minutes");
      expect((await conferir()).filter((x) => x.execucao_id === exec)).toEqual([]);
      expect(await um("select entrega from tarefas where id = $1", [t])).toEqual({ entrega: "nao_confirmada" });
      expect(await um("select entrega_alertada from execucoes where id = $1", [exec])).toEqual({ entrega_alertada: false });
    });

    it("campanha com entrega confirmada nos últimos 7 dias: alerta", async () => {
      const c = await cenario();
      await c.tarefa(await c.execucao(), "3 days", "confirmada");
      const exec = await c.execucao();
      await c.tarefa(exec, "40 minutes");
      expect((await conferir()).filter((x) => x.execucao_id === exec)).toHaveLength(1);
    });

    it("prova velha (mais de 7 dias) não vale", async () => {
      const c = await cenario();
      await c.tarefa(await c.execucao(), "8 days", "confirmada");
      const exec = await c.execucao();
      await c.tarefa(exec, "40 minutes");
      expect((await conferir()).filter((x) => x.execucao_id === exec)).toEqual([]);
    });

    it("a conta que enviou teve entrega confirmada em outra campanha: alerta", async () => {
      const c = await cenario();
      const outra = await cenario();
      // tarefa confirmada recente da conta A da primeira campanha, mas registrada na campanha "outra"
      const { id: execOutra } = await um<{ id: string }>("insert into execucoes (campanha_id, status, conteudo) values ($1, 'concluida', '{}') returning id", [outra.camp]);
      await db.query("insert into tarefas (execucao_id, grupo_id, conexao_id, status, message_id, enviado_em, entrega) values ($1, $2, $3, 'enviado', $4, now() - interval '2 days', 'confirmada')", [execOutra, outra.g, c.a, `X-${sufixo()}`]);
      const exec = await c.execucao();
      await c.tarefa(exec, "40 minutes");
      expect((await conferir()).filter((x) => x.execucao_id === exec)).toHaveLength(1);
    });
  });

  describe("campanhas_links_vencidas", () => {
    async function campanha(o: { ligada?: boolean; arquivada?: boolean; termina?: string | null; ultima?: string | null; porDia?: number; grupo?: boolean } = {}) {
      const { conexao, novaCampanha, novoGrupo } = await seed();
      const camp = await novaCampanha(`lv-${sufixo()}`);
      await db.query(
        "update campanhas set links_periodicos = $2, arquivada = $3, termina_em = now() + ($4)::interval, links_atualizados_em = now() - ($5)::interval, links_por_dia = $6 where id = $1",
        [camp, o.ligada ?? true, o.arquivada ?? false, o.termina ?? "10 days", o.ultima ?? "2 days", o.porDia ?? 1],
      );
      if (o.termina === null) await db.query("update campanhas set termina_em = null where id = $1", [camp]);
      if (o.grupo ?? true) await novoGrupo(camp, 1);
      return { camp, conexao };
    }
    const vencidas = () => comoPapel("service_role", async () => (await db.query<{ id: string }>("select id from campanhas_links_vencidas(200)")).rows.map((r) => r.id));

    it("devolve só ligada, não arquivada, não terminada, com grupo ativo e vencida", async () => {
      const boa = await campanha({ termina: null });
      const desligada = await campanha({ ligada: false });
      const arquivada = await campanha({ arquivada: true });
      const terminada = await campanha({ termina: "-1 hour" });
      const semGrupo = await campanha({ grupo: false });
      const recente = await campanha({ ultima: "2 hours" });
      const horaria = await campanha({ ultima: "61 minutes", porDia: 24 });
      const ids = await vencidas();
      expect(ids).toContain(boa.camp);
      expect(ids).toContain(horaria.camp);
      for (const fora of [desligada, arquivada, terminada, semGrupo, recente]) expect(ids).not.toContain(fora.camp);
    });

    it("pula a campanha com mensagem marcada pros próximos 30 min ou enviando agora", async () => {
      const proxima = await campanha();
      await db.query("insert into execucoes (campanha_id, tipo, status, conteudo, agendada_para) values ($1, 'mensagem', 'agendada', '{}', now() + interval '20 minutes')", [proxima.camp]);
      const enviando = await campanha();
      await db.query("insert into execucoes (campanha_id, tipo, status, conteudo, agendada_para) values ($1, 'enquete', 'enviando', '{}', now() - interval '2 minutes')", [enviando.camp]);
      const longe = await campanha();
      await db.query("insert into execucoes (campanha_id, tipo, status, conteudo, agendada_para) values ($1, 'mensagem', 'agendada', '{}', now() + interval '2 hours')", [longe.camp]);
      const ids = await vencidas();
      expect(ids).not.toContain(proxima.camp);
      expect(ids).not.toContain(enviando.camp);
      expect(ids).toContain(longe.camp);
    });

    it("só o service role executa", async () => {
      await comoPapel("authenticated", async () => {
        await expect(db.query("select * from campanhas_links_vencidas(1)")).rejects.toThrow(/permission denied/);
      });
    });
  });

  it("listar_acoes esconde a atualização periódica de links, a não ser que o filtro de tipos peça", async () => {
    const { novaCampanha } = await seed();
    const camp = await novaCampanha(`la-${sufixo()}`);
    const inserir = async (origem: string, chave: string | null) =>
      (await um<{ id: string }>("insert into execucoes (campanha_id, origem, tipo, conteudo, gatilho_chave) values ($1, $2, 'atualizar_links', '{}', $3) returning id", [camp, origem, chave])).id;
    const periodica = await inserir("campanha", "periodico:2026-10-17T12:00:00.000Z");
    const banimento = await inserir("campanha", "banimento:x:2026-10-17T12:00:00.000Z");
    const botao = await inserir("avulsa", null);
    const listar = (tipos: string[] | null) =>
      comoPapel("authenticated", async () => (await db.query<{ id: string }>("select id from listar_acoes($1, null, $2, 'todas', null, null, 300, 0)", [camp, tipos])).rows.map((r) => r.id).sort());
    expect(await listar(null)).toEqual([banimento, botao].sort());
    expect(await listar(["mensagem", "enquete"])).toEqual([]);
    expect(await listar(["atualizar_links"])).toEqual([periodica, banimento, botao].sort());
  });
});

describe("listar_acoes_encadeadas (Etapa 3J, revisão final)", () => {
  const sufixo = () => Math.random().toString(36).slice(2, 8);

  it("fila: só agendada vencida e SEM depois_de; encadeada esperando (mesmo vencida) sai da fila", async () => {
    const { novaCampanha } = await seed();
    const camp = await novaCampanha(`la-enc-${sufixo()}`);
    const passado = new Date(Date.now() - 3600_000).toISOString();
    const { id: anterior } = await um<{ id: string }>(
      "insert into execucoes (campanha_id, tipo, status, agendada_para) values ($1, 'nome', 'agendada', $2) returning id",
      [camp, passado],
    );
    const solta = await um<{ id: string }>(
      "insert into execucoes (campanha_id, tipo, status, agendada_para, depois_de) values ($1, 'nome', 'agendada', $2, null) returning id",
      [camp, passado],
    );
    const { id: esperando } = await um<{ id: string }>(
      "insert into execucoes (campanha_id, tipo, status, agendada_para, depois_de) values ($1, 'fechar', 'agendada', $2, $3) returning id",
      [camp, passado, anterior],
    );
    const ids = async (aba: string) => (await db.query<{ id: string }>("select id from listar_acoes($1, null, null, $2, null, null, 50, 0)", [camp, aba])).rows.map((x) => x.id).sort();
    expect(await ids("fila")).toEqual([anterior, solta.id].sort());
    expect(await ids("agendado")).toEqual([esperando]);
    expect((await ids("todas")).length).toBe(3);
  });

  it("agendado: data futura normal OU encadeada esperando (vencida ou não)", async () => {
    const { novaCampanha } = await seed();
    const camp = await novaCampanha(`la-enc2-${sufixo()}`);
    const passado = new Date(Date.now() - 3600_000).toISOString();
    const futuro = new Date(Date.now() + 3600_000).toISOString();
    const { id: anterior } = await um<{ id: string }>(
      "insert into execucoes (campanha_id, tipo, status, agendada_para) values ($1, 'nome', 'agendada', $2) returning id",
      [camp, passado],
    );
    const { id: futura } = await um<{ id: string }>(
      "insert into execucoes (campanha_id, tipo, status, agendada_para) values ($1, 'nome', 'agendada', $2) returning id",
      [camp, futuro],
    );
    const { id: esperandoVencida } = await um<{ id: string }>(
      "insert into execucoes (campanha_id, tipo, status, agendada_para, depois_de) values ($1, 'fechar', 'agendada', $2, $3) returning id",
      [camp, passado, anterior],
    );
    const ids = async (aba: string) => (await db.query<{ id: string }>("select id from listar_acoes($1, null, null, $2, null, null, 50, 0)", [camp, aba])).rows.map((x) => x.id).sort();
    expect(await ids("agendado")).toEqual([esperandoVencida, futura].sort());
    expect(await ids("fila")).toEqual([anterior]);
  });

  it("mesma assinatura e grants da versão anterior: chamada com p_automacao continua funcionando, só service_role/authenticated executam", async () => {
    const r = await db.query("select * from listar_acoes(null, null, null, 'todas', null, null, 1, 0, null)");
    expect(r.rows).toBeDefined();
    await comoPapel("authenticated", async () => {
      await expect(db.query("select * from listar_acoes(null, null, null, 'todas', null, null, 1, 0)")).resolves.toBeDefined();
    });
    await expect(db.query("set role anon")).resolves.toBeDefined();
    await expect(db.query("select * from listar_acoes(null, null, null, 'todas', null, null, 1, 0)")).rejects.toThrow(/permission denied/);
    await db.query("reset role");
  });
});

describe("campanha_admins_numeros (Etapa 3K, Tarefa 1)", () => {
  const sufixo = () => Math.random().toString(36).slice(2, 8);

  it("chave (campanha, telefone), só dígitos de 11 a 15, some junto com a campanha", async () => {
    const { novaCampanha } = await seed();
    const camp = await novaCampanha(`adm-num-${sufixo()}`);
    const r = await um<{ created_at: string; criado_por: string | null }>(
      "insert into campanha_admins_numeros (campanha_id, telefone) values ($1, '5511" + "999990001') returning created_at, criado_por",
      [camp],
    );
    expect(r.created_at).toBeTruthy();
    expect(r.criado_por).toBeNull();
    await expect(db.query("insert into campanha_admins_numeros (campanha_id, telefone) values ($1, '5511" + "999990001')", [camp])).rejects.toThrow(/campanha_admins_numeros_pkey/);
    await expect(db.query("insert into campanha_admins_numeros (campanha_id, telefone) values ($1, '1199999')", [camp])).rejects.toThrow(/check/);
    await expect(db.query("insert into campanha_admins_numeros (campanha_id, telefone) values ($1, '+5511" + "999990002')", [camp])).rejects.toThrow(/check/);
    await expect(db.query("insert into campanha_admins_numeros (campanha_id, telefone) values ($1, '1234567890123456')", [camp])).rejects.toThrow(/check/);
    await db.query("delete from campanhas where id = $1", [camp]);
    const { n } = await um<{ n: number }>("select count(*)::int as n from campanha_admins_numeros where campanha_id = $1", [camp]);
    expect(n).toBe(0);
  });

  it("equipe logada lê e escreve; anon não enxerga nada", async () => {
    const { novaCampanha } = await seed();
    const camp = await novaCampanha(`adm-num-rls-${sufixo()}`);
    await comoPapel("authenticated", async () => {
      await db.query("insert into campanha_admins_numeros (campanha_id, telefone) values ($1, '5511" + "999990003')", [camp]);
      const { n } = await um<{ n: number }>("select count(*)::int as n from campanha_admins_numeros where campanha_id = $1", [camp]);
      expect(n).toBe(1);
      await db.query("delete from campanha_admins_numeros where campanha_id = $1", [camp]);
    });
    await comoPapel("anon", async () => {
      await expect(db.query("select * from campanha_admins_numeros")).rejects.toThrow(/permission denied/);
      await expect(db.query("insert into campanha_admins_numeros (campanha_id, telefone) values ($1, '5511" + "999990004')", [camp])).rejects.toThrow(/permission denied/);
    });
  });
});

// Fica por último: recria remover_conta_das_execucoes com o texto novo, e os testes acima ainda conferem o antigo.
describe("motivo_conexao_saiu (\"Contas\" vira \"Conexões\")", () => {
  it("motivos antigos viram o texto novo; daqui pra frente a função já grava \"conexão\"", async () => {
    const { novaCampanha } = await seed();
    const camp = await novaCampanha(`motivo-${Math.random().toString(36).slice(2, 8)}`);
    const conexao = async (n: string) => (await um<{ id: string }>("insert into conexoes (nome, webhook_secret, status, zapbot_token_enc) values ($1, 's', 'conectado', 'c') returning id", [n])).id;
    const c1 = await conexao("m1");
    const c2 = await conexao("m2");
    const antiga = (await um<{ id: string }>("insert into execucoes (campanha_id, status, alvo_contas, motivo) values ($1, 'cancelada', $2, 'A conta escolhida saiu da campanha.') returning id", [camp, [c1]])).id;
    const autoAntiga = (await um<{ id: string }>("insert into automacoes (nome, campanha_id, gatilho, ativo, alvo_contas, motivo_desativada) values ('antiga', $1, 'grupo_criado', false, $2, 'A conta escolhida saiu da campanha.') returning id", [camp, [c1]])).id;

    await db.exec(MOTIVO_CONEXAO);

    const motivo = (id: string) => um<{ motivo: string | null }>("select motivo from execucoes where id = $1", [id]);
    const motivoAuto = (id: string) => um<{ motivo_desativada: string | null }>("select motivo_desativada from automacoes where id = $1", [id]);
    expect(await motivo(antiga)).toEqual({ motivo: "A conexão escolhida saiu da campanha." });
    expect(await motivoAuto(autoAntiga)).toEqual({ motivo_desativada: "A conexão escolhida saiu da campanha." });

    const nova = (await um<{ id: string }>("insert into execucoes (campanha_id, status, alvo_contas) values ($1, 'agendada', $2) returning id", [camp, [c2]])).id;
    const autoNova = (await um<{ id: string }>("insert into automacoes (nome, campanha_id, gatilho, ativo, alvo_contas) values ('nova', $1, 'grupo_criado', true, $2) returning id", [camp, [c2]])).id;
    expect(await um("select * from remover_conta_das_execucoes($1, $2)", [camp, c2])).toEqual({ reassociadas: 0, canceladas: 1 });
    expect(await motivo(nova)).toEqual({ motivo: "A conexão escolhida saiu da campanha." });
    expect(await motivoAuto(autoNova)).toEqual({ motivo_desativada: "A conexão escolhida saiu da campanha." });
  });
});
