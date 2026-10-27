"use client";
import { useEffect, useRef, useState } from "react";
import { Icone } from "../../../_componentes/icone";
import { Botao } from "../../../_componentes/ui";
import { salvarCampanhasAnteriores, salvarChipsDivisao } from "./actions";

type Opcao = { id: string; nome: string };

/** "Campanhas Anteriores": as campanhas de onde quem entra nesta sai. */
export function CampanhasAnteriores({ campanhaId, campanhas, inicial }: { campanhaId: string; campanhas: Opcao[]; inicial: string[] }) {
  return <SelecaoMultipla campanhaId={campanhaId} opcoes={campanhas} inicial={inicial} rotulo="Campanhas Anteriores" vazio="Escolha as campanhas…" salvarLista={salvarCampanhasAnteriores} />;
}

/** "Dividir envios entre chips": nenhum escolhido = todos os conectados e admin do grupo. */
export function ChipsDivisao({ campanhaId, chips, inicial }: { campanhaId: string; chips: Opcao[]; inicial: string[] }) {
  return <SelecaoMultipla campanhaId={campanhaId} opcoes={chips} inicial={inicial} rotulo="Chips que enviam" vazio="Todos os chips conectados" salvarLista={salvarChipsDivisao} />;
}

/** Select múltiplo com chips: um campo que abre uma lista de opções marcáveis;
 *  cada escolhida aparece como chip removível, sem a dica de Ctrl/⌘ do select nativo múltiplo de antes. */
function SelecaoMultipla({ campanhaId, opcoes: campanhas, inicial, rotulo, vazio, salvarLista }: {
  campanhaId: string;
  opcoes: Opcao[];
  inicial: string[];
  rotulo: string;
  vazio: string;
  salvarLista: (campanhaId: string, ids: string[]) => Promise<{ erro?: string }>;
}) {
  const [selecionadas, setSelecionadas] = useState<string[]>(inicial);
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<{ texto: string; erro: boolean } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const porId = new Map(campanhas.map((c) => [c.id, c.nome]));

  useEffect(() => {
    if (!aberto) return;
    const aoClicarFora = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener("mousedown", aoClicarFora);
    return () => document.removeEventListener("mousedown", aoClicarFora);
  }, [aberto]);

  async function salvar(novas: string[]) {
    setSalvando(true);
    setMsg(null);
    try {
      const r = await salvarLista(campanhaId, novas);
      setMsg(r.erro ? { texto: r.erro, erro: true } : { texto: "Salvo.", erro: false });
    } catch {
      setMsg({ texto: "Não foi possível salvar.", erro: true });
    } finally {
      setSalvando(false);
    }
  }

  function alternar(id: string) {
    const novas = selecionadas.includes(id) ? selecionadas.filter((x) => x !== id) : [...selecionadas, id];
    setSelecionadas(novas);
  }

  function remover(id: string) {
    setSelecionadas((atual) => atual.filter((x) => x !== id));
  }

  return (
    <div className="space-y-2">
      <span className="block text-[13.3px] text-[#e3e9e5]">{rotulo}</span>
      <div ref={containerRef} className="relative">
        <button
          type="button"
          onClick={() => setAberto((a) => !a)}
          aria-haspopup="listbox"
          aria-expanded={aberto}
          disabled={salvando}
          className="flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-lg border border-vg-line-2 bg-transparent px-3 py-2 text-left text-sm text-vg-text transition hover:border-white/60"
        >
          {selecionadas.length === 0 ? (
            <span className="text-vg-text-3">{vazio}</span>
          ) : (
            selecionadas.map((id) => (
              <span key={id} className="inline-flex items-center gap-1 rounded-full bg-vg-panel-3 px-2.5 py-1 text-[12px] text-vg-text">
                {porId.get(id) ?? id}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    remover(id);
                  }}
                  aria-label={`Remover ${porId.get(id) ?? id}`}
                  className="text-vg-text-2 hover:text-white"
                >
                  <Icone nome="close" tamanho={14} />
                </button>
              </span>
            ))
          )}
        </button>
        {aberto && (
          <ul role="listbox" aria-multiselectable="true" className="absolute left-0 top-full z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-vg-line bg-vg-panel py-1 shadow-xl">
            {campanhas.map((c) => {
              const marcada = selecionadas.includes(c.id);
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={marcada}
                    onClick={() => alternar(c.id)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-vg-text transition-colors hover:bg-white/5"
                  >
                    <input type="checkbox" checked={marcada} readOnly className="pointer-events-none" />
                    {c.nome}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="flex items-center gap-3">
        <Botao type="button" onClick={() => salvar(selecionadas)} disabled={salvando}>SALVAR</Botao>
        {msg && <p role="status" className={`text-xs ${msg.erro ? "text-vg-erro" : "text-vg-ok"}`}>{msg.texto}</p>}
      </div>
    </div>
  );
}
