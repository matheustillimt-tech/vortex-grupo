import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ehUuid } from "../regras/uuid";

/** Chaves da API v1 e do MCP (Etapa 3H2). Formato `vg_` + 40 caracteres base62. O banco guarda só o `prefixo`
 *  (8 primeiros caracteres depois de `vg_`) e o `hash` (SHA-256 hex da chave inteira); a chave em texto aparece
 *  uma vez, na criação. Nunca logar a chave. */

export const ESCOPOS_API = ["leitura", "envio"] as const;
export type EscopoApi = (typeof ESCOPOS_API)[number];
export const TIPOS_CHAVE = ["api", "mcp"] as const;
export type TipoChave = (typeof TIPOS_CHAVE)[number];

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const TAMANHO = 40;
export const FORMATO_CHAVE = /^vg_[0-9A-Za-z]{40}$/;

/** `vg_` + 40 caracteres base62, sem viés (rejeita bytes ≥ 248, o maior múltiplo de 62 abaixo de 256). */
export function gerarChave(): string {
  let saida = "";
  while (saida.length < TAMANHO) {
    for (const b of randomBytes(TAMANHO * 2)) {
      if (b >= 248) continue;
      saida += BASE62[b % 62];
      if (saida.length === TAMANHO) break;
    }
  }
  return `vg_${saida}`;
}

export function hashDaChave(chave: string): string {
  return createHash("sha256").update(chave, "utf8").digest("hex");
}

export function prefixoDaChave(chave: string): string {
  return chave.slice(3, 11);
}

export function ehEscopo(v: unknown): v is EscopoApi {
  return typeof v === "string" && (ESCOPOS_API as readonly string[]).includes(v);
}

export function ehTipoChave(v: unknown): v is TipoChave {
  return typeof v === "string" && (TIPOS_CHAVE as readonly string[]).includes(v);
}

type DB = Pick<SupabaseClient, "from">;

/** Cria a chave (service role). Quem chama confere que é Administrador. Devolve a chave em texto (mostrar UMA vez)
 *  e o id. Nome 1–60 (aparado). */
export async function criarChaveApi(
  db: DB,
  e: { nome: string; escopo: EscopoApi; tipo?: TipoChave; criadaPor: string | null; acessoDe?: string },
): Promise<{ chave: string; id: string } | { erro: string }> {
  const nome = typeof e.nome === "string" ? e.nome.trim() : "";
  if (nome.length < 1 || nome.length > 60) return { erro: "Nome da chave: de 1 a 60 caracteres." };
  if (!ehEscopo(e.escopo)) return { erro: "Escopo inválido." };
  const tipo = e.tipo ?? "api";
  if (!ehTipoChave(tipo)) return { erro: "Tipo de chave inválido." };
  const chave = gerarChave();
  // `acesso_de` só entra na chave filha de um acesso de atendente (Etapa 3K, Tarefa 7); as outras gravam como antes.
  const linha: Record<string, unknown> = { nome, escopo: e.escopo, tipo, prefixo: prefixoDaChave(chave), hash: hashDaChave(chave), criada_por: e.criadaPor };
  const { data, error } = await db
    .from("api_chaves")
    .insert(e.acessoDe ? { ...linha, acesso_de: e.acessoDe } : linha)
    .select("id")
    .single();
  if (error || !data) return { erro: "Não foi possível criar a chave." };
  return { chave, id: (data as { id: string }).id };
}

/** Revoga (marca `revogada_em`; não apaga, pra a lista mostrar). Quem chama confere que é Administrador.
 *  Também (Etapa 3K, Tarefa 7): apaga o convite, revoga as chaves filhas dos atendentes, recusa os pedidos
 *  aguardando e marca os aprovados como revogados. Se esse arremate falhar, a chave mãe já está revogada e o
 *  `autenticarApi` recusa filha de mãe revogada — o acesso cai do mesmo jeito. */
export async function revogarChaveApi(db: DB, id: string, decididoPor: string | null = null): Promise<{ ok: true } | { erro: string }> {
  if (!ehUuid(id)) return { erro: "Chave inválida." };
  const agora = new Date().toISOString();
  const { data, error } = await db
    .from("api_chaves")
    .update({ revogada_em: agora, convite_hash: null, convite_expira_em: null })
    .eq("id", id)
    .is("revogada_em", null)
    .select("id");
  if (error) return { erro: "Não foi possível revogar a chave." };
  if (!(data as unknown[] | null)?.length) return { erro: "Chave não encontrada ou já revogada." };
  await db.from("api_chaves").update({ revogada_em: agora }).eq("acesso_de", id).is("revogada_em", null);
  await db.from("api_acessos").update({ status: "recusado", decidido_por: decididoPor, decidido_em: agora }).eq("chave_id", id).eq("status", "aguardando");
  await db.from("api_acessos").update({ status: "revogado", decidido_por: decididoPor, decidido_em: agora }).eq("chave_id", id).eq("status", "aprovado");
  return { ok: true };
}
