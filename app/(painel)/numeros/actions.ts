"use server";
import { revalidatePath } from "next/cache";
import { cifrar, segredoAleatorio } from "@/src/lib/crypto";
import { credenciais } from "@/src/lib/conexoes";
import { env } from "@/src/lib/env";
import { registrarHistorico } from "@/src/lib/historico";
import { mensagemExecucoes, type ContagemExecucoes } from "@/src/lib/regras/contas-associadas";
import { validarNomeConexao } from "@/src/lib/regras/contas";
import { ehUuid } from "@/src/lib/regras/uuid";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { checarPermissao } from "@/src/lib/permissoes";
import { ZapbotError, zapbot } from "@/src/lib/zapbot/client";

export async function criarConexao(nome: string): Promise<{ id?: string; erro?: string }> {
  const acesso = await checarPermissao("contas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  const n = nome.trim();
  if (!n || n.length > 40) return { erro: "Dê um nome de até 40 caracteres." };
  const db = dbAdmin();
  const webhookSecret = segredoAleatorio();
  const clientToken = segredoAleatorio();
  const { data, error } = await db.from("conexoes").insert({ nome: n, webhook_secret: webhookSecret, client_token_enc: cifrar(clientToken) }).select("id").single();
  if (error || !data) return { erro: "Não foi possível salvar a conexão." };
  try {
    const z = await zapbot().criarConexao({
      nome: `Grupos · ${n}`,
      webhookUrl: `${env("NEXT_PUBLIC_SITE_URL")}/api/webhooks/zapbot/${data.id}/${webhookSecret}`,
      clientToken,
    });
    const { error: erroUpdate } = await db.from("conexoes").update({ zapbot_id: z.id, zapbot_token_enc: cifrar(z.token) }).eq("id", data.id);
    if (erroUpdate) {
      await zapbot().apagarConexao(z.id).catch(() => {});
      await db.from("conexoes").delete().eq("id", data.id);
      return { erro: "Não foi possível salvar a conexão." };
    }
    revalidatePath("/numeros");
    await registrarHistorico(usuario, { acao: "adicionar", area: "Contas", resumo: `Conexão "${n}" criada`, refId: data.id });
    return { id: data.id };
  } catch (e) {
    await db.from("conexoes").delete().eq("id", data.id);
    if (e instanceof ZapbotError && e.status === 403) return { erro: "Sem vaga no Zapbot (limite de 300 conexões)." };
    return { erro: "O Zapbot não respondeu. Tente de novo." };
  }
}

export async function renomearConexao(id: string, nome: string): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("contas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  const v = validarNomeConexao(nome);
  if (!v.ok) return { erro: v.erro };
  const db = dbAdmin();
  const { data, error } = await db.from("conexoes").update({ nome: v.nome }).eq("id", id).select("id");
  if (error) return { erro: "Não foi possível renomear o número." };
  if (!data || data.length === 0) return { erro: "Conexão não encontrada." };
  revalidatePath("/numeros");
  revalidatePath("/");
  await registrarHistorico(usuario, { acao: "atualizar", area: "Contas", resumo: `Conexão renomeada para "${v.nome}"`, refId: id });
  return {};
}

export async function reconectar(id: string): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("contas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  try {
    await zapbot().reiniciar(await credenciais(id));
    await registrarHistorico(usuario, { acao: "executar", area: "Contas", resumo: "Conexão reconectada", refId: id });
    return {};
  } catch {
    return { erro: "Não deu pra reconectar. Gere um QR novo." };
  }
}

/** Zapbot não distingue "só desconectar" de "desconectar e apagar a sessão": a única rota que a doc tem
 *  (`disconnect`, https://api.zapbot.online/docs, conferida em 17/10/2026) já termina o pareamento — pedir QR
 *  novo é obrigatório nos dois casos. "Desconectar" (botão do cabeçalho e primeiro item do menu) e "Finalizar
 *  Sessão" (segundo item) chamam essa mesma rota; a diferença fica só no texto do histórico. */
async function desconectarNoZapbot(id: string): Promise<{ erro?: string }> {
  const db = dbAdmin();
  const { data, error: erroLer } = await db.from("conexoes").select("zapbot_id, status").eq("id", id).maybeSingle();
  if (erroLer) return { erro: "Não foi possível carregar este número. Tente de novo." };
  if (!data) return { erro: "Conexão não encontrada." };
  if (data.zapbot_id && data.status !== "desconectado") {
    try {
      await zapbot().desconectar(await credenciais(id));
    } catch (e) {
      if (!(e instanceof ZapbotError && e.status === 404)) return { erro: "O Zapbot não respondeu. Tente de novo." };
    }
  }
  const { error } = await db.from("conexoes").update({ status: "desconectado", ultimo_erro: null }).eq("id", id);
  if (error) return { erro: "Não foi possível desconectar o número. Tente de novo." };
  return {};
}

/** Cabeçalho "DESCONECTAR" e menu "Desconectar" (Etapa 3G, Tarefa 3). */
export async function desconectarConexao(id: string): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("contas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  const r = await desconectarNoZapbot(id);
  if (r.erro) return r;
  revalidatePath("/numeros");
  revalidatePath(`/numeros/${id}`);
  await registrarHistorico(usuario, { acao: "atualizar", area: "Contas", resumo: "Conexão desconectada", refId: id });
  return {};
}

/** Menu "Finalizar Sessão": desconecta e apaga a sessão no Zapbot (mesma rota de `desconectarConexao` — ver
 *  comentário de `desconectarNoZapbot`). */
export async function finalizarSessaoConexao(id: string): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("contas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  const r = await desconectarNoZapbot(id);
  if (r.erro) return r;
  revalidatePath("/numeros");
  revalidatePath(`/numeros/${id}`);
  await registrarHistorico(usuario, { acao: "atualizar", area: "Contas", resumo: "Sessão finalizada (desconectada e apagada no Zapbot)", refId: id });
  return {};
}

/** Menu "Definir projeto" (Etapa 3G, Tarefa 3): `projetoId: null` tira a conta da pasta. */
export async function definirProjetoConexao(id: string, projetoId: string | null): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("contas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  if (!ehUuid(id)) return { erro: "Conexão inválida." };
  if (projetoId !== null && !ehUuid(projetoId)) return { erro: "Projeto inválido." };
  const db = dbAdmin();
  if (projetoId) {
    const { data, error } = await db.from("projetos").select("id").eq("id", projetoId).maybeSingle();
    if (error) return { erro: "Não foi possível conferir o projeto." };
    if (!data) return { erro: "Projeto não encontrado." };
  }
  const { data: atualizada, error } = await db.from("conexoes").update({ projeto_id: projetoId }).eq("id", id).select("id");
  if (error) return { erro: "Não foi possível definir o projeto." };
  if (!atualizada?.length) return { erro: "Conexão não encontrada." };
  revalidatePath("/numeros");
  revalidatePath(`/numeros/${id}`);
  await registrarHistorico(usuario, {
    acao: "atualizar",
    area: "Contas",
    resumo: projetoId ? "Projeto da conexão definido" : "Conexão tirada do projeto",
    refId: id,
  });
  return {};
}

/** Aba "Campanhas" do detalhe da conta: troca em quais campanhas
 *  esta conta é admin (`campanha_conexoes`). A campanha onde a conta é criadora nunca entra na seleção (ela já
 *  é admin implícita ali). Chama a RPC `definir_campanhas_da_conta` (`20261017150300_conta_campanhas.sql`), que
 *  faz tudo isso atomicamente no banco — só em campanhas ativas, respeitando `reassociar_acoes` campanha a
 *  campanha (reassocia/cancela execuções com ele ligado, só conta `mantidas` com ele desligado), sem tocar
 *  nenhuma outra conta. Antes isto lia `campanhas` e `campanha_conexoes`, decidia em JS e chamava
 *  `aplicar_contas_campanha` uma vez por campanha — uma corrida entre a leitura e cada chamada podia perder uma
 *  edição concorrente (revisão final). */
export async function definirCampanhasDaConta(contaId: string, campanhaIds: string[]): Promise<{ erro?: string; mensagem?: string }> {
  const acesso = await checarPermissao("contas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  if (!ehUuid(contaId)) return { erro: "Conexão inválida." };
  if (!Array.isArray(campanhaIds) || !campanhaIds.every((c) => typeof c === "string" && ehUuid(c))) return { erro: "Campanha inválida na seleção." };
  const db = dbAdmin();
  const { data, error } = await db.rpc("definir_campanhas_da_conta", { p_conexao: contaId, p_campanhas: [...new Set(campanhaIds)] });
  if (error) return { erro: "Não foi possível atualizar as campanhas desta conexão. Tente de novo." };
  const r = ((Array.isArray(data) ? data[0] : data) ?? {}) as Partial<Record<"adicionadas" | "removidas" | "reassociadas" | "canceladas" | "mantidas", number>>;
  const entrou = r.adicionadas ?? 0;
  const saiu = r.removidas ?? 0;
  if (!entrou && !saiu) return {};

  revalidatePath(`/numeros/${contaId}`);
  const contagem: ContagemExecucoes = { reassociadas: r.reassociadas ?? 0, canceladas: r.canceladas ?? 0, mantidas: r.mantidas ?? 0 };
  const execucoes = mensagemExecucoes(contagem);
  const resumo = `Campanhas da conexão atualizadas (${entrou} entrou, ${saiu} saiu)${execucoes ? `; ${execucoes.replace(/\.$/, "")}` : ""}`;
  await registrarHistorico(usuario, { acao: "atualizar", area: "Contas", resumo, refId: contaId });
  return { mensagem: resumo };
}

export async function excluirConexao(id: string): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("contas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  const db = dbAdmin();
  // Confere tudo que prende o número antes de apagar a instância no Zapbot: depois disso não tem volta.
  const [criadora, grupos] = await Promise.all([
    db.from("campanhas").select("id", { count: "exact", head: true }).eq("conexao_criadora_id", id),
    // Grupo excluído (inativo e não suspenso) não prende o número: fica no histórico sem dono (conexao_id nulo).
    db.from("grupos").select("id", { count: "exact", head: true }).eq("conexao_id", id).or("ativo.eq.true,suspenso.eq.true"),
  ]);
  if (criadora.error || grupos.error) return { erro: "Não foi possível conferir se o número está em uso. Tente de novo." };
  if (criadora.count) return { erro: `Este número cria os grupos de ${criadora.count} campanha(s). Troque o número criador nessas campanhas antes.` };
  if (grupos.count) return { erro: `Este número é dono de ${grupos.count} grupo(s) ativo(s) ou suspenso(s) e não pode ser excluído.` };
  const { data, error: erroLer } = await db.from("conexoes").select("zapbot_id").eq("id", id).single();
  if (erroLer) return { erro: "Não foi possível carregar este número. Tente de novo." };
  if (data?.zapbot_id) {
    try {
      await zapbot().apagarConexao(data.zapbot_id);
    } catch (e) {
      if (!(e instanceof ZapbotError && e.status === 404)) return { erro: "O Zapbot não respondeu. Tente de novo." };
    }
  }
  const { error: erroApagar } = await db.from("conexoes").delete().eq("id", id);
  if (erroApagar) return { erro: "O número saiu do Zapbot, mas não foi possível apagá-lo aqui. Tente excluir de novo." };
  revalidatePath("/numeros");
  await registrarHistorico(usuario, { acao: "remover", area: "Contas", resumo: "Conexão excluída", refId: id });
  return {};
}
