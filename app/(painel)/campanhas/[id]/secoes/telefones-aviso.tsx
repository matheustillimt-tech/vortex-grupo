"use client";
import { useId, useState } from "react";
import { Botao, estiloInput } from "../../../_componentes/ui";
import { telefoneLegivel } from "@/src/lib/telefone";
import { salvarTelefonesAviso } from "./actions";

/** "Aviso de chip caído": telefones (um por linha) que recebem mensagem no privado quando um chip da campanha cai. */
export function TelefonesAviso({ campanhaId, inicial }: { campanhaId: string; inicial: string[] }) {
  const id = useId();
  const [valor, setValor] = useState(inicial.map(telefoneLegivel).join("\n"));
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<{ texto: string; erro: boolean } | null>(null);

  async function salvar() {
    setSalvando(true);
    setMsg(null);
    try {
      const r = await salvarTelefonesAviso(campanhaId, valor);
      if (r.erro) setMsg({ texto: r.erro, erro: true });
      else {
        setValor((r.telefones ?? []).map(telefoneLegivel).join("\n"));
        setMsg({ texto: r.telefones?.length ? "Salvo." : "Salvo (sem aviso).", erro: false });
      }
    } catch {
      setMsg({ texto: "Não foi possível salvar.", erro: true });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-[13.3px] text-[#e3e9e5]">Telefones para avisar (um por linha, com DDD)</label>
      <textarea
        id={id}
        rows={3}
        className={`${estiloInput} sm:max-w-[320px]`}
        placeholder={"11 9 1234-5678"}
        value={valor}
        disabled={salvando}
        onChange={(e) => setValor(e.target.value)}
      />
      <div className="flex items-center gap-3">
        <Botao type="button" onClick={salvar} disabled={salvando}>SALVAR</Botao>
        {msg && <p role="status" className={`text-xs ${msg.erro ? "text-vg-erro" : "text-vg-ok"}`}>{msg.texto}</p>}
      </div>
    </div>
  );
}
