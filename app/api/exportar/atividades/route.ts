import { CABECALHO_ATIVIDADES, dataDoArquivo, linhaCsvAtividade, montarCsv, type AtividadeLinha } from "@/src/lib/regras/csv";
import { LIMITE_PAGINA_EXPORTACAO, lerEvento, semNumerosConectados } from "@/src/lib/regras/analises";
import { telefonesConectados } from "@/src/lib/automacoes";
import { ehUuid } from "@/src/lib/regras/uuid";
import { permitido } from "@/src/lib/permissoes";
import { dbUsuario } from "@/src/lib/supabase/usuario";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PAGINA = LIMITE_PAGINA_EXPORTACAO;
const MAXIMO_LINHAS = 50_000;

/** "EXPORTAR HISTORICO" da aba Atividades: entradas e saídas da campanha, com os mesmos filtros da
 *  tela, lidas em páginas de 1000 da `atividades_campanha` até 50.000 linhas. Exige ver Campanhas e ver Leads
 *  (a planilha tem telefones). */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const campanha = sp.get("campanha");
  if (!ehUuid(campanha)) return new Response("Campanha inválida.", { status: 400 });

  const db = await dbUsuario();
  const { data: sessao } = await db.auth.getUser();
  if (!sessao.user) return new Response("não autenticado", { status: 401 });
  if (!(await permitido("campanhas", "ver"))) return new Response("sem permissão", { status: 403 });
  if (!(await permitido("leads", "ver"))) return new Response("sem permissão", { status: 403 });

  const grupo = ehUuid(sp.get("grupo")) ? sp.get("grupo") : null;
  const evento = lerEvento(sp.get("evento"));
  const busca = (sp.get("q") ?? "").trim().slice(0, 40) || null;
  const inicio = sp.get("inicio") ? `${sp.get("inicio")}T00:00:00-03:00` : null;
  const fim = sp.get("fim") ? `${sp.get("fim")}T23:59:59-03:00` : null;

  // Como na tela: as contas conectadas não são entrada nem saída de lead (saem da planilha).
  const conectados = await telefonesConectados(db);
  const linhas: AtividadeLinha[] = [];
  for (let de = 0; linhas.length < MAXIMO_LINHAS; de += PAGINA) {
    const { data, error } = await db.rpc("atividades_campanha", {
      p_campanha: campanha, p_busca: busca, p_grupo: grupo, p_evento: evento, p_inicio: inicio, p_fim: fim, p_limite: PAGINA, p_deslocamento: de,
    });
    if (error) return new Response(`Não foi possível carregar as atividades: ${error.message}`, { status: 500 });
    const pagina = (data ?? []) as { telefone: string; grupo_nome: string; grupo_numero: number; evento: string; em: string }[];
    linhas.push(...semNumerosConectados(pagina, conectados).map((l) => ({ telefone: l.telefone, grupo_nome: l.grupo_nome, grupo_numero: Number(l.grupo_numero), evento: l.evento, em: l.em })));
    if (pagina.length < PAGINA) break;
  }

  const corpo = linhas.slice(0, MAXIMO_LINHAS).map(linhaCsvAtividade);
  return new Response(montarCsv(CABECALHO_ATIVIDADES, corpo), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="atividades-${dataDoArquivo()}.csv"`,
      "cache-control": "no-store",
    },
  });
}
