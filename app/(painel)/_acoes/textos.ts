import type { ResultadoExclusao } from "./execucoes";

/** Textos da lista de Ações (pura, sem nada de servidor: `lista-acoes.tsx`, que é cliente, importa daqui). */

export type AcaoLote = "enviar" | "travadas" | "reprocessar" | "cancelar" | "excluir";

/** "2 excluída(s); 1 de sequência/automação cancelada(s) …; 1 em andamento (não mexida(s))." */
export function textoExclusao(x: ResultadoExclusao): string {
  const partes = [`${x.apagadas} excluída(s)`];
  if (x.canceladas) partes.push(`${x.canceladas} de sequência/automação cancelada(s) em vez de apagada(s), pra não voltar(em) a ser enviada(s)`);
  if (x.puladas) partes.push(`${x.puladas} em andamento (não mexida(s))`);
  return `${partes.join("; ")}.`;
}

/** Texto do `confirm` antes de rodar uma ação. Com "Agrupar: Não" cada cartão é um grupo, mas Cancelar, Reprocessar e
 *  Excluir valem pra ação inteira (todos os grupos dela) — o aviso deixa isso claro. `null`: não precisa confirmar. */
export function textoConfirmacao(chave: AcaoLote, n: number, agrupar: boolean): string | null {
  const todaAcao = agrupar ? "" : " Vale para a ação inteira (todos os grupos dela), não só para o grupo deste cartão.";
  switch (chave) {
    case "travadas":
      return "Reenviar as tarefas travadas há mais de 5 minutos? Algumas podem já ter chegado no grupo: confira antes, senão a mensagem pode sair duas vezes.";
    case "cancelar":
      return `Cancelar ${n} ação(ões) agendada(s)?${todaAcao}`;
    case "reprocessar":
      return agrupar ? null : `Reprocessar as falhas de ${n} ação(ões)?${todaAcao}`;
    case "excluir":
      return `Excluir ${n} ação(ões)? Não dá pra desfazer. As de sequência e de automação são canceladas em vez de apagadas, pra não voltarem a ser enviadas.${todaAcao}`;
    default:
      return null;
  }
}
