import { filtrosDaRequisicao, registrarExportacao } from "@/src/lib/exportacoes";
import { lerIdsDaUrl, MAXIMO_CAMPANHAS_RELATORIO, validarIntervalo } from "@/src/lib/regras/assistente-acao";
import { CABECALHO_MENSAGENS_ENVIADAS, dataDoArquivo, linhaCsvMensagemEnviada, montarCsv } from "@/src/lib/regras/csv";
import { permitido } from "@/src/lib/permissoes";
import { dbUsuario } from "@/src/lib/supabase/usuario";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PAGINA = 1000;
/** Teto do arquivo (90 dias × 50 campanhas pode crescer muito): acima disso o CSV para aqui. */
const MAXIMO_LINHAS_HISTORICO = 100_000;

type LinhaTarefa = {
  id: string;
  tipo: string;
  status: string;
  message_id: string | null;
  entregues: number | null;
  lidos: number | null;
  enviado_em: string | null;
  grupos: { nome: string; numero: number } | null;
  conexoes: { nome: string } | null;
  execucoes: { agendada_para: string; origem: string; conteudo: unknown; conteudo_final: unknown; campanhas: { nome: string } | null };
};

/** "Histórico de mensagens enviadas" (assistente de ação, Etapa 3K): uma linha por envio (tarefa) de mensagem ou
 *  enquete das campanhas `?campanhas=a,b` (até 50) com horário da ação entre `?inicio=` e `?fim=` (dias de Brasília,
 *  até 90 dias). Sem telefone: exige "ver" em Campanhas. Páginas de 1000. `?exportacao={id}` gera de novo com os
 *  filtros guardados (sem gravar outra linha). */
export async function GET(req: Request) {
  const db = await dbUsuario();
  const { data: sessao } = await db.auth.getUser();
  if (!sessao.user) return new Response("não autenticado", { status: 401 });
  if (!(await permitido("campanhas", "ver"))) return new Response("sem permissão", { status: 403 });

  const pedido = await filtrosDaRequisicao(db, new URL(req.url), "historico_mensagens");
  if ("erro" in pedido) return new Response("Exportação não encontrada.", { status: 404 });
  const intervalo = validarIntervalo(pedido.filtros.inicio, pedido.filtros.fim);
  if (!intervalo.ok) return new Response(intervalo.erro, { status: 400 });
  const campanhas = lerIdsDaUrl(pedido.filtros.campanhas);
  if (!campanhas?.length) return new Response("Escolha ao menos uma campanha em ?campanhas=.", { status: 400 });
  if (campanhas.length > MAXIMO_CAMPANHAS_RELATORIO) return new Response(`No máximo ${MAXIMO_CAMPANHAS_RELATORIO} campanhas.`, { status: 400 });

  const linhas: string[][] = [];
  let truncado = false;
  for (let de = 0; ; de += PAGINA) {
    if (de >= MAXIMO_LINHAS_HISTORICO) {
      truncado = true;
      break;
    }
    const { data, error } = await db
      .from("tarefas")
      .select(
        "id, tipo, status, message_id, entregues, lidos, enviado_em, grupos(nome, numero), conexoes(nome), " +
          "execucoes!inner(agendada_para, origem, conteudo, conteudo_final, campanha_id, campanhas(nome))",
      )
      .in("tipo", ["mensagem", "enquete"])
      .in("execucoes.campanha_id", campanhas)
      .gte("execucoes.agendada_para", intervalo.desde)
      .lt("execucoes.agendada_para", intervalo.ate)
      .order("id")
      .range(de, de + PAGINA - 1);
    if (error) {
      console.error("[exportar/mensagens-enviadas] tarefas", error);
      return new Response("Não foi possível gerar o arquivo.", { status: 500 });
    }
    const pagina = (data ?? []) as unknown as LinhaTarefa[];
    for (const t of pagina) {
      linhas.push(
        linhaCsvMensagemEnviada({
          data: t.enviado_em ?? t.execucoes.agendada_para,
          campanha: t.execucoes.campanhas?.nome ?? "",
          grupo: t.grupos ? `#${t.grupos.numero} ${t.grupos.nome}` : "",
          conta: t.conexoes?.nome ?? "",
          tipo: t.tipo,
          conteudo: t.execucoes.conteudo_final ?? t.execucoes.conteudo,
          status: t.status,
          message_id: t.message_id,
          entregues: t.entregues ?? 0,
          lidos: t.lidos ?? 0,
          origem: t.execucoes.origem,
        }),
      );
    }
    if (pagina.length < PAGINA) break;
  }

  if (truncado) console.warn(`[exportar/mensagens-enviadas] arquivo cortado em ${MAXIMO_LINHAS_HISTORICO} linhas`);
  const nomeArquivo = `mensagens-enviadas-${dataDoArquivo()}.csv`;
  if (!pedido.reexportacao) {
    await registrarExportacao(db, {
      tipo: "historico_mensagens",
      filtros: { inicio: pedido.filtros.inicio, fim: pedido.filtros.fim, campanhas: campanhas.join(",") },
      linhas: linhas.length,
      nomeArquivo,
      usuario: sessao.user,
    });
  }
  return new Response(montarCsv(CABECALHO_MENSAGENS_ENVIADAS, linhas), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${nomeArquivo}"`,
      "cache-control": "no-store",
      ...(truncado ? { "X-Truncado": "1" } : {}),
    },
  });
}
