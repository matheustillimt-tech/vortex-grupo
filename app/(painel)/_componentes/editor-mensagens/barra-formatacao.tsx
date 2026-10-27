"use client";
import { aplicarFormatacao, type FormatoAplicavel } from "@/src/lib/regras/formatacao";
import { Icone } from "../icone";

export const BOTOES_FORMATACAO: { formato: FormatoAplicavel; icone: string; titulo: string; tecla: string; shift: boolean }[] = [
  { formato: "negrito", icone: "format_bold", titulo: "Negrito (⌘B)", tecla: "b", shift: false },
  { formato: "italico", icone: "format_italic", titulo: "Itálico (⌘I)", tecla: "i", shift: false },
  { formato: "tachado", icone: "format_strikethrough", titulo: "Tachado (⌘⇧X)", tecla: "x", shift: true },
  { formato: "monoespacado", icone: "code", titulo: "Monoespaçado (⌘⇧M)", tecla: "m", shift: true },
  { formato: "citacao", icone: "format_quote", titulo: "Citação", tecla: "", shift: false },
];

/** Aplica a marcação do WhatsApp na seleção do `textarea` (ou alterna se já estiver aplicada) e repõe o foco +
 *  seleção nova. Usado pela barra de botões e pelos atalhos (⌘B, ⌘I, ⌘⇧X, ⌘⇧M — citação só pelo botão), que o
 *  `textarea` do rascunho liga no próprio `onKeyDown` (ver `campo-rascunho.tsx`) pra funcionar com o foco nele. */
export function useFormatacao(refTextarea: React.RefObject<HTMLTextAreaElement | null>, valor: string, aoMudar: (v: string) => void) {
  function aplicar(formato: FormatoAplicavel) {
    const el = refTextarea.current;
    const inicio = el?.selectionStart ?? valor.length;
    const fim = el?.selectionEnd ?? valor.length;
    const r = aplicarFormatacao(valor, inicio, fim, formato);
    aoMudar(r.texto);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(r.inicio, r.fim);
    });
  }

  function aoTeclar(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!(e.metaKey || e.ctrlKey)) return;
    const tecla = e.key.toLowerCase();
    const alvo = BOTOES_FORMATACAO.find((b) => b.tecla === tecla && b.shift === e.shiftKey);
    if (!alvo) return;
    e.preventDefault();
    aplicar(alvo.formato);
  }

  return { aplicar, aoTeclar };
}

/** Barra `format_bold`/`format_italic`/`format_strikethrough`/`code`/`format_quote` do centro do editor. */
export function BarraFormatacao({ aoAplicar }: { aoAplicar: (formato: FormatoAplicavel) => void }) {
  return (
    <div role="toolbar" aria-label="Formatação" className="flex flex-wrap items-center gap-1">
      {BOTOES_FORMATACAO.map((b) => (
        <button
          key={b.formato}
          type="button"
          title={b.titulo}
          aria-label={b.titulo}
          onClick={() => aoAplicar(b.formato)}
          className="grid size-8 place-items-center rounded-md text-vg-text-2 transition-colors hover:bg-white/5 hover:text-white"
        >
          <Icone nome={b.icone} tamanho={18} />
        </button>
      ))}
    </div>
  );
}
