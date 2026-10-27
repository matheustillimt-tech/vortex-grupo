import { describe, expect, it, vi } from "vitest";
import { lerRecibo, processarEventoZapbot } from "@/src/lib/zapbot/evento";

function dbFalso() {
  // `update(...).eq(...)` (o update de sempre) e `update(...).eq(...).neq(...).select(...)` (o condicional que diz
  // se o status mudou): aqui nenhuma linha muda (já estava conectado), então o update de sempre roda.
  const fim = Object.assign(Promise.resolve({ error: null }), { neq: vi.fn(() => ({ select: vi.fn(async () => ({ data: [], error: null })) })) });
  const update = vi.fn(() => ({ eq: vi.fn(() => fim) }));
  const rpc = vi.fn(async () => ({ error: null }));
  return { db: { from: vi.fn(() => ({ update })), rpc }, update, rpc };
}

describe("processarEventoZapbot", () => {
  it("ConnectedCallback marca conectado com o telefone", async () => {
    const { db, update } = dbFalso();
    await processarEventoZapbot("c1", { type: "ConnectedCallback", phone: "5537" + "980001001" }, db as never);
    expect(update).toHaveBeenLastCalledWith({ status: "conectado", telefone: "5537" + "980001001", ultimo_erro: null, caiu_em: null });
  });

  it("ignora evento de teste e tipos desconhecidos", async () => {
    const { db, update, rpc } = dbFalso();
    await processarEventoZapbot("c1", { type: "ConnectedCallback", isTest: true }, db as never);
    await processarEventoZapbot("c1", { type: "ReceivedCallback" }, db as never);
    expect(update).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("recibo de grupo vira uma única chamada a somar_recibos, com a pessoa e o tipo", async () => {
    const { db, rpc, update } = dbFalso();
    await processarEventoZapbot("c1", { type: "MessageStatusCallback", status: "READ", ids: ["MSG1"], isGroup: true, phone: "120363000000000000", participantPhone: "5511" + "999990000" }, db as never);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("somar_recibos", { p_ids: ["MSG1"], p_lido: true, p_telefone: "5511" + "999990000", p_tipo: "visualizou" });
    expect(update).not.toHaveBeenCalled();
  });

  it("PLAYED também é uma chamada só (reproduziu, sem lido)", async () => {
    const { db, rpc } = dbFalso();
    await processarEventoZapbot("c1", { type: "MessageStatusCallback", status: "PLAYED", ids: ["MSG1"], isGroup: true, participantPhone: "5511" + "999990000" }, db as never);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("somar_recibos", { p_ids: ["MSG1"], p_lido: false, p_telefone: "5511" + "999990000", p_tipo: "reproduziu" });
  });
});

describe("lerRecibo", () => {
  it("RECEIVED → recebeu; READ → visualizou (lido); PLAYED → reproduziu (não lido)", () => {
    const g = { isGroup: true, participantPhone: "5511" + "999990000" };
    expect(lerRecibo({ type: "MessageStatusCallback", status: "RECEIVED", ids: ["A", "B"], ...g })).toEqual({ ids: ["A", "B"], lido: false, tipo: "recebeu", telefone: "5511" + "999990000" });
    expect(lerRecibo({ type: "MessageStatusCallback", status: "READ", messageId: "A", ...g })).toEqual({ ids: ["A"], lido: true, tipo: "visualizou", telefone: "5511" + "999990000" });
    expect(lerRecibo({ type: "MessageStatusCallback", status: "PLAYED", ids: ["A"], ...g })).toEqual({ ids: ["A"], lido: false, tipo: "reproduziu", telefone: "5511" + "999990000" });
    expect(lerRecibo({ type: "MessageStatusCallback", status: "SENT", ids: ["A"], ...g })).toBeNull();
  });

  it("pessoa: participantPhone em grupo (nunca o id do grupo); phone fora de grupo; desconhecida vira null", () => {
    const base = { type: "MessageStatusCallback", status: "RECEIVED", ids: ["A"] };
    expect(lerRecibo({ ...base, isGroup: true, phone: "120363000000000000" })?.telefone).toBeNull();
    expect(lerRecibo({ ...base, isGroup: true, phone: "120363000000000000", participantPhone: "5511" + "999990000@s.whatsapp.net" })?.telefone).toBe("5511" + "999990000");
    expect(lerRecibo({ ...base, isGroup: false, phone: "5511" + "988887777" })?.telefone).toBe("5511" + "988887777");
    expect(lerRecibo({ ...base, isGroup: true, participantPhone: "123456789012345678@lid" })?.telefone).toBeNull();
    expect(lerRecibo({ ...base, isGroup: true, participantPhone: "" })?.telefone).toBeNull();
    // LID com 15 dígitos passaria por telefone se o sufixo fosse ignorado.
    expect(lerRecibo({ ...base, isGroup: true, participantPhone: "123456789012345@lid" })?.telefone).toBeNull();
    expect(lerRecibo({ ...base, isGroup: true, participantPhone: "5511" + "999990000@g.us" })?.telefone).toBeNull();
    expect(lerRecibo({ ...base, isGroup: true, participantPhone: "5511" + "999990000@c.us" })?.telefone).toBe("5511" + "999990000");
    expect(lerRecibo(base)?.telefone).toBeNull();
  });
  it("sem ids ou de outro tipo: nada", () => {
    expect(lerRecibo({ type: "MessageStatusCallback", status: "READ", ids: [] })).toBeNull();
    expect(lerRecibo({ type: "ReceivedCallback", status: "READ", ids: ["A"] })).toBeNull();
  });
});
