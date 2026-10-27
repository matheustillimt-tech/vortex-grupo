import type { GrupoLink } from "./regras/escolha";
import { ehAndroid, ehCelular, navegadorInterno } from "./regras/navegador";

export type Destino = { tipo: "convite" | "abrir" | "espera"; url: string };

/** `base` (padrão `/l`, a rota do link de campanha) deixa o deep link avulso (`/d/[slug]`) reusar a mesma regra
 *  de decisão com as próprias páginas de abertura (`/d/[slug]/abrir`), sem mudar quem já chama sem passar nada.
 *  `deepLinking` (seção Deep Linking da campanha, padrão false = regra de sempre): ligado, todo celular também passa
 *  pela página de abertura (que abre o WhatsApp direto no convite). */
export function decidirDestino(e: { grupo: GrupoLink | null; userAgent: string; slug: string; base?: string; deepLinking?: boolean }): Destino {
  const base = e.base ?? "/l";
  if (!e.grupo?.link_convite) return { tipo: "espera", url: `${base}/${e.slug}/abrir?espera=1` };
  if (navegadorInterno(e.userAgent) || (e.deepLinking === true && ehCelular(e.userAgent))) return { tipo: "abrir", url: `${base}/${e.slug}/abrir?g=${e.grupo.id}` };
  return { tipo: "convite", url: e.grupo.link_convite };
}

/** `true` só para convites de grupo do WhatsApp (`chat.whatsapp.com`) — usado pelo deep link avulso (`/d/[slug]`)
 *  pra decidir se passa pela página de abertura por deep link (`decidirDestino`); qualquer outro destino (site,
 *  checkout…) segue direto, em qualquer aparelho. */
export function ehLinkWhatsapp(url: string): boolean {
  try {
    return new URL(url).hostname === "chat.whatsapp.com";
  } catch {
    return false;
  }
}

/** Código do convite (`chat.whatsapp.com/{codigo}`), ou null se o link não tiver um. */
export function codigoConvite(convite: string): string | null {
  try {
    return new URL(convite).pathname.split("/").filter(Boolean).pop() ?? null;
  } catch {
    return null;
  }
}

/** Endereço que abre o WhatsApp direto no convite. Android: `intent://` (sem a pergunta "Abrir no WhatsApp?"; se o
 *  app não abrir, o Chrome cai no próprio convite). iPhone e o resto: `whatsapp://` (o iOS sempre pergunta antes de
 *  abrir outro app, e isso nenhum site desliga). */
export function linkAbrirWhatsapp(codigo: string, convite: string, userAgent: string): string {
  const code = encodeURIComponent(codigo);
  if (ehAndroid(userAgent)) return `intent://chat?code=${code}#Intent;scheme=whatsapp;S.browser_fallback_url=${encodeURIComponent(convite)};end`;
  return `whatsapp://chat?code=${code}`;
}

const UTMS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;

export function utmsDe(url: URL): Record<(typeof UTMS)[number], string | null> {
  return Object.fromEntries(UTMS.map((k) => [k, url.searchParams.get(k)])) as Record<(typeof UTMS)[number], string | null>;
}
