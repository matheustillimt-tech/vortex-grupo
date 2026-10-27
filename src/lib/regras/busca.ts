/** Valor pronto pra entrar num `.or(...)` do PostgREST (ex.: `nome.ilike.<isto>,url.ilike.<isto>`), já com `%…%`
 *  e entre aspas duplas. As aspas são o que protege o `.or()`: sem elas, uma busca como `a,ativo.eq.true)`
 *  fecharia esse filtro no meio e colaria outro filtro na consulta (injeção de filtro) — dentro de aspas o
 *  PostgREST não quebra o conteúdo em vírgula nem em parênteses. Escapa, nessa ordem: a barra invertida e os
 *  curingas do ILIKE (`%` e `_`, pra não valerem como curinga no texto buscado) e, por fim, a própria barra
 *  invertida (de novo) e as aspas duplas que sobraram (sintaxe de aspas do PostgREST, que usa `\\` e `\"`). */
export function escaparBuscaIlike(q: string): string {
  const semCuringa = q.replace(/[\\%_]/g, (c) => `\\${c}`);
  const comAspas = `%${semCuringa}%`.replace(/[\\"]/g, (c) => `\\${c}`);
  return `"${comAspas}"`;
}
