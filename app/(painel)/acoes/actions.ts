"use server";
import { criarAcaoComo } from "@/src/lib/acoes/criar";
import { checarPermissao } from "@/src/lib/permissoes";
import { DIAS_RELATORIO, MAXIMO_ITENS_ACAO, type EntradaAcao } from "@/src/lib/regras/assistente-acao";
import { resumoConteudo, type TipoExecucao } from "@/src/lib/regras/conteudo";
import { ehUuid } from "@/src/lib/regras/uuid";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { contasDaCampanha, type ContaDaCampanha } from "../_acoes/contas-da-campanha";

export type GrupoDaAcao = { id: string; nome: string; numero: number; conexao_id: string };

/** Ação de mensagem/enquete que o "Relatório de status de mensagens" pode incluir. */
export type ExecucaoDoRelatorio = { id: string; campanha_id: string; tipo: "mensagem" | "enquete"; resumo: string; agendada_para: string; status: string };

/** Teto da lista do passo Conteúdo do relatório (as mais recentes primeiro). */
const MAXIMO_EXECUCOES_LISTA = 300;

/** Grupos por página no passo "Grupos" do assistente. */
const POR_PAGINA_GRUPOS = 50;

type DB = ReturnType<typeof dbAdmin>;

/** Campanha existe e não está arquivada (`null` = ok). */
async function conferirCampanhaAtiva(db: DB, campanhaId: string): Promise<string | null> {
  const { data, error } = await db.from("campanhas").select("id, arquivada").eq("id", campanhaId).maybeSingle();
  if (error) return "Não foi possível carregar a campanha.";
  if (!data) return "Campanha não encontrada.";
  if ((data as { arquivada: boolean }).arquivada) return "Campanha arquivada.";
  return null;
}

/** Passo "Contas" do assistente (carregado só quando a ação é de UMA campanha): contas da campanha e as
 *  variáveis dela (pra dica do editor de mensagens). */
export async function dadosDaCampanhaAcao(campanhaId: string): Promise<{ erro: string } | { contas: ContaDaCampanha[]; variaveis: string[] }> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  if (!ehUuid(campanhaId)) return { erro: "Campanha inválida." };
  const db = dbAdmin();
  const problema = await conferirCampanhaAtiva(db, campanhaId);
  if (problema) return { erro: problema };
  try {
    const [contas, vars] = await Promise.all([
      contasDaCampanha(db, campanhaId),
      db.from("campanha_variaveis").select("chave").eq("campanha_id", campanhaId).order("chave").limit(MAXIMO_ITENS_ACAO),
    ]);
    if (vars.error) return { erro: "Não foi possível carregar as variáveis da campanha." };
    return { contas, variaveis: ((vars.data ?? []) as { chave: string }[]).map((v) => v.chave) };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "Não foi possível carregar as conexões." };
  }
}

/** Passo "Grupos": grupos ativos da campanha, por página (50), com busca pelo nome e, se vierem, só das contas
 *  escolhidas no passo anterior. */
export async function listarGruposAcao(
  campanhaId: string,
  filtro: { busca?: string; pagina?: number; contas?: string[] | null },
): Promise<{ erro: string } | { grupos: GrupoDaAcao[]; total: number; porPagina: number }> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  if (!ehUuid(campanhaId)) return { erro: "Campanha inválida." };
  const contas = Array.isArray(filtro.contas) ? filtro.contas.filter(ehUuid).slice(0, MAXIMO_ITENS_ACAO) : null;
  const pagina = Math.max(1, Math.floor(Number(filtro.pagina)) || 1);
  const busca = typeof filtro.busca === "string" ? filtro.busca.trim().slice(0, 100) : "";
  const db = dbAdmin();
  const problema = await conferirCampanhaAtiva(db, campanhaId);
  if (problema) return { erro: problema };
  let consulta = db.from("grupos").select("id, nome, numero, conexao_id", { count: "exact" }).eq("campanha_id", campanhaId).eq("ativo", true);
  if (contas?.length) consulta = consulta.in("conexao_id", contas);
  if (busca) consulta = consulta.ilike("nome", `%${busca.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  const de = (pagina - 1) * POR_PAGINA_GRUPOS;
  const { data, error, count } = await consulta.order("numero").range(de, de + POR_PAGINA_GRUPOS - 1);
  if (error) return { erro: "Não foi possível carregar os grupos." };
  return { grupos: (data ?? []) as GrupoDaAcao[], total: count ?? 0, porPagina: POR_PAGINA_GRUPOS };
}

/** Cria a ação do assistente (Campanhas/editar). As regras moram em `criarAcaoComo` (as mesmas da API v1). */
export async function criarAcao(entrada: EntradaAcao): Promise<{ erro: string } | { ok: true; ids: string[] }> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  // "Entrar no Grupo" mexe nas contas (não em campanha): exige também Contas/editar.
  if ((entrada as { tipo?: unknown } | null)?.tipo === "entrar_grupo") {
    const contas = await checarPermissao("contas", "editar");
    if (!contas.ok) return { erro: contas.erro };
  }
  return criarAcaoComo({ tipo: "painel" }, acesso.usuario, entrada);
}

/** Passo "Conteúdo" do "Relatório de status de mensagens": as ações de mensagem e enquete já enviadas (ou enviando)
 *  das campanhas escolhidas nos últimos 90 dias, as mais recentes primeiro (até 300). Campanhas/ver: o relatório é
 *  leitura. */
export async function listarExecucoesRelatorio(campanhas: string[]): Promise<{ erro: string } | { execucoes: ExecucaoDoRelatorio[] }> {
  const acesso = await checarPermissao("campanhas", "ver");
  if (!acesso.ok) return { erro: acesso.erro };
  const ids = Array.isArray(campanhas) ? [...new Set(campanhas.filter(ehUuid))].slice(0, MAXIMO_ITENS_ACAO) : [];
  if (!ids.length) return { erro: "Escolha ao menos uma campanha." };
  const desde = new Date(Date.now() - DIAS_RELATORIO * 86_400_000).toISOString();
  const db = dbAdmin();
  const linhas: (ExecucaoDoRelatorio & { conteudo?: unknown })[] = [];
  // Lotes de 150 ids: `.in` com 1000 uuids estoura o tamanho da URL.
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await db
      .from("execucoes")
      .select("id, campanha_id, tipo, conteudo, agendada_para, status")
      .in("campanha_id", ids.slice(i, i + 150))
      .in("tipo", ["mensagem", "enquete"])
      .in("status", ["enviando", "concluida"])
      .gte("agendada_para", desde)
      .order("agendada_para", { ascending: false })
      .limit(MAXIMO_EXECUCOES_LISTA);
    if (error) return { erro: "Não foi possível carregar as ações." };
    linhas.push(...((data ?? []) as (ExecucaoDoRelatorio & { conteudo: unknown })[]));
  }
  const execucoes = linhas
    .sort((a, b) => b.agendada_para.localeCompare(a.agendada_para))
    .slice(0, MAXIMO_EXECUCOES_LISTA)
    .map(({ conteudo, ...e }) => ({ ...e, resumo: resumoConteudo(e.tipo as TipoExecucao, conteudo).slice(0, 120) }));
  return { execucoes };
}
