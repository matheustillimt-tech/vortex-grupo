import type { Situacao } from "./calendario";
import { ROTULO_TIPO, type TipoExecucao } from "./conteudo";

/** `ItemCalendario` já tem esse formato. */
export type CandidatoEnvio = { chave: string; campanhaId: string; quando: string; tipo: TipoExecucao; resumo: string; situacao: Situacao };
export type ProximoEnvio = { quando: string; campanhaId: string; descricao: string; chaves: string[] };

const PENDENTES: Situacao[] = ["agendado", "projetado"];
const minuto = (iso: string) => Math.floor(new Date(iso).getTime() / 60_000);

/** O próximo envio de todas as campanhas: menor horário ≥ agora entre execuções agendadas e passos projetados.
 *  O que sai no mesmo minuto vem junto ("AO VIVO #{n} + Abrir grupo"). */
export function proximoEnvio(itens: CandidatoEnvio[], agora: Date): ProximoEnvio | null {
  const futuros = itens.filter((i) => PENDENTES.includes(i.situacao) && new Date(i.quando).getTime() >= agora.getTime());
  if (!futuros.length) return null;
  const primeiro = Math.min(...futuros.map((i) => minuto(i.quando)));
  const juntos = futuros
    .filter((i) => minuto(i.quando) === primeiro)
    .sort((a, b) => new Date(a.quando).getTime() - new Date(b.quando).getTime());
  return {
    quando: juntos[0].quando,
    campanhaId: juntos[0].campanhaId,
    descricao: juntos.map((i) => i.resumo || ROTULO_TIPO[i.tipo]).join(" + "),
    chaves: juntos.map((i) => i.chave),
  };
}
