import { describe, expect, it } from "vitest";
import { dbFalso, filtro } from "./apoio/db-falso";
import { bloquearTelefones, desbloquearTelefone } from "@/src/lib/bloqueio";

function banco() {
  return dbFalso((c) => {
    if (c.tabela === "conexoes") return { data: [{ telefone: "5537" + "900000001" }] };
    if (c.tabela === "bloqueados" && c.op === "select") return { data: [{ telefone: "553780001001" }] };
    if (c.tabela === "participantes") return { data: [{ telefone: "5511" + "988887777", grupo_id: "g1", grupos: { campanha_id: "c1" } }] };
    return {};
  });
}

describe("bloquearTelefones", () => {
  it("grava só os novos, ignora número conectado e enfileira a remoção de quem está em grupo", async () => {
    const { db, chamadas } = banco();
    const r = await bloquearTelefones(db, [
      { telefone: "5537" + "980001001", motivo: null }, // já estava (pela variante sem 9)
      { telefone: "5511" + "988887777", motivo: "spam" },
      { telefone: "5537" + "900000001", motivo: null }, // número nosso
    ], "manual", "u1");
    expect(r).toEqual({ novos: 1, jaEstavam: 1, remocoes: 1, ignorados: ["5537" + "900000001"] });
    const up = chamadas.find((c) => c.tabela === "bloqueados" && c.op === "upsert")!;
    expect(up.dados).toEqual([{ telefone: "5511" + "988887777", motivo: "spam", origem: "manual", criado_por: "u1" }]);
    expect(chamadas.filter((c) => c.tabela === "acoes" && c.op === "insert").map((c) => c.dados)).toEqual([
      { tipo: "remover", campanha_id: "c1", grupo_id: "g1", telefone: "5511" + "988887777", origem: "bloqueado" },
    ]);
    const p = chamadas.find((c) => c.tabela === "participantes")!;
    expect(filtro(p, "eq", "admin")).toBe(false);
    expect(filtro(p, "eq", "grupos.ativo")).toBe(true);
  });

  it("lista vazia não toca no banco", async () => {
    const { db, chamadas } = banco();
    expect(await bloquearTelefones(db, [], "manual", null)).toEqual({ novos: 0, jaEstavam: 0, remocoes: 0, ignorados: [] });
    expect(chamadas).toEqual([]);
  });
});

describe("desbloquearTelefone", () => {
  it("apaga as duas variantes", async () => {
    const { db, chamadas } = dbFalso();
    await desbloquearTelefone(db, "5537" + "980001001");
    const d = chamadas.find((c) => c.op === "delete")!;
    expect(d.tabela).toBe("bloqueados");
    expect(filtro(d, "in", "telefone")).toEqual(["5537" + "980001001", "553780001001"]);
  });
});
