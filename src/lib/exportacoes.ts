import type { SupabaseClient } from "@supabase/supabase-js";
import { ehUuid } from "./regras/uuid";

/** "Ver exportações" (Etapa 3K): cada CSV gerado pelas rotas de exportação deixa uma linha em `exportacoes` só com
 *  os metadados (tipo, filtros, contagem da primeira vez, nome do arquivo e quem gerou). O arquivo nunca é guardado:
 *  "BAIXAR" chama a mesma rota com `?exportacao={id}`, que lê os filtros da linha e gera de novo com os dados de
 *  hoje — sem criar outra linha. */

export const TIPOS_EXPORTACAO = ["leads", "status_mensagens", "historico_mensagens", "solicitacoes"] as const;
export type TipoExportacao = (typeof TIPOS_EXPORTACAO)[number];

export const ROTULO_EXPORTACAO: Record<TipoExportacao, string> = {
  leads: "Leads",
  status_mensagens: "Relatório de status de mensagens",
  historico_mensagens: "Histórico de mensagens enviadas",
  solicitacoes: "Solicitações de entrada processadas",
};

/** Rota que gera cada tipo (a mesma do primeiro download). */
export const ROTA_EXPORTACAO: Record<TipoExportacao, string> = {
  leads: "/api/exportar/pessoas",
  status_mensagens: "/api/exportar/status-mensagens",
  historico_mensagens: "/api/exportar/mensagens-enviadas",
  solicitacoes: "/api/exportar/solicitacoes",
};

export function hrefBaixarDeNovo(tipo: TipoExportacao, id: string): string {
  return `${ROTA_EXPORTACAO[tipo]}?exportacao=${id}`;
}

/** Tipos de exportação que a pessoa vê em "Ver exportações": Leads, Relatório de status e Solicitações de entrada
 *  têm telefone, então só com Leads/ver. */
export function tiposVisiveis(veLeads: boolean): TipoExportacao[] {
  return veLeads ? [...TIPOS_EXPORTACAO] : ["historico_mensagens"];
}

/** "Gerada por": o nome do membro; sem nome, a parte do e-mail antes do "@" (nunca o e-mail inteiro). */
export function nomeGeradaPor(nome: string | null | undefined, email: string | null | undefined): string {
  const n = nome?.trim();
  if (n) return n;
  const local = email?.split("@")[0]?.trim();
  return local || "—";
}

/** Filtros guardados: só texto curto (nada de lista gigante nem objeto aninhado). */
export type FiltrosExportacao = Record<string, string>;

/** Os filtros de uma query string, sem o `exportacao` e sem valores vazios, cada valor cortado em 4000 caracteres. */
export function filtrosDaUrl(sp: URLSearchParams | Record<string, string>): FiltrosExportacao {
  const entradas = sp instanceof URLSearchParams ? [...sp.entries()] : Object.entries(sp);
  const f: FiltrosExportacao = {};
  for (const [k, v] of entradas) {
    if (k === "exportacao" || typeof v !== "string" || !v) continue;
    f[k] = v.slice(0, 4000);
  }
  return f;
}

/** Linha curta dos filtros pra tabela ("campanhas: 2 · inicio: 2026-10-01"). Listas de ids viram contagem. */
export function resumoFiltros(filtros: unknown): string {
  if (!filtros || typeof filtros !== "object") return "—";
  const partes = Object.entries(filtros as Record<string, unknown>)
    .filter(([, v]) => typeof v === "string" && v)
    .map(([k, v]) => {
      const s = v as string;
      const ids = s.split(",");
      const lista = ids.length > 1 || ehUuid(ids[0]);
      return lista ? `${k}: ${ids.length}` : `${k}: ${s.slice(0, 40)}`;
    });
  return partes.join(" · ") || "Sem filtros";
}

type Db = Pick<SupabaseClient, "from">;

export type NovaExportacao = {
  tipo: TipoExportacao;
  filtros: FiltrosExportacao;
  linhas: number;
  nomeArquivo: string;
  usuario: { id: string } | null | undefined;
};

/** Grava a linha da exportação. Nunca lança nem atrasa o erro pro download: falhou, fica só no log. */
export async function registrarExportacao(db: Db, e: NovaExportacao): Promise<void> {
  try {
    const { error } = await db.from("exportacoes").insert({
      tipo: e.tipo,
      filtros: e.filtros,
      linhas: e.linhas,
      nome_arquivo: e.nomeArquivo,
      criada_por: e.usuario?.id ?? null,
    });
    if (error) console.error(`[exportacoes] não foi possível registrar (${e.tipo}): ${error.message}`);
  } catch (erro) {
    console.error(`[exportacoes] não foi possível registrar (${e.tipo}): ${erro instanceof Error ? erro.message : "erro inesperado"}`);
  }
}

/** `?exportacao={id}` → os filtros guardados, conferindo o tipo. `null` = não existe, é de outro tipo ou deu erro. */
export async function lerExportacao(db: Db, id: unknown, tipo: TipoExportacao): Promise<FiltrosExportacao | null> {
  if (!ehUuid(id)) return null;
  const { data, error } = await db.from("exportacoes").select("tipo, filtros").eq("id", id).maybeSingle();
  if (error || !data) return null;
  const linha = data as { tipo: string; filtros: unknown };
  if (linha.tipo !== tipo || !linha.filtros || typeof linha.filtros !== "object") return null;
  return filtrosDaUrl(linha.filtros as Record<string, string>);
}

/** Filtros que a rota usa: os da linha guardada (`?exportacao=`) ou os da própria URL. `reexportacao` = veio da
 *  linha (não grava outra). `erro` = `?exportacao=` inválido/de outro tipo (a rota responde 404). */
export async function filtrosDaRequisicao(
  db: Db,
  url: URL,
  tipo: TipoExportacao,
): Promise<{ filtros: FiltrosExportacao; reexportacao: boolean } | { erro: true }> {
  const id = url.searchParams.get("exportacao");
  if (id === null) return { filtros: filtrosDaUrl(url.searchParams), reexportacao: false };
  const f = await lerExportacao(db, id, tipo);
  return f ? { filtros: f, reexportacao: true } : { erro: true };
}
