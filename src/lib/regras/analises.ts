/** Atividades, Clicks e Diagnósticos. Regras puras — as listas e os agregados
 *  por utm_source/grupo são feitos no banco (`atividades_campanha`, `cliques_campanha`, `cliques_por_origem`,
 *  `cliques_por_grupo`, `diagnostico_contas`); o gráfico diário reaproveita `metricas_campanha`, que já existe
 *  (soma cliques/entradas/saídas por dia de Brasília). */

export const POR_PAGINA_ATIVIDADES = 10;
export const POR_PAGINA_CLIQUES = 10;
export const POR_PAGINA_DIAGNOSTICOS = 10;

/** Tamanho da página usada pelas rotas "EXPORTAR HISTORICO" (atividades/cliques) ao paginar
 *  `atividades_campanha`/`cliques_campanha`. Tem que ser idêntico ao teto (`p_limite`) das duas RPCs
 *  (`20261017150100_analises_rpc.sql`) — maior que isso aqui não ganha nada (a RPC corta antes), menor demora
 *  mais pra exportar os 50.000 primeiros. */
export const LIMITE_PAGINA_EXPORTACAO = 1000;

export type Evento = "entrada" | "saida";

/** Chips "Evento" da aba Atividades: Todos/Entraram/Sairam. */
export const EVENTOS: { valor: Evento | null; rotulo: string }[] = [
  { valor: null, rotulo: "Todos" },
  { valor: "entrada", rotulo: "Entraram" },
  { valor: "saida", rotulo: "Sairam" },
];

export function lerEvento(v: string | undefined | null): Evento | null {
  return v === "entrada" || v === "saida" ? v : null;
}

/** "Entraram"/"Sairam" como chip da tabela. */
export function rotuloEvento(evento: Evento): string {
  return evento === "entrada" ? "Entraram" : "Sairam";
}

export type PeriodoGrafico = 7 | 14 | 21 | 28 | "todo";

/** Botões 7/14/21/28/"Todo Período" do gráfico diário. */
export const PERIODOS_GRAFICO: { valor: PeriodoGrafico; rotulo: string }[] = [
  { valor: 7, rotulo: "7" },
  { valor: 14, rotulo: "14" },
  { valor: 21, rotulo: "21" },
  { valor: 28, rotulo: "28" },
  { valor: "todo", rotulo: "Todo Período" },
];

export function lerPeriodoGrafico(v: string | undefined | null): PeriodoGrafico {
  const n = Number(v);
  if (n === 7 || n === 14 || n === 21 || n === 28) return n;
  return "todo";
}

const DIA_MS = 86_400_000;

/** Início da janela do gráfico diário, passado pra `metricas_campanha` (já soma no banco). "Todo Período" não
 *  tem limite de dias: começa na época (metricas_campanha só devolve os dias com movimento de qualquer jeito). */
export function desdeDoPeriodo(p: PeriodoGrafico, agora: Date = new Date()): Date {
  return p === "todo" ? new Date(0) : new Date(agora.getTime() - p * DIA_MS);
}

/** Página pedida (1, …) → deslocamento da RPC, nunca negativo. */
export function deslocamentoDaPagina(pagina: number, porPagina: number): number {
  const p = Number.isFinite(pagina) && pagina >= 1 ? Math.floor(pagina) : 1;
  return (p - 1) * porPagina;
}

/** Primeiros 8 caracteres do hash/visitante — não temos o IP em claro, só o hash. */
export function visitanteCurto(v: string): string {
  return v.slice(0, 8);
}

export type UtmLinha = {
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
};

/** Coluna "Parâmetros da URL": as UTMs preenchidas, "chave=valor" separadas por espaço; "—" sem nenhuma. */
export function parametrosUrl(c: UtmLinha): string {
  const pares: [string, string | null | undefined][] = [
    ["utm_source", c.utm_source],
    ["utm_medium", c.utm_medium],
    ["utm_campaign", c.utm_campaign],
    ["utm_content", c.utm_content],
    ["utm_term", c.utm_term],
  ];
  const texto = pares
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  return texto || "—";
}

/** Sub-abas "Histórico"/"Análise" da aba Clicks. */
export type SubAbaClicks = "historico" | "analise";

export function lerSubAbaClicks(v: string | undefined | null): SubAbaClicks {
  return v === "analise" ? "analise" : "historico";
}

/** Uma conferência passa a "talvez desatualizada" depois deste tanto de tempo. */
export const LIMITE_DESATUALIZADO_MS = 30 * 60_000;

/** `ultima` é a conferência mais antiga dos grupos ativos da conta (`diagnostico_contas.ultima_conferencia`);
 *  `algumPendente` é true quando pelo menos um desses grupos nunca foi conferido (nesse caso conta como
 *  desatualizado, mesmo sem data pra mostrar). */
export function contaDesatualizada(ultima: string | null, algumPendente: boolean, agora: Date = new Date()): boolean {
  if (algumPendente || !ultima) return true;
  return agora.getTime() - Date.parse(ultima) > LIMITE_DESATUALIZADO_MS;
}

/** Pelo menos este tanto de tempo entre dois pedidos de "Verificar compatibilidade" da mesma conta. */
export const THROTTLE_VERIFICAR_COMPATIBILIDADE_MS = 2 * 60_000;

/** "17/10/2026, 06:12:50" (com segundos, Brasília) — rodapé de Diagnósticos e data da tabela de Atividades
 * . */
export function dataHoraCompleta(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "medium" });
}

/* ---------------------------------------------------------------------------------------------------------
 * Sub-aba "Análise" de Clicks, neste formato usando o visitante (cookie) no lugar do IP.
 * Regras puras: a leitura dos cliques do período continua na página (mesmos cliques que o gráfico já lê, só
 * leitura); aqui só a agregação por visitante e os sinais suspeitos.
 * ------------------------------------------------------------------------------------------------------- */

export type CliqueParaAnalise = { visitante: string; grupo_id: string | null; grupo_numero: number | null; grupo_nome: string | null; criado_em: string };

export type SinalSuspeito = "alto_volume" | "repeticao_1_grupo" | "varredura_grupos";

export const ROTULO_SINAL: Record<SinalSuspeito, string> = {
  alto_volume: "Alto volume",
  repeticao_1_grupo: "Repetição em 1 grupo",
  varredura_grupos: "Varredura de grupos",
};

/** A partir de quantos cliques um visitante conta como "Alto volume". */
export const LIMITE_ALTO_VOLUME = 20;
/** A partir de quantos cliques, todos no mesmo grupo, conta como "Repetição em 1 grupo". */
export const LIMITE_REPETICAO_1_GRUPO = 5;
/** A partir de quantos grupos distintos conta como "Varredura de grupos". */
export const LIMITE_VARREDURA_GRUPOS = 5;

export type VisitanteAgregado = {
  visitante: string;
  cliques: number;
  grupos: number;
  ultimoGrupoNumero: number | null;
  ultimoGrupoNome: string | null;
  ultimoClique: string;
  sinais: SinalSuspeito[];
};

/** Agrupa os cliques do período por visitante (cookie), do mais recente clique de cada um pra trás, com os
 *  sinais suspeitos (puro: mesmo limite pros três — sem consulta nova, só o que a página já leu). */
export function analisarVisitantes(linhas: CliqueParaAnalise[]): VisitanteAgregado[] {
  const porVisitante = new Map<string, CliqueParaAnalise[]>();
  for (const l of linhas) {
    const lista = porVisitante.get(l.visitante) ?? [];
    lista.push(l);
    porVisitante.set(l.visitante, lista);
  }
  const agregados: VisitanteAgregado[] = [];
  for (const [visitante, cliquesDoVisitante] of porVisitante) {
    const ordenados = [...cliquesDoVisitante].sort((a, b) => b.criado_em.localeCompare(a.criado_em));
    const gruposDistintos = new Set(ordenados.map((c) => c.grupo_id).filter((g): g is string => !!g));
    const sinais: SinalSuspeito[] = [];
    if (ordenados.length >= LIMITE_ALTO_VOLUME) sinais.push("alto_volume");
    if (gruposDistintos.size <= 1 && ordenados.length >= LIMITE_REPETICAO_1_GRUPO) sinais.push("repeticao_1_grupo");
    if (gruposDistintos.size >= LIMITE_VARREDURA_GRUPOS) sinais.push("varredura_grupos");
    agregados.push({
      visitante,
      cliques: ordenados.length,
      grupos: gruposDistintos.size,
      ultimoGrupoNumero: ordenados[0]?.grupo_numero ?? null,
      ultimoGrupoNome: ordenados[0]?.grupo_nome ?? null,
      ultimoClique: ordenados[0]?.criado_em ?? "",
      sinais,
    });
  }
  return agregados.sort((a, b) => b.cliques - a.cliques || a.visitante.localeCompare(b.visitante));
}

/** "Comportamento do visitante": Todos / 1 grupo / Vários grupos. */
export type ComportamentoVisitante = "todos" | "1grupo" | "varios";

export function lerComportamentoVisitante(v: string | undefined | null): ComportamentoVisitante {
  return v === "1grupo" || v === "varios" ? v : "todos";
}

/** Filtra a lista agregada pelo comportamento e pelo mínimo de cliques escolhidos (puro). */
export function filtrarVisitantes(lista: VisitanteAgregado[], f: { comportamento: ComportamentoVisitante; minimoCliques: number }): VisitanteAgregado[] {
  return lista
    .filter((v) => (f.comportamento === "todos" ? true : f.comportamento === "1grupo" ? v.grupos <= 1 : v.grupos > 1))
    .filter((v) => v.cliques >= f.minimoCliques);
}

/** Chips "1 grupo: N" / "Vários grupos: N" (sobre a lista inteira, antes do filtro de comportamento). */
export function contagemComportamento(lista: VisitanteAgregado[]): { umGrupo: number; variosGrupos: number } {
  return {
    umGrupo: lista.filter((v) => v.grupos <= 1).length,
    variosGrupos: lista.filter((v) => v.grupos > 1).length,
  };
}

/** Cartões "Clicks" / "Visitantes únicos" / "Média cliques/visitante" / "Participação do top visitante". */
export function cartoesAnaliseVisitantes(lista: VisitanteAgregado[]): { clicks: number; visitantesUnicos: number; mediaCliquesPorVisitante: number; participacaoTopVisitante: number } {
  const clicks = lista.reduce((s, v) => s + v.cliques, 0);
  const visitantesUnicos = lista.length;
  const mediaCliquesPorVisitante = visitantesUnicos ? clicks / visitantesUnicos : 0;
  const topCliques = Math.max(0, ...lista.map((v) => v.cliques));
  const participacaoTopVisitante = clicks ? (topCliques / clicks) * 100 : 0;
  return { clicks, visitantesUnicos, mediaCliquesPorVisitante, participacaoTopVisitante };
}

/** Números conectados no sistema (as contas que criam e administram os grupos) não são entrada nem saída de lead:
 *  a aba Atividades e a exportação tiram essas linhas (teste de 17/10/2026: a conta aparecia como "Entraram" nos
 *  grupos que ela mesma criou). Só a tela muda; o histórico no banco fica igual. `conectados` vem nas duas formas
 *  do nono dígito (`telefonesConectados`). */
export function semNumerosConectados<T extends { telefone: string }>(linhas: T[], conectados: ReadonlySet<string>): T[] {
  return conectados.size ? linhas.filter((l) => !conectados.has(l.telefone)) : linhas;
}

/** Telefones conectados que entram na contagem a descontar do total da lista: todos, ou só os que contêm os
 *  dígitos buscados (a busca da tela é "contém"). Cada um vira uma consulta `atividades_campanha` com `p_busca` =
 *  o telefone inteiro e `p_limite` 1 (só o `total` interessa). */
export function conectadosParaDescontar(conectados: ReadonlySet<string>, busca: string | null): string[] {
  const d = (busca ?? "").replace(/\D/g, "");
  return [...conectados].filter((t) => /^\d+$/.test(t) && (!d || t.includes(d))).sort();
}

/** Total da lista sem os números conectados (nunca negativo). */
export function totalSemConectados(total: number, descontar: number[]): number {
  return Math.max(0, total - descontar.reduce((s, n) => s + (Number.isFinite(n) ? n : 0), 0));
}
