/** Seções da Visão geral da campanha (Etapa 3J): menu da esquerda, interruptores "Ativado/Desativado" e a lista
 *  branca de colunas que a action `definirInterruptor` pode gravar. Sem `server-only`: a página (servidor) e o
 *  interruptor (cliente) usam. */
import { ehUuid } from "./uuid";

/** Ordem do menu da esquerda (valor de `?secao=`). */
export const SECOES_CAMPANHA = [
  { valor: "metricas", rotulo: "Métricas" },
  { valor: "tags", rotulo: "Gerenciamento de Tags" },
  { valor: "variaveis", rotulo: "Variáveis" },
  { valor: "cookie", rotulo: "Cookie de redirecionamento" },
  { valor: "colaboradores", rotulo: "Verificação de Colaboradores" },
  { valor: "entrega", rotulo: "Confirmação de entrega" },
  { valor: "comunidades", rotulo: "Gestão de comunidades" },
  { valor: "links-banimento", rotulo: "Atualização de links" },
  { valor: "links-periodicos", rotulo: "Atualização periódica de links" },
  { valor: "redefinir-link", rotulo: "Redefinir link de convite" },
  { valor: "anteriores", rotulo: "Remover Lead de Campanhas Anteriores" },
  { valor: "deep-linking", rotulo: "Deep Linking" },
  { valor: "duplicados", rotulo: "Checar participantes duplicados" },
  { valor: "dividir-chips", rotulo: "Dividir envios entre chips" },
  { valor: "aviso-queda", rotulo: "Aviso de chip caído" },
  { valor: "aula", rotulo: "Data da aula e sequência" },
] as const satisfies readonly { valor: string; rotulo: string; icone?: string }[];

export type SecaoCampanha = (typeof SECOES_CAMPANHA)[number]["valor"];

/** Valor de `?secao=` desconhecido (inclusive os antigos `vip` e `compradores`, removidos em 19/10/2026) abre
 *  Métricas. */
export function lerSecao(v: string | undefined): SecaoCampanha {
  return SECOES_CAMPANHA.some((s) => s.valor === v) ? (v as SecaoCampanha) : "metricas";
}

export function rotuloDaSecao(s: SecaoCampanha): string {
  return SECOES_CAMPANHA.find((x) => x.valor === s)!.rotulo;
}

/** Colunas de `campanhas` das seções (migração `20261017190000_campanha_secoes.sql` + `usar_comunidade`). */
export type CampanhaSecoes = {
  tags_ativo: boolean;
  tag_entrou_adicionar: string | null;
  tag_entrou_remover: string | null;
  tag_saiu_adicionar: string | null;
  tag_saiu_remover: string | null;
  cookie_redirecionamento: boolean;
  verificacao_colaboradores: boolean;
  confirmar_entrega: boolean;
  confirmar_entrega_desde: string | null;
  usar_comunidade: boolean;
  atualizar_links_banimento: boolean;
  links_periodicos: boolean;
  links_por_dia: number;
  links_atualizados_em: string | null;
  redefinir_link_cheio: boolean;
  remover_anteriores_ativo: boolean;
  campanhas_anteriores: string[];
  deep_linking: boolean;
  pixel_meta_ativo: boolean;
  pixel_meta_id: string | null;
  checar_duplicados: boolean;
  dividir_chips: boolean;
  chips_divisao: string[];
  telefones_aviso_queda: string[];
};

/** Seções que têm o interruptor "Ativado/Desativado" no título. "tags" e "links-periodicos" saíram daqui na
 *  Etapa 3N (Tarefa 5): salvam ao escolher/ao sair do campo, sem interruptor nem "SALVAR" —. */
export type SecaoComInterruptor =
  | "cookie"
  | "colaboradores"
  | "entrega"
  | "comunidades"
  | "links-banimento"
  | "redefinir-link"
  | "anteriores"
  | "deep-linking"
  | "duplicados"
  | "dividir-chips";

/** Lista branca: cada interruptor grava só a sua coluna. */
export const COLUNA_DO_INTERRUPTOR: Record<SecaoComInterruptor, keyof CampanhaSecoes> = {
  cookie: "cookie_redirecionamento",
  colaboradores: "verificacao_colaboradores",
  entrega: "confirmar_entrega",
  comunidades: "usar_comunidade",
  "links-banimento": "atualizar_links_banimento",
  "redefinir-link": "redefinir_link_cheio",
  anteriores: "remover_anteriores_ativo",
  "deep-linking": "deep_linking",
  duplicados: "checar_duplicados",
  "dividir-chips": "dividir_chips",
};

/** Interruptores aceitos pela action: os das seções + o do sub-bloco "Pixel da Meta" (dentro do Deep Linking). */
export type Interruptor = SecaoComInterruptor | "pixel";

export const COLUNA_DOS_INTERRUPTORES: Record<Interruptor, keyof CampanhaSecoes> = { ...COLUNA_DO_INTERRUPTOR, pixel: "pixel_meta_ativo" };

export function ehInterruptor(v: unknown): v is Interruptor {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(COLUNA_DOS_INTERRUPTORES, v);
}

/** Título usado no histórico ("Campanha: {título} ativado/desativado"). */
export function tituloDoInterruptor(i: Interruptor): string {
  return i === "pixel" ? "Pixel da Meta" : rotuloDaSecao(i);
}

/** ID do Pixel da Meta: só dígitos, 10 a 20 (o mesmo check do banco). Devolve o id limpo ou null. O id entra no
 *  HTML da página pública: nada além de dígitos passa daqui. */
export function validarPixel(id: unknown): string | null {
  if (typeof id !== "string") return null;
  const limpo = id.trim();
  return /^[0-9]{10,20}$/.test(limpo) ? limpo : null;
}

/** O que gravar em `campanhas` ao mudar um interruptor (só a coluna dele, mais os efeitos combinados abaixo). */
export function alteracaoDoInterruptor(
  i: Interruptor,
  valor: boolean,
  atual: Pick<CampanhaSecoes, "deep_linking" | "pixel_meta_id">,
  agora: Date,
): { ok: true; update: Record<string, unknown> } | { ok: false; erro: string } {
  const coluna = COLUNA_DOS_INTERRUPTORES[i];
  const update: Record<string, unknown> = { [coluna]: valor };
  if (i === "pixel" && valor) {
    if (!atual.deep_linking) return { ok: false, erro: "Ative o Deep Linking antes de ativar o Pixel da Meta." };
    if (!validarPixel(atual.pixel_meta_id)) return { ok: false, erro: "Salve o ID do Pixel antes de ativar." };
  }
  // Confirmação de entrega só confere mensagens enviadas depois de ligada.
  if (i === "entrega" && valor) update.confirmar_entrega_desde = agora.toISOString();
  return { ok: true, update };
}

/** Formulário "Gerenciamento de Tags": um bloco "entrar" e um "sair", cada um com "Adicionar tag" e "Remover tag"
 *  (vazio = nenhuma). */
export type TagsCampanhaEntrada = {
  entrou: { adicionar: string; remover: string };
  saiu: { adicionar: string; remover: string };
};

/** Confere o formato (ids vazios ou uuid; a mesma tag não pode estar em Adicionar e Remover do mesmo bloco) e
 *  devolve as colunas a gravar. Que cada tag existe e é `manual` a action confere no banco. */
export function lerTagsCampanha(e: unknown):
  | {
      ok: true;
      colunas: Pick<CampanhaSecoes, "tag_entrou_adicionar" | "tag_entrou_remover" | "tag_saiu_adicionar" | "tag_saiu_remover" | "tags_ativo">;
      ids: string[];
    }
  | { ok: false; erro: string } {
  const bloco = (b: unknown) => {
    const o = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
    return { adicionar: o.adicionar, remover: o.remover };
  };
  const obj = (e && typeof e === "object" ? e : {}) as Record<string, unknown>;
  const entrou = bloco(obj.entrou);
  const saiu = bloco(obj.saiu);
  const id = (v: unknown): string | null | undefined => {
    if (v === undefined || v === null || v === "") return null;
    return typeof v === "string" && ehUuid(v) ? v : undefined;
  };
  const valores = [id(entrou.adicionar), id(entrou.remover), id(saiu.adicionar), id(saiu.remover)];
  if (valores.some((v) => v === undefined)) return { ok: false, erro: "Tag inválida." };
  const [ea, er, sa, sr] = valores as (string | null)[];
  if (ea && ea === er) return { ok: false, erro: "Quando o participante entrar: a mesma tag não pode ser adicionada e removida." };
  if (sa && sa === sr) return { ok: false, erro: "Quando o participante sair: a mesma tag não pode ser adicionada e removida." };
  // Sem interruptor (Etapa 3N): escolher qualquer tag liga `tags_ativo`; limpar tudo desliga — nunca fica
  // dependendo de um botão separado.
  const tagsAtivo = algumaTagEscolhida({ tag_entrou_adicionar: ea, tag_entrou_remover: er, tag_saiu_adicionar: sa, tag_saiu_remover: sr });
  return {
    ok: true,
    colunas: { tag_entrou_adicionar: ea, tag_entrou_remover: er, tag_saiu_adicionar: sa, tag_saiu_remover: sr, tags_ativo: tagsAtivo },
    ids: [...new Set([ea, er, sa, sr].filter((v): v is string => !!v))],
  };
}

/** Alguma das 4 tags (entrar/sair × adicionar/remover) está escolhida. */
export function algumaTagEscolhida(
  t: Pick<CampanhaSecoes, "tag_entrou_adicionar" | "tag_entrou_remover" | "tag_saiu_adicionar" | "tag_saiu_remover">,
): boolean {
  return !!(t.tag_entrou_adicionar || t.tag_entrou_remover || t.tag_saiu_adicionar || t.tag_saiu_remover);
}

/** Máximo de campanhas anteriores (o mesmo check do banco). */
export const MAXIMO_CAMPANHAS_ANTERIORES = 50;

/** Lista de "Campanhas Anteriores": uuids, sem repetir, sem a própria campanha, até 50. */
export function lerCampanhasAnteriores(lista: unknown, propria: string): { ok: true; ids: string[] } | { ok: false; erro: string } {
  if (!Array.isArray(lista)) return { ok: false, erro: "Lista de campanhas inválida." };
  if (lista.some((v) => typeof v !== "string" || !ehUuid(v))) return { ok: false, erro: "Campanha inválida na lista." };
  const ids = [...new Set(lista as string[])];
  if (ids.includes(propria)) return { ok: false, erro: "A própria campanha não pode estar na lista." };
  if (ids.length > MAXIMO_CAMPANHAS_ANTERIORES) return { ok: false, erro: `Escolha no máximo ${MAXIMO_CAMPANHAS_ANTERIORES} campanhas.` };
  return { ok: true, ids };
}

/** Máximo de chips escolhidos em "Dividir envios entre chips" (o mesmo check do banco). */
export const MAXIMO_CHIPS_DIVISAO = 50;

/** Chips de "Dividir envios entre chips": uuids, sem repetir, até 50. Vazio = todos os conectados e admin do grupo. */
export function lerChipsDivisao(lista: unknown): { ok: true; ids: string[] } | { ok: false; erro: string } {
  if (!Array.isArray(lista)) return { ok: false, erro: "Lista de chips inválida." };
  if (lista.some((v) => typeof v !== "string" || !ehUuid(v))) return { ok: false, erro: "Chip inválido na lista." };
  const ids = [...new Set(lista as string[])];
  if (ids.length > MAXIMO_CHIPS_DIVISAO) return { ok: false, erro: `Escolha no máximo ${MAXIMO_CHIPS_DIVISAO} chips.` };
  return { ok: true, ids };
}

/** "Quantidade de atualizações por dia" da Atualização periódica de links: inteiro de 1 a 24 (o mesmo check do
 *  banco; 24 = de hora em hora, o intervalo mínimo). */
export function lerLinksPorDia(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 24 ? n : null;
}

/** Entrada do campo único de "Atualização periódica de links" (Etapa 3N, sem interruptor nem "SALVAR" — campo
 *  que salva ao sair). Vazio desliga (`links_periodicos = false`, sem mudar
 *  `links_por_dia`); um número de 1 a 24 liga (`links_periodicos = true` + grava `links_por_dia`); qualquer outra
 *  coisa é inválido. */
export function lerLinksPorDiaEntrada(v: unknown):
  | { ok: true; ligar: false }
  | { ok: true; ligar: true; n: number }
  | { ok: false; erro: string } {
  if (v === "" || v === null || v === undefined) return { ok: true, ligar: false };
  const n = lerLinksPorDia(v);
  if (n === null) return { ok: false, erro: "Escolha de 1 a 24 atualizações por dia, ou deixe vazio para desligar." };
  return { ok: true, ligar: true, n };
}
