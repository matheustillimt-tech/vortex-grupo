import { dataCsv, dataDoArquivo, montarCsv } from "@/src/lib/regras/csv";
import { ehUuid } from "@/src/lib/regras/uuid";
import { permitido } from "@/src/lib/permissoes";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { telefoneLegivel } from "@/src/lib/telefone";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PAGINA = 1000;

/** Planilha dos números de uma blacklist, lida em páginas de 1000. Só pra quem está logado (sem sessão → 401) e
 *  vê Anti-spam (sem "ver" → 403). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const db = await dbUsuario();
  const { data: sessao } = await db.auth.getUser();
  if (!sessao.user) return new Response("não autenticado", { status: 401 });
  if (!(await permitido("antispam", "ver"))) return new Response("sem permissão", { status: 403 });
  const { id } = await params;
  if (!ehUuid(id)) return new Response("blacklist inválida", { status: 404 });

  const { data: lista, error: erroLista } = await db.from("blacklists").select("nome").eq("id", id).maybeSingle();
  if (erroLista) return new Response(`Não foi possível gerar a planilha: ${erroLista.message}`, { status: 500 });
  if (!lista) return new Response("blacklist não encontrada", { status: 404 });

  const linhas: string[][] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await db
      .from("blacklist_numeros")
      .select("telefone, created_at")
      .eq("blacklist_id", id)
      .order("telefone", { ascending: true })
      .range(de, de + PAGINA - 1);
    if (error) return new Response(`Não foi possível gerar a planilha: ${error.message}`, { status: 500 });
    const pagina = (data ?? []) as { telefone: string; created_at: string }[];
    linhas.push(...pagina.map((n) => [telefoneLegivel(n.telefone), dataCsv(n.created_at)]));
    if (pagina.length < PAGINA) break;
  }
  return new Response(montarCsv(["Telefone", "Adicionado em"], linhas), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="blacklist-${dataDoArquivo()}.csv"`,
      "cache-control": "no-store",
    },
  });
}
