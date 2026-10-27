"use server";
import { revalidatePath } from "next/cache";
import {
  contarTentativa,
  criarConvite,
  decidirAcesso,
  emitirChaveDoAcesso,
  MSG_ACESSO,
  solicitarAcessoPorConvite,
  type Decisao,
} from "@/src/lib/api/acessos";
import { registrarHistorico } from "@/src/lib/historico";
import { checarPermissao, SEM_PERMISSAO, type Acesso } from "@/src/lib/permissoes";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { SITE_URL_PADRAO } from "./comum";

/** Ações dos "Acessos de atendentes" da API (Etapa 3K, Tarefa 7). Gerar convite, aprovar, recusar e revogar:
 *  só `membro.papel === "admin"`, conferido aqui no servidor. Pedir acesso e ver a própria chave: membro com
 *  Webhooks/ver (a área da API), só sobre o que é dele. Nunca loga token nem chave (nem no histórico). */

function revalidar() {
  revalidatePath("/api-externa");
  revalidatePath("/api-externa/acesso");
}

/** Administrador: "equipe"/"editar" só passa pra `papel === "admin"`; a conferência explícita do papel fica junto. */
type Usuario = Acesso["usuario"];

function ehAdmin(acesso: Awaited<ReturnType<typeof checarPermissao>>) {
  return acesso.ok && acesso.membro?.papel === "admin" ? acesso : null;
}

/** "Compartilhar acesso" no cartão da chave: devolve o link UMA vez (gerar de novo invalida o anterior). */
export async function gerarConviteChave(id: string): Promise<{ erro?: string; link?: string; expiraEm?: string }> {
  const acesso = await checarPermissao("equipe", "editar");
  const a = ehAdmin(acesso);
  if (!a) return { erro: SEM_PERMISSAO };
  const r = await criarConvite(dbAdmin(), id);
  if ("erro" in r) return r;
  const site = process.env.NEXT_PUBLIC_SITE_URL || SITE_URL_PADRAO;
  revalidar();
  await registrarHistorico(a.usuario, { acao: "atualizar", area: "Integrações", resumo: `Link de acesso de atendente gerado para a chave "${r.nome}"`, refId: id });
  return { link: `${site}/api-externa/acesso/${r.token}`, expiraEm: r.expiraEm };
}

/** "Solicitar acesso" na página do link. Conta no limite de tentativas por hora. */
export async function solicitarAcesso(token: string, motivo: string): Promise<{ erro?: string }> {
  const a = await checarPermissao("webhooks", "ver");
  if (!a.ok) return { erro: a.erro };
  const db = dbAdmin();
  const t = await contarTentativa(db, a.usuario.id);
  if (t === "limite") return { erro: MSG_ACESSO.muitasTentativas };
  if (t === "indisponivel") return { erro: MSG_ACESSO.indisponivel };
  const r = await solicitarAcessoPorConvite(db, { token, solicitante: a.usuario.id, motivo });
  if ("erro" in r) return r;
  revalidar();
  await registrarHistorico(a.usuario, { acao: "adicionar", area: "Integrações", resumo: `Pedido de acesso à chave "${r.chaveNome}"`, refId: r.id });
  return {};
}

const TEXTO_DECISAO: Record<Decisao, string> = { aprovar: "aprovado", recusar: "recusado", revogar: "revogado" };

/** Quem chama já conferiu que é Administrador (`ehAdmin`). */
async function decidir(usuario: Usuario, id: string, decisao: Decisao): Promise<{ erro?: string }> {
  const r = await decidirAcesso(dbAdmin(), { id, decisao, decididoPor: usuario.id });
  if ("erro" in r) return r;
  revalidar();
  await registrarHistorico(usuario, {
    acao: decisao === "aprovar" ? "atualizar" : "remover",
    area: "Integrações",
    resumo: `Acesso de atendente à chave "${r.chaveNome}" ${TEXTO_DECISAO[decisao]}`,
    refId: id,
  });
  return {};
}

export async function aprovarAcesso(id: string): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("equipe", "editar");
  const a = ehAdmin(acesso);
  if (!a) return { erro: SEM_PERMISSAO };
  return decidir(a.usuario, id, "aprovar");
}

export async function recusarAcesso(id: string): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("equipe", "editar");
  const a = ehAdmin(acesso);
  if (!a) return { erro: SEM_PERMISSAO };
  return decidir(a.usuario, id, "recusar");
}

export async function revogarAcesso(id: string): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("equipe", "editar");
  const a = ehAdmin(acesso);
  if (!a) return { erro: SEM_PERMISSAO };
  return decidir(a.usuario, id, "revogar");
}

/** "VER CHAVE" / "Gerar de novo" em "Meus acessos": só o próprio atendente; a chave volta UMA vez. */
export async function verChaveAcesso(id: string): Promise<{ erro?: string; chave?: string }> {
  const a = await checarPermissao("webhooks", "ver");
  if (!a.ok) return { erro: a.erro };
  const r = await emitirChaveDoAcesso(dbAdmin(), { id, solicitante: a.usuario.id });
  if ("erro" in r) return r;
  revalidar();
  await registrarHistorico(a.usuario, {
    acao: "adicionar",
    area: "Integrações",
    resumo: r.regenerada ? "Chave de atendente gerada de novo (a anterior foi revogada)" : "Chave de atendente gerada",
    refId: id,
  });
  return { chave: r.chave };
}
