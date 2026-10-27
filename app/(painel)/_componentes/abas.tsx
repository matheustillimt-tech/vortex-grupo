"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { estaAtivo } from "@/src/lib/regras/navegacao";
import { proximoFoco, SELETOR_ITEM_MENU } from "@/src/lib/regras/teclado-menu";
import { Icone } from "./icone";

/** `ativo` explícito vence o caminho (abas por parâmetro, como Ativas/Arquivadas). */
export type Aba = { href: string; rotulo: string; exato?: boolean; ativo?: boolean };

/** Faixa de abas com rolagem horizontal (Etapa 3B, Task 3.0): setas `chevron_left`/
 *  `chevron_right` nas pontas só aparecem quando a faixa não cabe no espaço, e desligam sozinhas na ponta em
 *  que já não dá pra rolar mais. Com `menu` (só a faixa da campanha usa), um botão no fim abre a lista completa das
 *  abas (atalho pra achar a aba certa sem rolar): ao abrir foca o primeiro item, setas Cima/Baixo e Home/End
 *  navegam, Esc fecha e devolve o foco. Mede com `ResizeObserver` na própria faixa e em cada aba (a faixa muda de
 *  largura com a janela ou com o menu lateral; as abas, com a lista e a fonte) e com o evento `scroll`. Ao montar,
 *  rola até a aba ativa, pra ela não ficar escondida numa faixa que transborda. */
export function Abas({ itens, menu = false }: { itens: Aba[]; menu?: boolean }) {
  const atual = usePathname();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [transbordo, setTransbordo] = useState(false);
  const [podeEsquerda, setPodeEsquerda] = useState(false);
  const [podeDireita, setPodeDireita] = useState(false);
  const [menuAberto, setMenuAberto] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const botaoMenuRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const medir = () => {
      setTransbordo(el.scrollWidth > el.clientWidth + 1);
      setPodeEsquerda(el.scrollLeft > 1);
      setPodeDireita(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    };
    medir();
    // A faixa e cada aba: o `scrollWidth` muda quando uma aba muda de largura (ex.: fonte carregou, lista trocou),
    // e isso não redimensiona a faixa em si. Um MutationObserver pega abas novas/removidas pra observar também.
    const ro = new ResizeObserver(medir);
    const observarTudo = () => {
      ro.disconnect();
      ro.observe(el);
      for (const filho of el.children) ro.observe(filho);
      medir();
    };
    observarTudo();
    const mo = new MutationObserver(observarTudo);
    mo.observe(el, { childList: true });
    el.addEventListener("scroll", medir, { passive: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
      el.removeEventListener("scroll", medir);
    };
  }, []);

  // Ao montar: a aba ativa entra na faixa visível (sem animar e sem rolar a página na vertical).
  useEffect(() => {
    const ativa = scrollRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    ativa?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, []);

  useEffect(() => {
    if (!menuAberto) return;
    const itensDoMenu = () => [...(menuRef.current?.querySelectorAll<HTMLElement>(SELETOR_ITEM_MENU) ?? [])];
    itensDoMenu()[0]?.focus();
    const aoClicarFora = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuAberto(false);
    };
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setMenuAberto(false);
        botaoMenuRef.current?.focus({ preventScroll: true });
        return;
      }
      const focaveis = itensDoMenu();
      const proximo = proximoFoco(focaveis.indexOf(document.activeElement as HTMLElement), focaveis.length, e.key);
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
  }, [menuAberto]);

  function rolar(sinal: 1 | -1) {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: sinal * el.clientWidth * 0.6, behavior: "smooth" });
  }

  const ligada = (a: Aba) => a.ativo ?? estaAtivo(a.href, atual, a.exato);

  return (
    <div className="flex items-stretch border-b border-vg-line">
      {transbordo && podeEsquerda && (
        <button
          type="button"
          aria-label="Rolar abas para a esquerda"
          onClick={() => rolar(-1)}
          className="grid shrink-0 place-items-center px-1 text-vg-text-2 transition-colors hover:text-white"
        >
          <Icone nome="chevron_left" tamanho={20} />
        </button>
      )}
      <nav ref={scrollRef} className="flex flex-1 overflow-x-auto text-[13.7px] font-medium [scrollbar-width:none]">
        {itens.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            aria-current={ligada(a) ? "page" : undefined}
            className={`shrink-0 whitespace-nowrap px-4 py-3 transition-colors ${ligada(a) ? "text-vg-accent shadow-[inset_0_-2px_0_var(--color-vg-accent)]" : "text-[#e3e9e5] hover:text-white"}`}
          >
            {a.rotulo}
          </Link>
        ))}
      </nav>
      {transbordo && podeDireita && (
        <button
          type="button"
          aria-label="Rolar abas para a direita"
          onClick={() => rolar(1)}
          className="grid shrink-0 place-items-center px-1 text-vg-text-2 transition-colors hover:text-white"
        >
          <Icone nome="chevron_right" tamanho={20} />
        </button>
      )}
      {menu && (
        <div ref={menuRef} className="relative flex shrink-0 items-stretch">
          <button
            ref={botaoMenuRef}
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuAberto}
            aria-label="Ver todas as abas"
            onClick={() => setMenuAberto((v) => !v)}
            className="grid shrink-0 place-items-center px-2 text-vg-text-2 transition-colors hover:text-white"
          >
            <Icone nome="menu" tamanho={20} />
          </button>
          {menuAberto && (
            <div role="menu" className="absolute right-0 top-full z-10 mt-1 max-h-80 w-56 overflow-y-auto rounded-lg border border-vg-line bg-vg-panel py-1 shadow-xl">
              {itens.map((a) => (
                <Link
                  key={a.href}
                  href={a.href}
                  role="menuitem"
                  aria-current={ligada(a) ? "page" : undefined}
                  onClick={() => setMenuAberto(false)}
                  className={`block truncate px-3 py-2 text-left text-[13px] transition-colors ${ligada(a) ? "text-vg-accent" : "text-vg-text hover:bg-white/5"}`}
                >
                  {a.rotulo}
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
