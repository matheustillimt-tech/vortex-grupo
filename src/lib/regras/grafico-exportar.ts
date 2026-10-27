import { dataDoArquivo, montarCsv } from "./csv";
import { rotuloData } from "./serie-metrica";

/** Regras puras do menu de download dos gráficos (`MenuGrafico`) e do seletor de intervalo de datas
 *  (`SeletorIntervalo`). Sem I/O: quem chama lê/escreve o DOM
 *  e a URL. */

/** "Cliques diários" → "cliques-diarios" (sem acento, só letras/números/hífen, sem hífen nas pontas). */
export function slugDoTitulo(titulo: string): string {
  return titulo
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Nome do arquivo baixado: "{titulo-em-slug}-{aaaa-mm-dd}.{ext}" (data de hoje em Brasília, como os outros
 *  downloads do app). Um título sem letra/número nenhuma (ex.: só emoji ou pontuação) vira slug vazio — cai
 *  pra "grafico", nunca um nome começando com "-". */
export function nomeArquivoGrafico(titulo: string, ext: "svg" | "png" | "csv", agora: Date = new Date()): string {
  return `${slugDoTitulo(titulo) || "grafico"}-${dataDoArquivo(agora)}.${ext}`;
}

/** CSV de uma série do gráfico ("Download CSV" do menu): cabeçalho "Data;{titulo}", uma linha por ponto, data
 *  dd/mm/aaaa — mesmo formato dos outros CSVs do app (`;`, BOM, CRLF via `montarCsv`). */
export function csvDaSerie(titulo: string, serie: { data: string; valor: number }[]): string {
  return montarCsv(["Data", titulo], serie.map((p) => [rotuloData(p.data), String(p.valor)]));
}

const FORMATO_DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Lê "Selecione o intervalo de datas": datas inválidas, invertidas (fim antes do início) ou mais longas que
 *  `maxDias` → `null` (sem intervalo — a tela usa o período de hoje). `de`/`ate` no formato de `<input
 *  type="date">` ("aaaa-mm-dd"). */
export function lerIntervalo(de: string, ate: string, maxDias = 90): { de: string; ate: string } | null {
  if (!FORMATO_DATA.test(de) || !FORMATO_DATA.test(ate)) return null;
  const dDe = new Date(`${de}T00:00:00Z`);
  const dAte = new Date(`${ate}T00:00:00Z`);
  if (Number.isNaN(dDe.getTime()) || Number.isNaN(dAte.getTime())) return null;
  if (dAte.getTime() < dDe.getTime()) return null;
  const dias = Math.round((dAte.getTime() - dDe.getTime()) / 86_400_000);
  if (dias > maxDias) return null;
  return { de, ate };
}
