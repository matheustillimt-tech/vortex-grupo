import { podeSerImportante, TIPOS_PASSO, validarConteudo, type Conteudo, type TipoPasso } from "./conteudo";

const UM_MIN = 60_000;
const QUINZE_MIN = 15 * UM_MIN;
const BRASILIA_MS = 3 * 3600_000; // UTC−3, sem horário de verão desde 2019

/** Dia da aula em Brasília + `diaRelativo` dias, às `hora` (HH:MM ou HH:MM:SS) de Brasília. */
export function horarioDoPasso(dataAulaIso: string, diaRelativo: number, hora: string): Date {
  const aula = new Date(new Date(dataAulaIso).getTime() - BRASILIA_MS); // relógio de Brasília nos campos UTC
  const [h, m] = hora.split(":").map(Number);
  return new Date(Date.UTC(aula.getUTCFullYear(), aula.getUTCMonth(), aula.getUTCDate() + diaRelativo, h, m) + BRASILIA_MS);
}

export type DecisaoPasso = "esperar" | "pulada" | "agendada";

/** Passo vira execução 1 min antes do horário. Passou há mais de 15 min: não dispara, fica "pulada". */
export function decidirPasso(horario: Date, agora: Date): DecisaoPasso {
  const t = horario.getTime();
  const a = agora.getTime();
  if (t > a + UM_MIN) return "esperar";
  if (t < a - QUINZE_MIN) return "pulada";
  return "agendada";
}

/** Execução com horário marcado que não deve sair atrasada: passo de sequência e ação de automação de cronograma
 *  (as de "criar grupo"/"encher grupo" valem pelo evento, então saem mesmo que atrasem). */
export function pulaSeAtrasada(e: { origem: string; gatilhoChave?: string | null }): boolean {
  return e.origem === "sequencia" || (e.origem === "automacao" && e.gatilhoChave === "cronograma");
}

/** Execução de sequência que ficou parada na fila (cron fora do ar) e passou da tolerância de 15 min. */
export function atrasadaDemais(agendadaPara: Date, agora: Date): boolean {
  return agendadaPara.getTime() < agora.getTime() - QUINZE_MIN;
}

export type PassoEntrada = { id?: string; dia_relativo: number; hora: string; tipo: TipoPasso; conteudo: unknown; importante: boolean };
export type PassoValido = { id?: string; dia_relativo: number; hora: string; tipo: TipoPasso; conteudo: Conteudo; importante: boolean };

export function validarPasso(p: PassoEntrada): { ok: true; valor: PassoValido } | { ok: false; erro: string } {
  if (!Number.isInteger(p.dia_relativo) || p.dia_relativo < -30 || p.dia_relativo > 7) return { ok: false, erro: "O dia vai de D-30 a D+7." };
  const m = /^(\d{2}):(\d{2})(:\d{2})?$/.exec(p.hora);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return { ok: false, erro: "Hora inválida (use HH:MM)." };
  if (!(TIPOS_PASSO as readonly string[]).includes(p.tipo)) return { ok: false, erro: "Tipo de passo inválido." };
  const c = validarConteudo(p.tipo, p.conteudo);
  if (!c.ok) return c;
  return {
    ok: true,
    valor: { ...(p.id ? { id: p.id } : {}), dia_relativo: p.dia_relativo, hora: `${m[1]}:${m[2]}`, tipo: p.tipo, conteudo: c.valor, importante: podeSerImportante(p.tipo) && p.importante },
  };
}

/** "D-1", "D-0", "D+2". */
export function rotuloDia(diaRelativo: number): string {
  return diaRelativo > 0 ? `D+${diaRelativo}` : `D-${Math.abs(diaRelativo)}`;
}

export type PassoMaterializavel = { id: string; dia_relativo: number; hora: string; tipo: TipoPasso; conteudo: unknown; importante: boolean };
export type LinhaExecucao = {
  campanha_id: string;
  origem: "sequencia";
  passo_id: string;
  tipo: TipoPasso;
  conteudo: unknown;
  importante: boolean;
  agendada_para: string;
  status: "agendada" | "pulada";
  motivo: string | null;
};

/** Passos que já chegaram na hora (ou passaram) viram linhas de `execucoes`. Os já materializados são ignorados
 *  pelo banco (único campanha_id + passo_id), então dá pra mandar todos os vencidos a cada tick. */
export function linhasParaMaterializar(campanha: { id: string; data_aula: string }, passos: PassoMaterializavel[], agora: Date): LinhaExecucao[] {
  const linhas: LinhaExecucao[] = [];
  for (const p of passos) {
    const horario = horarioDoPasso(campanha.data_aula, p.dia_relativo, p.hora);
    const decisao = decidirPasso(horario, agora);
    if (decisao === "esperar") continue;
    linhas.push({
      campanha_id: campanha.id,
      origem: "sequencia",
      passo_id: p.id,
      tipo: p.tipo,
      conteudo: p.conteudo,
      importante: p.importante,
      agendada_para: horario.toISOString(),
      status: decisao,
      motivo: decisao === "pulada" ? "Já tinha passado quando a sequência foi aplicada (mais de 15 min)." : null,
    });
  }
  return linhas;
}
