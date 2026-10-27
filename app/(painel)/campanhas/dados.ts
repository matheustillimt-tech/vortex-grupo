import type { SupabaseClient } from "@supabase/supabase-js";
import { resumoDaLinha, type CampanhaLista, type Resumo } from "@/src/lib/regras/campanhas";
import { fotoDaCampanha, mapaFotosCampanhas } from "@/src/lib/regras/foto";
import { nomeSemNumero } from "@/src/lib/regras/nome-grupo";
import type { FiltroProjeto } from "@/src/lib/regras/projetos";

export const RESUMO_ZERO: Resumo = { cliques: 0, entradas: 0, saidas: 0, participantes: 0, admins: 0, grupos: 0, gruposCheios: 0 };

// `projeto:projetos(...)` traz o projeto de cada campanha (id, nome, cor) pro selo do cartão — null quando a
// campanha não tem projeto, já que `campanhas.projeto_id` é opcional.
const COLUNAS_CAMPANHA = "id, nome, slug, descricao, arquivada, created_at, updated_at, fixada, posicao, tipo, imagem_grupo_url, projeto:projetos(id, nome, cor)";

type DB = Pick<SupabaseClient, "from" | "rpc">;

/**
 * Campanhas (todas, só as de um projeto, ou só as sem projeto — `filtro`, de `filtroProjeto`) + o resumo de
 * cada uma (cliques/entradas/saídas desde `desde`, participantes/admins/grupos atuais) numa única chamada de
 * `resumo_campanhas` — idêntico ao que `/campanhas` sempre fez, só que extraído pra cá pra `/projetos/[id]`
 * reaproveitar o mesmo cartão (`CartaoCampanha`) e as mesmas contagens, em vez de copiar a consulta.
 */
export async function carregarCampanhasComResumo(
  db: DB,
  { desde, filtro }: { desde: string; filtro?: FiltroProjeto },
): Promise<{ campanhas: CampanhaLista[]; resumos: Map<string, Resumo> }> {
  let consulta = db.from("campanhas").select(COLUNAS_CAMPANHA);
  if (filtro?.tipo === "projeto") consulta = consulta.eq("projeto_id", filtro.id);
  else if (filtro?.tipo === "sem") consulta = consulta.is("projeto_id", null);

  const [{ data: campanhas, error: erroCampanhas }, { data: linhasResumo, error: erroResumo }] = await Promise.all([
    consulta,
    db.rpc("resumo_campanhas", { p_desde: desde }),
  ]);
  if (erroCampanhas || erroResumo) throw new Error("Não foi possível carregar as campanhas.");

  const resumos = new Map<string, Resumo>();
  for (const l of linhasResumo ?? []) {
    const r = resumoDaLinha(l as Record<string, unknown>);
    resumos.set(r.campanhaId, r);
  }
  return { campanhas: (campanhas ?? []) as unknown as CampanhaLista[], resumos };
}

/**
 * Foto e nome do grupo de cada cartão (Etapa 3M; nome em 20/10/2026): uma chamada de `fotos_campanhas` e uma de
 * `nomes_grupo_campanhas` pra página inteira de cartões (nunca uma por cartão). A foto é a atual do primeiro grupo
 * ativo (`fotoDaCampanha`) e o nome é o dele, sem o número. Se uma leitura falhar, o cartão fica com a letra / a
 * descrição de antes (é enfeite: não derruba a página).
 */
export async function comFotos<T extends { id: string; imagem_grupo_url?: string | null }>(db: DB, campanhas: T[]): Promise<(T & { foto: string | null; nomeGrupo: string | null })[]> {
  if (campanhas.length === 0) return [];
  const ids = campanhas.map((c) => c.id);
  const [{ data, error }, { data: nomes, error: erroNomes }] = await Promise.all([
    db.rpc("fotos_campanhas", { p_ids: ids }),
    db.rpc("nomes_grupo_campanhas", { p_ids: ids }),
  ]);
  if (error) console.error("[campanhas] fotos_campanhas", error.message);
  if (erroNomes) console.error("[campanhas] nomes_grupo_campanhas", erroNomes.message);
  const fotos = error ? new Map<string, string>() : mapaFotosCampanhas(data);
  const nomeGrupo = new Map<string, string>();
  for (const l of erroNomes ? [] : ((nomes ?? []) as { campanha_id: string; nome: string | null; numero: number }[])) {
    if (l.nome?.trim()) nomeGrupo.set(l.campanha_id, nomeSemNumero(l.nome, l.numero));
  }
  return campanhas.map((c) => ({ ...c, foto: fotoDaCampanha(c, fotos.get(c.id)), nomeGrupo: nomeGrupo.get(c.id) ?? null }));
}

const PAGINA_GRUPOS_DISTINTOS = 1000;

/**
 * Lê `grupos (group_id, participantes, campanha_id)` ativos das campanhas dadas, de 1000 em 1000 (só leitura —
 * `gruposDistintos`, de `src/lib/regras/grupos-distintos.ts`, faz a conta por cima do resultado). Usada pelo
 * cartão "Participantes (total)"/"Grupos (total)" de Campanhas e da Visão geral.
 */
export async function carregarGruposParaDistintos(
  db: DB,
  campanhaIds: string[],
): Promise<{ group_id: string | null; participantes: number; campanha_id: string }[]> {
  if (campanhaIds.length === 0) return [];
  const linhas: { group_id: string | null; participantes: number; campanha_id: string }[] = [];
  let de = 0;
  for (;;) {
    const { data, error } = await db
      .from("grupos")
      .select("group_id, participantes, campanha_id")
      .in("campanha_id", campanhaIds)
      .eq("ativo", true)
      .range(de, de + PAGINA_GRUPOS_DISTINTOS - 1);
    if (error) throw new Error("Não foi possível carregar os grupos distintos.");
    const pagina = (data ?? []) as typeof linhas;
    linhas.push(...pagina);
    if (pagina.length < PAGINA_GRUPOS_DISTINTOS) break;
    de += PAGINA_GRUPOS_DISTINTOS;
  }
  return linhas;
}
