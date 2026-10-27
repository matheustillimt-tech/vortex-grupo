"use client";
import { useState } from "react";
import { estiloBotao } from "../../../_componentes/ui";
import { verificarCompatibilidade } from "./actions";

/** Botão "Verificar compatibilidade" de uma conta: pede a conferência imediata dos grupos
 *  ativos dela. Travado no servidor a 1 pedido por conta a cada 2 minutos; aqui só mostra a mensagem que vier. */
export function VerificarBotao({ campanhaId, conexaoId }: { campanhaId: string; conexaoId: string }) {
  const [msg, setMsg] = useState<{ texto: string; erro: boolean } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function clicar() {
    setOcupado(true);
    setMsg(null);
    try {
      const r = await verificarCompatibilidade(campanhaId, conexaoId);
      setMsg(r.erro ? { texto: r.erro, erro: true } : { texto: "Conferência dos grupos desta conexão pedida.", erro: false });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button type="button" onClick={clicar} disabled={ocupado} className={estiloBotao("contorno")}>
        Verificar compatibilidade
      </button>
      {msg && <p role={msg.erro ? "alert" : "status"} className={`text-xs ${msg.erro ? "text-vg-erro" : "text-vg-muted"}`}>{msg.texto}</p>}
    </span>
  );
}
