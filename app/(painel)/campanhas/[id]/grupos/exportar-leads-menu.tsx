"use client";
import { useEffect, useRef, useState } from "react";
import { ESTILO_BOTAO_FAIXA_CHEIO } from "../../../_componentes/faixa-botoes";
import { Icone } from "../../../_componentes/icone";

/** "EXPORTAR LEADS" + seta: duas planilhas com os mesmos filtros de sempre (`/api/exportar/pessoas`) — quem está
 *  dentro do grupo agora (`situacao=dentro`) ou todo mundo que já passou por ele (sem filtro de situação).
 *  Botão cheio (amarelo), ao lado de "EXPORTAR GRUPOS" e "ATUALIZAR LEADS" na faixa 1. */
export function ExportarLeadsMenu({ campanhaId }: { campanhaId: string }) {
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

  const base = `/api/exportar/pessoas?campanha=${encodeURIComponent(campanhaId)}`;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={aberto}
        onClick={() => setAberto((a) => !a)}
        className={ESTILO_BOTAO_FAIXA_CHEIO}
      >
        <Icone nome="cloud_download" />
        EXPORTAR LEADS
        <Icone nome="arrow_drop_down" />
      </button>
      {aberto && (
        <div role="menu" className="absolute right-0 top-full z-10 mt-1 w-56 overflow-hidden rounded-lg border border-vg-line bg-vg-panel py-1 shadow-xl">
          <a role="menuitem" href={`${base}&situacao=dentro`} className="block px-3 py-2 text-left text-[13px] text-vg-text transition-colors hover:bg-white/5">
            Leads no grupo agora
          </a>
          <a role="menuitem" href={base} className="block px-3 py-2 text-left text-[13px] text-vg-text transition-colors hover:bg-white/5">
            Todos os que passaram
          </a>
        </div>
      )}
    </div>
  );
}
