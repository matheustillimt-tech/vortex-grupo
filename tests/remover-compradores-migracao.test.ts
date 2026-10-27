import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Migração de verdade num Postgres em memória (PGlite): tudo antes de 20261019130000, linhas "de antes" (a regra de
// teste que existe em produção, uma venda já processada e as remoções que ela gerou) e então a migração que remove
// "Remover compradores" (decisão do dono, 19/10/2026).
const NOVA = "20261019130000_remover_compradores.sql";
const pasta = path.resolve(__dirname, "../supabase/migrations");
const ler = (f: string) => readFileSync(path.join(pasta, f), "utf8");

let d: PGlite;
const um = async <T>(sql: string, args: unknown[] = []) => (await d.query<T>(sql, args)).rows[0];
const antes = { campanha: "", grupo: "", venda: "", tag: "" };

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
  for (const f of todas.filter((x) => x < NOVA)) await d.exec(ler(f));

  const conexao = (await um<{ id: string }>("insert into conexoes (nome, webhook_secret, status, zapbot_token_enc) values ('n1', 's', 'conectado', 'x') returning id"))!.id;
  antes.campanha = (await um<{ id: string }>(
    "insert into campanhas (nome, slug, conexao_criadora_id, compradores_ativo) values ('c', 'com-compradores', $1, true) returning id",
    [conexao],
  ))!.id;
  antes.grupo = (await um<{ id: string }>("insert into grupos (campanha_id, conexao_id, group_id, nome, numero) values ($1, $2, 'g1@g.us', 'G1', 1) returning id", [antes.campanha, conexao]))!.id;
  await d.query("insert into regras_compra (campanha_id, provedor, produto) values ($1, 'hotmart', 'produto-teste')", [antes.campanha]);
  antes.venda = (await um<{ id: string }>(
    "insert into vendas (provedor, evento_id, aprovada, telefone, produtos, payload, processada_em, resultado) values ('hotmart', 'e1', true, '5511" + "999990001', '{produto-teste}', '{}', now(), '1 remoção(ões) na fila') returning id",
  ))!.id;
  // Histórico: uma remoção por venda já feita e uma ainda na fila.
  await d.query(
    "insert into acoes (tipo, campanha_id, grupo_id, telefone, origem, status) values ('remover', $1, $2, '5511" + "999990001', 'venda hotmart', 'ok'), ('remover', $1, $2, '5511" + "999990002', 'venda hotmart', 'fila')",
    [antes.campanha, antes.grupo],
  );
  antes.tag = (await um<{ id: string }>("select id from tags where tipo = 'comprador'"))!.id;

  for (const f of todas.filter((x) => x >= NOVA)) await d.exec(ler(f));
}, 120_000);

afterAll(async () => {
  await d?.close();
});

describe(`migração ${NOVA}`, () => {
  it("apaga a tabela regras_compra (com a política) e a coluna campanhas.compradores_ativo", async () => {
    expect(await um("select to_regclass('public.regras_compra') as t")).toEqual({ t: null });
    expect(await um<{ n: number }>("select count(*)::int as n from pg_policies where tablename = 'regras_compra'")).toEqual({ n: 0 });
    const colunas = await d.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'campanhas' and column_name = 'compradores_ativo'");
    expect(colunas.rows).toEqual([]);
  });

  it("nada do banco ficou apontando pra elas (funções, views, checks)", async () => {
    const funcoes = await d.query("select proname from pg_proc where prosrc ~ '(regras_compra|compradores_ativo)'");
    expect(funcoes.rows).toEqual([]);
    const views = await d.query("select viewname from pg_views where schemaname = 'public' and definition ~ '(regras_compra|compradores_ativo)'");
    expect(views.rows).toEqual([]);
    const checks = await d.query("select conname from pg_constraint where pg_get_constraintdef(oid) ~ '(regras_compra|compradores_ativo)'");
    expect(checks.rows).toEqual([]);
  });

  it("campanha, grupo e venda continuam; a campanha segue lendo com select *", async () => {
    const c = await um<Record<string, unknown>>("select * from campanhas where id = $1", [antes.campanha]);
    expect(c).toMatchObject({ nome: "c", slug: "com-compradores" });
    expect(c).not.toHaveProperty("compradores_ativo");
    expect(await um("select nome from grupos where id = $1", [antes.grupo])).toEqual({ nome: "G1" });
    expect(await um("select aprovada, resultado from vendas where id = $1", [antes.venda])).toEqual({ aprovada: true, resultado: "1 remoção(ões) na fila" });
  });

  it("histórico de remoções por venda fica intacto, e remoção nova (automação de checkout) ainda grava", async () => {
    const r = await d.query("select telefone, origem, status from acoes where tipo = 'remover' order by telefone");
    expect(r.rows).toEqual([
      { telefone: "5511" + "999990001", origem: "venda hotmart", status: "ok" },
      { telefone: "5511" + "999990002", origem: "venda hotmart", status: "fila" },
    ]);
    await d.query("insert into acoes (tipo, campanha_id, grupo_id, telefone, origem) values ('remover', $1, $2, '5511" + "999990003', 'automação')", [antes.campanha, antes.grupo]);
    // O índice de "um remover aberto por grupo+telefone" continua valendo.
    await expect(
      d.query("insert into acoes (tipo, campanha_id, grupo_id, telefone, origem) values ('remover', $1, $2, '5511" + "999990002', 'venda hotmart')", [antes.campanha, antes.grupo]),
    ).rejects.toThrow(/acoes_um_remover_por_participante/);
  });

  it("webhook de checkout (registrar_venda) e tag Comprador (por_tag) continuam funcionando", async () => {
    await d.query("select registrar_venda('kiwify', 'e2', true, '5511" + "999990009', array['Curso'], '{}'::jsonb, null)");
    expect(await um("select provedor, aprovada, telefone, processada_em from vendas where evento_id = 'e2'")).toEqual({
      provedor: "kiwify",
      aprovada: true,
      telefone: "5511" + "999990009",
      processada_em: null,
    });
    await d.query("select por_tag(array['5511" + "999990009'], $1, null)", [antes.tag]);
    expect(await um<{ n: number }>("select count(*)::int as n from pessoa_tags where telefone = '5511" + "999990009' and tag_id = $1", [antes.tag])).toEqual({ n: 1 });
  });

  it("rodar de novo não dá erro (if exists em tudo)", async () => {
    await expect(d.exec(ler(NOVA))).resolves.toBeDefined();
  });
});
