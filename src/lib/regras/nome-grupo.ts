/** WhatsApp limita o nome do grupo a 25 caracteres. */
export const LIMITE_NOME = 25;

/** Troca `{n}` pelo número do grupo com dois dígitos, com o caractere da numeração da campanha na frente (padrão
 *  vazio = como antes). Usado no "Trocar nome": padrão sem `{n}` é um nome fixo de propósito, então aqui o número
 *  não é acrescentado (a posição de `numero_no_inicio` só vale na criação, que sempre põe o número). */
export function trocarN(padrao: string, n: number, caractere = ""): string {
  return padrao.replaceAll("{n}", `${caractere}${String(n).padStart(2, "0")}`);
}

/** Como o número entra no nome do grupo criado (Etapa 3E). Padrão: sem caractere, no fim — o nome de antes. */
export type Numeracao = { caractere?: string; noInicio?: boolean };

/** Nome de grupo criado; corta em 25. O número (dois dígitos) vem com o `caractere` da numeração na frente (padrão
 *  vazio: o "#" de padrões como "AULÃO #{n}" já vem do próprio padrão). Com `{n}` no padrão, ele marca a posição;
 *  sem `{n}`, o número vai no fim (ou no começo, com `noInicio`), separado por espaço. */
export function nomeDoGrupo(padrao: string, n: number, numeracao: Numeracao = {}): string {
  const numero = `${numeracao.caractere ?? ""}${String(n).padStart(2, "0")}`;
  const nome = padrao.includes("{n}")
    ? padrao.replaceAll("{n}", numero)
    : numeracao.noInicio
      ? `${numero} ${padrao}`
      : `${padrao} ${numero}`;
  return Array.from(nome).slice(0, LIMITE_NOME).join("");
}

/** Garante que o padrão tenha `{n}`, pra "Alterar grupos em lote" (Etapa 3E, revisão final) nunca dar o mesmo
 *  nome pra todos os grupos — diferente do "Editar" de um grupo só (`trocarN`), que mantém o nome fixo de
 *  propósito quando não há `{n}`. Mesma regra de posição de `nomeDoGrupo`: sem `{n}`, o número entra no fim
 *  (`padrao + " {n}"`) ou no início com `noInicio` (`"{n} " + padrao`). Só insere o marcador — quem troca por
 *  número é `trocarN`, aplicado por grupo na hora de executar. */
export function padraoComNumero(padrao: string, noInicio = false): string {
  if (padrao.includes("{n}")) return padrao;
  return noInicio ? `{n} ${padrao}` : `${padrao} {n}`;
}

/** Ação "trocar nome": o primeiro nome (já com `{n}` trocado) que passa de 25 caracteres, ou null se todos cabem.
 *  Não corta: nome longo bloqueia a execução. */
export function nomeLongo(padrao: string, numeros: number[], caractere = ""): string | null {
  for (const n of numeros) {
    const nome = trocarN(padrao, n, caractere);
    if (Array.from(nome).length > LIMITE_NOME) return nome;
  }
  return null;
}

/** "Trocar nome" da campanha inteira: padrão sem `{n}` ganha o número, pra os grupos nunca
 *  ficarem todos com o mesmo nome. Sem caractere de numeração na campanha, entra "#" ("É HOJE #01"); com caractere,
 *  ele já vem na frente do número (`trocarN`). */
export function padraoNumerado(padrao: string, caractere = "", noInicio = false): string {
  if (padrao.includes("{n}")) return padrao;
  const marca = caractere ? "{n}" : "#{n}";
  return noInicio ? `${marca} ${padrao}` : `${padrao} ${marca}`;
}

/** Nome do grupo sem o número dele, pro cartão da campanha ("🔥 22/10: 100K COM IA #01" → "🔥 22/10: 100K COM IA").
 *  Tira o número (com ou sem zero à esquerda) do fim ou do começo, junto do caractere de numeração colado nele
 *  (#, nº, |, -, .). Sem o número no nome, devolve o nome como está. */
export function nomeSemNumero(nome: string, numero: number): string {
  const n = `0*${numero}`;
  // Antes do número: o caractere de numeração (com ou sem espaço) ou ao menos um espaço — "IA 21" no grupo 1 fica.
  const fim = new RegExp(`(?:\\s*(?:#|n[º°]|[|\\-–.])\\s*|\\s+)${n}\\s*$`, "u");
  const comeco = new RegExp(`^\\s*(?:#|n[º°])?\\s*${n}(?=[\\s|\\-–.])\\s*[|\\-–.]?\\s*`, "u");
  const semFim = nome.replace(fim, "");
  const limpo = semFim !== nome ? semFim : nome.replace(comeco, "");
  return limpo.trim() || nome;
}
