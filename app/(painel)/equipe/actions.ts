"use server";
import { revalidatePath } from "next/cache";
import { senhaAleatoria } from "@/src/lib/crypto";
import { checarPermissao } from "@/src/lib/permissoes";
import { registrarHistorico } from "@/src/lib/historico";
import { normalizarPermissoes, verificarMudancaPapel, verificarRemocao, type Papel } from "@/src/lib/regras/permissoes";
import { ehUuid } from "@/src/lib/regras/uuid";
import { dbAdmin } from "@/src/lib/supabase/admin";

const SO_ADMIN = "Só Administradores mudam a equipe.";

/** `null` se a leitura falhar: sem a lista certa as travas de "último Administrador" não valem, então a ação para. */
async function listarAdmins(): Promise<string[] | null> {
  const { data, error } = await dbAdmin().from("membros").select("usuario_id").eq("papel", "admin");
  if (error) return null;
  return ((data ?? []) as { usuario_id: string }[]).map((m) => m.usuario_id);
}

function papelValido(v: unknown): v is Papel {
  return v === "admin" || v === "membro";
}

function revalidar() {
  revalidatePath("/equipe");
  revalidatePath("/equipe/permissoes");
}

export type ResultadoCriarAcesso = { erro?: string; aviso?: string; senha?: string };

/** Cria o acesso já confirmado, com senha gerada aqui (a senha volta só nesta resposta: não é salva nem
 *  logada). Depois cria a linha em `membros` (o gatilho em `auth.users` já criou uma como "membro"; aqui só
 *  garantimos nome/papel) — se esse `upsert` falhar, a senha ainda volta, com aviso pra editar depois. */
export async function criarAcesso(email: string, nome: string, papel: Papel): Promise<ResultadoCriarAcesso> {
  const r = await checarPermissao("equipe", "editar");
  if (!r.ok) return { erro: SO_ADMIN };

  const e = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return { erro: "E-mail inválido." };
  const n = nome.trim().slice(0, 60);
  if (!n) return { erro: "Nome é obrigatório." };
  if (!papelValido(papel)) return { erro: "Papel inválido." };

  const senha = senhaAleatoria(16);
  const db = dbAdmin();
  const { data, error } = await db.auth.admin.createUser({ email: e, password: senha, email_confirm: true });
  if (error) return { erro: error.message.includes("already") ? "Esse e-mail já tem acesso." : "Não foi possível criar o acesso." };
  const usuarioId = data?.user?.id;
  if (!usuarioId) return { erro: "Não foi possível criar o acesso." };

  const { error: erroUpsert } = await db.from("membros").upsert({ usuario_id: usuarioId, nome: n, papel }, { onConflict: "usuario_id" });
  revalidar();
  await registrarHistorico(r.usuario, {
    acao: "adicionar",
    area: "Equipe",
    resumo: `Acesso criado para ${e} (${papel === "admin" ? "Administrador" : "Membro"})`,
    refId: usuarioId,
  });
  if (erroUpsert) return { senha, aviso: "O papel não pôde ser salvo agora. Edite essa pessoa pra corrigir." };
  return { senha };
}

/** Edita nome e papel de quem já tem acesso. `verificarMudancaPapel` garante que nunca fica sem Administrador. */
export async function editarMembro(usuarioId: string, dados: { nome: string; papel: Papel }): Promise<{ erro?: string }> {
  const r = await checarPermissao("equipe", "editar");
  if (!r.ok) return { erro: SO_ADMIN };
  if (!ehUuid(usuarioId)) return { erro: "Pessoa inválida." };
  const n = dados.nome.trim().slice(0, 60);
  if (!n) return { erro: "Nome é obrigatório." };
  if (!papelValido(dados.papel)) return { erro: "Papel inválido." };

  const admins = await listarAdmins();
  if (!admins) return { erro: "Não foi possível conferir os administradores. Tente de novo." };
  const erroPapel = verificarMudancaPapel({ admins, alvo: usuarioId, novoPapel: dados.papel, eu: r.usuario.id });
  if (erroPapel) return { erro: erroPapel };

  const { data, error } = await dbAdmin()
    .from("membros")
    .update({ nome: n, papel: dados.papel, updated_at: new Date().toISOString() })
    .eq("usuario_id", usuarioId)
    .select("usuario_id");
  if (error) return { erro: "Não foi possível salvar." };
  if (!data?.length) return { erro: "Pessoa não encontrada." };
  revalidar();
  await registrarHistorico(r.usuario, {
    acao: "atualizar",
    area: "Equipe",
    resumo: `Equipe: ${n} agora é ${dados.papel === "admin" ? "Administrador" : "Membro"}`,
    refId: usuarioId,
  });
  return {};
}

/** Só para Membros: Administrador já tem acesso total (nada a salvar). Guarda o resultado de
 *  `normalizarPermissoes` (nunca a entrada bruta). */
export async function salvarPermissoes(usuarioId: string, permissoes: unknown): Promise<{ erro?: string }> {
  const r = await checarPermissao("equipe", "editar");
  if (!r.ok) return { erro: SO_ADMIN };
  if (!ehUuid(usuarioId)) return { erro: "Pessoa inválida." };

  const db = dbAdmin();
  const { data: linha, error: erroLer } = await db.from("membros").select("papel").eq("usuario_id", usuarioId).maybeSingle();
  if (erroLer) return { erro: "Não foi possível carregar essa pessoa." };
  if (!linha) return { erro: "Pessoa não encontrada." };
  if ((linha as { papel: Papel }).papel === "admin") return { erro: "Administrador já tem acesso total." };

  const normalizadas = normalizarPermissoes(permissoes);
  const { data, error } = await db
    .from("membros")
    .update({ permissoes: normalizadas, updated_at: new Date().toISOString() })
    .eq("usuario_id", usuarioId)
    .select("usuario_id");
  if (error) return { erro: "Não foi possível salvar as permissões." };
  if (!data?.length) return { erro: "Pessoa não encontrada." };
  revalidar();
  await registrarHistorico(r.usuario, { acao: "atualizar", area: "Equipe", resumo: "Permissões atualizadas", refId: usuarioId });
  return {};
}

/** `verificarRemocao` garante que ninguém remove o próprio acesso, e que nunca fica sem Administrador. */
export async function removerAcesso(usuarioId: string): Promise<{ erro?: string }> {
  const r = await checarPermissao("equipe", "editar");
  if (!r.ok) return { erro: SO_ADMIN };
  if (!ehUuid(usuarioId)) return { erro: "Pessoa inválida." };

  const admins = await listarAdmins();
  if (!admins) return { erro: "Não foi possível conferir os administradores. Tente de novo." };
  const erro = verificarRemocao({ admins, alvo: usuarioId, eu: r.usuario.id });
  if (erro) return { erro };

  // Antes de excluir: as chaves de atendente dessa pessoa (API) param de valer e os acessos dela viram
  // "revogado". Depois do deleteUser o `criada_por` vira null (on delete set null) e não dá mais pra achar as chaves.
  const db = dbAdmin();
  const iso = new Date().toISOString();
  const chaves = await db
    .from("api_chaves")
    .update({ revogada_em: iso })
    .eq("criada_por", usuarioId)
    .not("acesso_de", "is", null)
    .is("revogada_em", null);
  if (chaves.error) return { erro: "Não foi possível revogar as chaves de API dessa pessoa. Tente de novo." };
  const acessos = await db
    .from("api_acessos")
    .update({ status: "revogado", decidido_por: r.usuario.id, decidido_em: iso })
    .eq("solicitante", usuarioId)
    .in("status", ["aguardando", "aprovado"]);
  if (acessos.error) return { erro: "Não foi possível revogar os acessos de API dessa pessoa. Tente de novo." };

  const { error } = await db.auth.admin.deleteUser(usuarioId);
  if (error) return { erro: "Não foi possível remover o acesso dessa pessoa." };
  revalidar();
  await registrarHistorico(r.usuario, { acao: "remover", area: "Equipe", resumo: "Acesso removido", refId: usuarioId });
  return {};
}
