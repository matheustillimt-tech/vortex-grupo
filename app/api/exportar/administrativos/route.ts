import { dataCsv, dataDoArquivo, montarCsv } from "@/src/lib/regras/csv";
import { ordenarAdministrativos, type AdministrativoLinha } from "@/src/lib/regras/administrativos";
import { permitido } from "@/src/lib/permissoes";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { telefoneLegivel } from "@/src/lib/telefone";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PAGINA = 1000;

/** EXPORTAR da aba Números administrativos (Etapa 3K, Tarefa 6): nome, telefone e data, em ordem Alfabética.
 *  `montarCsv` protege contra fórmula (célula que começa com = + - @ vira texto). Só pra quem está logado (401) e
 *  vê Anti-spam (403). */
export async function GET() {
  const db = await dbUsuario();
  const { data: sessao } = await db.auth.getUser();
  if (!sessao.user) return new Response("não autenticado", { status: 401 });
  if (!(await permitido("antispam", "ver"))) return new Response("sem permissão", { status: 403 });

  const todos: AdministrativoLinha[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await db.from("numeros_administrativos").select("telefone, nome, created_at").order("telefone").range(de, de + PAGINA - 1);
    if (error) return new Response(`Não foi possível gerar a planilha: ${error.message}`, { status: 500 });
    const pagina = (data ?? []) as AdministrativoLinha[];
    todos.push(...pagina);
    if (pagina.length < PAGINA) break;
  }
  const linhas = ordenarAdministrativos(todos, "alfabetica").map((a) => [a.nome ?? "", telefoneLegivel(a.telefone), dataCsv(a.created_at)]);
  return new Response(montarCsv(["Nome", "Telefone", "Criado em"], linhas), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="numeros-administrativos-${dataDoArquivo()}.csv"`,
      "cache-control": "no-store",
    },
  });
}
