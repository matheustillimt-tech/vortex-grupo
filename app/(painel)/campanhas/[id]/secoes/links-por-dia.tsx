"use client";
import { useId, useRef, useState } from "react";
import { estiloInput } from "../../../_componentes/ui";
import { deveSalvarAoSair } from "@/src/lib/regras/interacao";
import { salvarLinksPorDia } from "./actions";

/** Campo único "Quantidade de atualizações por dia" (1 a 24), sem interruptor nem "SALVAR" — salva ao sair do
 *  campo (`onBlur`) (Etapa 3N). Vazio desliga (`links_periodicos = false`);
 *  um número liga. Campanha desligada chega aqui com `inicial=""` (`page.tsx` só manda o número quando
 *  `links_periodicos` está ligado): o campo mostra vazio e nada muda no deploy até a pessoa digitar um número. */
export function LinksPorDia({ campanhaId, inicial }: { campanhaId: string; inicial: number | "" }) {
  const id = useId();
  const [valor, setValor] = useState(String(inicial));
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<{ texto: string; erro: boolean } | null>(null);
  // Último valor de fato salvo no banco: se o `onBlur` disparar sem a pessoa ter mudado nada (ex.: só deu Tab
  // pra sair do campo), não bate no servidor de novo (revisão final B, item 4).
  const ultimoSalvo = useRef(String(inicial));

  async function salvar() {
    if (!deveSalvarAoSair(valor, ultimoSalvo.current)) return;
    setSalvando(true);
    setMsg(null);
    try {
      const r = await salvarLinksPorDia(campanhaId, valor);
      if (r.erro) {
        setMsg({ texto: r.erro, erro: true });
      } else {
        ultimoSalvo.current = valor;
        setMsg(null);
      }
    } catch {
      setMsg({ texto: "Não foi possível salvar.", erro: true });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-[13px] text-vg-text-2">Quantidade de atualizações por dia</label>
      <input
        id={id}
        type="number"
        min={1}
        max={24}
        step={1}
        inputMode="numeric"
        className={`${estiloInput} sm:max-w-[160px]`}
        value={valor}
        disabled={salvando}
        onChange={(e) => setValor(e.target.value)}
        onBlur={salvar}
      />
      {msg && <p role="alert" className="text-xs text-vg-erro">{msg.texto}</p>}
    </div>
  );
}
