import { inicioDoPeriodo, lerPeriodo, resumoDaLinha, type Resumo } from "@/src/lib/regras/campanhas";
import { CABECALHO_FUNIL, dataDoArquivo, linhaCsvFunil, montarCsv } from "@/src/lib/regras/csv";
import { ehUuid } from "@/src/lib/regras/uuid";
import { permitido } from "@/src/lib/permissoes";
import { dbUsuario } from "@/src/lib/supabase/usuario";

export const dynamic = "force-dynamic";

const RESUMO_ZERO: Resumo = { cliques: 0, entradas: 0, saidas: 0, participantes: 0, admins: 0, grupos: 0, gruposCheios: 0 };

/** "Exportar CSV" do "Funil de campanhas" em Métricas: uma linha por campanha ativa (do projeto escolhido no
 *  select, quando há um) com o resumo do período selecionado ali — mesma consulta da tela (`resumo_campanhas`).
 *  Exige "ver" em Métricas. */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const dias = lerPeriodo(sp.get("dias") ?? undefined);
  const projeto = sp.get("projeto");

  const db = await dbUsuario();
  const { data: sessao } = await db.auth.getUser();
  if (!sessao.user) return new Response("não autenticado", { status: 401 });
  if (!(await permitido("metricas", "ver"))) return new Response("sem permissão", { status: 403 });

  let consultaCampanhas = db.from("campanhas").select("id, nome, projeto_id").eq("arquivada", false);
  if (ehUuid(projeto)) consultaCampanhas = consultaCampanhas.eq("projeto_id", projeto);

  const [{ data: campanhas, error: erroCampanhas }, { data: linhasResumo, error: erroResumo }] = await Promise.all([
    consultaCampanhas.order("nome"),
    db.rpc("resumo_campanhas", { p_desde: inicioDoPeriodo(dias) }),
  ]);
  if (erroCampanhas) {
    console.error("[exportar/funil] campanhas", erroCampanhas);
    return new Response("Não foi possível gerar o arquivo.", { status: 500 });
  }
  if (erroResumo) {
    console.error("[exportar/funil] resumo_campanhas", erroResumo);
    return new Response("Não foi possível gerar o arquivo.", { status: 500 });
  }

  const resumoPorId = new Map<string, Resumo>();
  for (const l of (linhasResumo ?? []) as Record<string, unknown>[]) {
    const { campanhaId, ...r } = resumoDaLinha(l);
    resumoPorId.set(campanhaId, r);
  }

  const corpo = ((campanhas ?? []) as { id: string; nome: string }[]).map((c) => linhaCsvFunil({ nome: c.nome, ...(resumoPorId.get(c.id) ?? RESUMO_ZERO) }));

  return new Response(montarCsv(CABECALHO_FUNIL, corpo), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="funil-campanhas-${dataDoArquivo()}.csv"`,
      "cache-control": "no-store",
    },
  });
}
