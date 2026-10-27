"use client";
import { useRouter } from "next/navigation";

/** Chip "ATUALIZAR" do cabeçalho dos gráficos: só recarrega os dados da
 *  página (`router.refresh`), sem disparar nenhuma consulta nova daqui. */
export function ChipAtualizar() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.refresh()}
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-vg-line-2 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-vg-text-2 transition-colors hover:border-white/60 hover:text-white"
    >
      ATUALIZAR
    </button>
  );
}
