"use client";
import { useEffect, useRef, useState } from "react";
import { Icone } from "../icone";
import { estiloAcao } from "../ui";
import { EMOJIS } from "./emojis";

/** Botão "EMOJI": abre um popover com a grade dos ~60 mais usados (sem biblioteca externa) e insere o escolhido
 *  na posição do cursor do `textarea` em foco. */
export function SeletorEmoji({ aoEscolher }: { aoEscolher: (emoji: string) => void }) {
  const [aberto, setAberto] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const aoClicarFora = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setAberto(false);
    };
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAberto(false);
    };
    document.addEventListener("mousedown", aoClicarFora);
    document.addEventListener("keydown", aoTeclar);
    return () => {
      document.removeEventListener("mousedown", aoClicarFora);
      document.removeEventListener("keydown", aoTeclar);
    };
  }, [aberto]);

  return (
    <div ref={containerRef} className="relative inline-block">
      <button type="button" aria-haspopup="true" aria-expanded={aberto} className={`inline-flex items-center gap-1.5 ${estiloAcao.normal}`} onClick={() => setAberto((v) => !v)}>
        <Icone nome="mood" tamanho={18} />
        EMOJI
      </button>
      {aberto && (
        <div role="dialog" aria-label="Escolher emoji" className="absolute bottom-full left-0 z-10 mb-1 grid w-64 grid-cols-10 gap-0.5 rounded-lg border border-vg-line bg-vg-panel p-2 shadow-xl">
          {EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              aria-label={`Inserir ${e}`}
              className="grid size-6 place-items-center rounded text-[15px] transition-colors hover:bg-white/10"
              onClick={() => {
                aoEscolher(e);
                setAberto(false);
              }}
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
