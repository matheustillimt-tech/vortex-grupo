import { filtrosDaRequisicao, registrarExportacao } from "@/src/lib/exportacoes";
import { ROTULO_ACAO } from "@/src/lib/regras/acoes";
import { lerIdsDaUrl, MAXIMO_EXECUCOES_RELATORIO } from "@/src/lib/regras/assistente-acao";
import { resumoConteudo, type TipoExecucao } from "@/src/lib/regras/conteudo";
import { CABECALHO_STATUS_MENSAGENS, dataCsv, dataDoArquivo, linhaCsvStatusMensagem, montarCsv, type StatusMensagemLinha } from "@/src/lib/regras/csv";
import { permitido } from "@/src/lib/permissoes";
import { dbUsuario } from "@/src/lib/supabase/usuario";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PAGINA = 1000;
/** Teto do arquivo: 50 ações × grupos × pessoas pode crescer muito; acima disso o CSV para aqui. */
const MAXIMO_LINHAS_STATUS = 100_000;

/** "Relatório de status de mensagens" (assistente de ação, Etapa 3K): `?execucoes=a,b,c` (uuids, até 50) → uma
 *  linha por envio × pessoa com recibo (`relatorio_status_mensagens`, páginas de 1000). Sai telefone: exige "ver"
 *  em Campanhas e em Leads. `?exportacao={id}` gera de novo com os filtros guardados (sem gravar outra linha). */
export async function GET(req: Request) {
  const db = await dbUsuario();
  const { data: sessao } = await db.auth.getUser();
  if (!sessao.user) return new Response("não autenticado", { status: 401 });
  if (!(await permitido("campanhas", "ver")) || !(await permitido("leads", "ver"))) return new Response("sem permissão", { status: 403 });

  const pedido = await filtrosDaRequisicao(db, new URL(req.url), "status_mensagens");
  if ("erro" in pedido) return new Response("Exportação não encontrada.", { status: 404 });
  const execucoes = lerIdsDaUrl(pedido.filtros.execucoes);
  if (!execucoes?.length) return new Response("Escolha ao menos uma ação em ?execucoes=.", { status: 400 });
  if (execucoes.length > MAXIMO_EXECUCOES_RELATORIO) return new Response(`No máximo ${MAXIMO_EXECUCOES_RELATORIO} ações por relatório.`, { status: 400 });

  // Rótulo da coluna "Ação": tipo + resumo do conteúdo + horário (as até 50 execuções, lidas uma vez).
  const { data: execs, error: erroExecs } = await db.from("execucoes").select("id, tipo, conteudo, agendada_para").in("id", execucoes);
  if (erroExecs) {
    console.error("[exportar/status-mensagens] execucoes", erroExecs);
    return new Response("Não foi possível gerar o arquivo.", { status: 500 });
  }
  const rotulos = new Map<string, string>();
  for (const e of (execs ?? []) as { id: string; tipo: TipoExecucao; conteudo: unknown; agendada_para: string }[]) {
    const resumo = resumoConteudo(e.tipo, e.conteudo).slice(0, 80);
    rotulos.set(e.id, `${ROTULO_ACAO[e.tipo] ?? e.tipo}${resumo ? `: ${resumo}` : ""} (${dataCsv(e.agendada_para)})`);
  }

  const linhas: string[][] = [];
  let truncado = false;
  for (let de = 0; ; de += PAGINA) {
    if (de >= MAXIMO_LINHAS_STATUS) {
      truncado = true;
      break;
    }
    const { data, error } = await db.rpc("relatorio_status_mensagens", { p_execucoes: execucoes, p_limite: PAGINA, p_deslocamento: de });
    if (error) {
      console.error("[exportar/status-mensagens] relatorio_status_mensagens", error);
      return new Response("Não foi possível gerar o arquivo.", { status: 500 });
    }
    const pagina = (data ?? []) as StatusMensagemLinha[];
    for (const l of pagina) linhas.push(linhaCsvStatusMensagem(l, rotulos.get(l.execucao_id) ?? ROTULO_ACAO[l.tipo as TipoExecucao] ?? l.tipo));
    if (pagina.length < PAGINA) break;
  }

  if (truncado) console.warn(`[exportar/status-mensagens] arquivo cortado em ${MAXIMO_LINHAS_STATUS} linhas`);
  const nomeArquivo = `status-mensagens-${dataDoArquivo()}.csv`;
  if (!pedido.reexportacao) {
    await registrarExportacao(db, { tipo: "status_mensagens", filtros: { execucoes: execucoes.join(",") }, linhas: linhas.length, nomeArquivo, usuario: sessao.user });
  }
  return new Response(montarCsv(CABECALHO_STATUS_MENSAGENS, linhas), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${nomeArquivo}"`,
      "cache-control": "no-store",
      ...(truncado ? { "X-Truncado": "1" } : {}),
    },
  });
}
