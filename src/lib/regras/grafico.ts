export type Ponto = { x: number; y: number };

/** Topo do eixo Y arredondado para 1, 2 ou 5 × 10ⁿ (nunca menos de 1). */
export function topoDaEscala(maior: number): number {
  if (maior <= 1) return 1;
  const base = 10 ** Math.floor(Math.log10(maior));
  for (const m of [1, 2, 5, 10]) if (m * base >= maior) return m * base;
  return 10 * base;
}

/** Valores → pontos no SVG: x distribuído de 0 a `largura`, y de `altura` (zero) a 0 (topo). */
export function pontosDoGrafico(valores: number[], largura: number, altura: number, topo: number): Ponto[] {
  const n = valores.length;
  return valores.map((v, i) => ({
    x: n === 1 ? largura / 2 : (i * largura) / (n - 1),
    y: altura - (Math.max(0, v) * altura) / topo,
  }));
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Atributo `d` da linha: "M0,140 L100,96 …". */
export function caminhoLinha(p: Ponto[]): string {
  return p.map((q, i) => `${i === 0 ? "M" : "L"}${r1(q.x)},${r1(q.y)}`).join(" ");
}

/** Mesma linha fechada até a base, para a área em degradê. */
export function caminhoArea(p: Ponto[], altura: number): string {
  if (!p.length) return "";
  return `${caminhoLinha(p)} L${r1(p[p.length - 1].x)},${altura} L${r1(p[0].x)},${altura} Z`;
}

/** Área de uma banda empilhada (gráfico empilhado, Leadscoring): entre a linha de cima (`superior`) e a de
 *  baixo (`inferior`, percorrida ao contrário pra fechar o polígono). Sem pontos (nenhum dia no período),
 *  devolve vazio — nunca um `d=" Z"` degenerado, que desenhava um traço sem sentido em vez de mostrar que não
 *  há dados (revisão final B, item m7). */
export function caminhoBanda(superior: Ponto[], inferior: Ponto[]): string {
  if (!superior.length) return "";
  return `${caminhoLinha(superior)} ${[...inferior].reverse().map((p) => `L${r1(p.x)},${r1(p.y)}`).join(" ")} Z`;
}

/** No máximo `maximo` rótulos no eixo X, igualmente espaçados; `posicao` em % da largura. */
export function rotulosDoEixo(dias: string[], maximo = 7): { indice: number; rotulo: string; posicao: number }[] {
  const n = dias.length;
  const passo = Math.max(1, Math.ceil(n / maximo));
  return dias.flatMap((rotulo, indice) =>
    indice % passo === 0 ? [{ indice, rotulo, posicao: n === 1 ? 50 : Math.round((indice / (n - 1)) * 1000) / 10 }] : [],
  );
}
