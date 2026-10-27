import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, filtro, type Chamada, type Resposta } from "./apoio/db-falso";
import { liberarTudo, usarMembro } from "./apoio/permissoes";

const h = vi.hoisted(() => ({ db: undefined as unknown, participantes: vi.fn(async () => undefined), alertar: vi.fn(async () => undefined) }));
vi.mock("@/src/lib/permissoes", async () => (await import("./apoio/permissoes")).permissoesFalsas());
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => h.db }));
vi.mock("@/src/lib/supabase/usuario", () => ({ exigirUsuario: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/src/lib/historico", () => ({ registrarHistorico: vi.fn() }));
vi.mock("@/src/lib/jobs/alertas", () => ({ alertar: h.alertar }));
vi.mock("@/src/lib/jobs/grupo-novo", () => ({ criarGatilhosGrupoNovo: vi.fn(async () => 0) }));
vi.mock("@/src/lib/conexoes", () => ({ paraZapbot: vi.fn((c: { id: string }) => ({ id: c.id, token: "t", clientToken: "c" })), credenciais: vi.fn(async () => ({ id: "x", token: "t", clientToken: "c" })) }));
vi.mock("@/src/lib/zapbot/client", async (orig) => ({ ...(await orig<typeof import("@/src/lib/zapbot/client")>()), zapbot: () => ({ participantes: h.participantes }) }));

import { adicionarAdministrativo, excluirAdministrativos, importarAdministrativos } from "@/app/(painel)/anti-spam/actions";
import { telefonesProtegidos } from "@/src/lib/automacoes";
import { bloquearTelefones } from "@/src/lib/bloqueio";
import { NOTA_NUMERO_ADMINISTRATIVO, NOTA_NUMERO_CONECTADO, processarAcoes } from "@/src/lib/jobs/acoes";
import { tratarRodada } from "@/src/lib/jobs/pessoas";
import {
  filtrarAdministrativos,
  lerCsvAdministrativos,
  ordenarAdministrativos,
  resumoCsvAdministrativos,
  textoNumeroAdministrativo,
} from "@/src/lib/regras/administrativos";

const ADMIN = "5511" + "977776666";
const CONECTADO = "5537" + "900000001";

beforeEach(() => {
  vi.clearAllMocks();
  liberarTudo();
});

describe("regras: CSV e ordenação", () => {
  it("CSV nome,telefone com cabeçalho, linhas inválidas, repetido (com e sem o 9) e vazias", () => {
    const csv = "﻿nome,telefone\nAna,(11) " + "97777-6666\nBruno;11 7777-6666\nCarla,123\n\nDiego,\"55 37 " + "98000-1001\"\n,11" + "988887777\nsem número,\n";
    const r = lerCsvAdministrativos(csv);
    expect(r.validos).toEqual([
      { telefone: "5511" + "977776666", nome: "Ana" },
      { telefone: "5537" + "980001001", nome: "Diego" },
      { telefone: "5511" + "988887777", nome: null },
    ]);
    // "Bruno" é o mesmo número da Ana sem o 9 (vale um só); "123" é inválido.
    expect(r.invalidos).toEqual(["123"]);
    expect(resumoCsvAdministrativos({ adicionados: 3, invalidos: 1, jaExistiam: 0 })).toBe("3 adicionados, 1 inválidos, 0 já existiam");
  });

  it("CSV sem cabeçalho vale nome,telefone; cabeçalho invertido decide a ordem; uma coluna = só telefone", () => {
    expect(lerCsvAdministrativos("Ana;11" + "977776666").validos).toEqual([{ telefone: "5511" + "977776666", nome: "Ana" }]);
    expect(lerCsvAdministrativos("Telefone;Nome\n11" + "977776666;Ana").validos).toEqual([{ telefone: "5511" + "977776666", nome: "Ana" }]);
    expect(lerCsvAdministrativos("11" + "977776666").validos).toEqual([{ telefone: "5511" + "977776666", nome: null }]);
  });

  it("Ordenação Alfabética: nome A→Z sem acento/maiúscula, sem nome no fim, empate por telefone; Data de criação: mais novos primeiro", () => {
    const l = [
      { telefone: "5511" + "900000003", nome: null, created_at: "2026-10-03T00:00:00Z" },
      { telefone: "5511" + "900000002", nome: "bruno", created_at: "2026-10-01T00:00:00Z" },
      { telefone: "5511" + "900000001", nome: "Álvaro", created_at: "2026-10-02T00:00:00Z" },
      { telefone: "5511" + "900000000", nome: "Bruno", created_at: "2026-10-02T00:00:00Z" },
      { telefone: "5511" + "900000004", nome: "  ", created_at: "2026-10-04T00:00:00Z" },
    ];
    expect(ordenarAdministrativos(l, "alfabetica").map((x) => x.telefone)).toEqual(["5511" + "900000001", "5511" + "900000000", "5511" + "900000002", "5511" + "900000003", "5511" + "900000004"]);
    expect(ordenarAdministrativos(l, "criacao").map((x) => x.telefone)).toEqual(["5511" + "900000004", "5511" + "900000003", "5511" + "900000000", "5511" + "900000001", "5511" + "900000002"]);
    expect(filtrarAdministrativos(l, "alva").map((x) => x.telefone)).toEqual(["5511" + "900000001"]);
    expect(filtrarAdministrativos(l, "0000002").map((x) => x.telefone)).toEqual(["5511" + "900000002"]);
  });
});

describe("telefonesProtegidos", () => {
  it("conectados + administrativos (nas duas formas do 9); tabela vazia = só os conectados, como hoje", async () => {
    const com = dbFalso((c) =>
      c.tabela === "conexoes" ? { data: [{ telefone: CONECTADO }] } : c.tabela === "numeros_administrativos" ? { data: [{ telefone: ADMIN }] } : {},
    );
    expect([...(await telefonesProtegidos(com.db))].sort()).toEqual(["551177776666", ADMIN, "553700000001", CONECTADO].sort());
    const sem = dbFalso((c) => (c.tabela === "conexoes" ? { data: [{ telefone: CONECTADO }] } : { data: [] }));
    expect([...(await telefonesProtegidos(sem.db))].sort()).toEqual(["553700000001", CONECTADO].sort());
  });
});

describe("bloquearTelefones recusa número administrativo", () => {
  it("vai em `administrativos`, não grava nem enfileira; o resto segue", async () => {
    const { db, chamadas } = dbFalso((c) => {
      if (c.tabela === "conexoes") return { data: [{ telefone: CONECTADO }] };
      if (c.tabela === "numeros_administrativos") return { data: [{ telefone: "551177776666" }] };
      if (c.tabela === "participantes") return { data: [] };
      return { data: [] };
    });
    const r = await bloquearTelefones(db, [{ telefone: ADMIN, motivo: null }, { telefone: "5511" + "988887777", motivo: null }], "manual", "u1");
    expect(r).toEqual({ novos: 1, jaEstavam: 0, remocoes: 0, ignorados: [], administrativos: [ADMIN] });
    const up = chamadas.find((c) => c.tabela === "bloqueados" && c.op === "upsert")!;
    expect((up.dados as { telefone: string }[]).map((x) => x.telefone)).toEqual(["5511" + "988887777"]);
    expect(textoNumeroAdministrativo("55 11 " + "97777-6666")).toBe("55 11 " + "97777-6666 é um número administrativo");
  });

  it("regressão: sem administrativos o resultado tem o formato de antes", async () => {
    const { db } = dbFalso((c) => (c.tabela === "conexoes" ? { data: [{ telefone: CONECTADO }] } : { data: [] }));
    expect(await bloquearTelefones(db, [{ telefone: "5511" + "988887777", motivo: null }], "manual", null)).toEqual({ novos: 1, jaEstavam: 0, remocoes: 0, ignorados: [] });
  });
});

describe("protegido nunca removido", () => {
  it("conferência: administrativo bloqueado e duplicado não entra na fila", async () => {
    const { db, chamadas } = dbFalso((c) => {
      if (c.tabela === "bloqueados_efetivos") return { data: [{ telefone: ADMIN }] };
      if (c.tabela === "participantes") return { data: [{ telefone: ADMIN, grupo_id: "g2" }] };
      if (c.op === "select") return { data: [] };
      return {};
    });
    const protegidos = [...(await telefonesProtegidos(dbFalso((c) => (c.tabela === "numeros_administrativos" ? { data: [{ telefone: ADMIN }] } : { data: [] })).db))];
    const plano = await tratarRodada(db, {
      grupoId: "g1", grupoNome: "G", campanhaId: "c1", campanhaNome: "C", entraram: [{ telefone: ADMIN, admin: false }], sairam: [], protegidos, agora: "2026-10-17T12:00:00.000Z",
    });
    expect(plano.removerBloqueio).toEqual([]);
    expect(plano.removerDuplicado).toEqual([]);
    expect(chamadas.some((c) => c.tabela === "acoes" && c.op === "insert")).toBe(false);
  });

  it("na hora de remover: administrativo não é removido (qualquer origem), com nota própria; conectado continua com a nota de sempre", async () => {
    for (const origem of ["bloqueado", "duplicado", "campanha_anterior", "massa", "venda hotmart"]) {
      h.participantes.mockClear();
      const { db, chamadas } = dbFalso((c) => {
        if (c.tabela === "rpc:pegar_acoes") return { data: [{ id: "a1", tipo: "remover", campanha_id: "c1", grupo_id: "g1", telefone: "551177776666", dados: {}, tentativas: 1, origem }] };
        if (c.tabela === "numeros_administrativos") return { data: [{ telefone: ADMIN }] };
        if (c.tabela === "conexoes") return { data: [] };
        if (c.tabela === "participantes" && c.op === "select") return { data: [{ admin: false }] };
        if (c.tabela === "grupos") return { data: { group_id: "120@g.us", conexao_id: "x" } };
        return { data: [] };
      });
      h.db = db;
      await processarAcoes({ ate: Date.now() + 55_000 });
      expect(h.participantes).not.toHaveBeenCalled();
      expect(chamadas.find((c) => c.tabela === "acoes" && c.op === "update")!.dados).toMatchObject({ status: "ok", erro: NOTA_NUMERO_ADMINISTRATIVO });
    }
    const { db, chamadas } = dbFalso((c) => {
      if (c.tabela === "rpc:pegar_acoes") return { data: [{ id: "a1", tipo: "remover", campanha_id: "c1", grupo_id: "g1", telefone: CONECTADO, dados: {}, tentativas: 1, origem: "bloqueado" }] };
      if (c.tabela === "conexoes") return { data: [{ telefone: CONECTADO }] };
      return { data: [] };
    });
    h.db = db;
    await processarAcoes({ ate: Date.now() + 55_000 });
    expect(chamadas.find((c) => c.tabela === "acoes" && c.op === "update")!.dados).toMatchObject({ erro: NOTA_NUMERO_CONECTADO });
  });

  it("regressão: sem administrativos, a remoção de bloqueado acontece como hoje", async () => {
    const { db, chamadas } = dbFalso((c) => {
      if (c.tabela === "rpc:pegar_acoes") return { data: [{ id: "a1", tipo: "remover", campanha_id: "c1", grupo_id: "g1", telefone: "553711110001", dados: {}, tentativas: 1, origem: "bloqueado" }] };
      if (c.tabela === "grupos") return { data: { group_id: "120@g.us", conexao_id: "x" } };
      if (c.tabela === "participantes" && c.op === "select") return { data: [{ admin: false }] };
      if (c.tabela === "bloqueados_efetivos") return { data: [{ telefone: "553711110001" }] };
      if (c.tabela === "conexoes") return { data: [] };
      return {};
    });
    h.db = db;
    await processarAcoes({ ate: Date.now() + 55_000 });
    expect(h.participantes).toHaveBeenCalledTimes(1);
    expect(chamadas.find((c) => c.tabela === "acoes" && c.op === "update")!.dados).toMatchObject({ status: "ok", erro: null });
  });
});

function usar(responder?: (c: Chamada) => Resposta) {
  const f = dbFalso(responder);
  h.db = f.db;
  return f.chamadas;
}

describe("actions: Números administrativos", () => {
  it("adicionar: valida, recusa repetido (com ou sem o 9) e grava", async () => {
    usar();
    expect((await adicionarAdministrativo(" ", "11" + "977776666")).erro).toBeTruthy();
    expect((await adicionarAdministrativo("Ana", "12")).erro).toBe("Telefone inválido.");
    let chamadas = usar((c) => (c.tabela === "numeros_administrativos" && c.op === "select" ? { data: [{ telefone: "551177776666" }] } : {}));
    expect((await adicionarAdministrativo("Ana", "11" + "977776666")).erro).toBe("Esse número já é administrativo.");
    expect(chamadas.some((c) => c.op === "insert")).toBe(false);
    chamadas = usar((c) => (c.op === "select" ? { data: [] } : {}));
    expect(await adicionarAdministrativo(" Ana ", "(11) " + "97777-6666")).toEqual({});
    expect(chamadas.find((c) => c.op === "insert")!.dados).toEqual({ telefone: ADMIN, nome: "Ana", criado_por: "u1" });
  });

  it("CSV: resumo N adicionados, M inválidos, K já existiam", async () => {
    const chamadas = usar((c) => (c.tabela === "numeros_administrativos" && c.op === "select" ? { data: [{ telefone: "5511" + "988887777" }] } : {}));
    const r = await importarAdministrativos("nome;telefone\nAna;11" + "977776666\nBia;11" + "988887777\nCadu;99\n");
    expect(r).toEqual({ resumo: "1 adicionados, 1 inválidos, 1 já existiam" });
    expect(chamadas.find((c) => c.op === "upsert")!.dados).toEqual([{ telefone: ADMIN, nome: "Ana", criado_por: "u1" }]);
  });

  it("CSV acima de 5000 linhas é recusado", async () => {
    usar();
    const texto = Array.from({ length: 5002 }, (_, i) => `n;1199${String(i).padStart(7, "0")}`).join("\n");
    expect((await importarAdministrativos(texto)).erro).toBe("No máximo 5000 linhas por vez.");
  });

  it("excluir em massa só aceita telefones de 11 a 15 dígitos", async () => {
    const chamadas = usar();
    expect(await excluirAdministrativos([ADMIN, "abc", ADMIN])).toEqual({ excluidos: 1 });
    expect(filtro(chamadas.find((c) => c.op === "delete")!, "in", "telefone")).toEqual([ADMIN]);
  });

  it("sem antispam/editar nada é gravado", async () => {
    const chamadas = usar();
    usarMembro({ papel: "membro", permissoes: { antispam: "ver" } });
    expect((await adicionarAdministrativo("Ana", "11" + "977776666")).erro).toBeTruthy();
    expect((await importarAdministrativos("Ana;11" + "977776666")).erro).toBeTruthy();
    expect((await excluirAdministrativos([ADMIN])).erro).toBeTruthy();
    expect(chamadas).toEqual([]);
  });
});

// Migração de verdade (todas, em ordem) num Postgres em memória.
describe("migração 20261017200500_antispam_admin_lid", () => {
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

  it("numeros_administrativos: telefone de 11 a 15 dígitos, nome até 80; anon não enxerga", async () => {
    await d.query("insert into numeros_administrativos (telefone, nome) values ('5511" + "977776666', 'Ana')");
    await expect(d.query("insert into numeros_administrativos (telefone) values ('5511" + "977776666')")).rejects.toThrow(/pkey/);
    await expect(d.query("insert into numeros_administrativos (telefone) values ('+5511" + "977776666')")).rejects.toThrow(/check/);
    await expect(d.query("insert into numeros_administrativos (telefone, nome) values ('5511" + "977776667', $1)", ["x".repeat(81)])).rejects.toThrow(/check/);
    await d.query("set role authenticated");
    try {
      const r = await d.query<{ n: number }>("select count(*)::int as n from numeros_administrativos");
      expect(r.rows[0].n).toBe(1);
    } finally {
      await d.query("reset role");
    }
    await d.query("set role anon");
    try {
      await expect(d.query("select * from numeros_administrativos")).rejects.toThrow(/permission denied/);
    } finally {
      await d.query("reset role");
    }
  });

  it("bloqueados: linhas antigas ficam lid null e golpista false; lid só dígitos e único", async () => {
    await d.query("insert into bloqueados (telefone, origem) values ('5511" + "900000001', 'manual')");
    const r = await d.query<{ lid: string | null; golpista: boolean; denunciado_em: string | null }>("select lid, golpista, denunciado_em from bloqueados where telefone = '5511" + "900000001'");
    expect(r.rows[0]).toEqual({ lid: null, golpista: false, denunciado_em: null });
    await d.query("insert into bloqueados (telefone, origem, lid) values ('5511" + "900000002', 'manual', '123456789012345')");
    await expect(d.query("insert into bloqueados (telefone, origem, lid) values ('5511" + "900000003', 'manual', '123456789012345')")).rejects.toThrow(/unique|duplicate/);
    await expect(d.query("insert into bloqueados (telefone, origem, lid) values ('5511" + "900000004', 'manual', '123@lid')")).rejects.toThrow(/check/);
  });

  it("acoes.tipo: os 3 de antes continuam e entram bloquear_contato/desbloquear_contato", async () => {
    const { rows } = await d.query<{ def: string }>("select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'acoes_tipo_check'");
    for (const t of ["criar_grupo", "remover", "entrar_grupo", "bloquear_contato", "desbloquear_contato"]) expect(rows[0].def).toContain(`'${t}'`);
    await d.query(`insert into acoes (tipo, dados) values ('bloquear_contato', '{"telefone":"5511${""}900000001","conexao_id":"x"}')`);
    await expect(d.query("insert into acoes (tipo) values ('denunciar')")).rejects.toThrow(/acoes_tipo_check/);
  });
});
