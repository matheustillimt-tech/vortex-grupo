import { resumoConteudo, type TipoExecucao } from "./conteudo";
import { decidirPasso, horarioDoPasso } from "./sequencia";

export type Situacao = "projetado" | "agendado" | "executando" | "feito" | "falhou" | "pulado" | "bloqueado" | "cancelado";

export const ROTULO_SITUACAO: Record<Situacao, string> = {
  projetado: "projetado",
  agendado: "agendado",
  executando: "executando",
  feito: "feito",
  falhou: "falhou",
  pulado: "pulado",
  bloqueado: "bloqueado",
  cancelado: "cancelado",
};

export type ItemCalendario = {
  chave: string;
  campanhaId: string;
  execucaoId: string | null;
  passoId: string | null;
  quando: string;
  tipo: TipoExecucao;
  origem: string;
  resumo: string;
  situacao: Situacao;
  detalhe: string | null;
  /** Nome da automação que criou o item, quando a consulta já trouxer (`automacoes.nome` pelo `automacao_id`
   *  da execução) — pro rótulo "Automação: {nome} hh:mm" no calendário.
   *  Ausente/`null` = sem nome conhecido, rótulo cai no tipo da ação ("Automação: Mensagem hh:mm"). */
  automacaoNome?: string | null;
};

export type ResumoTarefas = { total: number; feitas: number; erros: number; pendentes: number };

const SEM_GRUPO = "nenhum grupo";
const COM_ERRO = " com erro";

export function situacaoDaExecucao(status: string, r: ResumoTarefas | undefined): { situacao: Situacao; detalhe: string | null } {
  const placar = r && r.total ? `${r.feitas}/${r.total}` : null;
  switch (status) {
    case "agendada":
      return { situacao: "agendado", detalhe: null };
    case "enviando":
      return { situacao: "executando", detalhe: placar };
    case "cancelada":
      return { situacao: "cancelado", detalhe: null };
    case "pulada":
      return { situacao: "pulado", detalhe: null };
    case "bloqueada":
      return { situacao: "bloqueado", detalhe: null };
    default: {
      if (!r || !r.total) return { situacao: "feito", detalhe: SEM_GRUPO };
      if (r.feitas === 0 && r.erros > 0) return { situacao: "falhou", detalhe: placar };
      return { situacao: "feito", detalhe: r.erros ? `${placar} · ${r.erros}${COM_ERRO}` : placar };
    }
  }
}

export type CorSituacao = "ok" | "erro" | "neutro" | "aviso";

const COR_SITUACAO: Record<Situacao, CorSituacao> = {
  projetado: "neutro",
  agendado: "neutro",
  executando: "aviso",
  feito: "ok",
  falhou: "erro",
  pulado: "neutro",
  bloqueado: "erro",
  cancelado: "neutro",
};

/** Cor do selo. "Feito" só fica verde quando deu tudo certo: com erro em algum grupo ou sem nenhum grupo vira aviso. */
export function corDaSituacao(situacao: Situacao, detalhe: string | null | undefined): CorSituacao {
  if (situacao === "feito" && detalhe && (detalhe === SEM_GRUPO || detalhe.endsWith(COM_ERRO))) return "aviso";
  return COR_SITUACAO[situacao];
}

export type ExecucaoCalendario = { id: string; campanha_id: string; tipo: TipoExecucao; origem: string; status: string; agendada_para: string; conteudo: unknown; conteudo_final: unknown; automacaoNome?: string | null };

export function itemDaExecucao(e: ExecucaoCalendario, r: ResumoTarefas | undefined): ItemCalendario {
  const s = situacaoDaExecucao(e.status, r);
  return {
    chave: `e-${e.id}`,
    campanhaId: e.campanha_id,
    execucaoId: e.id,
    passoId: null,
    quando: e.agendada_para,
    tipo: e.tipo,
    origem: e.origem,
    resumo: resumoConteudo(e.tipo, e.conteudo_final ?? e.conteudo),
    situacao: s.situacao,
    detalhe: s.detalhe,
    automacaoNome: e.automacaoNome ?? null,
  };
}

export type PassoProjetavel = { id: string; dia_relativo: number; hora: string; tipo: TipoExecucao; conteudo: unknown };

/** Passos da sequência que ainda não viraram execução aparecem como "projetado" (ou como o que o próximo tick
 *  vai fazer com eles, se já chegou a hora). */
export function projetarPassos(campanha: { id: string; data_aula: string }, passos: PassoProjetavel[], materializados: Set<string>, agora: Date): ItemCalendario[] {
  return passos
    .filter((p) => !materializados.has(p.id))
    .map((p) => {
      const horario = horarioDoPasso(campanha.data_aula, p.dia_relativo, p.hora);
      const d = decidirPasso(horario, agora);
      return {
        chave: `p-${campanha.id}-${p.id}`,
        campanhaId: campanha.id,
        execucaoId: null,
        passoId: p.id,
        quando: horario.toISOString(),
        tipo: p.tipo,
        origem: "sequencia",
        resumo: resumoConteudo(p.tipo, p.conteudo),
        situacao: d === "esperar" ? "projetado" : d === "pulada" ? "pulado" : "agendado",
        detalhe: null,
      };
    });
}

const fmtDia = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
const fmtRotulo = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "short", day: "2-digit", month: "2-digit" });

/** Itens agrupados por dia de Brasília (dias em ordem, itens por horário). */
export function agruparPorDia(itens: ItemCalendario[]): { dia: string; rotulo: string; itens: ItemCalendario[] }[] {
  const porDia = new Map<string, ItemCalendario[]>();
  for (const i of [...itens].sort((a, b) => new Date(a.quando).getTime() - new Date(b.quando).getTime())) {
    const d = fmtDia.format(new Date(i.quando));
    porDia.set(d, [...(porDia.get(d) ?? []), i]);
  }
  return [...porDia.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dia, lista]) => ({ dia, rotulo: fmtRotulo.format(new Date(lista[0].quando)), itens: lista }));
}
