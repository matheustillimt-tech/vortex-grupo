import { filtrosDaRequisicao, registrarExportacao } from "@/src/lib/exportacoes";
import { dataCsv, dataDoArquivo, montarCsv } from "@/src/lib/regras/csv";
import { CABECALHO_PROCESSADAS, ROTULO_DECISAO, ROTULO_ORIGEM, condicaoFiltroHistorico, lerFiltroHistorico } from "@/src/lib/regras/solicitacoes";
import { ehUuid } from "@/src/lib/regras/uuid";
import { permitido } from "@/src/lib/permissoes";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { telefoneLegivel } from "@/src/lib/telefone";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PAGINA = 1000;
const MAXIMO_LINHAS = 100_000;

type Linha = {
  created_at: string;
  grupo_nome: string | null;
  telefone: string;
  pedido_em: string | null;
  decisao: string;
  origem: string;
  motivo: string | null;
  resultado: string;
  erro: string | null;
};

/** CSV das solicitações de entrada processadas de uma campanha (`?campanha=`, e o filtro de status do Histórico em
 *  `?status=`), em páginas de 1000. Sai telefone:
 *  exige "ver" em Campanhas e em Leads. Registra em "Ver exportações" (tipo `solicitacoes`); `?exportacao={id}` gera
 *  de novo com os filtros guardados, sem gravar outra linha. */
export async function GET(req: Request) {
  const db = await dbUsuario();
  const { data: sessao } = await db.auth.getUser();
  if (!sessao.user) return new Response("não autenticado", { status: 401 });
  if (!(await permitido("campanhas", "ver")) || !(await permitido("leads", "ver"))) return new Response("sem permissão", { status: 403 });

  const pedido = await filtrosDaRequisicao(db, new URL(req.url), "solicitacoes");
  if ("erro" in pedido) return new Response("Exportação não encontrada.", { status: 404 });
  const campanhaId = pedido.filtros.campanha ?? "";
  if (!ehUuid(campanhaId)) return new Response("Informe ?campanha= com um id válido.", { status: 400 });
  const status = lerFiltroHistorico(pedido.filtros.status);
  const cond = condicaoFiltroHistorico(status);

  const linhas: string[][] = [];
  for (let de = 0; de < MAXIMO_LINHAS; de += PAGINA) {
    let consulta = db
      .from("solicitacoes_entrada")
      .select("created_at, grupo_nome, telefone, pedido_em, decisao, origem, motivo, resultado, erro")
      .eq("campanha_id", campanhaId);
    if (cond.decisao) consulta = consulta.eq("decisao", cond.decisao);
    if (cond.resultado) consulta = consulta.eq("resultado", cond.resultado);
    const { data, error } = await consulta.order("created_at", { ascending: false }).range(de, de + PAGINA - 1);
    if (error) {
      console.error("[exportar/solicitacoes]", error);
      return new Response("Não foi possível gerar o arquivo.", { status: 500 });
    }
    const pagina = (data ?? []) as Linha[];
    for (const l of pagina) {
      linhas.push([
        telefoneLegivel(l.telefone),
        l.grupo_nome ?? "",
        ROTULO_DECISAO[l.decisao] ?? l.decisao,
        ROTULO_ORIGEM[l.origem] ?? l.origem,
        l.motivo ?? "",
        l.resultado === "ok" ? "OK" : "Erro",
        l.erro ?? "",
        dataCsv(l.pedido_em),
        dataCsv(l.created_at),
      ]);
    }
    if (pagina.length < PAGINA) break;
  }

  const nomeArquivo = `solicitacoes-${dataDoArquivo()}.csv`;
  if (!pedido.reexportacao) {
    await registrarExportacao(db, { tipo: "solicitacoes", filtros: status === "todas" ? { campanha: campanhaId } : { campanha: campanhaId, status }, linhas: linhas.length, nomeArquivo, usuario: sessao.user });
  }
  return new Response(montarCsv(CABECALHO_PROCESSADAS, linhas), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${nomeArquivo}"`,
      "cache-control": "no-store",
    },
  });
}
