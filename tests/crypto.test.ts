import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { cifrar, decifrar, segredoAleatorio, segredosIguais, senhaAleatoria } from "@/src/lib/crypto";

const chave = randomBytes(32);

describe("crypto", () => {
  it("cifra e decifra", () => {
    const c = cifrar("token-secreto", chave);
    expect(c).not.toContain("token-secreto");
    expect(decifrar(c, chave)).toBe("token-secreto");
  });

  it("cada cifragem sai diferente", () => {
    expect(cifrar("x", chave)).not.toBe(cifrar("x", chave));
  });

  it("chave errada falha", () => {
    expect(() => decifrar(cifrar("x", chave), randomBytes(32))).toThrow();
  });

  it("segredo aleatório tem 32+ caracteres url-safe", () => {
    const s = segredoAleatorio();
    expect(s.length).toBeGreaterThanOrEqual(32);
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("compara segredos", () => {
    expect(segredosIguais("abc", "abc")).toBe(true);
    expect(segredosIguais("abc", "abd")).toBe(false);
    expect(segredosIguais("abc", "abcd")).toBe(false);
  });
});

describe("senhaAleatoria", () => {
  it("16 caracteres só com letras e dígitos, diferente a cada chamada", () => {
    const senhas = Array.from({ length: 50 }, () => senhaAleatoria());
    for (const s of senhas) expect(s).toMatch(/^[A-Za-z0-9]{16}$/);
    expect(new Set(senhas).size).toBe(50);
    expect(senhaAleatoria(20)).toHaveLength(20);
  });
});
