"use client";
import { useState } from "react";
import type { AulaEntrada } from "@/src/lib/regras/campanha";
import { Botao, Campo, estiloInput } from "../../../_componentes/ui";
import { salvarAula } from "./actions";

export function Aula({ campanhaId, inicial, sequencias }: { campanhaId: string; inicial: AulaEntrada; sequencias: { id: string; nome: string }[] }) {
  const [f, setF] = useState(inicial);
  const [msg, setMsg] = useState<{ texto: string; erro: boolean } | null>(null);
  const [salvando, setSalvando] = useState(false);
  const set = <K extends keyof AulaEntrada>(k: K, v: AulaEntrada[K]) => { setF({ ...f, [k]: v }); setMsg(null); };
  return (
    <form
      className="grid max-w-2xl gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setSalvando(true);
        const r = await salvarAula(campanhaId, f);
        setSalvando(false);
        setMsg(r.erro ? { texto: r.erro, erro: true } : { texto: "Salvo. A sequência é (re)agendada no próximo minuto.", erro: false });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Data e hora da aula (Brasília)"><input type="datetime-local" className={estiloInput} value={f.data_aula} onChange={(e) => set("data_aula", e.target.value)} /></Campo>
        <Campo rotulo="Sequência">
          <select className={estiloInput} value={f.sequencia_id} onChange={(e) => set("sequencia_id", e.target.value)}>
            <option value="">Nenhuma</option>
            {sequencias.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </select>
        </Campo>
      </div>
      <Campo rotulo="Link da aula" dica="Vira a variável {link_aula}."><input className={estiloInput} value={f.link_aula} onChange={(e) => set("link_aula", e.target.value)} placeholder="https://" /></Campo>
      <Campo rotulo="Mensagem fixa do grupo novo" dica="Todo grupo criado recebe esta mensagem e as 3 últimas importantes. Variáveis valem aqui.">
        <textarea className={estiloInput} rows={3} value={f.mensagem_fixa} onChange={(e) => set("mensagem_fixa", e.target.value)} />
      </Campo>
      <Campo rotulo="Webhook de alertas (opcional)" dica="Recebe cada alerta desta campanha (grupo cheio, número caiu, envio bloqueado…).">
        <input className={estiloInput} value={f.alertas_webhook_url} onChange={(e) => set("alertas_webhook_url", e.target.value)} placeholder="https://" />
      </Campo>
      {msg && <p className={`text-sm ${msg.erro ? "text-vg-erro" : "text-vg-muted"}`}>{msg.texto}</p>}
      <div><Botao type="submit" disabled={salvando}>Salvar aula</Botao></div>
    </form>
  );
}
