/** Endereço público do sistema pra mostrar na tela (ex.: "seu-dominio.com.br"), lido de `NEXT_PUBLIC_SITE_URL`,
 *  sem "https://" e sem "/" no fim. Funciona também em componente de navegador (a Next.js embute o valor no build). */
export function hostDoSite(): string {
  const url = process.env.NEXT_PUBLIC_SITE_URL || "https://seu-dominio.com.br";
  return url.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}
