import { describe, expect, it } from "vitest";
import { ZapbotError } from "@/src/lib/zapbot/client";
import { classificarErro } from "@/src/lib/zapbot/erros";

describe("classificarErro", () => {
  it.each([
    [new ZapbotError(429, "too many", {}), "repetir"],
    [new ZapbotError(502, "Resposta inesperada do Zapbot (HTTP 502).", {}), "repetir"],
    [new ZapbotError(502, "rate-overlimit", {}), "pausar"],
    [new ZapbotError(502, "instance abc not connected", {}), "desconectado"],
    [new ZapbotError(502, "instance abc is disconnected", {}), "desconectado"],
    [new ZapbotError(404, "instance not found", {}), "desconectado"],
    [new ZapbotError(400, "phone inválido", {}), "falha"],
    [new Error("fetch failed"), "repetir"],
  ])("%s → %s", (erro, esperado) => {
    expect(classificarErro(erro)).toBe(esperado);
  });
});
