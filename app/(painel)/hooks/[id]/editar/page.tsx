import { notFound } from "next/navigation";
import { permitido } from "@/src/lib/permissoes";
import { ehUuid } from "@/src/lib/regras/uuid";
import { EVENTOS_WEBHOOK, type Evento } from "@/src/lib/regras/webhooks";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { bloqueio } from "../../../_componentes/guarda";
import { SemAcesso } from "../../../_componentes/sem-acesso";
import type { CampanhaOpcao, WebhookLinha } from "../../comum";
import { AssistenteHook } from "../../novo/assistente";

export const dynamic = "force-dynamic";

/** Mesmo assistente da criação, com o webhook carregado. O token atual não vem daqui (`authenticated` não lê a
 *  coluna `segredo`): o assistente pede pela action `lerToken(id)`, que exige Hooks/editar. */
export default async function EditarHook({ params }: { params: Promise<{ id: string }> }) {
  const b = await bloqueio("webhooks");
  if (b) return b;
  if (!(await permitido("webhooks", "editar"))) return <SemAcesso />;
  const { id } = await params;
  if (!ehUuid(id)) notFound();
  const db = await dbUsuario();
  const [w, campanhas] = await Promise.all([
    db.from("webhooks").select("id, created_at, nome, url, eventos, campanhas, ativo, arquivado").eq("id", id).maybeSingle(),
    db.from("campanhas").select("id, nome").eq("arquivada", false).order("nome"),
  ]);
  if (w.error) throw new Error(`Não foi possível carregar o hook: ${w.error.message}`);
  if (campanhas.error) throw new Error(`Não foi possível carregar as campanhas: ${campanhas.error.message}`);
  if (!w.data) notFound();
  const webhook = w.data as WebhookLinha;
  return (
    <AssistenteHook
      campanhas={(campanhas.data ?? []) as CampanhaOpcao[]}
      inicial={{
        id: webhook.id,
        nome: webhook.nome,
        url: webhook.url,
        eventos: webhook.eventos.filter((ev): ev is Evento => (EVENTOS_WEBHOOK as readonly string[]).includes(ev)),
        campanhas: webhook.campanhas,
      }}
    />
  );
}
