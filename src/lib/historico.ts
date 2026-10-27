import "server-only";
import type { AcaoHistorico, AreaHistorico } from "./regras/historico";
import { dbAdmin } from "./supabase/admin";

export type UsuarioParaHistorico = { id: string; email?: string | null } | null | undefined;

export type EntradaHistorico = {
  acao: AcaoHistorico;
  area: AreaHistorico;
  /** Curto e em pt-BR; é cortado em 300 caracteres (limite da coluna). Nunca ponha telefone inteiro, texto de
   *  mensagem, URL com token, segredo ou token de convite por e-mail — telefone pode aparecer mascarado. */
  resumo: string;
  /** Id do registro afetado (ex.: campanha, grupo), pra uma tela futura poder linkar. Opcional. */
  refId?: string | null;
};

/** Grava uma linha em `historico` com `dbAdmin` (só o serviço grava; a tela lê como `authenticated`). Chame
 *  depois de cada ação do painel ter dado certo (nunca antes de validar nem antes do `error` da operação).
 *  Nunca lança: uma falha aqui não pode impedir nem desfazer a ação que já aconteceu — só fica no log do
 *  servidor, sem o resumo (que pode ter dado contexto de negócio que não precisa ir pro log de erro). */
export async function registrarHistorico(usuario: UsuarioParaHistorico, r: EntradaHistorico): Promise<void> {
  try {
    const { error } = await dbAdmin()
      .from("historico")
      .insert({
        usuario_id: usuario?.id ?? null,
        usuario_email: usuario?.email ?? null,
        acao: r.acao,
        area: r.area,
        resumo: r.resumo.slice(0, 300),
        ref_id: r.refId ?? null,
      });
    if (error) console.error(`[historico] não foi possível gravar (${r.acao}/${r.area}): ${error.message}`);
  } catch (e) {
    console.error(`[historico] não foi possível gravar (${r.acao}/${r.area}): ${e instanceof Error ? e.message : "erro inesperado"}`);
  }
}
