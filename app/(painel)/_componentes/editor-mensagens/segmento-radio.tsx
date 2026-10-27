"use client";
import { useRef } from "react";
import { proximoIndiceRadio } from "@/src/lib/regras/teclado-radio";

/** Grupo de botões segmentados com semântica de rádio (`radiogroup`/`radio`) — usado nas opções de envio da coluna
 *  direita do editor de mensagens e no assistente de ação. Diferente de `Segmentos` (ui.tsx, que usa `tablist`/`tab`):
 *  aqui cada opção é uma escolha única entre alternativas, não uma aba. Teclado como rádio nativo (roving tabindex):
 *  só a opção marcada entra no Tab, e as setas (←/→, ↑/↓, Home/End) mudam a escolha e o foco. */
export function SegmentoRadio<T extends string>({ legenda, info, opcoes, valor, aoMudar, larguraTotal = false }: {
  legenda: string;
  /** Ícone/dica ao lado da legenda (ex.: `info_outline` em "Marcar todos os participantes".16). */
  info?: React.ReactNode;
  opcoes: { valor: T; rotulo: string }[];
  valor: T;
  aoMudar: (v: T) => void;
  /** Opções em partes iguais ocupando a largura, selecionada em amarelo cheio (editor de mensagens, direita).
   *  Padrão `false` = hoje. */
  larguraTotal?: boolean;
}) {
  const botoes = useRef<(HTMLButtonElement | null)[]>([]);
  const marcado = opcoes.findIndex((o) => o.valor === valor);
  // Sem nenhuma marcada (valor fora da lista), a primeira fica no Tab.
  const noTab = marcado >= 0 ? marcado : 0;

  function aoTeclar(e: React.KeyboardEvent<HTMLButtonElement>, i: number) {
    const j = proximoIndiceRadio(e.key, i, opcoes.length);
    if (j === null) return;
    e.preventDefault();
    aoMudar(opcoes[j].valor);
    botoes.current[j]?.focus();
  }

  return (
    <div className="space-y-1.5">
      <span className="flex items-center gap-1 text-[12.5px] text-vg-text-2">
        {legenda}
        {info}
      </span>
      <div
        role="radiogroup"
        aria-label={legenda}
        className={`inline-flex max-w-full rounded-[10px] border border-white/[0.14] p-0.5 ${larguraTotal ? "w-full" : "flex-wrap gap-1"}`}
      >
        {opcoes.map((o, i) => (
          <button
            key={o.valor}
            ref={(el) => {
              botoes.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={o.valor === valor}
            tabIndex={i === noTab ? 0 : -1}
            onClick={() => aoMudar(o.valor)}
            onKeyDown={(e) => aoTeclar(e, i)}
            className={`rounded-[8px] py-1 text-[12.5px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-vg-accent/60 ${larguraTotal ? "min-w-0 flex-1 px-1.5 sm:px-3" : "whitespace-nowrap px-3"} ${
              o.valor === valor
                ? larguraTotal
                  ? "bg-vg-primario text-white"
                  : "bg-vg-accent/15 text-vg-accent ring-1 ring-vg-accent/60"
                : "text-[#e3e9e5] hover:text-white"
            }`}
          >
            {o.rotulo}
          </button>
        ))}
      </div>
    </div>
  );
}
