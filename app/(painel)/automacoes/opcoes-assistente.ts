import "server-only";
import { TIPOS_MODELO } from "@/src/lib/regras/conteudo";
import { ehUuid } from "@/src/lib/regras/uuid";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import type { ModeloLinha } from "../_componentes/escolher-modelo";
import type { CampanhaOpcao, GrupoOpcao } from "./assistente";

const PAGINA_GRUPOS = 1000;

/** `tipo`: só as `manual` entram nas ações "Adicionar tag"/"Remover tag" (a Tag Condicional aceita qualquer uma). */
export type TagOpcao = { id: string; nome: string; tipo: string };
/** Blacklists pras ações "Adicionar à blacklist"/"Remover da blacklist" (ativas e inativas). */
export type BlacklistOpcao = { id: string; nome: string; ativa: boolean };

export type OpcoesAssistente = {
  campanhas: CampanhaOpcao[];
  grupos: GrupoOpcao[];
  modelos: ModeloLinha[];
  telefones: { nome: string; telefone: string }[];
  pastas: string[];
  /** Automações ativas de "entrou" com ação de mensagem (pro aviso de mais de uma por campanha). */
  entradasComMensagem: { id: string; campanha_id: string }[];
  /** Tags pro passo "Ação" (Tag Condicional: escolher uma tag + "tem"/"não tem"). */
  tags: TagOpcao[];
  blacklists: BlacklistOpcao[];
};

/** O que o assistente oferece: campanhas não arquivadas (mais a da automação em edição, mesmo se arquivada, pra não
 *  sumir da tela), grupos ativos delas, modelos, números conectados (pro editor) e as pastas já usadas.
 *  `campanhaDaEdicao` só vem da automação já gravada (nunca da URL) e só entra no filtro se for um uuid — nada de
 *  valor cru interpolado no `.or(...)`. */
export async function carregarOpcoesAssistente(campanhaDaEdicao?: string | null): Promise<OpcoesAssistente> {
  const db = await dbUsuario();
  let consultaCampanhas = db.from("campanhas").select("id, nome, descricao").order("nome");
  consultaCampanhas = ehUuid(campanhaDaEdicao)
    ? consultaCampanhas.or(`arquivada.eq.false,id.eq.${campanhaDaEdicao}`)
    : consultaCampanhas.eq("arquivada", false);
  const [campanhas, modelos, conexoes, comPasta, entradas, tags, blacklists] = await Promise.all([
    consultaCampanhas,
    db.from("modelos").select("id, nome, tipo, conteudo").eq("arquivado", false).in("tipo", [...TIPOS_MODELO]).order("nome"),
    db.from("conexoes").select("nome, telefone").eq("status", "conectado").not("telefone", "is", null).order("nome"),
    db.from("automacoes").select("pasta").not("pasta", "is", null),
    db.from("automacoes").select("id, campanha_id, automacao_acoes!inner(tipo)").eq("gatilho", "entrou").eq("ativo", true).eq("automacao_acoes.tipo", "mensagem"),
    db.from("tags").select("id, nome, tipo").order("nome"),
    db.from("blacklists").select("id, nome, ativa").order("nome"),
  ]);
  if (campanhas.error) throw new Error(`Não foi possível carregar as campanhas: ${campanhas.error.message}`);
  if (modelos.error) throw new Error(`Não foi possível carregar os modelos: ${modelos.error.message}`);
  if (conexoes.error) throw new Error(`Não foi possível carregar os números: ${conexoes.error.message}`);
  if (comPasta.error) throw new Error(`Não foi possível carregar as pastas: ${comPasta.error.message}`);
  if (entradas.error) throw new Error(`Não foi possível carregar as automações de entrada: ${entradas.error.message}`);
  if (tags.error) throw new Error(`Não foi possível carregar as tags: ${tags.error.message}`);
  if (blacklists.error) throw new Error(`Não foi possível carregar as blacklists: ${blacklists.error.message}`);

  const ids = (campanhas.data ?? []).map((c) => c.id as string);
  // Em páginas de 1000 (o teto do PostgREST cortaria a lista em silêncio); depois ordena pelo número do grupo.
  const linhasGrupos: { id: string; nome: string; campanha_id: string; numero: number }[] = [];
  if (ids.length) {
    for (let de = 0; ; de += PAGINA_GRUPOS) {
      const { data, error } = await db
        .from("grupos")
        .select("id, nome, campanha_id, numero")
        .eq("ativo", true)
        .in("campanha_id", ids)
        .order("id")
        .range(de, de + PAGINA_GRUPOS - 1);
      if (error) throw new Error(`Não foi possível carregar os grupos: ${error.message}`);
      linhasGrupos.push(...((data ?? []) as typeof linhasGrupos));
      if (!data || data.length < PAGINA_GRUPOS) break;
    }
    linhasGrupos.sort((a, b) => a.numero - b.numero);
  }

  return {
    campanhas: (campanhas.data ?? []).map((c) => ({ id: c.id as string, nome: c.nome as string, descricao: (c.descricao as string | null) ?? null })),
    grupos: linhasGrupos.map((g) => ({ id: g.id, nome: g.nome, campanha_id: g.campanha_id })),
    modelos: (modelos.data ?? []) as ModeloLinha[],
    telefones: (conexoes.data ?? []).map((c) => ({ nome: c.nome as string, telefone: c.telefone as string })),
    pastas: [...new Set((comPasta.data ?? []).map((p) => p.pasta as string))].sort((a, b) => a.localeCompare(b, "pt-BR")),
    entradasComMensagem: (entradas.data ?? []).map((a) => ({ id: a.id as string, campanha_id: a.campanha_id as string })),
    tags: (tags.data ?? []).map((t) => ({ id: t.id as string, nome: t.nome as string, tipo: t.tipo as string })),
    blacklists: (blacklists.data ?? []).map((b) => ({ id: b.id as string, nome: b.nome as string, ativa: b.ativa as boolean })),
  };
}
