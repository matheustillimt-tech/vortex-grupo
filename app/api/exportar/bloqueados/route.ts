import { CABECALHO_BLOQUEADOS, dataDoArquivo, linhaCsvBloqueado, montarCsv, type BloqueadoLinha } from "@/src/lib/regras/csv";
import { lerFiltrosBloqueados } from "@/src/lib/regras/filtros-bloqueados";
import { permitido } from "@/src/lib/permissoes";
import { dbUsuario } from "@/src/lib/supabase/usuario";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PAGINA = 1000;

/** Planilha com os mesmos filtros da tela Números bloqueados, lida em páginas de 1000 (sem o teto do PostgREST).
 *  Só pra quem está logado no painel (sem sessão → 401) e vê Anti-spam (sem "ver" → 403). */
export async function GET(req: Request) {
  const db = await dbUsuario();
  const { data: sessao } = await db.auth.getUser();
  if (!sessao.user) return new Response("não autenticado", { status: 401 });
  if (!(await permitido("antispam", "ver"))) return new Response("sem permissão", { status: 403 });

  const f = lerFiltrosBloqueados(Object.fromEntries(new URL(req.url).searchParams));
  const linhas: string[][] = [];
  for (let de = 0; ; de += PAGINA) {
    let consulta = db.from("bloqueados").select("telefone, motivo, origem, created_at");
    if (f.busca) consulta = consulta.ilike("telefone", `%${f.busca}%`);
    if (f.inicio) consulta = consulta.gte("created_at", `${f.inicio}T00:00:00-03:00`);
    if (f.fim) consulta = consulta.lte("created_at", `${f.fim}T23:59:59-03:00`);
    // created_at vem de inserções em lote (mesmo now() da transação): sem uma segunda coluna única, a
    // paginação por offset pode pular ou repetir linha com o mesmo timestamp entre páginas.
    consulta = consulta
      .order("created_at", { ascending: f.ordem === "antigos" })
      .order("telefone", { ascending: true })
      .range(de, de + PAGINA - 1);
    const { data, error } = await consulta;
    if (error) return new Response(`Não foi possível gerar a planilha: ${error.message}`, { status: 500 });
    const pagina = (data ?? []) as BloqueadoLinha[];
    linhas.push(...pagina.map(linhaCsvBloqueado));
    if (pagina.length < PAGINA) break;
  }
  return new Response(montarCsv(CABECALHO_BLOQUEADOS, linhas), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="bloqueados-${dataDoArquivo()}.csv"`,
      "cache-control": "no-store",
    },
  });
}
