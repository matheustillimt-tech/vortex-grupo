import { describe, expect, it } from "vitest";
import { codigoConvite, decidirDestino, ehLinkWhatsapp, linkAbrirWhatsapp, utmsDe } from "@/src/lib/link";
import { ehCelular } from "@/src/lib/regras/navegador";

const grupo = { id: "g1", numero: 1, cheio: false, ativo: true, link_convite: "https://chat.whatsapp.com/ABC" };

describe("decidirDestino", () => {
  it("navegador comum vai direto pro convite", () => {
    expect(decidirDestino({ grupo, userAgent: "Safari", slug: "aulao" })).toEqual({ tipo: "convite", url: "https://chat.whatsapp.com/ABC" });
  });
  it("Instagram passa pela página de abrir", () => {
    expect(decidirDestino({ grupo, userAgent: "Instagram 300", slug: "aulao" })).toEqual({ tipo: "abrir", url: "/l/aulao/abrir?g=g1" });
  });
  it("sem grupo vai pra espera", () => {
    expect(decidirDestino({ grupo: null, userAgent: "Safari", slug: "aulao" })).toEqual({ tipo: "espera", url: "/l/aulao/abrir?espera=1" });
  });
  it("`base` troca /l pelo endereço de quem chama (deep link avulso, /d)", () => {
    expect(decidirDestino({ grupo, userAgent: "Instagram 300", slug: "x", base: "/d" })).toEqual({ tipo: "abrir", url: "/d/x/abrir?g=g1" });
    expect(decidirDestino({ grupo: null, userAgent: "Safari", slug: "x", base: "/d" })).toEqual({ tipo: "espera", url: "/d/x/abrir?espera=1" });
  });
});

describe("ehLinkWhatsapp", () => {
  it("só chat.whatsapp.com", () => {
    expect(ehLinkWhatsapp("https://chat.whatsapp.com/ABC")).toBe(true);
    expect(ehLinkWhatsapp("https://exemplo.com")).toBe(false);
    expect(ehLinkWhatsapp("https://wa.me/5511" + "999999999")).toBe(false);
    expect(ehLinkWhatsapp("não é url")).toBe(false);
  });
});

describe("utmsDe", () => {
  it("pega as cinco UTMs", () => {
    const u = new URL("https://x/l/a?utm_source=ig&utm_campaign=c&x=1");
    expect(utmsDe(u)).toEqual({ utm_source: "ig", utm_medium: null, utm_campaign: "c", utm_content: null, utm_term: null });
  });
});

const ANDROID = "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1";
const IPAD = "Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36";

describe("ehCelular", () => {
  it("Android, iPhone e iPad sim; computador não", () => {
    expect(ehCelular(ANDROID)).toBe(true);
    expect(ehCelular(IPHONE)).toBe(true);
    expect(ehCelular(IPAD)).toBe(true);
    expect(ehCelular(DESKTOP)).toBe(false);
    expect(ehCelular("")).toBe(false);
  });
});

describe("decidirDestino: Deep Linking (Etapa 3J)", () => {
  it("desligado (padrão): celular vai direto pro convite, como sempre", () => {
    expect(decidirDestino({ grupo, userAgent: ANDROID, slug: "aulao" })).toEqual({ tipo: "convite", url: "https://chat.whatsapp.com/ABC" });
    expect(decidirDestino({ grupo, userAgent: IPHONE, slug: "aulao", deepLinking: false })).toEqual({ tipo: "convite", url: "https://chat.whatsapp.com/ABC" });
  });
  it("ligado: celular passa pela página de abrir", () => {
    expect(decidirDestino({ grupo, userAgent: ANDROID, slug: "aulao", deepLinking: true })).toEqual({ tipo: "abrir", url: "/l/aulao/abrir?g=g1" });
    expect(decidirDestino({ grupo, userAgent: IPHONE, slug: "aulao", deepLinking: true })).toEqual({ tipo: "abrir", url: "/l/aulao/abrir?g=g1" });
  });
  it("ligado: computador continua indo direto pro convite", () => {
    expect(decidirDestino({ grupo, userAgent: DESKTOP, slug: "aulao", deepLinking: true })).toEqual({ tipo: "convite", url: "https://chat.whatsapp.com/ABC" });
  });
  it("ligado: sem grupo continua indo pra espera", () => {
    expect(decidirDestino({ grupo: null, userAgent: ANDROID, slug: "aulao", deepLinking: true })).toEqual({ tipo: "espera", url: "/l/aulao/abrir?espera=1" });
  });
});

describe("linkAbrirWhatsapp / codigoConvite", () => {
  it("tira o código do convite", () => {
    expect(codigoConvite("https://chat.whatsapp.com/ABC")).toBe("ABC");
    expect(codigoConvite("não é url")).toBeNull();
  });
  it("Android abre por intent:// (sem a pergunta) e cai no convite se o app não abrir", () => {
    expect(linkAbrirWhatsapp("ABC", "https://chat.whatsapp.com/ABC", ANDROID)).toBe(
      "intent://chat?code=ABC#Intent;scheme=whatsapp;S.browser_fallback_url=https%3A%2F%2Fchat.whatsapp.com%2FABC;end",
    );
  });
  it("iPhone e o resto continuam no whatsapp://", () => {
    expect(linkAbrirWhatsapp("ABC", "https://chat.whatsapp.com/ABC", IPHONE)).toBe("whatsapp://chat?code=ABC");
    expect(linkAbrirWhatsapp("ABC", "https://chat.whatsapp.com/ABC", "Instagram 300")).toBe("whatsapp://chat?code=ABC");
  });
});
