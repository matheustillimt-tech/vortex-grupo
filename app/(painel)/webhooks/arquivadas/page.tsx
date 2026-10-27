import { redirect } from "next/navigation";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";

/** Endereço antigo dos webhooks de SAÍDA arquivados (antes da Etapa 3H). Eles viraram Hooks: manda pra
 *  `/hooks/arquivadas`, com a busca/ordem/página que vieram. As arquivadas dos webhooks de checkout ficam em
 *  `/webhooks?aba=arquivadas`. */
export default async function WebhooksArquivadasAntigo({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const b = await bloqueio("webhooks");
  if (b) return b;
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) {
    for (const x of Array.isArray(v) ? v : v === undefined ? [] : [v]) p.append(k, x);
  }
  const s = p.toString();
  redirect(`/hooks/arquivadas${s ? `?${s}` : ""}`);
}
