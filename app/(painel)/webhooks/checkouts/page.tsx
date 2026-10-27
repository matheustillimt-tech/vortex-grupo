import { redirect } from "next/navigation";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";

/** A antiga aba "Checkouts" (links por plataforma + últimas vendas) virou os webhooks de checkout (Etapa 3H):
 *  cada um tem o detalhe próprio com o link e os eventos. */
export default async function WebhooksCheckoutsAntigo() {
  const b = await bloqueio("webhooks");
  if (b) return b;
  redirect("/webhooks");
}
