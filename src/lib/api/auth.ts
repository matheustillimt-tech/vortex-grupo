import "server-only";
import { dbAdmin } from "../supabase/admin";
import { FORMATO_CHAVE, hashDaChave, type EscopoApi, type TipoChave } from "./chaves";
import { registrarUso } from "./limite";
import { ERROS_API, erroApi } from "./respostas";

export type ChaveAutenticada = { id: string; nome: string; escopo: EscopoApi; tipo: TipoChave };

/** Lê `Authorization: Bearer vg_…`. Nunca loga a chave nem o header. */
function chaveDoHeader(req: Request): string | null {
  const h = req.headers.get("authorization");
  if (!h) return null;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(h);
  if (!m || !FORMATO_CHAVE.test(m[1])) return null;
  return m[1];
}

/**
 * Autentica a chamada da API v1 / MCP pela chave: inexistente, revogada ou mal formada → 401 (sem detalhe);
 * acima de 60 chamadas no minuto → 429; escopo `envio` exigido de uma chave de `leitura` → 403. A chamada conta no
 * limite mesmo quando o escopo não basta. Devolve a chave (sem hash) ou a `Response` de erro pronta.
 *
 * `comWwwAuthenticate` (padrão `true`): a API v1 manda o cabeçalho `WWW-Authenticate: Bearer` no 401, como um
 * servidor HTTP comum. O servidor MCP (`servidor.ts`) chama com `false` — o cliente MCP não é um navegador
 * reagindo a esse cabeçalho, e mandá-lo ali só confundiria quem está depurando a conexão.
 */
export async function autenticarApi(
  req: Request,
  escopoNecessario: EscopoApi,
  comWwwAuthenticate = true,
): Promise<{ chave: ChaveAutenticada } | Response> {
  const cabecalho401: Record<string, string> = comWwwAuthenticate ? { "www-authenticate": "Bearer" } : {};
  const texto = chaveDoHeader(req);
  if (!texto) return erroApi(401, ERROS_API.naoAutenticado, cabecalho401);
  const db = dbAdmin();
  const { data, error } = await db.from("api_chaves").select("id, nome, escopo, tipo, revogada_em, acesso_de").eq("hash", hashDaChave(texto)).maybeSingle();
  if (error) return erroApi(503, ERROS_API.indisponivel);
  const linha = data as (ChaveAutenticada & { revogada_em: string | null; acesso_de?: string | null }) | null;
  if (!linha || linha.revogada_em) return erroApi(401, ERROS_API.naoAutenticado, cabecalho401);
  // Chave filha (acesso de atendente, Etapa 3K, Tarefa 7): só vale enquanto a chave mãe existe e não foi revogada.
  // Chave comum (`acesso_de` nulo) não faz essa segunda leitura: autentica igual a antes.
  if (linha.acesso_de) {
    const mae = await db.from("api_chaves").select("revogada_em").eq("id", linha.acesso_de).maybeSingle();
    if (mae.error) return erroApi(503, ERROS_API.indisponivel);
    const m = mae.data as { revogada_em: string | null } | null;
    if (!m || m.revogada_em) return erroApi(401, ERROS_API.naoAutenticado, cabecalho401);
  }

  const uso = await registrarUso(db, linha.id);
  if (uso === "indisponivel") return erroApi(503, ERROS_API.indisponivel);
  if (uso === "limite") return erroApi(429, ERROS_API.limite, { "retry-after": String(60 - new Date().getUTCSeconds()) });
  if (escopoNecessario === "envio" && linha.escopo !== "envio") return erroApi(403, ERROS_API.semEscopo);
  return { chave: { id: linha.id, nome: linha.nome, escopo: linha.escopo, tipo: linha.tipo } };
}
