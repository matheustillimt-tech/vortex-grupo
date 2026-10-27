import { createHmac } from "node:crypto";

/** Assinatura HMAC-SHA256 (hex) do corpo, com o segredo do webhook. Fora de `regras/webhooks` porque aquele
 *  arquivo também vai pro navegador (rótulos dos eventos) e `node:crypto` não roda lá. */
export function assinatura(segredo: string, corpo: string): string {
  return createHmac("sha256", segredo).update(corpo).digest("hex");
}
