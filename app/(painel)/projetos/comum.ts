import type { SupabaseClient } from "@supabase/supabase-js";
import { escaparBuscaIlike } from "@/src/lib/regras/busca";
import type { Aba } from "../_componentes/abas";

/** Abas do topo das telas de Projetos. */
export const ABAS_PROJETOS: Aba[] = [
  { href: "/projetos", rotulo: "Ativos", exato: true },
  { href: "/projetos/arquivados", rotulo: "Arquivados" },
];

/** Ordenação: "Posição" (1ª opção, padrão quando algum projeto tem `posicao` — ver
 *  `algumTemPosicao`), "Data de criação" (padrão de hoje, sem `posicao` nenhuma) e "Alfabética". */
export type OrdemProjetos = "posicao" | "criacao" | "alfabetica";

export type FiltrosProjetos = { q: string; ordem: OrdemProjetos; pagina: number };

function primeiro(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/** Lê os parâmetros da URL; qualquer valor inválido vira o padrão. `ordemPadrao` ("posicao" ou "criacao") vem de
 *  `algumTemPosicao` — calculado por quem chama, a partir dos projetos já carregados. */
export function lerFiltrosProjetos(sp: Record<string, string | string[] | undefined>, ordemPadrao: "posicao" | "criacao" = "criacao"): FiltrosProjetos {
  const pagina = Number.parseInt(primeiro(sp.pagina), 10);
  const bruta = primeiro(sp.ordem);
  const ordem: OrdemProjetos = bruta === "posicao" || bruta === "alfabetica" || bruta === "criacao" ? bruta : ordemPadrao;
  return {
    q: primeiro(sp.q).trim().slice(0, 80),
    ordem,
    pagina: Number.isFinite(pagina) && pagina > 0 ? pagina : 1,
  };
}

/** Mantido com este nome por compatibilidade com o padrão das outras telas; a implementação mora em
 *  `src/lib/regras/busca.ts`, compartilhada (ex.: `/webhooks`, `/historico`). */
export const escaparBuscaProjeto = escaparBuscaIlike;

/** Endereço da lista (Ativos ou Arquivados) com os filtros atuais + `mudar`. Mudar qualquer filtro volta pra página 1. */
export function urlProjetos(base: "/projetos" | "/projetos/arquivados", atual: FiltrosProjetos, mudar: Partial<FiltrosProjetos>): string {
  const f = { ...atual, ...mudar };
  if (!("pagina" in mudar)) f.pagina = 1;
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.ordem !== "criacao") p.set("ordem", f.ordem);
  if (f.pagina > 1) p.set("pagina", String(f.pagina));
  const s = p.toString();
  return `${base}${s ? `?${s}` : ""}`;
}

export type ProjetoLinha = {
  id: string;
  created_at: string;
  nome: string;
  descricao: string;
  cor: string;
  arquivado: boolean;
  posicao: number | null;
};

export type ResumoProjeto = { campanhas: number; grupos: number; leads: number };
const RESUMO_PROJETO_ZERO: ResumoProjeto = { campanhas: 0, grupos: 0, leads: 0 };

type DB = Pick<SupabaseClient, "rpc">;

/** Contagens (Campanhas, Grupos ativos, Leads no grupo) de todos os projetos da página numa chamada só
 *  (`rpc resumo_projetos`) — nunca uma consulta por cartão. */
export async function carregarResumosProjetos(db: DB, ids: string[]): Promise<Record<string, ResumoProjeto>> {
  const porId: Record<string, ResumoProjeto> = {};
  if (!ids.length) return porId;
  const { data, error } = await db.rpc("resumo_projetos", { ids });
  if (error) {
    console.error(`[projetos] não foi possível carregar os resumos: ${error.message}`);
    return porId;
  }
  for (const linha of (data ?? []) as Record<string, unknown>[]) {
    const id = String(linha.projeto_id);
    porId[id] = { campanhas: Number(linha.campanhas ?? 0), grupos: Number(linha.grupos ?? 0), leads: Number(linha.leads ?? 0) };
  }
  return porId;
}

export function resumoProjeto(porId: Record<string, ResumoProjeto>, id: string): ResumoProjeto {
  return porId[id] ?? RESUMO_PROJETO_ZERO;
}
