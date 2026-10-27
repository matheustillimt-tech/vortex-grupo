"use client";
import { OPCOES_ORDEM_CONTAS, type OrdemContas } from "@/src/lib/regras/contas";
import { estiloInput } from "../_componentes/ui";

/** Select "Ordenação" que envia o `<form>` ao redor assim que o valor muda (sem botão "Aplicar"). Mesmos 4
 *  rótulos: ver `OPCOES_ORDEM_CONTAS`. */
export function EnviarAoMudar({ ordem }: { ordem: OrdemContas }) {
  return (
    <select
      name="ordem"
      defaultValue={ordem}
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
      className={estiloInput}
    >
      {OPCOES_ORDEM_CONTAS.map((o) => (
        <option key={o.valor} value={o.valor}>{o.rotulo}</option>
      ))}
    </select>
  );
}
