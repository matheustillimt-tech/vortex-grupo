import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Mesmo setup mínimo do `migracao.test.ts`: roda as migrações de verdade num Postgres em memória (PGlite), até a
// que cria `desempenho_grupos` (recibos por pessoa), e por cima a migração nova desta task
// (`desempenho_grupos_tabela`, Etapa 3N Task 4).
const PRE_SUPABASE = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema extensions;
  create schema auth;
  create table auth.users (id uuid primary key);
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
const ler = (nome: string) => readFileSync(path.join(PASTA, nome), "utf8");

const MIGRACOES = [
  "20261015120000_inicial.sql",
  "20261016120000_fase2a.sql",
  "20261016140000_resumo_campanhas.sql",
  "20261016150000_grupos_mensagens.sql",
  "20261016160000_metricas_gerais.sql",
  "20261016170000_automacoes.sql",
  "20261016180000_automacoes_parte2.sql",
  "20261016190000_bloco2b.sql",
  "20261016200000_modelos_variaveis.sql",
  "20261016210000_webhooks_historico.sql",
  "20261016220000_projetos.sql",
  "20261016230000_membros.sql",
  "20261017090000_alertas_conexao.sql",
  "20261017100000_listar_acoes.sql",
  "20261017110000_acoes_v2.sql",
  "20261017120000_campanha_extras.sql",
  "20261017120100_campanha_contas.sql",
  "20261017130000_grupos_extras.sql",
  "20261017140000_automacoes_v3.sql",
  "20261017140100_listar_acoes_automacao.sql",
  "20261017140200_automacoes_contas_vendas.sql",
  "20261017150000_recibos_pessoa.sql",
  "20261017240300_desempenho_tabela.sql",
].map(ler);

let db: PGlite;

async function um<T>(sql: string, params: unknown[] = []): Promise<T> {
  const r = await db.query<T>(sql, params);
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
  const novoGrupo = async (campanha: string, n: number, participantes = 1) =>
    (
      await um<{ id: string }>(
        "insert into grupos (campanha_id, conexao_id, group_id, nome, numero, participantes) values ($1, $2, $3, $4, $5, $6) returning id",
        [campanha, conexao, `g-${campanha}-${n}`, `Grupo ${n}`, n, participantes],
      )
    ).id;
  return { conexao, novaCampanha, novoGrupo };
}

async function novaExecucaoComTarefa(campanha: string, grupo: string, conexao: string) {
  const { id: execucao } = await um<{ id: string }>("insert into execucoes (campanha_id) values ($1) returning id", [campanha]);
  const { id: tarefa } = await um<{ id: string }>("insert into tarefas (execucao_id, grupo_id, conexao_id) values ($1, $2, $3) returning id", [execucao, grupo, conexao]);
  return { execucao, tarefa };
}

async function recibo(tarefa: string, telefone: string, tipo: "recebeu" | "visualizou" | "reproduziu") {
  await db.query("insert into recibos (tarefa_id, telefone, tipo) values ($1, $2, $3)", [tarefa, telefone, tipo]);
}

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(PRE_SUPABASE);
  for (const m of MIGRACOES) await db.exec(m);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

type Linha = { grupo_id: string; numero: number; nome: string; group_id: string; participantes: number; geral: string; visualizacao: string; reproducao: string; recebimento: string; total: number };

describe("desempenho_grupos_tabela (Etapa 3N, Task 4)", () => {
  it("devolve os 4 sinais por grupo, com o total via count(*) over () e desempate por número", async () => {
    const { conexao, novaCampanha, novoGrupo } = await seed();
    const camp = await novaCampanha("dgt-base");
    const g1 = await novoGrupo(camp, 1, 10);
    const g2 = await novoGrupo(camp, 2, 10);
    const { tarefa: t1 } = await novaExecucaoComTarefa(camp, g1, conexao);
    const { tarefa: t2 } = await novaExecucaoComTarefa(camp, g2, conexao);
    // g1: 2 recebeu (20 pts ÷ 10 = 2.00); g2: 1 visualizou (20 pts ÷ 10 = 2.00) — critério geral empata, desempate
    // pelo número (g1 antes de g2).
    await recibo(t1, "1", "recebeu");
    await recibo(t1, "2", "recebeu");
    await recibo(t2, "3", "visualizou");

    const r = await comoPapel("authenticated", () =>
      db.query<Linha>("select * from desempenho_grupos_tabela($1, 'geral', null, null, 0, 10)", [camp]),
    );
    expect(r.rows.map((l) => l.numero)).toEqual([1, 2]);
    expect(r.rows[0].total).toBe(2);
    expect(Number(r.rows[0].recebimento)).toBeCloseTo(2);
    expect(Number(r.rows[0].geral)).toBeCloseTo(2);
    expect(Number(r.rows[1].visualizacao)).toBeCloseTo(2);
    expect(r.rows[0].group_id).toBe(`g-${camp}-1`);
  });

  it("pagina com offset/limite (total continua o mesmo em todas as páginas)", async () => {
    const { novaCampanha, novoGrupo } = await seed();
    const camp = await novaCampanha("dgt-paginacao");
    for (let n = 1; n <= 5; n++) await novoGrupo(camp, n, 1);

    const pagina1 = await db.query<Linha>("select * from desempenho_grupos_tabela($1, 'geral', null, null, 0, 2)", [camp]);
    const pagina2 = await db.query<Linha>("select * from desempenho_grupos_tabela($1, 'geral', null, null, 2, 2)", [camp]);
    const pagina3 = await db.query<Linha>("select * from desempenho_grupos_tabela($1, 'geral', null, null, 4, 2)", [camp]);
    expect(pagina1.rows.map((l) => l.numero)).toEqual([1, 2]);
    expect(pagina2.rows.map((l) => l.numero)).toEqual([3, 4]);
    expect(pagina3.rows.map((l) => l.numero)).toEqual([5]);
    expect(pagina1.rows[0].total).toBe(5);
    expect(pagina2.rows[0].total).toBe(5);
    expect(pagina3.rows[0].total).toBe(5);
  });

  it("ordena pela coluna do critério escolhido", async () => {
    const { conexao, novaCampanha, novoGrupo } = await seed();
    const camp = await novaCampanha("dgt-criterio");
    const g1 = await novoGrupo(camp, 1, 1);
    const g2 = await novoGrupo(camp, 2, 1);
    const { tarefa: t1 } = await novaExecucaoComTarefa(camp, g1, conexao);
    const { tarefa: t2 } = await novaExecucaoComTarefa(camp, g2, conexao);
    // g1 só com reprodução (40 pts); g2 só com recebimento (10 pts). No geral g1 > g2; no recebimento g2 > g1.
    await recibo(t1, "1", "reproduziu");
    await recibo(t2, "2", "recebeu");

    const porGeral = await db.query<Linha>("select numero from desempenho_grupos_tabela($1, 'geral', null, null, 0, 10)", [camp]);
    expect(porGeral.rows.map((l) => l.numero)).toEqual([1, 2]);
    const porRecebimento = await db.query<Linha>("select numero from desempenho_grupos_tabela($1, 'recebimento', null, null, 0, 10)", [camp]);
    expect(porRecebimento.rows.map((l) => l.numero)).toEqual([2, 1]);
  });

  it("filtra por execução (p_execucao)", async () => {
    const { conexao, novaCampanha, novoGrupo } = await seed();
    const camp = await novaCampanha("dgt-execucao");
    const g1 = await novoGrupo(camp, 1, 1);
    const { execucao: e1, tarefa: t1 } = await novaExecucaoComTarefa(camp, g1, conexao);
    const { tarefa: t2 } = await novaExecucaoComTarefa(camp, g1, conexao);
    await recibo(t1, "1", "recebeu");
    await recibo(t2, "2", "recebeu");

    const filtrado = await db.query<Linha>("select * from desempenho_grupos_tabela($1, 'geral', $2, null, 0, 10)", [camp, e1]);
    expect(Number(filtrado.rows[0].recebimento)).toBeCloseTo(10);
    const semFiltro = await db.query<Linha>("select * from desempenho_grupos_tabela($1, 'geral', null, null, 0, 10)", [camp]);
    expect(Number(semFiltro.rows[0].recebimento)).toBeCloseTo(20);
  });

  it("busca pelo nome escapando % e _ (literais, não comodins)", async () => {
    const { novaCampanha, novoGrupo } = await seed();

    const camp = await novaCampanha("dgt-busca");
    await um<{ id: string }>("update grupos set nome = '100%_ok' where id = $1", [await novoGrupo(camp, 1, 1)]);
    await novoGrupo(camp, 2, 1); // nome "Grupo 2": não deve casar com a busca abaixo

    const comPorcento = await db.query<Linha>("select * from desempenho_grupos_tabela($1, 'geral', null, '100%', 0, 10)", [camp]);
    expect(comPorcento.rows.map((l) => l.numero)).toEqual([1]);
    const comEscape = await db.query<Linha>("select * from desempenho_grupos_tabela($1, 'geral', null, '%_ok', 0, 10)", [camp]);
    expect(comEscape.rows.map((l) => l.numero)).toEqual([1]);
    const semGrupo = await db.query<Linha>("select * from desempenho_grupos_tabela($1, 'geral', null, 'inexistente', 0, 10)", [camp]);
    expect(semGrupo.rows).toEqual([]);
  });

  it("limite fica entre 1 e 100, mesmo pedindo fora da faixa", async () => {
    const { novaCampanha, novoGrupo } = await seed();
    const camp = await novaCampanha("dgt-limite");
    for (let n = 1; n <= 3; n++) await novoGrupo(camp, n, 1);
    const grande = await db.query<Linha>("select * from desempenho_grupos_tabela($1, 'geral', null, null, 0, 10000)", [camp]);
    expect(grande.rows.length).toBe(3);
    const minimo = await db.query<Linha>("select * from desempenho_grupos_tabela($1, 'geral', null, null, 0, 0)", [camp]);
    expect(minimo.rows.length).toBe(1);
  });

  it("não quebra `desempenho_grupos` (continua intacta para o gráfico e a exportação)", async () => {
    const { conexao, novaCampanha, novoGrupo } = await seed();
    const camp = await novaCampanha("dgt-regressao");
    const g1 = await novoGrupo(camp, 1, 2);
    const { tarefa } = await novaExecucaoComTarefa(camp, g1, conexao);
    await recibo(tarefa, "1", "recebeu");
    const r = await um<{ pontuacao: string }>("select pontuacao from desempenho_grupos($1, 'geral', null, 20, null)", [camp]);
    expect(Number(r.pontuacao)).toBeCloseTo(5); // 10 pts ÷ 2 participantes
  });

  it("equipe logada executa; anon não (grant/revoke)", async () => {
    const { novaCampanha } = await seed();
    const camp = await novaCampanha("dgt-permissoes");
    await comoPapel("authenticated", async () => {
      await expect(db.query("select * from desempenho_grupos_tabela($1, 'geral', null, null, 0, 10)", [camp])).resolves.toBeDefined();
    });
    await comoPapel("anon", async () => {
      await expect(db.query("select * from desempenho_grupos_tabela($1, 'geral', null, null, 0, 10)", [camp])).rejects.toThrow(/permission denied/);
    });
  });
});
