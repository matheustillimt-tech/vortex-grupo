import { dbAdmin } from "@/src/lib/supabase/admin";
import { Tela } from "../tela";
import { Verificador } from "./verificador";

export const dynamic = "force-dynamic";

const SemIndice = () => <meta name="robots" content="noindex" />;

/** Verificação de Colaboradores (seção da campanha): o lead digita um número e vê só "faz parte" ou "não faz parte"
 *  da equipe (contas associadas + a que cria os grupos). A consulta é POST (`verificarColaborador`), então o número
 *  nunca vai pra URL. Nunca mostra nomes, números nem a lista. */
export default async function Colaboradores({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { data: camp } = await dbAdmin().from("campanhas").select("id, arquivada, verificacao_colaboradores").eq("slug", slug).maybeSingle();
  if (!camp || camp.arquivada || camp.verificacao_colaboradores !== true) {
    return (
      <Tela>
        <SemIndice />
        <p className="text-sm text-vg-muted">Link indisponível.</p>
      </Tela>
    );
  }
  return (
    <Tela>
      <SemIndice />
      <h1 className="text-2xl font-semibold tracking-[-0.03em]">Verificação de Colaboradores</h1>
      <p className="text-sm text-vg-muted">Confira se o número que falou com você no privado é da equipe.</p>
      <Verificador slug={slug} />
    </Tela>
  );
}
