import { validarChave } from "./variaveis";

export const TIPOS_VARIAVEL = ["texto", "link", "data", "numero"] as const;
export type TipoVariavel = (typeof TIPOS_VARIAVEL)[number];

export const ROTULO_TIPO_VARIAVEL: Record<TipoVariavel, string> = {
  texto: "Texto",
  link: "Link",
  data: "Data",
  numero: "Número",
};

/** Teto de variáveis globais mostradas na seção de valores da campanha (o salvar aceita até 100 valores de uma vez). */
export const MAXIMO_GLOBAIS_NA_CAMPANHA = 100;

export type ValidacaoVariavelGlobal = { ok: true } | { ok: false; erro: string };

export function validarVariavelGlobal(e: { chave: string; tipo: string; categoria: string | null }): ValidacaoVariavelGlobal {
  const erroChave = validarChave(e.chave);
  if (erroChave) return { ok: false, erro: erroChave };
  if (!(TIPOS_VARIAVEL as readonly string[]).includes(e.tipo)) return { ok: false, erro: "Tipo inválido." };
  if (e.categoria !== null && (e.categoria.length < 1 || e.categoria.length > 40)) return { ok: false, erro: "Categoria com 1 a 40 caracteres." };
  return { ok: true };
}

const LINK = /^https?:\/\/\S+$/;
const DATA = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const NUMERO = /^\d+(,\d+)?$/;

function dataValida(dd: string, mm: string, aaaa: string): boolean {
  const d = Number(dd);
  const m = Number(mm);
  const a = Number(aaaa);
  if (m < 1 || m > 12) return false;
  const data = new Date(a, m - 1, d);
  return data.getFullYear() === a && data.getMonth() === m - 1 && data.getDate() === d;
}

/** Valor vazio é sempre permitido (o bloqueio de envio de hoje continua separado). */
export function validarValorPorTipo(tipo: string, valor: string): string | null {
  if (!valor) return null;
  switch (tipo) {
    case "link":
      return LINK.test(valor) ? null : "Link inválido (precisa começar com http:// ou https://).";
    case "data": {
      const m = DATA.exec(valor);
      if (!m || !dataValida(m[1], m[2], m[3])) return "Data inválida (use dd/mm/aaaa).";
      return null;
    }
    case "numero":
      return NUMERO.test(valor) ? null : "Número inválido.";
    default:
      return null;
  }
}

export type LinhaValor = { chave: string; tipo: string; valor: string; global: boolean };

/** Globais primeiro (ordem alfabética), depois as chaves que só existem na campanha. */
export function linhasDeValores(globais: { chave: string; tipo: string }[], valores: { chave: string; valor: string }[]): LinhaValor[] {
  const valorPorChave = new Map(valores.map((v) => [v.chave, v.valor]));
  const chavesGlobais = new Set(globais.map((g) => g.chave));
  const linhasGlobais = [...globais]
    .sort((a, b) => a.chave.localeCompare(b.chave, "pt-BR"))
    .map((g) => ({ chave: g.chave, tipo: g.tipo, valor: valorPorChave.get(g.chave) ?? "", global: true }));
  const linhasCampanha = valores.filter((v) => !chavesGlobais.has(v.chave)).map((v) => ({ chave: v.chave, tipo: "texto", valor: v.valor, global: false }));
  return [...linhasGlobais, ...linhasCampanha];
}
