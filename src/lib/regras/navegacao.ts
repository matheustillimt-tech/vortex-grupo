/** Item de menu ou aba aceso. `exato`: só o próprio endereço (ex.: "Visão geral" não acende em ".../grupos").
 *  "/" é sempre exato; os outros acendem também nas subpáginas ("/campanhas" em "/campanhas/abc/grupos"). */
export function estaAtivo(href: string, atual: string, exato = false): boolean {
  if (exato || href === "/") return atual === href;
  return atual === href || atual.startsWith(`${href}/`);
}
