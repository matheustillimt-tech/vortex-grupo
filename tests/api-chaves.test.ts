import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { criarChaveApi, FORMATO_CHAVE, gerarChave, hashDaChave, prefixoDaChave, revogarChaveApi } from "@/src/lib/api/chaves";
import { dbFalso, filtro } from "./apoio/db-falso";

describe("gerarChave / hash / prefixo", () => {
  it("vg_ + 40 base62, diferente a cada chamada", () => {
    const vistas = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const c = gerarChave();
      expect(c).toMatch(/^vg_[0-9A-Za-z]{40}$/);
      expect(FORMATO_CHAVE.test(c)).toBe(true);
      vistas.add(c);
    }
    expect(vistas.size).toBe(200);
  });

  it("prefixo = 8 primeiros depois de vg_; hash = SHA-256 hex da chave inteira", () => {
    const c = "vg_AbCd1234" + "x".repeat(32);
    expect(prefixoDaChave(c)).toBe("AbCd1234");
    expect(hashDaChave(c)).toBe(createHash("sha256").update(c).digest("hex"));
    expect(hashDaChave(c)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("criarChaveApi", () => {
  it("grava só prefixo e hash (nunca a chave em texto) e devolve { chave, id }", async () => {
    const { db, chamadas } = dbFalso((c) => (c.tabela === "api_chaves" && c.op === "insert" ? { data: { id: "k1" } } : {}));
    const r = await criarChaveApi(db, { nome: "  Zapier  ", escopo: "envio", tipo: "mcp", criadaPor: "u1" });
    if (!("chave" in r)) throw new Error("esperava chave");
    expect(r.id).toBe("k1");
    expect(r.chave).toMatch(FORMATO_CHAVE);
    const ins = chamadas.find((c) => c.op === "insert")!;
    expect(ins.dados).toEqual({ nome: "Zapier", escopo: "envio", tipo: "mcp", prefixo: prefixoDaChave(r.chave), hash: hashDaChave(r.chave), criada_por: "u1" });
    expect(JSON.stringify(ins.dados)).not.toContain(r.chave);
  });

  it("tipo padrão api; recusa nome vazio/longo e escopo/tipo desconhecido sem gravar", async () => {
    const { db, chamadas } = dbFalso((c) => (c.op === "insert" ? { data: { id: "k2" } } : {}));
    const ok = await criarChaveApi(db, { nome: "Make", escopo: "leitura", criadaPor: null });
    expect("chave" in ok).toBe(true);
    expect((chamadas[0].dados as { tipo: string }).tipo).toBe("api");
    expect(await criarChaveApi(db, { nome: " ", escopo: "leitura", criadaPor: null })).toEqual({ erro: "Nome da chave: de 1 a 60 caracteres." });
    expect(await criarChaveApi(db, { nome: "x".repeat(61), escopo: "leitura", criadaPor: null })).toEqual({ erro: "Nome da chave: de 1 a 60 caracteres." });
    expect(await criarChaveApi(db, { nome: "x", escopo: "admin" as never, criadaPor: null })).toEqual({ erro: "Escopo inválido." });
    expect(await criarChaveApi(db, { nome: "x", escopo: "envio", tipo: "zap" as never, criadaPor: null })).toEqual({ erro: "Tipo de chave inválido." });
    expect(chamadas).toHaveLength(1);
  });

  it("erro do banco vira erro amigável", async () => {
    const { db } = dbFalso(() => ({ error: { message: "duplicate" } }));
    expect(await criarChaveApi(db, { nome: "x", escopo: "envio", criadaPor: null })).toEqual({ erro: "Não foi possível criar a chave." });
  });
});

const UUID_1 = "11111111-1111-1111-1111-111111111111";

describe("revogarChaveApi", () => {
  it("marca revogada_em só se ainda não estava revogada", async () => {
    const { db, chamadas } = dbFalso(() => ({ data: [{ id: UUID_1 }] }));
    expect(await revogarChaveApi(db, UUID_1)).toEqual({ ok: true });
    const c = chamadas[0];
    expect(c.op).toBe("update");
    expect(typeof (c.dados as { revogada_em: string }).revogada_em).toBe("string");
    expect(filtro(c, "eq", "id")).toBe(UUID_1);
    expect(filtro(c, "is", "revogada_em")).toBeNull();
  });

  it("id que não é UUID: erro sem tocar no banco", async () => {
    const { db, chamadas } = dbFalso(() => ({ data: [{ id: UUID_1 }] }));
    expect(await revogarChaveApi(db, "não-é-uuid")).toEqual({ erro: "Chave inválida." });
    expect(chamadas).toHaveLength(0);
  });

  it("nenhuma linha afetada (inexistente ou já revogada): erro", async () => {
    const { db } = dbFalso(() => ({ data: [] }));
    expect(await revogarChaveApi(db, UUID_1)).toEqual({ erro: "Chave não encontrada ou já revogada." });
  });

  it("erro do banco vira erro amigável", async () => {
    const { db } = dbFalso(() => ({ error: { message: "fora" } }));
    expect(await revogarChaveApi(db, UUID_1)).toEqual({ erro: "Não foi possível revogar a chave." });
  });
});
