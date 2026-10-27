import { formatarNumero } from "./inicio";
import { inicioDoDiaBrasilia } from "./metricas";

export const PERIODOS = [7, 14, 21, 28, 90] as const;

/** Início (meia-noite de Brasília) do primeiro dia da janela de `dias` dias terminando hoje — para os cartões e os
 *  gráficos usarem a mesma janela em dias de calendário de Brasília (em vez de "agora - dias*24h"). */
export function inicioDoPeriodo(dias: number, agora: Date = new Date()): string {
  return inicioDoDiaBrasilia(new Date(agora.getTime() - (dias - 1) * 86_400_000));
}

/** Período da URL (`?dias=`): só as opções; senão o padrão. */
export function lerPeriodo(v: string | undefined, opcoes: readonly number[] = PERIODOS, padrao = 90): number {
  const n = Number(v);
  return opcoes.includes(n) ? n : padrao;
}

export type Resumo = { cliques: number; entradas: number; saidas: number; participantes: number; admins: number; grupos: number; gruposCheios: number };

/** Linha de `resumo_campanhas` (bigint chega como texto pelo PostgREST). */
export function resumoDaLinha(l: Record<string, unknown>): Resumo & { campanhaId: string } {
  return {
    campanhaId: String(l.campanha_id),
    cliques: Number(l.cliques ?? 0),
    entradas: Number(l.entradas ?? 0),
    saidas: Number(l.saidas ?? 0),
    participantes: Number(l.participantes ?? 0),
    admins: Number(l.admins ?? 0),
    grupos: Number(l.grupos ?? 0),
    gruposCheios: Number(l.grupos_cheios ?? 0),
  };
}

export function somarResumos(rs: Resumo[]): Resumo {
  const z: Resumo = { cliques: 0, entradas: 0, saidas: 0, participantes: 0, admins: 0, grupos: 0, gruposCheios: 0 };
  for (const r of rs) for (const k of Object.keys(z) as (keyof Resumo)[]) z[k] += r[k];
  return z;
}

/** "59,88" (duas casas, sem %) mostra. */
export function percentual(parte: number, total: number): string {
  if (!total) return "0,00";
  return ((parte / total) * 100).toFixed(2).replace(".", ",");
}

export type CartaoNumero = { icone: string; rotulo: string; valor: string; detalhe?: string };

/** `distintos` (opcional, de `gruposDistintos`): acrescenta "· N em grupos distintos de WhatsApp" no detalhe de
 *  "Participantes (total)" e a linha "N grupos distintos de WhatsApp" em "Grupos (total)".
 *  Sem `distintos`, os cartões ficam como hoje (texto de antes desta etapa). */
export function cartoesDoResumo(r: Resumo, distintos?: { grupos: number; participantes: number }): CartaoNumero[] {
  const leads = r.participantes - r.admins;
  const detalheParticipantes =
    `${formatarNumero(r.admins)} Administradores · ${formatarNumero(leads)} Leads` +
    (distintos ? ` · ${formatarNumero(distintos.participantes)} em grupos distintos de WhatsApp` : "");
  return [
    { icone: "ads_click", rotulo: "Clicks", valor: formatarNumero(r.cliques) },
    { icone: "login", rotulo: "Entraram", valor: formatarNumero(r.entradas) },
    { icone: "percent", rotulo: "Percentual de entrada", valor: percentual(r.entradas, r.cliques) },
    { icone: "logout", rotulo: "Sairam", valor: formatarNumero(r.saidas) },
    { icone: "people", rotulo: "Participantes (total)", valor: formatarNumero(r.participantes), detalhe: detalheParticipantes },
    {
      icone: "groups",
      rotulo: "Grupos (total)",
      valor: formatarNumero(r.grupos),
      detalhe: distintos ? `${formatarNumero(distintos.grupos)} grupos distintos de WhatsApp` : undefined,
    },
    { icone: "check_box", rotulo: "Grupos cheios", valor: formatarNumero(r.gruposCheios) },
    { icone: "check_box_outline_blank", rotulo: "Grupos disponíveis", valor: formatarNumero(r.grupos - r.gruposCheios) },
  ];
}

export type CampanhaLista = {
  id: string;
  nome: string;
  slug?: string;
  tipo?: string;
  descricao: string;
  arquivada: boolean;
  created_at: string;
  updated_at?: string;
  fixada?: boolean;
  posicao?: number;
  projeto?: { id: string; nome: string; cor: string } | null;
  /** Imagem que a campanha põe nos grupos (Etapa 3M, Task 2), quando lida. */
  imagem_grupo_url?: string | null;
  /** Foto do cartão (`fotoDaCampanha`); ausente/null = letra. */
  foto?: string | null;
  /** Nome atual do grupo ativo de menor número, sem o número (`nomeSemNumero`); ausente/null = a descrição. */
  nomeGrupo?: string | null;
};

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** `?ordem=`: data de criação, data de atualização ou posição. */
export const ORDENS_CAMPANHA = ["criacao", "atualizacao", "posicao"] as const;
export type OrdemCampanha = (typeof ORDENS_CAMPANHA)[number];

export function lerOrdemCampanha(v: string | undefined): OrdemCampanha {
  return (ORDENS_CAMPANHA as readonly string[]).includes(v ?? "") ? (v as OrdemCampanha) : "criacao";
}

/** Fixadas sempre no topo (`push_pin`), qualquer que seja a ordenação escolhida; dentro de cada grupo
 *  (fixadas / não fixadas), "posição" ordena por `posicao` crescente e usa a data de criação como critério de
 *  desempate (mais recente primeiro). */
export function filtrarCampanhas(l: CampanhaLista[], f: { aba: "todas" | "ativas" | "arquivadas"; busca: string; ordem: OrdemCampanha }): CampanhaLista[] {
  const busca = semAcento(f.busca.trim());
  return l
    .filter((c) => (f.aba === "todas" ? true : f.aba === "ativas" ? !c.arquivada : c.arquivada))
    .filter((c) => !busca || semAcento(c.nome).includes(busca))
    .sort((a, b) => {
      const fixA = a.fixada ? 1 : 0;
      const fixB = b.fixada ? 1 : 0;
      if (fixA !== fixB) return fixB - fixA;
      if (f.ordem === "atualizacao") return (b.updated_at ?? b.created_at).localeCompare(a.updated_at ?? a.created_at);
      if (f.ordem === "posicao") {
        const p = (a.posicao ?? 0) - (b.posicao ?? 0);
        return p !== 0 ? p : b.created_at.localeCompare(a.created_at);
      }
      return b.created_at.localeCompare(a.created_at);
    });
}

export function paginar<T>(l: T[], pagina: number, porPagina: number) {
  const paginas = Math.max(1, Math.ceil(l.length / porPagina));
  const p = pagina >= 1 && pagina <= paginas ? pagina : 1;
  const itens = l.slice((p - 1) * porPagina, p * porPagina);
  return { itens, de: itens.length ? (p - 1) * porPagina + 1 : 0, ate: (p - 1) * porPagina + itens.length, total: l.length, pagina: p, paginas };
}

/** "há 15 dias", "há cerca de 1 mês". */
export function tempoDesde(iso: string, agora: Date = new Date()): string {
  const s = Math.max(0, (agora.getTime() - new Date(iso).getTime()) / 1000);
  const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
  if (s < 3600) return "agora mesmo";
  if (s < 86_400) return `há ${plural(Math.floor(s / 3600), "hora", "horas")}`;
  const dias = Math.floor(s / 86_400);
  if (dias < 30) return `há ${plural(dias, "dia", "dias")}`;
  if (dias < 365) return `há cerca de ${plural(Math.round(dias / 30), "mês", "meses")}`;
  return `há cerca de ${plural(Math.round(dias / 365), "ano", "anos")}`;
}
