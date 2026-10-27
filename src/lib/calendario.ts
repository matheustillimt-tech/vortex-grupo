import type { SupabaseClient } from "@supabase/supabase-js";
import { agruparPorDia, itemDaExecucao, projetarPassos, type ExecucaoCalendario, type ItemCalendario, type PassoProjetavel } from "./regras/calendario";
import { resumoDasExecucoes } from "./resumo-execucoes";

export type DiaCalendario = ReturnType<typeof agruparPorDia>[number];

/** Execuções reais da janela (avulsas, massa, sequência já materializada, grupo novo) + passos projetados das
 *  sequências. `campanhaId` null = todas as campanhas ativas. */
export async function carregarCalendario(db: Pick<SupabaseClient, "from" | "rpc">, campanhaId: string | null, de: Date, ate: Date, agora: Date = new Date()): Promise<{ dias: DiaCalendario[]; nomes: Map<string, string>; lidos: Map<string, number> }> {
  let camps = db.from("campanhas").select("id, nome, data_aula, sequencia_id").eq("arquivada", false);
  if (campanhaId) camps = db.from("campanhas").select("id, nome, data_aula, sequencia_id").eq("id", campanhaId);
  const { data: campanhas, error: erroCamp } = await camps;
  if (erroCamp) throw new Error(`Não foi possível ler as campanhas: ${erroCamp.message}`);
  const lista = (campanhas ?? []) as { id: string; nome: string; data_aula: string | null; sequencia_id: string | null }[];
  const ids = lista.map((c) => c.id);
  if (!ids.length) return { dias: [], nomes: new Map(), lidos: new Map() };

  const { data: execs, error: erroExec } = await db
    .from("execucoes")
    // `automacoes(nome)` só leitura, na mesma consulta: pro rótulo "Automação: {nome} hh:mm".
    .select("id, campanha_id, tipo, origem, status, agendada_para, conteudo, conteudo_final, passo_id, automacoes(nome)")
    .in("campanha_id", ids)
    .gte("agendada_para", de.toISOString())
    .lte("agendada_para", ate.toISOString())
    .order("agendada_para")
    .limit(1000);
  if (erroExec) throw new Error(`Não foi possível ler as execuções: ${erroExec.message}`);
  const reais = (execs ?? []) as unknown as (ExecucaoCalendario & { passo_id: string | null; automacoes: { nome: string } | null })[];
  const resumo = await resumoDasExecucoes(db, reais.map((e) => e.id));
  const itens: ItemCalendario[] = reais.map((e) => itemDaExecucao({ ...e, automacaoNome: e.automacoes?.nome ?? null }, resumo.get(e.id)));

  const comSequencia = lista.filter((c) => c.data_aula && c.sequencia_id);
  if (comSequencia.length) {
    const [{ data: passos, error: erroPassos }, { data: feitos, error: erroFeitos }] = await Promise.all([
      db.from("sequencia_passos").select("id, sequencia_id, dia_relativo, hora, tipo, conteudo").in("sequencia_id", [...new Set(comSequencia.map((c) => c.sequencia_id!))]),
      db.from("execucoes").select("campanha_id, passo_id").in("campanha_id", comSequencia.map((c) => c.id)).not("passo_id", "is", null),
    ]);
    if (erroPassos || erroFeitos) throw new Error("Não foi possível ler as sequências.");
    for (const c of comSequencia) {
      const materializados = new Set((feitos ?? []).filter((f) => f.campanha_id === c.id).map((f) => f.passo_id as string));
      const meus = ((passos ?? []) as (PassoProjetavel & { sequencia_id: string })[]).filter((p) => p.sequencia_id === c.sequencia_id);
      itens.push(...projetarPassos({ id: c.id, data_aula: c.data_aula! }, meus, materializados, agora).filter((i) => new Date(i.quando) >= de && new Date(i.quando) <= ate));
    }
  }
  // "lido por N" do placar que já veio do resumo_execucoes (sem consulta nova).
  const lidos = new Map([...resumo].filter(([, r]) => r.lidos > 0).map(([id, r]) => [id, r.lidos] as [string, number]));
  return { dias: agruparPorDia(itens), nomes: new Map(lista.map((c) => [c.id, c.nome])), lidos };
}
