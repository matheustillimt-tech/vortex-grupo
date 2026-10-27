import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Regra dos 3 min retirada (20/10/2026, pedido do dono): o horário que ele agenda fica como está.
const NOVA = "20261020190000_remover_visual_3min.sql";
const pasta = path.resolve(__dirname, "../supabase/migrations");
const ler = (f: string) => readFileSync(path.join(pasta, f), "utf8");

let d: PGlite;
let campanha = "";
const um = async <T>(sql: string, args: unknown[] = []) => (await d.query<T>(sql, args)).rows[0];
const agendar = async (camp: string, tipo: string, quando: string, depoisDe: string | null = null) =>
  (await um<{ id: string }>(
    "insert into execucoes (campanha_id, tipo, conteudo, agendada_para, origem, depois_de) values ($1, $2, '{}', $3, 'avulsa', $4) returning id",
    [camp, tipo, quando, depoisDe],
  ))!.id;
const hora = async (id: string) => (await um<{ h: string }>("select to_char(agendada_para at time zone 'UTC', 'HH24:MI:SS') as h from execucoes where id = $1", [id]))!.h;

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
  expect(todas).toContain(NOVA);
  for (const f of todas) await d.exec(ler(f));
  campanha = (await um<{ id: string }>("insert into campanhas (nome, slug) values ('c', 'c3min') returning id"))!.id;
}, 120_000);

afterAll(async () => {
  await d?.close();
});

describe(`migração ${NOVA}`, () => {
  it("troca de nome/imagem no mesmo minuto da mensagem fica no horário agendado", async () => {
    await agendar(campanha, "mensagem", "2026-10-21T23:00:00Z");
    const nome = await agendar(campanha, "nome", "2026-10-21T23:00:00Z");
    const imagem = await agendar(campanha, "imagem", "2026-10-21T22:58:30Z");
    await agendar(campanha, "mensagem", "2026-10-21T22:59:00Z");
    expect([await hora(nome), await hora(imagem)]).toEqual(["23:00:00", "22:58:30"]);
  });
  it("os gatilhos e as funções saíram", async () => {
    expect(await um<{ n: number }>("select count(*)::int as n from pg_trigger where tgname in ('visual_antes_da_mensagem', 'mensagem_empurra_visual')")).toEqual({ n: 0 });
    expect(await um<{ n: number }>("select count(*)::int as n from pg_proc where proname in ('visual_antes_da_mensagem', 'mensagem_empurra_visual')")).toEqual({ n: 0 });
  });
});
