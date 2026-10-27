"use client";
import { useState } from "react";
import { ESTILO_BOTAO_FAIXA_CHEIO } from "../../../_componentes/faixa-botoes";
import { Icone } from "../../../_componentes/icone";
import { atualizarLeads } from "./actions";

/** Botão "ATUALIZAR LEADS": pede a conferência imediata dos grupos ativos da campanha (limpa `conferido_em`).
 *  Travado no servidor a 1 pedido por campanha a cada 2 minutos; aqui só mostra a mensagem que vier. Botão cheio
 *  (amarelo), ao lado de "EXPORTAR GRUPOS" e "EXPORTAR LEADS" na faixa 1. */
export function AtualizarLeadsBotao({ campanhaId }: { campanhaId: string }) {
  const [msg, setMsg] = useState<{ texto: string; erro: boolean } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function clicar() {
    setOcupado(true);
    setMsg(null);
    try {
      const r = await atualizarLeads(campanhaId);
      setMsg(r.erro ? { texto: r.erro, erro: true } : { texto: "Conferência dos grupos ativos pedida.", erro: false });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button type="button" onClick={clicar} disabled={ocupado} className={ESTILO_BOTAO_FAIXA_CHEIO}>
        <Icone nome="refresh" />
        ATUALIZAR LEADS
      </button>
      {msg && <p role={msg.erro ? "alert" : "status"} className={`text-xs ${msg.erro ? "text-vg-erro" : "text-vg-muted"}`}>{msg.texto}</p>}
    </span>
  );
}
