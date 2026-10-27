"use client";
import { useId, useState } from "react";
import { Icone } from "@/app/(painel)/_componentes/icone";
import { estiloCartao } from "@/app/(painel)/_componentes/ui";

/** Cartão que abre/fecha (Alertas, por exemplo): botão com seta que gira, `aria-expanded`/`aria-controls`. */
export function Recolhivel({ titulo, subtitulo, icone, iniciaAberto = true, children }: {
  titulo: string;
  subtitulo?: string;
  icone?: string;
  iniciaAberto?: boolean;
  children: React.ReactNode;
}) {
  const [aberto, setAberto] = useState(iniciaAberto);
  const idConteudo = useId();

  return (
    <div className={estiloCartao}>
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-expanded={aberto}
        aria-controls={idConteudo}
        className="flex w-full items-center justify-between gap-3 p-4 text-left"
      >
        <span className="flex items-center gap-2 min-w-0">
          {icone && (
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-vg-accent/15 text-vg-accent">
              <Icone nome={icone} tamanho={18} />
            </span>
          )}
          <span className="min-w-0">
            <span className="block text-[15px] font-medium">{titulo}</span>
            {subtitulo && <span className="block text-xs text-vg-muted">{subtitulo}</span>}
          </span>
        </span>
        <Icone nome="expand_more" tamanho={20} className={`shrink-0 text-vg-muted transition-transform duration-200 ${aberto ? "rotate-180" : ""}`} />
      </button>
      <div id={idConteudo} hidden={!aberto} className="space-y-3 px-4 pb-4">
        {children}
      </div>
    </div>
  );
}
