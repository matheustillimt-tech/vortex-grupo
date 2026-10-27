"use client";
import { hostDoSite } from "@/src/lib/site";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, useId, useMemo, useState, useTransition } from "react";
import { formatarNumero } from "@/src/lib/regras/inicio";
import { sugerirSlugDeeplink, validarPastaDeeplink } from "@/src/lib/regras/deeplinks";
import { CopiarLink } from "../campanhas/[id]/copiar-link";
import { Icone } from "../_componentes/icone";
import { Janela } from "../_componentes/janela";
import { estiloBotao, estiloInput, Vazio } from "../_componentes/ui";
import { CampoBusca } from "../_componentes/campo-busca";
import { criarDeeplink, excluirDeeplinks, moverDeeplinks, type ResultadoLoteDeeplinks } from "./actions";
import { urlDeeplinks, type FiltrosDeeplinks } from "./filtros";

export type DeeplinkCartao = { id: string; nome: string; destino: string; slug: string; pasta: string | null; cliques: number };

const ordenar = (l: Iterable<string>) => [...new Set(l)].sort((a, b) => a.localeCompare(b, "pt-BR"));

// ---------- Estado compartilhado: marcados da página e pastas criadas agora (ainda sem deep link) ----------

type Contexto = {
  marcados: string[];
  definir: (ids: string[]) => void;
  /** Pastas do banco + as criadas em "+ PASTA" que ainda não receberam deep link. */
  pastas: string[];
  criarPastaLocal: (nome: string) => void;
};
const ContextoDeeplinks = createContext<Contexto>({ marcados: [], definir: () => {}, pastas: [], criarPastaLocal: () => {} });

/** Só conta como marcado o que está na página: trocar de filtro ou de página desmarca o resto (igual modelos). */
export function ProvedorDeeplinks({ ids, pastasBanco, children }: { ids: string[]; pastasBanco: string[]; children: React.ReactNode }) {
  const [brutos, definir] = useState<string[]>([]);
  const [locais, setLocais] = useState<string[]>([]);
  const marcados = useMemo(() => brutos.filter((id) => ids.includes(id)), [brutos, ids]);
  const pastasLocais = useMemo(() => locais.filter((p) => !pastasBanco.includes(p)), [locais, pastasBanco]);
  const pastas = useMemo(() => ordenar([...pastasBanco, ...pastasLocais]), [pastasBanco, pastasLocais]);
  const valor: Contexto = { marcados, definir, pastas, criarPastaLocal: (nome) => setLocais((l) => ordenar([...l, nome])) };
  return <ContextoDeeplinks.Provider value={valor}>{children}</ContextoDeeplinks.Provider>;
}

/** Mensagem do resultado de uma ação em lote ("2 movido(s). …"). */
function textoResultado(r: ResultadoLoteDeeplinks, feito: string): { texto: string; erro: boolean } {
  if ("erro" in r) return { texto: r.erro, erro: true };
  const partes = [];
  if (r.feitas) partes.push(`${r.feitas} ${feito}.`);
  if (r.erros.length) partes.push(r.erros.join(" "));
  return { texto: partes.join(" ") || "Nada a fazer.", erro: r.erros.length > 0 };
}

// ---------- Cabeçalho: + PASTA e + DEEP LINK ----------

export function BotaoNovaPasta() {
  const { marcados, definir, pastas, criarPastaLocal } = useContext(ContextoDeeplinks);
  const router = useRouter();
  const [aberta, setAberta] = useState(false);
  const [nome, setNome] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();
  const idNome = useId();

  function abrir() {
    setNome("");
    setErro(null);
    setAberta(true);
  }

  function criar(mover: boolean) {
    const v = validarPastaDeeplink(nome);
    if (!v.ok) return setErro(v.erro);
    if (!mover) {
      if (pastas.includes(v.nome)) return setErro("Já existe uma pasta com esse nome.");
      criarPastaLocal(v.nome);
      setAberta(false);
      return;
    }
    setErro(null);
    iniciar(async () => {
      try {
        const r = await moverDeeplinks(marcados, v.nome);
        const t = textoResultado(r, "movido(s)");
        if ("erro" in r || r.erros.length) return setErro(t.texto);
        definir([]);
        setAberta(false);
        router.refresh();
      } catch {
        setErro("Não foi possível criar a pasta. Tente de novo.");
      }
    });
  }

  return (
    <>
      <button type="button" className={estiloBotao("contorno")} onClick={abrir}>
        PASTA
      </button>
      <Janela aberta={aberta} aoFechar={() => setAberta(false)} titulo="Nova pasta">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            criar(marcados.length > 0);
          }}
        >
          <label htmlFor={idNome} className="block space-y-1.5">
            <span className="text-[13.3px] text-[#e3e9e5]">Nome da pasta</span>
            <input id={idNome} className={estiloInput} value={nome} maxLength={40} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Bio das redes" />
            <span className="block text-xs text-vg-muted">
              {marcados.length
                ? `Os ${marcados.length} deep link(s) marcado(s) vão para a pasta nova.`
                : "Nenhum deep link marcado: a pasta fica disponível aqui até você salvar ou mover o primeiro deep link nela."}
            </span>
          </label>
          <p role="alert" className="text-sm text-vg-erro empty:hidden">{erro}</p>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={estiloBotao("secundario")} onClick={() => setAberta(false)}>CANCELAR</button>
            {marcados.length > 0 && (
              <button type="button" className={estiloBotao("secundario")} disabled={ocupado || !nome.trim()} onClick={() => criar(false)}>
                Criar sem mover
              </button>
            )}
            <button type="submit" className={estiloBotao()} disabled={ocupado || !nome.trim()}>
              {ocupado ? "Criando…" : marcados.length ? `CRIAR E MOVER (${marcados.length})` : "CRIAR"}
            </button>
          </div>
        </form>
      </Janela>
    </>
  );
}

type NovoDeeplink = { nome: string; destino: string; slug: string; slugTocado: boolean };

const deeplinkVazio = (): NovoDeeplink => ({ nome: "", destino: "", slug: "", slugTocado: false });

function JanelaNovoDeeplink({ pastaAtual, aoFechar }: { pastaAtual: string | null; aoFechar: () => void }) {
  const router = useRouter();
  const [d, setD] = useState(deeplinkVazio());
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();
  const idNome = useId();
  const idLink = useId();
  const idSlug = useId();

  /** Enquanto o slug não foi tocado à mão, acompanha o nome (regra de `sugerirSlugDeeplink`). */
  function mudarNome(nome: string) {
    setD((atual) => ({ ...atual, nome, slug: atual.slugTocado ? atual.slug : sugerirSlugDeeplink(nome) }));
  }

  function salvar() {
    setErro(null);
    iniciar(async () => {
      try {
        const r = await criarDeeplink({ nome: d.nome, destino: d.destino, slug: d.slug, pasta: pastaAtual });
        if (r.erro) return setErro(r.erro);
        aoFechar();
        router.refresh();
      } catch {
        setErro("Não foi possível salvar. Tente de novo.");
      }
    });
  }

  return (
    <Janela aberta aoFechar={aoFechar} titulo="Cadastrar Deep link" semFechar>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          salvar();
        }}
      >
        <label htmlFor={idNome} className="block space-y-1.5">
          <span className="text-[13.3px] text-[#e3e9e5]">Nome *</span>
          <input id={idNome} className={estiloInput} value={d.nome} maxLength={60} onChange={(e) => mudarNome(e.target.value)} placeholder="Ex.: Bio do Instagram" autoFocus />
        </label>
        <label htmlFor={idLink} className="block space-y-1.5">
          <span className="text-[13.3px] text-[#e3e9e5]">Link</span>
          <input id={idLink} className={estiloInput} value={d.destino} maxLength={500} onChange={(e) => setD({ ...d, destino: e.target.value })} placeholder="https://" />
        </label>
        <label htmlFor={idSlug} className="block space-y-1.5">
          <span className="text-[13.3px] text-[#e3e9e5]">Endereço do deep link</span>
          <input
            id={idSlug}
            className={estiloInput}
            value={d.slug}
            maxLength={40}
            onChange={(e) => setD({ ...d, slug: e.target.value.toLowerCase(), slugTocado: true })}
          />
          <span className="block text-xs text-vg-muted">{hostDoSite()}/d/{d.slug || "…"}</span>
        </label>
        <p role="alert" className="text-sm text-vg-erro empty:hidden">{erro}</p>
        <div className="flex justify-end gap-2">
          <button type="button" className={estiloBotao("secundario")} onClick={aoFechar}>Fechar</button>
          <button type="submit" className={estiloBotao()} disabled={ocupado || !d.nome.trim() || !d.destino.trim() || !d.slug.trim()}>
            {ocupado ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </form>
    </Janela>
  );
}

export function BotaoNovoDeeplink({ pastaAtual }: { pastaAtual: string | null }) {
  const [aberta, setAberta] = useState(false);
  const [vez, setVez] = useState(0);
  return (
    <>
      <button type="button" className={estiloBotao()} onClick={() => { setVez((v) => v + 1); setAberta(true); }}>
        DEEP LINK
      </button>
      {aberta && <JanelaNovoDeeplink key={vez} pastaAtual={pastaAtual} aoFechar={() => setAberta(false)} />}
    </>
  );
}

// ---------- Busca e pastas ----------

export function FiltrosDeeplinksBarra({ filtros }: { filtros: FiltrosDeeplinks }) {
  const router = useRouter();
  const ir = (mudar: Partial<FiltrosDeeplinks>) => router.push(urlDeeplinks(filtros, mudar), { scroll: false });
  return (
    <form
      className="w-full max-w-xs"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        ir({ q: String(new FormData(e.currentTarget).get("q") ?? "").trim() });
      }}
    >
      <CampoBusca key={filtros.q} valorInicial={filtros.q} rotulo="Buscar deep links pelo nome" />
    </form>
  );
}

/** Ordenação: um só rótulo "Data de criação", com a direção num botão à parte. */
export function OrdenacaoDeeplinks({ filtros }: { filtros: FiltrosDeeplinks }) {
  const router = useRouter();
  const ir = (mudar: Partial<FiltrosDeeplinks>) => router.push(urlDeeplinks(filtros, mudar), { scroll: false });
  return (
    <div className="flex items-center gap-2 text-sm text-vg-text">
      <label className="flex items-center gap-2">
        <span>Ordenação</span>
        <select value={filtros.ordem} onChange={(e) => ir({ ordem: e.target.value === "antigos" ? "antigos" : "recentes" })} className={`${estiloInput} w-auto`}>
          <option value="recentes">Data de criação (mais novos primeiro)</option>
          <option value="antigos">Data de criação (mais antigos primeiro)</option>
        </select>
      </label>
      <button
        type="button"
        aria-label={filtros.ordem === "antigos" ? "Mais antigos primeiro" : "Mais novos primeiro"}
        onClick={() => ir({ ordem: filtros.ordem === "antigos" ? "recentes" : "antigos" })}
        className="grid size-8 place-items-center rounded-md text-vg-text-2 transition-colors hover:bg-white/5 hover:text-white"
      >
        <Icone nome={filtros.ordem === "antigos" ? "arrow_upward" : "arrow_downward"} tamanho={18} />
      </button>
    </div>
  );
}

/** Cartões das pastas (com a contagem de deep links). Clicar filtra; "Todas" volta (igual modelos). */
export function FaixaPastas({ pastas, filtros }: { pastas: { nome: string; total: number }[]; filtros: FiltrosDeeplinks }) {
  const todas = [...pastas].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  if (filtros.pasta && !todas.some((p) => p.nome === filtros.pasta)) todas.unshift({ nome: filtros.pasta, total: 0 });
  if (!todas.length) return null;
  const cartao = (ativo: boolean) =>
    `flex min-w-0 items-center gap-2.5 rounded-xl border px-3 py-2.5 text-[13px] transition-colors ${ativo ? "border-vg-accent/60 bg-vg-accent/10" : "border-vg-line bg-vg-bg hover:bg-white/[0.04]"}`;
  return (
    <nav aria-label="Pastas">
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <li>
          <Link href={urlDeeplinks(filtros, { pasta: null })} scroll={false} aria-current={!filtros.pasta ? "page" : undefined} className={cartao(!filtros.pasta)}>
            <Icone nome="folder_copy" tamanho={22} className="text-vg-accent" />
            <span className="min-w-0 truncate font-medium">Todas</span>
          </Link>
        </li>
        {todas.map((p) => (
          <li key={p.nome}>
            <Link href={urlDeeplinks(filtros, { pasta: p.nome })} scroll={false} aria-current={filtros.pasta === p.nome ? "page" : undefined} className={cartao(filtros.pasta === p.nome)}>
              <Icone nome="folder" tamanho={22} className="text-vg-accent" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium" title={p.nome}>{p.nome}</span>
                <span className="block text-[12px] text-vg-text-3">{p.total === 1 ? "1 deep link" : `${p.total} deep links`}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// ---------- Janela "Mover para pasta" ----------

const NOVA = "__nova__";

function JanelaMover({ ids, aoFechar, aoMover }: { ids: string[]; aoFechar: () => void; aoMover: (r: ResultadoLoteDeeplinks) => void }) {
  const { pastas } = useContext(ContextoDeeplinks);
  const [escolha, setEscolha] = useState<string>(pastas[0] ?? NOVA);
  const [nova, setNova] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();
  const idEscolha = useId();
  const idNova = useId();
  const destino = escolha === NOVA ? nova.trim() : escolha;

  function mover(pasta: string | null) {
    setErro(null);
    iniciar(async () => {
      try {
        const r = await moverDeeplinks(ids, pasta);
        if ("erro" in r) return setErro(r.erro);
        aoMover(r);
      } catch {
        setErro("Não foi possível mover. Tente de novo.");
      }
    });
  }

  return (
    <Janela aberta aoFechar={aoFechar} titulo="Mover para pasta">
      <div className="space-y-3">
        <p className="text-sm text-vg-muted">{ids.length} deep link(s) marcado(s).</p>
        <label htmlFor={idEscolha} className="block space-y-1.5">
          <span className="text-[13.3px] text-[#e3e9e5]">Pasta</span>
          <select id={idEscolha} value={escolha} onChange={(e) => setEscolha(e.target.value)} className={estiloInput}>
            {pastas.map((p) => <option key={p} value={p}>{p}</option>)}
            <option value={NOVA}>Nova pasta…</option>
          </select>
        </label>
        {escolha === NOVA && (
          <label htmlFor={idNova} className="block space-y-1.5">
            <span className="text-[13.3px] text-[#e3e9e5]">Nome da nova pasta</span>
            <input id={idNova} value={nova} maxLength={40} onChange={(e) => setNova(e.target.value)} className={estiloInput} placeholder="Ex.: Bio das redes" />
          </label>
        )}
        <p role="alert" className="text-sm text-vg-erro empty:hidden">{erro}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={estiloBotao("secundario")} disabled={ocupado} onClick={() => mover(null)}>Tirar da pasta</button>
          <button type="button" className={estiloBotao()} disabled={ocupado || !destino} onClick={() => mover(destino)}>
            {ocupado ? "Movendo…" : "MOVER"}
          </button>
        </div>
      </div>
    </Janela>
  );
}

// ---------- Grade de cartões ----------

type Acao = "mover" | "excluir";

const ACOES: Record<Acao, { rotulo: string; icone: string; feito: string; perigo?: boolean }> = {
  mover: { rotulo: "Mover para Pasta", icone: "drive_file_move", feito: "movido(s)" },
  excluir: { rotulo: "Excluir", icone: "delete", feito: "excluído(s)", perigo: true },
};

/** Barra em massa: "Selecionar tudo" + "Mover
 *  para Pasta"/"Excluir" sobre os marcados. Separada de `ListaDeeplinks` pra entrar antes da ordenação na
 *  página, mas compartilha o estado de seleção (contexto) e o resultado da ação com a lista — por isso devolve
 *  `null` sem fazer nada quando não há deep links (a lista mostra "Nenhum registro encontrado"). */
export function BarraEmMassaDeeplinks({ deeplinks }: { deeplinks: DeeplinkCartao[] }) {
  const { marcados, definir } = useContext(ContextoDeeplinks);
  const router = useRouter();
  const [msg, setMsg] = useState<{ texto: string; erro: boolean } | null>(null);
  const [ocupado, iniciar] = useTransition();
  const [movendo, setMovendo] = useState(false);
  const tudoMarcado = deeplinks.length > 0 && marcados.length === deeplinks.length;

  function concluir(r: ResultadoLoteDeeplinks, feito: string) {
    setMsg(textoResultado(r, feito));
    if (!("erro" in r) && r.feitas) definir([]);
    router.refresh();
  }

  function excluir() {
    if (!marcados.length) return;
    if (!window.confirm(`Excluir ${marcados.length} deep link(s)? Não dá pra desfazer.`)) return;
    setMsg(null);
    const ids = marcados;
    iniciar(async () => {
      try {
        concluir(await excluirDeeplinks(ids), ACOES.excluir.feito);
      } catch {
        setMsg({ texto: "Não foi possível concluir. Tente de novo.", erro: true });
      }
    });
  }

  function rodar(acao: Acao) {
    if (!marcados.length) return;
    if (acao === "mover") return setMovendo(true);
    excluir();
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <label className="flex items-center gap-2 text-[13px] text-vg-text-2">
          <input type="checkbox" checked={tudoMarcado} disabled={!deeplinks.length} onChange={(e) => definir(e.target.checked ? deeplinks.map((d) => d.id) : [])} />
          Selecionar tudo ({marcados.length}/{deeplinks.length})
        </label>
        <div role="group" aria-label="Ações sobre os marcados (deep links)" className="flex flex-wrap items-center gap-1">
          {(Object.keys(ACOES) as Acao[]).map((k) => {
            const a = ACOES[k];
            return (
              <button
                key={k}
                type="button"
                onClick={() => rodar(k)}
                disabled={ocupado || !marcados.length}
                className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-40 ${a.perigo ? "text-vg-erro hover:bg-vg-erro/10" : "text-vg-accent hover:bg-vg-accent/10"}`}
              >
                <Icone nome={a.icone} tamanho={18} />
                {a.rotulo}
              </button>
            );
          })}
        </div>
      </div>
      <p role="status" className={`px-1 text-sm empty:hidden ${msg?.erro ? "text-vg-erro" : "text-vg-muted"}`}>{msg?.texto}</p>
      {movendo && (
        <JanelaMover
          ids={marcados}
          aoFechar={() => setMovendo(false)}
          aoMover={(r) => {
            setMovendo(false);
            concluir(r, ACOES.mover.feito);
          }}
        />
      )}
    </div>
  );
}

/** Lista de deep links da página (a seleção fica no provedor, pra "+ PASTA" mover os marcados e pra
 *  `BarraEmMassaDeeplinks` agir sobre eles). `base` é `NEXT_PUBLIC_SITE_URL`, lido no servidor (`page.tsx`) —
 *  este componente cliente nunca lê variável de ambiente. */
export function ListaDeeplinks({ deeplinks, base }: { deeplinks: DeeplinkCartao[]; base: string }) {
  const { marcados, definir } = useContext(ContextoDeeplinks);

  return (
    <div className="space-y-2">
      {deeplinks.length === 0 ? (
        <div className="rounded-xl border border-vg-line">
          <Vazio texto="Nenhum registro encontrado" />
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {deeplinks.map((d) => (
            <li key={d.id} className="flex min-w-0 flex-col gap-2.5 overflow-hidden rounded-xl border border-vg-line bg-vg-bg p-3">
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={marcados.includes(d.id)}
                  onChange={(e) => definir(e.target.checked ? [...marcados, d.id] : marcados.filter((x) => x !== d.id))}
                  aria-label={`Selecionar ${d.nome}`}
                />
                <p className="min-w-0 flex-1 truncate text-[14px] font-semibold" title={d.nome}>{d.nome}</p>
              </div>
              <CopiarLink url={`${base}/d/${d.slug}`} compacto rotulo={`Link do deep link ${d.nome}`} />
              <p className="truncate text-xs text-vg-muted" title={d.destino}>{d.destino}</p>
              <span className="flex items-center gap-1 text-[13px] tabular-nums text-vg-text-2">
                <Icone nome="ads_click" tamanho={16} className="text-white" />
                {formatarNumero(d.cliques)} {d.cliques === 1 ? "clique" : "cliques"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
