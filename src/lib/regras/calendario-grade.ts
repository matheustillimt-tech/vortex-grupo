import { fimDoDiaIso, inicioDoDiaIso } from "./abas-mensagens";
import { diaBrasilia } from "./aula";
import { ROTULO_TIPO, type TipoExecucao } from "./conteudo";

export const VISOES = ["mes", "semana", "agenda"] as const;
export type Visao = (typeof VISOES)[number];

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** `?visao=` da URL → uma das três visões, com "mês" como padrão. */
export function validarVisao(v: string | undefined): Visao {
  return (VISOES as readonly string[]).includes(v ?? "") ? (v as Visao) : "mes";
}

/** `?data=` da URL (AAAA-MM-DD) → data âncora válida, com hoje em Brasília como padrão. */
export function validarDataAncora(v: string | undefined, agora: Date = new Date()): string {
  if (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T12:00:00Z`).getTime())) return v;
  return diaBrasilia(agora);
}

/** Soma (ou subtrai) dias de calendário a uma data "AAAA-MM-DD", sem depender de fuso do host. */
export function diaMaisDias(dia: string, n: number): string {
  return new Date(new Date(`${dia}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
}

/** Dia da semana (0 = domingo … 6 = sábado) de uma data "AAAA-MM-DD". */
export function diaDaSemana(dia: string): number {
  return new Date(`${dia}T12:00:00Z`).getUTCDay();
}

/** Grade mensal dom.–sáb., com os dias do mês anterior/seguinte que completam a primeira e a última semana. */
export function matrizDoMes(ancora: string): string[][] {
  const [ano, mes] = ancora.slice(0, 7).split("-").map(Number);
  const primeiroDia = `${ancora.slice(0, 7)}-01`;
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).toISOString().slice(0, 10);
  const inicio = diaMaisDias(primeiroDia, -diaDaSemana(primeiroDia));
  const fim = diaMaisDias(ultimoDia, 6 - diaDaSemana(ultimoDia));
  const dias: string[] = [];
  for (let d = inicio; d <= fim; d = diaMaisDias(d, 1)) dias.push(d);
  const semanas: string[][] = [];
  for (let i = 0; i < dias.length; i += 7) semanas.push(dias.slice(i, i + 7));
  return semanas;
}

/** 7 dias (dom.–sáb.) da semana que contém a âncora. */
export function semanaDoDia(ancora: string): string[] {
  const inicio = diaMaisDias(ancora, -diaDaSemana(ancora));
  return Array.from({ length: 7 }, (_, i) => diaMaisDias(inicio, i));
}

/** Janela de consulta (ISO, em Brasília) da grade visível: mês inteiro (com dias de completar) ou semana. */
export function janelaDaGrade(visao: "mes" | "semana", ancora: string): { de: Date; ate: Date } {
  const dias = visao === "mes" ? matrizDoMes(ancora).flat() : semanaDoDia(ancora);
  return { de: new Date(inicioDoDiaIso(dias[0])!), ate: new Date(fimDoDiaIso(dias[dias.length - 1])!) };
}

/** Janela de um dia só (Etapa 3G, revisão final): clicar num dia do mês/semana (ou no "+N" de uma célula) leva
 *  à agenda com `?dia=`, e a agenda tem que mostrar só aquele dia. É um parâmetro separado de `data` (a âncora
 *  do mês/semana, que o alternador de visão e o filtro de período continuam usando) de propósito: assim o
 *  alternador "agenda" e o filtro "Filtrar" voltam pro período normal (±45 dias, com executar/cancelar), sem
 *  cair sempre no dia único. `null` quando `dia` não é uma "AAAA-MM-DD" válida (cai no período normal). */
export function janelaDoDiaUnico(dia: string | undefined): { de: Date; ate: Date } | null {
  const ini = inicioDoDiaIso(dia);
  const fim = fimDoDiaIso(dia);
  return ini && fim ? { de: new Date(ini), ate: new Date(fim) } : null;
}

/** "outubro de 2026" da data âncora. */
export function rotuloMes(ancora: string): string {
  const [ano, mes] = ancora.slice(0, 7).split("-").map(Number);
  return `${MESES[mes - 1]} de ${ano}`;
}

/** Nova data âncora ao navegar: um mês inteiro na visão mês, 7 dias na visão semana. */
export function navegarAncora(visao: "mes" | "semana", ancora: string, direcao: -1 | 1): string {
  if (visao === "semana") return diaMaisDias(ancora, direcao * 7);
  const [ano, mes] = ancora.slice(0, 7).split("-").map(Number);
  const novoMes = mes - 1 + direcao;
  const novoAno = ano + Math.floor(novoMes / 12);
  const mesNormalizado = ((novoMes % 12) + 12) % 12;
  return `${novoAno}-${String(mesNormalizado + 1).padStart(2, "0")}-01`;
}

/** Itens agrupados por dia de calendário de Brasília, em um Map (sem ordenar os dias) — cada lista já vem por horário. */
export function agruparPorDiaChave<T extends { quando: string }>(itens: T[]): Map<string, T[]> {
  const porDia = new Map<string, T[]>();
  for (const i of [...itens].sort((a, b) => new Date(a.quando).getTime() - new Date(b.quando).getTime())) {
    const d = diaBrasilia(i.quando);
    porDia.set(d, [...(porDia.get(d) ?? []), i]);
  }
  return porDia;
}

/** Rótulo curto do evento na grade: "Automação: …", "Sequência: …", "Ação: Trocar nome hh:mm" ou "Mensagem hh:mm",
 *  reaproveitando ROTULO_TIPO (tipo de execução) e a origem já existentes. Com `nomeAutomacao` (a consulta já leu
 *  `automacoes.nome` pelo `automacao_id` da execução.12): "Automação: {nome} hh:mm";
 *  sem nome (automação apagada, ou de fora desta leitura), continua "Automação: {tipo da ação} hh:mm". */
export function rotuloEvento(tipo: TipoExecucao, origem: string, hora: string, nomeAutomacao?: string | null): string {
  const ehAcaoDeGrupo = tipo !== "mensagem" && tipo !== "enquete";
  const corpo = ehAcaoDeGrupo ? `Ação: ${ROTULO_TIPO[tipo]}` : ROTULO_TIPO[tipo];
  if (origem === "automacao") return `Automação: ${nomeAutomacao || corpo} ${hora}`;
  if (origem === "sequencia") return `Sequência: ${corpo} ${hora}`;
  return `${corpo} ${hora}`;
}
