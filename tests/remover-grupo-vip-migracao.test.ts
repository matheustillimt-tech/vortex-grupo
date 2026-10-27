import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Migração de verdade num Postgres em memória (PGlite): tudo antes de 20261019120000, linhas "de antes" (inclusive do
// Grupo VIP, que em produção estavam zeradas), e então a migração que remove o Grupo VIP (decisão do dono, 19/10/2026).
const NOVA = "20261019120000_remover_grupo_vip.sql";
const pasta = path.resolve(__dirname, "../supabase/migrations");
const ler = (f: string) => readFileSync(path.join(pasta, f), "utf8");

let d: PGlite;
const um = async <T>(sql: string, args: unknown[] = []) => (await d.query<T>(sql, args)).rows[0];
const antes = { campanha: "", regra: "" };

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
    "insert into campanhas (nome, slug, conexao_criadora_id, compradores_ativo, vip_ativo, vip_mensagem) values ('c', 'sem-vip', $1, true, true, 'oi {link}') returning id",
    [conexao],
  ))!.id;
  antes.regra = (await um<{ id: string }>("insert into regras_compra (campanha_id, provedor, produto) values ($1, 'hotmart', 'Curso') returning id", [antes.campanha]))!.id;
  const venda = (await um<{ id: string }>("insert into vendas (provedor, evento_id, aprovada, telefone, payload) values ('hotmart', 'e1', true, '5511" + "999990001', '{}') returning id"))!.id;
  await d.query("insert into vip_entradas (venda_id, campanha_id, telefone) values ($1, $2, '5511" + "999990001')", [venda, antes.campanha]);
  await d.query("insert into alertas (tipo, campanha_id, texto) values ('vip_erro', $1, 'x'), ('grupo_cheio', $1, 'y')", [antes.campanha]);

  // Só esta migração: as seguintes (ex.: 20261019130000_remover_compradores.sql, que apaga regras_compra) têm teste próprio.
  await d.exec(ler(NOVA));
}, 120_000);

afterAll(async () => {
  await d?.close();
});

describe(`migração ${NOVA}`, () => {
  it("apaga a função pegar_vip e a tabela vip_entradas", async () => {
    expect(await um("select to_regclass('public.vip_entradas') as t")).toEqual({ t: null });
    expect(await um<{ n: number }>("select count(*)::int as n from pg_proc where proname = 'pegar_vip'")).toEqual({ n: 0 });
  });

  it("apaga as colunas vip_* de campanhas e regras_compra.modo (com o índice), sem perder a campanha nem a regra", async () => {
    const colunas = await d.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns
        where table_schema = 'public' and ((table_name = 'campanhas' and column_name like 'vip%') or (table_name = 'regras_compra' and column_name = 'modo'))`,
    );
    expect(colunas.rows).toEqual([]);
    expect(await um("select to_regclass('public.regras_compra_provedor_modo') as i")).toEqual({ i: null });
    expect(await um("select nome, compradores_ativo from campanhas where id = $1", [antes.campanha])).toEqual({ nome: "c", compradores_ativo: true });
    expect(await um("select campanha_id, provedor, produto from regras_compra where id = $1", [antes.regra])).toEqual({
      campanha_id: antes.campanha,
      provedor: "hotmart",
      produto: "Curso",
    });
  });

  it("Remover compradores continua: regra nova grava sem modo e a leitura do job (regras + campanhas!inner) funciona", async () => {
    await d.query("insert into regras_compra (campanha_id, provedor, produto) values ($1, 'kiwify', 'X')", [antes.campanha]);
    const r = await d.query(
      "select r.campanha_id, r.produto from regras_compra r join campanhas c on c.id = r.campanha_id where r.provedor = 'hotmart' and c.compradores_ativo",
    );
    expect(r.rows).toEqual([{ campanha_id: antes.campanha, produto: "Curso" }]);
  });

  it("alertas_tipo_check volta aos 9 tipos de antes: os vip_* saem e não entram mais", async () => {
    const tipos = await d.query<{ tipo: string }>("select tipo from alertas order by tipo");
    expect(tipos.rows).toEqual([{ tipo: "grupo_cheio" }]);
    await expect(d.query("insert into alertas (tipo, texto) values ('vip_convite', 'x')")).rejects.toThrow(/alertas_tipo_check/);
    await expect(d.query("insert into alertas (tipo, texto) values ('vip_erro', 'x')")).rejects.toThrow(/alertas_tipo_check/);
    for (const t of ["grupo_cheio", "numero_caiu", "execucao_bloqueada", "tarefa_erro", "grupo_sumiu", "criacao_erro", "bloqueado_removido", "antispam_sem_conta", "entrega_nao_confirmada"]) {
      await d.query("insert into alertas (tipo, texto) values ($1, 'ok')", [t]);
    }
  });

  it("rodar de novo não dá erro (if exists em tudo)", async () => {
    await expect(d.exec(ler(NOVA))).resolves.toBeDefined();
  });
});
