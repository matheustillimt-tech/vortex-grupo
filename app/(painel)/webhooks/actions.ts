"use server";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { registrarHistorico } from "@/src/lib/historico";
import { validarIntegracao, type EntradaIntegracao } from "@/src/lib/regras/integracoes";
import { ehUuid } from "@/src/lib/regras/uuid";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { checarPermissao } from "@/src/lib/permissoes";

// Webhooks de checkout (entrada), Etapa 3H. Tudo por `dbAdmin`: `authenticated` não grava em integracoes_checkout
// nem lê a coluna `segredo`. Cada ação exige webhooks/editar.

function revalidar(id?: string) {
  revalidatePath("/webhooks");
  if (id) revalidatePath(`/webhooks/${id}`);
  revalidatePath("/");
}

/** Cria a integração (o segredo vem do default do banco) e devolve o id pra abrir o detalhe com o link. */
export async function criarIntegracao(e: EntradaIntegracao): Promise<{ erro?: string; id?: string }> {
  const acesso = await checarPermissao("webhooks", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const v = validarIntegracao(e);
  if (!v.ok) return { erro: v.erro };
  const { data, error } = await dbAdmin().from("integracoes_checkout").insert({ nome: v.valor.nome, plataforma: v.valor.plataforma }).select("id").single();
  if (error || !data) return { erro: "Não foi possível criar o webhook." };
  const id = (data as { id: string }).id;
  revalidar(id);
  await registrarHistorico(acesso.usuario, { acao: "adicionar", area: "Webhooks", resumo: `Webhook de checkout "${v.valor.nome}" criado`, refId: id });
  return { id };
}

/** Arquivar tira o link de uso na hora: a rota de checkout só aceita integração não arquivada. */
export async function arquivarIntegracao(id: string, arquivar: boolean): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("webhooks", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  if (!ehUuid(id)) return { erro: "Webhook inválido." };
  if (typeof arquivar !== "boolean") return { erro: "Ação inválida." };
  const { data, error } = await dbAdmin().from("integracoes_checkout").update({ arquivada: arquivar }).eq("id", id).select("id");
  if (error) return { erro: arquivar ? "Não foi possível arquivar o webhook." : "Não foi possível desarquivar o webhook." };
  if (!data?.length) return { erro: "Webhook não encontrado." };
  revalidar(id);
  await registrarHistorico(acesso.usuario, { acao: "atualizar", area: "Webhooks", resumo: `Webhook de checkout ${arquivar ? "arquivado" : "desarquivado"}`, refId: id });
  return {};
}

/** Exclui de vez: o link para de funcionar na hora e o webhook some (inclusive das arquivadas). As vendas que
 *  chegaram por ele continuam, só perdem a ligação (`vendas.integracao_id` é `on delete set null`). */
export async function excluirIntegracao(id: string): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("webhooks", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  if (!ehUuid(id)) return { erro: "Webhook inválido." };
  const { data, error } = await dbAdmin().from("integracoes_checkout").delete().eq("id", id).select("nome");
  if (error) return { erro: "Não foi possível excluir o webhook." };
  if (!data?.length) return { erro: "Webhook não encontrado." };
  revalidar(id);
  await registrarHistorico(acesso.usuario, { acao: "remover", area: "Webhooks", resumo: `Webhook de checkout "${(data[0] as { nome: string }).nome}" excluído`, refId: id });
  return {};
}

/** Payload cru de uma venda, carregado só quando a janela "Evento" abre (revisão final B, item m1): a lista de
 *  eventos não traz mais `vendas.payload` — pode ser grande e não é usado até a pessoa clicar em "Evento". */
export async function carregarPayloadEvento(vendaId: string): Promise<{ erro?: string; payload?: unknown }> {
  const acesso = await checarPermissao("webhooks", "ver");
  if (!acesso.ok) return { erro: acesso.erro };
  if (!ehUuid(vendaId)) return { erro: "Evento inválido." };
  const { data, error } = await dbAdmin().from("vendas").select("payload").eq("id", vendaId).maybeSingle();
  if (error) return { erro: "Não foi possível carregar o evento." };
  if (!data) return { erro: "Evento não encontrado." };
  return { payload: (data as { payload: unknown }).payload };
}

/** Troca o segredo: o link antigo para de funcionar na hora. A página relê o link novo (só quem edita vê). */
export async function regerarLinkIntegracao(id: string): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("webhooks", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  if (!ehUuid(id)) return { erro: "Webhook inválido." };
  const segredo = randomBytes(24).toString("hex");
  const { data, error } = await dbAdmin().from("integracoes_checkout").update({ segredo }).eq("id", id).select("id");
  if (error) return { erro: "Não foi possível gerar um novo link." };
  if (!data?.length) return { erro: "Webhook não encontrado." };
  revalidar(id);
  await registrarHistorico(acesso.usuario, { acao: "atualizar", area: "Webhooks", resumo: "Link do webhook de checkout regerado", refId: id });
  return {};
}
