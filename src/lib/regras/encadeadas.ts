/** "Adicionar outra ação" (Etapa 3J, Tarefa 5): o que fazer com uma execução que espera a anterior
 *  (`execucoes.depois_de`). Módulo puro; o job (`src/lib/jobs/encadeadas.ts`) lê o banco e grava. */

export type StatusAnterior = "agendada" | "enviando" | "concluida" | "cancelada" | "pulada" | "bloqueada";

/** Folga entre o fim da anterior e o começo da seguinte. */
export const FOLGA_ENCADEADA_MS = 30_000;

export const MOTIVO_ANTERIOR_CANCELADA = "A ação anterior foi cancelada.";
export const MOTIVO_ANTERIOR_BLOQUEADA = "A ação anterior foi bloqueada.";
export const MOTIVO_ANTERIOR_EXCLUIDA = "A ação anterior foi excluída.";
export const MOTIVO_ANTERIOR_PULADA = "A ação anterior foi pulada.";

export type DecisaoEncadeada = { tipo: "esperar" } | { tipo: "liberar"; agendadaPara: string } | { tipo: "cancelar"; motivo: string };

/**
 * - `concluida` sem tarefa pendente (fila/processando) → libera: `agendada_para` = o maior entre o horário dela e
 *   agora + 30 s (uma agendada pra mais tarde continua no horário dela).
 * - `cancelada` / `bloqueada` / `pulada` → cancela (a anterior não terminou de verdade, a corrente para ali; nada
 *   sai fora de ordem).
 * - `agendada` / `enviando` / concluída ainda com tarefa pendente → espera.
 * - Anterior sumiu (`null`: não deveria acontecer, a FK é `on delete set null`) → libera, pra nunca ficar presa.
 */
export function decidirEncadeada(
  p: { statusAnterior: StatusAnterior | null; anteriorComPendentes: boolean; agendadaPara: string },
  agora: Date,
): DecisaoEncadeada {
  const liberar = (): DecisaoEncadeada => ({
    tipo: "liberar",
    agendadaPara: new Date(Math.max(new Date(p.agendadaPara).getTime(), agora.getTime() + FOLGA_ENCADEADA_MS)).toISOString(),
  });
  switch (p.statusAnterior) {
    case null:
      return liberar();
    case "concluida":
      return p.anteriorComPendentes ? { tipo: "esperar" } : liberar();
    case "cancelada":
      return { tipo: "cancelar", motivo: MOTIVO_ANTERIOR_CANCELADA };
    case "bloqueada":
      return { tipo: "cancelar", motivo: MOTIVO_ANTERIOR_BLOQUEADA };
    case "pulada":
      return { tipo: "cancelar", motivo: MOTIVO_ANTERIOR_PULADA };
    default:
      return { tipo: "esperar" };
  }
}
