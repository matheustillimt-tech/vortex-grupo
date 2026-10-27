/** Regras do Histórico (`/historico`): áreas, rótulos/ícones/cores por ação, agrupamento por dia, filtros da URL e
 *  link pro objeto do registro. Sem `server-only` porque é usado tanto pela tela (servidor) quanto por componentes
 *  cliente (filtros, botão de detalhe). A gravação em si (`registrarHistorico`, que precisa do `dbAdmin`) mora em
 *  `src/lib/historico.ts`. */
import { ehUuid } from "./uuid";

/** Áreas fixas do histórico, na ordem em que aparecem no filtro. */
export const AREAS_HISTORICO = [
  "Campanhas",
  "Projetos",
  "Grupos",
  "Mensagens",
  "Ações",
  "Automações",
  "Sequências",
  "Modelos",
  "Variáveis",
  "Leads",
  "Anti-spam",
  "Contas",
  "Webhooks",
  "Integrações",
  "Deep link",
  "Equipe",
] as const;

export type AreaHistorico = (typeof AREAS_HISTORICO)[number];

/** Nome da área na tela. O banco continua gravando "Contas" (registros antigos e filtro); a tela mostra "Conexões". */
export function rotuloAreaHistorico(area: string): string {
  return area === "Contas" ? "Conexões" : area;
}

export function areaValida(v: unknown): v is AreaHistorico {
  return typeof v === "string" && (AREAS_HISTORICO as readonly string[]).includes(v);
}

export const ACOES_HISTORICO = ["adicionar", "atualizar", "remover", "executar"] as const;
export type AcaoHistorico = (typeof ACOES_HISTORICO)[number];

export function acaoValida(v: unknown): v is AcaoHistorico {
  return typeof v === "string" && (ACOES_HISTORICO as readonly string[]).includes(v);
}

/** Rótulo em pt-BR de cada ação ("{Ação} {Área}" na linha da lista). */
export const ROTULO_ACAO_HISTORICO: Record<AcaoHistorico, string> = {
  adicionar: "Adicionar",
  atualizar: "Atualizar",
  remover: "Remover",
  executar: "Executar",
};

/** Ícone Material (cheio) de cada ação, pelo padrão da spec. */
export const ICONE_ACAO_HISTORICO: Record<AcaoHistorico, string> = {
  adicionar: "add_circle",
  atualizar: "edit",
  remover: "delete",
  executar: "play_circle",
};

/** Cor de cada ação: verde/vermelho/amarelo nos tokens `vg-*` de `app/globals.css`; sem token azul definido,
 *  "executar" usa o azul padrão do Tailwind. */
export const COR_ACAO_HISTORICO: Record<AcaoHistorico, string> = {
  adicionar: "text-vg-ok",
  atualizar: "text-vg-accent",
  remover: "text-vg-erro",
  executar: "text-blue-400",
};

export type LinhaHistorico = {
  id: number;
  created_at: string;
  usuario_id: string | null;
  usuario_email: string | null;
  acao: AcaoHistorico;
  area: string;
  resumo: string;
  ref_id: string | null;
};

/** Nome do membro que fez a ação: por `usuario_id` em `membros`; sem membro (ex-membro, ou ação de
 *  sistema sem usuário), cai pro e-mail gravado na hora do registro. */
/** Nome do membro (Etapa 3N, Task 7) — por `usuario_id`, na mesma fonte da tela Equipe. Sem
 *  nome (ex-membro sem linha em `membros`, ou evento sem `usuario_id`), cai pra parte local do e-mail gravado
 *  na hora (antes do "@"), nunca o e-mail inteiro. */
export function nomeOuEmailHistorico(usuarioId: string | null, usuarioEmail: string | null, membros: { usuario_id: string; nome: string }[]): string {
  const membro = usuarioId ? membros.find((m) => m.usuario_id === usuarioId) : undefined;
  if (membro?.nome) return membro.nome;
  if (!usuarioEmail) return "—";
  return usuarioEmail.split("@")[0] || usuarioEmail;
}

const fmtChaveDia = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
const fmtMes = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", month: "long" });
const fmtDiaNumero = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "numeric" });
const fmtAno = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", year: "numeric" });

/** Rótulo do dia no formato da spec: "outubro 15, 2026" (mês em Brasília, sem acento maiúsculo). */
export function rotuloDoDia(data: Date): string {
  return `${fmtMes.format(data)} ${fmtDiaNumero.format(data)}, ${fmtAno.format(data)}`;
}

const fmtHora = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** Hora `hh:mm:ss` em Brasília, pra cada linha da lista. */
export function horaDoRegistro(iso: string): string {
  return fmtHora.format(new Date(iso));
}

/** Agrupa linhas do histórico por dia de Brasília, do mais recente pro mais antigo, com o rótulo pronto. */
export function agruparPorDia<T extends { created_at: string }>(linhas: T[]): { dia: string; rotulo: string; linhas: T[] }[] {
  const porDia = new Map<string, T[]>();
  for (const l of linhas) {
    const chave = fmtChaveDia.format(new Date(l.created_at));
    porDia.set(chave, [...(porDia.get(chave) ?? []), l]);
  }
  return [...porDia.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([dia, lista]) => ({ dia, rotulo: rotuloDoDia(new Date(lista[0].created_at)), linhas: lista }));
}

/** Rota-base de cada área que tem página de detalhe com `id` na URL. Áreas fora deste mapa (ou sem `ref_id` uuid) não mostram link no detalhe. */
const ROTA_POR_AREA: Partial<Record<AreaHistorico, string>> = {
  Campanhas: "/campanhas",
  Automações: "/automacoes",
  Modelos: "/modelos",
  Projetos: "/projetos",
};

/** Link pro objeto do registro (ex.: `/campanhas/{id}`), ou `null` quando não há `ref_id` válido (uuid) ou a área
 *  não tem rota de detalhe conhecida. */
export function linkDoRegistro(area: string, refId: string | null): string | null {
  if (!ehUuid(refId)) return null;
  const base = ROTA_POR_AREA[area as AreaHistorico];
  return base ? `${base}/${refId}` : null;
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Além do formato AAAA-MM-DD, confere que a data existe de fato (ex.: rejeita 2026-02-31). */
export function dataHistoricoValida(v: unknown): v is string {
  if (typeof v !== "string" || !DATA.test(v)) return false;
  const [ano, mes, dia] = v.split("-").map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

export type FiltrosHistorico = {
  q: string;
  area: string;
  acao: string;
  membroId: string;
  /** "Endereço de IP" fica fora dos filtros: o histórico não guarda IP de quem fez a ação (só usuário, ação,
   *  área, resumo e `ref_id`). */
  desde: string;
  ate: string;
  refId: string;
  pagina: number;
};

function primeiro(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/** Filtros da URL de `/historico`. Valor inválido (área fora da lista, ação fora da lista, membro que não é uuid,
 *  data mal formada) vira "sem filtro" em vez de erro no banco. */
export function lerFiltrosHistorico(sp: Record<string, string | string[] | undefined>): FiltrosHistorico {
  const area = primeiro(sp.area).trim();
  const acao = primeiro(sp.acao).trim();
  const membroId = primeiro(sp.membro).trim();
  const desde = primeiro(sp.desde).trim();
  const ate = primeiro(sp.ate).trim();
  const pagina = Number.parseInt(primeiro(sp.pagina), 10);
  return {
    q: primeiro(sp.q).trim().slice(0, 80),
    area: areaValida(area) ? area : "",
    acao: acaoValida(acao) ? acao : "",
    membroId: ehUuid(membroId) ? membroId : "",
    desde: dataHistoricoValida(desde) ? desde : "",
    ate: dataHistoricoValida(ate) ? ate : "",
    refId: primeiro(sp.id).trim().slice(0, 80),
    pagina: Number.isFinite(pagina) && pagina > 0 ? pagina : 1,
  };
}

/** `?q=&area=&acao=&membro=&desde=&ate=&id=&pagina=`, omitindo os campos vazios e a página 1 (toda troca de filtro
 *  volta pra página 1, salvo quando `mudar` já traz `pagina`). */
export function urlHistorico(atual: FiltrosHistorico, mudar: Partial<FiltrosHistorico>): string {
  const f = { ...atual, ...mudar };
  if (!("pagina" in mudar)) f.pagina = 1;
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.area) p.set("area", f.area);
  if (f.acao) p.set("acao", f.acao);
  if (f.membroId) p.set("membro", f.membroId);
  if (f.desde) p.set("desde", f.desde);
  if (f.ate) p.set("ate", f.ate);
  if (f.refId) p.set("id", f.refId);
  if (f.pagina > 1) p.set("pagina", String(f.pagina));
  const s = p.toString();
  return `/historico${s ? `?${s}` : ""}`;
}
