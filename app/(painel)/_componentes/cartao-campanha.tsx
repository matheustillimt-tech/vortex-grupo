"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { fixarCampanha } from "../campanhas/actions";
import { formatarNumero } from "@/src/lib/regras/inicio";
import { percentual, type CampanhaLista, type Resumo } from "@/src/lib/regras/campanhas";
import { CORES_PROJETO, type CorProjeto } from "@/src/lib/regras/projetos";
import { AvatarFoto } from "./avatar-foto";
import { Icone } from "./icone";

type CampanhaDoCartao = Pick<CampanhaLista, "id" | "nome" | "descricao" | "arquivada" | "projeto" | "foto" | "nomeGrupo"> & { fixada?: boolean };

/** Cartão de campanha da lista (`/campanhas`) e da coluna "Campanhas" do Início: números de 90 dias em cima
 *  (cliques, entradas, % de entrada, grupos), avatar (foto atual do grupo, `fotoDaCampanha`, ou a inicial), nome,
 *  nome atual do grupo (sem grupo: a descrição) e seta; o cartão todo leva
 *  pra campanha. Quando a campanha tem projeto, um selo com a cor e o nome leva pra ele — como o selo é um
 *  link separado (não dá pra aninhar `<a>` dentro de `<a>`), o link do cartão é uma camada por trás
 *  (`absolute inset-0`) e o conteúdo por cima ignora cliques (`pointer-events-none`), exceto o selo.
 *
 *  O botão `push_pin` "Fixar no topo" e a caixinha de seleção em massa só aparecem na lista de campanhas
 *  (`selecionavel`/`aoAlternarSelecao` vêm de lá); no Início e em `/projetos/[id]` o cartão fica igual a antes. */
export function CartaoCampanha({ campanha, resumo, mostrarFixar = false, selecionavel = false, selecionado = false, selecaoAtiva = false, aoAlternarSelecao }: {
  campanha: CampanhaDoCartao;
  resumo: Resumo;
  mostrarFixar?: boolean;
  selecionavel?: boolean;
  selecionado?: boolean;
  /** Algum cartão da lista está marcado (mesmo que não este): mantém a caixinha visível em todos, não só no
   *  hover/foco. */
  selecaoAtiva?: boolean;
  aoAlternarSelecao?: (id: string) => void;
}) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);
  const projeto = campanha.projeto;
  const corProjeto = projeto ? CORES_PROJETO[(projeto.cor as CorProjeto) in CORES_PROJETO ? (projeto.cor as CorProjeto) : "cinza"] : null;

  async function fixar(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setEnviando(true);
    await fixarCampanha(campanha.id, !campanha.fixada);
    setEnviando(false);
    router.refresh();
  }

  return (
    <div className="group relative rounded-xl border border-vg-line bg-vg-bg px-4 pb-3 pt-2.5 transition-colors hover:border-white/25">
      <Link
        href={`/campanhas/${campanha.id}`}
        aria-label={`Ver campanha ${campanha.nome}${campanha.arquivada ? " (arquivada)" : ""}`}
        className="absolute inset-0 z-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vg-accent"
      />
      {selecionavel && (
        <label
          className={`relative z-[2] float-right -mt-0.5 -mr-1 inline-flex items-center transition-opacity ${
            selecionado || selecaoAtiva ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          <span className="sr-only">Selecionar {campanha.nome}</span>
          <input
            type="checkbox"
            checked={selecionado}
            onChange={() => aoAlternarSelecao?.(campanha.id)}
            className="size-4 rounded border-vg-line-2 bg-transparent accent-vg-accent"
          />
        </label>
      )}
      {mostrarFixar && (
        <button
          type="button"
          onClick={fixar}
          disabled={enviando}
          aria-label={campanha.fixada ? "Desafixar do topo" : "Fixar no topo"}
          aria-pressed={!!campanha.fixada}
          className={`relative z-[2] float-right -mt-0.5 ${selecionavel ? "mr-6" : "-mr-1"} grid size-6 place-items-center rounded-full transition-opacity ${
            campanha.fixada ? "text-vg-accent opacity-100" : "text-vg-text-3 opacity-0 hover:text-white group-hover:opacity-100 group-focus-within:opacity-100"
          }`}
        >
          <Icone nome="push_pin" tamanho={16} />
        </button>
      )}
      <div className="pointer-events-none relative z-[1]">
        <div className="flex items-center gap-3 text-[13px] tabular-nums text-vg-text">
          {campanha.fixada && <Icone nome="push_pin" tamanho={14} className="text-vg-accent" />}
          <span className="flex items-center gap-1">
            <Icone nome="ads_click" tamanho={16} className="text-white" />
            {formatarNumero(resumo.cliques)}
          </span>
          <span className="flex items-center gap-1">
            <Icone nome="login" tamanho={16} className="text-white" />
            {formatarNumero(resumo.entradas)}
          </span>
          <span className="flex items-center gap-1">
            <Icone nome="percent" tamanho={16} className="text-white" />
            {percentual(resumo.entradas, resumo.cliques).replace(",", ".")}
          </span>
          <span className="flex items-center gap-1">
            <Icone nome="groups" tamanho={16} className="text-white" />
            {formatarNumero(resumo.grupos)}
          </span>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <AvatarFoto nome={campanha.nome} foto={campanha.foto} ativo={!campanha.arquivada} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-medium">{campanha.nome}</p>
            <p className="truncate text-[11px] text-vg-text-2">{campanha.nomeGrupo ?? campanha.descricao}</p>
          </div>
          <Icone nome="arrow_forward" className="shrink-0 text-vg-text-3" />
        </div>
      </div>
      {projeto && corProjeto && (
        <Link
          href={`/projetos/${projeto.id}`}
          className="relative z-[2] mt-2 inline-flex max-w-full items-center gap-1.5 truncate rounded-full border border-vg-line-2 px-2.5 py-1 text-[12px] text-vg-text-2 transition-colors hover:border-white/60 hover:text-white"
        >
          <span aria-hidden className={`size-2 shrink-0 rounded-full ${corProjeto.classe}`} />
          <span className="truncate">{projeto.nome}</span>
        </Link>
      )}
    </div>
  );
}
