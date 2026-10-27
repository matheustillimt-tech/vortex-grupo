"use server";
import { revalidatePath } from "next/cache";
import { telefonesProtegidos } from "@/src/lib/automacoes";
import { reenfileirarBloqueados } from "@/src/lib/bloqueio";
import { registrarHistorico } from "@/src/lib/historico";
import { checarPermissao } from "@/src/lib/permissoes";
import { MAX_NUMEROS_COLAGEM, validarNomeBlacklist } from "@/src/lib/regras/antispam";
import { lerListaDeTelefones } from "@/src/lib/regras/lista-telefones";
import { ehUuid } from "@/src/lib/regras/uuid";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { chaveTelefone, normalizarTelefone, variantesTelefone } from "@/src/lib/telefone";

const LOTE = 200;
const MAX_REMOVER = 500;

export type ResultadoNumeros = { novos: number; jaEstavam: number; ignorados: number; invalidos: string[]; remocoes: number };

function atualizar(id?: string) {
  revalidatePath("/blacklists");
  if (id) revalidatePath(`/blacklists/${id}`);
}

/** "CADASTRAR": só o nome; a lista nasce ativa e vazia. */
export async function criarBlacklist(nome: unknown): Promise<{ erro?: string; id?: string }> {
  const acesso = await checarPermissao("antispam", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const v = validarNomeBlacklist(nome);
  if (!v.ok) return { erro: v.erro };
  const { data, error } = await dbAdmin().from("blacklists").insert({ nome: v.nome }).select("id").single();
  if (error || !data) return { erro: "Não foi possível cadastrar a blacklist." };
  const id = (data as { id: string }).id;
  atualizar();
  await registrarHistorico(acesso.usuario, { acao: "adicionar", area: "Anti-spam", resumo: `Blacklist "${v.nome}" cadastrada`, refId: id });
  return { id };
}

/** Ativa/desativa: só lista ativa conta como bloqueada (view `bloqueados_efetivos`). Ativar não remove quem já
 *  está nos grupos na hora: a conferência pega quem entrar e "Analisar grupos" (Anti-spam) pega quem já está. */
export async function alternarBlacklist(id: unknown, ativa: unknown): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("antispam", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  if (!ehUuid(id) || typeof ativa !== "boolean") return { erro: "Blacklist inválida." };
  const { data, error } = await dbAdmin().from("blacklists").update({ ativa }).eq("id", id).select("nome").maybeSingle();
  if (error) return { erro: "Não foi possível atualizar a blacklist." };
  if (!data) return { erro: "Essa blacklist não existe mais." };
  atualizar(id);
  await registrarHistorico(acesso.usuario, { acao: "atualizar", area: "Anti-spam", resumo: `Blacklist "${(data as { nome: string }).nome}" ${ativa ? "ativada" : "desativada"}`, refId: id });
  return {};
}

/** Exclui a lista e os números dela (cascade). Não mexe em `bloqueados` nem põe ninguém de volta em grupo. */
export async function excluirBlacklist(id: unknown): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("antispam", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  if (!ehUuid(id)) return { erro: "Blacklist inválida." };
  const { data, error } = await dbAdmin().from("blacklists").delete().eq("id", id).select("nome").maybeSingle();
  if (error) return { erro: "Não foi possível excluir a blacklist." };
  if (!data) return { erro: "Essa blacklist não existe mais." };
  atualizar();
  await registrarHistorico(acesso.usuario, { acao: "remover", area: "Anti-spam", resumo: `Blacklist "${(data as { nome: string }).nome}" excluída`, refId: id });
  return {};
}

/** Colar vários (um por linha, mesmas regras de `lista-telefones`), até `MAX_NUMEROS_COLAGEM` por vez. Número
 *  conectado no sistema é ignorado (nunca é bloqueado). Lista ativa: quem já está em grupo entra na fila de
 *  remoção pelo mesmo caminho do anti-spam (`reenfileirarBloqueados`: nunca admin, nunca número conectado). */
export async function adicionarNumerosBlacklist(id: unknown, texto: unknown): Promise<{ erro?: string; resumo?: ResultadoNumeros }> {
  const acesso = await checarPermissao("antispam", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  if (!ehUuid(id)) return { erro: "Blacklist inválida." };
  if (typeof texto !== "string") return { erro: "Cole pelo menos um telefone." };
  if (texto.split(/\r?\n/).length > MAX_NUMEROS_COLAGEM) return { erro: `No máximo ${MAX_NUMEROS_COLAGEM} números por vez.` };
  const { validos, invalidos } = lerListaDeTelefones(texto);
  if (!validos.length) return { erro: invalidos.length ? "Nenhum telefone válido na lista." : "Cole pelo menos um telefone." };
  if (validos.length > MAX_NUMEROS_COLAGEM) return { erro: `No máximo ${MAX_NUMEROS_COLAGEM} números por vez.` };

  const db = dbAdmin();
  try {
    const { data: lista, error: erroLista } = await db.from("blacklists").select("nome, ativa").eq("id", id).maybeSingle();
    if (erroLista) return { erro: "Não foi possível ler a blacklist." };
    if (!lista) return { erro: "Essa blacklist não existe mais." };
    const { nome, ativa } = lista as { nome: string; ativa: boolean };

    const protegidos = await telefonesProtegidos(db);
    const candidatos = validos.map((v) => v.telefone).filter((t) => !variantesTelefone(t).some((v) => protegidos.has(v)));
    const ignorados = validos.length - candidatos.length;

    const novos: string[] = [];
    let jaEstavam = 0;
    for (let i = 0; i < candidatos.length; i += LOTE) {
      const lote = candidatos.slice(i, i + LOTE);
      const variantes = [...new Set(lote.flatMap(variantesTelefone))];
      const { data: existentes, error } = await db.from("blacklist_numeros").select("telefone").eq("blacklist_id", id).in("telefone", variantes);
      if (error) throw new Error(`Não foi possível ler os números da blacklist: ${error.message}`);
      const ja = new Set(((existentes ?? []) as { telefone: string }[]).map((e) => chaveTelefone(e.telefone)));
      const inserir = lote.filter((t) => !ja.has(chaveTelefone(t)));
      jaEstavam += lote.length - inserir.length;
      if (inserir.length) {
        const { error: erroGravar } = await db
          .from("blacklist_numeros")
          .upsert(inserir.map((telefone) => ({ blacklist_id: id, telefone })), { onConflict: "blacklist_id,telefone", ignoreDuplicates: true });
        if (erroGravar) throw new Error(`Não foi possível gravar os números: ${erroGravar.message}`);
        novos.push(...inserir);
      }
    }
    const remocoes = ativa && novos.length ? await reenfileirarBloqueados(db, novos) : 0;
    atualizar(id);
    if (novos.length) await registrarHistorico(acesso.usuario, { acao: "adicionar", area: "Anti-spam", resumo: `${novos.length} número(s) na blacklist "${nome}"`, refId: id });
    return { resumo: { novos: novos.length, jaEstavam, ignorados, invalidos, remocoes } };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "Não foi possível adicionar os números." };
  }
}

/** Tira números da lista (com e sem o nono dígito). Não põe ninguém de volta em grupo. */
export async function removerNumerosBlacklist(id: unknown, telefones: unknown): Promise<{ erro?: string; removidos?: number }> {
  const acesso = await checarPermissao("antispam", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  if (!ehUuid(id)) return { erro: "Blacklist inválida." };
  if (!Array.isArray(telefones) || telefones.length > MAX_REMOVER) return { erro: `Marque no máximo ${MAX_REMOVER} números de uma vez.` };
  const lista = [...new Set(telefones.map((t) => (typeof t === "string" ? normalizarTelefone(t) : null)).filter((t): t is string => !!t))];
  if (!lista.length) return { erro: "Marque pelo menos um número." };
  const db = dbAdmin();
  let removidos = 0;
  for (let i = 0; i < lista.length; i += LOTE) {
    const variantes = [...new Set(lista.slice(i, i + LOTE).flatMap(variantesTelefone))];
    const { data, error } = await db.from("blacklist_numeros").delete().eq("blacklist_id", id).in("telefone", variantes).select("telefone");
    if (error) return { erro: "Não foi possível remover os números." };
    removidos += ((data ?? []) as unknown[]).length;
  }
  atualizar(id);
  if (removidos) await registrarHistorico(acesso.usuario, { acao: "remover", area: "Anti-spam", resumo: `${removidos} número(s) tirado(s) de uma blacklist`, refId: id });
  return { removidos };
}
