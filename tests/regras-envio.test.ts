import { describe, expect, it } from "vitest";
import { espacarEnvios } from "@/src/lib/regras/espacamento";
import { ehBotDePreview, navegadorInterno } from "@/src/lib/regras/navegador";
import { brasiliaParaIso, isoParaCampoBrasilia } from "@/src/lib/regras/horario";
import { corpoEnvio, rotaEnvio } from "@/src/lib/regras/espacamento";

describe("espacarEnvios", () => {
  const inicio = new Date("2026-10-21T23:00:00Z");

  it("primeiro de cada número sai na hora; os seguintes entre 3 e 8 s depois", () => {
    const r = espacarEnvios(
      [{ grupoId: "g1", conexaoId: "A" }, { grupoId: "g2", conexaoId: "A" }, { grupoId: "g3", conexaoId: "B" }, { grupoId: "g4", conexaoId: "A" }],
      inicio,
      () => 0.5,
    );
    const ms = r.map((x) => x.enviarApos.getTime() - inicio.getTime());
    expect(ms).toEqual([0, 5500, 0, 11000]);
  });

  it("aleatório 0 dá 3 s e quase 1 dá perto de 8 s", () => {
    const [, a] = espacarEnvios([{ grupoId: "1", conexaoId: "A" }, { grupoId: "2", conexaoId: "A" }], inicio, () => 0);
    const [, b] = espacarEnvios([{ grupoId: "1", conexaoId: "A" }, { grupoId: "2", conexaoId: "A" }], inicio, () => 0.999);
    expect(a.enviarApos.getTime() - inicio.getTime()).toBe(3000);
    expect(b.enviarApos.getTime() - inicio.getTime()).toBe(7995);
  });
});

describe("rota e corpo do envio", () => {
  it("rotas por tipo", () => {
    expect(rotaEnvio("texto")).toBe("send-text");
    expect(rotaEnvio("imagem")).toBe("send-image");
    expect(rotaEnvio("documento", "Guia.PDF")).toBe("send-document/pdf");
    expect(rotaEnvio("documento", null)).toBe("send-document/pdf");
  });

  it("texto com mencionar todos leva @all e mentionAll", () => {
    expect(corpoEnvio({ tipo: "texto", texto: "Começou!", midia_url: null, nome_arquivo: null, mencionar_todos: true }, "120@g.us")).toEqual({
      phone: "120@g.us",
      message: "Começou! @all",
      mentionAll: true,
    });
  });

  it("imagem com legenda", () => {
    expect(corpoEnvio({ tipo: "imagem", texto: "olha", midia_url: "https://x/i.jpg", nome_arquivo: null, mencionar_todos: false }, "120@g.us")).toEqual({
      phone: "120@g.us",
      image: "https://x/i.jpg",
      caption: "olha",
    });
  });

  it("documento com nome do arquivo", () => {
    expect(corpoEnvio({ tipo: "documento", texto: "", midia_url: "https://x/a.pdf", nome_arquivo: "a.pdf", mencionar_todos: false }, "120@g.us")).toEqual({
      phone: "120@g.us",
      document: "https://x/a.pdf",
      fileName: "a.pdf",
    });
  });

  it("áudio sem legenda", () => {
    expect(corpoEnvio({ tipo: "audio", texto: "ignorado", midia_url: "https://x/a.ogg", nome_arquivo: null, mencionar_todos: false }, "1@g.us")).toEqual({
      phone: "1@g.us",
      audio: "https://x/a.ogg",
    });
  });
});

describe("navegadorInterno", () => {
  it.each([
    ["Mozilla/5.0 (iPhone) Instagram 300.0", true],
    ["Mozilla/5.0 [FBAN/FBIOS;FBAV/400]", true],
    ["Mozilla/5.0 (Linux; Android) com.google.android.youtube/19.0", true],
    ["Mozilla/5.0 (Macintosh) Safari/605", false],
  ])("%s → %s", (ua, esperado) => {
    expect(navegadorInterno(ua)).toBe(esperado);
  });
});

describe("ehBotDePreview", () => {
  it.each([
    ["facebookexternalhit/1.1", true],
    ["WhatsApp/2.23.20.0", true],
    ["Mozilla/5.0 (iPhone) Instagram 300.0", false], // navegador do app = gente de verdade
    ["TelegramBot (like TwitterBot)", true],
    ["Twitterbot/1.0", true],
    ["Slackbot-LinkExpanding 1.0", true],
    ["Mozilla/5.0 (compatible; Discordbot/2.0;)", true],
    ["LinkedInBot/1.0", true],
    ["Googlebot/2.1", true],
    ["Mozilla/5.0 (compatible; bingbot/2.0)", true],
    ["Mozilla/5.0 (Macintosh) Safari/605", false],
    ["Mozilla/5.0 (Linux; Android) com.google.android.youtube/19.0", false],
  ])("%s → %s", (ua, esperado) => {
    expect(ehBotDePreview(ua)).toBe(esperado);
  });
});

describe("brasiliaParaIso", () => {
  it("soma 3 horas", () => {
    expect(brasiliaParaIso("2026-10-21T20:00")).toBe("2026-10-21T23:00:00.000Z");
  });
  it("recusa valor inválido", () => {
    expect(() => brasiliaParaIso("amanhã")).toThrow("Data e hora inválidas");
  });
});

describe("isoParaCampoBrasilia", () => {
  it("volta 3 horas no formato do datetime-local", () => {
    expect(isoParaCampoBrasilia("2026-10-21T23:00:00.000Z")).toBe("2026-10-21T20:00");
    expect(isoParaCampoBrasilia("2026-10-22T01:30:00Z")).toBe("2026-10-21T22:30");
  });
});
