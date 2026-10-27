import { CABECALHO_LEADSCORE, dataDoArquivo, linhaCsvLeadscore, montarCsv, type LeadscoreLinha } from "@/src/lib/regras/csv";
import { lerTipos, tiposParaParametro } from "@/src/lib/regras/leadscore";
import { ehUuid } from "@/src/lib/regras/uuid";
import { permitido } from "@/src/lib/permissoes";
import { dbUsuario } from "@/src/lib/supabase/usuario";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** "EXPORTAR" da aba Leadscoring: as pessoas da campanha com os pontos, com os mesmos chips e busca da tela.
 *  Uma chamada a `leadscore_exportar` (o banco soma e ordena), até 50.000 linhas. Exige ver Campanhas e
 *  ver Leads (a planilha tem telefones). */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const campanha = sp.get("campanha");
  if (!ehUuid(campanha)) return new Response("Campanha inválida.", { status: 400 });

  const db = await dbUsuario();
  const { data: sessao } = await db.auth.getUser();
  if (!sessao.user) return new Response("não autenticado", { status: 401 });
  if (!(await permitido("campanhas", "ver"))) return new Response("sem permissão", { status: 403 });
  if (!(await permitido("leads", "ver"))) return new Response("sem permissão", { status: 403 });

  const tipos = lerTipos(sp.get("tipos"));
  const busca = (sp.get("q") ?? "").trim().slice(0, 40) || null;
  // Uma chamada só (o ranking não muda entre páginas); o banco devolve um jsonb com até 50.000 pessoas.
  const { data, error } = await db.rpc("leadscore_exportar", { p_campanha: campanha, p_busca: busca, p_tipos: tiposParaParametro(tipos) ? tipos : null });
  if (error) return new Response(`Não foi possível carregar o leadscoring: ${error.message}`, { status: 500 });
  const linhas = (Array.isArray(data) ? (data as LeadscoreLinha[]) : []).map((l) => ({
    telefone: l.telefone, pontos: Number(l.pontos), recebeu: Number(l.recebeu), visualizou: Number(l.visualizou), reproduziu: Number(l.reproduziu),
  }));

  const corpo = linhas.map((l, i) => linhaCsvLeadscore(i + 1, l));
  return new Response(montarCsv(CABECALHO_LEADSCORE, corpo), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="leadscoring-${dataDoArquivo()}.csv"`,
      "cache-control": "no-store",
    },
  });
}
