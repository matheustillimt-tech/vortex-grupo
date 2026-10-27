"use client";
import type { FormEvent } from "react";
import { PERIODOS, rotuloPeriodo, type Periodo } from "@/src/lib/regras/linha-do-tempo";
import type { Visao } from "@/src/lib/regras/calendario-grade";
import { estiloInput } from "./ui";

// estiloInput traz w-full; aqui o select tem a largura do conteúdo.
const estiloSelect = estiloInput.replace("w-full", "w-auto");

/** Envia o formulário (GET) assim que o select muda — sem botão "Filtrar".
 *  Componente pequeno, sem prop de função: só lê `e.currentTarget.form`, que o próprio evento já traz. */
function aoMudarEnviar(e: FormEvent<HTMLSelectElement>) {
  e.currentTarget.form?.requestSubmit();
}

/** Filtros por GET. `campanhas` só na visão geral; `periodo` só aparece na visão agenda (mês/semana usam a
 *  grade); `visao`/`data` vão escondidos pra o filtro de campanha não perder a visão atual. Mesmos parâmetros
 *  de URL de antes — só sai o botão "Filtrar" (os selects enviam ao mudar). */
export function FiltrosCalendario({ campanhas, campanha = "", periodo, diasAntes, visao, data, mostrarPeriodo = true }: {
  campanhas?: { id: string; nome: string }[];
  campanha?: string;
  periodo: Periodo;
  diasAntes: number;
  visao?: Visao;
  data?: string;
  mostrarPeriodo?: boolean;
}) {
  return (
    <form method="get" className="flex flex-wrap items-center gap-2">
      {visao && <input type="hidden" name="visao" value={visao} />}
      {data && <input type="hidden" name="data" value={data} />}
      {campanhas && (
        <select name="campanha" defaultValue={campanha} onChange={aoMudarEnviar} aria-label="Campanha" className={`${estiloSelect} max-w-[220px]`}>
          <option value="">Todas as campanhas</option>
          {campanhas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
      )}
      {mostrarPeriodo && (
        <select name="periodo" defaultValue={periodo} onChange={aoMudarEnviar} aria-label="Período" className={estiloSelect}>
          {PERIODOS.map((p) => <option key={p} value={p}>{rotuloPeriodo(p, diasAntes)}</option>)}
        </select>
      )}
    </form>
  );
}
