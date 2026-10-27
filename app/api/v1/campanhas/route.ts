import { autenticarApi } from "@/src/lib/api/auth";
import { listarCampanhasApi } from "@/src/lib/api/consultas";
import { responderResultado } from "@/src/lib/api/respostas";
import { dbAdmin } from "@/src/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** GET /api/v1/campanhas — campanhas ativas (escopo leitura). */
export async function GET(req: Request) {
  const a = await autenticarApi(req, "leitura");
  if (a instanceof Response) return a;
  return responderResultado(await listarCampanhasApi(dbAdmin()));
}
