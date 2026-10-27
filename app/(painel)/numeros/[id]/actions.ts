"use server";
import { revalidatePath } from "next/cache";
import { credenciais } from "@/src/lib/conexoes";
import { registrarHistorico } from "@/src/lib/historico";
import { checarPermissao, permitido } from "@/src/lib/permissoes";
import { fotoDaResposta } from "@/src/lib/regras/foto";
import { validarNomeLead } from "@/src/lib/regras/leads";
import { ehUuid } from "@/src/lib/regras/uuid";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { mascararTelefone, normalizarTelefone } from "@/src/lib/telefone";
import { pegarTravaConta, soltarTravaConta } from "@/src/lib/trava";
import { PRAZO_TELA_MS, ZapbotError, zapbot } from "@/src/lib/zapbot/client";

/** Mesma trava de 2 minutos de `atualizarLeads` (`campanhas/[id]/grupos/actions.ts`): 1 pedido por conta a cada
 *  2 minutos, pra um clique duplo não disparar a leitura do Zapbot duas vezes. */
const THROTTLE_MS = 2 * 60_000;

function erroThrottle(ultima: string | null): string | null {
  if (!ultima || Date.now() - Date.parse(ultima) >= THROTTLE_MS) return null;
  return "Aguarde 2 minutos entre duas atualizações.";
}

/** Botão "Atualizar" da aba "Grupos" do detalhe da conta (Etapa 3K, Tarefa 4.17 P2): lê TODOS os
 *  grupos que a conta participa no Zapbot (`GET groups`, não só os de campanha) e guarda em `conta_grupos` — uma
 *  consulta por clique, nunca na renderização da página. Upsert dos atuais + apaga os que a conta não participa
 *  mais (saiu, foi removida, grupo apagado). */
export async function atualizarGruposDaConta(conexaoId: string): Promise<{ erro?: string; atualizados?: number }> {
  const acesso = await checarPermissao("contas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  if (!ehUuid(conexaoId)) return { erro: "Conexão inválida." };
  const db = dbAdmin();
  const { data: conta, error: erroConta } = await db.from("conexoes").select("grupos_atualizados_em, status").eq("id", conexaoId).maybeSingle();
  if (erroConta) return { erro: "Não foi possível conferir a conexão." };
  if (!conta) return { erro: "Conexão não encontrada." };
  if ((conta as { status: string }).status !== "conectado") return { erro: "Conecte a conexão pra atualizar os grupos." };
  const anterior = (conta as { grupos_atualizados_em: string | null }).grupos_atualizados_em;
  const throttle = erroThrottle(anterior);
  if (throttle) return { erro: throttle };
  // Trava atômica ANTES do Zapbot: dois cliques ao mesmo tempo, só um lê os grupos.
  const trava = await pegarTravaConta(db, { conexaoId, coluna: "grupos_atualizados_em", ms: THROTTLE_MS });
  if (!trava.ok) return { erro: trava.motivo === "ocupada" ? "Aguarde 2 minutos entre duas atualizações." : "Não foi possível pedir a atualização. Tente de novo." };

  let grupos;
  try {
    grupos = await zapbot().listarGrupos(await credenciais(conexaoId), { prazoTotalMs: PRAZO_TELA_MS });
  } catch (e) {
    // O Zapbot falhou: solta a trava pra pessoa poder tentar de novo na hora.
    await soltarTravaConta(db, { conexaoId, coluna: "grupos_atualizados_em", em: trava.em, anterior });
    return { erro: e instanceof ZapbotError ? e.message : "O Zapbot não respondeu. Tente de novo." };
  }

  const agora = trava.em;
  // Foto (Etapa 3M): só entra na linha quando o `GET groups` trouxer `avatarUrl` (hoje a lista não traz; sem chamada
  // extra por grupo). Os dois lotes ficam separados porque um upsert em lote com chaves diferentes apagaria a foto já
  // guardada nas linhas sem o campo.
  const linha = (g: (typeof grupos)[number]) => ({ conexao_id: conexaoId, group_id: g.groupId, nome: g.name, participantes: g.participantCount, admin: g.amAdmin, atualizado_em: agora });
  const comFoto = grupos.filter((g) => g.avatarUrl !== undefined).map((g) => ({ ...linha(g), foto_url: fotoDaResposta(g.avatarUrl) ?? null }));
  const semFoto = grupos.filter((g) => g.avatarUrl === undefined).map(linha);
  for (const lote of [semFoto, comFoto]) {
    if (!lote.length) continue;
    const { error: erroUpsert } = await db.from("conta_grupos").upsert(lote, { onConflict: "conexao_id,group_id" });
    if (erroUpsert) return { erro: "Não foi possível gravar os grupos. Tente de novo." };
  }
  // Tira os que a conta não participa mais: tudo que não foi regravado nesta leitura (sem lista de ids na URL, que
  // estourava com muitos grupos).
  const { error: erroApagar } = await db.from("conta_grupos").delete().eq("conexao_id", conexaoId).lt("atualizado_em", agora);
  if (erroApagar) return { erro: "Grupos gravados, mas não foi possível tirar os que sumiram." };

  revalidatePath(`/numeros/${conexaoId}`);
  await registrarHistorico(usuario, { acao: "atualizar", area: "Contas", resumo: `Grupos da conexão atualizados (${grupos.length})`, refId: conexaoId });
  return { atualizados: grupos.length };
}

export type ContatoDaConta = { phone: string; nome: string };

/** Aba "Contatos" (nova, Etapa 3K Tarefa 4): lida ao vivo do Zapbot (`GET contacts`), sem tabela de cache — dado
 *  pessoal da agenda do celular não fica no banco. `nome` = `name` ou `notify` (o Zapbot não tem rótulo
 *  "Verificado"). Telefone mascarado pra quem não tem `leads`/`ver` (mesma regra da API/MCP). */
export async function listarContatosConta(conexaoId: string): Promise<{ erro?: string; contatos?: ContatoDaConta[] }> {
  const acesso = await checarPermissao("contas", "ver");
  if (!acesso.ok) return { erro: acesso.erro };
  if (!ehUuid(conexaoId)) return { erro: "Conexão inválida." };
  const db = dbAdmin();
  const { data: conta, error: erroConta } = await db.from("conexoes").select("status").eq("id", conexaoId).maybeSingle();
  if (erroConta) return { erro: "Não foi possível conferir a conexão." };
  if (!conta) return { erro: "Conexão não encontrada." };
  if ((conta as { status: string }).status !== "conectado") return { erro: "Conecte a conexão para ver os contatos." };
  const podeVerTelefone = await permitido("leads", "ver");
  try {
    const contatos = await zapbot().contatos(await credenciais(conexaoId), { prazoTotalMs: PRAZO_TELA_MS });
    return {
      contatos: contatos.map((c) => ({
        phone: podeVerTelefone ? c.phone : mascararTelefone(c.phone) ?? "•••",
        nome: c.name || c.notify || "",
      })),
    };
  } catch {
    return { erro: "Não foi possível ler os contatos agora." };
  }
}

/** Item "Sair do grupo" (`more_vert`) da aba Grupos do detalhe da conta (Etapa 3M, Tarefa 5): chamada direta ao
 *  Zapbot (não fila), com confirmação na tela. Recusa se o grupo for de alguma campanha (tem linha em `grupos`,
 *  ativa ou não — a mesma regra da tela) ou se não estiver em `conta_grupos` desta conta (lista desatualizada — pede Atualizar).
 *  Erro do Zapbot não apaga a linha, pra poder tentar de novo. */
export async function sairDoGrupo(conexaoId: string, groupId: string): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("contas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  if (!ehUuid(conexaoId)) return { erro: "Conexão inválida." };
  if (typeof groupId !== "string" || !groupId.endsWith("@g.us")) return { erro: "Grupo inválido." };
  const db = dbAdmin();
  const [{ data: conta, error: erroConta }, { data: contaGrupo, error: erroContaGrupo }] = await Promise.all([
    db.from("conexoes").select("nome, status").eq("id", conexaoId).maybeSingle(),
    db.from("conta_grupos").select("nome").eq("conexao_id", conexaoId).eq("group_id", groupId).maybeSingle(),
  ]);
  if (erroConta || erroContaGrupo) return { erro: "Não foi possível conferir o grupo." };
  if (!conta) return { erro: "Conexão não encontrada." };
  if ((conta as { status: string }).status !== "conectado") return { erro: "Conecte a conexão pra sair do grupo." };
  if (!contaGrupo) return { erro: "Este grupo não está na lista da conexão. Clique em Atualizar." };

  const { data: grupoCampanha, error: erroGrupo } = await db.from("grupos").select("ativo, campanhas(nome)").eq("group_id", groupId).maybeSingle();
  if (erroGrupo) return { erro: "Não foi possível conferir o grupo." };
  // Qualquer linha em `grupos` (ativa ou não) barra, igual à tela: o grupo é de campanha.
  if (grupoCampanha) {
    const nomeCampanha = (grupoCampanha as unknown as { campanhas: { nome: string } | null }).campanhas?.nome ?? "";
    return { erro: `Este grupo está na campanha ${nomeCampanha}. Tire o grupo da campanha antes de sair.` };
  }

  try {
    await zapbot().sairDoGrupo(await credenciais(conexaoId), groupId, { prazoTotalMs: PRAZO_TELA_MS });
  } catch (e) {
    return { erro: e instanceof ZapbotError ? e.message : "O Zapbot não respondeu. Tente de novo." };
  }

  const { error: erroApagar } = await db.from("conta_grupos").delete().eq("conexao_id", conexaoId).eq("group_id", groupId);
  if (erroApagar) return { erro: "Saiu do grupo no WhatsApp, mas não foi possível atualizar a lista. Clique em Atualizar." };

  revalidatePath(`/numeros/${conexaoId}`);
  const nomeConta = (conta as { nome: string }).nome;
  const nomeGrupo = (contaGrupo as { nome: string | null }).nome || groupId;
  await registrarHistorico(usuario, { acao: "remover", area: "Contas", resumo: `Conexão ${nomeConta} saiu do grupo ${nomeGrupo}`, refId: conexaoId });
  return {};
}

/** Menu "Cadastrar como lead" de um contato da conta: upsert em `contatos`, mas sem sobrescrever um nome que já
 *  exista lá (diferente do cadastro manual da Visão geral, que sempre grava o nome digitado). */
export async function cadastrarContatoComoLead(telefone: string, nomeContato: unknown): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("leads", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  const t = typeof telefone === "string" ? normalizarTelefone(telefone) : null;
  if (!t) return { erro: "Telefone inválido." };
  const nomeValidado = validarNomeLead(nomeContato);
  if ("erro" in nomeValidado) return { erro: nomeValidado.erro };
  const db = dbAdmin();
  const { data: existente, error: erroLer } = await db.from("contatos").select("telefone").eq("telefone", t).maybeSingle();
  if (erroLer) return { erro: "Não foi possível cadastrar o lead." };
  if (existente) return {}; // já é lead: nome existente não é tocado.
  const { error } = await db.from("contatos").insert({ telefone: t, nome: nomeValidado.nome });
  if (error && error.code !== "23505") return { erro: "Não foi possível cadastrar o lead." };
  revalidatePath("/leads", "layout");
  await registrarHistorico(usuario, { acao: "adicionar", area: "Leads", resumo: `Lead cadastrado a partir dos contatos da conexão (•••${t.slice(-4)})` });
  return {};
}
