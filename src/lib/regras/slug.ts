/** Gera a base do endereço do link a partir do nome da campanha: sem acento, minúsculo, só `[a-z0-9-]`,
 *  sem hífen duplicado nem nas pontas, cortado em 40 (regra de `slug` em `validarCampanha`). Garante o mínimo
 *  de 2 caracteres (preenche com "x" quando o nome não tem letra/número nenhuma, ex.: "!!!"). Quem chama
 *  (`criarCampanha`, em `actions.ts`) garante a unicidade consultando o banco e acrescentando "-2", "-3"… */
export function baseSlug(nome: string): string {
  const s = nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  if (s.length >= 2) return s;
  return (s + "xx").slice(0, 2);
}
