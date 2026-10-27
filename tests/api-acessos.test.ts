import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, filtro, type Chamada, type Resposta } from "./apoio/db-falso";
import { liberarTudo, SEM_PERMISSAO, usarMembro } from "./apoio/permissoes";

const h = vi.hoisted(() => ({ db: undefined as unknown, historico: vi.fn() }));
vi.mock("@/src/lib/permissoes", async () => (await import("./apoio/permissoes")).permissoesFalsas());
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => h.db }));
vi.mock("@/src/lib/supabase/usuario", () => ({ exigirUsuario: vi.fn(async () => ({ id: ATENDENTE })) }));
vi.mock("@/src/lib/historico", () => ({ registrarHistorico: h.historico }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { aprovarAcesso, gerarConviteChave, recusarAcesso, revogarAcesso, solicitarAcesso, verChaveAcesso } from "@/app/(painel)/api-externa/acessos-actions";
import {
  criarConvite,
  decidirAcesso,
  emitirChaveDoAcesso,
  FORMATO_TOKEN,
  hashDoToken,
  lerConvite,
  LIMITE_TENTATIVAS_HORA,
  MSG_ACESSO,
  solicitarAcessoPorConvite,
} from "@/src/lib/api/acessos";
import { autenticarApi } from "@/src/lib/api/auth";
import { FORMATO_CHAVE, hashDaChave, revogarChaveApi } from "@/src/lib/api/chaves";

const ATENDENTE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OUTRO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ADMIN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const MAE = "11111111-1111-4111-8111-111111111111";
const ACESSO = "22222222-2222-4222-8222-222222222222";
const FILHA_VELHA = "33333333-3333-4333-8333-333333333333";
const TOKEN = "A".repeat(43);
const AGORA = new Date("2026-10-17T12:00:00Z");
const FUTURO = "2026-10-20T12:00:00Z";
const PASSADO = "2026-10-17T11:59:59Z";

const MEMBRO = { papel: "membro" as const, permissoes: {} };

beforeEach(() => {
  vi.clearAllMocks();
  liberarTudo();
});

const ultimo = (chamadas: Chamada[], tabela: string, op: Chamada["op"]) => chamadas.filter((c) => c.tabela === tabela && c.op === op);

// ---------------------------------------------------------------------------------------------------------------
describe("convite: token só como hash, 7 dias, uso único", () => {
  it("criarConvite grava só o SHA-256 do token (256 bits, base64url) e a validade de 7 dias; só chave api ativa e não filha", async () => {
    const { db, chamadas } = dbFalso(() => ({ data: [{ id: MAE, nome: "Zapier" }] }));
    const r = await criarConvite(db, MAE, AGORA);
    if (!("token" in r)) throw new Error("esperava token");
    expect(r.token).toMatch(FORMATO_TOKEN);
    expect(Buffer.from(r.token, "base64url")).toHaveLength(32);
    expect(r.expiraEm).toBe("2026-10-24T12:00:00.000Z");
    const up = chamadas[0];
    expect(up.op).toBe("update");
    expect(up.dados).toEqual({ convite_hash: createHash("sha256").update(r.token).digest("hex"), convite_expira_em: r.expiraEm });
    expect(JSON.stringify(up.dados)).not.toContain(r.token);
    expect(filtro(up, "eq", "tipo")).toBe("api");
    expect(filtro(up, "is", "revogada_em")).toBeNull();
    expect(filtro(up, "is", "acesso_de")).toBeNull();
    // cada geração é um token novo (gerar de novo troca o hash = invalida o anterior)
    const r2 = await criarConvite(db, MAE, AGORA);
    expect("token" in r2 && r2.token).not.toBe(r.token);
  });

  it("chave revogada, filha ou inexistente: não gera", async () => {
    const { db } = dbFalso(() => ({ data: [] }));
    expect(await criarConvite(db, MAE, AGORA)).toEqual({ erro: MSG_ACESSO.naoCompartilhavel });
    const { db: db2, chamadas } = dbFalso();
    expect(await criarConvite(db2, "x", AGORA)).toEqual({ erro: MSG_ACESSO.naoCompartilhavel });
    expect(chamadas).toHaveLength(0);
  });

  it("lerConvite: procura pelo hash; vencido, inexistente e mal formado dão a mesma mensagem; chave revogada avisa", async () => {
    const linha = { id: MAE, nome: "Zapier", escopo: "envio", revogada_em: null, convite_expira_em: FUTURO };
    const { db, chamadas } = dbFalso(() => ({ data: linha }));
    const ok = await lerConvite(db, TOKEN, AGORA);
    expect("convite" in ok && ok.convite.nome).toBe("Zapier");
    expect(filtro(chamadas[0], "eq", "convite_hash")).toBe(hashDoToken(TOKEN));

    expect(await lerConvite(dbFalso(() => ({ data: { ...linha, convite_expira_em: PASSADO } })).db, TOKEN, AGORA)).toEqual({ erro: "Link inválido ou expirado." });
    expect(await lerConvite(dbFalso(() => ({ data: null })).db, TOKEN, AGORA)).toEqual({ erro: "Link inválido ou expirado." });
    expect(await lerConvite(dbFalso(() => ({ data: { ...linha, revogada_em: PASSADO } })).db, TOKEN, AGORA)).toEqual({ erro: "Esta chave foi revogada." });
    const vazio = dbFalso(() => ({ data: linha }));
    for (const t of ["curto", `${TOKEN}=`, "A".repeat(42) + "/", null]) expect(await lerConvite(vazio.db, t, AGORA)).toEqual({ erro: "Link inválido ou expirado." });
    expect(vazio.chamadas).toHaveLength(0);
  });

  it("pedido: grava só quem pediu e o motivo, como 'aguardando', e apaga o hash (uso único, só se ainda for o mesmo)", async () => {
    const { db, chamadas } = dbFalso((c): Resposta => {
      if (c.tabela === "api_chaves" && c.op === "select") return { data: { id: MAE, nome: "Zapier", escopo: "envio", revogada_em: null, convite_expira_em: FUTURO } };
      if (c.tabela === "api_acessos" && c.op === "select") return { data: [] };
      if (c.tabela === "api_chaves" && c.op === "update") return { data: [{ id: MAE }] };
      if (c.tabela === "api_acessos" && c.op === "insert") return { data: { id: ACESSO } };
      return {};
    });
    const r = await solicitarAcessoPorConvite(db, { token: TOKEN, solicitante: ATENDENTE, motivo: "  atendimento  " }, AGORA);
    expect(r).toEqual({ id: ACESSO, chaveId: MAE, chaveNome: "Zapier" });
    const usar = ultimo(chamadas, "api_chaves", "update")[0];
    expect(usar.dados).toEqual({ convite_hash: null, convite_expira_em: null });
    expect(filtro(usar, "eq", "convite_hash")).toBe(hashDoToken(TOKEN));
    expect(ultimo(chamadas, "api_acessos", "insert")[0].dados).toEqual({ chave_id: MAE, solicitante: ATENDENTE, motivo: "atendimento", status: "aguardando" });
    // nada utilizável: nenhuma chave criada
    expect(ultimo(chamadas, "api_chaves", "insert")).toHaveLength(0);
  });

  it("link já usado por outro pedido (o hash sumiu no meio): 'Link inválido ou expirado.' e nada é gravado", async () => {
    const { db, chamadas } = dbFalso((c): Resposta => {
      if (c.tabela === "api_chaves" && c.op === "select") return { data: { id: MAE, nome: "Zapier", escopo: "envio", revogada_em: null, convite_expira_em: FUTURO } };
      if (c.tabela === "api_acessos" && c.op === "select") return { data: [] };
      if (c.tabela === "api_chaves" && c.op === "update") return { data: [] };
      return {};
    });
    expect(await solicitarAcessoPorConvite(db, { token: TOKEN, solicitante: ATENDENTE, motivo: "" }, AGORA)).toEqual({ erro: "Link inválido ou expirado." });
    expect(ultimo(chamadas, "api_acessos", "insert")).toHaveLength(0);
  });

  it("pedido duplicado (aguardando ou aprovado) é recusado sem gastar o link; corrida pega no índice único (23505) e devolve o link", async () => {
    const convite = { id: MAE, nome: "Zapier", escopo: "envio", revogada_em: null, convite_expira_em: FUTURO };
    const a = dbFalso((c): Resposta => {
      if (c.tabela === "api_chaves" && c.op === "select") return { data: convite };
      if (c.tabela === "api_acessos" && c.op === "select") return { data: [{ id: ACESSO }] };
      return {};
    });
    expect(await solicitarAcessoPorConvite(a.db, { token: TOKEN, solicitante: ATENDENTE, motivo: null }, AGORA)).toEqual({ erro: MSG_ACESSO.duplicado });
    expect(a.chamadas.filter((c) => c.op !== "select")).toHaveLength(0);
    expect(filtro(a.chamadas[1], "in", "status")).toEqual(["aguardando", "aprovado"]);

    const b = dbFalso((c): Resposta => {
      if (c.tabela === "api_chaves" && c.op === "select") return { data: convite };
      if (c.tabela === "api_acessos" && c.op === "select") return { data: [] };
      if (c.tabela === "api_chaves" && c.op === "update") return { data: [{ id: MAE }] };
      if (c.tabela === "api_acessos" && c.op === "insert") return { error: { message: "duplicate", code: "23505" } };
      return {};
    });
    expect(await solicitarAcessoPorConvite(b.db, { token: TOKEN, solicitante: ATENDENTE, motivo: null }, AGORA)).toEqual({ erro: MSG_ACESSO.duplicado });
    const devolve = ultimo(b.chamadas, "api_chaves", "update")[1];
    expect(devolve.dados).toEqual({ convite_hash: hashDoToken(TOKEN), convite_expira_em: FUTURO });
    expect(filtro(devolve, "is", "convite_hash")).toBeNull();
  });

  it("motivo acima de 280 caracteres: recusado antes de olhar o link", async () => {
    const { db, chamadas } = dbFalso();
    expect(await solicitarAcessoPorConvite(db, { token: TOKEN, solicitante: ATENDENTE, motivo: "x".repeat(281) }, AGORA)).toEqual({ erro: "Motivo: até 280 caracteres." });
    expect(chamadas).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("ações: só Administrador decide; pedir e ver exigem membro", () => {
  it("gerar convite, aprovar, recusar e revogar: membro comum (mesmo com tudo 'editar') é recusado sem tocar no banco", async () => {
    const { db, chamadas } = dbFalso();
    h.db = db;
    usarMembro({ papel: "membro", permissoes: { webhooks: "editar" } });
    expect(await gerarConviteChave(MAE)).toEqual({ erro: SEM_PERMISSAO });
    expect(await aprovarAcesso(ACESSO)).toEqual({ erro: SEM_PERMISSAO });
    expect(await recusarAcesso(ACESSO)).toEqual({ erro: SEM_PERMISSAO });
    expect(await revogarAcesso(ACESSO)).toEqual({ erro: SEM_PERMISSAO });
    usarMembro(null);
    expect(await aprovarAcesso(ACESSO)).toEqual({ erro: SEM_PERMISSAO });
    expect(await solicitarAcesso(TOKEN, "")).toEqual({ erro: SEM_PERMISSAO });
    expect(await verChaveAcesso(ACESSO)).toEqual({ erro: SEM_PERMISSAO });
    expect(chamadas).toHaveLength(0);
  });

  it("Administrador gera o link /api-externa/acesso/{token}; o histórico não leva o token", async () => {
    h.db = dbFalso(() => ({ data: [{ id: MAE, nome: "Zapier" }] })).db;
    const r = await gerarConviteChave(MAE);
    expect(r.link).toMatch(/\/api-externa\/acesso\/[A-Za-z0-9_-]{43}$/);
    const token = r.link!.split("/").pop()!;
    expect(JSON.stringify(h.historico.mock.calls)).not.toContain(token);
  });

  it("Administrador aprova (aguardando → aprovado, com quem e quando) e registra no histórico", async () => {
    const { db, chamadas } = dbFalso((c): Resposta => {
      if (c.tabela === "api_acessos" && c.op === "select") return { data: { id: ACESSO, status: "aguardando", chave_id: MAE, solicitante: ATENDENTE } };
      if (c.tabela === "api_chaves" && c.op === "select") return { data: { nome: "Zapier", revogada_em: null } };
      if (c.op === "update") return { data: [{ id: ACESSO }] };
      return {};
    });
    h.db = db;
    expect(await aprovarAcesso(ACESSO)).toEqual({});
    const up = ultimo(chamadas, "api_acessos", "update")[0];
    expect(up.dados).toMatchObject({ status: "aprovado", decidido_por: ATENDENTE });
    expect(filtro(up, "eq", "status")).toBe("aguardando");
    // aprovar não cria chave nenhuma (o admin nunca vê a chave do atendente)
    expect(ultimo(chamadas, "api_chaves", "insert")).toHaveLength(0);
    expect(h.historico).toHaveBeenCalledTimes(1);
  });

  it("decidirAcesso: já decidido, pedido de chave revogada e transição inválida", async () => {
    const pedido = (status: string, revogada: string | null) =>
      dbFalso((c): Resposta => {
        if (c.tabela === "api_acessos" && c.op === "select") return { data: { id: ACESSO, status, chave_id: MAE, solicitante: ATENDENTE } };
        if (c.tabela === "api_chaves" && c.op === "select") return { data: { nome: "Zapier", revogada_em: revogada } };
        return { data: [{ id: ACESSO }] };
      }).db;
    expect(await decidirAcesso(pedido("recusado", null), { id: ACESSO, decisao: "aprovar", decididoPor: ADMIN })).toEqual({ erro: MSG_ACESSO.jaDecidido });
    expect(await decidirAcesso(pedido("aguardando", null), { id: ACESSO, decisao: "revogar", decididoPor: ADMIN })).toEqual({ erro: MSG_ACESSO.jaDecidido });
    expect(await decidirAcesso(pedido("aguardando", PASSADO), { id: ACESSO, decisao: "aprovar", decididoPor: ADMIN })).toEqual({ erro: MSG_ACESSO.chaveRevogada });
  });

  it("revogar o acesso revoga a chave do atendente naquela chave mãe", async () => {
    const { db, chamadas } = dbFalso((c): Resposta => {
      if (c.tabela === "api_acessos" && c.op === "select") return { data: { id: ACESSO, status: "aprovado", chave_id: MAE, solicitante: ATENDENTE } };
      if (c.tabela === "api_chaves" && c.op === "select") return { data: { nome: "Zapier", revogada_em: null } };
      return { data: [{ id: ACESSO }] };
    });
    expect(await decidirAcesso(db, { id: ACESSO, decisao: "revogar", decididoPor: ADMIN }, AGORA)).toMatchObject({ ok: true });
    const rev = ultimo(chamadas, "api_chaves", "update")[0];
    expect(rev.dados).toEqual({ revogada_em: AGORA.toISOString() });
    expect(filtro(rev, "eq", "acesso_de")).toBe(MAE);
    expect(filtro(rev, "eq", "criada_por")).toBe(ATENDENTE);
  });

  it("revogar também revoga a chave emitida pelo id (mesmo se o criador já não existir)", async () => {
    const { db, chamadas } = dbFalso((c): Resposta => {
      if (c.tabela === "api_acessos" && c.op === "select") return { data: { id: ACESSO, status: "aprovado", chave_id: MAE, solicitante: ATENDENTE, chave_emitida_id: FILHA_VELHA } };
      if (c.tabela === "api_chaves" && c.op === "select") return { data: { nome: "Zapier", revogada_em: null } };
      return { data: [{ id: ACESSO }] };
    });
    expect(await decidirAcesso(db, { id: ACESSO, decisao: "revogar", decididoPor: ADMIN }, AGORA)).toMatchObject({ ok: true });
    const ups = ultimo(chamadas, "api_chaves", "update");
    const porId = ups.find((c) => filtro(c, "eq", "id") === FILHA_VELHA);
    expect(porId?.dados).toEqual({ revogada_em: AGORA.toISOString() });
    // erro ao revogar a emitida aparece pro admin
    const falha = dbFalso((c): Resposta => {
      if (c.tabela === "api_acessos" && c.op === "select") return { data: { id: ACESSO, status: "aprovado", chave_id: MAE, solicitante: ATENDENTE, chave_emitida_id: FILHA_VELHA } };
      if (c.tabela === "api_chaves" && c.op === "select") return { data: { nome: "Zapier", revogada_em: null } };
      if (c.tabela === "api_chaves" && c.op === "update" && filtro(c, "eq", "id") === FILHA_VELHA) return { error: { message: "x" } };
      return { data: [{ id: ACESSO }] };
    });
    expect(await decidirAcesso(falha.db, { id: ACESSO, decisao: "revogar", decididoPor: ADMIN }, AGORA)).toHaveProperty("erro");
  });

  it("limite de tentativas por hora no pedido: acima de 20 recusa sem ler o link; erro do contador fecha", async () => {
    usarMembro(MEMBRO);
    const a = dbFalso((c) => (c.tabela === "rpc:api_acesso_tentativa" ? { data: LIMITE_TENTATIVAS_HORA + 1 } : {}));
    h.db = a.db;
    expect(await solicitarAcesso(TOKEN, "")).toEqual({ erro: MSG_ACESSO.muitasTentativas });
    expect(a.chamadas.map((c) => c.tabela)).toEqual(["rpc:api_acesso_tentativa"]);
    expect(a.chamadas[0].dados).toEqual({ p_usuario: ATENDENTE });
    h.db = dbFalso((c) => (c.tabela === "rpc:api_acesso_tentativa" ? { error: { message: "x" } } : {})).db;
    expect(await solicitarAcesso(TOKEN, "")).toEqual({ erro: MSG_ACESSO.indisponivel });
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("chave filha: vista uma vez, só pelo atendente", () => {
  function banco(acesso: Record<string, unknown> | null, mae: Record<string, unknown> | null = { nome: "Zapier", escopo: "envio", tipo: "api", revogada_em: null }) {
    return dbFalso((c): Resposta => {
      if (c.tabela === "api_acessos" && c.op === "select") return { data: acesso };
      if (c.tabela === "api_chaves" && c.op === "select") return { data: mae };
      if (c.tabela === "api_chaves" && c.op === "insert") return { data: { id: "filha-nova" } };
      if (c.tabela === "api_acessos" && c.op === "update") return { data: [{ id: ACESSO }] };
      return {};
    });
  }
  const aprovado = { id: ACESSO, status: "aprovado", chave_id: MAE, solicitante: ATENDENTE, chave_emitida_id: null };

  it("nasce no clique: mesmo escopo e tipo da mãe, criada_por = atendente, acesso_de = mãe; banco só com hash", async () => {
    const { db, chamadas } = banco(aprovado);
    const r = await emitirChaveDoAcesso(db, { id: ACESSO, solicitante: ATENDENTE }, AGORA);
    if (!("chave" in r)) throw new Error(JSON.stringify(r));
    expect(r.chave).toMatch(FORMATO_CHAVE);
    expect(r.regenerada).toBe(false);
    const ins = ultimo(chamadas, "api_chaves", "insert")[0];
    expect(ins.dados).toMatchObject({ escopo: "envio", tipo: "api", criada_por: ATENDENTE, acesso_de: MAE, hash: hashDaChave(r.chave) });
    expect(JSON.stringify(chamadas.map((c) => c.dados))).not.toContain(r.chave);
    const marca = ultimo(chamadas, "api_acessos", "update")[0];
    expect(marca.dados).toEqual({ chave_emitida_id: "filha-nova" });
    expect(filtro(marca, "is", "chave_emitida_id")).toBeNull();
    expect(filtro(marca, "eq", "status")).toBe("aprovado");
  });

  it("'Gerar de novo': revoga a anterior antes de criar e só grava se ninguém trocou no meio", async () => {
    const { db, chamadas } = banco({ ...aprovado, chave_emitida_id: FILHA_VELHA });
    const r = await emitirChaveDoAcesso(db, { id: ACESSO, solicitante: ATENDENTE }, AGORA);
    expect("chave" in r && r.regenerada).toBe(true);
    const ups = ultimo(chamadas, "api_chaves", "update");
    expect(ups[0].dados).toEqual({ revogada_em: AGORA.toISOString() });
    expect(filtro(ups[0], "eq", "acesso_de")).toBe(MAE);
    expect(filtro(ups[0], "eq", "criada_por")).toBe(ATENDENTE);
    expect(chamadas.indexOf(ups[0])).toBeLessThan(chamadas.findIndex((c) => c.op === "insert"));
    expect(filtro(ultimo(chamadas, "api_acessos", "update")[0], "eq", "chave_emitida_id")).toBe(FILHA_VELHA);
  });

  it("pedido de outra pessoa = 'não encontrado'; não aprovado ou mãe revogada: nada é criado", async () => {
    for (const [acesso, mae, erro] of [
      [{ ...aprovado, solicitante: OUTRO }, undefined, MSG_ACESSO.naoEncontrado],
      [null, undefined, MSG_ACESSO.naoEncontrado],
      [{ ...aprovado, status: "aguardando" }, undefined, MSG_ACESSO.naoAprovado],
      [{ ...aprovado, status: "revogado" }, undefined, MSG_ACESSO.naoAprovado],
      [aprovado, { nome: "Zapier", escopo: "envio", tipo: "api", revogada_em: PASSADO }, MSG_ACESSO.chaveRevogada],
    ] as const) {
      const { db, chamadas } = banco(acesso as never, mae as never);
      expect(await emitirChaveDoAcesso(db, { id: ACESSO, solicitante: ATENDENTE }, AGORA)).toEqual({ erro });
      expect(chamadas.filter((c) => c.op !== "select")).toHaveLength(0);
    }
  });

  it("corrida (pedido revogado ou outra chave gerada no meio): a nova é revogada na hora e nada volta", async () => {
    const { db, chamadas } = dbFalso((c): Resposta => {
      if (c.tabela === "api_acessos" && c.op === "select") return { data: aprovado };
      if (c.tabela === "api_chaves" && c.op === "select") return { data: { nome: "Zapier", escopo: "leitura", tipo: "api", revogada_em: null } };
      if (c.tabela === "api_chaves" && c.op === "insert") return { data: { id: "filha-nova" } };
      if (c.tabela === "api_acessos" && c.op === "update") return { data: [] };
      return {};
    });
    const r = await emitirChaveDoAcesso(db, { id: ACESSO, solicitante: ATENDENTE }, AGORA);
    expect("erro" in r).toBe(true);
    const ultimaRev = ultimo(chamadas, "api_chaves", "update").at(-1)!;
    expect(filtro(ultimaRev, "eq", "id")).toBe("filha-nova");
  });

  it("ação verChaveAcesso usa o usuário logado como dono e não põe a chave no histórico", async () => {
    usarMembro(MEMBRO);
    h.db = banco(aprovado).db;
    const r = await verChaveAcesso(ACESSO);
    expect(r.chave).toMatch(FORMATO_CHAVE);
    expect(JSON.stringify(h.historico.mock.calls)).not.toContain(r.chave!);
    h.db = banco({ ...aprovado, solicitante: OUTRO }).db;
    expect(await verChaveAcesso(ACESSO)).toEqual({ erro: MSG_ACESSO.naoEncontrado });
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("revogar a chave mãe derruba as filhas na API", () => {
  it("revogarChaveApi: revoga a mãe e apaga o convite, revoga as filhas, recusa aguardando e marca aprovados como revogados", async () => {
    const { db, chamadas } = dbFalso(() => ({ data: [{ id: MAE }] }));
    expect(await revogarChaveApi(db, MAE, ADMIN)).toEqual({ ok: true });
    expect(chamadas[0].dados).toMatchObject({ convite_hash: null, convite_expira_em: null });
    expect(filtro(chamadas[1], "eq", "acesso_de")).toBe(MAE);
    expect(chamadas[1].dados).toHaveProperty("revogada_em");
    expect(chamadas[2]).toMatchObject({ tabela: "api_acessos", dados: { status: "recusado", decidido_por: ADMIN } });
    expect(filtro(chamadas[2], "eq", "status")).toBe("aguardando");
    expect(chamadas[3]).toMatchObject({ tabela: "api_acessos", dados: { status: "revogado", decidido_por: ADMIN } });
    expect(filtro(chamadas[3], "eq", "status")).toBe("aprovado");
  });

  const CHAVE_FILHA = "vg_" + "F".repeat(8) + "f".repeat(32);
  const CHAVE_COMUM = "vg_" + "C".repeat(8) + "c".repeat(32);
  const req = (k: string) => new Request("https://x/api/v1/campanhas", { headers: { authorization: `Bearer ${k}` } });

  function bancoApi(maeRevogada: string | null | "sumiu") {
    return dbFalso((c): Resposta => {
      if (c.tabela === "rpc:api_registrar_uso") return { data: 1 };
      if (c.tabela !== "api_chaves") return {};
      const hash = filtro(c, "eq", "hash");
      if (hash === hashDaChave(CHAVE_FILHA)) return { data: { id: "f1", nome: "Zapier", escopo: "envio", tipo: "api", revogada_em: null, acesso_de: MAE } };
      if (hash === hashDaChave(CHAVE_COMUM)) return { data: { id: "k1", nome: "Make", escopo: "leitura", tipo: "api", revogada_em: null, acesso_de: null } };
      if (filtro(c, "eq", "id") === MAE) return { data: maeRevogada === "sumiu" ? null : { revogada_em: maeRevogada } };
      return {};
    });
  }

  it("filha com mãe ativa autentica; com mãe revogada (ou apagada) → 401", async () => {
    h.db = bancoApi(null).db;
    expect(await autenticarApi(req(CHAVE_FILHA), "envio")).toEqual({ chave: { id: "f1", nome: "Zapier", escopo: "envio", tipo: "api" } });
    h.db = bancoApi(PASSADO).db;
    expect((await autenticarApi(req(CHAVE_FILHA), "leitura")) as Response).toHaveProperty("status", 401);
    h.db = bancoApi("sumiu").db;
    expect((await autenticarApi(req(CHAVE_FILHA), "leitura")) as Response).toHaveProperty("status", 401);
  });

  it("regressão: chave comum autentica igual a antes, sem ler chave mãe", async () => {
    const { db, chamadas } = bancoApi(PASSADO);
    h.db = db;
    expect(await autenticarApi(req(CHAVE_COMUM), "leitura")).toEqual({ chave: { id: "k1", nome: "Make", escopo: "leitura", tipo: "api" } });
    expect(chamadas.filter((c) => c.tabela === "api_chaves")).toHaveLength(1);
    expect((await autenticarApi(req(CHAVE_COMUM), "envio")) as Response).toHaveProperty("status", 403);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("fronteira: a página do convite não é pública", () => {
  it("/api-externa/acesso/{token} e /api-externa/acesso passam pelo login do middleware", async () => {
    const { rotaPublica } = await import("@/middleware");
    expect(rotaPublica(`/api-externa/acesso/${TOKEN}`)).toBe(false);
    expect(rotaPublica("/api-externa/acesso")).toBe(false);
  });

  it("a página do convite pede no-referrer e não loga o token", () => {
    const pagina = readFileSync(path.resolve(__dirname, "../app/(painel)/api-externa/acesso/[token]/page.tsx"), "utf8");
    expect(pagina).toContain('referrer: "no-referrer"');
    for (const f of ["app/(painel)/api-externa/acesso/[token]/page.tsx", "app/(painel)/api-externa/acessos-actions.ts", "src/lib/api/acessos.ts"]) {
      expect(readFileSync(path.resolve(__dirname, "..", f), "utf8")).not.toMatch(/console\.(log|info|warn|error)/);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Migração de verdade (todas, em ordem) num Postgres em memória.
describe("migração 20261017200700_api_acessos", () => {
  let d: PGlite;
  const HASH = (s: string) => createHash("sha256").update(s).digest("hex");
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

  const chave = async (s: string, extra = "") =>
    (await d.query<{ id: string }>(`insert into api_chaves (nome, prefixo, hash, escopo${extra ? ", acesso_de" : ""}) values ('x', 'AbCd1234', $1, 'envio'${extra ? `, '${extra}'` : ""}) returning id`, [HASH(s)])).rows[0].id;

  it("regressão: chave como antes nasce sem convite e sem mãe", async () => {
    const id = await chave("velha");
    const r = await d.query("select convite_hash, convite_expira_em, acesso_de from api_chaves where id = $1", [id]);
    expect(r.rows[0]).toEqual({ convite_hash: null, convite_expira_em: null, acesso_de: null });
  });

  it("convite_hash: só SHA-256 hex e único; filha some junto com a mãe", async () => {
    const mae = await chave("mae");
    await expect(d.query("update api_chaves set convite_hash = 'token-em-texto' where id = $1", [mae])).rejects.toThrow(/check/);
    await d.query("update api_chaves set convite_hash = $2, convite_expira_em = now() + interval '7 days' where id = $1", [mae, HASH("t1")]);
    const outra = await chave("outra");
    await expect(d.query("update api_chaves set convite_hash = $2 where id = $1", [outra, HASH("t1")])).rejects.toThrow(/unique|duplicate/);
    const filha = await chave("filha", mae);
    await d.query("delete from api_chaves where id = $1", [mae]);
    expect((await d.query("select 1 from api_chaves where id = $1", [filha])).rows).toHaveLength(0);
  });

  it("api_acessos: um pedido vivo por atendente e chave; recusado libera novo; motivo até 280; status fechado", async () => {
    const mae = await chave("mae2");
    const pede = (status = "aguardando") => d.query("insert into api_acessos (chave_id, solicitante, status) values ($1, $2, $3) returning id", [mae, ATENDENTE, status]);
    const { rows } = await pede();
    await expect(pede()).rejects.toThrow(/api_acessos_vivo|duplicate/);
    await expect(pede("aprovado")).rejects.toThrow(/api_acessos_vivo|duplicate/);
    await d.query("update api_acessos set status = 'recusado' where id = $1", [(rows[0] as { id: string }).id]);
    await expect(pede()).resolves.toBeDefined();
    await expect(d.query("insert into api_acessos (chave_id, solicitante, motivo) values ($1, $2, $3)", [mae, OUTRO, "x".repeat(281)])).rejects.toThrow(/check/);
    await expect(d.query("insert into api_acessos (chave_id, solicitante, status) values ($1, $2, 'talvez')", [mae, OUTRO])).rejects.toThrow(/check/);
    const filha = await chave("filha2", mae);
    const { rows: [a] } = await d.query<{ id: string }>("insert into api_acessos (chave_id, solicitante, status, chave_emitida_id) values ($1, $2, 'aprovado', $3) returning id", [mae, OUTRO, filha]);
    await d.query("delete from api_chaves where id = $1", [filha]);
    expect((await d.query<{ chave_emitida_id: string | null }>("select chave_emitida_id from api_acessos where id = $1", [a.id])).rows[0].chave_emitida_id).toBeNull();
  });

  it("authenticated: não lê api_acessos, tentativas nem convite_hash; lê acesso_de; anon não lê nada", async () => {
    await d.query("set role authenticated");
    try {
      await expect(d.query("select id from api_acessos")).rejects.toThrow(/permission denied/);
      await expect(d.query("insert into api_acessos (chave_id, solicitante) values (gen_random_uuid(), gen_random_uuid())")).rejects.toThrow(/permission denied/);
      await expect(d.query("select * from api_acessos_tentativas")).rejects.toThrow(/permission denied/);
      await expect(d.query("select convite_hash from api_chaves")).rejects.toThrow(/permission denied/);
      await expect(d.query("update api_chaves set convite_hash = null")).rejects.toThrow(/permission denied/);
      await expect(d.query("select api_acesso_tentativa(gen_random_uuid())")).rejects.toThrow(/permission denied/);
      await d.query("select id, nome, prefixo, acesso_de, convite_expira_em from api_chaves");
    } finally {
      await d.query("reset role");
    }
    await d.query("set role anon");
    try {
      await expect(d.query("select id from api_acessos")).rejects.toThrow(/permission denied/);
      await expect(d.query("select id from api_chaves")).rejects.toThrow(/permission denied/);
      await expect(d.query("select * from api_acessos_tentativas")).rejects.toThrow(/permission denied/);
    } finally {
      await d.query("reset role");
    }
  });

  it("api_acesso_tentativa conexão por usuário e hora (service_role)", async () => {
    await d.query("set role service_role");
    try {
      const n = async (u: string) => (await d.query<{ n: number }>("select api_acesso_tentativa($1) as n", [u])).rows[0].n;
      expect(await n(ATENDENTE)).toBe(1);
      expect(await n(ATENDENTE)).toBe(2);
      expect(await n(OUTRO)).toBe(1);
    } finally {
      await d.query("reset role");
    }
  });
});
