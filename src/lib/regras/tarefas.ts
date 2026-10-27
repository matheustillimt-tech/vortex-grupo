import { prioridadeDe, type TipoExecucao } from "./conteudo";
import { espacarEnvios } from "./espacamento";
import { pulaSeAtrasada } from "./sequencia";

export type ExecucaoPlanejavel = {
  execucaoId: string;
  tipo: TipoExecucao;
  agendadaPara: string;
  grupos: { grupoId: string; conexaoId: string; numero: number }[];
  /** Faixa entre grupos escolhida na ação (`segundosEntreGrupos`); ausente/null = padrão de 3–8 s. */
  intervaloSeg?: { min: number; max: number } | null;
  /** Prioridade da execução (`prioridadeDaExecucao`); ausente = a do tipo (`prioridadeDe`), como antes. */
  prioridade?: 0 | 1;
};

/** Prioridade das tarefas de uma execução: a do tipo (mensagens e enquetes 0, ações 1). A atualização periódica
 *  de links (`periodico:…`) é ação como as outras: nunca passa na frente de disparo. */
export function prioridadeDaExecucao(e: { tipo: TipoExecucao; origem?: string | null; gatilhoChave?: string | null }): 0 | 1 {
  return prioridadeDe(e.tipo);
}
export type TarefaPlanejada = { execucaoId: string; tipo: TipoExecucao; prioridade: 0 | 1; grupoId: string; conexaoId: string; enviarApos: Date };

/** Todas as execuções que vencem no mesmo tick viram tarefas juntas: mensagens e enquetes (prioridade 0) antes
 *  das ações no grupo (1), depois por horário da execução e número do grupo. O espaçamento de 3–8 s por número vale
 *  entre todas elas (`espacarEnvios`). */
export function planejarTarefas(execucoes: ExecucaoPlanejavel[], inicio: Date, aleatorio: () => number = Math.random): TarefaPlanejada[] {
  const itens = execucoes.flatMap((e) =>
    e.grupos.map((g) => ({
      execucaoId: e.execucaoId,
      tipo: e.tipo,
      prioridade: e.prioridade ?? prioridadeDe(e.tipo),
      agendada: new Date(e.agendadaPara).getTime(),
      numero: g.numero,
      grupoId: g.grupoId,
      conexaoId: g.conexaoId,
      intervaloSeg: e.intervaloSeg ?? null,
    })),
  );
  itens.sort((a, b) => a.prioridade - b.prioridade || a.agendada - b.agendada || a.numero - b.numero);
  return espacarEnvios(itens, inicio, aleatorio).map(({ execucaoId, tipo, prioridade, grupoId, conexaoId, enviarApos }) => ({
    execucaoId,
    tipo,
    prioridade,
    grupoId,
    conexaoId,
    enviarApos,
  }));
}

/** Ordem de execução dentro de um lote de `pegar_tarefas` (o `returning` do Postgres não garante ordem): a mesma
 *  do banco, prioridade antes do horário (mensagem vencida passa na frente de troca de nome/imagem já na fila). */
export function compararTarefas(a: { enviar_apos: string; prioridade: number }, b: { enviar_apos: string; prioridade: number }): number {
  return a.prioridade - b.prioridade || new Date(a.enviar_apos).getTime() - new Date(b.enviar_apos).getTime();
}

const CINCO_MIN = 5 * 60_000;
const QUINZE_MIN = 15 * 60_000;

export type DecisaoExecucaoVazia = "esperar" | "reagendar" | "pular";

/** Execução em 'enviando' sem nenhuma tarefa: pode estar no meio do `iniciar` de outro tick (espera), ou o `iniciar`
 *  morreu antes de inserir as tarefas. Passados 5 min do início, volta pra 'agendada' pro próximo tick refazer; passo
 *  de sequência ou ação de cronograma de automação (`pulaSeAtrasada`) que já está mais de 15 min atrasado não dispara
 *  atrasado: vira 'pulada'. Sem `iniciadaEm` (linha de
 *  antes da coluna existir) conta como antiga. */
export function decidirExecucaoVazia(e: { iniciadaEm: string | null; origem: string; gatilhoChave?: string | null; agendadaPara: string }, agora: Date): DecisaoExecucaoVazia {
  if (e.iniciadaEm && agora.getTime() - new Date(e.iniciadaEm).getTime() <= CINCO_MIN) return "esperar";
  if (pulaSeAtrasada(e) && new Date(e.agendadaPara).getTime() < agora.getTime() - QUINZE_MIN) return "pular";
  return "reagendar";
}
