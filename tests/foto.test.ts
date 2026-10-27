import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decidirFoto, depoisDaConfirmacao, fotoDaCampanha, fotoDaResposta, fotoDoGrupoLido, mapaFotosCampanhas, mesmaFoto, mudancaDeFoto, urlSemQuery } from "@/src/lib/regras/foto";

/** Etapa 3M, Tarefa 3: foto real dos grupos (regras, componente e migração). */

const FOTO = "https://pps.whatsapp.net/v/t61/foto.jpg";
const IMAGEM = "https://x.supabase.co/storage/v1/object/public/midias/capa.png";

describe("fotoDaResposta", () => {
  it("undefined = não sei; null/vazio/http/data = sem foto; https = a URL", () => {
    expect(fotoDaResposta(undefined)).toBeUndefined();
    expect(fotoDaResposta(null)).toBeNull();
    expect(fotoDaResposta("")).toBeNull();
    expect(fotoDaResposta("http://pps.whatsapp.net/x.jpg")).toBeNull();
    expect(fotoDaResposta("data:image/png;base64,AAAA")).toBeNull();
    expect(fotoDaResposta(42)).toBeNull();
    expect(fotoDaResposta(FOTO)).toBe(FOTO);
  });
});

describe("fotoDoGrupoLido (GET groups/{id})", () => {
  it("chave ausente = sem foto (prova da Task 1); https = a URL", () => {
    expect(fotoDoGrupoLido(undefined)).toBeNull();
    expect(fotoDoGrupoLido(null)).toBeNull();
    expect(fotoDoGrupoLido(FOTO)).toBe(FOTO);
  });
});

describe("mudancaDeFoto", () => {
  const AGORA = "2026-10-17T12:00:00.000Z";
  it("igual = nada a gravar (coluna ausente conexão como sem foto)", () => {
    expect(mudancaDeFoto(FOTO, FOTO, AGORA)).toBeNull();
    expect(mudancaDeFoto(null, null, AGORA)).toBeNull();
    expect(mudancaDeFoto(undefined, null, AGORA)).toBeNull();
  });
  it("mudou = foto nova (ou null) e o instante", () => {
    expect(mudancaDeFoto(null, FOTO, AGORA)).toEqual({ foto_url: FOTO, foto_atualizada_em: AGORA });
    expect(mudancaDeFoto(FOTO, null, AGORA)).toEqual({ foto_url: null, foto_atualizada_em: AGORA });
    expect(mudancaDeFoto(undefined, FOTO, AGORA)).toEqual({ foto_url: FOTO, foto_atualizada_em: AGORA });
  });
});

describe("mesmaFoto / urlSemQuery (parâmetros assinados não contam)", () => {
  const A = "https://pps.whatsapp.net/v/t61/foto.jpg?ccb=11-4&oh=AAA&oe=1";
  const A2 = "https://pps.whatsapp.net/v/t61/foto.jpg?ccb=11-4&oh=BBB&oe=2";
  const B = "https://pps.whatsapp.net/v/t61/outra.jpg?oh=AAA";
  it("mesmo caminho com query diferente = mesma foto; caminho diferente = outra", () => {
    expect(urlSemQuery(A)).toBe("https://pps.whatsapp.net/v/t61/foto.jpg");
    expect(urlSemQuery("https://x/a.jpg#h")).toBe("https://x/a.jpg");
    expect(mesmaFoto(A, A2)).toBe(true);
    expect(mesmaFoto(A, B)).toBe(false);
    expect(mesmaFoto(null, undefined)).toBe(true);
    expect(mesmaFoto(A, null)).toBe(false);
  });
  it("mudancaDeFoto: só a query mudou = nada; o caminho mudou = grava", () => {
    expect(mudancaDeFoto(A, A2, "2026-10-17T12:00:00.000Z")).toBeNull();
    expect(mudancaDeFoto(A, B, "2026-10-17T12:00:00.000Z")).toEqual({ foto_url: B, foto_atualizada_em: "2026-10-17T12:00:00.000Z" });
  });
});

describe("decidirFoto (conferência) e depoisDaConfirmacao", () => {
  const AGORA = "2026-10-17T12:00:00.000Z";
  const HA_1H = "2026-10-17T11:00:00.000Z";
  const HA_2D = "2026-10-15T12:00:00.000Z";
  const base = { noBanco: FOTO, atualizadaEm: HA_2D, conferidaEm: null, agora: AGORA };

  it("foto no GET: grava só quando o caminho muda", () => {
    expect(decidirFoto({ ...base, avatarUrl: FOTO + "?oh=novo" })).toEqual({ tipo: "nada" });
    expect(decidirFoto({ ...base, avatarUrl: "https://pps.whatsapp.net/v/t61/nova.jpg" })).toEqual({
      tipo: "gravar",
      campos: { foto_url: "https://pps.whatsapp.net/v/t61/nova.jpg", foto_atualizada_em: AGORA },
    });
    expect(decidirFoto({ ...base, noBanco: null, avatarUrl: FOTO })).toEqual({ tipo: "gravar", campos: { foto_url: FOTO, foto_atualizada_em: AGORA } });
  });

  it("chave ausente (ou não https) e banco sem foto: nada", () => {
    expect(decidirFoto({ ...base, noBanco: null, avatarUrl: undefined })).toEqual({ tipo: "nada" });
    expect(decidirFoto({ ...base, noBanco: undefined, avatarUrl: null })).toEqual({ tipo: "nada" });
  });

  it("chave ausente e foto gravada há menos de 24 h: mantém (sem perguntar)", () => {
    expect(decidirFoto({ ...base, atualizadaEm: HA_1H, avatarUrl: undefined })).toEqual({ tipo: "nada" });
  });

  it("chave ausente, foto com mais de 24 h: confirma na rota /avatar — no máximo uma vez por dia", () => {
    expect(decidirFoto({ ...base, avatarUrl: undefined })).toEqual({ tipo: "confirmar" });
    expect(decidirFoto({ ...base, atualizadaEm: null, avatarUrl: null })).toEqual({ tipo: "confirmar" });
    expect(decidirFoto({ ...base, atualizadaEm: "lixo", avatarUrl: undefined })).toEqual({ tipo: "confirmar" });
    expect(decidirFoto({ ...base, conferidaEm: HA_1H, avatarUrl: undefined })).toEqual({ tipo: "nada" });
    expect(decidirFoto({ ...base, conferidaEm: HA_2D, avatarUrl: undefined })).toEqual({ tipo: "confirmar" });
  });

  it("depois de confirmar: sem foto apaga; mesma foto mantém; outra grava; erro mantém — sempre marca foto_conferida_em", () => {
    expect(depoisDaConfirmacao(FOTO, null, AGORA)).toEqual({ foto_url: null, foto_atualizada_em: AGORA, foto_conferida_em: AGORA });
    expect(depoisDaConfirmacao(FOTO, FOTO + "?oh=x", AGORA)).toEqual({ foto_conferida_em: AGORA });
    expect(depoisDaConfirmacao(FOTO, "https://pps.whatsapp.net/v/t61/nova.jpg", AGORA)).toEqual({
      foto_url: "https://pps.whatsapp.net/v/t61/nova.jpg",
      foto_atualizada_em: AGORA,
      foto_conferida_em: AGORA,
    });
    expect(depoisDaConfirmacao(FOTO, "erro", AGORA)).toEqual({ foto_conferida_em: AGORA });
  });
});

describe("fotoDaCampanha", () => {
  it("foto atual do grupo primeiro; senão a imagem da campanha; senão null (letra)", () => {
    expect(fotoDaCampanha({ imagem_grupo_url: IMAGEM }, FOTO)).toBe(FOTO);
    expect(fotoDaCampanha({ imagem_grupo_url: IMAGEM }, null)).toBe(IMAGEM);
    expect(fotoDaCampanha({ imagem_grupo_url: null }, FOTO)).toBe(FOTO);
    expect(fotoDaCampanha({}, FOTO)).toBe(FOTO);
    expect(fotoDaCampanha({}, undefined)).toBeNull();
    expect(fotoDaCampanha({ imagem_grupo_url: null }, null)).toBeNull();
  });
  it("valor que não é https não vira foto", () => {
    expect(fotoDaCampanha({ imagem_grupo_url: "http://x/a.png" }, FOTO)).toBe(FOTO);
    expect(fotoDaCampanha({}, "javascript:alert(1)")).toBeNull();
  });
});

describe("mapaFotosCampanhas", () => {
  it("linhas da RPC → mapa; ignora lixo e não-https", () => {
    const m = mapaFotosCampanhas([{ campanha_id: "c1", foto_url: FOTO }, { campanha_id: "c2", foto_url: "http://x" }, null, { foto_url: FOTO }]);
    expect([...m]).toEqual([["c1", FOTO]]);
    expect(mapaFotosCampanhas(null).size).toBe(0);
  });
});

// O vitest compila o TSX no modo clássico: o React precisa estar no escopo global (como em componentes-3l.test.ts).
async function html<P extends object>(Componente: (props: P) => unknown, props: P): Promise<string> {
  const React = await import("react");
  (globalThis as { React?: unknown }).React = React;
  const { renderToStaticMarkup } = await import("react-dom/server");
  return renderToStaticMarkup(React.createElement(Componente as never, props as never));
}

describe("AvatarFoto", () => {
  it("sem foto = exatamente o HTML do Avatar de letra de hoje (com e sem bolinha, nos tamanhos usados)", async () => {
    const { Avatar } = await import("@/app/(painel)/_componentes/avatar");
    const { AvatarFoto } = await import("@/app/(painel)/_componentes/avatar-foto");
    for (const props of [{ nome: "Aulão" }, { nome: "Aulão", ativo: true }, { nome: "x", cor: "erro" as const, tamanho: 32 }, { nome: "", tamanho: 48 }]) {
      const letra = await html(Avatar, props);
      expect(await html(AvatarFoto, props)).toBe(letra);
      expect(await html(AvatarFoto, { ...props, foto: null })).toBe(letra);
      // Só https vira foto: http/data/relativo continuam letra.
      expect(await html(AvatarFoto, { ...props, foto: "http://x/a.jpg" })).toBe(letra);
      expect(await html(AvatarFoto, { ...props, foto: "/a.jpg" })).toBe(letra);
    }
  });

  it("com foto: <img> redonda no mesmo tamanho, sem Referer, preguiçosa, sem alt e com a mesma bolinha", async () => {
    const { AvatarFoto } = await import("@/app/(painel)/_componentes/avatar-foto");
    const saida = await html(AvatarFoto, { nome: "Aulão", foto: FOTO, ativo: true, tamanho: 20 });
    expect(saida).toContain(`src="${FOTO}"`);
    expect(saida).toContain('alt=""');
    expect(saida).toContain('referrerPolicy="no-referrer"');
    expect(saida).toContain('loading="lazy"');
    expect(saida).toContain('decoding="async"');
    expect(saida).toContain("width:20px;height:20px");
    expect(saida).toContain("rounded-full");
    expect(saida).toContain("bg-[#0fa968]");
    expect(saida).not.toContain(">A<");
  });
});

// Migração de verdade (todas, em ordem) num Postgres em memória.
describe("migração 20261017220100_fotos_grupos", () => {
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

  const um = async <T>(sql: string, p: unknown[] = []) => (await d.query<T>(sql, p)).rows[0];
  let conexao: string;
  const campanha = async (slug: string) => (await um<{ id: string }>("insert into campanhas (nome, slug, conexao_criadora_id) values ($1, $1, $2) returning id", [slug, conexao])).id;
  const grupo = async (camp: string, n: number, extra: { foto?: string | null; ativo?: boolean } = {}) =>
    (await um<{ id: string }>("insert into grupos (campanha_id, conexao_id, group_id, nome, numero, foto_url, ativo) values ($1, $2, $3, $3, $4, $5, $6) returning id", [camp, conexao, `g-${camp}-${n}`, n, extra.foto ?? null, extra.ativo ?? true])).id;

  beforeAll(async () => {
    conexao = (await um<{ id: string }>("insert into conexoes (nome, webhook_secret, status, zapbot_token_enc) values ('n1', 's', 'conectado', 'x') returning id")).id;
  });

  it("colunas novas nulas por padrão (grupo de hoje = letra); só https", async () => {
    const c = await campanha("foto-padrao");
    const g = await grupo(c, 1);
    expect(await um("select foto_url, foto_atualizada_em, foto_conferida_em from grupos where id = $1", [g])).toEqual({ foto_url: null, foto_atualizada_em: null, foto_conferida_em: null });
    await d.query("update grupos set foto_url = $1, foto_atualizada_em = now() where id = $2", [FOTO, g]);
    await expect(d.query("update grupos set foto_url = 'http://x/a.jpg' where id = $1", [g])).rejects.toThrow(/check/);
    await expect(d.query("update grupos set foto_url = 'data:image/png;base64,AA' where id = $1", [g])).rejects.toThrow(/check/);
    await d.query("insert into conta_grupos (conexao_id, group_id) values ($1, 'cg-1')", [conexao]);
    expect(await um("select foto_url from conta_grupos where group_id = 'cg-1'")).toEqual({ foto_url: null });
    await d.query("update conta_grupos set foto_url = $1 where group_id = 'cg-1'", [FOTO]);
    await expect(d.query("update conta_grupos set foto_url = 'http://x' where group_id = 'cg-1'")).rejects.toThrow(/check/);
  });

  it("fotos_campanhas: grupo ATIVO de menor número com foto; campanha sem foto não aparece", async () => {
    const a = await campanha("foto-a");
    await grupo(a, 1, { foto: "https://x/inativo.jpg", ativo: false });
    await grupo(a, 2);
    await grupo(a, 3, { foto: "https://x/tres.jpg" });
    await grupo(a, 4, { foto: "https://x/quatro.jpg" });
    const b = await campanha("foto-b");
    await grupo(b, 1);
    const r = await d.query<{ campanha_id: string; foto_url: string }>("select * from fotos_campanhas($1) order by foto_url", [[a, b]]);
    expect(r.rows).toEqual([{ campanha_id: a, foto_url: "https://x/tres.jpg" }]);
    expect((await d.query("select * from fotos_campanhas(null)")).rows).toEqual([]);
  });

  it("fotos_campanhas: authenticated e service_role chamam; anon não", async () => {
    const c = await campanha("foto-papel");
    await grupo(c, 1, { foto: FOTO });
    for (const papel of ["authenticated", "service_role"]) {
      await d.query(`set role ${papel}`);
      try {
        expect((await d.query("select * from fotos_campanhas($1)", [[c]])).rows).toHaveLength(1);
      } finally {
        await d.query("reset role");
      }
    }
    await d.query("set role anon");
    try {
      await expect(d.query("select * from fotos_campanhas($1)", [[c]])).rejects.toThrow(/permission denied/);
    } finally {
      await d.query("reset role");
    }
  });
});
