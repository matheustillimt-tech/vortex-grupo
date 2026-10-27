import { normalizarTelefone, variantesTelefone } from "../telefone";

/** Regras puras da aba "Solicitações de entrada" (Etapa 3M, Tarefa 4) e das duas regras automáticas da conferência.
 *  Nada aqui chama banco nem Zapbot: quem decide "bloqueado" de verdade é `classificarPedidos` (servidor, na hora de
 *  aprovar), e esta parte só separa e limita. */

/** Teto de aprovações automáticas por grupo por rodada (e por chamada de `group-review`). */
export const MAX_AUTOMATICO_POR_GRUPO = 50;
/** Teto de grupos com regra automática por conexão por rodada da conferência. */
export const MAX_GRUPOS_REGRA_POR_RODADA = 10;
/** Só roda a regra automática se ainda sobrar mais que isto do prazo do tick. */
export const FOLGA_REGRA_MS = 20_000;
/** Teto de grupos lidos ao vivo na aba Pendentes (os de maior número primeiro). */
export const MAX_GRUPOS_PENDENTES = 40;
/** Teto de itens por clique em "Aprovar/Recusar selecionadas". */
export const MAX_ITENS_DECISAO = 200;

export const ERRO_BLOQUEADO = "Número bloqueado: não aprovado.";
export const ERRO_LID = "Número escondido pelo WhatsApp (LID): não aprovado.";
export const ERRO_CHEIO = "Grupo cheio: não aprovado.";
export const AVISO_COMUNIDADES = "Esta função não está disponível em comunidades, apenas em grupos comuns.";
export const AJUDA_LID = "Número escondido pelo WhatsApp: aprove ou recuse pelo celular.";
export const AJUDA_APROVAR_AUTOMATICAMENTE =
  "Quem pede para entrar é conferido no anti-spam a cada 2 minutos. Só números do Brasil são aprovados, aos poucos. Bloqueados nunca são aprovados; números escondidos (LID), estrangeiros e quem já está em outro grupo da campanha (ou das campanhas anteriores) ficam para você decidir; grupo cheio não aprova.";

/** Telefone brasileiro válido: `55` + DDD de 2 dígitos (sem zero) + 8 ou 9 dígitos. Só dígitos. */
export function ehTelefoneBR(telefone: string): boolean {
  return /^55[1-9]{2}[0-9]{8,9}$/.test(telefone.trim());
}

/** DDIs de fora do Brasil que aparecem nos grupos (Américas, Europa, África lusófona e os mais comuns da Ásia e
 *  Oceania). Número com um deles e até 13 dígitos é telefone de verdade; LID do WhatsApp costuma ter 14 ou 15. */
export const DDIS_CONHECIDOS = [
  "1", "7", "20", "27", "30", "31", "32", "33", "34", "36", "39", "40", "41", "43", "44", "45", "46", "47", "48", "49",
  "51", "52", "53", "54", "56", "57", "58", "60", "61", "62", "63", "64", "65", "66", "81", "82", "84", "86", "90", "91",
  "212", "213", "216", "234", "238", "239", "244", "245", "254", "258", "351", "352", "353", "354", "356", "358", "370",
  "371", "372", "376", "380", "385", "386", "420", "421", "502", "503", "504", "505", "506", "507", "509", "591", "592",
  "593", "595", "597", "598", "670", "852", "853", "886", "971", "972", "974", "966",
] as const;

function temDdiConhecidoForaDoBrasil(digitos: string): boolean {
  return DDIS_CONHECIDOS.some((ddi) => digitos.startsWith(ddi));
}

/** Id escondido pelo WhatsApp (LID): `…@lid`, ou qualquer coisa que não seja telefone brasileiro válido — a não ser
 *  que tenha um DDI conhecido de fora do Brasil e até 13 dígitos (estrangeiro de verdade). LID sem o sufixo `@lid`
 *  (15 dígitos, às vezes começando com 55) cai aqui. */
export function ehPedidoLid(telefone: string): boolean {
  const t = telefone.trim();
  if (/@lid$/i.test(t)) return true;
  if (ehTelefoneBR(t)) return false;
  if (/^[0-9]{10,13}$/.test(t) && !t.startsWith("55") && temDdiConhecidoForaDoBrasil(t)) return false;
  return true;
}

export type Classificacao = {
  /** Telefones de `bloqueados_efetivos` (qualquer forma do nono dígito). */
  bloqueados: readonly string[];
  /** Ids crus dos pedidos que casaram com `bloqueados.lid`. */
  lidsBloqueados: readonly string[];
};

export type Separados<T> = { livres: T[]; bloqueados: T[]; soLid: T[] };

/** Bloqueado (pelas duas formas do nono dígito ou pelo LID) vem primeiro; depois LID; o resto é livre. */
export function separarPedidos<T extends { telefone: string }>(pedidos: readonly T[], c: Classificacao): Separados<T> {
  const bloq = new Set(c.bloqueados.flatMap(variantesTelefone));
  const lids = new Set(c.lidsBloqueados);
  const out: Separados<T> = { livres: [], bloqueados: [], soLid: [] };
  for (const p of pedidos) {
    if (lids.has(p.telefone) || variantesTelefone(p.telefone).some((v) => bloq.has(v))) out.bloqueados.push(p);
    else if (ehPedidoLid(p.telefone)) out.soLid.push(p);
    else out.livres.push(p);
  }
  return out;
}

/** Teto de aprovações automáticas de um grupo numa rodada pra que a próxima leitura nunca pareça "entrada em massa"
 *  (`rodadaSuspeita`: 10+ entradas e mais da metade da lista nova): até 9 sempre; acima disso, metade de quem já está. */
export function tetoEntradaSegura(membros: number): number {
  return Math.max(9, Math.floor((Number.isFinite(membros) ? Math.max(0, membros) : 0) / 2));
}

export const MOTIVO_AUTOMATICO = "Aprovação automática";
export const MOTIVO_TAG = "Aprovação por tag";
export type MotivoAprovacao = typeof MOTIVO_AUTOMATICO | typeof MOTIVO_TAG;

/** O que a conferência faz com os pedidos de um grupo. Bloqueado nunca vai pra `aprovar` (só pra `recusar`, e só com
 *  `recusarBloqueados`); LID nunca é aprovado nem recusado sozinho; a aprovação automática só aprova telefone
 *  brasileiro válido e nunca quem já está aberto em outro grupo da campanha ou nas campanhas anteriores
 *  (`jaParticipam`, nas duas formas do nono dígito); a aprovação por tag (Etapa 3N) aprova o livre que tem uma das
 *  tags escolhidas (`comTag`, nas duas formas do nono dígito), sem exigir número BR nem passar por `jaParticipam`
 *  (a tag é escolha explícita), mas nunca bloqueado nem LID. `aprovar` é a união das duas, sem repetir, na ordem dos
 *  pedidos, limitada a `min(50, vagas, tetoEntradaSegura)`; rodada suspeita não decide nada. `motivo` diz por qual
 *  regra cada aprovado passou (tag tem preferência quando as duas valem). */
export function planoAutomatico<T extends { telefone: string }>(p: {
  pedidos: Separados<T>;
  recusarBloqueados: boolean;
  aprovarAutomaticamente: boolean;
  vagas: number;
  suspeita: boolean;
  /** Quantas pessoas o grupo tem agora (com admins). */
  membros: number;
  /** Telefones já abertos em outro grupo da campanha (ou nas campanhas anteriores, com a seção ligada). */
  jaParticipam?: readonly string[];
  /** "Aprovação automática por tag" ligada (Etapa 3N). */
  aprovarPorTag?: boolean;
  /** Telefones (de qualquer forma) que têm ao menos uma das tags escolhidas. */
  comTag?: readonly string[];
}): { aprovar: string[]; recusar: string[]; motivo: Record<string, MotivoAprovacao> } {
  if (p.suspeita) return { aprovar: [], recusar: [], motivo: {} };
  const barrados = new Set([...p.pedidos.bloqueados, ...p.pedidos.soLid].map((x) => x.telefone));
  const ja = new Set((p.jaParticipam ?? []).flatMap(variantesTelefone));
  const tag = new Set(p.aprovarPorTag ? (p.comTag ?? []).flatMap(variantesTelefone) : []);
  const recusar = p.recusarBloqueados ? [...new Set(p.pedidos.bloqueados.map((x) => x.telefone))].slice(0, MAX_AUTOMATICO_POR_GRUPO) : [];
  const vagas = Math.floor(Number.isFinite(p.vagas) ? p.vagas : 0);
  const teto = Math.max(0, Math.min(MAX_AUTOMATICO_POR_GRUPO, vagas, tetoEntradaSegura(p.membros)));
  const motivo: Record<string, MotivoAprovacao> = {};
  const aprovar: string[] = [];
  for (const t of new Set(p.pedidos.livres.map((x) => x.telefone))) {
    if (aprovar.length >= teto) break;
    if (barrados.has(t) || ehPedidoLid(t)) continue;
    const variantes = variantesTelefone(t);
    const porTag = p.aprovarPorTag === true && variantes.some((v) => tag.has(v));
    const porRegra = p.aprovarAutomaticamente && ehTelefoneBR(t) && !variantes.some((v) => ja.has(v));
    if (!porTag && !porRegra) continue;
    aprovar.push(t);
    motivo[t] = porTag ? MOTIVO_TAG : MOTIVO_AUTOMATICO;
  }
  return { aprovar, recusar, motivo };
}

/** Pedidos que seguram vaga: os vistos de até 48 h (pela hora do pedido; sem ela, pela hora em que foi visto). */
export const RESERVA_MS = 48 * 60 * 60_000;
export function reservadosDoGrupo(vistos: readonly { pedido_em?: string | null; visto_em: string }[], agora: string | Date): number {
  const limite = (typeof agora === "string" ? Date.parse(agora) : agora.getTime()) - RESERVA_MS;
  let n = 0;
  for (const v of vistos) {
    const pedido = v.pedido_em ? Date.parse(v.pedido_em) : NaN;
    const quando = Number.isFinite(pedido) ? pedido : Date.parse(v.visto_em);
    if (Number.isFinite(quando) && quando >= limite) n++;
  }
  return n;
}

/** A reserva gravada só vale se foi lida há até isto: grupo que deixou de ser lido não segura vaga. */
export const VALIDADE_RESERVA_MS = 15 * 60_000;
/** Reservados que entram na conta de lotação: 0 com a reserva desligada, sem aprovação no grupo, sem
 *  `pendentes_lidos_em` ou com a leitura mais velha que `VALIDADE_RESERVA_MS`. */
export function reservadosEmVigor(p: { ligada: boolean; reservados: number | null | undefined; lidosEm: string | null | undefined; agora: string | Date }): number {
  if (!p.ligada || !p.lidosEm) return 0;
  const lido = Date.parse(p.lidosEm);
  const agora = typeof p.agora === "string" ? Date.parse(p.agora) : p.agora.getTime();
  if (!Number.isFinite(lido) || !Number.isFinite(agora) || agora - lido > VALIDADE_RESERVA_MS) return 0;
  const n = Number(p.reservados ?? 0);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

export const MOTIVO_APROVADA_CELULAR = "Aprovada pelo celular";
export const AJUDA_CANCELADA = "Saiu da lista sem decisão pelo Vórtex Grupo (a pessoa desistiu ou um admin recusou pelo celular).";
export const MOTIVO_EXPIRADA_SEM_LEITURA = "Sem leitura há 48 horas";
export const MOTIVO_EXPIRADA_NAO_EXISTE = "O pedido já não existia no WhatsApp";

export type Visto = { telefone: string; visto_em: string; pedido_em?: string | null };

/** Compara a leitura de agora com os pedidos já vistos de um grupo. Só fecha alguma coisa com `completa` (o grupo
 *  respondeu): numa leitura parcial nada some. O que sumiu da lista:
 *  - decidido pelo Vórtex Grupo depois de `visto_em` → `descartados` (a linha da decisão já existe; não duplica);
 *  - entrou no grupo (participante aberto com `entrou_em >= visto_em`, nas duas formas do nono dígito) → `aprovada`
 *    (pelo celular);
 *  - LID que sumiu sem decisão nem entrada: fica em `manter` (nunca `cancelada`);
 *  - não entrou: `cancelada` se `participantesFrescos` (a lista de participantes foi lida depois do pedido sumir: a
 *    conferência); senão fica em `manter` sem atualizar (a próxima leitura da conferência decide). */
export function reconciliarLeitura<V extends Visto>(p: {
  vistos: readonly V[];
  lidos: readonly { telefone: string }[];
  completa: boolean;
  participantesNovos: readonly { telefone: string; entrou_em: string }[];
  decididos: readonly { telefone: string; created_at: string }[];
  /** Os participantes foram lidos depois da leitura de pendentes que deu falta (padrão true). */
  participantesFrescos?: boolean;
}): { novos: string[]; sumiram: { telefone: string; decisao: "aprovada" | "cancelada" }[]; manter: V[]; descartados: string[] } {
  const vistosPorTel = new Map(p.vistos.map((v) => [v.telefone, v]));
  const lidos = new Set(p.lidos.map((l) => l.telefone));
  const novos = [...lidos].filter((t) => !vistosPorTel.has(t));
  if (!p.completa) return { novos, sumiram: [], manter: [...p.vistos], descartados: [] };
  const depois = (lista: readonly { telefone: string; quando: string }[], t: string, desde: string) => {
    const vs = new Set(variantesTelefone(t.split("@")[0]));
    const d = Date.parse(desde);
    return lista.some((x) => vs.has(x.telefone) && Date.parse(x.quando) >= d);
  };
  const entradas = p.participantesNovos.flatMap((x) => variantesTelefone(x.telefone).map((telefone) => ({ telefone, quando: x.entrou_em })));
  const decisoes = p.decididos.flatMap((x) => variantesTelefone(x.telefone.split("@")[0]).map((telefone) => ({ telefone, quando: x.created_at })));
  const sumiram: { telefone: string; decisao: "aprovada" | "cancelada" }[] = [];
  const manter: V[] = [];
  const descartados: string[] = [];
  for (const v of p.vistos) {
    if (lidos.has(v.telefone)) {
      manter.push(v);
      continue;
    }
    if (depois(decisoes, v.telefone, v.visto_em)) descartados.push(v.telefone);
    else if (depois(entradas, v.telefone, v.visto_em)) sumiram.push({ telefone: v.telefone, decisao: "aprovada" });
    // LID: o participante entra com o telefone, não com o id escondido; sem como saber se entrou, nunca vira
    // "cancelada" (fica até casar com uma decisão ou expirar em 48 h).
    else if (p.participantesFrescos === false || ehPedidoLid(v.telefone)) manter.push(v);
    else sumiram.push({ telefone: v.telefone, decisao: "cancelada" });
  }
  return { novos, sumiram, manter, descartados };
}

/** Filtros do "Histórico de solicitações" (botões). */
export const FILTROS_HISTORICO = ["todas", "aprovadas", "rejeitadas", "canceladas", "expiradas"] as const;
export type FiltroHistorico = (typeof FILTROS_HISTORICO)[number];
export const ROTULO_FILTRO_HISTORICO: Record<FiltroHistorico, string> = {
  todas: "TODAS",
  aprovadas: "APROVADAS",
  rejeitadas: "REJEITADAS",
  canceladas: "CANCELADAS",
  expiradas: "EXPIRADAS",
};
export function lerFiltroHistorico(v: unknown): FiltroHistorico {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return (FILTROS_HISTORICO as readonly string[]).includes(s) ? (s as FiltroHistorico) : "todas";
}
/** Condição de cada filtro em `solicitacoes_entrada` (`todas` = sem condição, inclusive as de erro). */
export function condicaoFiltroHistorico(f: FiltroHistorico): { decisao?: string; resultado?: string } {
  switch (f) {
    case "aprovadas":
      return { decisao: "aprovada", resultado: "ok" };
    case "rejeitadas":
      return { decisao: "recusada", resultado: "ok" };
    case "canceladas":
      return { decisao: "cancelada" };
    case "expiradas":
      return { decisao: "expirada" };
    default:
      return {};
  }
}

/** Vagas do grupo pra aprovação: limite da campanha menos quem já está; grupo cheio = 0. */
export function vagasDoGrupo(limite: number | null | undefined, membros: number, cheio: boolean): number {
  if (cheio) return 0;
  return Math.max(0, (Number.isFinite(limite) ? Number(limite) : 0) - membros);
}

/** Busca "pelo número completo": só os dígitos da busca, comparados nas duas formas do nono dígito (com ou sem o 55).
 *  Busca vazia devolve a lista inteira. */
export function filtrarPorNumero<T extends { telefone: string | null }>(lista: readonly T[], busca: string): T[] {
  const digitos = busca.replace(/\D/g, "");
  if (!digitos) return [...lista];
  const alvo = new Set([...variantesTelefone(digitos), ...variantesTelefone(normalizarTelefone(digitos) ?? digitos)]);
  return lista.filter((i) => !!i.telefone && variantesTelefone(i.telefone.replace(/\D/g, "")).some((v) => alvo.has(v)));
}

/** Resposta dos botões "Aprovar/Recusar selecionadas". */
export function mensagemDecisao(decisao: "aprovada" | "recusada", r: { ok: number; falhas: number; bloqueados: number }): string {
  if (decisao === "aprovada") return `${r.ok} aprovada(s); ${r.bloqueados} não aprovada(s) por bloqueio; ${r.falhas} falharam`;
  return `${r.ok} recusada(s); ${r.falhas} falharam`;
}

/** Resumo do histórico. Nunca leva telefone. */
export function resumoHistoricoDecisao(aprovadas: number, recusadas: number): string {
  return `Solicitações de entrada: +${aprovadas} aprovadas, −${recusadas} recusadas`;
}

export const CABECALHO_PENDENTES = ["Número", "Grupo", "Pedido em"];
export const CABECALHO_PROCESSADAS = ["Número", "Grupo", "Decisão", "Origem", "Motivo", "Resultado", "Erro", "Pedido em", "Data"];

export const ROTULO_DECISAO: Record<string, string> = { aprovada: "Aprovada", recusada: "Recusada", cancelada: "Cancelada", expirada: "Expirada" };
export const ROTULO_ORIGEM: Record<string, string> = { manual: "Manual", automatica: "Automática", whatsapp: "Pelo WhatsApp" };

/** Textos dos cartões da aba Configurações (Etapa 3N, cartões). */
export const TEXTO_RESERVAR_VAGA =
  "Enquanto uma solicitação estiver aguardando aprovação, a vaga dela fica reservada. Vale para pedidos das últimas 48 horas";
export const AJUDA_RESERVAR_VAGA = "Os pedidos são lidos a cada 2 minutos nos grupos com aprovação ligada.";
export const TEXTO_APROVAR_POR_TAG = "Aprova automaticamente quem solicitar entrada e tiver pelo menos uma das tags selecionadas";
export const AJUDA_APROVAR_POR_TAG = "Bloqueados e números escondidos (LID) nunca são aprovados; grupo cheio não aprova.";
/** Teto de tags na aprovação por tag (= check da coluna `campanhas.aprovar_tags`). */
export const MAX_APROVAR_TAGS = 20;
