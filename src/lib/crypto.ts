import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

function chavePadrao(): Buffer {
  const k = Buffer.from(process.env.CRYPTO_KEY ?? "", "base64");
  if (k.length !== 32) throw new Error("CRYPTO_KEY precisa ter 32 bytes em base64");
  return k;
}

/** AES-256-GCM. Formato: iv.tag.dados (base64 cada). */
export function cifrar(texto: string, chave: Buffer = chavePadrao()): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", chave, iv);
  const dados = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), dados].map((b) => b.toString("base64")).join(".");
}

export function decifrar(valor: string, chave: Buffer = chavePadrao()): string {
  const [iv, tag, dados] = valor.split(".").map((p) => Buffer.from(p, "base64"));
  const d = createDecipheriv("aes-256-gcm", chave, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(dados), d.final()]).toString("utf8");
}

export function segredoAleatorio(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

const LETRAS_E_DIGITOS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ" + "abcdefghijklmnopqrstuvwxyz" + "0123456789";

/** Senha aleatória (letras e dígitos) com sorteio criptográfico sem viés. */
export function senhaAleatoria(tamanho = 16): string {
  return Array.from({ length: tamanho }, () => LETRAS_E_DIGITOS[randomInt(LETRAS_E_DIGITOS.length)]).join("");
}

export function segredosIguais(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function hashIp(ip: string): string {
  return createHash("sha256").update(`${process.env.CRYPTO_KEY ?? ""}:${ip}`).digest("hex").slice(0, 32);
}
