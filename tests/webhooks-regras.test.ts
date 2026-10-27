import { describe, expect, it } from "vitest";
import { assinatura } from "@/src/lib/webhooks-assinatura";
import {
  EVENTOS_WEBHOOK,
  hostPrivadoOuLocal,
  ROTULO_EVENTO,
  validarUrlWebhook,
  validarWebhook,
  webhooksQueCasam,
  type EntradaWebhook,
  type WebhookCadastrado,
} from "@/src/lib/regras/webhooks";

const CAMP = "11111111-1111-4111-8111-111111111111";
const CAMP2 = "22222222-2222-4222-8222-222222222222";

describe("EVENTOS_WEBHOOK / ROTULO_EVENTO", () => {
  it("os quatro eventos de antes continuam (mesma chave, na frente); entrou/saiu com o rótulo", () => {
    expect(EVENTOS_WEBHOOK.slice(0, 4)).toEqual(["entrou", "saiu", "alerta", "compra"]);
    expect({ entrou: ROTULO_EVENTO.entrou, saiu: ROTULO_EVENTO.saiu, alerta: ROTULO_EVENTO.alerta, compra: ROTULO_EVENTO.compra }).toEqual({
      entrou: "Membro adicionado",
      saiu: "Membro removido",
      alerta: "Alerta",
      compra: "Compra aprovada",
    });
  });

  it("todo evento tem rótulo", () => {
    for (const ev of EVENTOS_WEBHOOK) expect(ROTULO_EVENTO[ev]).toBeTruthy();
  });
});

describe("hostPrivadoOuLocal", () => {
  it("host público: falso", () => {
    expect(hostPrivadoOuLocal("exemplo.com.br")).toBe(false);
    expect(hostPrivadoOuLocal("8.8.8.8")).toBe(false);
  });

  it("localhost, .local, .internal e IP privado (v4 e v6): verdadeiro", () => {
    expect(hostPrivadoOuLocal("localhost")).toBe(true);
    expect(hostPrivadoOuLocal("app.localhost")).toBe(true);
    expect(hostPrivadoOuLocal("maquina.local")).toBe(true);
    expect(hostPrivadoOuLocal("servico.internal")).toBe(true);
    expect(hostPrivadoOuLocal("192.168.0.1")).toBe(true);
    expect(hostPrivadoOuLocal("::1")).toBe(true);
    expect(hostPrivadoOuLocal("::ffff:127.0.0.1")).toBe(true);
  });
});

describe("validarUrlWebhook", () => {
  it.each([
    ["http://exemplo.com.br/x", "A URL precisa começar com https://."],
    ["https://user:pass@exemplo.com.br/x", "A URL não pode ter usuário ou senha."],
    ["https://localhost/x", "A URL não pode apontar para localhost."],
    ["https://maquina.local/x", "A URL não pode apontar para um host interno."],
    ["https://servidor.internal/x", "A URL não pode apontar para um host interno."],
    ["https://10.0.0.1/x", "A URL não pode apontar para um IP privado."],
    ["https://172.16.0.5/x", "A URL não pode apontar para um IP privado."],
    ["https://172.31.255.255/x", "A URL não pode apontar para um IP privado."],
    ["https://192.168.1.1/x", "A URL não pode apontar para um IP privado."],
    ["https://127.0.0.1/x", "A URL não pode apontar para um IP privado."],
    ["https://169.254.1.1/x", "A URL não pode apontar para um IP privado."],
    ["https://[::1]/x", "A URL não pode apontar para um IP privado."],
    ["https://[fc00::1]/x", "A URL não pode apontar para um IP privado."],
    ["https://[fd12::1]/x", "A URL não pode apontar para um IP privado."],
    ["https://[::ffff:127.0.0.1]/x", "A URL não pode apontar para um IP privado."],
    ["https://[::ffff:10.0.0.1]/x", "A URL não pode apontar para um IP privado."],
    ["https://[::ffff:192.168.1.1]/x", "A URL não pode apontar para um IP privado."],
    ["https://[::]/x", "A URL não pode apontar para um IP privado."],
    ["https://[fe80::1]/x", "A URL não pode apontar para um IP privado."],
    ["https://[::127.0.0.1]/x", "A URL não pode apontar para um IP privado."],
    ["não é url", "URL inválida."],
    ["https://" + "a".repeat(500), "URL com até 500 caracteres."],
  ])("recusa %s", (url, erro) => {
    expect(validarUrlWebhook(url)).toBe(erro);
  });

  it("aceita https comum", () => {
    expect(validarUrlWebhook("https://exemplo.com.br/x")).toBeNull();
  });

  it("não confunde 172.15 ou 172.32 (fora do intervalo privado) nem 192.169", () => {
    expect(validarUrlWebhook("https://172.15.0.1/x")).toBeNull();
    expect(validarUrlWebhook("https://172.32.0.1/x")).toBeNull();
    expect(validarUrlWebhook("https://192.169.0.1/x")).toBeNull();
  });

  it("aceita IPv6 público, inclusive IPv4-mapeado com IP público", () => {
    expect(validarUrlWebhook("https://[::ffff:8.8.8.8]/x")).toBeNull();
    expect(validarUrlWebhook("https://[2001:4860:4860::8888]/x")).toBeNull();
  });
});

const base: EntradaWebhook = { nome: "Meu CRM", url: "https://exemplo.com.br/hook", eventos: ["entrou"], campanhas: null };

describe("validarWebhook", () => {
  it("aceita e normaliza o nome", () => {
    const r = validarWebhook({ ...base, nome: "  Meu CRM  " });
    expect(r).toEqual({ ok: true, valor: { ...base, nome: "Meu CRM" } });
  });

  it("aceita lista de campanhas", () => {
    const r = validarWebhook({ ...base, campanhas: [CAMP, CAMP2] });
    expect(r).toEqual({ ok: true, valor: { ...base, campanhas: [CAMP, CAMP2] } });
  });

  it.each([
    [{ nome: "" }, "Dê um nome de até 60 caracteres."],
    [{ nome: "x".repeat(61) }, "Dê um nome de até 60 caracteres."],
    [{ url: "http://exemplo.com.br" }, "A URL precisa começar com https://."],
    [{ eventos: [] }, "Marque pelo menos um evento."],
    [{ eventos: ["desconhecido"] }, "Evento inválido."],
    [{ campanhas: ["não-uuid"] }, "Campanha inválida."],
    [{ campanhas: Array.from({ length: 201 }, () => CAMP) }, "No máximo 200 campanhas."],
  ])("recusa %j", (patch, erro) => {
    const r = validarWebhook({ ...base, ...patch } as EntradaWebhook);
    expect(r).toEqual({ ok: false, erro });
  });
});

describe("webhooksQueCasam", () => {
  const w = (over: Partial<WebhookCadastrado> = {}): WebhookCadastrado => ({
    id: "w1",
    eventos: ["entrou"],
    campanhas: null,
    ativo: true,
    arquivado: false,
    ...over,
  });

  it("casa quando ativo, não arquivado, tem o evento e todas as campanhas", () => {
    expect(webhooksQueCasam([w()], "entrou", CAMP)).toEqual([w()]);
  });

  it("não casa se inativo, arquivado, ou sem o evento", () => {
    expect(webhooksQueCasam([w({ ativo: false })], "entrou", CAMP)).toEqual([]);
    expect(webhooksQueCasam([w({ arquivado: true })], "entrou", CAMP)).toEqual([]);
    expect(webhooksQueCasam([w({ eventos: ["saiu"] })], "entrou", CAMP)).toEqual([]);
  });

  it("casa só pela campanha certa quando a lista não é null", () => {
    const alvo = w({ id: "w2", campanhas: [CAMP] });
    expect(webhooksQueCasam([alvo], "entrou", CAMP)).toEqual([alvo]);
    expect(webhooksQueCasam([alvo], "entrou", CAMP2)).toEqual([]);
  });

  it("evento sem campanha (campanhaId null) só casa com webhooks de todas as campanhas", () => {
    const todas = w({ id: "w-todas", eventos: ["alerta"], campanhas: null });
    const restrito = w({ id: "w-restrito", eventos: ["alerta"], campanhas: [CAMP] });
    expect(webhooksQueCasam([todas, restrito], "alerta", null)).toEqual([todas]);
  });

  it("apenas 'restritos' exclui os de todas as campanhas mesmo quando casariam", () => {
    const todas = w({ id: "w-todas", eventos: ["alerta"], campanhas: null });
    const restrito = w({ id: "w-restrito", eventos: ["alerta"], campanhas: [CAMP] });
    expect(webhooksQueCasam([todas, restrito], "alerta", CAMP, "restritos")).toEqual([restrito]);
  });

  it("apenas 'todas' exclui os restritos a campanhas mesmo quando casariam", () => {
    const todas = w({ id: "w-todas", eventos: ["alerta"], campanhas: null });
    const restrito = w({ id: "w-restrito", eventos: ["alerta"], campanhas: [CAMP] });
    expect(webhooksQueCasam([todas, restrito], "alerta", CAMP, "todas")).toEqual([todas]);
  });
});

describe("assinatura", () => {
  it("é determinística (HMAC-SHA256 hex) e muda com o segredo ou o corpo", () => {
    const a = assinatura("segredo", '{"a":1}');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(assinatura("segredo", '{"a":1}')).toBe(a);
    expect(assinatura("outro", '{"a":1}')).not.toBe(a);
    expect(assinatura("segredo", '{"a":2}')).not.toBe(a);
  });
});

describe("validarUrlWebhook — formas extras de host interno", () => {
  it.each([
    "https://localhost./x",
    "https://app.localhost/x",
    "https://a.local./x",
    "https://0.0.0.0/x",
    "https://100.64.0.1/x",
    "https://[::ffff:0:0]/x",
  ])("recusa %s", (u) => {
    expect(validarUrlWebhook(u)).not.toBeNull();
  });
});
