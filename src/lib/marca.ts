/** Nome do sistema no logo e na aba do navegador. Troque pela variável `NEXT_PUBLIC_NOME_SISTEMA` (ex.: "Grupos da
 *  Minha Empresa"); sem ela, fica "Vórtex Grupo". Os outros textos das telas citam "Vórtex Grupo" direto no código. */
export const NOME_SISTEMA = process.env.NEXT_PUBLIC_NOME_SISTEMA?.trim() || "Vórtex Grupo";

/** Divide o nome pro logo: a última palavra sai em destaque ("Vórtex" + "Grupo"). */
export function partesDoNome(nome: string = NOME_SISTEMA): [string, string] {
  const i = nome.lastIndexOf(" ");
  return i > 0 ? [nome.slice(0, i + 1), nome.slice(i + 1)] : ["", nome];
}
