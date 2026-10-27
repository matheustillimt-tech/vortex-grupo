import { describe, expect, it } from "vitest";
import { rotaDeDesenvolvimento, rotaPublica } from "@/middleware";

describe("rotaPublica", () => {
  it.each([
    ["/login", true],
    ["/l/aulao", true],
    ["/l/aulao/abrir", true],
    ["/d/x", true],
    ["/d/x/abrir", true],
    ["/api/cron/tick", true],
    ["/api/webhooks/zapbot/a/b", true],
    ["/api/webhooks/checkout/hotmart/x", true],
    ["/api/v1/campanhas", true],
    ["/api/v1/campanhas/abc/grupos", true],
    ["/api/mcp", true],
    ["/api/v1", false],
    ["/api/mcpx", false],
    ["/", false],
    ["/campanhas", false],
    ["/api/conexoes/1/qr", false],
    ["/dev/vitrine", false],
    ["/deeplinks", false],
  ])("%s → %s", (p, esperado) => {
    expect(rotaPublica(p)).toBe(esperado);
  });
});

describe("rotaDeDesenvolvimento", () => {
  it.each([
    ["/dev/vitrine", "development", true],
    ["/dev", "development", true],
    ["/dev/vitrine", "production", false],
    ["/dev/vitrine", "test", false],
    ["/devolucao", "development", false],
    ["/campanhas", "development", false],
  ])("%s em %s → %s", (p, ambiente, esperado) => {
    expect(rotaDeDesenvolvimento(p, ambiente)).toBe(esperado);
  });
});
