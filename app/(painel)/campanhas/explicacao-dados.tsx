"use client";
import { useState } from "react";
import { Icone } from "../_componentes/icone";
import { Janela } from "../_componentes/janela";

/** Ícone `info_outlined` "Entender como os dados são calculados": explicação curta dos números do
 *  cabeçalho e dos cartões da lista. */
export function ExplicacaoDados() {
  const [aberta, setAberta] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setAberta(true)}
        aria-label="Entender como os dados são calculados"
        className="grid size-7 place-items-center rounded-full text-vg-text-3 transition-colors hover:bg-white/5 hover:text-vg-text"
      >
        <Icone nome="info_outlined" tamanho={18} />
      </button>
      <Janela aberta={aberta} aoFechar={() => setAberta(false)} titulo="Entender como os dados são calculados">
        <div className="space-y-3 text-[13px] text-vg-text">
          <p>Cliques, entradas e saídas somam os eventos do período escolhido (7 a 90 dias) em todas as campanhas da lista.</p>
          <p>Participantes e grupos mostram o total atual (não dependem do período): quem já entrou e ainda está no grupo, e quantos grupos existem hoje.</p>
          <p>Grupos distintos de WhatsApp conta uma vez cada grupo real, mesmo quando mais de uma campanha aponta pra ele.</p>
        </div>
      </Janela>
    </>
  );
}
