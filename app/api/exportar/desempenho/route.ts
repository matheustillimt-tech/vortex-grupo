import { CABECALHO_DESEMPENHO, dataDoArquivo, linhaCsvDesempenho, montarCsv, type DesempenhoLinha } from "@/src/lib/regras/csv";
import { lerCriterio } from "@/src/lib/regras/leadscore";
import { ehUuid } from "@/src/lib/regras/uuid";
import { permitido } from "@/src/lib/permissoes";
import { dbUsuario } from "@/src/lib/supabase/usuario";

export const dynamic = "force-dynamic";

/** "EXPORTAR" da aba Desempenho por grupo: todos os grupos da campanha (até 1000, o teto da RPC) no critério,
 *  disparo e busca da tela, do melhor pro pior. Exige ver Campanhas e ver Leads. */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const campanha = sp.get("campanha");
  if (!ehUuid(campanha)) return new Response("Campanha inválida.", { status: 400 });
  const execucao = sp.get("execucao");

  const db = await dbUsuario();
  const { data: sessao } = await db.auth.getUser();
  if (!sessao.user) return new Response("não autenticado", { status: 401 });
  if (!(await permitido("campanhas", "ver"))) return new Response("sem permissão", { status: 403 });
  if (!(await permitido("leads", "ver"))) return new Response("sem permissão", { status: 403 });

  const { data, error } = await db.rpc("desempenho_grupos", {
    p_campanha: campanha,
    p_criterio: lerCriterio(sp.get("criterio")),
    p_execucao: ehUuid(execucao) ? execucao : null,
    p_limite: 1000,
    p_busca: (sp.get("q") ?? "").trim().slice(0, 60) || null,
  });
  if (error) return new Response(`Não foi possível carregar o desempenho: ${error.message}`, { status: 500 });

  const corpo = ((data ?? []) as DesempenhoLinha[]).map((g, i) =>
    linhaCsvDesempenho(i + 1, {
      numero: Number(g.numero), nome: g.nome, participantes: Number(g.participantes), recebeu: Number(g.recebeu), visualizou: Number(g.visualizou),
      reproduziu: Number(g.reproduziu), pontos: Number(g.pontos), pontuacao: Number(g.pontuacao),
    }),
  );
  return new Response(montarCsv(CABECALHO_DESEMPENHO, corpo), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="desempenho-grupos-${dataDoArquivo()}.csv"`,
      "cache-control": "no-store",
    },
  });
}
