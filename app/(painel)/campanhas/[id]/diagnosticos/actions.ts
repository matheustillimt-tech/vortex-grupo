"use server";
import { revalidatePath } from "next/cache";
import { THROTTLE_VERIFICAR_COMPATIBILIDADE_MS } from "@/src/lib/regras/analises";
import { registrarHistorico } from "@/src/lib/historico";
import { checarPermissao } from "@/src/lib/permissoes";
import { dbAdmin } from "@/src/lib/supabase/admin";

/** Botão "Verificar compatibilidade": pede a conferência imediata dos grupos ativos de UMA conta
 *  (limpa `grupos.conferido_em`, igual "ATUALIZAR LEADS" faz pra campanha inteira.4). Travado
 *  em 1 pedido por conta a cada 2 minutos (`verificacoes_contas`), pra não disparar a conferência em excesso. */
export async function verificarCompatibilidade(campanhaId: string, conexaoId: string): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  const db = dbAdmin();

  const { data: anterior, error: erroLer } = await db
    .from("verificacoes_contas")
    .select("verificado_em")
    .eq("campanha_id", campanhaId)
    .eq("conexao_id", conexaoId)
    .maybeSingle();
  if (erroLer) return { erro: "Não foi possível conferir a conexão." };
  const ultima = (anterior as { verificado_em: string } | null)?.verificado_em;
  if (ultima && Date.now() - Date.parse(ultima) < THROTTLE_VERIFICAR_COMPATIBILIDADE_MS) {
    return { erro: "Aguarde 2 minutos entre duas verificações desta conexão." };
  }

  const agora = new Date().toISOString();
  const { error: erroUpsert } = await db
    .from("verificacoes_contas")
    .upsert({ campanha_id: campanhaId, conexao_id: conexaoId, verificado_em: agora }, { onConflict: "campanha_id,conexao_id" });
  if (erroUpsert) return { erro: "Não foi possível pedir a verificação. Tente de novo." };

  const { error: erroGrupos } = await db.from("grupos").update({ conferido_em: null }).eq("campanha_id", campanhaId).eq("conexao_id", conexaoId).eq("ativo", true);
  if (erroGrupos) return { erro: "Não foi possível pedir a conferência dos grupos. Tente de novo." };

  revalidatePath(`/campanhas/${campanhaId}/diagnosticos`);
  await registrarHistorico(usuario, { acao: "executar", area: "Grupos", resumo: "Verificação de compatibilidade pedida para uma conexão (Diagnósticos)", refId: campanhaId });
  return {};
}
