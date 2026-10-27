"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { desmarcarTodasFiltradas, selecionarTodasFiltradas } from "@/src/lib/regras/campanhas-da-conta";
import { Icone } from "../../_componentes/icone";
import { CampoBusca } from "../../_componentes/campo-busca";
import { estiloCartao, Selo, Vazio } from "../../_componentes/ui";
import { definirCampanhasDaConta } from "../actions";

export type CampanhaDaContaSelecao = { id: string; nome: string; criadora: boolean; admin: boolean };

const POR_PAGINA = 25;

/** Aba "Campanhas" do detalhe da conta: cartões de campanha, sem tabela e sem "Salvar" —
 *  marcar/desmarcar chama a mesma action de hoje, já com a lista resultante (a campanha onde a conta cria os
 *  grupos vem marcada e travada: ver o checkbox abaixo). "Selecionar/Desmarcar todas" fazem uma chamada só, com
 *  a lista final da busca atual. Paginação de 12 em memória (lista já está toda carregada). */
export function CampanhasDaConta({ contaId, campanhas, podeEditar }: { contaId: string; campanhas: CampanhaDaContaSelecao[]; podeEditar: boolean }) {
  const router = useRouter();
  const [busca, setBusca] = useState("");
  const [marcadas, setMarcadas] = useState<Set<string>>(() => new Set(campanhas.filter((c) => c.admin).map((c) => c.id)));
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<{ texto: string; erro: boolean } | null>(null);
  const [pagina, setPagina] = useState(1);

  const filtradas = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return b ? campanhas.filter((c) => c.nome.toLowerCase().includes(b)) : campanhas;
  }, [busca, campanhas]);

  // "Selecionar todas"/"Desmarcar todas" (revisão final): só a lista FILTRADA (busca atual), nunca a campanha
  // onde esta conta é criadora (já vem marcada e travada — ver o checkbox abaixo).
  const selecionaveisFiltradas = useMemo(() => filtradas.filter((c) => !c.criadora), [filtradas]);

  const totalPaginas = Math.max(1, Math.ceil(filtradas.length / POR_PAGINA));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const de = (paginaAtual - 1) * POR_PAGINA;
  const visiveis = filtradas.slice(de, de + POR_PAGINA);

  async function salvar(novasMarcadas: Set<string>) {
    // Tirar a conta de uma campanha cancela/reassocia as ações já agendadas só com ela — confirma antes (nunca
    // nas que são criadoras, que ficam travadas e nunca saem daqui).
    const removidas = [...marcadas].filter((id) => !novasMarcadas.has(id) && !campanhas.find((c) => c.id === id)?.criadora);
    if (removidas.length > 0 && !window.confirm(`Tirar esta conexão de ${removidas.length} campanha(s)? As ações agendadas só com ela serão canceladas ou reassociadas.`)) {
      return;
    }
    const anteriores = marcadas;
    setEnviando(true);
    setMsg(null);
    const r = await definirCampanhasDaConta(contaId, [...novasMarcadas]);
    setEnviando(false);
    if (r.erro) {
      setMarcadas(anteriores);
      setMsg({ texto: r.erro, erro: true });
      return;
    }
    setMarcadas(novasMarcadas);
    setMsg({ texto: r.mensagem ?? "Nada mudou.", erro: false });
    router.refresh();
  }

  function alternar(id: string, sim: boolean) {
    const s = new Set(marcadas);
    if (sim) s.add(id);
    else s.delete(id);
    salvar(s);
  }

  function selecionarTodas() {
    salvar(selecionarTodasFiltradas(marcadas, filtradas));
  }

  function desmarcarTodas() {
    salvar(desmarcarTodasFiltradas(marcadas, filtradas));
  }

  if (!campanhas.length) {
    return (
      <div className="rounded-xl border border-vg-line">
        <Vazio texto="Nenhum registro encontrado" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CampoBusca valor={busca} aoMudar={(v) => { setBusca(v); setPagina(1); }} rotulo="Buscar campanhas" className="w-full max-w-sm" />
        <div className="flex items-center gap-3">
          <span className="text-sm text-vg-text">Linhas por página <span className="ml-3 tabular-nums">{POR_PAGINA}</span></span>
          {podeEditar && selecionaveisFiltradas.length > 0 && (
            <>
              <button type="button" disabled={enviando} className="text-[13px] font-medium text-vg-accent hover:underline disabled:pointer-events-none disabled:opacity-60" onClick={selecionarTodas}>
                Selecionar todas
              </button>
              <button type="button" disabled={enviando} className="text-[13px] font-medium text-vg-text-2 hover:underline disabled:pointer-events-none disabled:opacity-60" onClick={desmarcarTodas}>
                Desmarcar todas
              </button>
            </>
          )}
        </div>
      </div>

      {filtradas.length > 0 && (
        <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-2 text-sm">
          <span className="tabular-nums text-vg-text">{de + 1}-{Math.min(de + POR_PAGINA, filtradas.length)} de {filtradas.length}</span>
          <span className="flex items-center">
            <button
              type="button"
              aria-label="Página anterior"
              disabled={paginaAtual <= 1}
              onClick={() => setPagina(paginaAtual - 1)}
              className="grid size-8 place-items-center rounded-full text-vg-text hover:bg-white/5 disabled:pointer-events-none disabled:text-vg-text-3"
            >
              <Icone nome="chevron_left" />
            </button>
            <button
              type="button"
              aria-label="Próxima página"
              disabled={paginaAtual >= totalPaginas}
              onClick={() => setPagina(paginaAtual + 1)}
              className="grid size-8 place-items-center rounded-full text-vg-text hover:bg-white/5 disabled:pointer-events-none disabled:text-vg-text-3"
            >
              <Icone nome="chevron_right" />
            </button>
          </span>
        </div>
      )}

      {msg && <p role="status" className={`text-sm ${msg.erro ? "text-vg-erro" : "text-vg-ok"}`}>{msg.texto}</p>}

      {filtradas.length === 0 ? (
        <div className="rounded-xl border border-vg-line">
          <Vazio texto="Nenhum registro encontrado" />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visiveis.map((c) => (
            <label key={c.id} className={`${estiloCartao} flex items-start gap-3 p-4 ${podeEditar && !c.criadora ? "cursor-pointer" : ""}`}>
              {podeEditar && (
                <input
                  type="checkbox"
                  checked={c.criadora || marcadas.has(c.id)}
                  disabled={c.criadora || enviando}
                  onChange={(e) => alternar(c.id, e.target.checked)}
                  aria-label={`Associar a conexão à campanha ${c.nome}`}
                  className="mt-0.5"
                />
              )}
              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="truncate font-medium">{c.nome}</p>
                <div className="flex flex-wrap gap-1.5">
                  {c.criadora && <Selo cor="destaque">cria grupos</Selo>}
                  {!c.criadora && marcadas.has(c.id) && <Selo cor="neutro">admin</Selo>}
                </div>
              </div>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
