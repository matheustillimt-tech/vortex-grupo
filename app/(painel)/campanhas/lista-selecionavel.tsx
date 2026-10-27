"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CampanhaLista, Resumo } from "@/src/lib/regras/campanhas";
import { CartaoCampanha } from "../_componentes/cartao-campanha";
import { Icone } from "../_componentes/icone";
import { estiloBotao, estiloCartao, Vazio } from "../_componentes/ui";
import { arquivarVarias } from "./actions";

const MAXIMO_EXPORTACAO = 50;

/** Barra de ações em massa + grade de cartões: "Selecionar tudo (x/N)", `archive` "Arquivar" e `download`
 *  "Exportar leads" (reaproveita `/api/exportar/pessoas`, filtrado pelas campanhas marcadas — até
 *  `MAXIMO_EXPORTACAO`). À direita, "Ver exportações" (Etapa 3K) abre `/campanhas/exportacoes`: a lista dos CSVs já
 *  gerados, pra baixar de novo (a exportação continua saindo pronta na hora). */
export function ListaSelecionavel({ itens, resumos }: { itens: CampanhaLista[]; resumos: [string, Resumo][] }) {
  const router = useRouter();
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const mapaResumos = new Map(resumos);

  const todosMarcados = itens.length > 0 && itens.every((c) => selecionados.has(c.id));

  function alternar(id: string) {
    setSelecionados((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }

  function alternarTodos() {
    setSelecionados(todosMarcados ? new Set() : new Set(itens.map((c) => c.id)));
  }

  async function arquivarSelecionadas() {
    if (selecionados.size === 0) return;
    if (!confirm(`Arquivar ${selecionados.size} campanha(s)? O link de cada uma para de funcionar.`)) return;
    setEnviando(true);
    const r = await arquivarVarias([...selecionados], true);
    setEnviando(false);
    setErro(r?.erro ?? null);
    if (!r?.erro) {
      setSelecionados(new Set());
      router.refresh();
    }
  }

  const hrefExportar = `/api/exportar/pessoas?campanhas=${[...selecionados].slice(0, MAXIMO_EXPORTACAO).join(",")}`;
  const exportacaoCortada = selecionados.size > MAXIMO_EXPORTACAO;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-sm text-vg-text">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={todosMarcados} onChange={alternarTodos} className="size-4 rounded border-vg-line-2 bg-transparent accent-vg-accent" disabled={itens.length === 0} />
          Selecionar tudo ({selecionados.size}/{itens.length})
        </label>
        <button
          type="button"
          onClick={arquivarSelecionadas}
          disabled={selecionados.size === 0 || enviando}
          className="mx-auto inline-flex items-center gap-1 text-[13px] font-medium text-vg-text transition-colors hover:text-white disabled:opacity-40"
        >
          <Icone nome="archive" tamanho={16} /> Arquivar
        </button>
        <div className="flex items-center gap-3">
          <a
            href={selecionados.size ? hrefExportar : undefined}
            aria-disabled={selecionados.size === 0}
            className={`inline-flex items-center gap-1 text-[13px] font-medium transition-colors ${selecionados.size ? "text-vg-text hover:text-white" : "pointer-events-none text-vg-text-3"}`}
          >
            <Icone nome="download" tamanho={16} /> Exportar leads
          </a>
          <Link href="/campanhas/exportacoes" className={estiloBotao("contorno")}>
            Ver exportações
            <Icone nome="arrow_forward" tamanho={18} />
          </Link>
        </div>
        {exportacaoCortada && (
          <p className="w-full text-xs text-vg-aviso">
            A exportação leva só as primeiras {MAXIMO_EXPORTACAO} das {selecionados.size} campanhas selecionadas.
          </p>
        )}
        {erro && <p role="alert" className="w-full text-xs text-vg-erro">{erro}</p>}
      </div>

      {itens.length === 0 ? (
        <div className={estiloCartao}>
          <Vazio texto="Nenhum registro encontrado" />
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {itens.map((c) => (
            <CartaoCampanha
              key={c.id}
              campanha={c}
              resumo={mapaResumos.get(c.id) ?? { cliques: 0, entradas: 0, saidas: 0, participantes: 0, admins: 0, grupos: 0, gruposCheios: 0 }}
              mostrarFixar
              selecionavel
              selecionado={selecionados.has(c.id)}
              selecaoAtiva={selecionados.size > 0}
              aoAlternarSelecao={alternar}
            />
          ))}
        </div>
      )}
    </div>
  );
}
