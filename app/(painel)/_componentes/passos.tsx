"use client";
import { Icone } from "./icone";

export type PassoBarra = { rotulo: string; icone: string; liberado?: boolean };

/** Barra de passos do topo: bolinhas amarelas de 32 px até o atual, cinza nas futuras, ligadas
 *  por linha (amarela até o atual) e rótulo embaixo. Passo com `liberado` (já visitado) vira botão quando há `aoIr`. */
export function Passos({ passos, atual, aoIr }: { passos: PassoBarra[]; atual: number; aoIr?: (indice: number) => void }) {
  return (
    <nav aria-label="Passos">
      <ol className="flex items-start">
        {passos.map((p, i) => {
          const feito = i <= atual;
          const clicavel = !!aoIr && p.liberado && i !== atual;
          const bolinha = (
            <span
              aria-hidden
              className={`grid size-8 place-items-center rounded-full transition-colors ${feito ? "bg-vg-primario text-white" : "bg-[#2f3a33] text-vg-text-3"}`}
            >
              <Icone nome={p.icone} tamanho={18} />
            </span>
          );
          const rotulo = <span className={`text-center text-[12px] leading-4 ${i === atual ? "font-semibold text-vg-text" : feito ? "text-vg-text-2" : "text-vg-text-3"}`}>{p.rotulo}</span>;
          return (
            <li key={`${p.rotulo}-${i}`} aria-current={i === atual ? "step" : undefined} className="relative flex min-w-0 flex-1 flex-col items-center">
              {i > 0 && (
                <span aria-hidden className={`absolute right-1/2 top-[16px] h-0.5 w-full -translate-y-1/2 ${i <= atual ? "bg-vg-accent" : "bg-[#2f3a33]"}`} />
              )}
              {clicavel ? (
                <button
                  type="button"
                  onClick={() => aoIr?.(i)}
                  className="relative flex flex-col items-center gap-1.5 rounded-md px-1 outline-none focus-visible:ring-2 focus-visible:ring-vg-accent/50"
                >
                  {bolinha}
                  {rotulo}
                  <span className="sr-only">(ir para este passo)</span>
                </button>
              ) : (
                <span className="relative flex flex-col items-center gap-1.5 px-1">
                  {bolinha}
                  {rotulo}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
