import { LIMITE_PAGINA_EXPORTACAO } from "@/src/lib/regras/analises";
import { CABECALHO_CLIQUES, dataDoArquivo, linhaCsvClique, montarCsv, type CliqueLinha } from "@/src/lib/regras/csv";
import { ehUuid } from "@/src/lib/regras/uuid";
import { permitido } from "@/src/lib/permissoes";
import { dbUsuario } from "@/src/lib/supabase/usuario";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PAGINA = LIMITE_PAGINA_EXPORTACAO;
const MAXIMO_LINHAS = 50_000;

/** "EXPORTAR HISTORICO" da aba Clicks: os cliques da campanha com os mesmos filtros da tela (grupo e
 *  datas), lidos em páginas de 1000 da `cliques_campanha` até 50.000 linhas. Só "Visitante" (8 primeiros
 *  caracteres do hash) — não temos IP em claro. Exige ver Campanhas (não tem telefone: não exige ver Leads). */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const campanha = sp.get("campanha");
  if (!ehUuid(campanha)) return new Response("Campanha inválida.", { status: 400 });

  const db = await dbUsuario();
  const { data: sessao } = await db.auth.getUser();
  if (!sessao.user) return new Response("não autenticado", { status: 401 });
  if (!(await permitido("campanhas", "ver"))) return new Response("sem permissão", { status: 403 });

  const grupo = ehUuid(sp.get("grupo")) ? sp.get("grupo") : null;
  const inicio = sp.get("inicio") ? `${sp.get("inicio")}T00:00:00-03:00` : null;
  const fim = sp.get("fim") ? `${sp.get("fim")}T23:59:59-03:00` : null;

  const linhas: CliqueLinha[] = [];
  for (let de = 0; linhas.length < MAXIMO_LINHAS; de += PAGINA) {
    const { data, error } = await db.rpc("cliques_campanha", { p_campanha: campanha, p_grupo: grupo, p_inicio: inicio, p_fim: fim, p_limite: PAGINA, p_deslocamento: de });
    if (error) return new Response(`Não foi possível carregar os cliques: ${error.message}`, { status: 500 });
    const pagina = (data ?? []) as (CliqueLinha & { criado_em: string })[];
    linhas.push(...pagina.map((l) => ({ ...l, criado_em: l.criado_em })));
    if (pagina.length < PAGINA) break;
  }

  const corpo = linhas.slice(0, MAXIMO_LINHAS).map(linhaCsvClique);
  return new Response(montarCsv(CABECALHO_CLIQUES, corpo), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="cliques-${dataDoArquivo()}.csv"`,
      "cache-control": "no-store",
    },
  });
}
