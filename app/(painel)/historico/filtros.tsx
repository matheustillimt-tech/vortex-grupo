"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  ACOES_HISTORICO, AREAS_HISTORICO, ROTULO_ACAO_HISTORICO, rotuloAreaHistorico, urlHistorico, type FiltrosHistorico,
} from "@/src/lib/regras/historico";
import { Icone } from "../_componentes/icone";
import { Janela } from "../_componentes/janela";
import { Campo, estiloBotao, estiloInput } from "../_componentes/ui";
import { CampoBusca } from "../_componentes/campo-busca";

type Rascunho = Pick<FiltrosHistorico, "acao" | "area" | "membroId" | "desde" | "ate" | "refId">;

function rascunhoDe(f: FiltrosHistorico): Rascunho {
  return { acao: f.acao, area: f.area, membroId: f.membroId, desde: f.desde, ate: f.ate, refId: f.refId };
}

const VAZIO: Rascunho = { acao: "", area: "", membroId: "", desde: "", ate: "", refId: "" };

/** Busca larga + botão `filter_list` que abre os filtros "Ação", "Onde" (área), "Equipe" (membro), "Data de
 *  início", "Data de fim" e "ID" (`ref_id`) numa janela, aplicados de uma vez em "Aplicar". "Endereço de IP" fica
 *  fora: o histórico não guarda IP de quem fez a ação. */
export function BarraFiltrosHistorico({ filtros, membros }: { filtros: FiltrosHistorico; membros: { id: string; nome: string }[] }) {
  const router = useRouter();
  const [busca, setBusca] = useState(filtros.q);
  const [aberta, setAberta] = useState(false);
  const [rascunho, setRascunho] = useState<Rascunho>(rascunhoDe(filtros));

  const ir = (mudar: Partial<FiltrosHistorico>) => router.push(urlHistorico(filtros, mudar), { scroll: false });

  function abrir() {
    setRascunho(rascunhoDe(filtros));
    setAberta(true);
  }
  function aplicar() {
    ir(rascunho);
    setAberta(false);
  }
  function limpar() {
    setRascunho(VAZIO);
    ir(VAZIO);
    setAberta(false);
  }

  const ativos = Object.values(rascunhoDe(filtros)).filter(Boolean).length;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" onClick={abrir} aria-label="Filtros" className="relative grid size-9 shrink-0 place-items-center rounded-md text-vg-text-2 transition-colors hover:bg-white/5 hover:text-white">
        <Icone nome="filter_list" tamanho={20} />
        {ativos > 0 && (
          <span className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-vg-primario text-[10px] font-semibold text-white">{ativos}</span>
        )}
      </button>

      <form
        className="relative block w-full max-w-xl flex-1"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          ir({ q: busca });
        }}
      >
        <CampoBusca valor={busca} aoMudar={setBusca} rotulo="Buscar no histórico pelo resumo ou e-mail" />
      </form>

      <Janela aberta={aberta} aoFechar={() => setAberta(false)} titulo="Filtros">
        <div className="space-y-4">
          <Campo rotulo="Ação">
            <select value={rascunho.acao} onChange={(e) => setRascunho((r) => ({ ...r, acao: e.target.value }))} className={estiloInput}>
              <option value="">Todos</option>
              {ACOES_HISTORICO.map((a) => (
                <option key={a} value={a}>{ROTULO_ACAO_HISTORICO[a]}</option>
              ))}
            </select>
          </Campo>

          <Campo rotulo="Onde">
            <select value={rascunho.area} onChange={(e) => setRascunho((r) => ({ ...r, area: e.target.value }))} className={estiloInput}>
              <option value="">Todas as áreas</option>
              {AREAS_HISTORICO.map((a) => (
                <option key={a} value={a}>{rotuloAreaHistorico(a)}</option>
              ))}
            </select>
          </Campo>

          <Campo rotulo="Equipe">
            <select value={rascunho.membroId} onChange={(e) => setRascunho((r) => ({ ...r, membroId: e.target.value }))} className={estiloInput}>
              <option value="">Todos</option>
              {membros.map((m) => (
                <option key={m.id} value={m.id}>{m.nome}</option>
              ))}
            </select>
          </Campo>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Campo rotulo="Data de início">
              <input type="date" value={rascunho.desde} onChange={(e) => setRascunho((r) => ({ ...r, desde: e.target.value }))} className={estiloInput} />
            </Campo>
            <Campo rotulo="Data de fim">
              <input type="date" value={rascunho.ate} onChange={(e) => setRascunho((r) => ({ ...r, ate: e.target.value }))} className={estiloInput} />
            </Campo>
          </div>

          <Campo rotulo="ID" dica="ID de referência do registro (ex.: o ID da campanha ou automação).">
            <input
              type="text"
              value={rascunho.refId}
              onChange={(e) => setRascunho((r) => ({ ...r, refId: e.target.value }))}
              className={estiloInput}
              placeholder="ref_id"
            />
          </Campo>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={limpar} className={estiloBotao("secundario")}>Limpar filtros</button>
            <button type="button" onClick={aplicar} className={estiloBotao("principal")}>Aplicar</button>
          </div>
        </div>
      </Janela>
    </div>
  );
}
