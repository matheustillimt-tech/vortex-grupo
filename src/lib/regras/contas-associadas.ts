/**
 * Regras da aba "Contas associadas" (Etapa 3D, Tarefa 3). Funções puras — quem lê/escreve no banco é
 * `app/(painel)/campanhas/[id]/contas/actions.ts`.
 */

/** A conta criadora (`campanhas.conexao_criadora_id`) nunca pode ser removida direto: tem que trocar o número
 *  que cria os grupos nas configurações antes. */
export function contaECriadora(conexaoId: string, criadoraId: string | null): boolean {
  return !!criadoraId && conexaoId === criadoraId;
}

export const MENSAGEM_NAO_REMOVE_CRIADORA = "Troque o número que cria os grupos antes de remover esta conexão.";

/** Motivo gravado em `execucoes.motivo` quando a conta removida era a única do alvo da execução agendada — a
 *  execução é cancelada (nunca vira `null`/`[]`, que pros jobs quer dizer "todas as contas"). Idêntico ao texto de
 *  `remover_conta_das_execucoes` (migração 20261017120100_campanha_contas.sql). */
export const MOTIVO_CONTA_SAIU = "A conexão escolhida saiu da campanha.";

/** Contagens devolvidas por `remover_conta_das_execucoes` / `aplicar_contas_campanha` (`mantidas` só existe quando
 *  a reassociação automática está desligada). */
export type ContagemExecucoes = { reassociadas: number; canceladas: number; mantidas?: number };

/** Frase com o que aconteceu com as ações agendadas que usavam a(s) conexão(ões) que saíram; `null` quando nenhuma
 *  foi afetada. */
export function mensagemExecucoes(c: ContagemExecucoes): string | null {
  const partes: string[] = [];
  if (c.reassociadas > 0) partes.push(`${c.reassociadas} ação(ões) agendada(s) passaram a usar só as conexões que restaram`);
  if (c.canceladas > 0) partes.push(`${c.canceladas} ação(ões) agendada(s) foram canceladas porque só usavam essa conexão`);
  if (c.mantidas && c.mantidas > 0) partes.push(`${c.mantidas} ação(ões) agendada(s) continuam usando a conexão que saiu (reassociação automática desligada)`);
  return partes.length ? `${partes.join("; ")}.` : null;
}
