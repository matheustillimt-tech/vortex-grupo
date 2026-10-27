import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fimDoDiaIso, inicioDoDiaIso, lerAbaMensagens } from "@/src/lib/regras/abas-mensagens";
import { duracao, filtroTipos, situacaoAcao, tituloCartao } from "@/src/lib/regras/acoes";
import { situacaoDaExecucao } from "@/src/lib/regras/calendario";
import type { TipoExecucao } from "@/src/lib/regras/conteudo";
import { ehUuid } from "@/src/lib/regras/uuid";
import { resumoDasExecucoes } from "@/src/lib/resumo-execucoes";
import { POR_PAGINA_ACOES, POR_PAGINA_PADRAO, type AcaoCartao, type ContadoresAcao, type FiltrosAcoes } from "./tipos";

export function lerPorPagina(v: string | undefined): number {
  const n = Number(v);
  return (POR_PAGINA_ACOES as readonly number[]).includes(n) ? n : POR_PAGINA_PADRAO;
}

export function lerAgrupar(v: string | undefined): boolean {
  return v !== "nao";
}

/** Query da tela de Ações (`/acoes` e a aba "Ações" do detalhe da conta — Etapa 3K, Tarefa 4): `aba`, `tipos`,
 *  `agrupar`, `inicio`, `fim`, `por`, `pagina`, `automacao` (contadores-links de `/automacoes`), e as mesmas
 *  chaves com o prefixo "sub" (usadas só na versão embutida — ver `lerFiltrosDaTelaAcoes`). */
export type SpTelaAcoes = {
  aba?: string;
  tipos?: string;
  agrupar?: string;
  inicio?: string;
  fim?: string;
  por?: string;
  pagina?: string;
  automacao?: string;
  criada?: string;
  subaba?: string;
  subtipos?: string;
  subagrupar?: string;
  subinicio?: string;
  subfim?: string;
  subpor?: string;
  subpagina?: string;
};

const dataValida = (v: string | undefined) => (inicioDoDiaIso(v) ? (v as string) : "");

/**
 * Lê os filtros da tela de Ações a partir da query. Função pura (sem JSX), extraída de `TelaAcoes`
 * (`tela-acoes.tsx`) pra poder ser testada sem montar o componente — este projeto não roda teste de `.tsx`.
 *
 * Sem `embutida` (tela global `/acoes`): lê as chaves sem prefixo, exatamente como hoje. Com `embutida` (aba
 * "Ações" do detalhe da conta): lê as mesmas chaves com o prefixo "sub" (`?subaba=`, `?subtipos=`…) — o `?aba=`
 * sem prefixo ali é a aba de cima do detalhe da conta (Grupos/Campanhas/…), que não pode ser pisada pelas
 * sub-abas de Ações (Visão geral/Na fila/…). `automacao` nunca leva prefixo (só a tela global recebe esse
 * preset, dos contadores-links de `/automacoes`).
 */
export function lerFiltrosDaTelaAcoes(sp: SpTelaAcoes, embutida: boolean): { filtros: FiltrosAcoes; automacaoId: string | null } {
  const chave = (nome: "aba" | "tipos" | "agrupar" | "inicio" | "fim" | "por" | "pagina"): string | undefined =>
    embutida ? sp[`sub${nome}` as keyof SpTelaAcoes] : sp[nome];
  const filtros: FiltrosAcoes = {
    aba: lerAbaMensagens(chave("aba")),
    tipos: filtroTipos(chave("tipos")),
    agrupar: lerAgrupar(chave("agrupar")),
    inicio: dataValida(chave("inicio")),
    fim: dataValida(chave("fim")),
    por: lerPorPagina(chave("por")),
    pagina: Math.max(1, Math.floor(Number(chave("pagina"))) || 1),
  };
  const automacaoId = ehUuid(sp.automacao) ? sp.automacao : null;
  return { filtros, automacaoId };
}

type DB = Pick<SupabaseClient, "from" | "rpc">;

type ExecucaoLinha = {
  id: string;
  campanha_id: string;
  tipo: TipoExecucao;
  origem: string;
  status: string;
  motivo: string | null;
  agendada_para: string;
  iniciada_em: string | null;
  created_at: string;
  conteudo: unknown;
  conteudo_final: unknown;
  importante: boolean;
  /** "Adicionar outra ação": a execução anterior que esta espera (null = não espera nada). */
  depois_de?: string | null;
};

type TarefaLinha = { id: string; execucao_id: string; grupo_id: string; conexao_id: string; status: string; enviado_em: string | null };

const PODE_FALHA = new Set(["concluida", "bloqueada"]);

/** Nome da conta quando todas as tarefas listadas são da mesma conexão; `null` quando há mais de uma (ou nenhuma). */
function contaUnica(tarefas: TarefaLinha[], nomePorConexao: Map<string, string>): string | null {
  const distintas = new Set(tarefas.map((t) => t.conexao_id));
  if (distintas.size !== 1) return null;
  return nomePorConexao.get([...distintas][0]) ?? null;
}

function contadoresDe(tarefas: TarefaLinha[]): ContadoresAcao {
  let processando = 0, sucesso = 0, falha = 0;
  for (const t of tarefas) {
    if (t.status === "enviado") sucesso++;
    else if (t.status === "erro") falha++;
    else processando++;
  }
  return { total: tarefas.length, processando, sucesso, falha };
}

/** Situação de uma tarefa avulsa (`Agrupar: Não`): herda a fase da execução enquanto ela não terminou; terminada,
 *  cada tarefa mostra o próprio resultado (sucesso/falha), não o da execução como um todo. */
function situacaoDaTarefa(exec: ExecucaoLinha, tarefa: TarefaLinha | undefined, agora: Date) {
  if (!PODE_FALHA.has(exec.status)) return situacaoAcao(exec.status, exec.agendada_para, false, agora);
  if (tarefa?.status === "enviado") return situacaoAcao("concluida", exec.agendada_para, false, agora);
  if (tarefa?.status === "erro") return situacaoAcao("concluida", exec.agendada_para, true, agora);
  return situacaoAcao(exec.status, exec.agendada_para, false, agora);
}

export type ParametrosAcoes = {
  campanhaId: string | null;
  tipos: TipoExecucao[] | null;
  aba: string;
  inicioIso: string | null;
  fimIso: string | null;
  porPagina: number;
  pagina: number;
  agrupar: boolean;
  /** Filtra pela automação (contadores-links da lista de automações, `?automacao=`). `null`/ausente = sem filtro. */
  automacaoId?: string | null;
  /** Filtra pela conta (aba "Ações" do detalhe da conta, Etapa 3G Tarefa 3 — `listar_acoes` já aceita
   *  `p_conexao`). `null`/ausente = sem filtro. */
  conexaoId?: string | null;
};

export type ResultadoAcoes = { linhas: AcaoCartao[]; totalAcoes: number };

/**
 * Carrega a página de ações: `listar_acoes` dá os ids (e o total, sempre em número de ações/execuções — nota
 * que a paginação sempre conta execuções, mesmo com "Agrupar: Não", onde cada execução pode virar várias linhas).
 * Nomes de conta/campanha/grupo e os contadores de `tarefas` vêm em lotes (3 consultas no máximo), nunca N+1.
 */
export async function carregarAcoes(db: DB, p: ParametrosAcoes): Promise<ResultadoAcoes> {
  const { data: pagina, error: erroPagina } = await db.rpc("listar_acoes", {
    p_campanha: p.campanhaId,
    p_conexao: p.conexaoId ?? null,
    p_tipos: p.tipos,
    p_aba: p.aba,
    p_inicio: p.inicioIso,
    p_fim: p.fimIso,
    p_limite: p.porPagina,
    p_deslocamento: (p.pagina - 1) * p.porPagina,
    p_automacao: p.automacaoId ?? null,
  });
  if (erroPagina) throw new Error(`Não foi possível carregar as ações: ${erroPagina.message}`);
  const pagLinhas = (pagina ?? []) as { id: string; total: number | string }[];
  const totalAcoes = Number(pagLinhas[0]?.total ?? 0);
  const ids = pagLinhas.map((l) => l.id);
  if (!ids.length) return { linhas: [], totalAcoes };

  const [{ data: execs, error: erroExecs }, { data: tarefas, error: erroTarefas }, resumos] = await Promise.all([
    db
      .from("execucoes")
      .select("id, campanha_id, tipo, origem, status, motivo, agendada_para, iniciada_em, created_at, conteudo, conteudo_final, importante, depois_de")
      .in("id", ids),
    db.from("tarefas").select("id, execucao_id, grupo_id, conexao_id, status, enviado_em").in("execucao_id", ids),
    resumoDasExecucoes(db, ids),
  ]);
  if (erroExecs) throw new Error(`Não foi possível carregar as ações: ${erroExecs.message}`);
  if (erroTarefas) throw new Error(`Não foi possível carregar as tarefas das ações: ${erroTarefas.message}`);

  const execsPorId = new Map((execs ?? []).map((e) => [e.id as string, e as ExecucaoLinha]));
  const tarefasPorExec = new Map<string, TarefaLinha[]>();
  for (const t of (tarefas ?? []) as TarefaLinha[]) {
    const lista = tarefasPorExec.get(t.execucao_id) ?? [];
    lista.push(t);
    tarefasPorExec.set(t.execucao_id, lista);
  }

  // Nomes em lote: campanhas (quando a tela cruza campanhas), grupos e contas das tarefas desta página.
  const campanhaIds = [...new Set(ids.map((id) => execsPorId.get(id)?.campanha_id).filter((v): v is string => !!v))];
  const grupoIds = [...new Set(((tarefas ?? []) as TarefaLinha[]).map((t) => t.grupo_id))];
  const conexaoIds = [...new Set(((tarefas ?? []) as TarefaLinha[]).map((t) => t.conexao_id))];
  const [{ data: campanhas }, { data: grupos }, { data: conexoes }] = await Promise.all([
    campanhaIds.length ? db.from("campanhas").select("id, nome").in("id", campanhaIds) : Promise.resolve({ data: [] as { id: string; nome: string }[] }),
    grupoIds.length ? db.from("grupos").select("id, nome").in("id", grupoIds) : Promise.resolve({ data: [] as { id: string; nome: string }[] }),
    conexaoIds.length ? db.from("conexoes").select("id, nome").in("id", conexaoIds) : Promise.resolve({ data: [] as { id: string; nome: string }[] }),
  ]);
  const nomeCampanha = new Map((campanhas ?? []).map((c) => [c.id as string, c.nome as string]));
  const nomeGrupo = new Map((grupos ?? []).map((g) => [g.id as string, g.nome as string]));
  const nomeConexao = new Map((conexoes ?? []).map((c) => [c.id as string, c.nome as string]));

  // "Adicionar outra ação": título da anterior das que esperam (só consulta quando a página tem alguma).
  const anteriores = [...new Set([...execsPorId.values()].map((e) => e.depois_de).filter((v): v is string => !!v))];
  const tituloAnterior = new Map<string, string>();
  if (anteriores.length) {
    const { data: ants } = await db.from("execucoes").select("id, tipo").in("id", anteriores);
    for (const a of (ants ?? []) as { id: string; tipo: TipoExecucao }[]) tituloAnterior.set(a.id, tituloCartao(a.tipo));
  }

  // Anteriores desta página com a seguinte já agendada/enviando: reprocessar a anterior sairia fora de ordem
  // (ver `reexecutarFalhasDeUma`, que recusa isso no servidor). "Reprocessar" fica escondido pra essas.
  const { data: seguintesPendentes } = await db.from("execucoes").select("depois_de").in("depois_de", ids).in("status", ["agendada", "enviando"]);
  const comSeguintePendente = new Set(((seguintesPendentes ?? []) as { depois_de: string }[]).map((s) => s.depois_de));

  const agora = new Date();
  const linhas: AcaoCartao[] = [];

  for (const id of ids) {
    const e = execsPorId.get(id);
    if (!e) continue;
    const tarefasDaExec = tarefasPorExec.get(id) ?? [];
    const temFalha = tarefasDaExec.some((t) => t.status === "erro");
    const s = situacaoAcao(e.status, e.agendada_para, temFalha, agora);
    const r = resumos.get(id);
    const comEntregas = e.tipo === "mensagem" || e.tipo === "enquete";
    const base = {
      execucaoId: e.id,
      tipo: e.tipo,
      titulo: tituloCartao(e.tipo),
      campanhaId: e.campanha_id,
      campanhaNome: nomeCampanha.get(e.campanha_id) ?? "",
      conteudo: e.conteudo_final ?? e.conteudo,
      importante: e.importante,
      origem: e.origem,
      agendadaPara: e.agendada_para,
      motivo: e.motivo,
      criadaEm: e.created_at,
      iniciadaEm: e.iniciada_em,
      // Encadeada esperando a anterior: "enviar agora" não adiantaria (só sai depois que a anterior terminar).
      podeEnviarAgora: e.status === "agendada" && !e.depois_de,
      depoisDe: e.depois_de ? { titulo: tituloAnterior.get(e.depois_de) ?? null } : null,
      podeCancelar: e.status === "agendada",
      // "Adicionar outra ação": com a seguinte já agendada/enviando, reprocessar a anterior sairia fora de ordem.
      podeReprocessar: temFalha && e.status !== "enviando" && !comSeguintePendente.has(e.id),
      entregues: comEntregas ? r?.entregues ?? 0 : undefined,
      lidos: comEntregas ? r?.lidos ?? 0 : undefined,
    };

    if (p.agrupar) {
      const terminadaEm = PODE_FALHA.has(e.status) ? ultimoEnvio(tarefasDaExec) : null;
      linhas.push({
        ...base,
        id: e.id,
        situacao: s,
        terminadaEm,
        duracao: duracao(e.iniciada_em, terminadaEm),
        contadores: contadoresDe(tarefasDaExec),
        contaNome: contaUnica(tarefasDaExec, nomeConexao),
      });
    } else if (!tarefasDaExec.length) {
      // Execução sem tarefa ainda (agendada/na fila sem grupo algum rodado): mantém uma linha pra não desaparecer da lista.
      linhas.push({
        ...base,
        id: e.id,
        situacao: s,
        terminadaEm: null,
        duracao: null,
        contaNome: null,
        grupoNome: "—",
      });
    } else {
      const detalheAcao = situacaoDaExecucao(e.status, r).detalhe;
      for (const t of tarefasDaExec) {
        const terminadaEm = t.status === "enviado" ? t.enviado_em : null;
        linhas.push({
          ...base,
          id: `${e.id}:${t.id}`,
          situacao: situacaoDaTarefa(e, t, agora),
          terminadaEm,
          duracao: duracao(e.iniciada_em, terminadaEm),
          contaNome: nomeConexao.get(t.conexao_id) ?? null,
          grupoNome: nomeGrupo.get(t.grupo_id) ?? "—",
          detalheAcao,
          podeReprocessar: t.status === "erro" && e.status !== "enviando" && !comSeguintePendente.has(e.id),
        });
      }
    }
  }

  return { linhas, totalAcoes };
}

function ultimoEnvio(tarefas: TarefaLinha[]): string | null {
  const datas = tarefas.map((t) => t.enviado_em).filter((v): v is string => !!v);
  if (!datas.length) return null;
  return datas.reduce((max, atual) => (atual > max ? atual : max));
}
