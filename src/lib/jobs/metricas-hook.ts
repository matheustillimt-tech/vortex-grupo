import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { campanhaTerminou } from "../regras/campanha-tipo";
import { alguemEscuta, diaBrasilia, horaDeMetricas, webhooksQueCasam, type Evento } from "../regras/webhooks";
import { dbAdmin } from "../supabase/admin";
import { carregarWebhooks, enfileirarEventos, type NovoEventoSaida } from "../webhooks";

type DB = Pick<SupabaseClient, "from" | "rpc">;

const PERIODO_MS = 24 * 3600_000;
/** Teto de mensagens (execuções) por campanha em cada envio de métricas. */
export const MAXIMO_MENSAGENS_POR_CAMPANHA = 200;

type Resumo = { campanha_id: string; cliques: number; entradas: number; saidas: number; participantes: number; grupos: number };
type ResumoExecucao = { execucao_id: string; total: number; feitas: number; erros: number; pendentes: number; entregues: number; lidos: number };

/** Passo `hooks` do tick (Etapa 3K, Tarefa 5): às 7h, 12h e 17h de Brasília (nos primeiros 15 minutos da hora,
 *  pra um tick perdido não perder o horário), uma vez por campanha ativa (não arquivada nem terminada) que algum
 *  Hook escuta: "Métricas da campanha" (cliques, entradas, saídas das últimas 24 h; participantes e grupos de
 *  agora) e "Métricas de mensagens da campanha" (entregues/lidos das mensagens iniciadas nas últimas 24 h). As
 *  chaves `metricas:{id}:{data}:{hora}` e `metricas_mensagens:{id}:{data}:{hora}` fazem o segundo tick da mesma
 *  hora não duplicar nada. Sem Hook com esses eventos, só lê a tabela `webhooks` e para. Devolve quantos
 *  eventos montou (0 fora do horário). */
export async function enviarMetricasHook(agora: Date = new Date(), db: DB = dbAdmin()): Promise<number> {
  const hora = horaDeMetricas(agora);
  if (hora === null) return 0;
  const webhooks = await carregarWebhooks(db);
  if (!webhooks) throw new Error("Não foi possível ler os hooks.");
  const querCampanha = alguemEscuta(webhooks, ["metricas_campanha"]);
  const querMensagens = alguemEscuta(webhooks, ["metricas_mensagens"]);
  if (!querCampanha && !querMensagens) return 0;

  const { data: camps, error: erroCamps } = await db.from("campanhas").select("id, nome, slug, termina_em").eq("arquivada", false);
  if (erroCamps) throw new Error(`Não foi possível ler as campanhas: ${erroCamps.message}`);
  const escuta = (evento: Evento, id: string) => webhooksQueCasam(webhooks, evento, id).length > 0;
  const campanhas = ((camps ?? []) as { id: string; nome: string; slug: string; termina_em: string | null }[])
    .filter((c) => !campanhaTerminou(c.termina_em, agora))
    .filter((c) => escuta("metricas_campanha", c.id) || escuta("metricas_mensagens", c.id));
  if (!campanhas.length) return 0;

  const desde = new Date(agora.getTime() - PERIODO_MS).toISOString();
  const data = diaBrasilia(agora);
  const eventos: NovoEventoSaida[] = [];

  const paraCampanha = campanhas.filter((c) => escuta("metricas_campanha", c.id));
  if (paraCampanha.length) {
    // Uma chamada pra todas as campanhas (a mesma RPC da lista de campanhas e da Visão geral).
    const { data: resumos, error } = await db.rpc("resumo_campanhas", { p_desde: desde });
    if (error) throw new Error(`Não foi possível calcular as métricas das campanhas: ${error.message}`);
    const porId = new Map(((resumos ?? []) as Resumo[]).map((r) => [r.campanha_id, r]));
    for (const c of paraCampanha) {
      const r = porId.get(c.id);
      eventos.push({
        evento: "metricas_campanha",
        campanhaId: c.id,
        dados: {
          campanha: c.slug,
          campanha_nome: c.nome,
          desde,
          cliques: Number(r?.cliques ?? 0),
          entradas: Number(r?.entradas ?? 0),
          saidas: Number(r?.saidas ?? 0),
          participantes: Number(r?.participantes ?? 0),
          grupos: Number(r?.grupos ?? 0),
        },
        chave: `metricas:${c.id}:${data}:${hora}`,
      });
    }
  }

  const paraMensagens = campanhas.filter((c) => escuta("metricas_mensagens", c.id));
  if (paraMensagens.length) {
    // Teto por campanha (não global): uma campanha com muitos envios não tira as outras do relatório.
    const porCampanha = await Promise.all(
      paraMensagens.map((c) =>
        db
          .from("execucoes")
          .select("id, campanha_id, tipo, iniciada_em")
          .eq("campanha_id", c.id)
          .in("tipo", ["mensagem", "enquete"])
          .gte("iniciada_em", desde)
          .order("iniciada_em", { ascending: false })
          .limit(MAXIMO_MENSAGENS_POR_CAMPANHA),
      ),
    );
    const falha = porCampanha.find((r) => r.error);
    if (falha?.error) throw new Error(`Não foi possível ler as mensagens das campanhas: ${falha.error.message}`);
    const lista = porCampanha.flatMap((r) => (r.data ?? []) as { id: string; campanha_id: string; tipo: string; iniciada_em: string }[]);
    const resumoPorId = new Map<string, ResumoExecucao>();
    if (lista.length) {
      const { data: resumos, error: erroResumo } = await db.rpc("resumo_execucoes", { p_ids: lista.map((e) => e.id) });
      if (erroResumo) throw new Error(`Não foi possível somar entregues e lidos: ${erroResumo.message}`);
      for (const r of (resumos ?? []) as ResumoExecucao[]) resumoPorId.set(r.execucao_id, r);
    }
    for (const c of paraMensagens) {
      const mensagens = lista
        .filter((e) => e.campanha_id === c.id)
        .map((e) => {
          const r = resumoPorId.get(e.id);
          return {
            execucao_id: e.id,
            tipo: e.tipo,
            enviada_em: e.iniciada_em,
            grupos: Number(r?.total ?? 0),
            enviadas: Number(r?.feitas ?? 0),
            entregues: Number(r?.entregues ?? 0),
            lidos: Number(r?.lidos ?? 0),
          };
        });
      eventos.push({
        evento: "metricas_mensagens",
        campanhaId: c.id,
        dados: {
          campanha: c.slug,
          campanha_nome: c.nome,
          desde,
          entregues: mensagens.reduce((s, m) => s + m.entregues, 0),
          lidos: mensagens.reduce((s, m) => s + m.lidos, 0),
          mensagens,
        },
        // Prefixo próprio: o índice único é (webhook_id, chave), e um webhook com os dois eventos de métricas
        // perderia um deles se a chave fosse a mesma.
        chave: `metricas_mensagens:${c.id}:${data}:${hora}`,
      });
    }
  }

  await enfileirarEventos(db, eventos, webhooks);
  return eventos.length;
}
