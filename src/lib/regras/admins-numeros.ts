import { normalizarTelefone, variantesTelefone } from "../telefone";

/** Etapa 3K, Tarefa 1: administradores por número ("NOVO ADMINISTRADOR") de uma campanha
 *  (`campanha_admins_numeros`). Lista vazia = comportamento de hoje (só as contas viram admin). */
export const MAXIMO_ADMINS_NUMEROS = 20;
export const ERRO_ADMIN_E_CONTA = "Esse número já é uma conexão da campanha";
export const ERRO_MAXIMO_ADMINS = "No máximo 20 administradores por número";
export const ERRO_TELEFONE_ADMIN = "Telefone inválido: use DDD + número (ou + e o código do país).";

/** DDDs brasileiros em uso (Anatel). */
const DDDS_BR = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92,
  93, 94, 95, 96, 97, 98, 99,
]);

/** Número brasileiro sem DDI plausível: DDD em uso + 9 dígitos começando em 9 (celular) ou 8 dígitos começando em
 *  2–9 (fixo, ou celular na forma sem o nono dígito que o WhatsApp às vezes usa). */
function brasileiroSemDdi(d: string): boolean {
  if (!DDDS_BR.has(Number(d.slice(0, 2)))) return false;
  if (d.length === 11) return d[2] === "9";
  return d.length === 10 && /[2-9]/.test(d[2]);
}

/**
 * Normalizador SÓ dos administradores por número (Etapa 3K, revisão da Tarefa 1). O `normalizarTelefone` global
 * (anti-spam, leads, webhooks…) não muda: ele põe 55 em qualquer número de 10 ou 11 dígitos, e um estrangeiro de
 * 11 dígitos sem "+" (ex.: EUA `14155551234`) viraria um brasileiro inexistente — e virar admin de grupo é uma
 * permissão, então aqui a regra é conservadora:
 * - começando com `+`: os dígitos como estão (11 a 15), sem pôr 55;
 * - 10 ou 11 dígitos sem `+`: só se for um número brasileiro plausível (DDD em uso; 11 dígitos = celular com 9;
 *   10 = começa em 2–9), e aí ganha 55;
 * - 12 ou 13 dígitos começando com 55: DDD em uso (13 = celular com 9);
 * - outros 12 a 15 dígitos sem `+`: aceitos como estão (já trazem o código do país, como no normalizador global).
 * Qualquer outra coisa: `null`.
 */
export function normalizarTelefoneAdmin(bruto: string): string | null {
  const texto = bruto.trim();
  const d = texto.replace(/\D/g, "");
  if (texto.startsWith("+")) return d.length >= 11 && d.length <= 15 ? d : null;
  if (d.length === 10 || d.length === 11) return brasileiroSemDdi(d) ? `55${d}` : null;
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) return brasileiroSemDdi(d.slice(2)) ? d : null;
  return d.length >= 12 && d.length <= 15 ? d : null;
}

export type ResultadoAdminsNumeros = { ok: true; valor: string[] } | { ok: false; erro: string };

/**
 * Normaliza a lista digitada nos campos "Contato *" com `normalizarTelefoneAdmin` (a forma do normalizador do
 * anti-spam, só dígitos com DDI 55 nos brasileiros, porém mais conservadora com 10/11 dígitos), tira vazios e duplicados (com e sem
 * o nono dígito contam como o mesmo, por `variantesTelefone`), recusa o telefone da conta criadora e dos números
 * conectados da campanha (`contasDaCampanha`, que já viram admin pelas contas) e passa de 20.
 */
export function normalizarAdminsNumeros(lista: unknown, contasDaCampanha: (string | null | undefined)[] = []): ResultadoAdminsNumeros {
  if (!Array.isArray(lista)) return { ok: false, erro: "Lista de administradores inválida." };
  const contas = new Set<string>();
  for (const c of contasDaCampanha) {
    const t = c ? normalizarTelefone(c) : null;
    if (t) for (const v of variantesTelefone(t)) contas.add(v);
  }
  const vistos = new Set<string>();
  const valor: string[] = [];
  for (const bruto of lista) {
    if (typeof bruto !== "string") return { ok: false, erro: ERRO_TELEFONE_ADMIN };
    if (!bruto.trim()) continue;
    const t = normalizarTelefoneAdmin(bruto);
    if (!t) return { ok: false, erro: ERRO_TELEFONE_ADMIN };
    const variantes = variantesTelefone(t);
    if (variantes.some((v) => contas.has(v))) return { ok: false, erro: ERRO_ADMIN_E_CONTA };
    if (variantes.some((v) => vistos.has(v))) continue;
    for (const v of variantes) vistos.add(v);
    valor.push(t);
  }
  if (valor.length > MAXIMO_ADMINS_NUMEROS) return { ok: false, erro: ERRO_MAXIMO_ADMINS };
  return { ok: true, valor };
}

/** O que mudou entre a lista salva e a nova: `novos` (entram) e `tirados` (saem). Com e sem o nono dígito contam
 *  como o mesmo número (não vira um "tira e põe"). */
export function diffAdmins(antes: string[], depois: string[]): { novos: string[]; tirados: string[] } {
  const chaves = (l: string[]) => new Set(l.flatMap(variantesTelefone));
  const a = chaves(antes);
  const d = chaves(depois);
  return {
    novos: depois.filter((t) => !variantesTelefone(t).some((v) => a.has(v))),
    tirados: antes.filter((t) => !variantesTelefone(t).some((v) => d.has(v))),
  };
}

/** Campo "Contato *" de um telefone já salvo (normalizado, com DDI): brasileiro com a máscara; estrangeiro ganha
 *  "+" pra não ser lido de novo como brasileiro sem DDI por `normalizarTelefoneAdmin`. */
export function campoDeTelefoneSalvo(telefone: string): string {
  return mascaraTelefoneBr(`+${telefone}`);
}

/** Máscara BR enquanto digita: `(11) 9xxxx-xxxx`; com DDI 55 na frente, `+55 (11) 9xxxx-xxxx`; começando com `+`
 *  de outro país (ou mais de 11 dígitos sem 55), `+` e os dígitos. O `+` digitado é mantido, porque muda a leitura
 *  em `normalizarTelefoneAdmin`. Só visual: quem grava é `normalizarAdminsNumeros`. */
export function mascaraTelefoneBr(digitado: string): string {
  const d = digitado.replace(/\D/g, "").slice(0, 15);
  if (!d) return digitado.trim().startsWith("+") ? "+" : "";
  const comMais = digitado.trim().startsWith("+");
  const br = (x: string) => {
    if (x.length <= 2) return `(${x}`;
    const ddd = x.slice(0, 2);
    const resto = x.slice(2);
    const corte = resto.length > 8 ? 5 : 4;
    return resto.length <= corte ? `(${ddd}) ${resto}` : `(${ddd}) ${resto.slice(0, corte)}-${resto.slice(corte)}`;
  };
  if (comMais && !d.startsWith("55")) return `+${d}`;
  if (comMais && d.length <= 2) return `+${d}`;
  if (comMais || (d.length > 11 && d.startsWith("55"))) return d.length <= 13 ? `+55 ${br(d.slice(2))}` : `+${d}`;
  if (d.length <= 11) return br(d);
  return `+${d}`;
}

/**
 * Números (já normalizados) que não colidem com os telefones das contas informadas (criadora + admins de conta
 * de uma campanha) — usado ao aplicar o Padrão de criação (Etapa 3K, Tarefa 2) numa campanha nova ou existente:
 * nunca faz a lista inteira falhar por um conflito (diferente de `normalizarAdminsNumeros`), só tira o número que
 * colide, porque o padrão é aplicado em várias campanhas com contas diferentes.
 */
export function semConflitoDeContas(numeros: string[], telefonesContas: (string | null | undefined)[]): string[] {
  const contas = new Set<string>();
  for (const c of telefonesContas) {
    const t = c ? normalizarTelefone(c) : null;
    if (t) for (const v of variantesTelefone(t)) contas.add(v);
  }
  return numeros.filter((n) => !variantesTelefone(n).some((v) => contas.has(v)));
}

/** Lotes de até `tamanho` (o job manda os números ao Zapbot de 5 em 5). */
export function emLotes<T>(lista: T[], tamanho = 5): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < lista.length; i += tamanho) lotes.push(lista.slice(i, i + tamanho));
  return lotes;
}
