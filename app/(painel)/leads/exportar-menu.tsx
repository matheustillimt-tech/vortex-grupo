"use client";
import { useEffect, useRef, useState } from "react";
import { Icone } from "../_componentes/icone";
import { estiloBotao } from "../_componentes/ui";

/** "EXPORTAR LEADS" + seta: "Leads" exporta a Visão geral (cadastro — Nome,
 *  Número, Campos, Tags); "Participações" é a exportação de hoje (uma linha por participação). Usado nas duas
 *  abas, cada uma passando a própria URL (com os filtros atuais) pra cada opção. */
export function ExportarMenu({ leadsHref, participacoesHref }: { leadsHref: string; participacoesHref: string }) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const aoClicarFora = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener("mousedown", aoClicarFora);
    return () => document.removeEventListener("mousedown", aoClicarFora);
  }, [aberto]);

  return (
    <div ref={ref} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={aberto} onClick={() => setAberto((a) => !a)} className={estiloBotao("contorno")}>
        <Icone nome="download" />
        EXPORTAR LEADS
        <Icone nome="arrow_drop_down" />
      </button>
      {aberto && (
        <div role="menu" className="absolute right-0 top-full z-10 mt-1 w-48 overflow-hidden rounded-lg border border-vg-line bg-vg-panel py-1 shadow-xl">
          <a role="menuitem" href={leadsHref} className="block px-3 py-2 text-left text-[13px] text-vg-text transition-colors hover:bg-white/5">
            Leads
          </a>
          <a role="menuitem" href={participacoesHref} className="block px-3 py-2 text-left text-[13px] text-vg-text transition-colors hover:bg-white/5">
            Participações
          </a>
        </div>
      )}
    </div>
  );
}
