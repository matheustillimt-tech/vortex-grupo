"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { AreaOuEquipe } from "@/src/lib/regras/permissoes";
import { AvatarFoto } from "./avatar-foto";
import { GavetaAlertas, type AlertaGaveta } from "./gaveta-alertas";
import { Icone } from "./icone";
import { MeuPerfil } from "./meu-perfil";
import { fotoNaTrilha, tituloDoCaminho, trilhaCampanha, trilhaConta } from "@/src/lib/regras/topo";
import { dbNavegador } from "@/src/lib/supabase/navegador";
import { useTrilha } from "./trilha";

type Campanha = { id: string; nome: string };
type Conta = { id: string; nome: string };

/** Barra do topo (52 px, sem fundo): caminho da tela à esquerda; sino e usuário à direita. */
export function Topo({
  email,
  campanhas,
  contas,
  avisos,
  avisosLista = [],
  areas,
  papel,
  verMetricas = true,
  menuAberto: gavetaAberta,
  refBotaoMenu,
  aoAbrirMenu,
  atual: forcado,
}: {
  email: string;
  campanhas: Campanha[];
  contas: Conta[];
  avisos: number;
  /** Os 20 alertas não vistos mais novos, pra gaveta do sino. */
  avisosLista?: AlertaGaveta[];
  /** Áreas que a pessoa vê: mostra "Equipe" no menu do usuário só pro Administrador. Ausente = todas (vitrine). */
  areas?: readonly AreaOuEquipe[];
  /** Papel de quem está logado, pro diálogo "Meu Perfil". Ausente (vitrine) = Administrador. */
  papel?: "admin" | "membro";
  /** Os avisos moram em Métricas: sem "ver" lá, a gaveta não mostra "Ver todos". */
  verMetricas?: boolean;
  menuAberto: boolean;
  refBotaoMenu: React.RefObject<HTMLButtonElement | null>;
  aoAbrirMenu: () => void;
  atual?: string;
}) {
  const caminho = usePathname();
  const titulo = tituloDoCaminho(forcado ?? caminho);
  // Campanha: calculada direto do caminho + da lista (sem efeito, sem flash — a aba está no próprio caminho,
  // ex. /campanhas/abc/grupos). Conta: a aba vive em `?aba=`, que o `usePathname` não traz, então o contexto
  // (`DefinirTrilha`, com efeito, montado pela própria página com a aba certa) vem primeiro; `trilhaConta` só
  // entra como fallback sem aba (ex.: antes do efeito montar, ou conta fora da lista, como arquivada).
  const trilhaContexto = useTrilha();
  const calculada = trilhaCampanha(forcado ?? caminho, campanhas);
  const trilha = (calculada && fotoNaTrilha(calculada, trilhaContexto)) ?? trilhaContexto ?? trilhaConta(forcado ?? caminho, contas);
  const [menuAberto, setMenuAberto] = useState(false);
  const [gavetaAlertasAberta, setGavetaAlertasAberta] = useState(false);
  const [perfilAberto, setPerfilAberto] = useState(false);
  const [linkCopiado, setLinkCopiado] = useState<string | null>(null);
  const refMenu = useRef<HTMLDivElement>(null);
  const refBotaoUsuario = useRef<HTMLButtonElement>(null);
  const refBotaoSino = useRef<HTMLButtonElement>(null);
  const router = useRouter();

  const nome = email.split("@")[0] || "";
  const nomeExibido = nome ? nome[0].toUpperCase() + nome.slice(1) : "";
  const inicial = nomeExibido ? nomeExibido[0].toUpperCase() : "?";
  const ehAdmin = !areas || areas.includes("equipe");
  const papelRotulo = papel === "membro" ? "Membro" : "Administrador";

  async function sair() {
    await dbNavegador().auth.signOut();
    router.replace("/login");
  }

  async function copiarLinkDaPagina() {
    try {
      await navigator.clipboard.writeText(location.href);
      setLinkCopiado("Link copiado");
    } catch {
      setLinkCopiado("Não foi possível copiar o link");
    }
    window.setTimeout(() => setLinkCopiado(null), 2000);
  }

  // Fecha o menu do usuário no clique fora ou Esc.
  useEffect(() => {
    if (!menuAberto) return;
    function aoClicarFora(e: MouseEvent) {
      if (refMenu.current && !refMenu.current.contains(e.target as Node)) setMenuAberto(false);
    }
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMenuAberto(false);
        refBotaoUsuario.current?.focus();
      }
    }
    window.addEventListener("mousedown", aoClicarFora);
    window.addEventListener("keydown", aoTeclar);
    return () => {
      window.removeEventListener("mousedown", aoClicarFora);
      window.removeEventListener("keydown", aoTeclar);
    };
  }, [menuAberto]);

  return (
    <header className="sticky top-0 z-30 flex h-[52px] items-center justify-between gap-3 border-b border-vg-line bg-vg-bg/90 px-4 backdrop-blur md:static md:border-0 md:bg-transparent md:px-6 md:backdrop-blur-none">
      <div className="flex min-w-0 items-center gap-3">
        <button
          ref={refBotaoMenu}
          type="button"
          onClick={aoAbrirMenu}
          aria-label="Abrir menu"
          aria-expanded={gavetaAberta}
          aria-controls="menu-lateral"
          className="rounded-lg p-1.5 text-vg-text-2 transition-colors hover:bg-white/5 hover:text-white md:hidden"
        >
          <Icone nome="menu" tamanho={20} />
        </button>
        {trilha ? (
          <nav aria-label="Caminho" className="min-w-0">
            <ol className="flex min-w-0 items-center text-[13px] font-medium">
              {trilha.map((item, i) => {
                const ultimo = i === trilha.length - 1;
                return (
                  <li
                    key={i}
                    aria-current={ultimo ? "page" : undefined}
                    className={`truncate max-w-[16ch] md:max-w-none ${i > 0 ? "border-l border-vg-line pl-3 ml-3" : ""}`}
                  >
                    {item.href ? (
                      <Link href={item.href} className={`transition-colors hover:text-white ${item.avatar ? "inline-flex max-w-full items-center gap-1.5 align-middle" : ""}`}>
                        {item.avatar && <AvatarFoto nome={item.rotulo} foto={item.foto} tamanho={20} />}
                        {item.avatar ? <span className="truncate">{item.rotulo}</span> : item.rotulo}
                      </Link>
                    ) : item.avatar ? (
                      <span className="inline-flex max-w-full items-center gap-1.5 align-middle">
                        <AvatarFoto nome={item.rotulo} foto={item.foto} tamanho={20} />
                        <span className="truncate">{item.rotulo}</span>
                      </span>
                    ) : (
                      item.rotulo
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>
        ) : (
          <p className="truncate text-[13px] font-medium">{titulo}</p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          ref={refBotaoSino}
          type="button"
          onClick={() => setGavetaAlertasAberta(true)}
          aria-label={avisos > 0 ? `${avisos} avisos não vistos` : "Avisos"}
          aria-haspopup="dialog"
          className="relative rounded-lg p-1.5 text-vg-text-2 transition-colors hover:bg-white/5 hover:text-white"
        >
          <Icone nome="notifications" tamanho={20} />
          {avisos > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex min-w-[16px] items-center justify-center rounded-full bg-vg-erro px-1 text-[10px] font-semibold leading-4 text-white">
              {avisos}
            </span>
          )}
        </button>

        <GavetaAlertas
          aberta={gavetaAlertasAberta}
          aoFechar={() => {
            setGavetaAlertasAberta(false);
            refBotaoSino.current?.focus();
          }}
          alertas={avisosLista}
          verMetricas={verMetricas}
        />

        <div ref={refMenu} className="relative">
          <button
            ref={refBotaoUsuario}
            type="button"
            onClick={() => setMenuAberto((v) => !v)}
            aria-expanded={menuAberto}
            aria-controls="menu-usuario"
            aria-label={`Menu de ${nomeExibido || email}`}
            className="flex items-center gap-2 rounded-lg p-1 text-[13px] text-vg-text-2 transition-colors hover:bg-white/5 hover:text-white"
          >
            <span aria-hidden className="hidden sm:inline">{nomeExibido}</span>
            <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-[#3a4a40] text-[13px] font-semibold text-white">
              {inicial}
            </span>
          </button>

          {menuAberto && (
            <div id="menu-usuario" className="absolute right-0 top-full z-50 mt-2 w-56 rounded-xl border border-vg-line bg-vg-panel-3 p-2 shadow-xl">
              <button
                type="button"
                onClick={() => {
                  setMenuAberto(false);
                  setPerfilAberto(true);
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-[7px] text-left text-sm text-vg-text-2 transition-colors hover:bg-white/5 hover:text-white"
              >
                <Icone nome="account_circle" tamanho={16} className="opacity-70" /> Meu Perfil
              </button>
              <button
                type="button"
                onClick={copiarLinkDaPagina}
                className="mt-0.5 flex w-full items-center gap-2.5 rounded-lg px-2 py-[7px] text-left text-sm text-vg-text-2 transition-colors hover:bg-white/5 hover:text-white"
              >
                <Icone nome="content_copy" tamanho={16} className="opacity-70" /> {linkCopiado ?? "Copiar link da página"}
              </button>
              {ehAdmin && (
                <Link
                  href="/equipe"
                  onClick={() => setMenuAberto(false)}
                  className="mt-0.5 flex w-full items-center gap-2.5 rounded-lg px-2 py-[7px] text-left text-sm text-vg-text-2 transition-colors hover:bg-white/5 hover:text-white"
                >
                  <Icone nome="people" tamanho={16} className="opacity-70" /> Equipe
                </Link>
              )}
              <button
                type="button"
                onClick={sair}
                className="mt-0.5 flex w-full items-center gap-2.5 rounded-lg px-2 py-[7px] text-left text-sm text-vg-text-2 transition-colors hover:bg-white/5 hover:text-white"
              >
                <Icone nome="exit_to_app" tamanho={16} className="opacity-70" /> Sair
              </button>
            </div>
          )}
        </div>
      </div>

      <MeuPerfil aberta={perfilAberto} aoFechar={() => setPerfilAberto(false)} nome={nomeExibido || email} email={email} papel={papelRotulo} />
    </header>
  );
}
