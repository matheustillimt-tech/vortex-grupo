import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Mesmo setup mínimo dos outros testes de migração (PGlite): roda as migrações de verdade até a desta task
// (20261017240400, Etapa 3N Task 7) — "Posição" em Projetos e `conexoes.foto_url` (ainda sem leitura: o Zapbot
// não tem rota de leitura do avatar da instância, só `PUT profile-picture`).
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
  "20261017150100_analises_rpc.sql",
  "20261017150200_conexoes_projeto.sql",
  "20261017240400_posicao_foto_conta.sql",
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

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(PRE_SUPABASE);
  for (const m of MIGRACOES) await db.exec(m);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("20261017240400_posicao_foto_conta (Etapa 3N, Task 7)", () => {
  it("projetos.posicao nasce nula (regressão: ordem de hoje não muda)", async () => {
    const { id } = await um<{ id: string }>("insert into projetos (nome) values ('P1') returning id, posicao");
    const linha = await um<{ posicao: number | null }>("select posicao from projetos where id = $1", [id]);
    expect(linha.posicao).toBeNull();
  });

  it("projetos.posicao aceita um inteiro (Mover para cima/baixo)", async () => {
    const { id } = await um<{ id: string }>("insert into projetos (nome) values ('P2') returning id");
    await db.query("update projetos set posicao = 3 where id = $1", [id]);
    const linha = await um<{ posicao: number }>("select posicao from projetos where id = $1", [id]);
    expect(linha.posicao).toBe(3);
  });

  it("conexoes.foto_url nasce nula e aceita só https://", async () => {
    const { id } = await um<{ id: string }>(
      "insert into conexoes (nome, webhook_secret, status) values ('c1', 's', 'pendente') returning id",
    );
    const linha = await um<{ foto_url: string | null }>("select foto_url from conexoes where id = $1", [id]);
    expect(linha.foto_url).toBeNull();

    await expect(db.query("update conexoes set foto_url = 'http://x.com/a.jpg' where id = $1", [id])).rejects.toThrow();
    await db.query("update conexoes set foto_url = 'https://x.com/a.jpg' where id = $1", [id]);
    const depois = await um<{ foto_url: string | null }>("select foto_url from conexoes where id = $1", [id]);
    expect(depois.foto_url).toBe("https://x.com/a.jpg");
  });

  it("linhas antigas de conexoes continuam com foto_url nula (aditiva)", async () => {
    const { id } = await um<{ id: string }>(
      "insert into conexoes (nome, webhook_secret, status) values ('antiga', 's', 'conectado') returning id",
    );
    const linha = await um<{ foto_url: string | null; status: string }>("select foto_url, status from conexoes where id = $1", [id]);
    expect(linha.foto_url).toBeNull();
    expect(linha.status).toBe("conectado");
  });

  it("authenticated consegue ler conexoes.foto_url (grant por coluna, como as outras)", async () => {
    const { id } = await um<{ id: string }>(
      "insert into conexoes (nome, webhook_secret, status, foto_url) values ('c2', 's', 'conectado', 'https://x.com/b.jpg') returning id",
    );
    const linha = await comoPapel("authenticated", () => um<{ foto_url: string | null }>("select foto_url from conexoes where id = $1", [id]));
    expect(linha.foto_url).toBe("https://x.com/b.jpg");
  });
});
