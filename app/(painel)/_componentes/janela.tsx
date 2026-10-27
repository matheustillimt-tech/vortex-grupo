"use client";
import { useEffect, useId, useRef } from "react";
import { Icone } from "./icone";

const FOCAVEIS =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const LARGURA = { md: "max-w-xl", lg: "max-w-3xl" } as const;

/**
 * Janela (diálogo modal) genérica: fundo escuro irmão do painel, cabeçalho com título e "fechar", corpo com rolagem.
 * Foco vai para dentro ao abrir, Tab/Shift+Tab ficam presos (mesmo que algo dentro desative o elemento focado e o
 * foco caia pro <body>), Esc fecha e o foco volta para quem abriu. Só fecha pelo botão ou Esc (clique no fundo não
 * fecha, pra não perder uma ação em andamento por engano) e trava a rolagem do fundo enquanto está aberta.
 */
export function Janela({ aberta, aoFechar, titulo, children, largura = "md", icone, acaoTopo, semFechar = false }: {
  aberta: boolean;
  aoFechar: () => void;
  titulo: string;
  children: React.ReactNode;
  largura?: "md" | "lg";
  /** Ícone antes do título (ex.: "campaign"). */
  icone?: string;
  /** Botão antes do "close" do topo (ex.: `delete`). */
  acaoTopo?: React.ReactNode;
  /** Esconde o "close" do topo; Esc e clique fora do painel continuam fechando. Padrão `false` = hoje. */
  semFechar?: boolean;
}) {
  const idTitulo = useId();
  const refPainel = useRef<HTMLDivElement>(null);
  const refCorpo = useRef<HTMLDivElement>(null);
  const refFechar = useRef<HTMLButtonElement>(null);
  // Guarda a função mais recente sem reabrir o efeito (e sem roubar o foco) a cada renderização do pai.
  const refAoFechar = useRef(aoFechar);
  useEffect(() => {
    refAoFechar.current = aoFechar;
  });

  useEffect(() => {
    if (!aberta) return;
    const anterior = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const primeiro = refCorpo.current?.querySelector<HTMLElement>(FOCAVEIS) ?? refFechar.current ?? refPainel.current;
    primeiro?.focus();

    const corpoAnterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        refAoFechar.current();
        return;
      }
      if (e.key !== "Tab" || !refPainel.current) return;
      const focaveis = [...refPainel.current.querySelectorAll<HTMLElement>(FOCAVEIS)].filter((el) => el.offsetParent !== null || el === document.activeElement);
      const dentro = refPainel.current.contains(document.activeElement);
      // Foco fugiu do diálogo (ex.: algo dentro desativou o elemento focado e o navegador jogou pro <body>):
      // traz de volta pro primeiro focável, ou pro próprio painel se não houver nenhum.
      if (!dentro) {
        e.preventDefault();
        (focaveis[0] ?? refPainel.current).focus();
        return;
      }
      if (focaveis.length === 0) return;
      const primeiroFocavel = focaveis[0];
      const ultimo = focaveis[focaveis.length - 1];
      if (e.shiftKey && document.activeElement === primeiroFocavel) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primeiroFocavel.focus();
      }
    };
    document.addEventListener("keydown", aoTeclar);
    return () => {
      document.removeEventListener("keydown", aoTeclar);
      document.body.style.overflow = corpoAnterior;
      if (anterior?.isConnected) anterior.focus();
    };
  }, [aberta]);

  if (!aberta) return null;

  const botaoFechar = (
    <button
      ref={refFechar}
      type="button"
      onClick={aoFechar}
      aria-label="Fechar"
      className="grid size-8 place-items-center rounded-md text-vg-text-2 transition-colors hover:bg-white/5 hover:text-white"
    >
      <Icone nome="close" tamanho={20} />
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto px-4 pt-[7vh]">
      {/* Fundo: irmão do diálogo (não ancestral), pra não escondê-lo da leitura de tela. Nunca fecha ao
          clicar — com formulário dentro (ex.: "Cadastrar" de Leads/Deep links, que usam `semFechar`), um
          clique errado no fundo não pode apagar o que a pessoa já digitou. Só Esc e o botão "close" fecham. */}
      <div aria-hidden className="fixed inset-0 bg-black/60 backdrop-blur-[2px]" />
      <div
        ref={refPainel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        tabIndex={-1}
        className={`relative flex max-h-[85vh] w-full ${LARGURA[largura]} flex-col rounded-xl border border-vg-line bg-vg-panel shadow-xl`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-vg-line px-5 py-3.5">
          <h2 id={idTitulo} className={icone ? "flex items-center gap-2 text-[17px] font-medium" : "text-[17px] font-medium"}>
            {icone && <Icone nome={icone} tamanho={20} className="text-vg-text-2" />}
            {titulo}
          </h2>
          {acaoTopo ? (
            <div className="flex items-center gap-1">
              {acaoTopo}
              {!semFechar && botaoFechar}
            </div>
          ) : (
            !semFechar && botaoFechar
          )}
        </div>
        <div ref={refCorpo} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {children}
        </div>
      </div>
    </div>
  );
}
