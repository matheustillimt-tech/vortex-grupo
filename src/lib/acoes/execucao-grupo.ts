import "server-only";
import { revalidatePath } from "next/cache";
import { validarConteudo, type TipoExecucao } from "../regras/conteudo";
import type { dbAdmin } from "../supabase/admin";

type DB = ReturnType<typeof dbAdmin>;
type Usuario = { id: string; email?: string | null };

/** Execução `avulsa` ou `massa` (fila de 3–8 s, igual às outras): grava, revalida e confere o conteúdo pelo tipo.
 *  Um só lugar que grava execução de grupo: ações de linha e faixa, "Mais ações", "Alterar grupos em lote" (Etapa 3E)
 *  e "Exigir aprovação" da aba Solicitações de entrada (Etapa 3M, Tarefa 4). Extraída de
 *  `app/(painel)/campanhas/[id]/grupos/actions.ts` sem mudar nada: arquivo "use server" não pode exportar função que
 *  não seja ação (viraria uma ação chamável pelo navegador). */
export async function inserirExecucao(db: DB, usuario: Usuario, campanhaId: string, origem: "avulsa" | "massa", tipo: TipoExecucao, conteudo: unknown, grupos: string[] | null): Promise<{ erro?: string }> {
  const v = validarConteudo(tipo, conteudo);
  if (!v.ok) return { erro: v.erro };
  const { error } = await db.from("execucoes").insert({
    campanha_id: campanhaId, origem, tipo, conteudo: v.valor, agendada_para: new Date().toISOString(), alvo_grupos: grupos, criada_por: usuario.id,
  });
  if (error) return { erro: "Não foi possível salvar a ação." };
  revalidatePath(`/campanhas/${campanhaId}`, "layout");
  revalidatePath("/calendario");
  return {};
}
