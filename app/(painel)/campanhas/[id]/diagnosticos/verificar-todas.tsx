"use client";
import { useState } from "react";
import { estiloBotao } from "../../../_componentes/ui";
import { verificarCompatibilidade } from "./actions";

/** Botão "Verificar compatibilidade" do cabeçalho do cartão "Compatibilidade de contas":
 *  chama a mesma action do botão por conta, uma conta por vez (o `THROTTLE_VERIFICAR_COMPATIBILIDADE_MS` do
 *  servidor é por conta, então em série não trava nenhuma). Só aparece para quem já vê o botão por conta
 *  (`podeEditar`, decidido pela página). Sem função como prop: recebe só `campanhaId` e a lista de ids. */
export function VerificarTodas({ campanhaId, conexaoIds }: { campanhaId: string; conexaoIds: string[] }) {
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<{ texto: string; erro: boolean } | null>(null);

  async function clicar() {
    setEnviando(true);
    setMsg(null);
    let erros = 0;
    for (const conexaoId of conexaoIds) {
      const r = await verificarCompatibilidade(campanhaId, conexaoId);
      if (r.erro) erros++;
    }
    setEnviando(false);
    if (erros === 0) setMsg({ texto: `Conferência pedida para ${conexaoIds.length} conexão(ões).`, erro: false });
    else setMsg({ texto: `${conexaoIds.length - erros} de ${conexaoIds.length} conexão(ões) pedidas; ${erros} não puderam ser pedidas agora (aguarde 2 minutos entre pedidos da mesma conexão).`, erro: true });
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button type="button" onClick={clicar} disabled={enviando || conexaoIds.length === 0} className={estiloBotao("contorno")}>
        Verificar compatibilidade
      </button>
      {msg && <p role={msg.erro ? "alert" : "status"} className={`text-xs ${msg.erro ? "text-vg-erro" : "text-vg-muted"}`}>{msg.texto}</p>}
    </span>
  );
}
