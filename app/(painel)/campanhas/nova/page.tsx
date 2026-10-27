import { redirect } from "next/navigation";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";
import { ehUuid } from "@/src/lib/regras/uuid";

/** `/campanhas/nova` virou o diálogo "Criar campanha": redireciona pra lista já aberta nele. O
 *  `?projeto=<id>` (botão "Campanha" da página do projeto) vai junto, só se for uuid — o diálogo abre com o
 *  projeto escolhido (e a lista já filtrada nele). O formulário completo (link, nome dos grupos, admins…)
 *  continua em "Configurações avançadas", na campanha já criada. */
export default async function NovaCampanha({ searchParams }: { searchParams: Promise<{ projeto?: string | string[] }> }) {
  const b = await bloqueio("campanhas");
  if (b) return b;
  const { projeto } = await searchParams;
  const id = Array.isArray(projeto) ? projeto[0] : projeto;
  redirect(ehUuid(id) ? `/campanhas?nova=1&projeto=${id}` : "/campanhas?nova=1");
}
