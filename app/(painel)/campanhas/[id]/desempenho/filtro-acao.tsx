"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { paramsFiltroAcao } from "@/src/lib/regras/leadscore";
import { estiloInput } from "../../../_componentes/ui";

/** Select "Filtrar por ação" da aba Desempenho: filtra ao escolher, sem botão
 *  "Filtrar" — mesmo padrão do `SeletorLinhas` (sem prop de função, só dados: a lista de disparos e o valor
 *  atual). Rótulo flutuante, sem a opção "Todos os disparos" escrita (fica vazia). */
export function FiltroAcao({ disparos, valor }: { disparos: { id: string; rotulo: string }[]; valor: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function aoMudar(novo: string) {
    const params = paramsFiltroAcao(searchParams, novo);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <label className="relative block w-full max-w-sm">
      <span className="pointer-events-none absolute -top-2 left-2 z-10 bg-vg-bg px-1 text-[11px] leading-4 text-vg-text-2">Filtrar por ação</span>
      <select
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        aria-label="Filtrar por ação"
        className={`${estiloInput} w-full`}
      >
        <option value="" />
        {disparos.map((d) => (
          <option key={d.id} value={d.id}>{d.rotulo}</option>
        ))}
      </select>
    </label>
  );
}
