/** Confirmação de entrega (Etapa 3J, Tarefa 3). Puro: a regra de verdade roda no banco (`conferir_entregas`); esta é
 *  a mesma regra em TypeScript (testada contra os mesmos casos) e o texto do cartão da mensagem. Sem `server-only`:
 *  a página (servidor) usa o texto. */
import { variantesTelefone } from "../telefone";

export type SituacaoEntrega = "confirmada" | "sem_observador" | "nao_confirmada";

/** Minutos depois do envio em que a entrega é conferida (e o alerta sai). */
export const MINUTOS_CONFERIR_ENTREGA = 30;

/** Uma tarefa enviada por uma conta da campanha: `observadores` são os telefones das OUTRAS contas da campanha,
 *  `observadoresNoGrupo` os que estão no grupo agora (participação aberta) e `recibos` os recibos por pessoa da
 *  tarefa. Compara com as variantes do nono dígito. */
export function situacaoEntrega({ observadores, observadoresNoGrupo, recibos }: {
  observadores: string[];
  observadoresNoGrupo: string[];
  recibos: { telefone: string; tipo: string }[];
}): SituacaoEntrega {
  const obs = new Set(observadores.flatMap(variantesTelefone));
  const noGrupo = observadoresNoGrupo.flatMap(variantesTelefone).filter((t) => obs.has(t));
  if (!noGrupo.length) return "sem_observador";
  const confirmou = recibos.some((r) => (r.tipo === "recebeu" || r.tipo === "visualizou") && obs.has(r.telefone));
  return confirmou ? "confirmada" : "nao_confirmada";
}

export type PlacarEntrega = { confirmadas: number; sem_observador: number; nao_confirmadas: number; total: number };

/** Linha do cartão da mensagem: "Entrega confirmada: N/M grupos" (M = grupos com observador já conferidos) e, se
 *  houver, "K sem observador". Nada conferido ainda: explica quando sai. */
export function textoEntrega(p: PlacarEntrega | null | undefined): string {
  if (!p || p.total <= 0) return `Entrega: conferida ${MINUTOS_CONFERIR_ENTREGA} min depois do envio`;
  const comObservador = p.confirmadas + p.nao_confirmadas;
  const base = `Entrega confirmada: ${p.confirmadas}/${comObservador} grupos`;
  return p.sem_observador > 0 ? `${base} · ${p.sem_observador} sem observador` : base;
}

/** Texto do alerta `entrega_nao_confirmada` (um por execução). `data` já formatada (Brasília). */
export function textoAlertaEntrega(n: number, data: string, campanha: string): string {
  return `${n} grupo(s) sem confirmação de entrega na mensagem de ${data} (campanha ${campanha})`;
}
