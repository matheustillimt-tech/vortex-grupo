/** Navegadores dentro de apps (Instagram, Facebook, YouTube, TikTok, Threads) costumam não abrir o WhatsApp direto. */
export function navegadorInterno(userAgent: string): boolean {
  return /Instagram|FBAN|FBAV|FB_IAB|com\.google\.android\.youtube|YouTube|musical_ly|TikTok|Barcelona|Threads/i.test(userAgent);
}

/** Bots de pré-visualização de link (buscam a página pra gerar o card do link num chat, mas ninguém "visitou" de
 *  verdade): o deep link avulso (`/d/[slug]`) ainda redireciona normalmente, só não soma o clique. */
// "Instagram" fica de fora de propósito: o navegador do app do Instagram (gente de verdade clicando na bio) tem
// "Instagram" no user agent; a pré-visualização do Instagram usa o robô do Facebook (facebookexternalhit).
export function ehBotDePreview(userAgent: string): boolean {
  return /facebookexternalhit|WhatsApp|TelegramBot|Twitterbot|Slackbot|Discordbot|LinkedInBot|Googlebot|bingbot/i.test(userAgent);
}

/** Celular ou tablet (Android, iPhone, iPad): com Deep Linking ligado, passa pela página de abertura do link, que
 *  abre o WhatsApp direto no convite. iPad novo se apresenta como Mac ("Macintosh") e fica de fora: segue a regra de
 *  computador (nada muda). */
export function ehCelular(userAgent: string): boolean {
  return /Android|iPhone|iPad|iPod/i.test(userAgent);
}

/** Android (celular ou tablet): o WhatsApp abre por `intent://`, que o Chrome do Android entrega direto ao app, sem
 *  a pergunta "Abrir no WhatsApp?" que o `whatsapp://` dispara. */
export function ehAndroid(userAgent: string): boolean {
  return /Android/i.test(userAgent);
}
