"use client";
import { useState } from "react";
import { Icone } from "./icone";
import { Janela } from "./janela";
import { estiloBotao } from "./ui";

/**
 * Ícone `info_outlined` que abre uma `Janela` com texto explicativo — o mesmo padrão do `ExplicacaoDados` de
 * Campanhas, mas genérico (texto por prop, não função). Usado ao lado de títulos quando a explicação não cabe
 * como subtítulo sempre visível.
 */
export function BotaoInfo({ titulo, texto, rotulo, tamanho = 18, icone = "info_outlined" }: { titulo: string; texto: React.ReactNode; rotulo?: string; tamanho?: number; icone?: string }) {
  const [aberta, setAberta] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setAberta(true)}
        aria-label={rotulo ?? titulo}
        className="grid size-6 place-items-center rounded-full text-vg-text-3 transition-colors hover:bg-white/5 hover:text-vg-text"
      >
        <Icone nome={icone} tamanho={tamanho} />
      </button>
      <Janela aberta={aberta} aoFechar={() => setAberta(false)} titulo={titulo}>
        <div className="space-y-3 text-[13px] text-vg-text">{texto}</div>
      </Janela>
    </>
  );
}

/** Botão de contorno com rótulo (ex.: "Documentação") que abre a mesma `Janela` explicativa do `BotaoInfo` — pra
 *  quando o botão precisa ficar ao lado de outros botões de verdade (ex.: "Configurar"/"Visualizar"), em vez de
 *  só o ícone `info_outlined`. */
export function BotaoInfoBotao({ titulo, texto, rotulo, icone = "menu_book" }: { titulo: string; texto: React.ReactNode; rotulo: string; icone?: string }) {
  const [aberta, setAberta] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setAberta(true)} className={estiloBotao("contorno")}>
        <Icone nome={icone} tamanho={16} /> {rotulo}
      </button>
      <Janela aberta={aberta} aoFechar={() => setAberta(false)} titulo={titulo}>
        <div className="space-y-3 text-[13px] text-vg-text">{texto}</div>
      </Janela>
    </>
  );
}
