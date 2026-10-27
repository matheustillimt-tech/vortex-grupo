"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { registrarHistorico } from "@/src/lib/historico";
import { validarPasso, type PassoEntrada } from "@/src/lib/regras/sequencia";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { checarPermissao, exigirPermissao } from "@/src/lib/permissoes";
import { dbUsuario } from "@/src/lib/supabase/usuario";

export async function criarSequencia(nome: string): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("automacoes", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  const n = nome.trim();
  if (!n || n.length > 60) return { erro: "Dê um nome de até 60 caracteres." };
  const { data, error } = await (await dbUsuario()).from("sequencias").insert({ nome: n }).select("id").single();
  if (error || !data) return { erro: "Não foi possível criar." };
  await registrarHistorico(usuario, { acao: "adicionar", area: "Sequências", resumo: `Sequência "${n}" criada`, refId: data.id });
  redirect(`/sequencias/${data.id}`);
}

export async function renomearSequencia(id: string, nome: string): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("automacoes", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  const n = nome.trim();
  if (!n || n.length > 60) return { erro: "Dê um nome de até 60 caracteres." };
  const { error } = await (await dbUsuario()).from("sequencias").update({ nome: n }).eq("id", id);
  if (error) return { erro: "Não foi possível renomear." };
  revalidatePath("/sequencias", "layout");
  await registrarHistorico(usuario, { acao: "atualizar", area: "Sequências", resumo: `Sequência renomeada para "${n}"`, refId: id });
  return {};
}

export async function duplicarSequencia(id: string) {
  const { usuario } = await exigirPermissao("automacoes", "editar");
  const db = await dbUsuario();
  const { data: s, error } = await db.from("sequencias").select("nome, sequencia_passos(ordem, dia_relativo, hora, tipo, conteudo, importante)").eq("id", id).single();
  if (error || !s) throw new Error("Sequência não encontrada.");
  const { data: nova, error: erroNova } = await db.from("sequencias").insert({ nome: `${s.nome} (cópia)`.slice(0, 60) }).select("id").single();
  if (erroNova || !nova) throw new Error("Não foi possível duplicar.");
  const passos = (s.sequencia_passos ?? []) as Record<string, unknown>[];
  if (passos.length) {
    const { error: erroPassos } = await db.from("sequencia_passos").insert(passos.map((p) => ({ ...p, sequencia_id: nova.id })));
    if (erroPassos) {
      await db.from("sequencias").delete().eq("id", nova.id);
      throw new Error("Não foi possível copiar os passos.");
    }
  }
  await registrarHistorico(usuario, { acao: "adicionar", area: "Sequências", resumo: `Sequência "${s.nome}" duplicada`, refId: nova.id });
  redirect(`/sequencias/${nova.id}`);
}

export async function excluirSequencia(id: string) {
  const { usuario } = await exigirPermissao("automacoes", "editar");
  const db = await dbUsuario();
  // Campanhas que usavam ficam sem sequência (on delete set null); execuções que já saíram ficam no histórico.
  // As que ainda não saíram (agendada, pulada, bloqueada) somem com a sequência: ninguém mais vai gerar o conteúdo delas.
  const { data: campanhas, error: erroCampanhas } = await db.from("campanhas").select("id").eq("sequencia_id", id);
  if (erroCampanhas) throw new Error("Não foi possível excluir.");
  const ids = (campanhas ?? []).map((c) => c.id as string);
  if (ids.length) {
    const { error: erroExecucoes } = await db.from("execucoes").delete().in("campanha_id", ids).eq("origem", "sequencia").in("status", ["agendada", "pulada", "bloqueada"]);
    if (erroExecucoes) throw new Error("Não foi possível excluir.");
  }
  const { error } = await db.from("sequencias").delete().eq("id", id);
  if (error) throw new Error("Não foi possível excluir.");
  await registrarHistorico(usuario, { acao: "remover", area: "Sequências", resumo: "Sequência excluída", refId: id });
  redirect("/sequencias");
}

/** Salva o editor inteiro. Passo existente mantém o id (é ele que liga o passo às execuções já feitas: trocar o id
 *  faria a sequência mandar de novo o que já saiu). Depois, execuções ainda agendadas dessa sequência são apagadas
 *  pra serem recriadas com o horário e o conteúdo novos no próximo tick. */
export async function salvarPassos(sequenciaId: string, passos: PassoEntrada[]): Promise<{ erro?: string; passos?: PassoEntrada[] }> {
  const acesso = await checarPermissao("automacoes", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  const validos = [];
  for (const [i, p] of passos.entries()) {
    const v = validarPasso(p);
    if (!v.ok) return { erro: `Passo ${i + 1}: ${v.erro}` };
    validos.push({ ...v.valor, ordem: i });
  }
  const db = dbAdmin();
  const { data: atuais, error: erroAtuais } = await db.from("sequencia_passos").select("id").eq("sequencia_id", sequenciaId);
  if (erroAtuais) return { erro: "Não foi possível ler os passos atuais." };
  const manter = new Set(validos.flatMap((p) => (p.id ? [p.id] : [])));
  const remover = (atuais ?? []).map((a) => a.id as string).filter((id) => !manter.has(id));
  if (remover.length) {
    const { error } = await db.from("sequencia_passos").delete().in("id", remover);
    if (error) return { erro: "Não foi possível remover os passos apagados." };
  }
  const salvos: PassoEntrada[] = [];
  for (const { id, ordem, ...campos } of validos) {
    const r = id
      ? await db.from("sequencia_passos").update({ ...campos, ordem }).eq("id", id).eq("sequencia_id", sequenciaId).select("id").single()
      : await db.from("sequencia_passos").insert({ ...campos, ordem, sequencia_id: sequenciaId }).select("id").single();
    if (r.error || !r.data) return { erro: "Não foi possível salvar um dos passos." };
    salvos.push({ ...campos, id: r.data.id as string });
  }
  const { data: campanhas, error: erroCampanhas } = await db.from("campanhas").select("id").eq("sequencia_id", sequenciaId);
  if (erroCampanhas) return { erro: "Passos salvos, mas não foi possível reagendar as campanhas. Tente salvar de novo." };
  const ids = (campanhas ?? []).map((c) => c.id as string);
  if (ids.length) {
    const { error } = await db.from("execucoes").delete().in("campanha_id", ids).eq("origem", "sequencia").in("status", ["agendada", "pulada", "bloqueada"]);
    if (error) return { erro: "Passos salvos, mas não foi possível reagendar as campanhas que usam esta sequência." };
  }
  revalidatePath(`/sequencias/${sequenciaId}`);
  revalidatePath("/calendario");
  await registrarHistorico(usuario, { acao: "atualizar", area: "Sequências", resumo: `${salvos.length} passo(s) da sequência salvos`, refId: sequenciaId });
  // Devolve os passos com o id dos novos: salvar de novo atualiza em vez de duplicar.
  return { passos: salvos };
}
