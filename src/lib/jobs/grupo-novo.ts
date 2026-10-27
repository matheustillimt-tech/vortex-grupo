import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { execucoesGrupoNovo, ultimasImportantes, type ExecucaoPassada } from "../regras/grupo-novo";
import { dbAdmin } from "../supabase/admin";

/** Grupo recém-criado recebe a mensagem fixa da campanha e as 3 últimas importantes já enviadas.
 *  Viram execuções `grupo_novo` só pra ele e saem pela fila (mesmas proteções). Devolve quantas criou. */
export async function criarGatilhosGrupoNovo(
  campanhaId: string,
  grupoId: string,
  mensagemFixa: string | null,
  agora: Date = new Date(),
  db: Pick<SupabaseClient, "from"> = dbAdmin(),
): Promise<number> {
  const { data, error } = await db
    .from("execucoes")
    .select("id, tipo, origem, status, importante, agendada_para, conteudo_final, alvo_contas, alvo_grupos")
    .eq("campanha_id", campanhaId)
    .eq("importante", true)
    .eq("status", "concluida")
    .neq("origem", "grupo_novo")
    .order("agendada_para", { ascending: false })
    .limit(10);
  if (error) throw new Error(`Não foi possível ler as mensagens importantes: ${error.message}`);
  const linhas = execucoesGrupoNovo({ campanhaId, grupoId, mensagemFixa, importantes: ultimasImportantes((data ?? []) as ExecucaoPassada[]), agora });
  if (!linhas.length) return 0;
  const { error: erroInsert } = await db.from("execucoes").insert(linhas);
  if (erroInsert) throw new Error(`Não foi possível agendar as mensagens do grupo novo: ${erroInsert.message}`);
  return linhas.length;
}
