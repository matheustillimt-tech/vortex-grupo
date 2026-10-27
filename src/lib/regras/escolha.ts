import type { CampanhaTipo } from "./campanha-tipo";

export type GrupoLink = { id: string; numero: number; cheio: boolean; ativo: boolean; link_convite: string | null };

/**
 * Enche um grupo de cada vez: o de menor número com vaga. Quem já clicou volta pro mesmo grupo (em qualquer tipo).
 * "campanha", "lista" e "viral" usam essa mesma regra (por ora não têm regra própria); "aleatorio" sorteia entre
 * os grupos com vaga em vez de pegar sempre o de menor número.
 */
export function escolherGrupo(
  grupos: GrupoLink[],
  grupoDoCookie: string | null,
  tipo: CampanhaTipo = "campanha",
  sortear: () => number = Math.random,
): GrupoLink | null {
  const disponiveis = grupos.filter((g) => g.ativo && !g.cheio && g.link_convite);
  if (grupoDoCookie) {
    const anterior = disponiveis.find((g) => g.id === grupoDoCookie);
    if (anterior) return anterior;
  }
  if (disponiveis.length === 0) return null;
  if (tipo === "aleatorio") return disponiveis[Math.floor(sortear() * disponiveis.length)];
  return [...disponiveis].sort((a, b) => a.numero - b.numero)[0];
}
