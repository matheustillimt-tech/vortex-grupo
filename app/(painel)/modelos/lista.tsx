"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, useId, useMemo, useState, useTransition } from "react";
import { ROTULO_TIPO, type TipoModelo } from "@/src/lib/regras/conteudo";
import { validarPasta } from "@/src/lib/regras/modelos";
import type { Valor } from "../_componentes/conteudo-editor";
import { Icone } from "../_componentes/icone";
import { Janela } from "../_componentes/janela";
import { PreviaMensagem } from "../_componentes/previa-mensagem";
import { Selo, Vazio, estiloBotao, estiloInput } from "../_componentes/ui";
import { CampoBusca } from "../_componentes/campo-busca";
import { arquivarModelos, duplicarModelos, excluirModelos, moverModelos, type ResultadoLoteModelos } from "./actions";
import { urlModelos, type FiltrosModelos } from "./filtros";
import { BotaoMidiasExpiradas } from "./midias-botao";

export type ModeloCartao = { id: string; nome: string; tipo: TipoModelo; conteudo: Valor; pasta: string | null };

const ordenar = (l: Iterable<string>) => [...new Set(l)].sort((a, b) => a.localeCompare(b, "pt-BR"));

// ---------- Estado compartilhado: marcados da página e pastas criadas agora (ainda sem modelo) ----------

type Contexto = {
  marcados: string[];
  definir: (ids: string[]) => void;
  /** Pastas do banco + as criadas em "+ PASTA" que ainda não receberam modelo. */
  pastas: string[];
  pastasLocais: string[];
  criarPastaLocal: (nome: string) => void;
};
const ContextoModelos = createContext<Contexto>({ marcados: [], definir: () => {}, pastas: [], pastasLocais: [], criarPastaLocal: () => {} });

/** Só conta como marcado o que está na página: trocar de filtro ou de página desmarca o resto. A lista local de
 *  pastas vive enquanto a tela está aberta; quando a pasta recebe o primeiro modelo, passa a vir do banco. */
export function ProvedorModelos({ ids, pastasBanco, children }: { ids: string[]; pastasBanco: string[]; children: React.ReactNode }) {
  const [brutos, definir] = useState<string[]>([]);
  const [locais, setLocais] = useState<string[]>([]);
  const marcados = useMemo(() => brutos.filter((id) => ids.includes(id)), [brutos, ids]);
  const pastasLocais = useMemo(() => locais.filter((p) => !pastasBanco.includes(p)), [locais, pastasBanco]);
  const pastas = useMemo(() => ordenar([...pastasBanco, ...pastasLocais]), [pastasBanco, pastasLocais]);
  const valor: Contexto = { marcados, definir, pastas, pastasLocais, criarPastaLocal: (nome) => setLocais((l) => ordenar([...l, nome])) };
  return <ContextoModelos.Provider value={valor}>{children}</ContextoModelos.Provider>;
}

/** Mensagem do resultado de uma ação em lote ("2 arquivado(s). …"). */
function textoResultado(r: ResultadoLoteModelos, feito: string): { texto: string; erro: boolean } {
  if ("erro" in r) return { texto: r.erro, erro: true };
  const partes = [];
  if (r.feitas) partes.push(`${r.feitas} ${feito}.`);
  if (r.erros.length) partes.push(r.erros.join(" "));
  return { texto: partes.join(" ") || "Nada a fazer.", erro: r.erros.length > 0 };
}

// ---------- Cabeçalho: + PASTA e + MODELO ----------

export function BotaoNovaPasta() {
  const { marcados, definir, pastas, criarPastaLocal } = useContext(ContextoModelos);
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
    const v = validarPasta(nome);
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
        const r = await moverModelos(marcados, v.nome);
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
        <Icone nome="add" />
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
            <input id={idNome} className={estiloInput} value={nome} maxLength={40} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Lançamento de março" />
            <span className="block text-xs text-vg-muted">
              {marcados.length
                ? `Os ${marcados.length} modelo(s) marcado(s) vão para a pasta nova.`
                : "Nenhum modelo marcado: a pasta fica disponível aqui até você salvar ou mover o primeiro modelo nela."}
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

/** "MODELO" abre a página `/modelos/novo` (editor completo) já com a pasta atual preenchida. */
export function BotaoNovoModelo({ pastaAtual }: { pastaAtual: string | null }) {
  return (
    <Link href={`/modelos/novo${pastaAtual ? `?pasta=${encodeURIComponent(pastaAtual)}` : ""}`} className={estiloBotao()}>
      <Icone nome="add" />
      MODELO
    </Link>
  );
}

// ---------- Busca, ordenação e pastas ----------

export function FiltrosModelos({ filtros }: { filtros: FiltrosModelos }) {
  const router = useRouter();
  const ir = (mudar: Partial<FiltrosModelos>) => router.push(urlModelos(filtros, mudar), { scroll: false });
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <form
        className="w-full max-w-xs"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          ir({ q: String(new FormData(e.currentTarget).get("q") ?? "").trim() });
        }}
      >
        <CampoBusca key={filtros.q} valorInicial={filtros.q} rotulo="Buscar modelos pelo nome" />
      </form>
      <div className="flex flex-wrap items-center gap-3">
        <BotaoMidiasExpiradas />
        <label className="flex items-center gap-2 text-sm text-vg-text">
          <span>Ordenação</span>
          <select
            value={filtros.ordem}
            onChange={(e) => ir({ ordem: e.target.value === "nome" ? "nome" : e.target.value === "criacao" ? "criacao" : "atualizacao" })}
            className={`${estiloInput} w-auto`}
          >
            <option value="criacao">Data de criação</option>
            <option value="atualizacao">Data de atualização</option>
            <option value="nome">Posição</option>
          </select>
        </label>
      </div>
    </div>
  );
}

/** Cartões das pastas (com a contagem de modelos não arquivados). Clicar filtra; "Todas" volta. */
export function FaixaPastas({ pastas, filtros }: { pastas: { nome: string; total: number }[]; filtros: FiltrosModelos }) {
  const { pastasLocais } = useContext(ContextoModelos);
  const todas = [...pastas, ...pastasLocais.filter((p) => !pastas.some((x) => x.nome === p)).map((nome) => ({ nome, total: 0 }))].sort((a, b) =>
    a.nome.localeCompare(b.nome, "pt-BR"),
  );
  // Pasta do filtro que não tem mais modelos: continua aparecendo pra dar pra sair dela.
  if (filtros.pasta && !todas.some((p) => p.nome === filtros.pasta)) todas.unshift({ nome: filtros.pasta, total: 0 });
  if (!todas.length) return null;
  const cartao = (ativo: boolean) =>
    `flex min-w-0 items-center gap-2.5 rounded-xl border px-3 py-2.5 text-[13px] transition-colors ${ativo ? "border-vg-accent/60 bg-vg-accent/10" : "border-vg-line bg-vg-bg hover:bg-white/[0.04]"}`;
  return (
    <nav aria-label="Pastas">
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <li>
          <Link href={urlModelos(filtros, { pasta: null })} scroll={false} aria-current={!filtros.pasta ? "page" : undefined} className={cartao(!filtros.pasta)}>
            <Icone nome="folder_copy" tamanho={22} className="text-vg-accent" />
            <span className="min-w-0 truncate font-medium">Todas</span>
          </Link>
        </li>
        {todas.map((p) => (
          <li key={p.nome}>
            <Link href={urlModelos(filtros, { pasta: p.nome })} scroll={false} aria-current={filtros.pasta === p.nome ? "page" : undefined} className={cartao(filtros.pasta === p.nome)}>
              <Icone nome="folder" tamanho={22} className="text-vg-accent" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium" title={p.nome}>{p.nome}</span>
                <span className="block text-[12px] text-vg-text-3">{p.total === 1 ? "1 modelo" : `${p.total} modelos`}</span>
              </span>
              <Icone nome="arrow_forward" tamanho={18} className="shrink-0 text-vg-text-3" />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// ---------- Janela "Mover para pasta" ----------

const NOVA = "__nova__";

function JanelaMover({ ids, aoFechar, aoMover }: { ids: string[]; aoFechar: () => void; aoMover: (r: ResultadoLoteModelos) => void }) {
  const { pastas } = useContext(ContextoModelos);
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
        const r = await moverModelos(ids, pasta);
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
        <p className="text-sm text-vg-muted">{ids.length} modelo(s) marcado(s).</p>
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
            <input id={idNova} value={nova} maxLength={40} onChange={(e) => setNova(e.target.value)} className={estiloInput} placeholder="Ex.: Lançamento de março" />
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

type Acao = "arquivar" | "desarquivar" | "duplicar" | "mover" | "excluir";

const ACOES: Record<Acao, { rotulo: string; icone: string; feito: string; perigo?: boolean }> = {
  arquivar: { rotulo: "Arquivar", icone: "archive", feito: "arquivado(s)" },
  desarquivar: { rotulo: "Desarquivar", icone: "unarchive", feito: "desarquivado(s)" },
  duplicar: { rotulo: "Duplicar", icone: "content_copy", feito: "duplicado(s)" },
  mover: { rotulo: "Mover para pasta", icone: "drive_file_move", feito: "movido(s)" },
  excluir: { rotulo: "Excluir", icone: "delete", feito: "excluído(s)", perigo: true },
};

const RODAR: Record<Exclude<Acao, "mover">, (ids: string[]) => Promise<ResultadoLoteModelos>> = {
  arquivar: (ids) => arquivarModelos(ids, true),
  desarquivar: (ids) => arquivarModelos(ids, false),
  duplicar: duplicarModelos,
  excluir: excluirModelos,
};

function Grade({ modelos, marcados, definir, acoes, rotuloGrupo }: {
  modelos: ModeloCartao[];
  marcados: string[];
  definir: (ids: string[]) => void;
  acoes: Acao[];
  rotuloGrupo: string;
}) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ texto: string; erro: boolean } | null>(null);
  const [ocupado, iniciar] = useTransition();
  const [movendo, setMovendo] = useState(false);
  const tudoMarcado = modelos.length > 0 && marcados.length === modelos.length;

  function concluir(r: ResultadoLoteModelos, feito: string) {
    setMsg(textoResultado(r, feito));
    if (!("erro" in r) && r.feitas) definir([]);
    router.refresh();
  }

  function rodar(acao: Acao) {
    if (!marcados.length) return;
    if (acao === "mover") return setMovendo(true);
    if (acao === "excluir" && !window.confirm(`Excluir ${marcados.length} modelo(s)? Não dá pra desfazer.`)) return;
    setMsg(null);
    const ids = marcados;
    iniciar(async () => {
      try {
        concluir(await RODAR[acao](ids), ACOES[acao].feito);
      } catch {
        setMsg({ texto: "Não foi possível concluir. Tente de novo.", erro: true });
      }
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <label className="flex items-center gap-2 text-[13px] text-vg-text-2">
          <input type="checkbox" checked={tudoMarcado} disabled={!modelos.length} onChange={(e) => definir(e.target.checked ? modelos.map((m) => m.id) : [])} />
          Selecionar tudo ({marcados.length}/{modelos.length})
        </label>
        <div role="group" aria-label={`Ações sobre os marcados (${rotuloGrupo})`} className="flex flex-wrap items-center gap-1">
          {acoes.map((k) => {
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

      {modelos.length === 0 ? (
        <div className="rounded-xl border border-vg-line">
          <Vazio texto="Nenhum registro encontrado" />
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {modelos.map((m) => (
            <li key={m.id} className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-vg-line bg-vg-bg">
              <div className="flex items-center gap-2 bg-vg-panel-2 px-3 py-2">
                <input
                  type="checkbox"
                  checked={marcados.includes(m.id)}
                  onChange={(e) => definir(e.target.checked ? [...marcados, m.id] : marcados.filter((x) => x !== m.id))}
                  aria-label={`Selecionar ${m.nome}`}
                />
                <p className="min-w-0 flex-1 truncate text-[13px] font-semibold uppercase" title={m.nome}>{m.nome}</p>
                <Selo cor="neutro" semPonto>{ROTULO_TIPO[m.tipo]}</Selo>
              </div>
              {/* O botão cobre o corpo (a prévia tem listas e blocos, que não podem ficar dentro de um <button>). */}
              <div className="relative max-h-[280px] flex-1 overflow-hidden p-3 transition-colors hover:bg-white/[0.03]">
                <PreviaMensagem tipo={m.tipo} conteudo={m.conteudo} />
                <Link href={`/modelos/${m.id}`} aria-label={`Editar ${m.nome}`} className="absolute inset-0 rounded-b-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-vg-accent/60" />
              </div>
            </li>
          ))}
        </ul>
      )}

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

/** Modelos ativos da página (a seleção fica no provedor, pra "+ PASTA" mover os marcados). */
export function ListaModelos({ modelos }: { modelos: ModeloCartao[] }) {
  const { marcados, definir } = useContext(ContextoModelos);
  return <Grade modelos={modelos} marcados={marcados} definir={definir} acoes={["arquivar", "duplicar", "mover", "excluir"]} rotuloGrupo="modelos" />;
}

/** Seção "Arquivado": seleção própria, com Desarquivar e Excluir. */
export function ListaArquivados({ modelos }: { modelos: ModeloCartao[] }) {
  const [brutos, definir] = useState<string[]>([]);
  const marcados = brutos.filter((id) => modelos.some((m) => m.id === id));
  return <Grade modelos={modelos} marcados={marcados} definir={definir} acoes={["desarquivar", "excluir"]} rotuloGrupo="arquivados" />;
}
