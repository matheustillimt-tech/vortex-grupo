"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { formatarNumero } from "@/src/lib/regras/inicio";
import { CORES_PROJETO, validarProjeto, type CorProjeto } from "@/src/lib/regras/projetos";
import { Icone } from "../_componentes/icone";
import { Janela } from "../_componentes/janela";
import { MenuCartao, type ItemMenuCartao } from "../_componentes/menu-cartao";
import { estiloBotao, estiloInput, Vazio } from "../_componentes/ui";
import { CampoBusca } from "../_componentes/campo-busca";
import { arquivarProjeto, excluirProjeto, moverProjeto, salvarProjeto } from "./actions";
import { urlProjetos, type FiltrosProjetos, type ProjetoLinha, type ResumoProjeto } from "./comum";

// ---------- Busca ----------

export function FiltrosProjetosBarra({ filtros, base }: { filtros: FiltrosProjetos; base: "/projetos" | "/projetos/arquivados" }) {
  const router = useRouter();
  const ir = (mudar: Partial<FiltrosProjetos>) => router.push(urlProjetos(base, filtros, mudar), { scroll: false });
  return (
    <form
      className="w-full max-w-xs"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        ir({ q: String(new FormData(e.currentTarget).get("q") ?? "").trim() });
      }}
    >
      <CampoBusca key={filtros.q} valorInicial={filtros.q} rotulo="Buscar projetos pelo nome ou descrição" />
    </form>
  );
}

/** "Ordenação:" ao lado do título: "Data de criação" (padrão) e "Alfabética". "Posição" fica fora —
 *  sem coluna no banco. */
export function OrdenacaoProjetos({ filtros, base }: { filtros: FiltrosProjetos; base: "/projetos" | "/projetos/arquivados" }) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-2 text-sm text-vg-muted">
      <span>Ordenação:</span>
      <select
        value={filtros.ordem}
        onChange={(e) => {
          const v = e.target.value;
          router.push(urlProjetos(base, filtros, { ordem: v === "alfabetica" ? "alfabetica" : v === "posicao" ? "posicao" : "criacao" }), { scroll: false });
        }}
        className={`${estiloInput} w-auto`}
      >
        <option value="posicao">Posição</option>
        <option value="criacao">Data de criação</option>
        <option value="alfabetica">Alfabética</option>
      </select>
    </label>
  );
}

// ---------- Janela de criar/editar ----------

export type ProjetoEditavel = { id: string | null; nome: string; descricao: string; cor: CorProjeto };

function projetoVazio(): ProjetoEditavel {
  return { id: null, nome: "", descricao: "", cor: "amarelo" };
}

const CORES_LISTA = Object.keys(CORES_PROJETO) as CorProjeto[];

function JanelaProjeto({ inicial, aoFechar }: { inicial: ProjetoEditavel; aoFechar: () => void }) {
  const router = useRouter();
  const [p, setP] = useState(inicial);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();
  const idNome = useId();
  const idDescricao = useId();

  const valido = validarProjeto(p).ok;

  function salvar() {
    setErro(null);
    iniciar(async () => {
      try {
        const r = await salvarProjeto(p.id, { nome: p.nome, descricao: p.descricao, cor: p.cor });
        if (r.erro) return setErro(r.erro);
        aoFechar();
        router.refresh();
      } catch {
        setErro("Não foi possível salvar. Tente de novo.");
      }
    });
  }

  return (
    <Janela aberta aoFechar={aoFechar} titulo={p.id ? "Editar projeto" : "Novo projeto"}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          salvar();
        }}
      >
        <label htmlFor={idNome} className="block space-y-1.5">
          <span className="text-[13.3px] text-[#e3e9e5]">Nome</span>
          <input id={idNome} className={estiloInput} value={p.nome} maxLength={60} onChange={(e) => setP({ ...p, nome: e.target.value })} placeholder="Ex.: Aulão" autoFocus />
        </label>
        <label htmlFor={idDescricao} className="block space-y-1.5">
          <span className="text-[13.3px] text-[#e3e9e5]">Descrição</span>
          <textarea id={idDescricao} className={estiloInput} rows={3} maxLength={200} value={p.descricao} onChange={(e) => setP({ ...p, descricao: e.target.value })} placeholder="Opcional" />
        </label>

        <fieldset className="space-y-2">
          <legend className="text-[13.3px] text-[#e3e9e5]">Cor</legend>
          <div className="flex flex-wrap gap-2">
            {CORES_LISTA.map((cor) => {
              const marcado = p.cor === cor;
              const def = CORES_PROJETO[cor];
              return (
                <label
                  key={cor}
                  className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-white/60 ${marcado ? `${def.borda} ${def.texto} bg-white/5` : "border-vg-line-2 text-vg-text-2 hover:border-white/60"}`}
                >
                  <input type="radio" name="cor" className="sr-only" checked={marcado} onChange={() => setP({ ...p, cor })} />
                  <span aria-hidden className={`size-2.5 shrink-0 rounded-full ${def.classe}`} />
                  {def.rotulo}
                </label>
              );
            })}
          </div>
        </fieldset>

        <p role="status" className="text-sm text-vg-erro empty:hidden">{erro}</p>
        <div className="flex justify-end gap-2">
          <button type="button" className={estiloBotao("secundario")} onClick={aoFechar}>CANCELAR</button>
          <button type="submit" className={estiloBotao()} disabled={ocupado || !valido}>
            {ocupado ? "Salvando…" : "SALVAR"}
          </button>
        </div>
      </form>
    </Janela>
  );
}

export function BotaoNovoProjeto() {
  const [aberta, setAberta] = useState(false);
  const [vez, setVez] = useState(0);
  return (
    <>
      <button type="button" className={estiloBotao("contorno")} onClick={() => { setVez((v) => v + 1); setAberta(true); }}>
        <Icone nome="add" />
        ADICIONAR PROJETO
      </button>
      {aberta && <JanelaProjeto key={vez} inicial={projetoVazio()} aoFechar={() => setAberta(false)} />}
    </>
  );
}

// ---------- Cartão de cada projeto ----------

function CartaoProjeto({
  projeto,
  resumo,
  podeSubir,
  podeDescer,
}: {
  projeto: ProjetoLinha;
  resumo: ResumoProjeto;
  /** Posição do projeto na ordem global "Posição" (não só nesta página): `undefined` quando o projeto está
   *  arquivado (as setas não aparecem — "Mover" só vale pra Ativos). */
  podeSubir?: boolean;
  podeDescer?: boolean;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [, iniciar] = useTransition();
  const def = CORES_PROJETO[(projeto.cor as CorProjeto) in CORES_PROJETO ? (projeto.cor as CorProjeto) : "cinza"];

  function rodar(fn: () => Promise<{ erro?: string }>) {
    setErro(null);
    iniciar(async () => {
      try {
        const r = await fn();
        if (r.erro) return setErro(r.erro);
        router.refresh();
      } catch {
        setErro("Não foi possível concluir. Tente de novo.");
      }
    });
  }

  function excluir() {
    if (!window.confirm(`Excluir o projeto "${projeto.nome}"? As campanhas deste projeto ficam sem projeto. Nenhuma campanha é apagada.`)) return;
    rodar(() => excluirProjeto(projeto.id));
  }

  const itensMenu: ItemMenuCartao[] = [
    ...(podeSubir !== undefined
      ? ([
          { rotulo: "Mover para cima", icone: "arrow_upward", desabilitado: !podeSubir, onClick: () => rodar(() => moverProjeto(projeto.id, "cima")) },
          { rotulo: "Mover para baixo", icone: "arrow_downward", desabilitado: !podeDescer, onClick: () => rodar(() => moverProjeto(projeto.id, "baixo")) },
        ] as ItemMenuCartao[])
      : []),
    { rotulo: "Editar", icone: "edit", onClick: () => setEditando(true) },
    {
      rotulo: projeto.arquivado ? "Desarquivar" : "Arquivar",
      icone: projeto.arquivado ? "unarchive" : "archive",
      onClick: () => rodar(() => arquivarProjeto(projeto.id, !projeto.arquivado)),
    },
    { rotulo: "Excluir", icone: "delete", perigo: true, onClick: excluir },
  ];

  return (
    <li className="relative overflow-hidden rounded-xl border border-vg-line bg-vg-bg transition-colors hover:border-white/25">
      <span aria-hidden className={`absolute inset-x-0 top-0 h-1.5 ${def.classe}`} />
      <Link href={`/projetos/${projeto.id}`} className="block px-4 pb-3 pt-4">
        <p className="truncate pr-8 text-[15px] font-medium">{projeto.nome}</p>
        <p className="mt-0.5 min-h-[1.25em] truncate text-[12.5px] text-vg-text-2">{projeto.descricao}</p>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-[13px] tabular-nums text-vg-text">
          <span className="flex items-center gap-1">
            <Icone nome="campaign" tamanho={16} className="text-white" />
            {formatarNumero(resumo.campanhas)}
          </span>
          <span className="flex items-center gap-1">
            <Icone nome="groups" tamanho={16} className="text-white" />
            {formatarNumero(resumo.grupos)}
          </span>
          <span className="flex items-center gap-1">
            <Icone nome="people" tamanho={16} className="text-white" />
            {formatarNumero(resumo.leads)}
          </span>
        </div>
      </Link>
      <div className="absolute right-2 top-2">
        <MenuCartao itens={itensMenu} />
      </div>
      {erro && <p role="alert" className="px-4 pb-3 text-sm text-vg-erro">{erro}</p>}
      {editando && (
        <JanelaProjeto
          key={projeto.id}
          inicial={{ id: projeto.id, nome: projeto.nome, descricao: projeto.descricao, cor: (projeto.cor as CorProjeto) ?? "amarelo" }}
          aoFechar={() => setEditando(false)}
        />
      )}
    </li>
  );
}

export function ListaProjetos({
  projetos,
  resumos,
  ordemGlobal,
}: {
  projetos: ProjetoLinha[];
  resumos: Record<string, ResumoProjeto>;
  /** Ordem "Posição" de todos os projetos ATIVOS (não só os desta página), pras setas "Mover para cima/baixo"
   *  saberem se há vizinho pra trocar mesmo quando o projeto está na ponta da página mas não da lista inteira.
   *  Ausente (ex.: lista de Arquivados) = sem as setas. */
  ordemGlobal?: string[];
}) {
  if (!projetos.length) {
    return (
      <div className="rounded-xl border border-vg-line">
        <Vazio texto="Nenhum registro encontrado" />
      </div>
    );
  }
  return (
    <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {projetos.map((p) => {
        const indice = ordemGlobal?.indexOf(p.id);
        const naOrdemGlobal = indice !== undefined && indice !== -1;
        return (
          <CartaoProjeto
            key={p.id}
            projeto={p}
            resumo={resumos[p.id] ?? { campanhas: 0, grupos: 0, leads: 0 }}
            podeSubir={naOrdemGlobal ? indice! > 0 : undefined}
            podeDescer={naOrdemGlobal ? indice! < ordemGlobal!.length - 1 : undefined}
          />
        );
      })}
    </ul>
  );
}
