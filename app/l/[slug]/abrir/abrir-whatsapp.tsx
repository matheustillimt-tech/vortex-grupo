"use client";
import { useEffect } from "react";

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

/** Deep Linking: ao montar, abre o WhatsApp direto no convite (`destino` vem de `linkAbrirWhatsapp`: `intent://` no
 *  Android, `whatsapp://` no resto). Com o Pixel da Meta,
 *  dispara o `Lead` antes e espera 600 ms pra dar tempo do evento sair. Não desenha nada: os botões de reserva da
 *  página continuam lá se o WhatsApp não abrir. */
export function AbrirWhatsapp({ destino, pixel }: { destino: string; pixel: boolean }) {
  useEffect(() => {
    if (!pixel) {
      window.location.href = destino;
      return;
    }
    try {
      window.fbq?.("track", "Lead");
    } catch {
      // Pixel bloqueado ou fora do ar: abre o WhatsApp do mesmo jeito.
    }
    const t = window.setTimeout(() => {
      window.location.href = destino;
    }, 600);
    return () => window.clearTimeout(t);
  }, [destino, pixel]);
  return null;
}
