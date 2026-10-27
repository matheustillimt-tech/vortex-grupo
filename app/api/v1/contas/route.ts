import { autenticarApi } from "@/src/lib/api/auth";
import { listarContasApi } from "@/src/lib/api/consultas";
import { responderResultado } from "@/src/lib/api/respostas";
import { dbAdmin } from "@/src/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** GET /api/v1/contas — contas com telefone mascarado (escopo leitura). */
export async function GET(req: Request) {
  const a = await autenticarApi(req, "leitura");
  if (a instanceof Response) return a;
  return responderResultado(await listarContasApi(dbAdmin()));
}
