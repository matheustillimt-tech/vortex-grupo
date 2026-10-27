/** Atalhos de formatação do editor de mensagens (negrito, itálico, tachado, monoespaçado, citação) — mesma marcação
 *  do WhatsApp. Módulo puro — sem I/O, sem DOM — pra poder testar a lógica de envolver/desenvolver a seleção fora
 *  do componente. Quem chama (o editor) decide onde fica o cursor depois (ver `NovaSelecao`). */

export type FormatoAplicavel = "negrito" | "italico" | "tachado" | "monoespacado" | "citacao";

const MARCADOR: Record<Exclude<FormatoAplicavel, "citacao">, string> = {
  negrito: "*",
  italico: "_",
  tachado: "~",
  monoespacado: "```",
};

export type NovaSelecao = { texto: string; inicio: number; fim: number };

/** `true` quando `texto[inicio..fim)` já está entre os marcadores do formato (e eles não fazem parte da seleção
 *  em si — ex. selecionar só "abc" dentro de "*abc*"). */
function jaEnvolvido(texto: string, inicio: number, fim: number, marcador: string): boolean {
  const antes = texto.slice(Math.max(0, inicio - marcador.length), inicio);
  const depois = texto.slice(fim, fim + marcador.length);
  return antes === marcador && depois === marcador;
}

/** Envolve a seleção com o marcador do WhatsApp, ou remove o marcador se a seleção já estiver envolvida por ele
 *  (alternar). Seleção vazia: insere o par de marcadores com o cursor entre eles. Devolve o texto novo e a nova
 *  seleção (pra o editor reposicionar o cursor). */
export function aplicarNegritoItalicoEtc(texto: string, inicio: number, fim: number, formato: Exclude<FormatoAplicavel, "citacao">): NovaSelecao {
  const marcador = MARCADOR[formato];
  const selecionado = texto.slice(inicio, fim);

  if (jaEnvolvido(texto, inicio, fim, marcador)) {
    const novoInicio = inicio - marcador.length;
    const novoFim = fim - marcador.length;
    return {
      texto: texto.slice(0, novoInicio) + selecionado + texto.slice(fim + marcador.length),
      inicio: novoInicio,
      fim: novoFim,
    };
  }

  const novoTexto = texto.slice(0, inicio) + marcador + selecionado + marcador + texto.slice(fim);
  const novoInicio = inicio + marcador.length;
  return { texto: novoTexto, inicio: novoInicio, fim: novoInicio + selecionado.length };
}

/** "> " no início de cada linha tocada pela seleção (ou da linha do cursor, se não houver seleção); remove o "> "
 *  já existente em todas elas (alternar). Em bloco: ou todas ganham, ou (se já estiverem todas marcadas) todas
 *  perdem — nunca mistura. */
export function aplicarCitacao(texto: string, inicio: number, fim: number): NovaSelecao {
  const inicioLinha = texto.lastIndexOf("\n", Math.max(0, inicio - 1)) + 1;
  let fimLinha = texto.indexOf("\n", fim);
  if (fimLinha === -1) fimLinha = texto.length;

  const bloco = texto.slice(inicioLinha, fimLinha);
  const linhas = bloco.split("\n");
  const todasMarcadas = linhas.every((l) => l.startsWith("> "));

  const novasLinhas = todasMarcadas ? linhas.map((l) => l.slice(2)) : linhas.map((l) => `> ${l}`);
  const novoBloco = novasLinhas.join("\n");
  const delta = todasMarcadas ? -2 : 2;

  return {
    texto: texto.slice(0, inicioLinha) + novoBloco + texto.slice(fimLinha),
    inicio: Math.max(inicioLinha, inicio + delta),
    fim: Math.max(inicioLinha, fim + delta * linhas.length),
  };
}

/** Despacha pro aplicador certo — único ponto que o editor chama. */
export function aplicarFormatacao(texto: string, inicio: number, fim: number, formato: FormatoAplicavel): NovaSelecao {
  return formato === "citacao" ? aplicarCitacao(texto, inicio, fim) : aplicarNegritoItalicoEtc(texto, inicio, fim, formato);
}
