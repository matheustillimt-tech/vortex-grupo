import { UUID } from "./uuid";

/** Regras puras do anti-spam (Etapa 3H, Tarefa 3): a fonte única de números bloqueados e o "Antispam por Contas
 *  Associadas". Sem `server-only`: a tela de configuração também lê estes tipos/constantes. */

/** View do banco com `bloqueados` + números das blacklists ATIVAS (migração `20261017160200_blacklists.sql`).
 *  Toda leitura de "quem está bloqueado" que decide remoção (conferência e análise de grupos) usa esta fonte; a
 *  tabela `bloqueados` continua sendo onde a tela Anti-spam grava e lista os bloqueios manuais. */
export const FONTE_BLOQUEADOS = "bloqueados_efetivos";

/** Máximo de números por colagem (blacklist), igual o teto de linhas do bloqueio em lote. */
export const MAX_NUMEROS_COLAGEM = 5000;

/** Chave em `configuracoes` do interruptor "Antispam por Contas Associadas". */
export const CHAVE_ANTISPAM_CONTAS = "antispam_contas";

export type AntispamContas = { ligado: boolean; contas: string[] };

export const ANTISPAM_CONTAS_PADRAO: AntispamContas = { ligado: false, contas: [] };


/** Lê `configuracoes.valor` (jsonb de formato desconhecido). Sem linha ou valor estranho = desligado (o
 *  comportamento de antes da Etapa 3H: toda conta remove). */
export function lerAntispamContas(valor: unknown): AntispamContas {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return ANTISPAM_CONTAS_PADRAO;
  const v = valor as { ligado?: unknown; contas?: unknown };
  const contas = Array.isArray(v.contas) ? [...new Set(v.contas.filter((c): c is string => typeof c === "string" && UUID.test(c)))] : [];
  return { ligado: v.ligado === true, contas };
}

/** A conta (conexão dona do grupo) pode executar a remoção do anti-spam? Desligado: todas podem. */
export function contaPodeRemover(cfg: AntispamContas, conexaoId: string | null): boolean {
  if (!cfg.ligado) return true;
  return !!conexaoId && cfg.contas.includes(conexaoId);
}

export function textoAlertaSemConta(grupo: string, conta: string): string {
  return `Anti-spam: número bloqueado no grupo ${grupo}, mas a conexão ${conta} não está autorizada a remover.`;
}

/** Valida o que vem da tela antes de gravar. Ligado exige pelo menos uma conta (senão nenhuma remoção roda). */
export function validarAntispamContas(entrada: unknown): { ok: true; valor: AntispamContas } | { ok: false; erro: string } {
  if (!entrada || typeof entrada !== "object") return { ok: false, erro: "Configuração inválida." };
  const e = entrada as { ligado?: unknown; contas?: unknown };
  if (typeof e.ligado !== "boolean") return { ok: false, erro: "Configuração inválida." };
  if (!Array.isArray(e.contas) || e.contas.length > 200 || e.contas.some((c) => typeof c !== "string" || !UUID.test(c))) return { ok: false, erro: "Conexões inválidas." };
  const contas = [...new Set(e.contas as string[])];
  if (e.ligado && !contas.length) return { ok: false, erro: "Escolha pelo menos uma conexão para ligar o Antispam por Conexões Associadas." };
  return { ok: true, valor: { ligado: e.ligado, contas } };
}

export type BloqueioExibido = { fonte: string; motivo: string | null; criadoEm: string | null };

/** O que mostrar no topo da página do lead quando ele está bloqueado (`bloqueados_efetivos`, Tarefa 2 acima):
 *  bloqueio manual mostra o motivo e desde quando, como sempre ("Anti-spam"); número que só está bloqueado por
 *  estar numa blacklist ativa mostra qual ("Blacklist: NOME"), sem motivo nem data (a tabela não tem). `null` =
 *  não está em nenhuma das duas fontes (não bloqueado). */
export function descreverBloqueio(
  antispam: { motivo: string | null; created_at: string } | null,
  blacklist: { nome: string } | null,
): BloqueioExibido | null {
  if (antispam) return { fonte: "Anti-spam", motivo: antispam.motivo, criadoEm: antispam.created_at };
  if (blacklist) return { fonte: `Blacklist: ${blacklist.nome}`, motivo: null, criadoEm: null };
  return null;
}

/** Nome da blacklist: 1 a 60 caracteres depois do trim. */
export function validarNomeBlacklist(nome: unknown): { ok: true; nome: string } | { ok: false; erro: string } {
  const n = typeof nome === "string" ? nome.trim() : "";
  if (!n || n.length > 60) return { ok: false, erro: "Dê um nome de até 60 caracteres." };
  return { ok: true, nome: n };
}
