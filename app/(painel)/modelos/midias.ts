"use server";
import { urlsDeMidia } from "@/src/lib/regras/modelos";
import { hostPrivadoOuLocal } from "@/src/lib/regras/webhooks";
import { checarPermissao } from "@/src/lib/permissoes";
import { dbUsuario } from "@/src/lib/supabase/usuario";

/** Teto de modelos "com mídia" checados numa chamada. */
const MAXIMO_MODELOS = 50;
/** Teto de modelos "mensagem" lidos do banco antes de filtrar os que têm mídia (a maioria pode não ter). */
const MAXIMO_LIDOS = 500;
/** Checagens HEAD em paralelo, no máximo. */
const PARALELISMO = 5;
/** Tempo limite de cada checagem HEAD/GET. */
const TEMPO_LIMITE_MS = 4000;
/** Orçamento total da checagem inteira: o que não for checado até aqui vira "não verificado" em vez de travar
 *  a tela esperando. */
const TEMPO_LIMITE_TOTAL_MS = 20_000;

export type ModeloMidiaExpirada = { id: string; nome: string };
export type ResultadoMidiasExpiradas =
  | { expiradas: ModeloMidiaExpirada[]; naoVerificadas: ModeloMidiaExpirada[] }
  | { erro: string };

/** Só https e host que não é local/privado — nunca vira sonda de SSRF: só checa o que já está salvo em
 *  `modelos.conteudo`, nunca um endereço vindo do chamador, e passa pelo mesmo filtro de `validarUrlWebhook`. */
function podeChecar(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.replace(/^\[/, "").replace(/\]$/, "");
  return !hostPrivadoOuLocal(host);
}

/** Uma tentativa (HEAD ou GET), com tempo limite e sem seguir redirecionamento (quem redireciona pra outro lugar
 *  também conta como "não respondeu" — a resposta usável é a primeira, direta). `null` = timeout ou qualquer
 *  outra falha de rede. */
async function statusDaTentativa(url: string, metodo: "HEAD" | "GET", tempoLimiteMs: number): Promise<number | null> {
  const controlador = new AbortController();
  const timeout = setTimeout(() => controlador.abort(), tempoLimiteMs);
  try {
    const r = await fetch(url, {
      method: metodo,
      redirect: "manual",
      signal: controlador.signal,
      ...(metodo === "GET" ? { headers: { Range: "bytes=0-0" } } : {}),
    });
    return r.status;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** HEAD com tempo limite curto. Quando o servidor responde 405 (método não permitido) ou 403 (bloqueou o HEAD
 *  por algum motivo, ex.: WAF), tenta de novo com GET + `Range: bytes=0-0` (busca só o primeiro byte, sem baixar
 *  a mídia inteira) antes de considerar expirada. Timeout e qualquer outra falha de rede = expirada. */
async function respondeOk(url: string, tempoDisponivelMs: number): Promise<boolean> {
  const tempoLimiteMs = Math.max(1, Math.min(TEMPO_LIMITE_MS, tempoDisponivelMs));
  let status = await statusDaTentativa(url, "HEAD", tempoLimiteMs);
  if (status === 405 || status === 403) {
    status = await statusDaTentativa(url, "GET", tempoLimiteMs);
  }
  return status !== null && status >= 200 && status < 300;
}

/** Roda `tarefa` em cada item da lista com no máximo `paralelismo` ao mesmo tempo. */
async function comParalelismoLimitado<T>(itens: T[], paralelismo: number, tarefa: (item: T) => Promise<void>): Promise<void> {
  let indice = 0;
  async function trabalhador() {
    while (indice < itens.length) {
      const atual = itens[indice];
      indice += 1;
      await tarefa(atual);
    }
  }
  await Promise.all(Array.from({ length: Math.min(paralelismo, itens.length) }, trabalhador));
}

/**
 * Modelos de mensagem com mídia cujo endereço não responde. Lê até
 * `MAXIMO_LIDOS` modelos ativos do tipo "mensagem", separa os que têm pelo menos um endereço de mídia checável
 * (https, host não local/privado) e checa até `MAXIMO_MODELOS` deles com HEAD (tempo limite curto, até
 * `PARALELISMO` checagens ao mesmo tempo). Expirada = qualquer resposta não 2xx ou que deu timeout.
 */
export async function verificarMidiasExpiradas(): Promise<ResultadoMidiasExpiradas> {
  const acesso = await checarPermissao("modelos", "ver");
  if (!acesso.ok) return { erro: acesso.erro };

  const db = await dbUsuario();
  const { data, error } = await db
    .from("modelos")
    .select("id, nome, conteudo")
    .eq("tipo", "mensagem")
    .eq("arquivado", false)
    .order("updated_at", { ascending: false })
    .limit(MAXIMO_LIDOS);
  if (error) return { erro: "Não foi possível carregar os modelos." };

  const comMidia: { id: string; nome: string; urls: string[] }[] = [];
  for (const m of (data ?? []) as { id: string; nome: string; conteudo: unknown }[]) {
    const urls = urlsDeMidia(m.conteudo).filter(podeChecar);
    if (!urls.length) continue;
    comMidia.push({ id: m.id, nome: m.nome, urls });
    if (comMidia.length >= MAXIMO_MODELOS) break;
  }

  const expiradas: ModeloMidiaExpirada[] = [];
  const naoVerificadas: ModeloMidiaExpirada[] = [];
  const prazoFinal = Date.now() + TEMPO_LIMITE_TOTAL_MS;
  await comParalelismoLimitado(comMidia, PARALELISMO, async (m) => {
    for (const url of m.urls) {
      const tempoDisponivelMs = prazoFinal - Date.now();
      if (tempoDisponivelMs <= 0) {
        naoVerificadas.push({ id: m.id, nome: m.nome });
        return;
      }
      const ok = await respondeOk(url, tempoDisponivelMs);
      if (!ok) {
        expiradas.push({ id: m.id, nome: m.nome });
        return;
      }
    }
  });
  expiradas.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  naoVerificadas.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  return { expiradas, naoVerificadas };
}
