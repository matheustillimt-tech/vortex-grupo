import { describe, expect, it, vi } from "vitest";
import { removidosDaResposta, ZapbotClient } from "@/src/lib/zapbot/client";

/** Rotas novas da Etapa 3C: caminho, método e corpo exatamente como na doc (https://api.zapbot.online/docs). */
const conexao = { id: "inst1", token: "tok1", clientToken: "ct1" };
const G = "120363000000000000@g.us";
const BASE = "https://api.zapbot.online/instances/inst1/token/tok1/";

function cliente(corpo: unknown = { zaapId: "z", messageId: "M1", id: "M1" }) {
  const fetch = vi.fn(async () => new Response(JSON.stringify(corpo), { status: 200 }));
  const c = new ZapbotClient({ baseUrl: "https://api.zapbot.online", email: "e", password: "p", fetch: fetch as unknown as typeof globalThis.fetch, sleep: async () => {} });
  const chamada = (i = 0) => {
    const [url, init] = fetch.mock.calls[i] as unknown as [string, RequestInit];
    return { url, method: init.method, corpo: JSON.parse(String(init.body)), clientToken: (init.headers as Record<string, string>)["Client-Token"] };
  };
  return { c, fetch, chamada };
}

describe("ZapbotClient — rotas da Etapa 3C", () => {
  it("send-sticker", async () => {
    const { c, chamada } = cliente();
    expect(await c.enviarFigurinha(conexao, G, "https://x/f.webp")).toBe("M1");
    expect(chamada()).toEqual({ url: BASE + "send-sticker", method: "POST", corpo: { phone: G, sticker: "https://x/f.webp" }, clientToken: "ct1" });
  });

  it("send-video com gif: true (com e sem legenda)", async () => {
    const { c, chamada } = cliente();
    await c.enviarGif(conexao, G, "https://x/v.mp4", "oi");
    await c.enviarGif(conexao, G, "https://x/v.mp4", "");
    expect(chamada(0)).toMatchObject({ url: BASE + "send-video", method: "POST", corpo: { phone: G, video: "https://x/v.mp4", gif: true, caption: "oi" } });
    expect(chamada(1).corpo).toEqual({ phone: G, video: "https://x/v.mp4", gif: true });
  });

  it("send-contact", async () => {
    const { c, chamada } = cliente();
    await c.enviarContato(conexao, G, "João Silva", "5511888888888");
    expect(chamada()).toMatchObject({ url: BASE + "send-contact", method: "POST", corpo: { phone: G, contactName: "João Silva", contactPhone: "5511888888888" } });
  });

  it("send-event: segundos Unix; local vai na descrição (nunca `location`); opcionais só quando preenchidos", async () => {
    const { c, chamada } = cliente();
    await c.enviarEvento(conexao, G, { nome: "Aula", descricao: "Ao vivo", inicio: 1791205200, fim: 1791208800, local: "YouTube" });
    await c.enviarEvento(conexao, G, { nome: "Aula", descricao: null, inicio: 1791205200, fim: null, local: null });
    await c.enviarEvento(conexao, G, { nome: "Aula", descricao: null, inicio: 1791205200, fim: null, local: "Sala 2" });
    expect(chamada(0)).toMatchObject({ url: BASE + "send-event", method: "POST" });
    expect(chamada(0).corpo).toEqual({ phone: G, name: "Aula", startTime: 1791205200, endTime: 1791208800, description: "Ao vivo\n\nLocal: YouTube" });
    expect(chamada(1).corpo).toEqual({ phone: G, name: "Aula", startTime: 1791205200 });
    expect(chamada(2).corpo).toEqual({ phone: G, name: "Aula", startTime: 1791205200, description: "Local: Sala 2" });
  });

  it("send-button-actions", async () => {
    const { c, chamada } = cliente();
    const botoes = [
      { type: "REPLY" as const, id: "sim", label: "Quero" },
      { type: "URL" as const, label: "Site", url: "https://x" },
      { type: "CALL" as const, label: "Ligar", phone: "5511" + "999999999" },
    ];
    await c.enviarBotoes(conexao, G, "Como prefere?", botoes);
    expect(chamada()).toMatchObject({ url: BASE + "send-button-actions", method: "POST", corpo: { phone: G, message: "Como prefere?", buttons: botoes } });
  });

  it("pin-message: fromMe true e a duração", async () => {
    const { c, chamada } = cliente();
    await c.fixarMensagem(conexao, G, "3EB0", "24h");
    expect(chamada()).toMatchObject({ url: BASE + "pin-message", method: "POST", corpo: { phone: G, messageId: "3EB0", fromMe: true, duration: "24h" } });
  });

  it("chat-disappearing: seconds", async () => {
    const { c, chamada } = cliente({ value: true });
    await c.mensagensTemporarias(conexao, G, 604800);
    await c.mensagensTemporarias(conexao, G, 0);
    expect(chamada(0)).toMatchObject({ url: BASE + "chat-disappearing", method: "POST", corpo: { phone: G, seconds: 604800 } });
    expect(chamada(1).corpo).toEqual({ phone: G, seconds: 0 });
  });

  it("group-mode (PUT): requireApproval", async () => {
    const { c, chamada } = cliente({ value: true });
    await c.modoEntrada(conexao, G, true);
    expect(chamada()).toMatchObject({ url: BASE + "group-mode", method: "PUT", corpo: { groupId: G, requireApproval: true } });
  });

  it("deactivate-community: communityId", async () => {
    const { c, chamada } = cliente({ value: true });
    await c.desativarComunidade(conexao, G);
    expect(chamada()).toMatchObject({ url: BASE + "deactivate-community", method: "POST", corpo: { communityId: G } });
  });

  it("group-settings (PUT) com locked e group-invite-link sem reset", async () => {
    const { c, chamada, fetch } = cliente({ inviteLink: "https://chat.whatsapp.com/X" });
    await c.configurarGrupo(conexao, { groupId: G, announce: true, locked: false });
    expect(await c.linkConvite(conexao, G)).toBe("https://chat.whatsapp.com/X");
    expect(chamada(0)).toMatchObject({ url: BASE + "group-settings", method: "PUT", corpo: { groupId: G, announce: true, locked: false } });
    expect(chamada(1)).toMatchObject({ url: BASE + "group-invite-link", method: "POST", corpo: { groupId: G } });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("removerParticipantes: group-participants remove; lê o resultado por número quando vem", async () => {
    const { c, chamada } = cliente({ results: [{ phone: "5511888888888", status: 200 }, { phone: "5511777777777@s.whatsapp.net", status: 403 }] });
    expect(await c.removerParticipantes(conexao, G, ["5511888888888", "5511777777777"])).toEqual(["5511888888888"]);
    expect(chamada()).toMatchObject({ url: BASE + "group-participants", method: "POST", corpo: { groupId: G, phones: ["5511888888888", "5511777777777"], action: "remove" } });
  });

  it("removidosDaResposta: formatos aceitos e null quando não dá pra saber", () => {
    expect(removidosDaResposta([{ phone: "1", success: true }, { phone: "2", success: false }])).toEqual(["1"]);
    expect(removidosDaResposta({ participants: [{ jid: "3@s.whatsapp.net", status: "ok" }, { phone: "4", error: "not-authorized" }] })).toEqual(["3"]);
    expect(removidosDaResposta({ phones: [{ phone: "5" }] })).toEqual(["5"]);
    expect(removidosDaResposta({ value: true })).toBeNull();
    expect(removidosDaResposta({})).toBeNull();
    expect(removidosDaResposta({ results: ["5511"] })).toBeNull();
  });

  it("group-participants remove", async () => {
    const { c, chamada } = cliente({});
    await c.participantes(conexao, G, ["5511888888888"], "remove");
    expect(chamada()).toMatchObject({ url: BASE + "group-participants", method: "POST", corpo: { groupId: G, phones: ["5511888888888"], action: "remove" } });
  });

  it("erro HTTP numa rota nova vira ZapbotError", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ error: "not admin" }), { status: 400 }));
    const c = new ZapbotClient({ baseUrl: "https://api.zapbot.online", email: "e", password: "p", fetch: fetch as unknown as typeof globalThis.fetch, sleep: async () => {} });
    await expect(c.modoEntrada(conexao, G, false)).rejects.toMatchObject({ name: "ZapbotError", status: 400, message: "not admin" });
  });
});
