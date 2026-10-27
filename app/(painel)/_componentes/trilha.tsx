"use client";
import { createContext, useContext, useEffect, useLayoutEffect, useState } from "react";
import type { ItemTrilha } from "@/src/lib/regras/topo";

export type { ItemTrilha };

const Contexto = createContext<{ itens: ItemTrilha[] | null; definir: (i: ItemTrilha[] | null) => void }>({ itens: null, definir: () => {} });

export function TrilhaProvider({ children }: { children: React.ReactNode }) {
  const [itens, definir] = useState<ItemTrilha[] | null>(null);
  return <Contexto.Provider value={{ itens, definir }}>{children}</Contexto.Provider>;
}

export function useTrilha(): ItemTrilha[] | null {
  return useContext(Contexto).itens;
}

// `useLayoutEffect` não existe no servidor (SSR) — cai pra `useEffect` lá; no cliente, roda antes da pintura
// do navegador, pra reduzir o "flash" do rótulo genérico até a migalha deste contexto entrar em cena.
const useEfeitoDeCamada = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/** A página define o caminho da barra do topo enquanto está aberta (e limpa ao sair). Serve de reserva: a
 *  `Topo` calcula a migalha das campanhas direto do caminho + da lista que já tem em mãos (sem efeito, igual
 *  no servidor e no cliente); isso aqui só entra quando essa conta não bate (ex.: campanha arquivada). */
export function DefinirTrilha({ itens }: { itens: ItemTrilha[] }) {
  const { definir } = useContext(Contexto);
  const chave = JSON.stringify(itens);
  useEfeitoDeCamada(() => {
    definir(JSON.parse(chave) as ItemTrilha[]);
    return () => definir(null);
  }, [chave, definir]);
  return null;
}
