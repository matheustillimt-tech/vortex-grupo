"use client";
import { useState } from "react";
import { Janela } from "../../_componentes/janela";
import { Botao, estiloInput } from "../../_componentes/ui";
import { excluirCampanha } from "../actions";

/** Diálogo "Excluir": exige digitar o nome certo e avisa que tudo da campanha é apagado de vez do
 *  Vórtex Grupo (o `on delete cascade` de `excluirCampanha`), enquanto os grupos continuam existindo de verdade no
 *  WhatsApp. `excluirCampanha` já recusa se houver execução `enviando`. */
export function ExcluirCampanha({ id, nome, aberta, aoFechar }: { id: string; nome: string; aberta: boolean; aoFechar: () => void }) {
  const [digitado, setDigitado] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function excluir(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    const r = await excluirCampanha(id, digitado);
    setEnviando(false);
    setErro(r?.erro ?? null);
  }

  return (
    <Janela aberta={aberta} aoFechar={aoFechar} titulo="Excluir campanha">
      <form className="grid gap-4" onSubmit={excluir}>
        <p className="text-sm text-vg-text">
          Isso apaga de vez do Vórtex Grupo a campanha <strong>{nome}</strong> e tudo o que é dela: os grupos cadastrados, o histórico de
          entradas e saídas, os cliques no link, as ações (mensagens agendadas e enviadas) e as automações, além das variáveis e
          tags. Não dá para desfazer.
        </p>
        <p className="rounded-lg border border-vg-aviso/40 bg-vg-aviso/10 px-3 py-2 text-xs text-vg-aviso">
          Os grupos em si continuam existindo no WhatsApp, com as pessoas dentro; só deixam de ser gerenciados pelo Vórtex Grupo.
        </p>
        <label className="block space-y-1.5">
          <span className="text-[13.3px] text-[#e3e9e5]">Digite <strong>{nome}</strong> para confirmar</span>
          <input className={estiloInput} value={digitado} onChange={(e) => { setDigitado(e.target.value); setErro(null); }} />
        </label>
        {erro && <p role="alert" className="text-sm text-vg-erro">{erro}</p>}
        <div><Botao type="submit" variante="perigo" disabled={enviando || digitado.trim() !== nome}>EXCLUIR CAMPANHA</Botao></div>
      </form>
    </Janela>
  );
}
