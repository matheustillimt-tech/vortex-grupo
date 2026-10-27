import { afterEach, describe, expect, it } from "vitest";
import { env, envOpcional } from "@/src/lib/env";

describe("env", () => {
  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("devolve a variável definida", () => {
    process.env.CRON_SECRET = "abc";
    expect(env("CRON_SECRET")).toBe("abc");
  });

  it("falha com mensagem clara quando falta", () => {
    expect(() => env("CRON_SECRET")).toThrow("Variável de ambiente ausente: CRON_SECRET");
  });

  it("envOpcional devolve undefined para vazio", () => {
    process.env.CRON_SECRET = "";
    expect(envOpcional("CRON_SECRET")).toBeUndefined();
  });
});
