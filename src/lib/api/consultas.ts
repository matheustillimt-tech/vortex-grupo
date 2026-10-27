import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { carregarAcoes } from "@/app/(painel)/_acoes/comum";
import { carregarCampanhasComResumo } from "@/app/(painel)/campanhas/dados";
import { criarAcaoComo } from "../acoes/criar";
import { cancelarAcaoComo, editarAcaoComo, ERRO_JA_COMECOU_CANCELAR, ERRO_JA_COMECOU_EDITAR, type Edicao } from "../acoes/editar";
import { env } from "../env";
import { ABAS_MENSAGENS, type AbaMensagens } from "../regras/abas-mensagens";
import { entradaAcaoDaApi, quandoDaApi } from "../regras/api";
import { inicioDoPeriodo, resumoDaLinha } from "../regras/campanhas";
import { preencherDias } from "../regras/metricas";
import { ehUuid } from "../regras/uuid";
import { mascararTelefone } from "../telefone";
import type { ChaveAutenticada } from "./auth";

/** Consultas da API v1 (e do MCP, Tarefa 2): as mesmas funções e RPCs que o painel usa, lidas com o service role
 *  (a chave já foi conferida por `autenticarApi`). Cada uma devolve os dados ou `{ status, erro }` em pt-BR. */

export type ResultadoApi<T> = { ok: true; dados: T; status?: number } | { ok: false; status: number; erro: string };

type DB = Pick<SupabaseClient, "from" | "rpc">;

export const POR_PAGINA_API = 50;
const DIAS_METRICAS = 7;

const falha = (status: number, erro: string): { ok: false; status: number; erro: string } => ({ ok: false, status, erro });

const linkDaCampanha = (slug: string) => `${env("NEXT_PUBLIC_SITE_URL")}/l/${slug}`;

export type CampanhaApi = { id: string; nome: string; slug: string; link: string; tipo: string; grupos: number; participantes: number };

/** Campanhas ativas (não arquivadas) com grupos e participantes atuais (`resumo_campanhas`). */
export async function listarCampanhasApi(db: DB): Promise<ResultadoApi<{ campanhas: CampanhaApi[] }>> {
  try {
    const { campanhas, resumos } = await carregarCampanhasComResumo(db, { desde: inicioDoPeriodo(DIAS_METRICAS) });
    return {
      ok: true,
      dados: {
        campanhas: campanhas
          .filter((c) => !c.arquivada)
          .map((c) => {
            const r = resumos.get(c.id);
            const slug = c.slug ?? "";
            return { id: c.id, nome: c.nome, slug, link: linkDaCampanha(slug), tipo: c.tipo ?? "campanha", grupos: r?.grupos ?? 0, participantes: r?.participantes ?? 0 };
          }),
      },
    };
  } catch {
    return falha(500, "Não foi possível carregar as campanhas.");
  }
}

export type MetricasApi = { cliques: number; entraram: number; sairam: number };

/** Uma campanha (arquivada também) + métricas dos últimos 7 dias (totais e por dia, em Brasília). */
export async function verCampanhaApi(
  db: DB,
  id: string,
): Promise<ResultadoApi<{ campanha: CampanhaApi & { descricao: string | null; arquivada: boolean; metricas_7_dias: MetricasApi & { por_dia: (MetricasApi & { data: string })[] } } }>> {
  if (!ehUuid(id)) return falha(400, "Campanha inválida.");
  const desde = inicioDoPeriodo(DIAS_METRICAS);
  const [camp, resumo, metricas] = await Promise.all([
    db.from("campanhas").select("id, nome, slug, tipo, descricao, arquivada").eq("id", id).maybeSingle(),
    db.rpc("resumo_campanhas", { p_desde: desde, p_campanha: id }),
    db.rpc("metricas_campanha", { p_campanha: id, p_desde: desde }),
  ]);
  if (camp.error || resumo.error || metricas.error) return falha(500, "Não foi possível carregar a campanha.");
  const c = camp.data as { id: string; nome: string; slug: string; tipo: string | null; descricao: string | null; arquivada: boolean } | null;
  if (!c) return falha(404, "Campanha não encontrada.");
  const linha = ((resumo.data ?? []) as Record<string, unknown>[])[0];
  const r = linha ? resumoDaLinha(linha) : null;
  const dias = preencherDias((metricas.data ?? []) as { dia: string; cliques: number; entradas: number; saidas: number }[], DIAS_METRICAS);
  return {
    ok: true,
    dados: {
      campanha: {
        id: c.id,
        nome: c.nome,
        slug: c.slug,
        link: linkDaCampanha(c.slug),
        tipo: c.tipo ?? "campanha",
        descricao: c.descricao,
        arquivada: c.arquivada,
        grupos: r?.grupos ?? 0,
        participantes: r?.participantes ?? 0,
        metricas_7_dias: {
          cliques: r?.cliques ?? 0,
          entraram: r?.entradas ?? 0,
          sairam: r?.saidas ?? 0,
          por_dia: dias.map((d) => ({ data: d.data, cliques: d.cliques, entraram: d.entradas, sairam: d.saidas })),
        },
      },
    },
  };
}

export type GrupoApi = { id: string; nome: string; numero: number; link_convite: string | null; participantes: number; admins: number; cliques: number; cheio: boolean };
export type Paginado = { pagina: number; por_pagina: number; total: number };

/** Grupos ativos da campanha, 50 por página, na ordem do número; cliques e admins de `resumo_grupos`. */
export async function listarGruposApi(db: DB, campanhaId: string, pagina: number): Promise<ResultadoApi<{ grupos: GrupoApi[] } & Paginado>> {
  if (!ehUuid(campanhaId)) return falha(400, "Campanha inválida.");
  const { data: camp, error: erroCamp } = await db.from("campanhas").select("id").eq("id", campanhaId).maybeSingle();
  if (erroCamp) return falha(500, "Não foi possível carregar a campanha.");
  if (!camp) return falha(404, "Campanha não encontrada.");
  const de = (pagina - 1) * POR_PAGINA_API;
  const [grupos, resumo] = await Promise.all([
    db
      .from("grupos")
      .select("id, nome, numero, link_convite, participantes, cheio", { count: "exact" })
      .eq("campanha_id", campanhaId)
      .eq("ativo", true)
      .order("numero")
      .range(de, de + POR_PAGINA_API - 1),
    db.rpc("resumo_grupos", { p_campanha: campanhaId }),
  ]);
  if (grupos.error || resumo.error) return falha(500, "Não foi possível carregar os grupos.");
  const porGrupo = new Map(((resumo.data ?? []) as { grupo_id: string; cliques: number | string; admins: number | string }[]).map((l) => [l.grupo_id, l]));
  const linhas = (grupos.data ?? []) as { id: string; nome: string; numero: number; link_convite: string | null; participantes: number; cheio: boolean }[];
  return {
    ok: true,
    dados: {
      grupos: linhas.map((g) => ({
        id: g.id,
        nome: g.nome,
        numero: g.numero,
        link_convite: g.link_convite,
        participantes: g.participantes,
        admins: Number(porGrupo.get(g.id)?.admins ?? 0),
        cliques: Number(porGrupo.get(g.id)?.cliques ?? 0),
        cheio: g.cheio,
      })),
      pagina,
      por_pagina: POR_PAGINA_API,
      total: grupos.count ?? 0,
    },
  };
}

export type AcaoApi = {
  id: string;
  tipo: string;
  titulo: string;
  situacao: string;
  campanha: { id: string; nome: string };
  origem: string;
  agendada_para: string;
  criada_em: string;
  iniciada_em: string | null;
  terminada_em: string | null;
  motivo: string | null;
  contadores: { total: number; processando: number; sucesso: number; falha: number } | null;
  entregues: number | null;
  lidos: number | null;
};

/** Ações (execuções) pela mesma lista do painel (`listar_acoes`), 50 por página, agrupadas por execução.
 *  `aba`: todas, fila, agendado, processando, sucesso, falhas. */
export async function listarAcoesApi(
  db: DB,
  f: { campanha: string | null; aba: string | null; pagina: number },
): Promise<ResultadoApi<{ acoes: AcaoApi[] } & Paginado>> {
  if (f.campanha && !ehUuid(f.campanha)) return falha(400, "Campanha inválida.");
  const aba = f.aba || "todas";
  if (!ABAS_MENSAGENS.some((a) => a.valor === aba)) return falha(400, `Aba inválida: use ${ABAS_MENSAGENS.map((a) => a.valor).join(", ")}.`);
  try {
    const { linhas, totalAcoes } = await carregarAcoes(db, {
      campanhaId: f.campanha || null,
      tipos: null,
      aba: aba as AbaMensagens,
      inicioIso: null,
      fimIso: null,
      porPagina: POR_PAGINA_API,
      pagina: f.pagina,
      agrupar: true,
    });
    return {
      ok: true,
      dados: {
        acoes: linhas.map((a) => ({
          id: a.execucaoId,
          tipo: a.tipo,
          titulo: a.titulo,
          situacao: a.situacao.rotulo,
          campanha: { id: a.campanhaId, nome: a.campanhaNome },
          origem: a.origem,
          agendada_para: a.agendadaPara,
          criada_em: a.criadaEm,
          iniciada_em: a.iniciadaEm,
          terminada_em: a.terminadaEm,
          motivo: a.motivo,
          contadores: a.contadores ?? null,
          entregues: a.entregues ?? null,
          lidos: a.lidos ?? null,
        })),
        pagina: f.pagina,
        por_pagina: POR_PAGINA_API,
        total: totalAcoes,
      },
    };
  } catch {
    return falha(500, "Não foi possível carregar as ações.");
  }
}

/** Cria a ação pelo mesmo núcleo do assistente (`criarAcaoComo`), com histórico "via API (chave NOME)". */
export async function criarAcaoApi(chave: Pick<ChaveAutenticada, "id" | "nome">, corpo: unknown): Promise<ResultadoApi<{ ids: string[] }>> {
  const e = entradaAcaoDaApi(corpo);
  if (!e.ok) return falha(400, e.erro);
  const r = await criarAcaoComo({ tipo: "api", chave: { id: chave.id, nome: chave.nome } }, null, e.entrada);
  if ("erro" in r) return falha(r.erro.startsWith("Não foi possível") ? 500 : 400, r.erro);
  return { ok: true, dados: { ids: r.ids }, status: 201 };
}

/** Erro do núcleo de cancelar/editar → status HTTP: 404 não achou, 409 já começou/cancelada, 400 validação, 500 banco. */
function statusDoErro(erro: string): number {
  if (erro === "Ação não encontrada.") return 404;
  if (erro === ERRO_JA_COMECOU_CANCELAR || erro === ERRO_JA_COMECOU_EDITAR) return 409;
  return erro.startsWith("Não foi possível") ? 500 : 400;
}

/** Cancela uma ação ainda agendada (e as seguintes encadeadas), com o histórico da chave. */
export async function cancelarAcaoApi(chave: Pick<ChaveAutenticada, "id" | "nome">, id: unknown): Promise<ResultadoApi<{ id: string }>> {
  if (!ehUuid(id)) return falha(400, "Informe o id da ação (veja listar_acoes).");
  const r = await cancelarAcaoComo({ tipo: "api", chave: { id: chave.id, nome: chave.nome } }, null, id);
  if ("erro" in r) return falha(statusDoErro(r.erro), r.erro);
  return { ok: true, dados: { id: r.id } };
}

/** Edita uma ação ainda agendada: conteúdo (montado do atual por `conteudo`) e/ou horário (`agendar_para`, mesmo
 *  formato da criação; ausente = mantém). Mesmas regras da criação; tipo, campanha e alvos não mudam. */
export async function editarAcaoApi(
  chave: Pick<ChaveAutenticada, "id" | "nome">,
  id: unknown,
  conteudo: Edicao["conteudo"],
  agendarPara: unknown,
): Promise<ResultadoApi<{ id: string; agendada_para: string }>> {
  if (!ehUuid(id)) return falha(400, "Informe o id da ação (veja listar_acoes).");
  let quando: string | undefined;
  if (agendarPara !== undefined && agendarPara !== null && agendarPara !== "") {
    const q = quandoDaApi(agendarPara);
    if (!q.ok) return falha(400, q.erro);
    quando = q.quando;
  }
  const r = await editarAcaoComo({ tipo: "api", chave: { id: chave.id, nome: chave.nome } }, null, id, { conteudo, quando });
  if ("erro" in r) return falha(statusDoErro(r.erro), r.erro);
  return { ok: true, dados: { id: r.id, agendada_para: r.agendada_para } };
}

export type ContaApi = { id: string; nome: string; telefone: string | null; conectado: boolean };

/** Contas (números) com o telefone mascarado. */
export async function listarContasApi(db: DB): Promise<ResultadoApi<{ contas: ContaApi[] }>> {
  const { data, error } = await db.from("conexoes").select("id, nome, telefone, status").order("nome");
  if (error) return falha(500, "Não foi possível carregar as conexões.");
  return {
    ok: true,
    dados: {
      contas: ((data ?? []) as { id: string; nome: string; telefone: string | null; status: string }[]).map((c) => ({
        id: c.id,
        nome: c.nome,
        telefone: mascararTelefone(c.telefone),
        conectado: c.status === "conectado",
      })),
    },
  };
}
