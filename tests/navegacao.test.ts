import { describe, expect, it } from "vitest";
import { estaAtivo } from "@/src/lib/regras/navegacao";

describe("estaAtivo", () => {
  it.each([
    ["/", "/", false, true],
    ["/", "/campanhas", false, false],
    ["/campanhas", "/campanhas", false, true],
    ["/campanhas", "/campanhas/abc/grupos", false, true],
    ["/campanhas", "/campanhasx", false, false],
    ["/calendario", "/campanhas/abc/calendario", false, false],
    ["/campanhas/abc", "/campanhas/abc/grupos", true, false],
    ["/campanhas/abc", "/campanhas/abc", true, true],
  ] as const)("%s em %s (exato: %s) → %s", (href, atual, exato, esperado) => {
    expect(estaAtivo(href, atual, exato)).toBe(esperado);
  });
});
