import { bloqueio } from "@/app/(painel)/_componentes/guarda";
import { SemAcesso } from "@/app/(painel)/_componentes/sem-acesso";
import { permitido } from "@/src/lib/permissoes";
import { nomeDoGrupo, padraoNumerado } from "@/src/lib/regras/nome-grupo";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { AssistenteImportar } from "./assistente";

export const dynamic = "force-dynamic";

/** Página "Importar grupos": assistente de 3 passos, só pra quem edita Campanhas (move e
 *  importa grupos, não é leitura). */
export default async function ImportarGrupos({ params }: { params: Promise<{ id: string }> }) {
  const b = await bloqueio("campanhas");
  if (b) return b;
  if (!(await permitido("campanhas", "editar"))) return <SemAcesso />;
  const { id } = await params;
  const db = await dbUsuario();
  const { data: campanhas, error } = await db.from("campanhas").select("id, nome").eq("arquivada", false).neq("id", id).order("nome");
  if (error) throw new Error("Não foi possível carregar as campanhas.");
  const { data: esta } = await db.from("campanhas").select("padrao_nome, caractere_numeracao").eq("id", id).maybeSingle();
  // Exemplo do nome que os grupos importados recebem com "Seguir o padrão da campanha" (número ilustrativo).
  const exemploNome = esta?.padrao_nome ? nomeDoGrupo(padraoNumerado(esta.padrao_nome, esta.caractere_numeracao ?? ""), 1, { caractere: esta.caractere_numeracao ?? "" }) : null;

  return <AssistenteImportar campanhaId={id} campanhas={campanhas ?? []} exemploNome={exemploNome} />;
}
