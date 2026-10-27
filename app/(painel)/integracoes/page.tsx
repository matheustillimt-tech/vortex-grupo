import { redirect } from "next/navigation";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";

/** Item "Integrações" do menu (19/10/2026): abre a primeira aba, Hooks. Também era o endereço antigo dos links
 *  de checkout (hoje os webhooks de checkout, aba Webhooks). */
export default async function Integracoes() {
  const b = await bloqueio("webhooks");
  if (b) return b;
  redirect("/hooks");
}
