import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ehUuid } from "../regras/uuid";
import { criarChaveApi, type EscopoApi, type TipoChave } from "./chaves";

/**
 * "Acessos de atendentes" da API (Etapa 3K, Tarefa 7).
 *
 * 1. O Administrador gera um convite pra uma chave: token de 32 bytes aleatórios (256 bits, base64url). O banco
 *    guarda só o SHA-256 dele e a validade (7 dias); o link aparece uma vez. Gerar de novo troca o hash.
 * 2. Um membro logado abre o link e pede acesso: o pedido guarda só quem pediu (o próprio usuário) e o motivo.
 *    Usar o link apaga o hash (uso único). Nada utilizável nasce aqui.
 * 3. O Administrador aprova ou recusa (e depois pode revogar).
 * 4. Entrega da chave: só o próprio atendente, logado, em "Meus acessos", clicando "VER CHAVE". A chave filha nasce
 *    nesse clique, aparece uma vez e fica só como hash. O Administrador nunca vê a chave do atendente; clicar de
 *    novo ("Gerar de novo") revoga a anterior.
 *
 * Nunca logar token nem chave.
 */

type DB = Pick<SupabaseClient, "from" | "rpc">;

export const VALIDADE_CONVITE_DIAS = 7;
/** Tentativas por usuário e por hora na página do convite (abrir o link + pedir acesso). */
export const LIMITE_TENTATIVAS_HORA = 20;
/** 32 bytes em base64url sem preenchimento = 43 caracteres. */
export const FORMATO_TOKEN = /^[A-Za-z0-9_-]{43}$/;
export const MOTIVO_MAX = 280;

export const MSG_ACESSO = {
  linkInvalido: "Link inválido ou expirado.",
  chaveRevogada: "Esta chave foi revogada.",
  muitasTentativas: "Muitas tentativas. Tente de novo daqui a uma hora.",
  indisponivel: "Não foi possível conferir o link agora. Tente de novo.",
  duplicado: "Você já tem um pedido para esta chave (aguardando aprovação ou aprovado).",
  motivoLongo: `Motivo: até ${MOTIVO_MAX} caracteres.`,
  naoEncontrado: "Pedido não encontrado.",
  jaDecidido: "Este pedido já foi decidido.",
  naoAprovado: "Este acesso não está aprovado.",
  naoCompartilhavel: "Chave não encontrada, revogada ou que não pode ser compartilhada.",
} as const;

export type StatusAcesso = "aguardando" | "aprovado" | "recusado" | "revogado";

export function gerarTokenConvite(): string {
  return randomBytes(32).toString("base64url");
}

export function hashDoToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Gera (ou troca) o convite de uma chave da API. Quem chama confere que é Administrador. Só chave de tipo
 *  "api", não revogada e que não é filha. Devolve o token em texto (montar o link e mostrar UMA vez). */
export async function criarConvite(db: DB, chaveId: string, agora = new Date()): Promise<{ token: string; expiraEm: string; nome: string } | { erro: string }> {
  if (!ehUuid(chaveId)) return { erro: MSG_ACESSO.naoCompartilhavel };
  const token = gerarTokenConvite();
  const expiraEm = new Date(agora.getTime() + VALIDADE_CONVITE_DIAS * 86_400_000).toISOString();
  const { data, error } = await db
    .from("api_chaves")
    .update({ convite_hash: hashDoToken(token), convite_expira_em: expiraEm })
    .eq("id", chaveId)
    .eq("tipo", "api")
    .is("revogada_em", null)
    .is("acesso_de", null)
    .select("id, nome");
  if (error) return { erro: "Não foi possível gerar o link. Tente de novo." };
  const linha = (data as { id: string; nome: string }[] | null)?.[0];
  if (!linha) return { erro: MSG_ACESSO.naoCompartilhavel };
  return { token, expiraEm, nome: linha.nome };
}

/** Conta uma tentativa do usuário na hora; acima do limite → "limite"; erro do banco → "indisponivel" (fecha). */
export async function contarTentativa(db: DB, usuarioId: string): Promise<"ok" | "limite" | "indisponivel"> {
  const { data, error } = await db.rpc("api_acesso_tentativa", { p_usuario: usuarioId });
  if (error) return "indisponivel";
  return Number(data) > LIMITE_TENTATIVAS_HORA ? "limite" : "ok";
}

export type ConviteValido = { id: string; nome: string; escopo: EscopoApi; hash: string; expiraEm: string };

/** Lê o convite pelo token. Token mal formado, inexistente, já usado ou vencido: a mesma mensagem (não diz qual). */
export async function lerConvite(db: DB, token: unknown, agora = new Date()): Promise<{ convite: ConviteValido } | { erro: string }> {
  if (typeof token !== "string" || !FORMATO_TOKEN.test(token)) return { erro: MSG_ACESSO.linkInvalido };
  const hash = hashDoToken(token);
  const { data, error } = await db.from("api_chaves").select("id, nome, escopo, revogada_em, convite_expira_em").eq("convite_hash", hash).maybeSingle();
  if (error) return { erro: MSG_ACESSO.indisponivel };
  const c = data as { id: string; nome: string; escopo: EscopoApi; revogada_em: string | null; convite_expira_em: string | null } | null;
  if (!c || !c.convite_expira_em || new Date(c.convite_expira_em).getTime() <= agora.getTime()) return { erro: MSG_ACESSO.linkInvalido };
  if (c.revogada_em) return { erro: MSG_ACESSO.chaveRevogada };
  return { convite: { id: c.id, nome: c.nome, escopo: c.escopo, hash, expiraEm: c.convite_expira_em } };
}

export function normalizarMotivo(motivo: unknown): { motivo: string | null } | { erro: string } {
  if (motivo == null) return { motivo: null };
  if (typeof motivo !== "string") return { erro: MSG_ACESSO.motivoLongo };
  const m = motivo.trim();
  if (m.length > MOTIVO_MAX) return { erro: MSG_ACESSO.motivoLongo };
  return { motivo: m || null };
}

/** Pedido do atendente pelo link. Quem chama confere que é membro logado e conta a tentativa. */
export async function solicitarAcessoPorConvite(
  db: DB,
  e: { token: unknown; solicitante: string; motivo: unknown },
  agora = new Date(),
): Promise<{ id: string; chaveId: string; chaveNome: string } | { erro: string }> {
  const m = normalizarMotivo(e.motivo);
  if ("erro" in m) return m;
  const lido = await lerConvite(db, e.token, agora);
  if ("erro" in lido) return lido;
  const { convite } = lido;

  const vivo = await db.from("api_acessos").select("id").eq("chave_id", convite.id).eq("solicitante", e.solicitante).in("status", ["aguardando", "aprovado"]);
  if (vivo.error) return { erro: MSG_ACESSO.indisponivel };
  if ((vivo.data as unknown[] | null)?.length) return { erro: MSG_ACESSO.duplicado };

  // Uso único: apaga o hash só se ainda for o mesmo (dois pedidos ao mesmo tempo com o mesmo link: um só passa).
  const usar = await db
    .from("api_chaves")
    .update({ convite_hash: null, convite_expira_em: null })
    .eq("id", convite.id)
    .eq("convite_hash", convite.hash)
    .is("revogada_em", null)
    .select("id");
  if (usar.error) return { erro: MSG_ACESSO.indisponivel };
  if (!(usar.data as unknown[] | null)?.length) return { erro: MSG_ACESSO.linkInvalido };

  const ins = await db.from("api_acessos").insert({ chave_id: convite.id, solicitante: e.solicitante, motivo: m.motivo, status: "aguardando" }).select("id").single();
  if (ins.error || !ins.data) {
    // Devolve o link (se ninguém gerou outro nesse meio-tempo), pra o convite não se perder por um erro nosso.
    await db.from("api_chaves").update({ convite_hash: convite.hash, convite_expira_em: convite.expiraEm }).eq("id", convite.id).is("convite_hash", null).is("revogada_em", null);
    if (ins.error?.code === "23505") return { erro: MSG_ACESSO.duplicado };
    return { erro: "Não foi possível enviar o pedido. Tente de novo." };
  }
  return { id: (ins.data as { id: string }).id, chaveId: convite.id, chaveNome: convite.nome };
}

export type Decisao = "aprovar" | "recusar" | "revogar";

const DE_PARA: Record<Decisao, { de: StatusAcesso; para: StatusAcesso }> = {
  aprovar: { de: "aguardando", para: "aprovado" },
  recusar: { de: "aguardando", para: "recusado" },
  revogar: { de: "aprovado", para: "revogado" },
};

/** Aprovar/recusar (pedido aguardando) e revogar (aprovado). Quem chama confere que é Administrador
 *  (`membro.papel === "admin"`). Revogar também revoga as chaves filhas desse atendente nessa chave. */
export async function decidirAcesso(
  db: DB,
  e: { id: string; decisao: Decisao; decididoPor: string },
  agora = new Date(),
): Promise<{ ok: true; chaveId: string; chaveNome: string } | { erro: string }> {
  if (!ehUuid(e.id)) return { erro: MSG_ACESSO.naoEncontrado };
  const regra = DE_PARA[e.decisao];
  if (!regra) return { erro: "Decisão inválida." };
  const lido = await db.from("api_acessos").select("id, status, chave_id, solicitante, chave_emitida_id").eq("id", e.id).maybeSingle();
  if (lido.error) return { erro: "Não foi possível carregar o pedido." };
  const a = lido.data as { id: string; status: StatusAcesso; chave_id: string; solicitante: string; chave_emitida_id?: string | null } | null;
  if (!a) return { erro: MSG_ACESSO.naoEncontrado };
  if (a.status !== regra.de) return { erro: MSG_ACESSO.jaDecidido };
  const chave = await db.from("api_chaves").select("nome, revogada_em").eq("id", a.chave_id).maybeSingle();
  if (chave.error) return { erro: "Não foi possível carregar a chave." };
  const c = chave.data as { nome: string; revogada_em: string | null } | null;
  if (!c) return { erro: MSG_ACESSO.naoEncontrado };
  if (e.decisao === "aprovar" && c.revogada_em) return { erro: MSG_ACESSO.chaveRevogada };

  const iso = agora.toISOString();
  const up = await db
    .from("api_acessos")
    .update({ status: regra.para, decidido_por: e.decididoPor, decidido_em: iso })
    .eq("id", a.id)
    .eq("status", regra.de)
    .select("id");
  if (up.error) return { erro: "Não foi possível salvar a decisão." };
  if (!(up.data as unknown[] | null)?.length) return { erro: MSG_ACESSO.jaDecidido };

  if (e.decisao === "revogar") {
    const rev = await db.from("api_chaves").update({ revogada_em: iso }).eq("acesso_de", a.chave_id).eq("criada_por", a.solicitante).is("revogada_em", null);
    // A chave emitida por esse pedido também, pelo id (mesmo que `criada_por` tenha virado null).
    const emitida = a.chave_emitida_id
      ? await db.from("api_chaves").update({ revogada_em: iso }).eq("id", a.chave_emitida_id).is("revogada_em", null)
      : { error: null };
    if (rev.error || emitida.error) return { erro: "Acesso marcado como revogado, mas não foi possível revogar a chave do atendente. Tente de novo ou revogue a chave mãe." };
  }
  return { ok: true, chaveId: a.chave_id, chaveNome: c.nome };
}

/** "VER CHAVE" / "Gerar de novo" em "Meus acessos": só o próprio atendente, com o pedido aprovado e a chave mãe
 *  ativa. Cria a chave filha (mesmo escopo e tipo da mãe, `criada_por` = atendente), devolve a chave em texto UMA
 *  vez e revoga a anterior. */
export async function emitirChaveDoAcesso(
  db: DB,
  e: { id: string; solicitante: string },
  agora = new Date(),
): Promise<{ chave: string; id: string; regenerada: boolean } | { erro: string }> {
  if (!ehUuid(e.id)) return { erro: MSG_ACESSO.naoEncontrado };
  const lido = await db.from("api_acessos").select("id, status, chave_id, solicitante, chave_emitida_id").eq("id", e.id).maybeSingle();
  if (lido.error) return { erro: "Não foi possível carregar o pedido." };
  const a = lido.data as { id: string; status: StatusAcesso; chave_id: string; solicitante: string; chave_emitida_id: string | null } | null;
  // Pedido de outra pessoa: a mesma resposta de inexistente.
  if (!a || a.solicitante !== e.solicitante) return { erro: MSG_ACESSO.naoEncontrado };
  if (a.status !== "aprovado") return { erro: MSG_ACESSO.naoAprovado };
  const mae = await db.from("api_chaves").select("nome, escopo, tipo, revogada_em").eq("id", a.chave_id).maybeSingle();
  if (mae.error) return { erro: "Não foi possível carregar a chave." };
  const m = mae.data as { nome: string; escopo: EscopoApi; tipo: TipoChave; revogada_em: string | null } | null;
  if (!m) return { erro: MSG_ACESSO.naoEncontrado };
  if (m.revogada_em) return { erro: MSG_ACESSO.chaveRevogada };

  const iso = agora.toISOString();
  // Antes de criar: revoga as anteriores desse atendente nessa chave (uma só fica valendo). Se isso falhar, não cria.
  const antigas = await db.from("api_chaves").update({ revogada_em: iso }).eq("acesso_de", a.chave_id).eq("criada_por", e.solicitante).is("revogada_em", null);
  if (antigas.error) return { erro: "Não foi possível gerar a chave. Tente de novo." };

  const nova = await criarChaveApi(db, { nome: m.nome, escopo: m.escopo, tipo: m.tipo, criadaPor: e.solicitante, acessoDe: a.chave_id });
  if ("erro" in nova) return { erro: "Não foi possível gerar a chave. Tente de novo." };

  // Só grava se o pedido ainda estiver aprovado e ninguém tiver gerado outra nesse meio-tempo; senão revoga a nova.
  const marca = db.from("api_acessos").update({ chave_emitida_id: nova.id }).eq("id", a.id).eq("status", "aprovado");
  const up = await (a.chave_emitida_id ? marca.eq("chave_emitida_id", a.chave_emitida_id) : marca.is("chave_emitida_id", null)).select("id");
  if (up.error || !(up.data as unknown[] | null)?.length) {
    await db.from("api_chaves").update({ revogada_em: iso }).eq("id", nova.id);
    return { erro: "Não foi possível gerar a chave. Tente de novo." };
  }
  return { chave: nova.chave, id: nova.id, regenerada: Boolean(a.chave_emitida_id) };
}
