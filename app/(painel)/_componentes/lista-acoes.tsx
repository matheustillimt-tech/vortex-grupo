"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { AcaoCartao } from "@/app/(painel)/_acoes/tipos";
import { dataHoraCompleta, dataHoraCurta } from "@/src/lib/regras/abas-mensagens";
import { ICONE_SITUACAO_ACAO } from "@/src/lib/regras/acoes";
import { resumoConteudo } from "@/src/lib/regras/conteudo";
import {
  cancelarGlobal,
  excluirExecucoes,
  executarAgoraGlobal,
  reenviarTravadas,
  reexecutarFalhasGlobal,
  type ResultadoExclusao,
  type ResultadoLote,
} from "../_acoes/execucoes";
import { Icone } from "./icone";
import { MenuCartao, type ItemMenuCartao } from "./menu-cartao";
import { PreviaMensagem } from "./previa-mensagem";
import { ROTULO_ORIGEM } from "./situacao";
import { textoConfirmacao, textoExclusao, type AcaoLote } from "../_acoes/textos";
import { Selo, Vazio } from "./ui";

function Placar({ icone, rotulo, valor, cor = "text-vg-text-2" }: { icone: string; rotulo: string; valor: number; cor?: string }) {
  return (
    <span className="flex items-center gap-1 tabular-nums" title={rotulo}>
      <Icone nome={icone} tamanho={16} className={cor} />
      <span className="sr-only">{rotulo}: </span>
      {valor}
    </span>
  );
}

function Data({ icone, rotulo, iso }: { icone: string; rotulo: string; iso: string | null }) {
  if (!iso) return null;
  return (
    <p className="flex items-center gap-2" title={rotulo}>
      <Icone nome={icone} tamanho={16} className="text-vg-text-3" />
      <span className="sr-only">{rotulo}: </span>
      <span className="tabular-nums">{dataHoraCompleta(iso)}</span>
    </p>
  );
}

const COR_ICONE_SITUACAO: Record<string, string> = { neutro: "text-vg-text-2", aviso: "text-vg-aviso", ok: "text-vg-ok", erro: "text-vg-erro" };

/** Status do cartão de ação como ícone, com o rótulo de hoje em `title`/`sr-only`. */
function IconeSituacao({ situacao }: { situacao: { rotulo: string; cor: string } }) {
  return (
    <span title={situacao.rotulo} className={`grid size-6 place-items-center ${COR_ICONE_SITUACAO[situacao.cor] ?? "text-vg-text-2"}`}>
      <Icone nome={ICONE_SITUACAO_ACAO[situacao.rotulo as keyof typeof ICONE_SITUACAO_ACAO]} tamanho={18} />
      <span className="sr-only">{situacao.rotulo}</span>
    </span>
  );
}


const ACOES_LOTE: Record<AcaoLote, {
  rotulo: string;
  icone: string;
  perigo?: boolean;
  aplica: (a: AcaoCartao) => boolean;
  rodar: (ids: string[]) => Promise<ResultadoLote | ResultadoExclusao>;
  feito: (r: ResultadoLote | ResultadoExclusao) => string;
}> = {
  enviar: {
    rotulo: "Enviar agora", icone: "send", aplica: (a) => a.podeEnviarAgora, rodar: executarAgoraGlobal,
    feito: (r) => `${(r as ResultadoLote).feitas} antecipada(s): começa(m) em até 1 minuto.`,
  },
  travadas: {
    rotulo: "Reenviar ações travadas", icone: "handyman", aplica: () => true, rodar: reenviarTravadas,
    feito: (r) => `${(r as ResultadoLote).feitas} tarefa(s) travada(s) reenviada(s).`,
  },
  reprocessar: {
    rotulo: "Reprocessar", icone: "replay", aplica: (a) => a.podeReprocessar, rodar: reexecutarFalhasGlobal,
    feito: (r) => `Falhas reprocessadas em ${(r as ResultadoLote).feitas} execução(ões).`,
  },
  cancelar: {
    rotulo: "Cancelar", icone: "cancel", perigo: true, aplica: (a) => a.podeCancelar, rodar: cancelarGlobal,
    feito: (r) => `${(r as ResultadoLote).feitas} cancelada(s).`,
  },
  excluir: {
    rotulo: "Excluir", icone: "delete_forever", perigo: true, aplica: () => true, rodar: excluirExecucoes,
    feito: (r) => textoExclusao(r as ResultadoExclusao),
  },
};

/**
 * Lista de ações compartilhada por `/acoes`, `/campanhas/[id]/acoes` e a aba Mensagens: seleção, barra em massa
 * e os cartões da página atual. `agrupar=false` mostra um cartão por tarefa (grupo); `agrupar=true`, contadores
 * de tarefas no lugar de um grupo só. A paginação (fora deste componente) sempre conta ações/execuções — com
 * "Agrupar: Não" uma execução pode aparecer em mais de um cartão.
 */
export function ListaAcoes({ acoes, podeEditar, agrupar }: { acoes: AcaoCartao[]; podeEditar: boolean; agrupar: boolean }) {
  const [marcadosBrutos, setMarcados] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ texto: string; erro: boolean } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const visiveis = useMemo(() => new Set(acoes.map((a) => a.id)), [acoes]);
  const marcadas = useMemo(() => acoes.filter((a) => marcadosBrutos.has(a.id) && visiveis.has(a.id)), [acoes, marcadosBrutos, visiveis]);
  const tudoMarcado = acoes.length > 0 && acoes.every((a) => marcadosBrutos.has(a.id));

  function alternar(id: string, sim: boolean) {
    const s = new Set(marcadosBrutos);
    if (sim) s.add(id);
    else s.delete(id);
    setMarcados(s);
  }

  async function rodar(chave: AcaoLote, execucaoIds: string[]) {
    if (!execucaoIds.length) return;
    const a = ACOES_LOTE[chave];
    const confirmar = textoConfirmacao(chave, execucaoIds.length, agrupar);
    if (confirmar && !window.confirm(confirmar)) return;
    setOcupado(true);
    setMsg(null);
    try {
      const r = await a.rodar(execucaoIds);
      const erros = (r as ResultadoLote | ResultadoExclusao).erros;
      const partes = [a.feito(r)];
      if (erros.length) partes.push(erros.join(" "));
      setMsg({ texto: partes.join(" "), erro: erros.length > 0 });
      setMarcados(new Set());
    } catch {
      setMsg({ texto: "Não foi possível concluir. Tente de novo.", erro: true });
    } finally {
      setOcupado(false);
    }
  }

  function rodarEmMassa(chave: AcaoLote) {
    const ids = [...new Set(marcadas.filter(ACOES_LOTE[chave].aplica).map((a) => a.execucaoId))];
    void rodar(chave, ids);
  }

  return (
    <div className="space-y-2">
      {podeEditar && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-1">
          <label className="flex items-center gap-2 text-[13px] text-vg-text-2">
            <input
              type="checkbox"
              checked={tudoMarcado}
              disabled={!acoes.length}
              onChange={(e) => setMarcados(e.target.checked ? new Set(acoes.map((a) => a.id)) : new Set())}
            />
            Selecionar tudo ({marcadas.length}/{acoes.length})
          </label>
          <div className="flex flex-wrap items-center gap-1">
            {(Object.keys(ACOES_LOTE) as AcaoLote[]).map((k) => {
              const a = ACOES_LOTE[k];
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => rodarEmMassa(k)}
                  disabled={ocupado || !marcadas.some(a.aplica)}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-40 ${a.perigo ? "text-vg-erro hover:bg-vg-erro/10" : "text-vg-accent hover:bg-vg-accent/10"}`}
                >
                  <Icone nome={a.icone} tamanho={18} />
                  {a.rotulo}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <p role="status" className={`px-1 text-sm empty:hidden ${msg?.erro ? "text-vg-erro" : "text-vg-muted"}`}>{msg?.texto}</p>

      {acoes.length === 0 ? (
        <div className="rounded-xl border border-vg-line">
          <Vazio texto="Nenhum registro encontrado" />
        </div>
      ) : (
        <ul className="space-y-3">
          {acoes.map((a) => {
            const itensMenu: ItemMenuCartao[] = [
              { rotulo: "Enviar agora", icone: "send", desabilitado: !a.podeEnviarAgora, onClick: () => rodar("enviar", [a.execucaoId]) },
              { rotulo: "Reprocessar", icone: "replay", desabilitado: !a.podeReprocessar, onClick: () => rodar("reprocessar", [a.execucaoId]) },
              { rotulo: "Cancelar", icone: "cancel", desabilitado: !a.podeCancelar, onClick: () => rodar("cancelar", [a.execucaoId]) },
              { rotulo: "Excluir", icone: "delete_forever", perigo: true, onClick: () => rodar("excluir", [a.execucaoId]) },
            ];
            const previa = ["mensagem", "enquete", "nome", "descricao"].includes(a.tipo) ? (
              <PreviaMensagem tipo={a.tipo as "mensagem" | "enquete" | "nome" | "descricao"} conteudo={a.conteudo} />
            ) : (
              resumoConteudo(a.tipo, a.conteudo) && <p className="text-[13px] text-vg-text-2">{resumoConteudo(a.tipo, a.conteudo)}</p>
            );
            return (
              <li key={a.id} className="flex items-start gap-2">
                {podeEditar && (
                  <input
                    type="checkbox"
                    checked={marcadosBrutos.has(a.id)}
                    onChange={(e) => alternar(a.id, e.target.checked)}
                    aria-label={`Selecionar ${a.titulo}`}
                    className="mt-3.5 shrink-0"
                  />
                )}
                <div className="min-w-0 flex-1 overflow-hidden rounded-xl border border-vg-line">
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 bg-vg-panel-2 px-4 py-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <Link href={`/campanhas/${a.campanhaId}/mensagens/${a.execucaoId}`} className="text-[13px] font-medium text-vg-text transition-colors hover:text-vg-accent">
                        {a.titulo}
                      </Link>
                      {a.importante && <Selo cor="destaque">importante</Selo>}
                      {a.depoisDe && (
                        <span
                          className="inline-flex items-center gap-1 rounded-full border border-vg-line-2 px-2 py-0.5 text-[11px] font-medium text-vg-text-2"
                          title={a.depoisDe.titulo ? `Depois de: ${a.depoisDe.titulo}` : undefined}
                        >
                          <Icone nome="link" tamanho={14} className="text-vg-accent" />
                          Depois da ação anterior
                        </span>
                      )}
                    </span>
                    <div className="flex flex-wrap items-center gap-3 text-[13px]">
                      {!agrupar && a.detalheAcao && (
                        <span className="tabular-nums text-vg-text-2" title="Andamento da ação inteira (todos os grupos)">
                          <span className="sr-only">Andamento da ação: </span>
                          {a.detalheAcao}
                        </span>
                      )}
                      {agrupar && a.contadores ? (
                        <span className="flex items-center gap-2 tabular-nums text-vg-text-2">
                          <span title="Grupos no total">{a.contadores.total}</span>
                          <span className="sr-only">Grupos no total</span>
                          ·
                          <Placar icone="double_arrow" rotulo="Processando" valor={a.contadores.processando} />
                          <Placar icone="check_circle" rotulo="Sucesso" valor={a.contadores.sucesso} cor="text-vg-ok" />
                          <Placar icone="remove_circle" rotulo="Falha" valor={a.contadores.falha} cor="text-vg-erro" />
                        </span>
                      ) : (
                        <IconeSituacao situacao={a.situacao} />
                      )}
                      {podeEditar && <MenuCartao itens={itensMenu} />}
                    </div>
                  </div>
                  <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                    <div className="min-w-0 space-y-2">
                      {previa}
                      {a.entregues !== undefined && (
                        <div className="flex flex-wrap items-center gap-4 text-[13px]">
                          <Placar icone="done_all" rotulo={agrupar ? "Entregues" : "Entregues (ação inteira)"} valor={a.entregues} />
                          <Placar icone="visibility" rotulo={agrupar ? "Lidos" : "Lidos (ação inteira)"} valor={a.lidos ?? 0} />
                        </div>
                      )}
                      {a.entrega && (
                        <p className="flex items-center gap-2 text-[13px] text-vg-text-2">
                          <Icone nome="mark_chat_read" tamanho={16} className="text-vg-text-3" />
                          <span className="tabular-nums">{a.entrega}</span>
                        </p>
                      )}
                    </div>
                    <div className="min-w-0 space-y-1.5 text-[13px] text-vg-text-2">
                      {a.contaNome !== undefined && (
                        <p className="flex items-center gap-2">
                          <Icone nome="qr_code_2" tamanho={16} className="text-vg-text-3" />
                          {a.contaNome ?? "Várias conexões"}
                        </p>
                      )}
                      <Link href={`/campanhas/${a.campanhaId}`} className="flex items-center gap-2 text-vg-link transition-colors hover:underline">
                        <Icone nome="campaign" tamanho={16} />
                        {a.campanhaNome || "Campanha"}
                      </Link>
                      {!(agrupar && a.contadores) && (
                        <Link href={`/campanhas/${a.campanhaId}/grupos`} className="flex items-center gap-2 text-vg-link transition-colors hover:underline">
                          <Icone nome="group" tamanho={16} />
                          {a.grupoNome}
                        </Link>
                      )}
                      <p className="flex items-center gap-2" title="Agendada para">
                        <Icone nome="schedule" tamanho={16} className="text-vg-text-3" />
                        <span className="sr-only">Agendada para: </span>
                        <span className="tabular-nums">{dataHoraCurta(a.agendadaPara)}</span>
                      </p>
                      <Data icone="note_add" rotulo="Criada em" iso={a.criadaEm} />
                      <Data icone="play_arrow" rotulo="Iniciada em" iso={a.iniciadaEm} />
                      <Data icone="sports_score" rotulo="Terminada em" iso={a.terminadaEm} />
                      {a.duracao && (
                        <p className="flex items-center gap-2">
                          <Icone nome="timelapse" tamanho={16} className="text-vg-text-3" />
                          {a.duracao}
                        </p>
                      )}
                      {ROTULO_ORIGEM[a.origem] && <p className="text-vg-text-3">{ROTULO_ORIGEM[a.origem]}</p>}
                      {a.motivo && <p className="text-vg-erro">{a.motivo}</p>}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
