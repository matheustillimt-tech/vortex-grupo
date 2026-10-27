"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { dataCsv, dataDoArquivo, montarCsv } from "@/src/lib/regras/csv";
import { isoParaBrasilia } from "@/src/lib/regras/horario";
import { AJUDA_LID, CABECALHO_PENDENTES, filtrarPorNumero } from "@/src/lib/regras/solicitacoes";
import { CampoBusca } from "../../../_componentes/campo-busca";
import { Icone } from "../../../_componentes/icone";
import { Botao, Tabela } from "../../../_componentes/ui";
import { aprovarSelecionadas, listarPendentes, recusarSelecionadas, type PendenteItem } from "./actions";

const DICA_SEM_PERMISSAO = "Precisa de permissão para editar Campanhas e ver Leads.";

function Chip({ cor, titulo, children }: { cor: "erro" | "neutro"; titulo?: string; children: React.ReactNode }) {
  const estilo = cor === "erro" ? "border-red-500/50 bg-red-500/10 text-red-300" : "border-vg-line-2 text-vg-text-2";
  return (
    <span title={titulo} className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${estilo}`}>
      {children}
    </span>
  );
}

/** Aba Pendentes (Etapa 3M, Tarefa 4): carrega ao abrir via `listarPendentes` e no ATUALIZAR. Seleção só com
 *  `campanhas`/`editar` e `leads`/`ver`. Bloqueado: a caixa só serve pra recusar. LID: sem caixa (aprove ou recuse
 *  pelo celular). O CSV sai da lista já carregada (já mascarada pra quem não vê Leads). */
export function Pendentes({ campanhaId, podeEditar, verLeads }: { campanhaId: string; podeEditar: boolean; verLeads: boolean }) {
  const [itens, setItens] = useState<PendenteItem[] | null>(null);
  const [semResposta, setSemResposta] = useState(0);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [enviando, setEnviando] = useState(false);
  const [menuCsv, setMenuCsv] = useState(false);
  const refCsv = useRef<HTMLDivElement>(null);
  const podeDecidir = podeEditar && verLeads;

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const r = await listarPendentes(campanhaId);
      if (r.erro) {
        setErro(r.erro);
        return;
      }
      setItens(r.itens ?? []);
      setSemResposta(r.semResposta ?? 0);
      setMarcados(new Set());
    } catch {
      setErro("Não foi possível carregar as solicitações. Tente de novo.");
    } finally {
      setCarregando(false);
    }
  }, [campanhaId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  useEffect(() => {
    if (!menuCsv) return;
    const fora = (e: MouseEvent) => {
      if (refCsv.current && !refCsv.current.contains(e.target as Node)) setMenuCsv(false);
    };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [menuCsv]);

  const lista = itens ?? [];
  const visiveis = verLeads ? filtrarPorNumero(lista, busca) : lista;
  const selecionados = lista.filter((i) => marcados.has(i.chave));
  const podeAprovar = selecionados.length > 0 && selecionados.every((i) => !i.bloqueado && !i.lid);

  function alternar(chave: string, ligado: boolean) {
    setMarcados((atual) => {
      const novo = new Set(atual);
      if (ligado) novo.add(chave);
      else novo.delete(chave);
      return novo;
    });
  }

  function baixarCsv() {
    setMenuCsv(false);
    const linhas = lista.map((i) => [i.numero, i.grupoNome, dataCsv(i.pedidoEm)]);
    const blob = new Blob([montarCsv(CABECALHO_PENDENTES, linhas)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `solicitacoes-pendentes-${dataDoArquivo()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function decidir(decisao: "aprovar" | "recusar") {
    const escolhidos = selecionados.filter((i) => i.telefone && !i.lid && (decisao === "recusar" || !i.bloqueado));
    if (!escolhidos.length) return;
    const verbo = decisao === "aprovar" ? "Aprovar" : "Recusar";
    if (!window.confirm(`${verbo} ${escolhidos.length} solicitação(ões)?`)) return;
    setEnviando(true);
    setErro(null);
    setMensagem(null);
    try {
      const itensDecisao = escolhidos.map((i) => ({ grupoId: i.grupoId, telefone: i.telefone! }));
      const r = decisao === "aprovar" ? await aprovarSelecionadas(campanhaId, itensDecisao) : await recusarSelecionadas(campanhaId, itensDecisao);
      if (r.erro) setErro(r.erro);
      else setMensagem(r.mensagem ?? null);
    } catch {
      setErro("Não foi possível enviar. Tente de novo.");
    } finally {
      setEnviando(false);
    }
    await carregar();
  }

  const dicaBotao = podeDecidir ? undefined : DICA_SEM_PERMISSAO;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-normal">Solicitações pendentes</h2>
          <p className="text-sm text-vg-muted">{carregando && !itens ? "Carregando…" : `${lista.length} pendente(s)`}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div ref={refCsv} className="relative">
            <Botao variante="secundario" type="button" aria-haspopup="menu" aria-expanded={menuCsv} onClick={() => setMenuCsv((v) => !v)} disabled={!lista.length}>
              CSV <Icone nome="expand_more" tamanho={18} />
            </Botao>
            {menuCsv && (
              <div role="menu" className="absolute right-0 top-full z-10 mt-1 w-56 overflow-hidden rounded-lg border border-vg-line bg-vg-panel py-1 shadow-xl">
                <button type="button" role="menuitem" onClick={baixarCsv} className="block w-full px-3 py-2 text-left text-[13px] text-vg-text transition-colors hover:bg-white/5">
                  Baixar pendentes (CSV)
                </button>
              </div>
            )}
          </div>
          <span title={dicaBotao}>
            <Botao variante="secundario" type="button" disabled={!podeDecidir || enviando || !selecionados.length} onClick={() => decidir("recusar")}>
              Recusar selecionadas
            </Botao>
          </span>
          <span title={dicaBotao ?? (selecionados.some((i) => i.bloqueado) ? "Número bloqueado não pode ser aprovado: só recusado." : undefined)}>
            <Botao type="button" disabled={!podeDecidir || enviando || !podeAprovar} onClick={() => decidir("aprovar")}>
              Aprovar selecionadas
            </Botao>
          </span>
        </div>
      </div>

      <div className="max-w-md space-y-1">
        <CampoBusca valor={busca} aoMudar={setBusca} rotulo="Buscar número" rotuloVisivel="Buscar número" inputMode="numeric" />
        <p className="text-xs text-vg-text-3">{verLeads ? "Busca pelo número completo do participante" : "Busca disponível só para quem vê Leads."}</p>
      </div>

      {erro && <p role="alert" className="text-sm text-vg-erro">{erro}</p>}
      {mensagem && <p role="status" className="text-sm text-vg-text-2">{mensagem}</p>}

      <Tabela
        colunas={["", "Número", "Grupo", "Pedido em", ""]}
        vazio={!carregando && !visiveis.length ? "Nenhuma solicitação pendente no momento." : undefined}
        semCabecalhoQuandoVazio
        vazioSemIcone
      >
        {visiveis.map((i) => (
          <tr key={i.chave}>
            <td className="w-10 px-3 py-2.5">
              {!i.lid && (
                <input
                  type="checkbox"
                  aria-label={`Selecionar ${i.numero}`}
                  title={dicaBotao}
                  disabled={!podeDecidir || enviando}
                  checked={marcados.has(i.chave)}
                  onChange={(e) => alternar(i.chave, e.target.checked)}
                />
              )}
            </td>
            <td className="px-3 py-2.5 tabular-nums">{i.numero}</td>
            <td className="px-3 py-2.5 text-vg-text-2">{i.grupoNome}</td>
            <td className="px-3 py-2.5 tabular-nums text-vg-text-2">{i.pedidoEm ? isoParaBrasilia(i.pedidoEm) : "—"}</td>
            <td className="px-3 py-2.5">
              {i.bloqueado ? (
                <Chip cor="erro" titulo="Bloqueado no anti-spam ou numa blacklist: só pode ser recusado.">Bloqueado</Chip>
              ) : i.lid ? (
                <Chip cor="neutro" titulo={AJUDA_LID}>LID</Chip>
              ) : null}
            </td>
          </tr>
        ))}
      </Tabela>

      {/* O ATUALIZAR só aparece na linha dos grupos que não responderam. */}
      {semResposta > 0 && (
        <div className="flex flex-wrap items-center justify-end gap-3 text-sm text-vg-text-2">
          <span>{semResposta} grupo(s) não responderam</span>
          <button type="button" onClick={() => void carregar()} disabled={carregando} className="text-xs font-medium text-vg-accent transition-colors hover:text-vg-accent-3 disabled:opacity-50">
            ATUALIZAR
          </button>
        </div>
      )}
    </div>
  );
}
