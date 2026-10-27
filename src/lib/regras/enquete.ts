/** Linhas de `resultado_enquete` → todas as opções na ordem da enquete (zero nas sem voto), com % sobre quem votou.
 *  Com mais de uma resposta por pessoa, a soma dos % passa de 100. */
export function placarEnquete(opcoes: string[], linhas: { opcao: string; votos: number | string }[], pessoas: number): { opcao: string; votos: number; pct: number }[] {
  const porOpcao = new Map(linhas.map((l) => [l.opcao, Number(l.votos)]));
  return opcoes.map((opcao) => {
    const votos = porOpcao.get(opcao) ?? 0;
    return { opcao, votos, pct: pessoas ? Math.round((votos / pessoas) * 100) : 0 };
  });
}
