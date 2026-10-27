/** Regras da Visão geral de Leads (Etapa 3I, Tarefa 1): o lead como cadastro
 *  (`contatos`), em vez da participação. Mora separado de `pessoas.ts` porque usa outra RPC (`listar_leads` /
 *  `contar_leads`), aditiva às de participações. */

/** Uma linha de `listar_leads`: uma pessoa (telefone canônico), com nome e campos de `contatos` (nulo/vazio se
 *  nunca foi cadastrada à mão) e as tags agregadas. */
export type LeadLinha = {
  telefone: string;
  nome: string | null;
  campos: Record<string, string>;
  tags: string[];
};

export const MAXIMO_CAMPOS = 20;
export const MAXIMO_LETRAS_CHAVE = 40;
export const MAXIMO_LETRAS_VALOR = 200;
export const MAXIMO_LETRAS_NOME = 80;

/** Campos personalizados pro banco: até `MAXIMO_CAMPOS` pares, chave 1–40 letras (sem espaços nas pontas, não
 *  vazia depois de cortar) e valor até 200 — ou a mensagem de erro. Pares com chave vazia são ignorados (linha
 *  em branco do formulário), não contam erro. Chave repetida (sem diferenciar maiúsculas) é erro. */
export function validarCampos(bruto: unknown): { campos: Record<string, string> } | { erro: string } {
  if (!Array.isArray(bruto)) return { campos: {} };
  const pares = bruto.filter(
    (p): p is { chave: unknown; valor: unknown } => typeof p === "object" && p !== null && "chave" in p,
  );
  const campos: Record<string, string> = {};
  const vistas = new Set<string>();
  let n = 0;
  for (const p of pares) {
    const chave = typeof p.chave === "string" ? p.chave.trim() : "";
    if (!chave) continue;
    if (n >= MAXIMO_CAMPOS) return { erro: `No máximo ${MAXIMO_CAMPOS} campos personalizados.` };
    if (chave.length > MAXIMO_LETRAS_CHAVE) return { erro: `Nome do campo com no máximo ${MAXIMO_LETRAS_CHAVE} letras.` };
    const valor = typeof p.valor === "string" ? p.valor : "";
    if (valor.length > MAXIMO_LETRAS_VALOR) return { erro: `Valor do campo "${chave}" com no máximo ${MAXIMO_LETRAS_VALOR} letras.` };
    const chaveMin = chave.toLowerCase();
    if (vistas.has(chaveMin)) return { erro: `Campo "${chave}" repetido.` };
    vistas.add(chaveMin);
    campos[chave] = valor;
    n++;
  }
  return { campos };
}

/** Nome do lead: vazio vira `null` (sem nome, mostra só o telefone); até 80 letras. */
export function validarNomeLead(bruto: unknown): { nome: string | null } | { erro: string } {
  if (bruto !== undefined && bruto !== null && typeof bruto !== "string") return { erro: "Nome inválido." };
  const nome = typeof bruto === "string" ? bruto.trim() : "";
  if (nome.length > MAXIMO_LETRAS_NOME) return { erro: `Nome com no máximo ${MAXIMO_LETRAS_NOME} letras.` };
  return { nome: nome || null };
}

/** "chave: valor; chave2: valor2" pra célula do CSV (ordem de inserção do objeto). */
export function camposParaTexto(campos: Record<string, string>): string {
  return Object.entries(campos)
    .map(([k, v]) => `${k}: ${v}`)
    .join("; ");
}
