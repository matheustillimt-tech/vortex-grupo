import { TIPOS_EXECUCAO, type TipoExecucao } from "./conteudo";

/** Regras puras da tela geral de Ações (`/acoes`, Etapa 3B): rótulo/ícone por tipo, título do cartão, situação
 *  (selo com bolinha) e duração. Abas, campanha/conta/tipo e paginação moram na RPC `listar_acoes` (banco); aqui
 *  é só o que a UI desenha por cima do que a RPC devolveu. */

/** Rótulo de cada tipo de ação, como a spec do assistente "Adicionar ação" escreve. */
export const ROTULO_ACAO: Record<TipoExecucao, string> = {
  mensagem: "Enviar mensagem",
  enquete: "Enviar enquete",
  nome: "Trocar nome",
  descricao: "Trocar descrição",
  abrir: "Abrir Grupos",
  fechar: "Fechar Grupos",
  admin_add: "Adicionar administradores",
  admin_remover: "Remover administradores",
  redefinir_link: "Redefinir link de convite",
  configuracao: "Trocar configuração",
  remover_participantes: "Remover participantes",
  desativar_comunidade: "Desativar comunidade",
  atualizar_links: "Atualizar links dos grupos",
  mover_grupos: "Mover grupos para outra campanha",
  privacidade_avancada: "Privacidade Avançada na Conversa",
  imagem: "Trocar imagem",
};

/** Ícone Material de cada tipo, pelo padrão da spec. */
export const ICONE_ACAO: Record<TipoExecucao, string> = {
  mensagem: "send",
  enquete: "poll",
  nome: "title",
  descricao: "format_align_left",
  abrir: "key",
  fechar: "lock",
  admin_add: "add_moderator",
  admin_remover: "remove_moderator",
  redefinir_link: "link_off",
  configuracao: "settings",
  remover_participantes: "person_remove",
  desativar_comunidade: "delete",
  atualizar_links: "link",
  mover_grupos: "move_to_inbox",
  privacidade_avancada: "privacy_tip",
  imagem: "image",
};

/** Título do cartão (ex.: "Campanha: Enviar mensagem"). Hoje toda ação do Vórtex Grupo é escopo de campanha — as
 *  categorias Broadcast/Projeto/Privado da spec ainda não existem por aqui. */
export function tituloCartao(tipo: TipoExecucao): string {
  return `Campanha: ${ROTULO_ACAO[tipo]}`;
}

export const SITUACOES_ACAO = ["Agendado", "Na fila", "Processando", "Sucesso", "Falha", "Cancelado", "Pulado"] as const;
export type SituacaoAcao = (typeof SITUACOES_ACAO)[number];

export type CorSituacaoAcao = "neutro" | "aviso" | "ok" | "erro";

const COR_SITUACAO_ACAO: Record<SituacaoAcao, CorSituacaoAcao> = {
  Agendado: "neutro",
  "Na fila": "neutro",
  Processando: "aviso",
  Sucesso: "ok",
  Falha: "erro",
  Cancelado: "neutro",
  Pulado: "neutro",
};

/** Ícone do selo de situação do cartão de ação: status como ícone no lugar do chip de texto,
 *  com o rótulo de hoje virando `title`/`sr-only`. */
export const ICONE_SITUACAO_ACAO: Record<SituacaoAcao, string> = {
  Agendado: "schedule",
  "Na fila": "schedule",
  Processando: "double_arrow",
  Sucesso: "check_circle",
  Falha: "remove_circle",
  Cancelado: "block",
  Pulado: "block",
};

/** Selo da ação: mesma lógica das abas de `listar_acoes`/`listar_execucoes` (fila × agendado pela hora; falha
 *  junta "bloqueada" e "concluída com tarefa em erro"), só que em rótulo + cor da bolinha pro cartão. */
export function situacaoAcao(status: string, agendadaPara: string, temFalha: boolean, agora: Date = new Date()): { rotulo: SituacaoAcao; cor: CorSituacaoAcao } {
  const rotulo: SituacaoAcao = (() => {
    switch (status) {
      case "agendada":
        return new Date(agendadaPara).getTime() > agora.getTime() ? "Agendado" : "Na fila";
      case "enviando":
        return "Processando";
      case "cancelada":
        return "Cancelado";
      case "pulada":
        return "Pulado";
      case "bloqueada":
        return "Falha";
      case "concluida":
        return temFalha ? "Falha" : "Sucesso";
      default:
        return "Pulado";
    }
  })();
  return { rotulo, cor: COR_SITUACAO_ACAO[rotulo] };
}

/** "584ms", "12s", "3min 4s". Sem início/fim (ainda não rodou, ou ainda rodando) ou fim antes do início: null. */
export function duracao(inicio: string | Date | null | undefined, fim: string | Date | null | undefined): string | null {
  if (!inicio || !fim) return null;
  const ms = new Date(fim).getTime() - new Date(inicio).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) {
    const seg = Math.floor(ms / 1000);
    const resto = ms % 1000;
    return `${seg}s ${resto}ms`;
  }
  const totalSeg = Math.round(ms / 1000);
  const min = Math.floor(totalSeg / 60);
  const seg = totalSeg % 60;
  return seg ? `${min}min ${seg}s` : `${min}min`;
}

/** Filtro "tipos" vindo da URL/consulta: whitelist contra `TIPOS_EXECUCAO`. Nada válido (vazio, lixo, tipo
 *  desconhecido) vira `null` — "sem filtro", que pra `listar_acoes` quer dizer "todos os tipos". */
export function filtroTipos(param: string | string[] | null | undefined): TipoExecucao[] | null {
  const lista = Array.isArray(param) ? param : typeof param === "string" ? param.split(",") : [];
  const validos = [...new Set(lista.map((t) => t.trim()).filter((t): t is TipoExecucao => (TIPOS_EXECUCAO as readonly string[]).includes(t)))];
  return validos.length ? validos : null;
}
