import { chaveTelefone } from "../telefone";
import type { Membro } from "./participantes";

export type MotivoSaida = "sozinho" | "bloqueado" | "duplicado" | "comprador" | "manual";

export const ROTULO_MOTIVO: Record<MotivoSaida, string> = {
  sozinho: "Saiu sozinho",
  bloqueado: "Bloqueado",
  duplicado: "Duplicado",
  comprador: "Comprou",
  manual: "Removido",
};

/** Uma linha de `listar_pessoas` (uma participação). */
export type PessoaLinha = {
  participante_id: string;
  telefone: string;
  campanha_id: string;
  campanha: string;
  grupo_id: string;
  grupo: string;
  entrou_em: string;
  saiu_em: string | null;
  motivo_saida: MotivoSaida | null;
  tags: string[];
};

/** `acoes.origem` da remoção → motivo gravado na participação. */
export function motivoDaOrigem(origem: string | null): Exclude<MotivoSaida, "sozinho"> {
  if (origem === "bloqueado") return "bloqueado";
  if (origem === "duplicado") return "duplicado";
  if (origem?.startsWith("venda")) return "comprador";
  return "manual";
}

function chaves(telefones: string[]): Set<string> {
  return new Set(telefones.map(chaveTelefone));
}

/** Quem entrou e pode sofrer regra ou ganhar tag: nem admin nem número conectado no sistema. */
export function candidatosDaRodada(entraram: Membro[], protegidos: string[]): string[] {
  const p = chaves(protegidos);
  return entraram.filter((m) => !m.admin && !p.has(chaveTelefone(m.telefone))).map((m) => m.telefone);
}

export type DadosRodada = {
  grupoId: string;
  entraram: Membro[];
  sairam: Membro[];
  /** Telefones dos números conectados no sistema. */
  protegidos: string[];
  /** Bloqueados que batem com quem entrou. */
  bloqueados: string[];
  /** Participações abertas na campanha (grupos ativos) dos telefones que entraram. */
  abertos: { telefone: string; grupoId: string }[];
  /** Telefones com `remover` em fila/processando neste grupo. */
  pendentes: string[];
};

export type PlanoRodada = {
  removerBloqueio: string[];
  removerDuplicado: string[];
  ganhamCampanha: string[];
  /** Saídas a gravar agora (com motivo "sozinho"); as pendentes ficam pra ação `remover`. */
  sairamSozinhos: string[];
  ganhamSaiu: string[];
};

/** Decide uma rodada de um grupo. Quem já estava gravado em outro grupo da campanha é sempre o mais antigo, então
 *  quem chegou agora é o duplicado. */
export function planoDaRodada(d: DadosRodada): PlanoRodada {
  const candidatos = candidatosDaRodada(d.entraram, d.protegidos);
  const bloqueados = chaves(d.bloqueados);
  const emOutros = chaves(d.abertos.filter((a) => a.grupoId !== d.grupoId).map((a) => a.telefone));
  const removerBloqueio = candidatos.filter((t) => bloqueados.has(chaveTelefone(t)));
  const removerDuplicado = candidatos.filter((t) => !bloqueados.has(chaveTelefone(t)) && emOutros.has(chaveTelefone(t)));
  const saem = chaves([...removerBloqueio, ...removerDuplicado]);
  const ganhamCampanha = candidatos.filter((t) => !saem.has(chaveTelefone(t)));

  const pendentes = chaves(d.pendentes);
  const protegidos = chaves(d.protegidos);
  const sozinhos = d.sairam.filter((m) => !pendentes.has(chaveTelefone(m.telefone)));
  return {
    removerBloqueio,
    removerDuplicado,
    ganhamCampanha,
    sairamSozinhos: sozinhos.map((m) => m.telefone),
    ganhamSaiu: sozinhos.filter((m) => !m.admin && !protegidos.has(chaveTelefone(m.telefone))).map((m) => m.telefone),
  };
}

/** Seção "Gerenciamento de Tags" da campanha (Etapa 3J): tags `manual` postas/tiradas quando a pessoa ganha a tag
 *  Campanha (entrou) ou a Saiu (saiu). Tag apagada vira null (FK `on delete set null`) e é pulada. */
export type TagsDaCampanha = {
  ativo: boolean;
  entrouAdicionar: string | null;
  entrouRemover: string | null;
  saiuAdicionar: string | null;
  saiuRemover: string | null;
};

export type OperacaoTag = { rpc: "por_tag" | "tirar_tag"; tag: string; telefones: string[] };

/** As chamadas `por_tag`/`tirar_tag` (sempre com `p_campanha` null: tag manual é do telefone) da rodada. Desligada,
 *  sem tag ou sem ninguém: nenhuma. */
export function operacoesDeTags(cfg: TagsDaCampanha | undefined, ganhamCampanha: string[], ganhamSaiu: string[]): OperacaoTag[] {
  if (!cfg?.ativo) return [];
  const ops: OperacaoTag[] = [];
  const somar = (rpc: OperacaoTag["rpc"], tag: string | null, telefones: string[]) => {
    if (tag && telefones.length) ops.push({ rpc, tag, telefones });
  };
  somar("por_tag", cfg.entrouAdicionar, ganhamCampanha);
  somar("tirar_tag", cfg.entrouRemover, ganhamCampanha);
  somar("por_tag", cfg.saiuAdicionar, ganhamSaiu);
  somar("tirar_tag", cfg.saiuRemover, ganhamSaiu);
  return ops;
}

/** Teto de remoções de "Remover Lead de Campanhas Anteriores" numa rodada: o resto vira alerta. */
export const TETO_REMOCOES_ANTERIORES = 500;

/** Campanhas anteriores que valem para a rodada: sem a própria campanha e sem repetir. */
export function campanhasAnterioresValidas(lista: readonly string[] | null | undefined, propria: string): string[] {
  return [...new Set((lista ?? []).filter((id) => typeof id === "string" && id && id !== propria))];
}

/** Agrupa as participações abertas nas campanhas anteriores por grupo (uma fila por grupo), até o teto. Devolve
 *  também quantas passaram do teto (alerta). Grupo da própria rodada nunca entra. */
export function remocoesAnteriores(
  abertas: { telefone: string; grupoId: string; campanhaId: string }[],
  grupoDaRodada: string,
  teto = TETO_REMOCOES_ANTERIORES,
): { grupos: { grupoId: string; campanhaId: string; telefones: string[] }[]; excedente: number } {
  const vistos = new Set<string>();
  const porGrupo = new Map<string, { grupoId: string; campanhaId: string; telefones: string[] }>();
  let total = 0;
  let excedente = 0;
  for (const a of abertas) {
    if (a.grupoId === grupoDaRodada) continue;
    const chave = `${a.grupoId}|${chaveTelefone(a.telefone)}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    if (total >= teto) {
      excedente++;
      continue;
    }
    total++;
    const g = porGrupo.get(a.grupoId) ?? { grupoId: a.grupoId, campanhaId: a.campanhaId, telefones: [] };
    g.telefones.push(a.telefone);
    porGrupo.set(a.grupoId, g);
  }
  return { grupos: [...porGrupo.values()], excedente };
}
