import { autenticarApi } from "@/src/lib/api/auth";
import { listarGruposApi } from "@/src/lib/api/consultas";
import { lerPagina, responderResultado } from "@/src/lib/api/respostas";
import { dbAdmin } from "@/src/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** GET /api/v1/campanhas/{id}/grupos?pagina= — grupos ativos, 50 por página (escopo leitura). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await autenticarApi(req, "leitura");
  if (a instanceof Response) return a;
  const { id } = await params;
  const pagina = lerPagina(new URL(req.url).searchParams.get("pagina"));
  return responderResultado(await listarGruposApi(dbAdmin(), id, pagina));
}
