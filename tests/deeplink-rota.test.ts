import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, type Chamada, type Resposta } from "./apoio/db-falso";

// Rota pública do deep link avulso: soma o clique e redireciona (302), só com `dbAdmin` (service role) —
// nunca authenticated/anon. Slug inexistente → 404 simples, sem detalhe.

const hoisted = vi.hoisted(() => ({ dbAtual: undefined as unknown }));
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => hoisted.dbAtual }));

import { GET, HEAD } from "@/app/d/[slug]/route";

function montar(responder: (c: Chamada) => Resposta | null = () => null) {
  const { db, chamadas } = dbFalso((c) => responder(c) ?? {});
  hoisted.dbAtual = db;
  return chamadas;
}

const chamar = (slug: string, userAgent = "Safari", metodo = "GET") =>
  (metodo === "HEAD" ? HEAD : GET)(new Request(`http://x/d/${slug}`, { method: metodo, headers: { "user-agent": userAgent } }) as never, { params: Promise.resolve({ slug }) });

beforeEach(() => vi.restoreAllMocks());

describe("GET /d/[slug]", () => {
  it("slug inexistente: 404 simples, sem detalhe", async () => {
    montar(() => ({ data: null }));
    const r = await chamar("sumiu");
    expect(r.status).toBe(404);
    expect(await r.text()).toBe("Link indisponível.");
  });

  it("erro na RPC: trata como slug inexistente (404), nunca estoura", async () => {
    montar(() => ({ error: { message: "boom" } }));
    const r = await chamar("bio");
    expect(r.status).toBe(404);
  });

  it("destino comum (não WhatsApp): redireciona (302) direto pro destino, em qualquer navegador", async () => {
    const chamadas = montar(() => ({ data: "https://exemplo.com/pagina" }));
    // TikTok: navegador interno (não é bot de pré-visualização, ver describe abaixo) — não importa fora de chat.whatsapp.com
    const r = await chamar("bio", "TikTok 300");
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("https://exemplo.com/pagina");
    expect(chamadas.find((c) => c.tabela === "rpc:registrar_clique_deeplink")!.dados).toEqual({ p_slug: "bio" });
  });

  it("convite de grupo do WhatsApp em navegador comum: segue direto pro chat.whatsapp.com", async () => {
    montar(() => ({ data: "https://chat.whatsapp.com/ABC" }));
    const r = await chamar("grupo", "Safari");
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("https://chat.whatsapp.com/ABC");
  });

  it("convite de grupo do WhatsApp em navegador interno (TikTok): passa por /d/[slug]/abrir (decidirDestino)", async () => {
    montar(() => ({ data: "https://chat.whatsapp.com/ABC" }));
    const r = await chamar("grupo", "TikTok 300");
    expect(r.status).toBe(302);
    expect(new URL(r.headers.get("location")!).pathname).toBe("/d/grupo/abrir");
  });

  it("navegador do app do Instagram é gente de verdade: soma o clique", async () => {
    const chamadas = montar(() => ({ data: "https://exemplo.com/pagina" }));
    await chamar("bio", "Mozilla/5.0 (iPhone) Instagram 300.0.0");
    expect(chamadas.some((c) => c.tabela === "rpc:registrar_clique_deeplink")).toBe(true);
  });

  describe("HEAD e bots de pré-visualização: redireciona sem somar o clique", () => {
    it.each([
      "facebookexternalhit/1.1",
      "WhatsApp/2.23",
      "TelegramBot (like TwitterBot)",
      "Twitterbot/1.0",
      "Slackbot-LinkExpanding 1.0",
      "Mozilla/5.0 (compatible; Discordbot/2.0)",
      "LinkedInBot/1.0",
      "Googlebot/2.1",
      "Mozilla/5.0 (compatible; bingbot/2.0)",
    ])("%s: lê o destino direto (sem RPC) e redireciona", async (userAgent) => {
      const chamadas = montar((c) => (c.tabela === "deeplinks" ? { data: { destino: "https://exemplo.com/pagina" } } : null));
      const r = await chamar("bio", userAgent);
      expect(r.status).toBe(302);
      expect(r.headers.get("location")).toBe("https://exemplo.com/pagina");
      expect(chamadas.some((c) => c.tabela === "rpc:registrar_clique_deeplink")).toBe(false);
      expect(chamadas.find((c) => c.tabela === "deeplinks")).toBeTruthy();
    });

    it("HEAD de um navegador comum: também não soma o clique, e redireciona", async () => {
      const chamadas = montar((c) => (c.tabela === "deeplinks" ? { data: { destino: "https://exemplo.com/pagina" } } : null));
      const r = await chamar("bio", "Safari", "HEAD");
      expect(r.status).toBe(302);
      expect(r.headers.get("location")).toBe("https://exemplo.com/pagina");
      expect(chamadas.some((c) => c.tabela === "rpc:registrar_clique_deeplink")).toBe(false);
    });

    it("bot com slug inexistente: 404 simples", async () => {
      montar((c) => (c.tabela === "deeplinks" ? { data: null } : null));
      const r = await chamar("sumiu", "facebookexternalhit/1.1");
      expect(r.status).toBe(404);
    });

    it("navegador comum (GET): continua somando o clique pela RPC, como antes", async () => {
      const chamadas = montar(() => ({ data: "https://exemplo.com/pagina" }));
      const r = await chamar("bio", "Safari");
      expect(r.status).toBe(302);
      expect(chamadas.some((c) => c.tabela === "deeplinks")).toBe(false);
      expect(chamadas.find((c) => c.tabela === "rpc:registrar_clique_deeplink")).toBeTruthy();
    });
  });
});
