import type { TipoExecucao } from "./conteudo";

export type ExecucaoPassada = {
  id: string;
  tipo: TipoExecucao;
  origem: string;
  status: string;
  importante: boolean;
  agendada_para: string;
  conteudo_final: unknown;
  /** `null` = todas as contas/todos os grupos da campanha. Uma importante com alvo específico não é renviada
   *  pra grupo novo: ele não é nenhum dos alvos escolhidos na hora. */
  alvo_contas?: string[] | null;
  alvo_grupos?: string[] | null;
};

/** As `n` últimas mensagens/enquetes importantes já concluídas (cópias de grupo novo não contam, nem as que
 *  tinham conta ou grupo específico como alvo — só valem as que foram pra "Todas as contas"/"Todos os grupos"),
 *  da mais antiga pra mais nova — é a ordem em que o grupo novo vai receber. */
export function ultimasImportantes(lista: ExecucaoPassada[], n = 3): ExecucaoPassada[] {
  return lista
    .filter(
      (e) =>
        e.importante &&
        e.status === "concluida" &&
        e.origem !== "grupo_novo" &&
        (e.tipo === "mensagem" || e.tipo === "enquete") &&
        e.conteudo_final &&
        !e.alvo_contas &&
        !e.alvo_grupos,
    )
    .sort((a, b) => new Date(b.agendada_para).getTime() - new Date(a.agendada_para).getTime())
    .slice(0, n)
    .reverse();
}

export type LinhaGrupoNovo = {
  campanha_id: string;
  origem: "grupo_novo";
  tipo: TipoExecucao;
  conteudo: unknown;
  alvo_grupos: string[];
  agendada_para: string;
  importante: false;
};

/** Mensagem fixa (se houver) e depois as importantes, 1 s entre uma e outra pra manter a ordem.
 *  O espaçamento real de 3–8 s vem da fila. */
export function execucoesGrupoNovo(d: { campanhaId: string; grupoId: string; mensagemFixa: string | null; importantes: ExecucaoPassada[]; agora: Date }): LinhaGrupoNovo[] {
  const itens: { tipo: TipoExecucao; conteudo: unknown }[] = [];
  if (d.mensagemFixa?.trim()) {
    itens.push({ tipo: "mensagem", conteudo: { formato: "texto", texto: d.mensagemFixa, midia_url: null, nome_arquivo: null, mencionar_todos: false } });
  }
  for (const e of d.importantes) itens.push({ tipo: e.tipo, conteudo: e.conteudo_final });
  return itens.map((i, k) => ({
    campanha_id: d.campanhaId,
    origem: "grupo_novo",
    tipo: i.tipo,
    conteudo: i.conteudo,
    alvo_grupos: [d.grupoId],
    agendada_para: new Date(d.agora.getTime() + k * 1000).toISOString(),
    importante: false,
  }));
}
