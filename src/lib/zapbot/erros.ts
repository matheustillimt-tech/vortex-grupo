import { ZapbotError } from "./client";

export type ReacaoErro = "repetir" | "pausar" | "desconectado" | "falha";

export function classificarErro(e: unknown): ReacaoErro {
  if (!(e instanceof ZapbotError)) return "repetir"; // rede/timeout
  const msg = e.message.toLowerCase();
  if (msg.includes("rate-overlimit")) return "pausar";
  if (e.status === 404 || msg.includes("not connected") || msg.includes("is disconnected")) return "desconectado";
  if (e.status === 429 || e.status >= 500) return "repetir";
  return "falha";
}
