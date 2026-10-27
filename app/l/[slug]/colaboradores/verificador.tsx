"use client";
import { useActionState } from "react";
import { verificarColaborador, type RespostaVerificacao } from "./actions";

/** Formulário "Número com DDD" + "Verificar" (POST por server action: o número não aparece na URL). */
export function Verificador({ slug }: { slug: string }) {
  const [resposta, acao, enviando] = useActionState<RespostaVerificacao, FormData>(verificarColaborador.bind(null, slug), null);
  return (
    <>
      <form action={acao} className="space-y-3 text-left">
        <label className="block space-y-1.5">
          <span className="text-[13.3px] text-[#e3e9e5]">Número com DDD</span>
          <input
            name="numero"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            required
            maxLength={40}
            placeholder="(11) 9 1234-5678"
            className="w-full rounded border border-vg-line-2 bg-transparent px-3 py-2 text-[15px] text-vg-text outline-none focus:border-vg-accent focus:ring-1 focus:ring-vg-accent"
          />
        </label>
        <button type="submit" disabled={enviando} className="block w-full rounded-xl bg-vg-primario px-6 py-3 text-base font-bold text-white disabled:opacity-60">Verificar</button>
      </form>
      {resposta && (
        <p role="status" className={`text-sm ${resposta.tom === "ok" ? "text-vg-ok" : resposta.tom === "erro" ? "text-vg-erro" : "text-vg-muted"}`}>{resposta.texto}</p>
      )}
    </>
  );
}
