"use server";
import { revalidatePath } from "next/cache";
import { registrarHistorico } from "@/src/lib/historico";
import { TIPOS_MODELO, validarConteudo, type TipoModelo } from "@/src/lib/regras/conteudo";
import { normalizarIds } from "@/src/lib/regras/lote";
import { nomeDaCopia, validarPasta } from "@/src/lib/regras/modelos";
import { checarPermissao } from "@/src/lib/permissoes";
import { dbUsuario } from "@/src/lib/supabase/usuario";

const MAXIMO_LOTE = 100;

export type ResultadoLoteModelos = { feitas: number; erros: string[] } | { erro: string };

const agora = () => new Date().toISOString();

/** `null`, ausente ou só espaços: sem pasta. Texto: 1 a 40 letras depois do trim. */
function lerPasta(pasta: unknown): { ok: true; pasta: string | null } | { ok: false; erro: string } {
  if (pasta === null || pasta === undefined) return { ok: true, pasta: null };
  if (typeof pasta !== "string") return { ok: false, erro: "Pasta inválida." };
  if (!pasta.trim()) return { ok: true, pasta: null };
  const v = validarPasta(pasta);
  return v.ok ? { ok: true, pasta: v.nome } : v;
}

/** Ids marcados (até 100, sem repetir). Lista vazia, inválida ou grande demais vira erro. */
function lerIds(ids: unknown): { ok: true; lista: string[] } | { ok: false; erro: string } {
  if (Array.isArray(ids) && ids.length > MAXIMO_LOTE) return { ok: false, erro: `Marque no máximo ${MAXIMO_LOTE} de uma vez.` };
  const lista = normalizarIds(ids, MAXIMO_LOTE);
  if (!lista.length) return { ok: false, erro: "Marque pelo menos um modelo." };
  return { ok: true, lista };
}

export async function salvarModelo(id: string | null, m: { nome: string; tipo: TipoModelo; conteudo: unknown; pasta?: string | null }): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("modelos", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  const nome = typeof m.nome === "string" ? m.nome.trim() : "";
  if (!nome || Array.from(nome).length > 60) return { erro: "Dê um nome de até 60 caracteres." };
  if (!(TIPOS_MODELO as readonly string[]).includes(m.tipo)) return { erro: "Tipo inválido." };
  const pasta = lerPasta(m.pasta);
  if (!pasta.ok) return { erro: pasta.erro };
  const v = validarConteudo(m.tipo, m.conteudo);
  if (!v.ok) return { erro: v.erro };
  const db = await dbUsuario();
  const linha = { nome, tipo: m.tipo, conteudo: v.valor, pasta: pasta.pasta, updated_at: agora() };
  const { error } = id ? await db.from("modelos").update(linha).eq("id", id) : await db.from("modelos").insert(linha);
  if (error) return { erro: "Não foi possível salvar o modelo." };
  revalidatePath("/modelos");
  await registrarHistorico(usuario, { acao: id ? "atualizar" : "adicionar", area: "Modelos", resumo: `Modelo "${nome}" ${id ? "atualizado" : "criado"}`, refId: id ?? undefined });
  return {};
}

/** Atualiza os marcados de uma vez e conta quantos o banco devolveu. */
async function atualizar(lista: string[], mudar: Record<string, unknown>, falha: string): Promise<{ feitas: number; erros: string[] }> {
  const { data, error } = await (await dbUsuario()).from("modelos").update({ ...mudar, updated_at: agora() }).in("id", lista).select("id");
  revalidatePath("/modelos");
  if (error) return { feitas: 0, erros: [falha] };
  return { feitas: (data ?? []).length, erros: [] };
}

export async function arquivarModelos(ids: string[], arquivar: boolean): Promise<ResultadoLoteModelos> {
  const acesso = await checarPermissao("modelos", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  if (typeof arquivar !== "boolean") return { erro: "Ação inválida." };
  const l = lerIds(ids);
  if (!l.ok) return { erro: l.erro };
  const r = await atualizar(l.lista, { arquivado: arquivar }, arquivar ? "Não foi possível arquivar." : "Não foi possível desarquivar.");
  if (r.feitas) await registrarHistorico(usuario, { acao: "atualizar", area: "Modelos", resumo: `${r.feitas} modelo(s) ${arquivar ? "arquivado(s)" : "desarquivado(s)"}` });
  return r;
}

export async function moverModelos(ids: string[], pasta: string | null): Promise<ResultadoLoteModelos> {
  const acesso = await checarPermissao("modelos", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  if (typeof pasta === "string" && !pasta.trim()) return { erro: "Dê um nome para a pasta." };
  const p = lerPasta(pasta);
  if (!p.ok) return { erro: p.erro };
  const l = lerIds(ids);
  if (!l.ok) return { erro: l.erro };
  const r = await atualizar(l.lista, { pasta: p.pasta }, "Não foi possível mover para a pasta.");
  if (r.feitas) await registrarHistorico(usuario, { acao: "atualizar", area: "Modelos", resumo: `${r.feitas} modelo(s) movido(s)${p.pasta ? ` para a pasta "${p.pasta}"` : " para fora da pasta"}` });
  return r;
}

/** Cópia de cada marcado: "(cópia)" no nome, mesma pasta, fora do arquivo. */
export async function duplicarModelos(ids: string[]): Promise<ResultadoLoteModelos> {
  const acesso = await checarPermissao("modelos", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  const l = lerIds(ids);
  if (!l.ok) return { erro: l.erro };
  const db = await dbUsuario();
  const { data, error } = await db.from("modelos").select("id, nome, tipo, conteudo, pasta").in("id", l.lista);
  if (error) return { feitas: 0, erros: ["Não foi possível carregar os modelos."] };
  const achados = (data ?? []) as { id: string; nome: string; tipo: TipoModelo; conteudo: unknown; pasta: string | null }[];
  const erros: string[] = [];
  const faltando = l.lista.length - achados.length;
  if (faltando > 0) erros.push(`${faltando} modelo(s) não encontrado(s).`);
  if (!achados.length) return { feitas: 0, erros };
  const quando = agora();
  // Mesma ordem dos marcados (o banco não garante a ordem do `in`).
  const porId = new Map(achados.map((m) => [m.id, m]));
  const copias = l.lista
    .map((id) => porId.get(id))
    .filter((m): m is (typeof achados)[number] => Boolean(m))
    .map((m) => ({ nome: nomeDaCopia(m.nome), tipo: m.tipo, conteudo: m.conteudo, pasta: m.pasta, arquivado: false, updated_at: quando }));
  const ins = await db.from("modelos").insert(copias);
  revalidatePath("/modelos");
  if (ins.error) return { feitas: 0, erros: ["Não foi possível duplicar.", ...erros] };
  await registrarHistorico(usuario, { acao: "adicionar", area: "Modelos", resumo: `${copias.length} modelo(s) duplicado(s)` });
  return { feitas: copias.length, erros };
}

export async function excluirModelos(ids: string[]): Promise<ResultadoLoteModelos> {
  const acesso = await checarPermissao("modelos", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  const l = lerIds(ids);
  if (!l.ok) return { erro: l.erro };
  const { data, error } = await (await dbUsuario()).from("modelos").delete().in("id", l.lista).select("id");
  revalidatePath("/modelos");
  if (error) return { feitas: 0, erros: ["Não foi possível excluir."] };
  const feitas = (data ?? []).length;
  if (feitas) await registrarHistorico(usuario, { acao: "remover", area: "Modelos", resumo: `${feitas} modelo(s) excluído(s)` });
  return { feitas, erros: [] };
}
