"use server";
import { revalidatePath } from "next/cache";
import { registrarHistorico } from "@/src/lib/historico";
import { validarVariavelGlobal } from "@/src/lib/regras/variaveis-globais";
import { checarPermissao } from "@/src/lib/permissoes";
import { dbUsuario } from "@/src/lib/supabase/usuario";

export type EntradaVariavelGlobal = { chave: string; tipo: string; categoria: string | null };

/** A lista e a seção de valores dentro das campanhas (que mostra as globais). */
function revalidar() {
  revalidatePath("/variaveis");
  revalidatePath("/campanhas", "layout");
}

/** Cria (`id` null) ou edita uma variável global: só nome, tipo e categoria (o valor fica em cada campanha). */
export async function salvarVariavelGlobal(id: string | null, e: EntradaVariavelGlobal): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("variaveis", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  if (id !== null && (typeof id !== "string" || !id)) return { erro: "Variável inválida." };
  if (typeof e?.chave !== "string" || typeof e.tipo !== "string" || (e.categoria !== null && typeof e.categoria !== "string")) return { erro: "Dados inválidos." };
  const linha = { chave: e.chave.trim(), tipo: e.tipo, categoria: e.categoria?.trim() || null };
  const v = validarVariavelGlobal(linha);
  if (!v.ok) return { erro: v.erro };
  const db = await dbUsuario();
  const { error } = id ? await db.from("variaveis_globais").update(linha).eq("id", id) : await db.from("variaveis_globais").insert(linha);
  if (error) return { erro: error.code === "23505" ? "Já existe uma variável com esse nome." : "Não foi possível salvar a variável." };
  revalidar();
  await registrarHistorico(usuario, { acao: id ? "atualizar" : "adicionar", area: "Variáveis", resumo: `Variável global "${linha.chave}" ${id ? "atualizada" : "criada"}`, refId: id ?? undefined });
  return {};
}

/** Apaga só a definição global: os valores já gravados nas campanhas ficam (aparecem como "só desta campanha"). */
export async function excluirVariavelGlobal(id: string): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("variaveis", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  if (typeof id !== "string" || !id) return { erro: "Variável inválida." };
  const { error } = await (await dbUsuario()).from("variaveis_globais").delete().eq("id", id);
  if (error) return { erro: "Não foi possível excluir a variável." };
  revalidar();
  await registrarHistorico(usuario, { acao: "remover", area: "Variáveis", resumo: "Variável global excluída", refId: id });
  return {};
}
