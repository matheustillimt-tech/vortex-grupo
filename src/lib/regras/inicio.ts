import { diaBrasilia } from "./aula";

const BRASILIA_MS = 3 * 3600_000; // UTC−3, sem horário de verão desde 2019

/** Relógio de Brasília nos campos UTC (getUTCHours etc.), sem depender do fuso do servidor. */
const emBrasilia = (d: Date) => new Date(d.getTime() - BRASILIA_MS);
const dois = (n: number) => String(n).padStart(2, "0");

/** "19:50" se for hoje em Brasília; "21/10 19:50" se não. */
export function quandoCurto(iso: string, agora: Date): string {
  const b = emBrasilia(new Date(iso));
  const hora = `${dois(b.getUTCHours())}:${dois(b.getUTCMinutes())}`;
  return diaBrasilia(iso) === diaBrasilia(agora) ? hora : `${dois(b.getUTCDate())}/${dois(b.getUTCMonth() + 1)} ${hora}`;
}

export function formatarNumero(n: number): string {
  return n.toLocaleString("pt-BR");
}

/** "1.284" ou "—" quando a contagem não pôde ser lida (leitura com erro → null). */
export function numeroOuTraco(n: number | null): string {
  return n === null ? "—" : formatarNumero(n);
}

/** "+55 37 9xxxx-xxxx" (13 dígitos, celular com o 9) ou "+55 37 xxxx-xxxx" (12 dígitos, fixo); outros tamanhos
 *  voltam como vieram (sem número de telefone válido pra formatar). */
export function formatarTelefone(tel: string): string {
  if (tel.length === 13) return `+${tel.slice(0, 2)} ${tel.slice(2, 4)} ${tel.slice(4, 9)}-${tel.slice(9)}`;
  if (tel.length === 12) return `+${tel.slice(0, 2)} ${tel.slice(2, 4)} ${tel.slice(4, 8)}-${tel.slice(8)}`;
  return tel;
}

/** Origem + caminho da URL do webhook, sem query string nem token (não mostra o segredo na tela). Se não for
 *  uma URL válida, volta como veio. */
export function urlSemSegredo(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
}

/** Ordem dos cartões do Início (contas, campanhas, webhooks — Etapa 3N), salva por pessoa no navegador
 *  (`localStorage`): aplica a ordem salva sobre os ids de hoje — quem já estava em `salvos` mantém a posição
 *  relativa entre si; quem é novo (criado depois do último salvamento) entra no fim, na ordem que chegou;
 *  quem saiu (apagado/arquivado) simplesmente não aparece. Sem nada salvo (`[]`), a ordem fica a de hoje. */
export function aplicarOrdem(ids: string[], salvos: string[]): string[] {
  const presentes = new Set(ids);
  const ordenados = salvos.filter((id) => presentes.has(id));
  const salvosSet = new Set(ordenados);
  const novos = ids.filter((id) => !salvosSet.has(id));
  return [...ordenados, ...novos];
}

/** Chave de `localStorage` da ordem do Início, prefixada por pessoa quando o identificador (o e-mail de quem
 *  está logado, já disponível como dado no cliente) está disponível — senão a chave fica como estava
 *  (revisão final B, item m10). Sem o prefixo, duas pessoas no mesmo navegador (computador compartilhado)
 *  liam/escreviam a mesma ordem uma da outra. */
export function chaveOrdemInicio(base: string, identificador: string): string {
  return identificador ? `${identificador}:${base}` : base;
}

