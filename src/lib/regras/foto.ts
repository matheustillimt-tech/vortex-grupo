/* Foto real dos grupos (Etapa 3M, Tarefa 3). Regras puras: o que gravar em `grupos.foto_url` e qual foto mostrar
   na campanha. Só URL `https://` vira foto; o resto é "sem foto" (letra). */

/** `avatarUrl` da resposta do Zapbot → foto. `undefined` = "não sei" (o campo nem veio); `null`, vazio ou qualquer
 *  coisa que não seja `https://` = sem foto; `https://…` = a URL. */
export function fotoDaResposta(avatarUrl: unknown): string | null | undefined {
  if (avatarUrl === undefined) return undefined;
  return typeof avatarUrl === "string" && avatarUrl.startsWith("https://") ? avatarUrl : null;
}

/** Foto lida no `GET groups/{id}` (a leitura da conferência). Prova de 17/10/2026 (`src/lib/zapbot/prova.ts`): essa
 *  rota traz `avatarUrl` quando o grupo tem foto e omite a chave quando não tem. Na prática a chave às vezes some de
 *  uma leitura pra outra com a foto lá: por isso a conferência usa `decidirFoto` (ausente não apaga na hora). */
export function fotoDoGrupoLido(avatarUrl: unknown): string | null {
  return fotoDaResposta(avatarUrl) ?? null;
}

/** URL sem a query string nem o `#`: as URLs do WhatsApp trocam os parâmetros assinados a cada leitura. */
export function urlSemQuery(url: string): string {
  const i = url.search(/[?#]/);
  return i < 0 ? url : url.slice(0, i);
}

/** Mesma foto = mesmo caminho (os parâmetros assinados não contam). */
export function mesmaFoto(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return (a ?? null) === (b ?? null);
  return urlSemQuery(a) === urlSemQuery(b);
}

/** O que a conferência acrescenta no `update` do grupo: nada quando a foto não mudou (a rodada roda a cada 2 min e
 *  não pode reescrever a foto toda vez — só os parâmetros da URL mudarem não conta); senão a foto nova e o instante.
 *  `noBanco` ausente (linha lida sem a coluna) conta como sem foto. */
export function mudancaDeFoto(noBanco: string | null | undefined, lida: string | null, agora: string): { foto_url: string | null; foto_atualizada_em: string } | null {
  return mesmaFoto(noBanco, lida) ? null : { foto_url: lida, foto_atualizada_em: agora };
}

/** Foto que o Vórtex Grupo acabou de pôr no grupo ("Trocar imagem" e a imagem da criação): grava a URL E o instante.
 *  Sem `foto_atualizada_em`, a carência de 24 h de `decidirFoto` não vale e a primeira conferência em que o
 *  `GET groups/{id}` não traz `avatarUrl` (o caso normal logo depois do `PUT group-picture`, teste de 17/10/2026)
 *  perguntava na rota `/avatar` e apagava a foto recém-posta. */
export function fotoPosta(url: string, agora: string): { foto_url: string; foto_atualizada_em: string } {
  return { foto_url: url, foto_atualizada_em: agora };
}

/** Por quanto tempo a foto gravada vale sem confirmação quando some do `GET groups/{id}`; e de quanto em quanto
 *  tempo, no máximo, a conferência pergunta na rota `/avatar` por grupo. */
export const VALIDADE_FOTO_MS = 24 * 60 * 60_000;

export type DecisaoFoto =
  | { tipo: "nada" }
  | { tipo: "gravar"; campos: { foto_url: string | null; foto_atualizada_em: string } }
  /** Perguntar na rota `groups/{id}/avatar` antes de apagar (ver `depoisDaConfirmacao`). */
  | { tipo: "confirmar" };

/** Foto na conferência. Veio `https://` no GET: grava se o caminho mudou. Não veio (ou não é `https://`) e o banco
 *  tem foto: mantém se ela foi gravada há menos de 24 h ou se já perguntamos na rota `/avatar` nas últimas 24 h;
 *  senão manda confirmar. Banco sem foto e nada lido: nada. Data ilegível conta como antiga. */
export function decidirFoto(p: {
  noBanco: string | null | undefined;
  atualizadaEm: string | null | undefined;
  conferidaEm: string | null | undefined;
  avatarUrl: unknown;
  agora: string;
}): DecisaoFoto {
  const lida = fotoDaResposta(p.avatarUrl);
  if (lida) {
    const campos = mudancaDeFoto(p.noBanco, lida, p.agora);
    return campos ? { tipo: "gravar", campos } : { tipo: "nada" };
  }
  if (!p.noBanco) return { tipo: "nada" };
  const agora = Date.parse(p.agora);
  const recente = (iso: string | null | undefined) => {
    const t = iso ? Date.parse(iso) : NaN;
    return Number.isFinite(t) && agora - t < VALIDADE_FOTO_MS;
  };
  if (recente(p.atualizadaEm) || recente(p.conferidaEm)) return { tipo: "nada" };
  return { tipo: "confirmar" };
}

/** Depois de perguntar na rota `/avatar`: sempre marca `foto_conferida_em` (uma pergunta por dia, mesmo com erro).
 *  `https://` com outro caminho = foto nova; mesmo caminho = mantém; `null` (sem foto ou 404) = apaga; `"erro"`
 *  (falha ou sem tempo) = mantém a gravada. */
export function depoisDaConfirmacao(
  noBanco: string | null | undefined,
  confirmada: string | null | "erro",
  agora: string,
): { foto_conferida_em: string; foto_url?: string | null; foto_atualizada_em?: string } {
  if (confirmada === "erro") return { foto_conferida_em: agora };
  const foto = fotoDaResposta(confirmada ?? undefined) ?? null;
  const campos = mudancaDeFoto(noBanco, foto, agora);
  return campos ? { ...campos, foto_conferida_em: agora } : { foto_conferida_em: agora };
}

/** Foto da campanha (cartão, Visão geral e migalha): a foto ATUAL do grupo ativo de menor número que tenha foto
 *  (`fotos_campanhas`, conferida no WhatsApp), pra acompanhar o grupo (pedido do dono, 20/10/2026); senão a imagem
 *  que a campanha põe nos grupos (só `https://`); senão `null` (letra). */
export function fotoDaCampanha(campanha: { imagem_grupo_url?: string | null }, fotoDoGrupo: string | null | undefined): string | null {
  return fotoDaResposta(fotoDoGrupo ?? undefined) ?? fotoDaResposta(campanha.imagem_grupo_url ?? undefined) ?? null;
}

/** Linhas de `fotos_campanhas` → mapa campanha → foto (só `https://`). */
export function mapaFotosCampanhas(linhas: unknown): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const l of Array.isArray(linhas) ? (linhas as { campanha_id?: unknown; foto_url?: unknown }[]) : []) {
    const foto = fotoDaResposta(l?.foto_url);
    if (typeof l?.campanha_id === "string" && foto) mapa.set(l.campanha_id, foto);
  }
  return mapa;
}
