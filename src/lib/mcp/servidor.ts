import "server-only";
import pacote from "@/package.json";
import { autenticarApi, type ChaveAutenticada } from "../api/auth";
import { registrarUso } from "../api/limite";
import { ERROS_API, erroApi } from "../api/respostas";
import { env } from "../env";
import { dbAdmin } from "../supabase/admin";
import { acharFerramenta, chamarFerramenta, listaDeFerramentas } from "./ferramentas";

/**
 * Servidor MCP do Vórtex Grupo (Etapa 3H2): transporte Streamable HTTP SEM estado (sem `Mcp-Session-Id`, sem SSE).
 * `POST /api/mcp` recebe uma mensagem JSON-RPC 2.0 (ou um lote, por compatibilidade) e responde JSON; só
 * notificações/respostas → 202 sem corpo. Autentica pela mesma chave da API v1 (`autenticarApi`); cada requisição
 * (inclusive cada uma de um lote, e `initialize`/`tools/list`/`ping`) conta no limite de 60 por minuto.
 */

export const VERSAO_PROTOCOLO = "2025-06-18";
export const VERSOES_SUPORTADAS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;

/** Corpo de até 256 KB (idêntico ao `POST /api/v1/acoes`). */
const MAXIMO_CORPO = 256 * 1024;

const ERRO = { parse: -32700, requisicaoInvalida: -32600, metodo: -32601, parametros: -32602, interno: -32603 } as const;

type Id = string | number | null;
type RespostaRpc = { jsonrpc: "2.0"; id: Id; result: unknown } | { jsonrpc: "2.0"; id: Id; error: { code: number; message: string } };

const SEM_CACHE = { "cache-control": "no-store" };

const resultado = (id: Id, result: unknown): RespostaRpc => ({ jsonrpc: "2.0", id, result });
const falha = (id: Id, code: number, message: string): RespostaRpc => ({ jsonrpc: "2.0", id, error: { code, message } });
const json = (corpo: unknown, status = 200, cabecalhos: Record<string, string> = {}) => Response.json(corpo, { status, headers: { ...SEM_CACHE, ...cabecalhos } });

const ehObjeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const ehIdValido = (v: unknown): v is string | number => typeof v === "string" || (typeof v === "number" && Number.isFinite(v));

/** Origem do próprio site. Navegador de outra origem (DNS rebinding) → 403; sem `Origin` (CLI, servidor) passa. */
function origemPermitida(req: Request): boolean {
  const origem = req.headers.get("origin");
  if (origem === null) return true;
  try {
    return origem === new URL(env("NEXT_PUBLIC_SITE_URL")).origin;
  } catch {
    return false;
  }
}

/** É uma requisição (tem `method` e `id`)? Notificação não tem `id`; resposta do cliente não tem `method`. */
const ehRequisicao = (m: unknown): m is Record<string, unknown> & { method: string } => ehObjeto(m) && typeof m.method === "string" && "id" in m;

/** Até 20 mensagens por lote (Streamable HTTP permite lote, mas sem limite isso é uma forma fácil de abusar do
 *  limite de 60 chamadas por minuto numa única requisição). */
const MAXIMO_LOTE = 20;

/** `tools/call` de uma ferramenta de envio (`enviar_mensagem`/`criar_acao`)? Usado pra limitar a 1 por lote. */
function ehChamadaDeEnvio(m: unknown): boolean {
  if (!ehObjeto(m) || m.method !== "tools/call" || !ehObjeto(m.params) || typeof m.params.name !== "string") return false;
  return acharFerramenta(m.params.name)?.envio === true;
}

/** `permitirEnvio=false`: é a 2ª (ou mais) chamada de ferramenta de envio do lote — vira `isError` sem executar
 *  (sem token da ferramenta gasto à toa, sem mandar duas mensagens de verdade pela mesma chamada ao servidor). */
async function tratarMensagem(m: unknown, chave: ChaveAutenticada, permitirEnvio = true): Promise<RespostaRpc | null> {
  if (!ehObjeto(m) || m.jsonrpc !== "2.0") return falha(ehObjeto(m) && ehIdValido(m.id) ? m.id : null, ERRO.requisicaoInvalida, "Requisição JSON-RPC inválida.");
  // Resposta do cliente (a um pedido nosso — não fazemos nenhum) ou notificação: aceita e não responde.
  if (typeof m.method !== "string") {
    if ("result" in m || "error" in m) return null;
    return falha(ehIdValido(m.id) ? m.id : null, ERRO.requisicaoInvalida, "Requisição JSON-RPC inválida.");
  }
  if (!("id" in m)) return null;
  if (!ehIdValido(m.id)) return falha(null, ERRO.requisicaoInvalida, "Requisição JSON-RPC inválida: id deve ser texto ou número.");
  const id = m.id;
  const params = m.params === undefined ? {} : m.params;
  if (!ehObjeto(params)) return falha(id, ERRO.parametros, "params deve ser um objeto.");

  switch (m.method) {
    case "initialize": {
      const pedida = params.protocolVersion;
      const versao = typeof pedida === "string" && (VERSOES_SUPORTADAS as readonly string[]).includes(pedida) ? pedida : VERSAO_PROTOCOLO;
      return resultado(id, {
        protocolVersion: versao,
        capabilities: { tools: {} },
        serverInfo: { name: "Vórtex Grupo", version: pacote.version },
        instructions:
          "Vórtex Grupo gerencia grupos de WhatsApp por campanha. As ferramentas listar_* e ver_campanha só leem. enviar_mensagem e criar_acao agem em grupos de WhatsApp REAIS: confirme com o usuário antes de usar. excluir_campanha apaga a campanha de vez (sem volta): confirme antes e prefira arquivar_campanha quando bastar tirar da lista.",
      });
    }
    case "ping":
      return resultado(id, {});
    case "tools/list":
      return resultado(id, { tools: listaDeFerramentas() });
    case "tools/call": {
      if (typeof params.name !== "string") return falha(id, ERRO.parametros, "Informe o nome da ferramenta (params.name).");
      const f = acharFerramenta(params.name);
      if (!f) return falha(id, ERRO.parametros, `Ferramenta desconhecida: ${params.name}`);
      if (f.envio && !permitirEnvio) return resultado(id, { content: [{ type: "text", text: "Só um envio por chamada." }], isError: true });
      const args = params.arguments === undefined ? {} : params.arguments;
      if (!ehObjeto(args)) return falha(id, ERRO.parametros, "arguments deve ser um objeto.");
      try {
        return resultado(id, await chamarFerramenta(f, chave, args));
      } catch {
        return resultado(id, { content: [{ type: "text", text: ERROS_API.interno }], isError: true });
      }
    }
    default:
      return falha(id, ERRO.metodo, `Método não encontrado: ${m.method}`);
  }
}

/** POST /api/mcp. Ordem: origem → chave (conta 1 chamada, sem WWW-Authenticate no 401: não é um navegador) →
 *  tamanho (content-length, depois bytes de verdade, igual à v1) → JSON → tamanho do lote → versão → +1 chamada
 *  por requisição extra do lote → mensagens em ordem (só 1 envio por lote). Nunca loga a chave nem o header
 *  Authorization. */
export async function tratarPostMcp(req: Request): Promise<Response> {
  if (!origemPermitida(req)) return json(falha(null, ERRO.requisicaoInvalida, "Origem não permitida."), 403);

  const a = await autenticarApi(req, "leitura", false);
  if (a instanceof Response) return a;

  const tamanhoAnunciado = Number(req.headers.get("content-length"));
  if (Number.isFinite(tamanhoAnunciado) && tamanhoAnunciado > MAXIMO_CORPO) return json(falha(null, ERRO.requisicaoInvalida, "Corpo grande demais."), 413);
  const texto = await req.text();
  if (new TextEncoder().encode(texto).length > MAXIMO_CORPO) return json(falha(null, ERRO.requisicaoInvalida, "Corpo grande demais."), 413);

  let corpo: unknown;
  try {
    corpo = JSON.parse(texto);
  } catch {
    return json(falha(null, ERRO.parse, "JSON inválido."), 400);
  }

  const lote = Array.isArray(corpo);
  const mensagens: unknown[] = lote ? (corpo as unknown[]) : [corpo];
  if (!mensagens.length) return json(falha(null, ERRO.requisicaoInvalida, "Lote vazio."), 400);
  if (mensagens.length > MAXIMO_LOTE) return json(falha(null, ERRO.requisicaoInvalida, `Lote grande demais (máximo ${MAXIMO_LOTE}).`), 400);

  // `MCP-Protocol-Version` (depois do initialize): versão desconhecida → 400. No initialize a versão vem nos params.
  const versaoHeader = req.headers.get("mcp-protocol-version");
  const temInitialize = mensagens.some((m) => ehObjeto(m) && m.method === "initialize");
  if (versaoHeader && !temInitialize && !(VERSOES_SUPORTADAS as readonly string[]).includes(versaoHeader))
    return json(falha(null, ERRO.requisicaoInvalida, `Versão do protocolo MCP não suportada: ${versaoHeader.slice(0, 40)}. Use ${VERSAO_PROTOCOLO}.`), 400);

  // A autenticação já contou 1 chamada; cada requisição a mais do lote conta mais uma.
  const requisicoes = mensagens.filter(ehRequisicao).length;
  if (requisicoes > 1) {
    const db = dbAdmin();
    for (let i = 1; i < requisicoes; i++) {
      const uso = await registrarUso(db, a.chave.id);
      if (uso === "indisponivel") return erroApi(503, ERROS_API.indisponivel);
      if (uso === "limite") return erroApi(429, ERROS_API.limite, { "retry-after": String(60 - new Date().getUTCSeconds()) });
    }
  }

  let enviosFeitos = 0;
  const respostas: RespostaRpc[] = [];
  for (const m of mensagens) {
    const ehEnvio = ehChamadaDeEnvio(m);
    const permitirEnvio = !ehEnvio || enviosFeitos === 0;
    if (ehEnvio && permitirEnvio) enviosFeitos++;
    const r = await tratarMensagem(m, a.chave, permitirEnvio);
    if (r) respostas.push(r);
  }
  if (!respostas.length) return new Response(null, { status: 202, headers: SEM_CACHE });
  return json(lote ? respostas : respostas[0]);
}

/** GET/DELETE: sem SSE nem sessão neste servidor. */
export function metodoNaoPermitido(): Response {
  return json(falha(null, ERRO.requisicaoInvalida, "Use POST: este servidor MCP não abre SSE nem guarda sessão."), 405, { allow: "POST" });
}
