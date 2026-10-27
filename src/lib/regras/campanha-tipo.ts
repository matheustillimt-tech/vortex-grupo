/**
 * Tipos de campanha (Etapa 3D). "lista" e "viral" se comportam exatamente como "campanha" por ora — ainda não
 * têm regra própria; só "aleatorio" muda a escolha do grupo (ver `escolherGrupo` em `./escolha`).
 */
export const TIPOS_CAMPANHA = ["campanha", "lista", "viral", "aleatorio"] as const;
export type CampanhaTipo = (typeof TIPOS_CAMPANHA)[number];

/** Campanha sem `termina_em` nunca termina. Com `termina_em`, terminou quando a data já passou (<=). */
export function campanhaTerminou(termina_em: string | null | undefined, agora: Date): boolean {
  return !!termina_em && new Date(termina_em).getTime() <= agora.getTime();
}
