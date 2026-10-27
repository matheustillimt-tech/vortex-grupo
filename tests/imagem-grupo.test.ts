import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { conteudoInicial, resumoConteudo, ROTULO_TIPO, TIPOS_EXECUCAO, TIPOS_MASSA, validarConteudo } from "@/src/lib/regras/conteudo";
import { ICONE_ACAO, ROTULO_ACAO as ROTULO_ACAO_TELA } from "@/src/lib/regras/acoes";
import {
  AJUDA_IMAGEM_GRUPO,
  ERRO_IMAGEM_RECUSADA,
  ehUrlImagemGrupo,
  erroDaImagemNoZapbot,
  lerImagemGrupoUrl,
  nomeJpeg,
  prefixoMidias,
  recorteFotoGrupo,
  validarArquivoImagem,
  validarDimensoesImagem,
} from "@/src/lib/regras/imagem-grupo";

const URL_OK = "https://exemplo.supabase.co/storage/v1/object/public/midias/c1/1760000000000-capa.png";

describe("ehUrlImagemGrupo", () => {
  it("aceita só imagem do bucket `midias` do nosso Supabase", () => {
    expect(ehUrlImagemGrupo(URL_OK)).toBe(true);
    expect(ehUrlImagemGrupo("https://exemplo.supabase.co/storage/v1/object/public/midias/a.jpg?v=2")).toBe(true);
  });
  it("recusa link de outro site, outro bucket, outro Supabase, a pasta vazia e caminho que sai de `midias/`", () => {
    for (const v of [
      "https://exemplo.com/a.jpg",
      "https://exemplo.supabase.co/storage/v1/object/public/outro/a.png",
      "https://outro.supabase.co/storage/v1/object/public/midias/a.png",
      "https://exemplo.supabase.co.evil.com/storage/v1/object/public/midias/a.png",
      "https://exemplo.supabase.co/storage/v1/object/public/midias/",
      "https://exemplo.supabase.co/storage/v1/object/public/midias/../outro/a.png",
      "https://exemplo.supabase.co/storage/v1/object/public/midias/%2e%2e/outro/a.png",
      "https://exemplo.supabase.co/storage/v1/object/public/midias/..%2Foutro%2Fa.png",
      "https://exemplo.supabase.co/storage/v1/object/public/midias/..\\outro\\a.png",
      "https://exemplo.supabase.co/storage/v1/object/sign/midias/a.png",
    ]) {
      expect(ehUrlImagemGrupo(v), v).toBe(false);
    }
  });
  it("sem NEXT_PUBLIC_SUPABASE_URL (ou sem https), nenhuma URL vale", () => {
    expect(prefixoMidias("https://exemplo.supabase.co/")).toBe("https://exemplo.supabase.co/storage/v1/object/public/midias/");
    expect(prefixoMidias("")).toBeNull();
    expect(prefixoMidias("http://127.0.0.1:54321")).toBeNull();
    expect(ehUrlImagemGrupo(URL_OK, null)).toBe(false);
    expect(ehUrlImagemGrupo(URL_OK, prefixoMidias("https://outro.supabase.co"))).toBe(false);
  });
  it("recusa http, data:, caminho relativo, vazio e não-string", () => {
    for (const v of ["http://exemplo.com/a.jpg", "data:image/png;base64,AAAA", "/midias/a.png", "", "   ", null, undefined, 42]) {
      expect(ehUrlImagemGrupo(v)).toBe(false);
    }
  });
  it("recusa host local/privado e usuário/senha (o Zapbot baixa a imagem: nunca sonda de SSRF)", () => {
    for (const v of ["https://localhost/a.png", "https://127.0.0.1/a.png", "https://10.0.0.5/a.png", "https://192.168.1.1/a.png", "https://[::1]/a.png", "https://[::ffff:127.0.0.1]/a.png", "https://x.internal/a.png", "https://u:s@exemplo.com/a.png"]) {
      expect(ehUrlImagemGrupo(v)).toBe(false);
    }
  });
  it("até 2048 caracteres", () => {
    const base = "https://exemplo.supabase.co/storage/v1/object/public/midias/";
    expect(ehUrlImagemGrupo(base + "a".repeat(2048 - base.length))).toBe(true);
    expect(ehUrlImagemGrupo(base + "a".repeat(2049 - base.length))).toBe(false);
  });
});

describe("lerImagemGrupoUrl (campo de formulário)", () => {
  it("vazio/nulo = null; URL válida = ela (aparada); outra coisa = inválida", () => {
    expect(lerImagemGrupoUrl(null)).toBeNull();
    expect(lerImagemGrupoUrl(undefined)).toBeNull();
    expect(lerImagemGrupoUrl("  ")).toBeNull();
    expect(lerImagemGrupoUrl(` ${URL_OK} `)).toBe(URL_OK);
    expect(lerImagemGrupoUrl("http://exemplo.com/a.png")).toBeUndefined();
    expect(lerImagemGrupoUrl(7)).toBeUndefined();
  });
});

describe("validarArquivoImagem", () => {
  it("só JPG e PNG, até 5 MB", () => {
    expect(validarArquivoImagem({ tipo: "image/png", tamanho: 1000 })).toBeNull();
    expect(validarArquivoImagem({ tipo: "image/jpeg", tamanho: 5 * 1024 * 1024 })).toBeNull();
    expect(validarArquivoImagem({ tipo: "image/webp", tamanho: 1000 })).toBe("Use uma imagem JPG ou PNG.");
    expect(validarArquivoImagem({ tipo: "image/gif", tamanho: 1000 })).toBe("Use uma imagem JPG ou PNG.");
    expect(validarArquivoImagem({ tipo: "image/png", tamanho: 5 * 1024 * 1024 + 1 })).toBe("Imagem acima de 5 MB.");
  });
});

describe("foto do grupo: o que o WhatsApp aceita (teste de 17/10/2026)", () => {
  it("lado menor de pelo menos 192 px (o WhatsApp recusou 188 px e aceitou 190 px)", () => {
    expect(validarDimensoesImagem({ largura: 192, altura: 192 })).toBeNull();
    expect(validarDimensoesImagem({ largura: 1280, altura: 720 })).toBeNull();
    expect(validarDimensoesImagem({ largura: 188, altura: 188 })).toMatch(/pequena demais \(188 × 188 px\).*192 × 192/);
    expect(validarDimensoesImagem({ largura: 1000, altura: 100 })).toMatch(/pequena demais/);
    expect(validarDimensoesImagem({ largura: 0, altura: 0 })).toBe("Não foi possível ler a imagem.");
  });

  it("recorta o centro em quadrado e sai com até 640 px (sem ampliar)", () => {
    expect(recorteFotoGrupo({ largura: 1280, altura: 720 })).toEqual({ sx: 280, sy: 0, lado: 720, saida: 640 });
    expect(recorteFotoGrupo({ largura: 300, altura: 500 })).toEqual({ sx: 0, sy: 100, lado: 300, saida: 300 });
    expect(recorteFotoGrupo({ largura: 640, altura: 640 })).toEqual({ sx: 0, sy: 0, lado: 640, saida: 640 });
    expect(recorteFotoGrupo({ largura: 201, altura: 200 })).toEqual({ sx: 0, sy: 0, lado: 200, saida: 200 });
  });

  it("nome do arquivo convertido termina em .jpg", () => {
    expect(nomeJpeg("capa.png")).toBe("capa.jpg");
    expect(nomeJpeg("foto.final.JPEG")).toBe("foto.final.jpg");
    expect(nomeJpeg("sem-extensao")).toBe("sem-extensao.jpg");
    expect(nomeJpeg(".png")).toBe("imagem.jpg");
  });

  it("a ajuda da tela diz a regra", () => {
    expect(AJUDA_IMAGEM_GRUPO).toContain("192 × 192 px");
    expect(AJUDA_IMAGEM_GRUPO).toContain("quadrado");
    expect(AJUDA_IMAGEM_GRUPO).toContain("JPG");
  });

  it("erros de imagem do Zapbot viram a regra clara; outros erros não", () => {
    expect(erroDaImagemNoZapbot("the given data is not a valid image")).toBe(ERRO_IMAGEM_RECUSADA);
    expect(erroDaImagemNoZapbot("formato de imagem não reconhecido; use JPEG ou PNG")).toBe(ERRO_IMAGEM_RECUSADA);
    expect(erroDaImagemNoZapbot("not connected")).toBeNull();
    expect(erroDaImagemNoZapbot("HTTP 500")).toBeNull();
  });

  it("falha ao baixar a imagem (status, tempo esgotado, 5xx) continua repetível", () => {
    expect(erroDaImagemNoZapbot("não foi possível ler a imagem: download media: status 503")).toBeNull();
    expect(erroDaImagemNoZapbot("não foi possível ler a imagem: download media: status 400")).toBeNull();
    expect(erroDaImagemNoZapbot("não foi possível ler a imagem: context deadline exceeded")).toBeNull();
    expect(erroDaImagemNoZapbot("não foi possível ler a imagem: timeout")).toBeNull();
    expect(erroDaImagemNoZapbot("não foi possível ler a imagem")).toBeNull();
  });
});

describe("tipo de execução `imagem` (Trocar imagem)", () => {
  it("entra no fim de TIPOS_EXECUCAO (os de antes na mesma ordem) e na massa", () => {
    expect(TIPOS_EXECUCAO.at(-1)).toBe("imagem");
    expect(TIPOS_EXECUCAO.slice(0, 15)).toEqual([
      "mensagem", "enquete", "nome", "descricao", "abrir", "fechar", "admin_add", "admin_remover", "redefinir_link",
      "configuracao", "remover_participantes", "desativar_comunidade", "atualizar_links", "mover_grupos", "privacidade_avancada",
    ]);
    expect(TIPOS_MASSA).toContain("imagem");
    expect(ROTULO_TIPO.imagem).toBe("Trocar imagem");
    expect(ROTULO_ACAO_TELA.imagem).toBe("Trocar imagem");
    expect(ICONE_ACAO.imagem).toBe("image");
    expect(conteudoInicial("imagem")).toEqual({ url: "" });
  });

  it("validarConteudo: URL obrigatória e https; nome do arquivo opcional até 200", () => {
    expect(validarConteudo("imagem", {})).toEqual({ ok: false, erro: "Escolha a imagem do grupo." });
    expect(validarConteudo("imagem", { url: "" })).toEqual({ ok: false, erro: "Escolha a imagem do grupo." });
    expect(validarConteudo("imagem", { url: "http://exemplo.com/a.png" })).toEqual({ ok: false, erro: "A imagem do grupo precisa ser enviada pelo Vórtex Grupo." });
    expect(validarConteudo("imagem", { url: "https://127.0.0.1/a.png" }).ok).toBe(false);
    expect(validarConteudo("imagem", { url: URL_OK })).toEqual({ ok: true, valor: { url: URL_OK, nome_arquivo: null } });
    expect(validarConteudo("imagem", { url: URL_OK, nome_arquivo: "capa.png", extra: 1 })).toEqual({ ok: true, valor: { url: URL_OK, nome_arquivo: "capa.png" } });
    expect(validarConteudo("imagem", { url: URL_OK, nome_arquivo: "a".repeat(201) }).ok).toBe(false);
  });

  it("resumo do cartão", () => {
    expect(resumoConteudo("imagem", { url: URL_OK, nome_arquivo: "capa.png" })).toBe("Imagem: capa.png");
    expect(resumoConteudo("imagem", { url: URL_OK })).toBe("Imagem: imagem");
  });
});

// Migração de verdade (todas, em ordem) num Postgres em memória.
describe("migração 20261017220000_imagem_grupo", () => {
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

  const definicao = async (nome: string) =>
    (await d.query<{ def: string }>("select pg_get_constraintdef(oid) as def from pg_constraint where conname = $1", [nome])).rows[0]?.def ?? "";
  const ANTES_EXECUCAO = [
    "mensagem", "enquete", "nome", "descricao", "abrir", "fechar", "admin_add", "admin_remover", "redefinir_link",
    "configuracao", "remover_participantes", "desativar_comunidade", "atualizar_links", "mover_grupos", "privacidade_avancada",
  ];
  const ANTES_AUTOMACAO = [
    "mensagem", "enquete", "nome", "descricao", "abrir", "fechar", "admin_add", "admin_remover", "redefinir_link",
    "remover_participante", "configuracao", "atualizar_links", "desativar_comunidade", "mover_grupos", "tag_condicional",
    "adicionar_tag", "remover_tag", "adicionar_blacklist", "remover_blacklist",
  ];

  it("checks de tipo: todos os valores de antes continuam e 'imagem' entra (execucoes, tarefas, automacao_acoes)", async () => {
    for (const nome of ["execucoes_tipo_check", "tarefas_tipo_check"]) {
      const def = await definicao(nome);
      for (const t of [...ANTES_EXECUCAO, "imagem"]) expect(def).toContain(`'${t}'`);
    }
    const auto = await definicao("automacao_acoes_tipo_check");
    for (const t of [...ANTES_AUTOMACAO, "imagem"]) expect(auto).toContain(`'${t}'`);
  });

  it("execução e tarefa do tipo imagem entram; tipo desconhecido continua recusado", async () => {
    const conexao = (await d.query<{ id: string }>("insert into conexoes (nome, webhook_secret, status, zapbot_token_enc) values ('n-img', 's', 'conectado', 'x') returning id")).rows[0].id;
    const camp = (await d.query<{ id: string }>("insert into campanhas (nome, slug, conexao_criadora_id) values ('img', 'img', $1) returning id", [conexao])).rows[0].id;
    const grupo = (await d.query<{ id: string }>("insert into grupos (campanha_id, conexao_id, group_id, nome, numero) values ($1, $2, 'g-img', 'G', 1) returning id", [camp, conexao])).rows[0].id;
    const exec = (await d.query<{ id: string }>("insert into execucoes (campanha_id, tipo, conteudo) values ($1, 'imagem', $2) returning id", [camp, { url: URL_OK }])).rows[0].id;
    await d.query("insert into tarefas (execucao_id, grupo_id, conexao_id, tipo) values ($1, $2, $3, 'imagem')", [exec, grupo, conexao]);
    await expect(d.query("insert into execucoes (campanha_id, tipo) values ($1, 'foto_qualquer')", [camp])).rejects.toThrow(/check/);
  });

  it("campanhas.imagem_grupo_url: nula por padrão (grupo nasce sem foto); só https e até 2048", async () => {
    const conexao = (await d.query<{ id: string }>("insert into conexoes (nome, webhook_secret, status, zapbot_token_enc) values ('n-img2', 's', 'conectado', 'x') returning id")).rows[0].id;
    const camp = (await d.query<{ id: string }>("insert into campanhas (nome, slug, conexao_criadora_id) values ('img2', 'img2', $1) returning id", [conexao])).rows[0].id;
    expect((await d.query("select imagem_grupo_url from campanhas where id = $1", [camp])).rows[0]).toEqual({ imagem_grupo_url: null });
    await d.query("update campanhas set imagem_grupo_url = $1 where id = $2", [URL_OK, camp]);
    await expect(d.query("update campanhas set imagem_grupo_url = 'http://x/a.png' where id = $1", [camp])).rejects.toThrow(/check/);
    await expect(d.query("update campanhas set imagem_grupo_url = $1 where id = $2", [`https://x/${"a".repeat(2048)}`, camp])).rejects.toThrow(/check/);
    await d.query("update campanhas set imagem_grupo_url = null where id = $1", [camp]);
  });
});

describe("erroDaImagemNoZapbot — 502 junto de 'not a valid image'", () => {
  it("continua definitivo mesmo com o status 502 na mensagem", () => {
    expect(erroDaImagemNoZapbot("Zapbot 502: the given data is not a valid image")).not.toBeNull();
  });
  it("falha ao baixar (503) segue repetível", () => {
    expect(erroDaImagemNoZapbot("não foi possível ler a imagem: download media: status 503")).toBeNull();
  });
});
