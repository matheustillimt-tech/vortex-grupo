import { CABECALHO_LEADS, dataDoArquivo, linhaCsvLead, montarCsv } from "@/src/lib/regras/csv";
import { filtrosVisaoGeralParaRpc, lerFiltrosVisaoGeral } from "@/src/lib/regras/filtros-leads";
import type { LeadLinha } from "@/src/lib/regras/leads";
import { permitido } from "@/src/lib/permissoes";
import { dbUsuario } from "@/src/lib/supabase/usuario";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PAGINA = 1000;

/** Planilha "Leads" da Visão geral (cadastro): Nome, Número, Campos personalizados, Tags — uma linha por pessoa,
 *  com os mesmos filtros da tela (busca, tag). Só pra quem está logado no painel (sem sessão → 401) e vê Leads
 *  (sem "ver" → 403). Lida em páginas de 1000 (sem o teto de linhas do PostgREST), como a exportação de
 *  Participações (`/api/exportar/pessoas`). */
export async function GET(req: Request) {
  const db = await dbUsuario();
  const { data: sessao } = await db.auth.getUser();
  if (!sessao.user) return new Response("não autenticado", { status: 401 });
  if (!(await permitido("leads", "ver"))) return new Response("sem permissão", { status: 403 });

  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const args = filtrosVisaoGeralParaRpc(lerFiltrosVisaoGeral(sp));

  const linhas: LeadLinha[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await db.rpc("listar_leads", { ...args, p_limite: PAGINA, p_deslocamento: de });
    if (error) return new Response(`Não foi possível gerar a planilha: ${error.message}`, { status: 500 });
    const pagina = (data ?? []) as LeadLinha[];
    linhas.push(...pagina);
    if (pagina.length < PAGINA) break;
  }

  return new Response(montarCsv(CABECALHO_LEADS, linhas.map(linhaCsvLead)), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="leads-${dataDoArquivo()}.csv"`,
      "cache-control": "no-store",
    },
  });
}
