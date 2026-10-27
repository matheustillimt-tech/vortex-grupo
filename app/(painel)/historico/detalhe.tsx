"use client";
import Link from "next/link";
import { useState } from "react";
import { isoParaBrasilia } from "@/src/lib/regras/horario";
import { ROTULO_ACAO_HISTORICO, rotuloAreaHistorico, type LinhaHistorico } from "@/src/lib/regras/historico";
import { Icone } from "../_componentes/icone";
import { Janela } from "../_componentes/janela";
import { estiloAcao } from "../_componentes/ui";

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-vg-muted">{rotulo}</dt>
      <dd className="text-sm text-vg-text">{children}</dd>
    </div>
  );
}

/** `chevron_right` de cada linha do histórico: abre o detalhe com quem, quando, ação, área, resumo, ID de
 *  referência e o link pro objeto, quando há rota conhecida pra área. */
export function BotaoDetalheHistorico({ linha, link }: { linha: LinhaHistorico; link: string | null }) {
  const [aberta, setAberta] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setAberta(true)}
        aria-label="Ver detalhe do registro"
        className="grid size-7 shrink-0 place-items-center rounded-md text-vg-muted transition-colors hover:bg-white/5 hover:text-vg-text"
      >
        <Icone nome="chevron_right" tamanho={20} />
      </button>
      <Janela aberta={aberta} aoFechar={() => setAberta(false)} titulo={`${ROTULO_ACAO_HISTORICO[linha.acao]} ${rotuloAreaHistorico(linha.area)}`}>
        <dl className="space-y-3">
          <Linha rotulo="Quem">{linha.usuario_email ?? "—"}</Linha>
          <Linha rotulo="Quando">{isoParaBrasilia(linha.created_at)}</Linha>
          <Linha rotulo="Ação">{ROTULO_ACAO_HISTORICO[linha.acao]}</Linha>
          <Linha rotulo="Área">{rotuloAreaHistorico(linha.area)}</Linha>
          <Linha rotulo="Resumo">{linha.resumo || "—"}</Linha>
          <Linha rotulo="ID de referência">
            <span className="break-all">{linha.ref_id ?? "—"}</span>
          </Linha>
        </dl>
        {link && (
          <Link href={link} onClick={() => setAberta(false)} className={`${estiloAcao.normal} mt-4 inline-flex`}>
            Abrir <Icone nome="arrow_forward" tamanho={14} />
          </Link>
        )}
      </Janela>
    </>
  );
}
