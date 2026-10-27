"use client";
import type { TipoExecucao } from "@/src/lib/regras/conteudo";
import type { Valor } from "./conteudo-editor";
import { estiloInput } from "./ui";

export type ModeloLinha = { id: string; nome: string; tipo: string; conteudo: unknown };

/** "Usar modelo": copia o conteúdo do modelo pro editor (mexer depois não altera o modelo). */
export function EscolherModelo({ tipo, modelos, aoEscolher }: { tipo: TipoExecucao; modelos: ModeloLinha[]; aoEscolher: (c: Valor) => void }) {
  const doTipo = modelos.filter((m) => m.tipo === tipo);
  if (!doTipo.length) return null;
  return (
    <select
      className={`${estiloInput} max-w-xs`}
      value=""
      onChange={(e) => {
        const m = doTipo.find((x) => x.id === e.target.value);
        if (m) aoEscolher({ ...(m.conteudo as Valor) });
      }}
    >
      <option value="">Usar modelo…</option>
      {doTipo.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
    </select>
  );
}
