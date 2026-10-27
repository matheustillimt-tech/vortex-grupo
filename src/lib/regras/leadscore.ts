/** Leadscoring e Desempenho por grupo. Regras puras: a soma é feita no banco
 *  (`leadscore_campanha`, `volume_recibos`, `desempenho_grupos`). */

export type TipoRecibo = "recebeu" | "visualizou" | "reproduziu";

export const TIPOS_RECIBO: TipoRecibo[] = ["recebeu", "visualizou", "reproduziu"];

/** Pontos por recibo (iguais aos da função `leadscore_campanha`). */
export const PONTOS_RECIBO: Record<TipoRecibo, number> = { recebeu: 10, visualizou: 20, reproduziu: 40 };

/** Chips "Status:" da aba Leadscoring. */
export const CHIPS_RECIBO: { tipo: TipoRecibo; icone: string; rotulo: string }[] = [
  { tipo: "recebeu", icone: "mark_email_read", rotulo: "Recebeu (10 pts)" },
  { tipo: "visualizou", icone: "visibility", rotulo: "Visualizou (20 pts)" },
  { tipo: "reproduziu", icone: "play_circle", rotulo: "Reproduziu (40 pts)" },
];

/** Os recibos por pessoa só existem a partir da publicação da Etapa 3G. */
export const AVISO_DADOS_POR_PESSOA = "Dados por pessoa desde 17/10/2026";

export const POR_PAGINA_LEADSCORE = 25;

/** `?tipos=recebeu,reproduziu` → tipos válidos, na ordem dos chips. Ausente, vazio ou só inválidos: todos. */
export function lerTipos(param: string | undefined | null): TipoRecibo[] {
  const pedidos = new Set((param ?? "").split(",").map((t) => t.trim()));
  const tipos = TIPOS_RECIBO.filter((t) => pedidos.has(t));
  return tipos.length ? tipos : [...TIPOS_RECIBO];
}

/** Liga/desliga um chip. Desligar o último deixa ele ligado (nunca fica sem nenhum). */
export function alternarTipo(tipos: TipoRecibo[], tipo: TipoRecibo): TipoRecibo[] {
  const ligado = tipos.includes(tipo);
  if (ligado && tipos.length === 1) return tipos;
  return TIPOS_RECIBO.filter((t) => (t === tipo ? !ligado : tipos.includes(t)));
}

/** Valor de `?tipos=` (null quando são todos, pra URL ficar limpa) e o que vai pro `p_tipos` da RPC. */
export function tiposParaParametro(tipos: TipoRecibo[]): string | null {
  return tipos.length === TIPOS_RECIBO.length ? null : tipos.join(",");
}

export type Agrupamento = "hora" | "dia" | "semana" | "mes";

export const AGRUPAMENTOS: { valor: Agrupamento; rotulo: string }[] = [
  { valor: "hora", rotulo: "POR HORA" },
  { valor: "dia", rotulo: "POR DIA" },
  { valor: "semana", rotulo: "POR SEMANA" },
  { valor: "mes", rotulo: "POR MÊS" },
];

export function lerAgrupamento(v: string | undefined | null): Agrupamento {
  return v === "dia" || v === "semana" || v === "mes" ? v : "hora";
}

const DIA = 86_400_000;

/** Título, subtítulo e início da janela do gráfico. Por hora: 7 dias; por dia: 30 dias; por
 *  semana: 12 semanas; por mês: 12 meses. */
export function janelaDoVolume(agrupar: Agrupamento, agora: Date = new Date()): { titulo: string; subtitulo: string; inicio: Date } {
  switch (agrupar) {
    case "hora":
      return { titulo: "Volume por hora", subtitulo: "Últimos 7 dias", inicio: new Date(agora.getTime() - 7 * DIA) };
    case "dia":
      return { titulo: "Volume por dia", subtitulo: "Últimos 30 dias", inicio: new Date(agora.getTime() - 30 * DIA) };
    case "semana":
      return { titulo: "Volume por semana", subtitulo: "Últimas 12 semanas", inicio: new Date(agora.getTime() - 12 * 7 * DIA) };
    case "mes":
      return { titulo: "Volume por mês", subtitulo: "Últimos 12 meses", inicio: new Date(agora.getTime() - 365 * DIA) };
  }
}

/** Rótulo do período que vem do banco ("2026-10-16 14:00", hora de Brasília). */
export function rotuloPeriodo(agrupar: Agrupamento, periodo: string): string {
  const dia = periodo.slice(8, 10);
  const mes = periodo.slice(5, 7);
  const ano = periodo.slice(0, 4);
  if (agrupar === "hora") return `${dia}/${mes} ${periodo.slice(11, 13)}h`;
  if (agrupar === "mes") return `${mes}/${ano}`;
  return `${dia}/${mes}/${ano}`;
}

export type VolumeLinha = { periodo: string; recebeu: number; visualizou: number; reproduziu: number };

/** Série do gráfico: em cada período, a soma dos recibos dos tipos ligados nos chips. */
export function serieDoVolume(linhas: VolumeLinha[], agrupar: Agrupamento, tipos: TipoRecibo[]): { data: string; valor: number; rotulo: string }[] {
  return linhas.map((l) => ({
    data: l.periodo,
    valor: tipos.reduce((s, t) => s + Number(l[t] ?? 0), 0),
    rotulo: rotuloPeriodo(agrupar, l.periodo),
  }));
}

/** "Volume por hora" neste formato: agrupa por **hora do dia** (eixo "00h"…"23h"), somando os baldes
 *  por hora que `volume_recibos` já devolve (`serieDoVolume`, agrupamento "hora".9). Puro: só
 *  soma por cima da série que a página já tem, sem nenhuma consulta nova. `rotuloPeriodo` não muda (continua
 *  "16/10 14h" pra quem usa a série como está); aqui só o gráfico de "Volume por hora" passa a usar isto. */
export function porHoraDoDia(serie: { data: string; valor: number; rotulo: string }[]): { data: string; valor: number; rotulo: string }[] {
  const baldes = Array.from({ length: 24 }, () => 0);
  for (const p of serie) {
    const hora = Number(p.data.slice(11, 13));
    if (Number.isFinite(hora) && hora >= 0 && hora < 24) baldes[hora] += p.valor;
  }
  return baldes.map((valor, hora) => {
    const h = String(hora).padStart(2, "0");
    return { data: h, valor, rotulo: `${h}h` };
  });
}

export type Criterio = "geral" | "visualizacao" | "reproducao" | "recebimento";

export const CRITERIOS: { valor: Criterio; icone: string; rotulo: string; nome: string }[] = [
  { valor: "geral", icone: "leaderboard", rotulo: "GERAL", nome: "geral" },
  { valor: "visualizacao", icone: "visibility", rotulo: "VISUALIZAÇÃO", nome: "visualização" },
  { valor: "reproducao", icone: "play_circle", rotulo: "REPRODUÇÃO", nome: "reprodução" },
  { valor: "recebimento", icone: "mark_email_read", rotulo: "RECEBIMENTO", nome: "recebimento" },
];

export function lerCriterio(v: string | undefined | null): Criterio {
  return v === "visualizacao" || v === "reproducao" || v === "recebimento" ? v : "geral";
}

/** "Top 20 grupos por geral" / "… por visualização". */
export function tituloTopGrupos(criterio: Criterio, quantos = 20): string {
  return `Top ${quantos} grupos por ${CRITERIOS.find((c) => c.valor === criterio)?.nome ?? "geral"}`;
}

/** Largura da barra (0–100%) relativa à maior pontuação da lista. */
export function larguraBarra(valor: number, maior: number): number {
  if (!(maior > 0) || !(valor > 0)) return 0;
  return Math.max(1, Math.min(100, Math.round((valor / maior) * 1000) / 10));
}

/** Página pedida (1, …) → deslocamento da RPC, nunca negativo. */
export function deslocamentoDaPagina(pagina: number, porPagina = POR_PAGINA_LEADSCORE): number {
  const p = Number.isFinite(pagina) && pagina >= 1 ? Math.floor(pagina) : 1;
  return (p - 1) * porPagina;
}

/** Novos parâmetros da URL da tabela (aba Desempenho) ao trocar o "Filtrar por ação": seta/apaga `execucao` e
 *  sempre apaga `pagina` (revisão final B, item m6) — a página atual é de outra lista de disparos e pode nem
 *  existir na nova. Pura: recebe os parâmetros atuais (ex.: de `useSearchParams()`) e devolve os novos, sem
 *  tocar no `URLSearchParams` recebido. */
export function paramsFiltroAcao(atuais: URLSearchParams, novaExecucao: string): URLSearchParams {
  const p = new URLSearchParams(atuais);
  if (novaExecucao) p.set("execucao", novaExecucao);
  else p.delete("execucao");
  p.delete("pagina");
  return p;
}
