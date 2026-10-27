import { autenticarApi } from "@/src/lib/api/auth";
import { verCampanhaApi } from "@/src/lib/api/consultas";
import { responderResultado } from "@/src/lib/api/respostas";
import { dbAdmin } from "@/src/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** GET /api/v1/campanhas/{id} — campanha + métricas dos últimos 7 dias (escopo leitura). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await autenticarApi(req, "leitura");
  if (a instanceof Response) return a;
  const { id } = await params;
  return responderResultado(await verCampanhaApi(dbAdmin(), id));
}
