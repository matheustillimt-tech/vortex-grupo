"use client";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Icone } from "../../_componentes/icone";
import { Janela } from "../../_componentes/janela";
import { estiloBotao, estiloInput } from "../../_componentes/ui";
import { bloquearPessoa, desbloquear } from "../actions";

/** Bloqueia e tira de todos os grupos (a remoção vai pra fila, com o espaçamento anti-ban). */
export function Bloquear({ telefone }: { telefone: string }) {
  const router = useRouter();
  const [aberta, setAberta] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [msg, setMsg] = useState<{ texto: string; erro: boolean } | null>(null);
  const [ocupado, iniciar] = useTransition();
  const idMotivo = useId();
  return (
    <>
      <button type="button" className={estiloBotao("perigo")} onClick={() => { setMsg(null); setAberta(true); }}>
        <Icone nome="block" />
        BLOQUEAR
      </button>
      {msg && !aberta && <span role="status" className={`text-xs ${msg.erro ? "text-vg-erro" : "text-vg-muted"}`}>{msg.texto}</span>}
      <Janela aberta={aberta} aoFechar={() => setAberta(false)} titulo="Bloquear número">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setMsg(null);
            iniciar(async () => {
              const r = await bloquearPessoa(telefone, motivo);
              if (r.erro) return setMsg({ texto: r.erro, erro: true });
              setAberta(false);
              setMsg({ texto: `Bloqueado. ${r.resumo?.remocoes ?? 0} remoção(ões) na fila.`, erro: false });
              router.refresh();
            });
          }}
        >
          <p className="text-sm text-vg-text-2">O número entra na lista de bloqueados e sai de todos os grupos (a remoção vai pra fila, com o intervalo de segurança).</p>
          <label htmlFor={idMotivo} className="block space-y-1.5">
            <span className="text-[13.3px] text-[#e3e9e5]">Motivo (opcional)</span>
            <input id={idMotivo} className={estiloInput} value={motivo} maxLength={200} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: spam no grupo" />
          </label>
          {msg?.erro && <p role="alert" className="text-sm text-vg-erro">{msg.texto}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className={estiloBotao("secundario")} onClick={() => setAberta(false)}>CANCELAR</button>
            <button type="submit" className={estiloBotao("perigo")} disabled={ocupado}>BLOQUEAR</button>
          </div>
        </form>
      </Janela>
    </>
  );
}

export function Desbloquear({ telefone }: { telefone: string }) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();
  return (
    <>
      <button
        type="button"
        className={estiloBotao("contorno")}
        disabled={ocupado}
        onClick={() => {
          if (!window.confirm("Desbloquear este número? Ele volta a poder entrar nos grupos.")) return;
          setErro(null);
          iniciar(async () => {
            const r = await desbloquear(telefone);
            if (r.erro) return setErro(r.erro);
            router.refresh();
          });
        }}
      >
        <Icone nome="lock_open" />
        DESBLOQUEAR
      </button>
      {erro && <span role="alert" className="text-xs text-vg-erro">{erro}</span>}
    </>
  );
}
