"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { Icone } from "./icone";
import type { AreaOuEquipe } from "@/src/lib/regras/permissoes";
import { arvoreMenuVisivel, ehGrupoMenu, grupoAtivo, ITENS_MENU, menuAtivo, type NoMenu } from "@/src/lib/regras/topo";
import { dbNavegador } from "@/src/lib/supabase/navegador";
import { Marca } from "./ui";

/** Item simples (Link), usado solto ou dentro de um grupo (`recuado`: subitem a 28 px). */
function ItemDoMenu({
  item,
  atual,
  recuado,
  onClick,
}: {
  item: { href: string; rotulo: string; icone: string; tambem?: string[]; selo?: string };
  atual: string;
  recuado?: boolean;
  onClick: () => void;
}) {
  const ativo = menuAtivo(item, atual);
  return (
    <Link
      href={item.href}
      title={item.rotulo}
      onClick={onClick}
      aria-current={ativo ? "page" : undefined}
      className={`relative flex h-10 items-center gap-4 rounded-md pr-3 text-[13px] transition-colors ${recuado ? "pl-[28px]" : "pl-[22px]"} ${
        ativo ? "text-vg-accent" : "text-vg-text-2 hover:bg-white/5 hover:text-white"
      }`}
    >
      {ativo && <span aria-hidden className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-vg-accent" />}
      <Icone nome={item.icone} tamanho={20} className={ativo ? "text-vg-accent" : ""} />
      <span className="flex min-w-0 flex-1 items-center gap-1.5 whitespace-nowrap md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
        <span className="truncate">{item.rotulo}</span>
        {item.selo && (
          <span aria-hidden className="shrink-0 rounded-full border border-vg-accent/50 px-1.5 py-[1px] text-[9px] font-semibold leading-tight text-vg-accent">
            {item.selo}
          </span>
        )}
      </span>
    </Link>
  );
}

/** Item ou grupo em acordeão: clique no grupo abre/fecha os subitens, com a seta `expand_more`
 *  girando; o grupo que contém a página atual nasce aberto. `mostrarRotulo=false` esconde texto/seta (faixa
 *  fechada do desktop, antes do hover) sem deixar de renderizar os subitens quando abertos — quem decide se eles
 *  aparecem de fato é o `overflow-hidden`/largura da faixa (CSS, via `group-hover`). */
function NoDoMenu({
  no,
  atual,
  mostrarQuandoFechado,
  onClick,
}: {
  no: NoMenu;
  atual: string;
  /** true: desenha os subitens sempre que abertos (gaveta do celular, sempre expandida). */
  mostrarQuandoFechado: boolean;
  onClick: () => void;
}) {
  const [aberto, setAberto] = useState(() => ehGrupoMenu(no) && grupoAtivo(atual) === no.grupo);
  const contemAtual = ehGrupoMenu(no) && grupoAtivo(atual) === no.grupo;
  // Navegou (sem recarregar) para uma página deste grupo: abre o grupo.
  useEffect(() => {
    if (contemAtual) setAberto(true);
  }, [contemAtual]);

  const idGerado = useId();
  if (!ehGrupoMenu(no)) return <ItemDoMenu item={no} atual={atual} onClick={onClick} />;

  const id = `menu-grupo-${no.grupo}-${idGerado}`;
  const grupoComItemAtivo = no.itens.some((i) => menuAtivo(i, atual));

  return (
    <div>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        aria-controls={id}
        className={`flex h-10 w-full items-center gap-4 rounded-md pl-[22px] pr-3 text-left text-[13px] transition-colors ${
          aberto ? "bg-white/5 text-white" : "text-vg-text-2 hover:bg-white/5 hover:text-white"
        } ${grupoComItemAtivo && !aberto ? "text-white" : ""}`}
      >
        <Icone nome={no.icone} tamanho={20} />
        <span className="flex-1 whitespace-nowrap md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">{no.rotulo}</span>
        <Icone
          nome="expand_more"
          tamanho={18}
          className={`shrink-0 transition-transform duration-200 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 ${aberto ? "rotate-180" : ""}`}
        />
      </button>
      <div id={id} className={aberto ? (mostrarQuandoFechado ? "space-y-0.5 py-0.5" : "hidden space-y-0.5 py-0.5 md:group-hover:block md:group-focus-within:block") : "hidden"}>
        {no.itens.map((i) => (
          <ItemDoMenu key={i.href} item={i} atual={atual} recuado onClick={onClick} />
        ))}
      </div>
    </div>
  );
}

/** Menu lateral: faixa de 64 px com ícones que abre por cima com 230 px no hover (desktop); gaveta no celular.
 *  Grupos em acordeão: clique no grupo abre/fecha, a seta `expand_more` gira, o grupo
 *  que contém a página atual nasce aberto, subitens recuados 28 px.
 *  `areas`: áreas que a pessoa vê (itens sem "ver" somem, grupo sem nenhum subitem visível também); ausente = todos (vitrine).
 *  `atual` força o item aceso (vitrine). `aberto`/`aoFechar` controlam a gaveta do celular (estado fica em `Moldura`). */
export function Menu({
  email,
  areas,
  atual: forcado,
  aberto,
  aoFechar,
}: {
  email: string;
  areas?: readonly AreaOuEquipe[];
  atual?: string;
  aberto: boolean;
  aoFechar: (moverFoco?: boolean) => void;
}) {
  const caminho = usePathname();
  const atual = forcado ?? caminho;
  const router = useRouter();
  const arvore = areas ? arvoreMenuVisivel(areas) : ITENS_MENU;

  async function sair() {
    await dbNavegador().auth.signOut();
    router.replace("/login");
  }

  // Esc fecha a gaveta.
  useEffect(() => {
    if (!aberto) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") aoFechar();
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aberto, aoFechar]);

  return (
    <>
      {/* Fundo escuro da gaveta no celular. */}
      {aberto && <div aria-hidden onClick={() => aoFechar()} className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px] md:hidden" />}

      {/* Desktop (md+): faixa fixa de 64 px que não empurra o conteúdo; o painel interno abre por cima no hover/focus. */}
      <aside className="sticky top-0 z-40 hidden h-screen w-16 shrink-0 md:block">
        <nav
          aria-label="Menu principal"
          className="group absolute inset-y-0 left-0 z-40 w-16 overflow-hidden bg-vg-side transition-[width] duration-200 hover:w-[230px] focus-within:w-[230px]"
        >
          <div className="flex h-[52px] items-center justify-between pl-[18px] pr-2">
            <div className="flex min-w-0 items-center">
              <Marca comNome={false} />
              <span className="ml-2 whitespace-nowrap text-[15px] font-semibold tracking-[-0.01em] opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
                Vórtex Grupo
              </span>
            </div>
          </div>
          <div className="space-y-0.5 px-2 py-2">
            {arvore.map((no) => (
              <NoDoMenu key={ehGrupoMenu(no) ? no.grupo : no.href} no={no} atual={atual} mostrarQuandoFechado={false} onClick={() => aoFechar(false)} />
            ))}
          </div>
        </nav>
      </aside>

      {/* Celular: gaveta. Fechada: invisible (sai do tab order e da árvore de acessibilidade). */}
      <aside
        id="menu-lateral"
        className={`fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col bg-vg-side px-2 py-4 transition-[transform,visibility] duration-200 md:hidden ${
          aberto ? "visible translate-x-0" : "invisible -translate-x-full"
        }`}
      >
        <div className="mb-5 flex items-center justify-between px-2.5">
          <Marca />
          <button type="button" onClick={() => aoFechar()} aria-label="Fechar menu" className="rounded-lg p-1.5 text-vg-text-2 hover:bg-white/5">
            <Icone nome="close" tamanho={16} />
          </button>
        </div>

        <nav aria-label="Menu principal" className="flex-1 space-y-0.5 overflow-y-auto">
          {arvore.map((no) => (
            <NoDoMenu key={ehGrupoMenu(no) ? no.grupo : no.href} no={no} atual={atual} mostrarQuandoFechado onClick={() => aoFechar(false)} />
          ))}
        </nav>

        <div className="mt-4 border-t border-vg-line pt-3">
          <p className="truncate px-2.5 text-xs text-vg-muted" title={email}>{email}</p>
          <button
            type="button"
            onClick={sair}
            className="mt-1 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-left text-sm text-vg-text-2 transition-colors hover:bg-white/5 hover:text-white"
          >
            <Icone nome="logout" tamanho={16} className="opacity-70" /> Sair
          </button>
        </div>
      </aside>
    </>
  );
}
