"use server";
import { randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { revalidatePath } from "next/cache";
import { registrarHistorico } from "@/src/lib/historico";
import { hostPrivadoOuLocal, tokenValido, validarUrlWebhook, validarWebhook, type EntradaWebhook } from "@/src/lib/regras/webhooks";
import { assinatura } from "@/src/lib/webhooks-assinatura";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { checarPermissao } from "@/src/lib/permissoes";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idValido(id: unknown): id is string {
  return typeof id === "string" && UUID.test(id);
}

/** Marca como erro (sem mandar) os eventos ainda na fila ou em processamento desse webhook: o aviso não pode
 *  ser entregue (ou assinado) pra um webhook que está sendo excluído, arquivado ou desativado agora. Chamado
 *  antes de qualquer uma dessas três ações tomar efeito. */
async function marcarEventosParados(db: ReturnType<typeof dbAdmin>, webhookId: string, motivo: string): Promise<{ erro?: string }> {
  const { error } = await db.from("eventos_saida").update({ status: "erro", erro: motivo }).eq("webhook_id", webhookId).in("status", ["fila", "processando"]);
  if (error) return { erro: `Não foi possível interromper as entregas pendentes desse webhook: ${error.message}` };
  return {};
}

/** As telas de Hooks (lista, arquivados e histórico de entregas) e a home. */
function revalidar() {
  revalidatePath("/hooks");
  revalidatePath("/hooks/arquivadas");
  revalidatePath("/hooks/historico");
  revalidatePath("/");
}

export type ResultadoSalvarWebhook = { erro?: string; segredo?: string };

function gerarToken(): string {
  return randomBytes(24).toString("hex");
}

/** Cria (`id` null) ou edita um webhook. O `segredo` do HMAC é sempre gerado aqui na criação e nunca muda por esta
 *  action (só `regerarSegredo`). `token` (o token do assistente, 48 hex, coluna própria) é opcional: o
 *  assistente só manda na criação e depois de "Gerar novo" — sem ele, a edição não toca no token gravado (uma aba
 *  velha nunca sobrescreve). Usa `dbAdmin` porque `authenticated` não lê `segredo` nem `token`. */
export async function salvarWebhook(id: string | null, e: EntradaWebhook, token?: string): Promise<ResultadoSalvarWebhook> {
  const acesso = await checarPermissao("webhooks", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  if (id !== null && !idValido(id)) return { erro: "Webhook inválido." };
  if (token !== undefined && !tokenValido(token)) return { erro: "Token inválido." };
  const v = validarWebhook(e);
  if (!v.ok) return { erro: v.erro };
  const db = dbAdmin();
  const linha = { nome: v.valor.nome, url: v.valor.url, eventos: v.valor.eventos, campanhas: v.valor.campanhas, ...(token ? { token } : {}) };
  if (id) {
    const { data, error } = await db.from("webhooks").update(linha).eq("id", id).select("id");
    if (error) return { erro: "Não foi possível salvar o webhook." };
    if (!data?.length) return { erro: "Webhook não encontrado." };
    revalidar();
    await registrarHistorico(usuario, { acao: "atualizar", area: "Webhooks", resumo: `Webhook "${linha.nome}" atualizado`, refId: id });
    return {};
  }
  const segredo = gerarToken();
  const { data, error } = await db.from("webhooks").insert({ ...linha, segredo }).select("id").single();
  if (error) return { erro: "Não foi possível criar o webhook." };
  revalidar();
  await registrarHistorico(usuario, { acao: "adicionar", area: "Webhooks", resumo: `Webhook "${linha.nome}" criado`, refId: data?.id });
  return { segredo };
}

/** token novo pro assistente (criação, ou "Gerar novo" na edição). Só vale depois de "SALVAR". */
export async function novoToken(): Promise<{ erro?: string; token?: string }> {
  const acesso = await checarPermissao("webhooks", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  return { token: gerarToken() };
}

/** Quantos caracteres da resposta o passo "teste" mostra (e o máximo de bytes lidos do corpo). */
const RESPOSTA_TESTE = 500;
const BYTES_LIDOS_TESTE = 4096;

/** O host resolve (DNS) pra algum IP local/privado? Fecha o desvio do bloqueio de IP privado por um nome público
 *  que aponta pra rede interna. Falha de DNS vira erro (não manda). */
async function erroDeDns(url: string): Promise<string | null> {
  const host = new URL(url).hostname.replace(/^\[/, "").replace(/\]$/, "");
  try {
    const enderecos = await lookup(host, { all: true, verbatim: true });
    if (!enderecos.length) return "Não foi possível encontrar o endereço dessa URL.";
    if (enderecos.some((e) => hostPrivadoOuLocal(e.address))) return "A URL não pode apontar para um IP privado.";
    return null;
  } catch {
    return "Não foi possível encontrar o endereço dessa URL.";
  }
}

/** Primeiros bytes do corpo (sem ler resposta gigante inteira). */
async function inicioDoCorpo(r: Response): Promise<string> {
  if (!r.body) return "";
  const leitor = r.body.getReader();
  const partes: Uint8Array[] = [];
  let lidos = 0;
  try {
    while (lidos < BYTES_LIDOS_TESTE) {
      const { done, value } = await leitor.read();
      if (done) break;
      partes.push(value);
      lidos += value.length;
    }
  } finally {
    leitor.cancel().catch(() => {});
  }
  const tudo = new Uint8Array(lidos);
  let pos = 0;
  for (const p of partes) {
    tudo.set(p, pos);
    pos += p.length;
  }
  return new TextDecoder().decode(tudo).slice(0, RESPOSTA_TESTE);
}

export type ResultadoTesteHook = { erro?: string; status?: number; resposta?: string };

/** Até 10 testes por pessoa a cada 10 minutos (em memória, por instância do servidor: basta pra não virar
 *  disparador de requisições). */
const LIMITE_TESTES = 10;
const JANELA_TESTES_MS = 10 * 60_000;
const testesPorUsuario = new Map<string, number[]>();

function podeTestar(usuarioId: string, agora = Date.now()): boolean {
  const recentes = (testesPorUsuario.get(usuarioId) ?? []).filter((t) => agora - t < JANELA_TESTES_MS);
  if (recentes.length >= LIMITE_TESTES) {
    testesPorUsuario.set(usuarioId, recentes);
    return false;
  }
  recentes.push(agora);
  testesPorUsuario.set(usuarioId, recentes);
  return true;
}

/** Passo "teste" do assistente: manda agora `{ evento: "teste", em, isTest: true }` pra URL digitada (ainda não
 *  salva). `X-Vortex-Grupo-Token` vai quando o assistente tem um token novo na mão (criação ou "Gerar novo"); a assinatura
 *  `X-Vortex-Grupo-Assinatura` só na edição (`id`), com o `segredo` gravado — que nunca sai do servidor. Devolve o
 *  status HTTP e os 500 primeiros caracteres da resposta. A URL passa pelo mesmo `validarUrlWebhook` do cadastro
 *  (https, sem usuário/senha, sem localhost/IP privado/reservado) e o nome não pode resolver pra IP privado; sem
 *  seguir redirect, 10 s no máximo, até 10 testes por pessoa a cada 10 min. Exige Hooks/editar. */
export async function testarHook(url: string, token: string | null, id: string | null = null): Promise<ResultadoTesteHook> {
  const acesso = await checarPermissao("webhooks", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const erroUrl = validarUrlWebhook(url);
  if (erroUrl) return { erro: erroUrl };
  if (token !== null && !tokenValido(token)) return { erro: "Token inválido." };
  if (id !== null && !idValido(id)) return { erro: "Webhook inválido." };
  if (!podeTestar(acesso.usuario.id)) return { erro: `Limite de ${LIMITE_TESTES} testes a cada 10 minutos. Espere um pouco.` };
  const erroEndereco = await erroDeDns(url);
  if (erroEndereco) return { erro: erroEndereco };
  let segredo: string | null = null;
  if (id) {
    const { data, error } = await dbAdmin().from("webhooks").select("segredo").eq("id", id).maybeSingle();
    if (error) return { erro: "Não foi possível carregar o webhook." };
    segredo = (data as { segredo?: string } | null)?.segredo ?? null;
  }
  const corpo = JSON.stringify({ evento: "teste", em: new Date().toISOString(), isTest: true });
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (segredo) headers["X-Vortex-Grupo-Assinatura"] = `sha256=${assinatura(segredo, corpo)}`;
  if (token) headers["X-Vortex-Grupo-Token"] = token;
  let resultado: ResultadoTesteHook;
  try {
    const r = await fetch(url, { method: "POST", headers, body: corpo, redirect: "manual", signal: AbortSignal.timeout(10_000) });
    resultado = { status: r.status, resposta: await inicioDoCorpo(r).catch(() => "") };
  } catch (e) {
    const tempo = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    resultado = { erro: tempo ? "A URL não respondeu em 10 segundos." : "Não foi possível conectar na URL." };
  }
  await registrarHistorico(acesso.usuario, { acao: "executar", area: "Webhooks", resumo: `Teste de hook enviado${resultado.status ? ` (HTTP ${resultado.status})` : ""}`, ...(id ? { refId: id } : {}) });
  return resultado;
}

/** Gera um novo segredo de assinatura (HMAC; o antigo deixa de assinar as próximas entregas) e devolve pra mostrar
 *  uma única vez. Fica porque é o único jeito de quem recebe ter o segredo pra conferir `X-Vortex-Grupo-Assinatura`:
 *  o assistente só mostra o token (outra coluna). Usado pelo item "Gerar novo segredo de assinatura" do cartão. */
export async function regerarSegredo(id: string): Promise<{ erro?: string; segredo?: string }> {
  const acesso = await checarPermissao("webhooks", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  if (!idValido(id)) return { erro: "Webhook inválido." };
  const segredo = randomBytes(24).toString("hex");
  const { data, error } = await dbAdmin().from("webhooks").update({ segredo }).eq("id", id).select("id");
  if (error) return { erro: "Não foi possível gerar um novo segredo." };
  if (!data?.length) return { erro: "Webhook não encontrado." };
  revalidar();
  await registrarHistorico(usuario, { acao: "atualizar", area: "Webhooks", resumo: "Segredo do webhook regerado", refId: id });
  return { segredo };
}

export async function alternarWebhook(id: string, ativo: boolean): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("webhooks", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  if (!idValido(id)) return { erro: "Webhook inválido." };
  if (typeof ativo !== "boolean") return { erro: "Ação inválida." };
  const db = dbAdmin();
  const { data, error } = await db.from("webhooks").update({ ativo }).eq("id", id).select("id");
  if (error) return { erro: "Não foi possível atualizar o webhook." };
  if (!data?.length) return { erro: "Webhook não encontrado." };
  if (!ativo) {
    const r = await marcarEventosParados(db, id, "Webhook desativado.");
    if (r.erro) return r;
  }
  revalidar();
  await registrarHistorico(usuario, { acao: "atualizar", area: "Webhooks", resumo: `Webhook ${ativo ? "ativado" : "desativado"}`, refId: id });
  return {};
}

export async function arquivarWebhook(id: string, arquivar: boolean): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("webhooks", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  if (!idValido(id)) return { erro: "Webhook inválido." };
  if (typeof arquivar !== "boolean") return { erro: "Ação inválida." };
  const db = dbAdmin();
  const { data, error } = await db.from("webhooks").update({ arquivado: arquivar }).eq("id", id).select("id");
  if (error) return { erro: arquivar ? "Não foi possível arquivar o webhook." : "Não foi possível desarquivar o webhook." };
  if (!data?.length) return { erro: "Webhook não encontrado." };
  if (arquivar) {
    const r = await marcarEventosParados(db, id, "Webhook arquivado.");
    if (r.erro) return r;
  }
  revalidar();
  await registrarHistorico(usuario, { acao: "atualizar", area: "Webhooks", resumo: `Webhook ${arquivar ? "arquivado" : "desarquivado"}`, refId: id });
  return {};
}

/** A FK de `eventos_saida.webhook_id` é `on delete set null`: as entregas já registradas continuam, só perdem o
 *  vínculo. As ainda na fila/processando são marcadas como erro ANTES do delete: depois dele o `webhook_id`
 *  já está zerado e não dá mais pra filtrar por ele. */
export async function excluirWebhook(id: string): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("webhooks", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  if (!idValido(id)) return { erro: "Webhook inválido." };
  const db = dbAdmin();
  const rFila = await marcarEventosParados(db, id, "Webhook excluído.");
  if (rFila.erro) return { erro: "Não foi possível excluir o webhook." };
  const { data, error } = await db.from("webhooks").delete().eq("id", id).select("id");
  if (error) return { erro: "Não foi possível excluir o webhook." };
  if (!data?.length) return { erro: "Webhook não encontrado." };
  revalidar();
  await registrarHistorico(usuario, { acao: "remover", area: "Webhooks", resumo: "Webhook excluído", refId: id });
  return {};
}

/** Enfileira um evento de teste pra esse webhook (funciona mesmo inativo, pra validar antes de ativar). */
export async function enviarTeste(id: string): Promise<{ erro?: string; mensagem?: string }> {
  const acesso = await checarPermissao("webhooks", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  if (!idValido(id)) return { erro: "Webhook inválido." };
  const db = dbAdmin();
  const { data, error: erroWebhook } = await db.from("webhooks").select("url").eq("id", id).maybeSingle();
  if (erroWebhook) return { erro: "Não foi possível carregar o webhook." };
  if (!data) return { erro: "Webhook não encontrado." };
  const { error } = await db.from("eventos_saida").insert({
    webhook_id: id,
    de_webhook: true,
    campanha_id: null,
    url: (data as { url: string }).url,
    payload: { evento: "teste", mensagem: "Teste do Vórtex Grupo", em: new Date().toISOString() },
  });
  if (error) return { erro: "Não foi possível enfileirar o teste." };
  revalidar();
  await registrarHistorico(usuario, { acao: "executar", area: "Webhooks", resumo: "Teste do webhook enfileirado", refId: id });
  return { mensagem: "Teste na fila; chega em até 1 minuto." };
}
