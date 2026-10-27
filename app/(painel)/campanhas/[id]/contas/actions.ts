"use server";
import { revalidatePath } from "next/cache";
import { registrarHistorico } from "@/src/lib/historico";
import { checarPermissao } from "@/src/lib/permissoes";
import { contaECriadora, mensagemExecucoes, MENSAGEM_NAO_REMOVE_CRIADORA, type ContagemExecucoes } from "@/src/lib/regras/contas-associadas";
import { ehUuid } from "@/src/lib/regras/uuid";
import { dbUsuario } from "@/src/lib/supabase/usuario";

/** Primeira linha da resposta de uma RPC `returns table` (o PostgREST devolve lista). */
function primeiraLinha<T>(data: unknown): T | null {
  return ((Array.isArray(data) ? data[0] : data) ?? null) as T | null;
}

/** "Associe uma conta": associa uma conta que ainda não está na campanha. A conta criadora já é da
 *  campanha (não entra em `campanha_conexoes`), então é recusada aqui também. `campanha_conexoes` tem chave
 *  primária (campanha_id, conexao_id): o upsert ignorando repetidos faz o duplo clique não dar erro nem duplicar. */
export async function associarConta(campanhaId: string, conexaoId: string): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  if (!ehUuid(campanhaId) || !ehUuid(conexaoId)) return { erro: "Conexão ou campanha inválida." };
  const db = await dbUsuario();

  const [{ data: campanha, error: erroCampanha }, { data: conexao, error: erroConexao }] = await Promise.all([
    db.from("campanhas").select("conexao_criadora_id").eq("id", campanhaId).maybeSingle(),
    db.from("conexoes").select("id, nome").eq("id", conexaoId).maybeSingle(),
  ]);
  if (erroCampanha) return { erro: "Não foi possível carregar a campanha." };
  if (!campanha) return { erro: "Campanha não encontrada." };
  if (erroConexao) return { erro: "Não foi possível verificar a conexão." };
  if (!conexao) return { erro: "Conexão não encontrada." };
  if (contaECriadora(conexaoId, campanha.conexao_criadora_id)) return { erro: "Esta conexão já cria os grupos da campanha; ela já está associada." };

  // Campanha sem número (nasce assim): a primeira conexão escolhida passa a criar os grupos.
  if (!campanha.conexao_criadora_id) {
    const { error } = await db.from("campanhas").update({ conexao_criadora_id: conexaoId }).eq("id", campanhaId);
    if (error) return { erro: "Não foi possível associar a conexão." };
    revalidatePath(`/campanhas/${campanhaId}`, "layout");
    await registrarHistorico(usuario, { acao: "adicionar", area: "Campanhas", resumo: `Conexão "${conexao.nome}" associada à campanha (cria os grupos)`, refId: campanhaId });
    return {};
  }

  const { error } = await db
    .from("campanha_conexoes")
    .upsert({ campanha_id: campanhaId, conexao_id: conexaoId }, { onConflict: "campanha_id,conexao_id", ignoreDuplicates: true });
  if (error) return { erro: "Não foi possível associar a conexão." };

  revalidatePath(`/campanhas/${campanhaId}/contas`);
  await registrarHistorico(usuario, { acao: "adicionar", area: "Campanhas", resumo: `Conexão "${conexao.nome}" associada à campanha`, refId: campanhaId });
  return {};
}

/** "Remover" conta associada. A criadora (`conexao_criadora_id`) nunca sai por aqui — tem que trocar o
 *  número que cria os grupos nas configurações primeiro. Ordem segura: primeiro as execuções, depois o vínculo.
 *  Com `reassociar_acoes` ligado, a RPC `remover_conta_das_execucoes` (atômica) tira a conta do `alvo_contas` das
 *  execuções `agendada` e cancela as que ficariam sem conta nenhuma; desligado, só conta quantas continuam usando
 *  a conta. Devolve em `mensagem` o que aconteceu com as ações agendadas.
 *  Consequência aceita: a mesma RPC também tira a conta do `alvo_contas` das automações da campanha (Etapa 3F) e
 *  desativa (com `motivo_desativada`) qualquer uma que ficaria sem conta nenhuma — não é revertido aqui; quem
 *  quiser a automação de volta reativa depois de trocar a conta (o assistente e a reativação pela lista conferem
 *  as referências de novo nesse momento). */
export async function removerConta(campanhaId: string, conexaoId: string): Promise<{ erro?: string; mensagem?: string }> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  if (!ehUuid(campanhaId) || !ehUuid(conexaoId)) return { erro: "Conexão ou campanha inválida." };
  const db = await dbUsuario();

  const { data: campanha, error: erroCampanha } = await db.from("campanhas").select("nome, conexao_criadora_id, reassociar_acoes").eq("id", campanhaId).maybeSingle();
  if (erroCampanha) return { erro: "Não foi possível carregar a campanha." };
  if (!campanha) return { erro: "Campanha não encontrada." };
  if (contaECriadora(conexaoId, campanha.conexao_criadora_id)) return { erro: MENSAGEM_NAO_REMOVE_CRIADORA };

  let contagem: ContagemExecucoes;
  if (campanha.reassociar_acoes) {
    const { data, error } = await db.rpc("remover_conta_das_execucoes", { p_campanha: campanhaId, p_conexao: conexaoId });
    if (error) return { erro: "Não foi possível reassociar as ações agendadas; a conexão continua na campanha." };
    const linha = primeiraLinha<{ reassociadas: number; canceladas: number }>(data);
    contagem = { reassociadas: linha?.reassociadas ?? 0, canceladas: linha?.canceladas ?? 0 };
  } else {
    const { count, error } = await db
      .from("execucoes")
      .select("id", { count: "exact", head: true })
      .eq("campanha_id", campanhaId)
      .eq("status", "agendada")
      .contains("alvo_contas", [conexaoId]);
    if (error) return { erro: "Não foi possível conferir as ações agendadas; a conexão continua na campanha." };
    contagem = { reassociadas: 0, canceladas: 0, mantidas: count ?? 0 };
  }

  const { error: erroDel } = await db.from("campanha_conexoes").delete().eq("campanha_id", campanhaId).eq("conexao_id", conexaoId);
  if (erroDel) {
    const feito = mensagemExecucoes(contagem);
    return { erro: `Não foi possível remover a conexão.${feito ? ` As ações agendadas já foram ajustadas: ${feito}` : ""}` };
  }

  const mensagem = mensagemExecucoes(contagem);
  revalidatePath(`/campanhas/${campanhaId}/contas`);
  await registrarHistorico(usuario, {
    acao: "remover",
    area: "Campanhas",
    resumo: `Conexão desassociada da campanha${mensagem ? ` (${mensagem.replace(/\.$/, "")})` : ""}`,
    refId: campanhaId,
  });
  return { mensagem: `Conexão removida.${mensagem ? ` ${mensagem}` : ""}` };
}

/** Interruptor "Reassociar ações automaticamente ao remover conta" (`campanhas.reassociar_acoes`). */
export async function definirReassociarAcoes(campanhaId: string, valor: boolean): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  const { error } = await (await dbUsuario()).from("campanhas").update({ reassociar_acoes: valor }).eq("id", campanhaId);
  if (error) return { erro: "Não foi possível salvar esta configuração." };
  revalidatePath(`/campanhas/${campanhaId}/contas`);
  await registrarHistorico(usuario, {
    acao: "atualizar",
    area: "Campanhas",
    resumo: `Reassociação automática ao remover conexão ${valor ? "ativada" : "desativada"}`,
    refId: campanhaId,
  });
  return {};
}
