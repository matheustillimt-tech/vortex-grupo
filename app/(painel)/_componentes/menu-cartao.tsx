"use client";
import { useEffect, useRef, useState } from "react";
import { proximoFoco, SELETOR_ITEM_MENU } from "@/src/lib/regras/teclado-menu";
import { Icone } from "./icone";

/** Item do menu "⋮" de um cartão (webhooks, projetos, ações…). Sem `icone`, fica só o texto (alinhado com os
 *  itens que têm ícone — ex.: "Fixar no topo"/"Desafixar"). */
export type ItemMenuCartao = {
  rotulo: string;
  icone?: string;
  onClick: () => void;
  perigo?: boolean;
  desabilitado?: boolean;
  /** Dica (`title`) pra quando `desabilitado` explica o motivo (ex.: grupo numa campanha). */
  dica?: string;
};

/**
 * Menu "⋮" de um cartão (terceiro uso: webhooks, projetos, ações — por isso virou componente compartilhado).
 * Ao abrir, foca o primeiro item habilitado. Enquanto aberto: Esc devolve o foco pro "⋮"; clique fora só fecha; as
 * setas Cima/Baixo (cíclicas) e Home/End navegam entre os itens, pulando os desabilitados. Escolher um item fecha o menu, devolve o foco pro "⋮" e só então
 * roda a ação — se ela abrir uma Janela, o foco (ainda no botão, que nunca sai do ar) é o que a Janela guarda
 * pra devolver quando ela fechar depois.
 */
export function MenuCartao({ itens, cabecalho, icone = "more_vert", rotulo = "Mais ações" }: {
  itens: ItemMenuCartao[];
  /** Bloco não clicável no topo do menu (ex.: nome + telefone da conta — Conta). */
  cabecalho?: React.ReactNode;
  /** Ícone do gatilho (padrão "more_vert"/"⋮"); o editor de mensagens usa "unfold_more" pra reordenar
   * . */
  icone?: string;
  rotulo?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const gatilhoRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!aberto) return;
    containerRef.current?.querySelector<HTMLButtonElement>(SELETOR_ITEM_MENU)?.focus();

    const fecharComFoco = () => {
      setAberto(false);
      gatilhoRef.current?.focus({ preventScroll: true });
    };
    const aoClicarFora = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setAberto(false);
    };
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        fecharComFoco();
        return;
      }
      const focaveis = [...(containerRef.current?.querySelectorAll<HTMLButtonElement>(SELETOR_ITEM_MENU) ?? [])];
      const proximo = proximoFoco(focaveis.indexOf(document.activeElement as HTMLButtonElement), focaveis.length, e.key);
      if (proximo === null) return;
      e.preventDefault();
      focaveis[proximo]?.focus();
    };
    document.addEventListener("mousedown", aoClicarFora);
    document.addEventListener("keydown", aoTeclar);
    return () => {
      document.removeEventListener("mousedown", aoClicarFora);
      document.removeEventListener("keydown", aoTeclar);
    };
  }, [aberto]);

  function escolher(it: ItemMenuCartao) {
    setAberto(false);
    gatilhoRef.current?.focus({ preventScroll: true });
    it.onClick();
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={gatilhoRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-label={rotulo}
        onClick={() => setAberto((a) => !a)}
        className="grid size-8 place-items-center rounded-md text-vg-text-2 transition-colors hover:bg-white/5 hover:text-white"
      >
        <Icone nome={icone} tamanho={20} />
      </button>
      {aberto && (
        <div role="menu" className="absolute right-0 top-full z-10 mt-1 w-52 overflow-hidden rounded-lg border border-vg-line bg-vg-panel py-1 shadow-xl">
          {cabecalho && <div className="border-b border-vg-line px-3 py-2">{cabecalho}</div>}
          {itens.map((it) => (
            <button
              key={it.rotulo}
              type="button"
              role="menuitem"
              disabled={it.desabilitado}
              onClick={() => escolher(it)}
              title={it.desabilitado ? it.dica : undefined}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors disabled:pointer-events-none disabled:opacity-40 ${it.perigo ? "text-vg-erro hover:bg-vg-erro/10" : "text-vg-text hover:bg-white/5"}`}
            >
              {it.icone ? <Icone nome={it.icone} tamanho={18} /> : <span className="inline-block size-[18px]" aria-hidden />}
              {it.rotulo}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
