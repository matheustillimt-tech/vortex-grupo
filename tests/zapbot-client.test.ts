import { describe, expect, it, vi } from "vitest";
import { grupoDaResposta, MAX_REVISAO, participantesOkDaResposta, pedidosDaResposta, revisaoOkNaResposta, ZapbotClient, ZapbotError } from "@/src/lib/zapbot/client";

const conexao = { id: "inst1", token: "tok1", clientToken: "ct1" };

function resposta(status: number, corpo: unknown, json = true) {
  return new Response(json ? JSON.stringify(corpo) : String(corpo), { status });
}

function cliente(respostas: Response[], jwt?: string) {
  const fetch = vi.fn(async () => respostas.shift()!);
  const c = new ZapbotClient({
    baseUrl: "https://api.zapbot.online",
    email: "e@x.com",
    password: "p",
    jwt,
    fetch: fetch as unknown as typeof globalThis.fetch,
    sleep: async () => {},
  });
  return { c, fetch };
}

describe("ZapbotClient", () => {
  it("faz login quando não há JWT e cria conexão", async () => {
    const { c, fetch } = cliente([resposta(200, { token: "jwt1" }), resposta(201, { id: "i9", token: "t9" })]);
    const r = await c.criarConexao({ nome: "Captação", webhookUrl: "https://x/w", clientToken: "ct" });
    expect(r).toEqual({ id: "i9", token: "t9" });
    expect((fetch.mock.calls[0] as unknown as [string, RequestInit])[0]).toBe("https://api.zapbot.online/auth/login");
    const [, init] = fetch.mock.calls[1] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer jwt1");
    expect(JSON.parse(String(init.body))).toEqual({ name: "Captação", webhookUrl: "https://x/w", clientToken: "ct" });
  });

  it("refaz login no 401 e repete uma vez", async () => {
    const { c, fetch } = cliente(
      [resposta(401, { error: "invalid or expired token" }), resposta(200, { token: "novo" }), resposta(200, { deleted: true })],
      "velho",
    );
    await c.apagarConexao("i9");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("usa Client-Token e caminho da instância", async () => {
    const { c, fetch } = cliente([resposta(200, { connected: true, phone: "5537" })]);
    expect(await c.status(conexao)).toEqual({ connected: true, phone: "5537" });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.zapbot.online/instances/inst1/token/tok1/status");
    expect((init.headers as Record<string, string>)["Client-Token"]).toBe("ct1");
  });

  it("QR: 202 aguarde, 200 pronto, 409 conectado", async () => {
    const { c } = cliente([resposta(202, {}), resposta(200, { value: "data:image/png;base64,AAA" }), resposta(409, {})]);
    expect(await c.qrCode(conexao)).toEqual({ estado: "aguarde" });
    expect(await c.qrCode(conexao)).toEqual({ estado: "pronto", imagem: "data:image/png;base64,AAA" });
    expect(await c.qrCode(conexao)).toEqual({ estado: "conectado" });
  });

  it("repete em 429 e em 502 sem JSON", async () => {
    const { c, fetch } = cliente([resposta(429, {}), resposta(502, "<html>", false), resposta(200, { messageId: "m1" })]);
    expect(await c.enviar(conexao, "send-text", { phone: "120@g.us", message: "oi" })).toBe("m1");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("prazo total da tela (~20 s): o 429 não espera além do prazo, cada tentativa usa só o que sobra", async () => {
    let t = 0;
    const esperas: number[] = [];
    const respostas = [resposta(429, {}), resposta(429, {}), resposta(429, {}), resposta(429, {}), resposta(200, [])];
    const fetch = vi.fn(async () => {
      t += 5_000; // cada tentativa leva 5 s
      return respostas.shift()!;
    });
    const c = new ZapbotClient({
      baseUrl: "https://api.zapbot.online",
      email: "e@x.com",
      password: "p",
      fetch: fetch as unknown as typeof globalThis.fetch,
      sleep: async (ms) => {
        esperas.push(ms);
        t += ms;
      },
      agora: () => t,
    });
    await expect(c.listarGrupos(conexao, { prazoTotalMs: 20_000 })).rejects.toBeInstanceOf(ZapbotError);
    // 5 s + espera 1 s + 5 s + espera 2 s + 5 s = 18 s; esperar 4 s passaria do prazo: para e devolve o 429.
    expect(esperas).toEqual([1000, 2000]);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(t).toBeLessThanOrEqual(20_000);
  });

  it("sem prazo (fila/cron): as mesmas 4 tentativas de sempre", async () => {
    const { c, fetch } = cliente([resposta(429, {}), resposta(429, {}), resposta(429, {}), resposta(429, {})]);
    await expect(c.listarGrupos(conexao)).rejects.toBeInstanceOf(ZapbotError);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("502 com JSON vira ZapbotError sem repetir", async () => {
    const { c, fetch } = cliente([resposta(502, { error: "rate-overlimit" })]);
    await expect(c.enviar(conexao, "send-text", { phone: "x", message: "y" })).rejects.toBeInstanceOf(ZapbotError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("lista grupos (array puro, formato real da API)", async () => {
    const bruto = [{ groupId: "120@g.us", name: "A", amAdmin: true, participantCount: 3 }];
    const { c } = cliente([resposta(200, bruto)]);
    expect(await c.listarGrupos(conexao)).toEqual([{ groupId: "120@g.us", name: "A", amAdmin: true, participantCount: 3, participants: [] }]);
  });

  it("lista grupos (formato antigo { groups: [...] })", async () => {
    const bruto = { groups: [{ groupId: "121@g.us", name: "B", amAdmin: false, participantCount: 1 }] };
    const { c } = cliente([resposta(200, bruto)]);
    expect(await c.listarGrupos(conexao)).toEqual([{ groupId: "121@g.us", name: "B", amAdmin: false, participantCount: 1, participants: [] }]);
  });

  it("obtém um grupo com participantes (superadmin conexão como admin)", async () => {
    const corpo = {
      groupId: "120@g.us",
      name: "A",
      amAdmin: true,
      participantCount: 2,
      participants: [
        { phone: "5511", isAdmin: true },
        { phone: "5522", isAdmin: false, isSuperAdmin: true },
      ],
    };
    const { c } = cliente([resposta(200, corpo)]);
    expect(await c.obterGrupo(conexao, "120@g.us")).toEqual({
      groupId: "120@g.us",
      name: "A",
      amAdmin: true,
      participantCount: 2,
      participants: [
        { phone: "5511", isAdmin: true },
        { phone: "5522", isAdmin: true },
      ],
    });
  });

  it("obtém um grupo que não existe mais (404) e devolve null", async () => {
    const { c } = cliente([resposta(404, { error: "not found" })]);
    expect(await c.obterGrupo(conexao, "999@g.us")).toBeNull();
  });

  it("cria grupo e devolve o groupId (aceita groupId, id ou phone)", async () => {
    const { c } = cliente([resposta(200, { groupId: "120@g.us" }), resposta(200, { phone: "121@g.us" })]);
    expect(await c.criarGrupo(conexao, "AULÃO #01", ["5511"])).toBe("120@g.us");
    expect(await c.criarGrupo(conexao, "AULÃO #02", ["5511"])).toBe("121@g.us");
  });

  it("pega link de convite com e sem reset", async () => {
    const { c, fetch } = cliente([resposta(200, { inviteLink: "https://chat.whatsapp.com/A" }), resposta(200, { inviteLink: "https://chat.whatsapp.com/B" })]);
    expect(await c.linkConvite(conexao, "120@g.us")).toBe("https://chat.whatsapp.com/A");
    expect(await c.linkConvite(conexao, "120@g.us", true)).toBe("https://chat.whatsapp.com/B");
    const [, init] = fetch.mock.calls[1] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ groupId: "120@g.us", reset: true });
  });

  it("envia enquete pelo send-poll com o corpo do Zapbot", async () => {
    const { c, fetch } = cliente([resposta(200, { messageId: "POLL1" })]);
    expect(await c.enviarEnquete(conexao, "120@g.us", "Vem?", ["Sim", "Não"], 1)).toBe("POLL1");
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.zapbot.online/instances/inst1/token/tok1/send-poll");
    expect(JSON.parse(String(init.body))).toEqual({ phone: "120@g.us", poll: "Vem?", pollOptions: ["Sim", "Não"], maxSelections: 1 });
  });
});

describe("ZapbotClient — group-participants com resultado (Etapa 3K)", () => {
  it("mesma rota e corpo de `participantes`; devolve só quem deu certo", async () => {
    const { c, fetch } = cliente([
      resposta(200, { results: [{ phone: "5511" + "999990001", status: "added" }, { phone: "5511" + "999990002@s.whatsapp.net", status: 403 }] }),
    ], "jwt");
    expect(await c.participantesComResultado(conexao, "120@g.us", ["5511" + "999990001", "5511" + "999990002"], "add")).toEqual(["5511" + "999990001"]);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.zapbot.online/instances/inst1/token/tok1/group-participants");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ groupId: "120@g.us", phones: ["5511" + "999990001", "5511" + "999990002"], action: "add" });
  });

  it("formatos aceitos (promoted, success, error) e null quando não dá pra saber", () => {
    expect(participantesOkDaResposta([{ phone: "1", status: "promoted" }, { phone: "2", success: false }])).toEqual(["1"]);
    expect(participantesOkDaResposta({ participants: [{ jid: "3@s.whatsapp.net", status: 200 }, { phone: "4", error: "not-authorized" }] })).toEqual(["3"]);
    expect(participantesOkDaResposta({ value: true })).toBeNull();
    expect(participantesOkDaResposta({})).toBeNull();
  });
});

describe("ZapbotClient — Etapa 3K, Tarefa 3 (contrato conferido em api.zapbot.online/docs)", () => {
  it("entrarNoGrupo: POST join-group com { inviteLink }", async () => {
    const { c, fetch } = cliente([resposta(200, { messageId: "m", zaapId: "z", id: "x" })], "jwt");
    await c.entrarNoGrupo(conexao, "https://chat.whatsapp.com/AbCdEfGhIj123");
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.zapbot.online/instances/inst1/token/tok1/join-group");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Client-Token"]).toBe("ct1");
    expect(JSON.parse(String(init.body))).toEqual({ inviteLink: "https://chat.whatsapp.com/AbCdEfGhIj123" });
  });

  it("entrarNoGrupo: erro do Zapbot vira ZapbotError com o status", async () => {
    const { c } = cliente([resposta(400, { error: "invalid invite" })], "jwt");
    await expect(c.entrarNoGrupo(conexao, "https://chat.whatsapp.com/AbCdEfGhIj123")).rejects.toMatchObject({ status: 400, message: "invalid invite" });
  });

  it("privacidadeAvancada: POST limit-sharing com { phone: groupId, value }", async () => {
    const { c, fetch } = cliente([resposta(200, { value: true }), resposta(200, { value: false })], "jwt");
    await c.privacidadeAvancada(conexao, "120@g.us", true);
    await c.privacidadeAvancada(conexao, "120@g.us", false);
    const corpos = fetch.mock.calls.map((x) => {
      const [url, init] = x as unknown as [string, RequestInit];
      return { url, method: init.method, body: JSON.parse(String(init.body)) };
    });
    expect(corpos).toEqual([
      { url: "https://api.zapbot.online/instances/inst1/token/tok1/limit-sharing", method: "POST", body: { phone: "120@g.us", value: true } },
      { url: "https://api.zapbot.online/instances/inst1/token/tok1/limit-sharing", method: "POST", body: { phone: "120@g.us", value: false } },
    ]);
  });
});

describe("ZapbotClient — Etapa 3K, Tarefa 4 (contrato conferido em api.zapbot.online/docs)", () => {
  it("contatos: GET contacts, aceita array na raiz e devolve phone/name/short/notify", async () => {
    const { c, fetch } = cliente(
      [resposta(200, [{ phone: "5511" + "988887777", name: "Fulano", short: "Fu", notify: "Fulaninho" }, { phone: "5511" + "977776666" }])],
      "jwt",
    );
    const r = await c.contatos(conexao);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.zapbot.online/instances/inst1/token/tok1/contacts");
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>)["Client-Token"]).toBe("ct1");
    expect(r).toEqual([
      { phone: "5511" + "988887777", name: "Fulano", short: "Fu", notify: "Fulaninho" },
      { phone: "5511" + "977776666", name: "", short: "", notify: "" },
    ]);
  });

  it("contatos: aceita o formato antigo { contacts: [...] } e ignora item sem phone", async () => {
    const { c } = cliente([resposta(200, { contacts: [{ name: "Sem telefone" }, { phone: "5511" + "966665555", notify: "Apelido" }] })], "jwt");
    expect(await c.contatos(conexao)).toEqual([{ phone: "5511" + "966665555", name: "", short: "", notify: "Apelido" }]);
  });
});

describe("ZapbotClient — Etapa 3K, Tarefa 6 (contrato conferido em api.zapbot.online/docs)", () => {
  const chamada = (fetch: ReturnType<typeof vi.fn>, i = 0) => {
    const [url, init] = fetch.mock.calls[i] as unknown as [string, RequestInit];
    return { url, method: init.method, body: JSON.parse(String(init.body)), token: (init.headers as Record<string, string>)["Client-Token"] };
  };

  it("resolverLid: POST resolve-lid com { phone } e devolve os dígitos do LID", async () => {
    const { c, fetch } = cliente([resposta(200, { phone: "5511" + "999999999", lid: "123456789012345@lid" })], "jwt");
    expect(await c.resolverLid(conexao, "5511" + "999999999")).toEqual({ telefone: "5511" + "999999999", lid: "123456789012345" });
    expect(chamada(fetch)).toEqual({ url: "https://api.zapbot.online/instances/inst1/token/tok1/resolve-lid", method: "POST", body: { phone: "5511" + "999999999" }, token: "ct1" });
  });

  it("resolverLid: resposta sem LID reconhecível = null; erro do Zapbot lança", async () => {
    const { c } = cliente([resposta(200, { phone: "5511" + "999999999" }), resposta(200, { lid: "abc@lid" }), resposta(404, { error: "not found" })], "jwt");
    expect(await c.resolverLid(conexao, "5511" + "999999999")).toBeNull();
    expect(await c.resolverLid(conexao, "5511" + "999999999")).toBeNull();
    await expect(c.resolverLid(conexao, "5511" + "999999999")).rejects.toMatchObject({ status: 404 });
  });

  it("bloquearContato / desbloquearContato: POST block e unblock com { phone }", async () => {
    const { c, fetch } = cliente([resposta(200, { value: true }), resposta(200, { value: true })], "jwt");
    await c.bloquearContato(conexao, "5511" + "999999999");
    await c.desbloquearContato(conexao, "5511" + "999999999");
    expect(chamada(fetch, 0)).toEqual({ url: "https://api.zapbot.online/instances/inst1/token/tok1/block", method: "POST", body: { phone: "5511" + "999999999" }, token: "ct1" });
    expect(chamada(fetch, 1)).toEqual({ url: "https://api.zapbot.online/instances/inst1/token/tok1/unblock", method: "POST", body: { phone: "5511" + "999999999" }, token: "ct1" });
  });
});

describe("ZapbotClient — Etapa 3M (contrato das rotas de grupo)", () => {
  const BASE = "https://api.zapbot.online/instances/inst1/token/tok1/";
  const chamada = (fetch: ReturnType<typeof vi.fn>, i = 0) => {
    const [url, init] = fetch.mock.calls[i] as unknown as [string, RequestInit];
    return { url, method: init.method, body: init.body === undefined ? undefined : JSON.parse(String(init.body)), token: (init.headers as Record<string, string>)["Client-Token"] };
  };
  const GRUPO = { groupId: "120@g.us", name: "A", amAdmin: true, participantCount: 2, participants: [{ phone: "5511", isAdmin: false, isSuperAdmin: true }] };

  describe("grupoDaResposta", () => {
    it("sem os campos novos: só os campos de sempre (nenhuma chave nova aparece)", () => {
      const g = grupoDaResposta(GRUPO);
      expect(g).toStrictEqual({ groupId: "120@g.us", name: "A", amAdmin: true, participantCount: 2, participants: [{ phone: "5511", isAdmin: true }] });
      expect("avatarUrl" in g).toBe(false);
      expect("communityId" in g).toBe(false);
    });

    it("com os campos novos do objeto Group", () => {
      expect(grupoDaResposta({ ...GRUPO, avatarUrl: "https://pps.whatsapp.net/x.jpg", requireApproval: true, isCommunity: false, isAnnouncementGroup: true, communityId: "999@g.us" })).toStrictEqual({
        groupId: "120@g.us", name: "A", amAdmin: true, participantCount: 2, participants: [{ phone: "5511", isAdmin: true }],
        avatarUrl: "https://pps.whatsapp.net/x.jpg", requireApproval: true, isCommunity: false, isAnnouncementGroup: true, communityId: "999@g.us",
      });
    });

    it("avatarUrl http:, vazio ou null vira null; communityId vazio/null vira null", () => {
      expect(grupoDaResposta({ ...GRUPO, avatarUrl: "http://x/y.jpg" }).avatarUrl).toBeNull();
      expect(grupoDaResposta({ ...GRUPO, avatarUrl: "" }).avatarUrl).toBeNull();
      expect(grupoDaResposta({ ...GRUPO, avatarUrl: null }).avatarUrl).toBeNull();
      expect(grupoDaResposta({ ...GRUPO, avatarUrl: "data:image/png;base64,AAA" }).avatarUrl).toBeNull();
      expect(grupoDaResposta({ ...GRUPO, communityId: "" }).communityId).toBeNull();
      expect(grupoDaResposta({ ...GRUPO, communityId: null }).communityId).toBeNull();
    });

    it("listarGrupos usa o mesmo mapeamento (traz os campos novos)", async () => {
      const { c } = cliente([resposta(200, [{ groupId: "120@g.us", name: "A", amAdmin: true, participantCount: 3, avatarUrl: "https://x/a.jpg", requireApproval: false }])], "jwt");
      expect(await c.listarGrupos(conexao)).toStrictEqual([{ groupId: "120@g.us", name: "A", amAdmin: true, participantCount: 3, participants: [], avatarUrl: "https://x/a.jpg", requireApproval: false }]);
    });
  });

  describe("obterGrupo com leitura leve", () => {
    it("regressão: sem opções chama exatamente a URL de sempre", async () => {
      const { c, fetch } = cliente([resposta(200, GRUPO), resposta(200, GRUPO)], "jwt");
      await c.obterGrupo(conexao, "120@g.us");
      await c.obterGrupo(conexao, "120@g.us", { participantes: true, link: true });
      expect(chamada(fetch, 0)).toEqual({ url: `${BASE}groups/120@g.us`, method: "GET", body: undefined, token: "ct1" });
      expect(chamada(fetch, 1).url).toBe(`${BASE}groups/120@g.us`);
    });

    it("só manda na query o que vier false", async () => {
      const { c, fetch } = cliente([resposta(200, GRUPO), resposta(200, GRUPO), resposta(200, GRUPO)], "jwt");
      await c.obterGrupo(conexao, "120@g.us", { link: false });
      await c.obterGrupo(conexao, "120@g.us", { participantes: false });
      await c.obterGrupo(conexao, "120@g.us", { participantes: false, link: false });
      expect(fetch.mock.calls.map((x) => (x as unknown as [string])[0])).toEqual([
        `${BASE}groups/120@g.us?inviteLink=false`,
        `${BASE}groups/120@g.us?participants=false`,
        `${BASE}groups/120@g.us?participants=false&inviteLink=false`,
      ]);
    });

    it("participantes: false → participants [] e participantCount da resposta; 404 continua null", async () => {
      const { c } = cliente([resposta(200, { groupId: "120@g.us", name: "A", amAdmin: false, participantCount: 987 }), resposta(404, { error: "not found" })], "jwt");
      expect(await c.obterGrupo(conexao, "120@g.us", { participantes: false, link: false })).toStrictEqual({ groupId: "120@g.us", name: "A", amAdmin: false, participantCount: 987, participants: [] });
      expect(await c.obterGrupo(conexao, "999@g.us", { participantes: false })).toBeNull();
    });
  });

  it("trocarFoto: PUT group-picture com { groupId, image }", async () => {
    const { c, fetch } = cliente([resposta(200, { value: true })], "jwt");
    await c.trocarFoto(conexao, "120@g.us", "https://x/foto.jpg");
    expect(chamada(fetch)).toEqual({ url: `${BASE}group-picture`, method: "PUT", body: { groupId: "120@g.us", image: "https://x/foto.jpg" }, token: "ct1" });
  });

  it("trocarFoto: recusa URL que não é https:// sem chamar o Zapbot", async () => {
    const { c, fetch } = cliente([], "jwt");
    for (const url of ["http://x/foto.jpg", "data:image/png;base64,AAA", "/midias/x.jpg", ""]) {
      await expect(c.trocarFoto(conexao, "120@g.us", url)).rejects.toMatchObject({ name: "ZapbotError", status: 400 });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fotoDoGrupo: GET groups/{id}/avatar; https → URL, outro valor → null, 404 → null, outro erro lança", async () => {
    const { c, fetch } = cliente([
      resposta(200, { avatarUrl: "https://pps.whatsapp.net/a.jpg" }),
      resposta(200, { avatarUrl: "http://x" }),
      resposta(200, {}),
      resposta(404, { error: "not found" }),
      resposta(500, { error: "boom" }),
    ], "jwt");
    expect(await c.fotoDoGrupo(conexao, "120@g.us")).toBe("https://pps.whatsapp.net/a.jpg");
    expect(chamada(fetch)).toEqual({ url: `${BASE}groups/120@g.us/avatar`, method: "GET", body: undefined, token: "ct1" });
    expect(await c.fotoDoGrupo(conexao, "120@g.us")).toBeNull();
    expect(await c.fotoDoGrupo(conexao, "120@g.us")).toBeNull();
    expect(await c.fotoDoGrupo(conexao, "120@g.us")).toBeNull();
    await expect(c.fotoDoGrupo(conexao, "120@g.us")).rejects.toMatchObject({ status: 500 });
  });

  it("pedidosPendentes: GET groups/{id}/pending, array na raiz; phone sem @ e requestedAt (ms) em ISO", async () => {
    const { c, fetch } = cliente([resposta(200, [{ phone: "5511" + "999990001", requestedAt: 1759320000000 }, { phone: "5511" + "999990002@s.whatsapp.net" }])], "jwt");
    expect(await c.pedidosPendentes(conexao, "120@g.us", { timeoutMs: 8_000 })).toEqual([
      { telefone: "5511" + "999990001", pedidoEm: new Date(1759320000000).toISOString() },
      { telefone: "5511" + "999990002", pedidoEm: null },
    ]);
    expect(chamada(fetch)).toEqual({ url: `${BASE}groups/120@g.us/pending`, method: "GET", body: undefined, token: "ct1" });
  });

  it("pedidosDaResposta: `@lid` continua no id (sinal de LID, que nunca é aprovado); outros sufixos saem", () => {
    expect(pedidosDaResposta([{ phone: "123456789012345@lid" }, { phone: "5511" + "999990001@c.us" }, { phone: "5511" + "999990002" }])!.map((p) => p.telefone)).toEqual([
      "123456789012345@lid",
      "5511" + "999990001",
      "5511" + "999990002",
    ]);
  });

  it("pedidosPendentes: aceita { pending } e { requests }; 404 = null (grupo sumiu); outro erro lança", async () => {
    const { c } = cliente([
      resposta(200, { pending: [{ phone: "5511" + "999990001", requestedAt: 1759320000000 }] }),
      resposta(200, { requests: [{ phone: "5511" + "999990003" }, { semPhone: true }] }),
      resposta(404, { error: "not found" }),
      resposta(403, { error: "not admin" }),
    ], "jwt");
    expect(await c.pedidosPendentes(conexao, "120@g.us")).toEqual([{ telefone: "5511" + "999990001", pedidoEm: new Date(1759320000000).toISOString() }]);
    expect(await c.pedidosPendentes(conexao, "120@g.us")).toEqual([{ telefone: "5511" + "999990003", pedidoEm: null }]);
    expect(await c.pedidosPendentes(conexao, "120@g.us")).toBeNull();
    await expect(c.pedidosPendentes(conexao, "120@g.us")).rejects.toMatchObject({ status: 403 });
    // Formato não reconhecido = null (leitura incompleta), nunca [] (revisão final A); lista vazia de verdade = [].
    expect(pedidosDaResposta({ value: true })).toBeNull();
    expect(pedidosDaResposta(null)).toBeNull();
    expect(pedidosDaResposta({ pending: "x" })).toBeNull();
    expect(pedidosDaResposta([])).toEqual([]);
    expect(pedidosDaResposta({ pending: [] })).toEqual([]);
  });

  it("pedidosPendentes: resposta 200 num formato não reconhecido devolve null (revisão final A)", async () => {
    const { c } = cliente([resposta(200, { ok: true })], "jwt");
    expect(await c.pedidosPendentes(conexao, "120@g.us")).toBeNull();
  });

  it("revisarPedidos: POST group-review com { groupId, phones, action } e devolve quem deu certo", async () => {
    const { c, fetch } = cliente([
      resposta(200, { participants: [{ phone: "5511" + "999990001", status: "approved" }, { phone: "5511" + "999990002@s.whatsapp.net", status: 403 }] }),
      resposta(200, { participants: [{ phone: "5511" + "999990003", status: "rejected" }] }),
    ], "jwt");
    expect(await c.revisarPedidos(conexao, "120@g.us", ["5511" + "999990001", "5511" + "999990002"], "approve")).toEqual(["5511" + "999990001"]);
    expect(chamada(fetch)).toEqual({ url: `${BASE}group-review`, method: "POST", body: { groupId: "120@g.us", phones: ["5511" + "999990001", "5511" + "999990002"], action: "approve" }, token: "ct1" });
    expect(await c.revisarPedidos(conexao, "120@g.us", ["5511" + "999990003"], "reject")).toEqual(["5511" + "999990003"]);
    expect(chamada(fetch, 1).body).toEqual({ groupId: "120@g.us", phones: ["5511" + "999990003"], action: "reject" });
  });

  it("revisarPedidos: sem lista reconhecível = null; mais de 50 recusa sem chamar", async () => {
    const { c, fetch } = cliente([resposta(200, { value: true })], "jwt");
    expect(await c.revisarPedidos(conexao, "120@g.us", ["5511" + "999990001"], "approve")).toBeNull();
    expect(MAX_REVISAO).toBe(50);
    await expect(c.revisarPedidos(conexao, "120@g.us", Array.from({ length: 51 }, (_, i) => `55119999${String(i).padStart(5, "0")}`), "approve")).rejects.toMatchObject({ status: 400 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("revisaoOkNaResposta: approved/rejected/aprovado/recusado, 2xx, success; erro e success false não", () => {
    for (const status of ["approved", "rejected", "aprovado", "recusado", "Approved", "ok", "200"]) expect(revisaoOkNaResposta({ phone: "1", status })).toBe(true);
    expect(revisaoOkNaResposta({ phone: "1", status: 201 })).toBe(true);
    expect(revisaoOkNaResposta({ phone: "1" })).toBe(true);
    expect(revisaoOkNaResposta({ phone: "1", success: true })).toBe(true);
    expect(revisaoOkNaResposta({ phone: "1", status: 404 })).toBe(false);
    expect(revisaoOkNaResposta({ phone: "1", status: "not-found" })).toBe(false);
    expect(revisaoOkNaResposta({ phone: "1", success: false })).toBe(false);
    expect(revisaoOkNaResposta({ phone: "1", status: "approved", error: "x" })).toBe(false);
  });

  it("sairDoGrupo: POST leave-group com { groupId }", async () => {
    const { c, fetch } = cliente([resposta(200, { value: true })], "jwt");
    await c.sairDoGrupo(conexao, "120@g.us");
    expect(chamada(fetch)).toEqual({ url: `${BASE}leave-group`, method: "POST", body: { groupId: "120@g.us" }, token: "ct1" });
  });

  it("modoEntrada continua mandando só requireApproval (sem adminsOnlyAdd)", async () => {
    const { c, fetch } = cliente([resposta(200, { value: true })], "jwt");
    await c.modoEntrada(conexao, "120@g.us", true);
    expect(chamada(fetch)).toEqual({ url: `${BASE}group-mode`, method: "PUT", body: { groupId: "120@g.us", requireApproval: true }, token: "ct1" });
  });
});
