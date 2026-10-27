import { CABECALHO_GRUPOS, dataDoArquivo, linhaCsvGrupo, montarCsv, type GrupoCsvLinha } from "@/src/lib/regras/csv";
import { ehUuid } from "@/src/lib/regras/uuid";
import { permitido } from "@/src/lib/permissoes";
import { dbUsuario } from "@/src/lib/supabase/usuario";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PAGINA = 1000;

/** Planilha dos grupos de uma campanha (número, nome, link, participantes, cheio, conta, criado em), lida em
 *  páginas de 1000 (sem o teto de linhas do PostgREST). Só pra quem está logado no painel (sem sessão → 401) e
 *  vê Campanhas (sem "ver" → 403). `?campanha=` obrigatório (uuid; sem um válido → 400). */
export async function GET(req: Request) {
  const db = await dbUsuario();
  const { data: sessao } = await db.auth.getUser();
  if (!sessao.user) return new Response("não autenticado", { status: 401 });
  if (!(await permitido("campanhas", "ver"))) return new Response("sem permissão", { status: 403 });

  const campanhaId = new URL(req.url).searchParams.get("campanha") ?? "";
  if (!ehUuid(campanhaId)) return new Response("Informe ?campanha= com um id válido.", { status: 400 });

  const linhas: string[][] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await db
      .from("grupos")
      .select("numero, nome, link_convite, participantes, cheio, created_at, conexoes(nome)")
      .eq("campanha_id", campanhaId)
      .order("numero")
      .range(de, de + PAGINA - 1);
    if (error) return new Response(`Não foi possível gerar a planilha: ${error.message}`, { status: 500 });
    const pagina = (data ?? []) as (Omit<GrupoCsvLinha, "conexao"> & { conexoes: unknown })[];
    linhas.push(...pagina.map((g) => linhaCsvGrupo({ ...g, conexao: (g.conexoes as { nome: string } | null)?.nome ?? "" })));
    if (pagina.length < PAGINA) break;
  }
  return new Response(montarCsv(CABECALHO_GRUPOS, linhas), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="grupos-${dataDoArquivo()}.csv"`,
      "cache-control": "no-store",
    },
  });
}
