"use server";
import { revalidatePath } from "next/cache";
import { registrarHistorico } from "@/src/lib/historico";
import { normalizarIds } from "@/src/lib/regras/lote";
import { validarDeeplink, validarPastaDeeplink, validarSlugDeeplink, type DeeplinkEntrada } from "@/src/lib/regras/deeplinks";
import { checarPermissao } from "@/src/lib/permissoes";
import { dbUsuario } from "@/src/lib/supabase/usuario";

const MAXIMO_LOTE = 100;

export type ResultadoLoteDeeplinks = { feitas: number; erros: string[] } | { erro: string };

/** `null`, ausente ou só espaços: sem pasta. Texto: 1 a 40 letras depois do trim (igual modelos). */
function lerPasta(pasta: unknown): { ok: true; pasta: string | null } | { ok: false; erro: string } {
  if (pasta === null || pasta === undefined) return { ok: true, pasta: null };
  if (typeof pasta !== "string") return { ok: false, erro: "Pasta inválida." };
  if (!pasta.trim()) return { ok: true, pasta: null };
  const v = validarPastaDeeplink(pasta);
  return v.ok ? { ok: true, pasta: v.nome } : v;
}

/** Ids marcados (até 100, sem repetir). Lista vazia, inválida ou grande demais vira erro. */
function lerIds(ids: unknown): { ok: true; lista: string[] } | { ok: false; erro: string } {
  if (Array.isArray(ids) && ids.length > MAXIMO_LOTE) return { ok: false, erro: `Marque no máximo ${MAXIMO_LOTE} de uma vez.` };
  const lista = normalizarIds(ids, MAXIMO_LOTE);
  if (!lista.length) return { ok: false, erro: "Marque pelo menos um deep link." };
  return { ok: true, lista };
}

/** Cria o deep link: nome, destino e o slug (sugerido do nome na tela,
 *  editável antes de salvar) — o slug é fixo depois de criado, pra não quebrar um link já divulgado. */
export async function criarDeeplink(e: DeeplinkEntrada & { slug: string; pasta: string | null }): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  const v = validarDeeplink(e);
  if (!v.ok) return { erro: v.erro };
  const sv = validarSlugDeeplink(typeof e.slug === "string" ? e.slug : "");
  if (!sv.ok) return { erro: sv.erro };
  const pasta = lerPasta(e.pasta);
  if (!pasta.ok) return { erro: pasta.erro };
  const db = await dbUsuario();
  const { data, error } = await db.from("deeplinks").insert({ nome: v.valor.nome, destino: v.valor.destino, slug: sv.slug, pasta: pasta.pasta }).select("id").single();
  if (error) return { erro: error.code === "23505" ? "Já existe um deep link com esse endereço." : "Não foi possível criar o deep link." };
  revalidatePath("/deeplinks");
  await registrarHistorico(usuario, { acao: "adicionar", area: "Deep link", resumo: `Deep link "${v.valor.nome}" criado`, refId: data?.id });
  return {};
}

/** Atualiza os marcados de uma vez e conta quantos o banco devolveu (igual modelos). */
async function atualizar(lista: string[], mudar: Record<string, unknown>, falha: string): Promise<{ feitas: number; erros: string[] }> {
  const { data, error } = await (await dbUsuario()).from("deeplinks").update(mudar).in("id", lista).select("id");
  revalidatePath("/deeplinks");
  if (error) return { feitas: 0, erros: [falha] };
  return { feitas: (data ?? []).length, erros: [] };
}

export async function moverDeeplinks(ids: string[], pasta: string | null): Promise<ResultadoLoteDeeplinks> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  if (typeof pasta === "string" && !pasta.trim()) return { erro: "Dê um nome para a pasta." };
  const p = lerPasta(pasta);
  if (!p.ok) return { erro: p.erro };
  const l = lerIds(ids);
  if (!l.ok) return { erro: l.erro };
  const r = await atualizar(l.lista, { pasta: p.pasta }, "Não foi possível mover para a pasta.");
  if (r.feitas) {
    await registrarHistorico(usuario, {
      acao: "atualizar",
      area: "Deep link",
      resumo: `${r.feitas} deep link(s) movido(s)${p.pasta ? ` para a pasta "${p.pasta}"` : " para fora da pasta"}`,
    });
  }
  return r;
}

export async function excluirDeeplinks(ids: string[]): Promise<ResultadoLoteDeeplinks> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  const l = lerIds(ids);
  if (!l.ok) return { erro: l.erro };
  const { data, error } = await (await dbUsuario()).from("deeplinks").delete().in("id", l.lista).select("id");
  revalidatePath("/deeplinks");
  if (error) return { feitas: 0, erros: ["Não foi possível excluir."] };
  const feitas = (data ?? []).length;
  if (feitas) await registrarHistorico(usuario, { acao: "remover", area: "Deep link", resumo: `${feitas} deep link(s) excluído(s)` });
  return { feitas, erros: [] };
}
