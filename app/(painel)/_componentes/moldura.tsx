"use client";
import { useCallback, useRef, useState } from "react";
import type { AreaOuEquipe } from "@/src/lib/regras/permissoes";
import { Menu } from "./menu";
import { Topo } from "./topo";
import { TrilhaProvider } from "./trilha";

type Campanha = { id: string; nome: string };
type Conta = { id: string; nome: string };
type AvisoLista = { id: string; created_at: string; tipo: string; texto: string };

/** Dono do estado da gaveta do menu (celular): Menu + Topo + conteúdo. */
export function Moldura({
  email,
  campanhas,
  contas,
  avisos,
  avisosLista,
  areas,
  papel,
  atual,
  children,
}: {
  email: string;
  campanhas: Campanha[];
  contas: Conta[];
  avisos: number;
  /** Os 20 alertas não vistos mais novos, pra gaveta do sino; ausente (vitrine) = sem lista (gaveta vazia). */
  avisosLista?: AvisoLista[];
  /** Áreas com "ver" (menu); ausente = todas (vitrine). */
  areas?: readonly AreaOuEquipe[];
  /** Papel de quem está logado, pro diálogo "Meu Perfil"; ausente (vitrine) = Administrador. */
  papel?: "admin" | "membro";
  atual?: string;
  children: React.ReactNode;
}) {
  const [aberto, setAberto] = useState(false);
  const refBotaoMenu = useRef<HTMLButtonElement>(null);

  // `moverFoco = false` quando a gaveta fecha por clique num link de navegação
  // (o foco já vai pro conteúdo da nova página, não precisa voltar pro ☰).
  const fechar = useCallback((moverFoco: boolean = true) => {
    setAberto(false);
    if (moverFoco) refBotaoMenu.current?.focus();
  }, []);

  return (
    <TrilhaProvider>
      <Menu email={email} areas={areas} atual={atual} aberto={aberto} aoFechar={fechar} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topo
          email={email}
          campanhas={campanhas}
          contas={contas}
          avisos={avisos}
          avisosLista={avisosLista ?? []}
          areas={areas}
          papel={papel}
          verMetricas={!areas || areas.includes("metricas")}
          atual={atual}
          menuAberto={aberto}
          refBotaoMenu={refBotaoMenu}
          aoAbrirMenu={() => setAberto(true)}
        />
        {/* Folga embaixo (+ a faixa seguro do iOS/Android, `env(safe-area-inset-bottom)`): o fim da página não
         *  fica colado na borda nem na faixa de gestos do celular. */}
        <main className="min-w-0 flex-1 pb-6" style={{ paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom, 0px))" }}>
          {children}
        </main>
      </div>
    </TrilhaProvider>
  );
}
