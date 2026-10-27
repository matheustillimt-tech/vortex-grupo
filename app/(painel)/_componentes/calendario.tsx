import Link from "next/link";
import { Icone } from "./icone";
import type { DiaCalendario } from "@/src/lib/calendario";
import { diaBrasilia, rotuloDiaDaAula } from "@/src/lib/regras/aula";
import { ROTULO_TIPO } from "@/src/lib/regras/conteudo";
import { corDaBolinha, rotuloDoDia, type CorBolinha } from "@/src/lib/regras/linha-do-tempo";
import { proximoEnvio } from "@/src/lib/regras/proximo-envio";
import { PROVA } from "@/src/lib/zapbot/prova";
import { cancelarExecucao, cancelarPasso, executarAgora, executarPassoAgora } from "../_acoes/execucoes";
import { ROTULO_ORIGEM, SeloSituacao } from "./situacao";
import { estiloAcao, estiloCartao, estiloCartaoDestaque, Vazio } from "./ui";

const fmtHora = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });

const BOLINHA: Record<CorBolinha, string> = {
  ok: "border-vg-ok",
  erro: "border-vg-erro",
  neutro: "border-[#2f3a33]",
  proximo: "border-vg-accent shadow-[0_0_0_4px_rgba(15,169,104,.25)]",
};

/** Linha do tempo por dia. `nomes` só na visão geral (mostra de qual campanha é cada item); `dataAula` quando há
 *  uma campanha só (rótulo D-N por dia); `lidos` por execução; `agora` decide qual é o próximo.
 *  `podeEditar` (padrão true): sem "editar" em Campanhas, somem "executar agora" e "cancelar". */
export function Calendario({ dias, nomes, dataAula, lidos, agora = new Date(), podeEditar = true }: {
  dias: DiaCalendario[];
  nomes?: Map<string, string>;
  dataAula?: string | null;
  lidos?: Map<string, number>;
  agora?: Date;
  podeEditar?: boolean;
}) {
  if (!dias.length) {
    return (
      <div className={estiloCartao}>
        <Vazio icone={<Icone nome="event_busy" tamanho={16} />} texto="Nada no período." />
      </div>
    );
  }
  const proximos = new Set(proximoEnvio(dias.flatMap((d) => d.itens), agora)?.chaves ?? []);
  const hoje = diaBrasilia(agora);

  return (
    <div className="space-y-6">
      {dias.map((d) => {
        const r = rotuloDoDia(d.dia, hoje);
        const aula = dataAula ? rotuloDiaDaAula(d.dia, dataAula) : null;
        return (
          <section key={d.dia} className="grid grid-cols-1 gap-2 md:grid-cols-[120px_1fr] md:gap-4">
            <div className="flex items-baseline gap-2 md:block md:pt-2">
              <p className="text-sm font-semibold tabular-nums">{r.semana} {r.data}</p>
              {aula && <p className={`text-xs ${aula === "Dia da aula" ? "font-medium text-vg-accent-3" : "text-vg-muted"}`}>{aula}</p>}
            </div>
            <ol className="ml-1.5 min-w-0 space-y-2.5 border-l border-dashed border-vg-line-2 pl-[18px]">
              {d.itens.map((i) => {
                const ehProximo = proximos.has(i.chave);
                const lido = i.execucaoId && PROVA.recibosEmGrupo ? lidos?.get(i.execucaoId) : undefined;
                return (
                  <li key={i.chave} className={`relative px-3 py-2.5 ${ehProximo ? estiloCartaoDestaque : estiloCartao} ${i.situacao === "projetado" && !ehProximo ? "opacity-75" : ""}`}>
                    <span aria-hidden className={`absolute -left-[23px] top-[15px] size-[9px] rounded-full border-2 bg-vg-bg ${BOLINHA[corDaBolinha(i.situacao, ehProximo)]}`} />
                    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                      <div className="min-w-[12rem] flex-1">
                        <p className="truncate text-sm">
                          <span className={`mr-2 font-semibold tabular-nums ${ehProximo ? "text-vg-accent-3" : ""}`}>{fmtHora.format(new Date(i.quando))}</span>
                          {i.execucaoId ? (
                            <Link href={`/campanhas/${i.campanhaId}/mensagens/${i.execucaoId}`} className="font-medium transition-colors hover:text-vg-accent-2">{ROTULO_TIPO[i.tipo]}</Link>
                          ) : (
                            <span className="font-medium">{ROTULO_TIPO[i.tipo]}</span>
                          )}
                          {i.resumo && <span className="text-vg-text-2"> · {i.resumo}</span>}
                        </p>
                        <p className="mt-0.5 text-xs text-vg-muted">
                          {ROTULO_ORIGEM[i.origem] ?? i.origem}
                          {nomes && (
                            <>
                              {" · "}
                              <Link href={`/campanhas/${i.campanhaId}/calendario`} className="text-vg-accent-2 transition-colors hover:text-vg-accent-3">{nomes.get(i.campanhaId)}</Link>
                            </>
                          )}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                        <SeloSituacao situacao={i.situacao} detalhe={i.detalhe} extra={lido ? `lido por ${lido.toLocaleString("pt-BR")}` : undefined} />
                        {podeEditar && i.execucaoId && i.situacao === "agendado" && (
                          <>
                            <form action={executarAgora.bind(null, i.execucaoId, i.campanhaId)}><button className={estiloAcao.normal}><Icone nome="play_arrow" tamanho={12} />executar agora</button></form>
                            <form action={cancelarExecucao.bind(null, i.execucaoId, i.campanhaId)}><button className={estiloAcao.perigo}><Icone nome="close" tamanho={12} />cancelar</button></form>
                          </>
                        )}
                        {podeEditar && i.passoId && i.situacao === "projetado" && (
                          <>
                            <form action={executarPassoAgora.bind(null, i.campanhaId, i.passoId)}><button className={estiloAcao.normal}><Icone nome="play_arrow" tamanho={12} />executar agora</button></form>
                            <form action={cancelarPasso.bind(null, i.campanhaId, i.passoId, i.quando)}><button className={estiloAcao.perigo}><Icone nome="close" tamanho={12} />cancelar</button></form>
                          </>
                        )}
                        {i.execucaoId && (
                          <Link href={`/campanhas/${i.campanhaId}/mensagens/${i.execucaoId}`} aria-label="Abrir detalhe" title="Abrir detalhe" className={estiloAcao.neutro}>
                            <Icone nome="open_in_new" tamanho={14} />
                          </Link>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
