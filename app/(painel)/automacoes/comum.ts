import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Provedor } from "@/src/lib/checkout/parsers";
import { alvoDaAcaoDePessoa, type Gatilho } from "@/src/lib/regras/automacoes";
import { situacaoDaExecucao } from "@/src/lib/regras/calendario";
import type { TipoExecucao } from "@/src/lib/regras/conteudo";
import { resumoDasExecucoes } from "@/src/lib/resumo-execucoes";
import { PROVEDOR_GERAL, type FiltrosAutomacoes } from "./abas";
import type { AcaoAutomacaoLinha, AutomacaoLinha, ExecucaoLinha } from "./lista";

/** Carregador da lista de automações (Etapa 3B, Task 3): extraído de `/automacoes` pra reuso na aba "Automações"
 *  da campanha (`/campanhas/{id}/automacoes`), que passa `campanhaId` pra filtrar. */

type DB = Pick<SupabaseClient, "from" | "rpc">;

export const POR_PAGINA_AUTOMACOES = 12;
const ULTIMAS_EXECUCOES = 20;

/** `%`, `_` e `\` contam como curinga no ILIKE: escapa pra buscar o texto como foi digitado. */
const escaparBusca = (q: string) => q.replace(/[\\%_]/g, (c) => `\\${c}`);

type Resumo = { automacao_id: string; total: number | string; agendadas: number | string; enviando: number | string; concluidas: number | string; falhas: number | string };

export type ResultadoAutomacoes = { automacoes: AutomacaoLinha[]; pastas: string[]; total: number };

export async function carregarAutomacoes(
  db: DB,
  args: { campanhaId?: string | null; filtros: FiltrosAutomacoes; plataformaWebhook?: Provedor },
): Promise<ResultadoAutomacoes> {
  const { campanhaId, filtros, plataformaWebhook } = args;

  let consulta = db
    .from("automacoes")
    .select("id, nome, gatilho, quando, provedor, produto, ativo, motivo_desativada, pasta, campanha_id, campanhas(nome), automacao_acoes(ordem, tipo, conteudo, atraso_min)", { count: "exact" });
  if (campanhaId) consulta = consulta.eq("campanha_id", campanhaId);
  // Aba "Automações" do webhook: sempre as de checkout desta plataforma ou sem plataforma, só leitura —
  // os filtros da tela (gatilho, provedor) não se aplicam aqui.
  if (plataformaWebhook) consulta = consulta.eq("gatilho", "checkout").or(`provedor.eq.${plataformaWebhook},provedor.is.null`);
  if (filtros.q) consulta = consulta.ilike("nome", `%${escaparBusca(filtros.q)}%`);
  if (!plataformaWebhook) {
    if (filtros.gatilho) consulta = consulta.eq("gatilho", filtros.gatilho);
    if (filtros.gatilho === "checkout" && filtros.provedor === PROVEDOR_GERAL) consulta = consulta.is("provedor", null);
    else if (filtros.gatilho === "checkout" && filtros.provedor) consulta = consulta.eq("provedor", filtros.provedor);
  }
  if (filtros.pasta) consulta = consulta.eq("pasta", filtros.pasta);
  if (filtros.estado !== "todos") consulta = consulta.eq("ativo", filtros.estado === "ativado");
  const inicio = (filtros.pagina - 1) * POR_PAGINA_AUTOMACOES;
  // Pastas do filtro: na aba da campanha, só as que têm alguma automação dela (as outras dariam lista vazia).
  let consultaPastas = db.from("automacoes").select("pasta").not("pasta", "is", null);
  if (campanhaId) consultaPastas = consultaPastas.eq("campanha_id", campanhaId);

  const [{ data, count, error }, { data: comPasta, error: erroPastas }] = await Promise.all([
    consulta.order("created_at", { ascending: false }).range(inicio, inicio + POR_PAGINA_AUTOMACOES - 1),
    consultaPastas,
  ]);
  if (error) throw new Error(`Não foi possível carregar as automações: ${error.message}`);
  if (erroPastas) throw new Error(`Não foi possível carregar as pastas: ${erroPastas.message}`);
  const total = count ?? 0;

  const pastas = [...new Set((comPasta ?? []).map((p) => p.pasta as string))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const ids = (data ?? []).map((a) => a.id as string);

  const [placar, execucoesPorAutomacao] = ids.length
    ? await Promise.all([
        db.rpc("resumo_automacoes", { p_ids: ids }).then(({ data: r, error: e }) => {
          if (e) throw new Error(`Não foi possível carregar o placar: ${e.message}`);
          return new Map(((r ?? []) as Resumo[]).map((l) => [l.automacao_id, l]));
        }),
        Promise.all(
          ids.map(async (id) => {
            const { data: ex, error: e } = await db
              .from("execucoes")
              .select("id, campanha_id, tipo, status, agendada_para")
              .eq("automacao_id", id)
              .order("agendada_para", { ascending: false })
              .limit(ULTIMAS_EXECUCOES);
            if (e) throw new Error(`Não foi possível carregar as execuções: ${e.message}`);
            return [id, ex ?? []] as const;
          }),
        ),
      ])
    : [new Map<string, Resumo>(), [] as const];

  const todasExecucoes = execucoesPorAutomacao.flatMap(([, ex]) => ex);
  const resumoExec = await resumoDasExecucoes(db, todasExecucoes.map((e) => e.id as string));
  const execucoes = new Map(
    execucoesPorAutomacao.map(([id, ex]) => [
      id,
      ex.map((e): ExecucaoLinha => {
        const s = situacaoDaExecucao(e.status as string, resumoExec.get(e.id as string));
        return { id: e.id as string, campanhaId: e.campanha_id as string, tipo: e.tipo as TipoExecucao, agendadaPara: e.agendada_para as string, situacao: s.situacao, detalhe: s.detalhe };
      }),
    ]),
  );

  // Nomes das tags/blacklists das ações de pessoa ("Adicionar tag: {nome}"). Só consulta quando alguma automação da
  // página tem uma dessas ações (as de antes seguem sem consulta a mais).
  const alvos = (data ?? []).flatMap((a) => ((a.automacao_acoes ?? []) as { tipo: string; conteudo: unknown }[]).map(alvoDaAcaoDePessoa)).filter((x) => x !== null);
  const nomesAlvo = new Map<string, string>();
  for (const [tabela, tipo] of [["tags", "tag"], ["blacklists", "blacklist"]] as const) {
    const idsAlvo = [...new Set(alvos.filter((x) => x.tipo === tipo).map((x) => x.id))];
    if (!idsAlvo.length) continue;
    const { data: nomes, error: erroNomes } = await db.from(tabela).select("id, nome").in("id", idsAlvo);
    if (erroNomes) throw new Error(`Não foi possível carregar as ${tabela}: ${erroNomes.message}`);
    for (const n of (nomes ?? []) as { id: string; nome: string }[]) nomesAlvo.set(`${tipo}:${n.id}`, n.nome);
  }

  const automacoes: AutomacaoLinha[] = (data ?? []).map((a) => {
    const r = placar.get(a.id as string);
    const acoesLinha = ((a.automacao_acoes ?? []) as { ordem: number; tipo: string; conteudo: unknown; atraso_min: number }[]).sort((x, y) => x.ordem - y.ordem);
    return {
      id: a.id as string,
      nome: a.nome as string,
      gatilho: a.gatilho as Gatilho,
      quando: a.quando as string | null,
      provedor: a.provedor as Provedor | null,
      produto: a.produto as string | null,
      ativo: a.ativo as boolean,
      motivoDesativada: (a.motivo_desativada as string | null) ?? null,
      pasta: a.pasta as string | null,
      campanha: (a.campanhas as unknown as { nome: string } | null)?.nome ?? "",
      acoes: acoesLinha.length,
      acoesDetalhe: acoesLinha.map((x) => {
        const alvo = alvoDaAcaoDePessoa(x);
        return {
          tipo: x.tipo as AcaoAutomacaoLinha["tipo"],
          conteudo: x.conteudo,
          atraso_min: x.atraso_min,
          ...(alvo ? { alvo: nomesAlvo.get(`${alvo.tipo}:${alvo.id}`) ?? null } : {}),
        };
      }),
      placar: {
        total: Number(r?.total ?? 0),
        agendadas: Number(r?.agendadas ?? 0),
        enviando: Number(r?.enviando ?? 0),
        concluidas: Number(r?.concluidas ?? 0),
        falhas: Number(r?.falhas ?? 0),
      },
      execucoes: execucoes.get(a.id as string) ?? [],
    };
  });

  return { automacoes, pastas, total };
}

/** Campanhas não arquivadas, pra janela "Importar JSON" escolher o destino. */
export async function carregarCampanhasParaImportar(db: DB): Promise<{ id: string; nome: string }[]> {
  const { data, error } = await db.from("campanhas").select("id, nome").eq("arquivada", false).order("nome");
  if (error) throw new Error(`Não foi possível carregar as campanhas: ${error.message}`);
  return (data ?? []) as { id: string; nome: string }[];
}
