import { autenticarApi } from "@/src/lib/api/auth";
import { criarAcaoApi, listarAcoesApi } from "@/src/lib/api/consultas";
import { erroApi, lerPagina, responderResultado } from "@/src/lib/api/respostas";
import { dbAdmin } from "@/src/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Corpo de até 256 KB (mensagens com várias partes cabem com folga). */
const MAXIMO_CORPO = 256 * 1024;

/** GET /api/v1/acoes?campanha=&aba=&pagina= — ações, 50 por página (escopo leitura). */
export async function GET(req: Request) {
  const a = await autenticarApi(req, "leitura");
  if (a instanceof Response) return a;
  const sp = new URL(req.url).searchParams;
  return responderResultado(await listarAcoesApi(dbAdmin(), { campanha: sp.get("campanha"), aba: sp.get("aba"), pagina: lerPagina(sp.get("pagina")) }));
}

/** POST /api/v1/acoes — cria uma ação por campanha, com a validação do assistente (escopo envio). Recusa o corpo
 *  grande demais ANTES de ler: primeiro pelo `content-length` (quando o cliente manda, evita gastar memória lendo
 *  um corpo enorme) e, por garantia (`content-length` ausente, errado ou corpo chunked), de novo pelo tamanho em
 *  bytes depois de ler — `.length` de uma string conta caracteres UTF-16, não bytes, então uma string com acentos
 *  passaria o limite em bytes sem que `.length` percebesse. */
export async function POST(req: Request) {
  const a = await autenticarApi(req, "envio");
  if (a instanceof Response) return a;
  const tamanhoAnunciado = Number(req.headers.get("content-length"));
  if (Number.isFinite(tamanhoAnunciado) && tamanhoAnunciado > MAXIMO_CORPO) return erroApi(413, "Corpo grande demais.");
  const texto = await req.text();
  if (new TextEncoder().encode(texto).length > MAXIMO_CORPO) return erroApi(413, "Corpo grande demais.");
  let corpo: unknown;
  try {
    corpo = JSON.parse(texto);
  } catch {
    return erroApi(400, "JSON inválido.");
  }
  return responderResultado(await criarAcaoApi(a.chave, corpo));
}
