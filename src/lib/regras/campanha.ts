import { UUID } from "./uuid";
import { TIPOS_CAMPANHA, type CampanhaTipo } from "./campanha-tipo";

/** Faixas de "Limite de pessoas" e "folga" (grupos sempre disponíveis) — usadas por `validarCampanha` e
 *  reaproveitadas por `validarPadraoCampanha` (padrao-campanha.ts), pra não duplicar os números. */
export const LIMITE_POR_GRUPO_MIN = 10;
export const LIMITE_POR_GRUPO_MAX = 1024;
export const FOLGA_MIN = 1;
export const FOLGA_MAX = 10;

/** Campos de "Criação de grupos" comuns à campanha e ao padrão de criação: valida junto, pra
 *  `validarCampanha` e `validarPadraoCampanha` darem exatamente o mesmo erro pros mesmos campos. */
export type CriacaoGruposEntrada = { padrao_nome: string; limite_por_grupo: number; folga: number };

export function validarCriacaoGrupos(e: CriacaoGruposEntrada): { ok: true } | { ok: false; erro: string } {
  if (!e.padrao_nome.trim()) return { ok: false, erro: "Dê um padrão de nome para os grupos." };
  if (!(e.limite_por_grupo >= LIMITE_POR_GRUPO_MIN && e.limite_por_grupo <= LIMITE_POR_GRUPO_MAX)) {
    return { ok: false, erro: "O limite por grupo vai de 10 a 1024." };
  }
  if (!(e.folga >= FOLGA_MIN && e.folga <= FOLGA_MAX)) return { ok: false, erro: "A folga vai de 1 a 10 grupos." };
  return { ok: true };
}

export type CampanhaEntrada = {
  nome: string;
  slug: string;
  padrao_nome: string;
  descricao: string;
  fechado: boolean;
  limite_por_grupo: number;
  folga: number;
  conexao_criadora_id: string;
  admins: string[];
  usar_comunidade: boolean;
  crm_webhook_url: string;
  projeto_id: string | null | undefined;
  /** Opcionais (Etapa 3D): ausente = não muda o que já está salvo (usado na edição). */
  tipo?: string;
  /** Vem do `<input type="datetime-local">` (Brasília), "" apaga, ausente = não muda. */
  termina_em?: string;
  link_apos_termino?: string;
};
export type CampanhaValida = Omit<CampanhaEntrada, "conexao_criadora_id" | "crm_webhook_url" | "projeto_id" | "tipo" | "termina_em" | "link_apos_termino"> & {
  /** null = campanha ainda sem número: não cria grupos até alguém associar uma conexão. */
  conexao_criadora_id: string | null;
  crm_webhook_url: string | null;
  projeto_id: string | null;
  tipo?: CampanhaTipo;
  termina_em?: string | null;
  link_apos_termino?: string | null;
};

export function validarCampanha(e: CampanhaEntrada): { ok: true; valor: CampanhaValida } | { ok: false; erro: string } {
  const nome = e.nome.trim();
  if (!nome) return { ok: false, erro: "Dê um nome à campanha." };
  if (!/^[a-z0-9-]{2,40}$/.test(e.slug)) return { ok: false, erro: "O endereço do link aceita só letras minúsculas, números e hífen (2 a 40)." };
  const criacao = validarCriacaoGrupos(e);
  if (!criacao.ok) return criacao;
  const url = e.crm_webhook_url.trim();
  if (url && !url.startsWith("https://")) return { ok: false, erro: "O webhook do CRM precisa começar com https://" };
  const pid = e.projeto_id ?? null;
  if (pid !== null && !UUID.test(pid)) return { ok: false, erro: "Projeto inválido." };

  if (e.tipo !== undefined && !TIPOS_CAMPANHA.includes(e.tipo as CampanhaTipo)) return { ok: false, erro: "Tipo de campanha inválido." };

  let termina_em: string | null = null;
  if (e.termina_em !== undefined) {
    if (e.termina_em) {
      const d = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(e.termina_em) ? new Date(`${e.termina_em}:00-03:00`) : null;
      if (!d || Number.isNaN(d.getTime())) return { ok: false, erro: "Data e hora de término inválidas." };
      termina_em = d.toISOString();
    }
  }

  let link_apos_termino: string | null = null;
  if (e.link_apos_termino !== undefined) {
    const l = e.link_apos_termino.trim();
    if (l) {
      if (!l.startsWith("https://")) return { ok: false, erro: "O link após o término precisa começar com https://" };
      if (l.length > 500) return { ok: false, erro: "O link após o término pode ter no máximo 500 caracteres." };
    }
    link_apos_termino = l || null;
  }

  return {
    ok: true,
    valor: {
      ...e,
      nome,
      padrao_nome: e.padrao_nome.trim(),
      conexao_criadora_id: e.conexao_criadora_id || null,
      admins: [...new Set(e.admins)].filter((a) => a !== e.conexao_criadora_id),
      crm_webhook_url: url || null,
      projeto_id: pid,
      tipo: e.tipo as CampanhaTipo | undefined,
      ...(e.termina_em !== undefined ? { termina_em } : {}),
      ...(e.link_apos_termino !== undefined ? { link_apos_termino } : {}),
    },
  };
}

export type AulaEntrada = { data_aula: string; link_aula: string; sequencia_id: string; mensagem_fixa: string; alertas_webhook_url: string };
export type AulaValida = { data_aula: string | null; link_aula: string | null; sequencia_id: string | null; mensagem_fixa: string | null; alertas_webhook_url: string | null };

/** `data_aula` vem do `<input type="datetime-local">` (Brasília) ou vazio. */
export function validarAula(e: AulaEntrada): { ok: true; valor: AulaValida } | { ok: false; erro: string } {
  let data: string | null = null;
  if (e.data_aula) {
    const d = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(e.data_aula) ? new Date(`${e.data_aula}:00-03:00`) : null;
    if (!d || Number.isNaN(d.getTime())) return { ok: false, erro: "Data e hora da aula inválidas." };
    data = d.toISOString();
  }
  const link = e.link_aula.trim();
  if (link && !link.startsWith("https://")) return { ok: false, erro: "O link da aula precisa começar com https://" };
  const hook = e.alertas_webhook_url.trim();
  if (hook && !hook.startsWith("https://")) return { ok: false, erro: "O webhook de alertas precisa começar com https://" };
  if (e.sequencia_id && !data) return { ok: false, erro: "Para aplicar a sequência, informe a data e a hora da aula." };
  return {
    ok: true,
    valor: { data_aula: data, link_aula: link || null, sequencia_id: e.sequencia_id || null, mensagem_fixa: e.mensagem_fixa.trim() || null, alertas_webhook_url: hook || null },
  };
}
