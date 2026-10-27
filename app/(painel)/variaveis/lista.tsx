"use client";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { ROTULO_TIPO_VARIAVEL, TIPOS_VARIAVEL, type TipoVariavel } from "@/src/lib/regras/variaveis-globais";
import { Icone } from "../_componentes/icone";
import { Janela } from "../_componentes/janela";
import { Tabela, estiloBotao, estiloInput } from "../_componentes/ui";
import { CampoBusca } from "../_componentes/campo-busca";
import { excluirVariavelGlobal, salvarVariavelGlobal } from "./actions";

export type VariavelGlobal = { id: string; chave: string; tipo: TipoVariavel; categoria: string | null };

const CATEGORIA_PADRAO = "Campanha";
const SEM_CATEGORIA = "__sem_categoria__";
const OUTRA_CATEGORIA = "__outra__";

/** Valor inicial do select "Categoria": variável nova vem com "Campanha"; variável antiga sem categoria
 *  abre com "Sem categoria" (sem gravar "Campanha" sem a pessoa escolher). */
function categoriaInicial(inicial: VariavelGlobal | null): string {
  if (!inicial) return CATEGORIA_PADRAO;
  return inicial.categoria ?? SEM_CATEGORIA;
}

/** Janela de criar/editar: "Nome *", Tipo e Categoria. */
function JanelaVariavel({ inicial, categorias, aoFechar }: { inicial: VariavelGlobal | null; categorias: string[]; aoFechar: () => void }) {
  const router = useRouter();
  const [chave, setChave] = useState(inicial?.chave ?? "");
  const [tipo, setTipo] = useState<TipoVariavel>(inicial?.tipo ?? "texto");
  const [categoriaSelecionada, setCategoriaSelecionada] = useState(categoriaInicial(inicial));
  const [categoriaLivre, setCategoriaLivre] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();
  const idNome = useId();
  const idTipo = useId();
  const idCategoria = useId();
  const idCategoriaLivre = useId();
  const renomeando = Boolean(inicial && chave.trim() !== inicial.chave);
  // "Campanha" + as categorias já usadas (sem repetir), em ordem alfabética.
  const opcoesCategoria = [CATEGORIA_PADRAO, ...categorias.filter((c) => c !== CATEGORIA_PADRAO)].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const categoriaFinal = categoriaSelecionada === OUTRA_CATEGORIA ? categoriaLivre.trim() : categoriaSelecionada === SEM_CATEGORIA ? "" : categoriaSelecionada;

  return (
    <Janela aberta aoFechar={aoFechar} titulo="Variável">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setErro(null);
          iniciar(async () => {
            try {
              const r = await salvarVariavelGlobal(inicial?.id ?? null, { chave, tipo, categoria: categoriaFinal || null });
              if (r.erro) return setErro(r.erro);
              aoFechar();
              router.refresh();
            } catch {
              setErro("Não foi possível salvar. Tente de novo.");
            }
          });
        }}
      >
        <label htmlFor={idNome} className="block space-y-1.5">
          <span className="text-[13.3px] text-[#e3e9e5]">Nome *</span>
          <input id={idNome} className={estiloInput} value={chave} maxLength={30} onChange={(e) => setChave(e.target.value.toLowerCase())} placeholder="Ex.: link_checkout" autoComplete="off" />
          <span className="block text-xs text-vg-muted">
            Letras minúsculas e _ (2 a 30). No texto, use como {`{${chave.trim() || "nome"}}`}.
            {renomeando && " Os valores já salvos nas campanhas com o nome antigo continuam lá, como variável só da campanha."}
          </span>
        </label>
        <label htmlFor={idTipo} className="block space-y-1.5">
          <span className="text-[13.3px] text-[#e3e9e5]">Tipo</span>
          <select id={idTipo} className={estiloInput} value={tipo} onChange={(e) => setTipo(e.target.value as TipoVariavel)}>
            {TIPOS_VARIAVEL.map((t) => <option key={t} value={t}>{ROTULO_TIPO_VARIAVEL[t]}</option>)}
          </select>
        </label>
        <label htmlFor={idCategoria} className="block space-y-1.5">
          <span className="text-[13.3px] text-[#e3e9e5]">Categoria</span>
          <select id={idCategoria} className={estiloInput} value={categoriaSelecionada} onChange={(e) => setCategoriaSelecionada(e.target.value)}>
            {categoriaSelecionada === SEM_CATEGORIA && <option value={SEM_CATEGORIA}>Sem categoria</option>}
            {opcoesCategoria.map((c) => <option key={c} value={c}>{c}</option>)}
            <option value={OUTRA_CATEGORIA}>Outra…</option>
          </select>
          {categoriaSelecionada === OUTRA_CATEGORIA && (
            <input
              id={idCategoriaLivre}
              className={`${estiloInput} mt-2`}
              value={categoriaLivre}
              maxLength={40}
              onChange={(e) => setCategoriaLivre(e.target.value)}
              placeholder="Ex.: Oferta"
              aria-label="Nome da categoria"
              autoFocus
            />
          )}
        </label>
        <p role="alert" className="text-sm text-vg-erro empty:hidden">{erro}</p>
        <div className="flex justify-end gap-2">
          <button type="button" className={estiloBotao("secundario")} onClick={aoFechar}>Cancelar</button>
          <button type="submit" className={estiloBotao()} disabled={ocupado || !chave.trim() || (categoriaSelecionada === OUTRA_CATEGORIA && !categoriaLivre.trim())}>
            {ocupado ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </form>
    </Janela>
  );
}

/** Botão "+" do cabeçalho. */
export function NovaVariavel({ categorias }: { categorias: string[] }) {
  const [aberta, setAberta] = useState(false);
  return (
    <>
      <button type="button" className={estiloBotao()} onClick={() => setAberta(true)} aria-label="Nova variável global">
        <Icone nome="add" />
      </button>
      {aberta && <JanelaVariavel inicial={null} categorias={categorias} aoFechar={() => setAberta(false)} />}
    </>
  );
}

export function BuscaVariaveis({ q }: { q: string }) {
  const router = useRouter();
  return (
    <form
      className="w-48"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const busca = String(new FormData(e.currentTarget).get("q") ?? "").trim();
        router.push(busca ? `/variaveis?q=${encodeURIComponent(busca)}` : "/variaveis", { scroll: false });
      }}
    >
      <CampoBusca key={q} valorInicial={q} rotulo="Buscar variáveis pelo nome" rotuloVisivel="" />
    </form>
  );
}

export function TabelaVariaveis({ variaveis, categorias }: { variaveis: VariavelGlobal[]; categorias: string[] }) {
  const router = useRouter();
  const [editando, setEditando] = useState<VariavelGlobal | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();

  function excluir(v: VariavelGlobal) {
    if (!window.confirm(`Excluir a variável {${v.chave}}? Os valores já preenchidos nas campanhas continuam lá, como variável só da campanha.`)) return;
    setErro(null);
    iniciar(async () => {
      try {
        const r = await excluirVariavelGlobal(v.id);
        if (r.erro) return setErro(r.erro);
        router.refresh();
      } catch {
        setErro("Não foi possível excluir. Tente de novo.");
      }
    });
  }

  const botaoIcone = "grid size-8 place-items-center rounded-md text-vg-text-2 transition-colors hover:bg-white/5 disabled:opacity-40";

  return (
    <>
      <p role="alert" className="text-sm text-vg-erro empty:hidden">{erro}</p>
      <Tabela colunas={["Nome", "Tipo", "Categoria", ""]} vazio={variaveis.length ? undefined : "Nenhuma variável global cadastrada"}>
        {variaveis.map((v) => (
          <tr key={v.id}>
            <td className="px-3 py-2.5"><code className="rounded bg-vg-panel-2 px-1 text-vg-accent-3">{`{${v.chave}}`}</code></td>
            <td className="px-3 py-2.5">{ROTULO_TIPO_VARIAVEL[v.tipo] ?? v.tipo}</td>
            <td className="px-3 py-2.5 text-vg-text-2">{v.categoria ?? "—"}</td>
            <td className="px-3 py-1.5">
              <span className="flex items-center justify-end gap-1">
                <button type="button" className={`${botaoIcone} hover:text-vg-accent`} disabled={ocupado} onClick={() => setEditando(v)} aria-label={`Editar {${v.chave}}`}>
                  <Icone nome="edit" tamanho={18} />
                </button>
                <button type="button" className={`${botaoIcone} hover:text-vg-erro`} disabled={ocupado} onClick={() => excluir(v)} aria-label={`Excluir {${v.chave}}`}>
                  <Icone nome="delete" tamanho={18} />
                </button>
              </span>
            </td>
          </tr>
        ))}
      </Tabela>
      {editando && <JanelaVariavel key={editando.id} inicial={editando} categorias={categorias} aoFechar={() => setEditando(null)} />}
    </>
  );
}
