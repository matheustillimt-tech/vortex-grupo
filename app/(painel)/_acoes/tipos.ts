import type { TipoExecucao } from "@/src/lib/regras/conteudo";
import type { CorSituacaoAcao, SituacaoAcao } from "@/src/lib/regras/acoes";

/** Linhas por página aceitas pelas telas de Ações (brief da Etapa 3B, Task 2). Mora aqui (e não em `comum.ts`, o
 *  carregador) porque `filtros.tsx`, que é cliente, também usa. */
export const POR_PAGINA_ACOES = [10, 25, 50, 100, 200, 300] as const;
export const POR_PAGINA_PADRAO = 10;

/** Opções de "Linhas por página" da aba Mensagens da campanha — mais curta que `POR_PAGINA_ACOES`
 *  (10/25/50). */
export const POR_PAGINA_MENSAGENS = [10, 25, 50] as const;

/** Lê `?por=` da aba Mensagens contra a lista curta (`POR_PAGINA_MENSAGENS`), não a de Ações
 *  (`POR_PAGINA_ACOES`, que também aceita 100/200/300): um link antigo ou editado à mão com 100/200/300 cai na
 *  opção permitida mais próxima (50, já que são todos maiores que o máximo) em vez do padrão (10) — e qualquer
 *  outro valor fora da lista cai no padrão, como antes (revisão final B, item m11). */
export function lerPorPaginaMensagens(v: string | undefined): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return POR_PAGINA_PADRAO;
  if ((POR_PAGINA_MENSAGENS as readonly number[]).includes(n)) return n;
  if (n > POR_PAGINA_MENSAGENS[POR_PAGINA_MENSAGENS.length - 1]) return POR_PAGINA_MENSAGENS[POR_PAGINA_MENSAGENS.length - 1];
  return POR_PAGINA_PADRAO;
}

/** Contadores de tarefas de uma execução agrupada (`Agrupar: Sim`): total e quanto está em cada situação. */
export type ContadoresAcao = { total: number; processando: number; sucesso: number; falha: number };

/**
 * Um cartão da lista de Ações — uma execução inteira (`Agrupar: Sim`) ou uma tarefa dela (`Agrupar: Não`).
 * Construído no servidor (`_acoes/comum.ts`) a partir de `listar_acoes` + `execucoes` + `tarefas`, com nomes de
 * conta/campanha/grupo já resolvidos em lote — o cliente (`lista-acoes.tsx`) só desenha.
 */
export type AcaoCartao = {
  /** Chave de linha: o id da execução (`Agrupar: Sim`) ou `"<execucaoId>:<tarefaId>"` (`Agrupar: Não`). */
  id: string;
  /** Id da execução de verdade — é o que as ações em massa e o link de detalhe usam, nos dois modos. */
  execucaoId: string;
  tipo: TipoExecucao;
  titulo: string;
  situacao: { rotulo: SituacaoAcao; cor: CorSituacaoAcao };
  campanhaId: string;
  campanhaNome: string;
  conteudo: unknown;
  importante: boolean;
  /** `execucoes.origem` (avulsa, sequencia, massa, grupo_novo, automacao, campanha) — rótulo em `ROTULO_ORIGEM`. */
  origem: string;
  agendadaPara: string;
  motivo: string | null;
  criadaEm: string;
  iniciadaEm: string | null;
  terminadaEm: string | null;
  duracao: string | null;
  /** `Agrupar: Sim`: contadores de tarefas em vez de um grupo só. */
  contadores?: ContadoresAcao;
  /** Nome da conta — só quando todas as tarefas da execução são da mesma conexão (ou, em `Agrupar: Não`, a da própria tarefa). `null`: várias contas distintas. */
  contaNome?: string | null;
  /** `Agrupar: Não`: nome do grupo da tarefa. */
  grupoNome?: string;
  /** `Agrupar: Não`: andamento da ação inteira (ex.: "3/10"), já que o selo do cartão é o da tarefa. */
  detalheAcao?: string | null;
  /** Entregues/lidos da ação inteira (mensagem e enquete), nos dois modos. */
  entregues?: number;
  lidos?: number;
  /** Confirmação de entrega (seção da campanha ligada): linha já pronta ("Entrega confirmada: N/M grupos"). */
  entrega?: string;
  /** "Adicionar outra ação": espera a anterior terminar (chip "Depois da ação anterior"); `titulo` = o da anterior. */
  depoisDe?: { titulo: string | null } | null;
  podeEnviarAgora: boolean;
  podeCancelar: boolean;
  podeReprocessar: boolean;
};

// `urlAcoes` mora aqui (arquivo comum, sem "use client") porque as páginas do servidor também chamam.
export type FiltrosAcoes = {
  aba: string;
  tipos: TipoExecucao[] | null;
  agrupar: boolean;
  inicio: string;
  fim: string;
  por: number;
  pagina: number;
};

/** Opções de `urlAcoes` pra uso embutido (aba "Ações" do detalhe da conta, Etapa 3K Tarefa 4): `prefixo` evita
 *  colisão com o `?aba=` da aba de cima (viram `?{prefixo}aba=`, `?{prefixo}tipos=`…) e `fixos` grava parâmetros
 *  constantes em toda URL (ex.: `aba: "acoes"`, pra manter a aba de cima selecionada). Sem as duas, o comportamento
 *  é idêntico ao de antes (tela global `/acoes`). */
export type OpcoesUrlAcoes = { prefixo?: string; fixos?: Record<string, string> };

/** Monta a URL de `/acoes`, `/campanhas/{id}/acoes`, `/campanhas/{id}/mensagens` ou `/numeros/{id}` (embutida, com
 *  `opcoes`) com os filtros atuais + o que mudou — qualquer campo de página (exceto `pagina`) volta para a página 1. */
export function urlAcoes(base: string, f: FiltrosAcoes, mudar: Partial<FiltrosAcoes>, opcoes?: OpcoesUrlAcoes): string {
  const pre = opcoes?.prefixo ?? "";
  const novo = { ...f, ...mudar };
  if (!("pagina" in mudar)) novo.pagina = 1;
  const p = new URLSearchParams();
  if (opcoes?.fixos) for (const [k, v] of Object.entries(opcoes.fixos)) p.set(k, v);
  if (novo.aba !== "todas") p.set(`${pre}aba`, novo.aba);
  if (novo.tipos?.length) p.set(`${pre}tipos`, novo.tipos.join(","));
  if (!novo.agrupar) p.set(`${pre}agrupar`, "nao");
  if (novo.inicio) p.set(`${pre}inicio`, novo.inicio);
  if (novo.fim) p.set(`${pre}fim`, novo.fim);
  if (novo.por !== 10) p.set(`${pre}por`, String(novo.por));
  if (novo.pagina > 1) p.set(`${pre}pagina`, String(novo.pagina));
  const s = p.toString();
  return `${base}${s ? `?${s}` : ""}`;
}
