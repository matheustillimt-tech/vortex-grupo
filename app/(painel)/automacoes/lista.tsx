"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { dataHoraCompleta } from "@/src/lib/regras/abas-mensagens";
import type { Provedor } from "@/src/lib/checkout/parsers";
import {
  ehAcaoDePessoa,
  GATILHOS,
  GATILHOS_CHECKOUT,
  ROTULO_ACAO,
  ROTULO_GATILHO,
  rotuloGatilho,
  textoAcaoDePessoa,
  type Gatilho,
  type TipoAcaoAutomacao,
} from "@/src/lib/regras/automacoes";
import type { Situacao } from "@/src/lib/regras/calendario";
import { enterNaPropriaLinha } from "@/src/lib/regras/interacao";
import { resumoConteudo, ROTULO_TIPO, type TipoExecucao } from "@/src/lib/regras/conteudo";
import { Icone } from "../_componentes/icone";
import { Janela } from "../_componentes/janela";
import { MenuCartao, type ItemMenuCartao } from "../_componentes/menu-cartao";
import { SeloSituacao } from "../_componentes/situacao";
import { Vazio, estiloBotao, estiloInput } from "../_componentes/ui";
import { CampoBusca } from "../_componentes/campo-busca";
import { comAtivoLocal, marcarAtivoLocal, podarAtivoLocal, PROVEDOR_GERAL, ESTADOS, urlAutomacoes, type FiltrosAutomacoes as Filtros } from "./abas";
import {
  alternarAutomacoes,
  cancelarTudoAutomacao,
  duplicarAutomacoes,
  excluirAutomacoes,
  exportarAutomacaoJsonAcao,
  importarAutomacaoJson,
  moverParaPasta,
  type ResultadoLoteAutomacoes,
} from "./actions";

export type ExecucaoLinha = { id: string; campanhaId: string; tipo: TipoExecucao; agendadaPara: string; situacao: Situacao; detalhe: string | null };

/** `alvo`: nome da tag/blacklist das ações de pessoa (null se apagada; ausente nas outras ações). */
export type AcaoAutomacaoLinha = { tipo: TipoAcaoAutomacao; conteudo: unknown; atraso_min: number; alvo?: string | null };

export type AutomacaoLinha = {
  id: string;
  nome: string;
  gatilho: Gatilho;
  quando: string | null;
  provedor: Provedor | null;
  produto: string | null;
  ativo: boolean;
  /** Por que o sistema desativou (ex.: a conexão escolhida saiu da campanha); null quando não foi o sistema. */
  motivoDesativada: string | null;
  pasta: string | null;
  campanha: string;
  acoes: number;
  acoesDetalhe: AcaoAutomacaoLinha[];
  placar: { total: number; agendadas: number; enviando: number; concluidas: number; falhas: number };
  execucoes: ExecucaoLinha[];
};

// ---------- Seleção compartilhada entre o botão PASTA (no cabeçalho), o menu de cada linha e a lista ----------

type Selecao = {
  marcadas: string[];
  definir: (ids: string[]) => void;
  pastaAberta: boolean;
  setPastaAberta: (v: boolean) => void;
  /** Item "Mover para Pasta" do menu de uma linha: marca só ela e abre a janela de pastas. */
  moverUmaPasta: (id: string) => void;
};
const ContextoSelecao = createContext<Selecao>({ marcadas: [], definir: () => {}, pastaAberta: false, setPastaAberta: () => {}, moverUmaPasta: () => {} });

/** Guarda as marcadas da página. Só conta o que está na tela: trocar de filtro ou de página desmarca o resto. */
export function SelecaoAutomacoes({ ids, children }: { ids: string[]; children: React.ReactNode }) {
  const [brutas, definirBrutas] = useState<string[]>([]);
  const [pastaAberta, setPastaAberta] = useState(false);
  const marcadas = useMemo(() => brutas.filter((id) => ids.includes(id)), [brutas, ids]);
  const valor = useMemo<Selecao>(
    () => ({
      marcadas,
      definir: definirBrutas,
      pastaAberta,
      setPastaAberta,
      moverUmaPasta: (id: string) => {
        definirBrutas([id]);
        setPastaAberta(true);
      },
    }),
    [marcadas, pastaAberta],
  );
  return <ContextoSelecao.Provider value={valor}>{children}</ContextoSelecao.Provider>;
}

// ---------- Botão PASTA + janela ----------

const NOVA = "__nova__";

export function BotaoPasta({ pastas, filtros, base = "/automacoes" }: { pastas: string[]; filtros: Filtros; base?: string }) {
  const { marcadas, definir, pastaAberta, setPastaAberta } = useContext(ContextoSelecao);
  const router = useRouter();
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
      const r = await moverParaPasta(marcadas, pasta);
      if (r.erro) return setErro(r.erro);
      definir([]);
      setPastaAberta(false);
      router.refresh();
    });
  }

  return (
    <>
      <button type="button" className={estiloBotao("contorno")} onClick={() => { setErro(null); setPastaAberta(true); }}>
        PASTA
      </button>
      <Janela aberta={pastaAberta} aoFechar={() => setPastaAberta(false)} titulo="Pastas">
        <div className="space-y-5">
          <section className="space-y-2">
            <h3 className="text-[13.3px] font-medium text-vg-text">Filtrar por pasta</h3>
            {pastas.length ? (
              <ul className="flex flex-wrap gap-2">
                <li>
                  <Link href={urlAutomacoes(base, filtros, { pasta: null })} onClick={() => setPastaAberta(false)} aria-current={!filtros.pasta ? "page" : undefined} className={`${estiloBotao(!filtros.pasta ? "contorno" : "secundario")} !px-3 !py-1`}>
                    Todas
                  </Link>
                </li>
                {pastas.map((p) => (
                  <li key={p}>
                    <Link href={urlAutomacoes(base, filtros, { pasta: p })} onClick={() => setPastaAberta(false)} aria-current={filtros.pasta === p ? "page" : undefined} className={`${estiloBotao(filtros.pasta === p ? "contorno" : "secundario")} !px-3 !py-1`}>
                      <Icone nome="folder" tamanho={16} />
                      {p}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-vg-muted">Nenhuma pasta ainda. Crie uma abaixo movendo as automações marcadas.</p>
            )}
          </section>

          <section className="space-y-3 border-t border-vg-line pt-4">
            <h3 className="text-[13.3px] font-medium text-vg-text">Mover marcadas ({marcadas.length})</h3>
            {!marcadas.length && <p className="text-sm text-vg-muted">Marque as automações na lista para mover.</p>}
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
            <p role="status" className="text-sm text-vg-erro empty:hidden">{erro}</p>
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className={estiloBotao("secundario")} disabled={ocupado || !marcadas.length} onClick={() => mover(null)}>
                Tirar da pasta
              </button>
              <button type="button" className={estiloBotao()} disabled={ocupado || !marcadas.length || !destino} onClick={() => mover(destino)}>
                {ocupado ? "Movendo…" : "Mover marcadas"}
              </button>
            </div>
          </section>
        </div>
      </Janela>
    </>
  );
}

// ---------- Botão IMPORTAR JSON + janela ----------

export type CampanhaOpcaoImportar = { id: string; nome: string };

/** "IMPORTAR JSON" do cabeçalho: cola ou envia o arquivo, escolhe a campanha de destino na
 *  própria janela e valida com as mesmas regras do assistente — a automação nasce desativada. */
export function BotaoImportarJson({ campanhas, campanhaPadrao = null }: { campanhas: CampanhaOpcaoImportar[]; campanhaPadrao?: string | null }) {
  const router = useRouter();
  const [aberta, setAberta] = useState(false);
  const [campanhaId, setCampanhaId] = useState(campanhaPadrao ?? campanhas[0]?.id ?? "");
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();
  const idCampanha = useId();
  const idArquivo = useId();
  const idTexto = useId();
  const refArquivo = useRef<HTMLInputElement>(null);

  const MAXIMO_BYTES = 200 * 1024;

  function lerArquivo(arquivo: File | undefined) {
    if (!arquivo) return;
    if (arquivo.size > MAXIMO_BYTES) {
      setErro("Arquivo muito grande (máximo 200 KB).");
      return;
    }
    const leitor = new FileReader();
    leitor.onload = () => setTexto(String(leitor.result ?? ""));
    leitor.onerror = () => setErro("Não foi possível ler o arquivo.");
    leitor.readAsText(arquivo);
  }

  function importar() {
    setErro(null);
    if (!campanhaId) return setErro("Escolha a campanha de destino.");
    if (!texto.trim()) return setErro("Cole ou envie o JSON da automação.");
    iniciar(async () => {
      const r = await importarAutomacaoJson(campanhaId, texto);
      if (r.erro) return setErro(r.erro);
      setAberta(false);
      setTexto("");
      router.refresh();
    });
  }

  return (
    <>
      <button type="button" className={estiloBotao("contorno")} onClick={() => { setErro(null); setAberta(true); }}>
        <Icone nome="upload" />
        IMPORTAR JSON
      </button>
      <Janela aberta={aberta} aoFechar={() => setAberta(false)} titulo="Importar automação (JSON)">
        <div className="space-y-4">
          <label htmlFor={idCampanha} className="block space-y-1.5">
            <span className="text-[13.3px] text-[#e3e9e5]">Campanha de destino</span>
            <select id={idCampanha} value={campanhaId} onChange={(e) => setCampanhaId(e.target.value)} className={estiloInput}>
              {!campanhas.length && <option value="">Nenhuma campanha disponível</option>}
              {campanhas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </label>
          <label htmlFor={idArquivo} className="block space-y-1.5">
            <span className="text-[13.3px] text-[#e3e9e5]">Arquivo (.json, até 200 KB)</span>
            <input ref={refArquivo} id={idArquivo} type="file" accept=".json,application/json" onChange={(e) => lerArquivo(e.target.files?.[0])} className={`${estiloInput} cursor-pointer`} />
          </label>
          <label htmlFor={idTexto} className="block space-y-1.5">
            <span className="text-[13.3px] text-[#e3e9e5]">… ou cole o JSON aqui</span>
            <textarea id={idTexto} rows={8} value={texto} onChange={(e) => setTexto(e.target.value)} className={`${estiloInput} font-mono text-xs`} placeholder='{"versao": 1, "nome": "…", "gatilho": "…", "acoes": […]}' />
          </label>
          <p role="status" className="text-sm text-vg-erro empty:hidden">{erro}</p>
          <div className="flex justify-end gap-2">
            <button type="button" className={estiloBotao("secundario")} onClick={() => setAberta(false)}>Cancelar</button>
            <button type="button" className={estiloBotao()} disabled={ocupado} onClick={importar}>
              {ocupado ? "Importando…" : "Importar (desativada)"}
            </button>
          </div>
        </div>
      </Janela>
    </>
  );
}

// ---------- Filtros ----------

/** Valor do `<select>` de "Gatilho": gatilhos simples viram o próprio valor; o de checkout se abre num item por
 *  plataforma ("Diferente (função)" — Hotmart/Kiwify/Pagar.me/Checkout próprio + o genérico "qualquer
 *  plataforma"), codificado como `checkout:<provedor ou PROVEDOR_GERAL>`. */
function valorSelectGatilho(gatilho: Gatilho | null, provedor: Filtros["provedor"]): string {
  if (!gatilho) return "";
  if (gatilho === "checkout") return `checkout:${provedor ?? PROVEDOR_GERAL}`;
  return gatilho;
}

function lerSelectGatilho(v: string): { gatilho: Gatilho | null; provedor: Filtros["provedor"] } {
  if (!v) return { gatilho: null, provedor: null };
  if (v.startsWith("checkout:")) {
    const p = v.slice("checkout:".length);
    return { gatilho: "checkout", provedor: p === PROVEDOR_GERAL ? PROVEDOR_GERAL : (p as Provedor) };
  }
  return { gatilho: v as Gatilho, provedor: null };
}

export function FiltrosAutomacoes({ filtros, pastas, base = "/automacoes" }: { filtros: Filtros; pastas: string[]; base?: string }) {
  const router = useRouter();
  const ir = (mudar: Partial<Filtros>) => router.push(urlAutomacoes(base, filtros, mudar), { scroll: false });
  return (
    <div className="flex flex-wrap items-center gap-3">
      <form
        className="w-full"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          ir({ q: String(new FormData(e.currentTarget).get("q") ?? "").trim() });
        }}
      >
        <CampoBusca key={filtros.q} valorInicial={filtros.q} rotulo="Buscar automações pelo nome" icone="direita" />
      </form>
      <label className="flex items-center gap-2 text-sm text-vg-text">
        <span>Gatilho</span>
        <select
          value={valorSelectGatilho(filtros.gatilho, filtros.provedor)}
          onChange={(e) => ir(lerSelectGatilho(e.target.value))}
          className={`${estiloInput} w-auto`}
        >
          <option value="">Todos</option>
          {GATILHOS.map((g) =>
            g === "checkout"
              ? GATILHOS_CHECKOUT.map((c) => (
                  <option key={`checkout:${c.provedor ?? PROVEDOR_GERAL}`} value={`checkout:${c.provedor ?? PROVEDOR_GERAL}`}>
                    {c.rotulo}
                  </option>
                ))
              : <option key={g} value={g}>{ROTULO_GATILHO[g]}</option>,
          )}
        </select>
      </label>
      {(pastas.length > 0 || filtros.pasta) && (
        <label className="flex items-center gap-2 text-sm text-vg-text">
          <span>Pasta</span>
          <select value={filtros.pasta ?? ""} onChange={(e) => ir({ pasta: e.target.value || null })} className={`${estiloInput} w-auto`}>
            <option value="">Todas</option>
            {filtros.pasta && !pastas.includes(filtros.pasta) && <option value={filtros.pasta}>{filtros.pasta}</option>}
            {pastas.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
      )}
      <div role="group" aria-label="Situação" className="inline-flex rounded-[10px] border border-white/[0.14]">
        {ESTADOS.map((e) => {
          const ligado = filtros.estado === e.valor;
          return (
            <Link
              key={e.valor}
              href={urlAutomacoes(base, filtros, { estado: e.valor })}
              scroll={false}
              aria-current={ligado ? "true" : undefined}
              className={`whitespace-nowrap px-4 py-1.5 text-[13px] font-semibold uppercase transition-colors ${ligado ? "rounded-[10px] bg-vg-accent/15 text-vg-accent ring-1 ring-vg-accent/60" : "text-[#e3e9e5] hover:text-white"}`}
            >
              {e.rotulo}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Lista ----------

type AcaoLote = "desativar" | "ativar" | "duplicar" | "excluir";

/** Máximo de automações duplicadas de uma vez (o servidor confere de novo em `duplicarAutomacoes`). */
export const MAXIMO_DUPLICAR = 50;

/** Ordem da barra: Desativar, Ativar, Duplicar, Excluir (+ "Mover para pasta", extra, depois). */
const ACOES_LOTE: Record<AcaoLote, { rotulo: string; icone: string; rodar: (ids: string[]) => Promise<ResultadoLoteAutomacoes>; feito: (n: number) => string; perigo?: boolean }> = {
  desativar: { rotulo: "Desativar", icone: "block", rodar: (ids) => alternarAutomacoes(ids, false), feito: (n) => `${n} desativada(s).` },
  ativar: { rotulo: "Ativar", icone: "play_arrow", rodar: (ids) => alternarAutomacoes(ids, true), feito: (n) => `${n} ativada(s).` },
  // Reaproveita a duplicação por linha: cada cópia nasce desativada ("Cópia de …").
  duplicar: { rotulo: "Duplicar", icone: "content_copy", rodar: duplicarAutomacoes, feito: (n) => (n === 1 ? "1 automação duplicada." : `${n} automações duplicadas.`) },
  excluir: { rotulo: "Excluir", icone: "delete_forever", rodar: excluirAutomacoes, feito: (n) => `${n} excluída(s).`, perigo: true },
};

/** Contador-link pro `/acoes` filtrado por essa automação (e, quando `aba` é dada, por essa aba também) ("contadores-links").
 *  Sem `icone`, fica só o número (o total, Etapa 3N) — sempre com `title`
 *  (e `sr-only`) com o nome, já que não tem rótulo visível. Para não abrir a edição (a linha inteira agora navega
 *  pra lá), o clique interrompe a propagação. */
function PlacarLink({ automacaoId, aba, icone, rotulo, valor, cor = "text-vg-text-2" }: { automacaoId: string; aba?: string; icone?: string; rotulo: string; valor: number; cor?: string }) {
  const href = `/acoes?automacao=${automacaoId}${aba ? `&aba=${aba}` : ""}`;
  return (
    <Link href={href} title={rotulo} onClick={(e) => e.stopPropagation()} className="flex items-center gap-1 tabular-nums transition-colors hover:text-vg-accent">
      {icone && <Icone nome={icone} tamanho={16} className={cor} />}
      <span className="sr-only">{rotulo}: </span>
      {valor}
    </Link>
  );
}

/** Resumo de uma ação na lista expandida de uma automação: "Remover Lead" e "Tag Condicional" não têm conteúdo pra
 *  resumir (idêntico ao assistente, `resumoAcao` em `assistente.tsx`); as de pessoa são escritas à parte. */
function resumoAcaoAutomacao(a: AcaoAutomacaoLinha): string {
  if (a.tipo === "remover_participante" || a.tipo === "tag_condicional" || ehAcaoDePessoa(a.tipo)) return "";
  return resumoConteudo(a.tipo as TipoExecucao, a.conteudo);
}

function baixarArquivo(nome: string, conteudo: string, tipo: string) {
  const blob = new Blob([conteudo], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function ListaAutomacoes({ automacoes: doServidor, moverParaPasta = true }: { automacoes: AutomacaoLinha[]; /** Aba Automações da campanha some com o botão (Etapa 3N): a lista global continua com ele. */ moverParaPasta?: boolean }) {
  const { marcadas, definir, moverUmaPasta, setPastaAberta } = useContext(ContextoSelecao);
  const router = useRouter();
  // Ligar/desligar aparece na hora; quando a lista nova do servidor (router.refresh) já mostra igual, sai daqui.
  const [ativoLocal, setAtivoLocal] = useState<Readonly<Record<string, boolean>>>({});
  useEffect(() => setAtivoLocal((l) => podarAtivoLocal(l, doServidor)), [doServidor]);
  const automacoes = useMemo(() => comAtivoLocal(doServidor, ativoLocal), [doServidor, ativoLocal]);
  const [msg, setMsg] = useState<{ texto: string; erro: boolean } | null>(null);
  const [ocupado, iniciar] = useTransition();
  const [abertas, setAbertas] = useState<Set<string>>(new Set());
  const tudoMarcado = automacoes.length > 0 && marcadas.length === automacoes.length;

  function alternarMarca(id: string, sim: boolean) {
    definir(sim ? [...marcadas, id] : marcadas.filter((m) => m !== id));
  }

  function alternarAberta(id: string) {
    const s = new Set(abertas);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setAbertas(s);
  }

  function rodarLote(ids: string[], acao: AcaoLote) {
    const a = ACOES_LOTE[acao];
    if (!ids.length) return;
    if (acao === "duplicar" && ids.length > MAXIMO_DUPLICAR) {
      setMsg({ texto: `Duplique no máximo ${MAXIMO_DUPLICAR} automações por vez.`, erro: true });
      return;
    }
    if (acao === "excluir" && !window.confirm(`Excluir ${ids.length} automação(ões)? As execuções agendadas delas são canceladas. Não dá pra desfazer.`)) return;
    setMsg(null);
    iniciar(async () => {
      try {
        const r = await a.rodar(ids);
        if (acao === "ativar" || acao === "desativar") setAtivoLocal((l) => marcarAtivoLocal(l, ids, acao === "ativar", r.erros.length));
        const partes = [];
        if (r.feitas) partes.push(a.feito(r.feitas));
        if (r.erros.length) partes.push(r.erros.join(" "));
        setMsg({ texto: partes.join(" ") || "Nada a fazer.", erro: r.erros.length > 0 });
        if (r.feitas) definir([]);
        router.refresh();
      } catch {
        setMsg({ texto: "Não foi possível concluir. Tente de novo.", erro: true });
      }
    });
  }

  function alternarUma(id: string, ativo: boolean) {
    setMsg(null);
    iniciar(async () => {
      const r = await alternarAutomacoes([id], ativo);
      if (r.erros.length) setMsg({ texto: r.erros.join(" "), erro: true });
      setAtivoLocal((l) => marcarAtivoLocal(l, [id], ativo, r.erros.length));
      router.refresh();
    });
  }

  function duplicar(a: AutomacaoLinha) {
    setMsg(null);
    iniciar(async () => {
      const r = await duplicarAutomacoes([a.id]);
      if (r.erros.length) setMsg({ texto: r.erros.join(" "), erro: true });
      else setMsg({ texto: `"${a.nome}" duplicada (desativada).`, erro: false });
      router.refresh();
    });
  }

  function cancelarTudo(a: AutomacaoLinha) {
    if (!window.confirm(`Cancelar todas as execuções agendadas de "${a.nome}"? Não dá pra desfazer.`)) return;
    setMsg(null);
    iniciar(async () => {
      const r = await cancelarTudoAutomacao(a.id);
      if (r.erro) setMsg({ texto: r.erro, erro: true });
      else setMsg({ texto: `${r.feitas} execução(ões) agendada(s) de "${a.nome}" cancelada(s).`, erro: false });
      router.refresh();
    });
  }

  function excluirUma(a: AutomacaoLinha) {
    if (!window.confirm(`Excluir "${a.nome}"? As execuções agendadas são canceladas. Não dá pra desfazer.`)) return;
    setMsg(null);
    iniciar(async () => {
      const r = await excluirAutomacoes([a.id]);
      if (r.erros.length) setMsg({ texto: r.erros.join(" "), erro: true });
      else setMsg({ texto: `"${a.nome}" excluída.`, erro: false });
      router.refresh();
    });
  }

  function exportarJson(a: AutomacaoLinha) {
    setMsg(null);
    iniciar(async () => {
      const r = await exportarAutomacaoJsonAcao(a.id);
      if (r.erro || !r.json) {
        setMsg({ texto: r.erro ?? "Não foi possível exportar.", erro: true });
        return;
      }
      const nomeArquivo = `${(r.nome ?? "automacao").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.json`;
      baixarArquivo(nomeArquivo || "automacao.json", JSON.stringify(r.json, null, 2), "application/json");
    });
  }

  function exportarNumeros(a: AutomacaoLinha, tipo: "todos" | "com_status" | "falhas") {
    window.location.href = `/api/exportar/automacao/${a.id}?tipo=${tipo}`;
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <label className="flex items-center gap-2 text-[13px] text-vg-text-2">
          <input
            type="checkbox"
            checked={tudoMarcado}
            disabled={!automacoes.length}
            onChange={(e) => definir(e.target.checked ? automacoes.map((a) => a.id) : [])}
          />
          Selecionar tudo ({marcadas.length}/{automacoes.length})
        </label>
        <div className="flex flex-wrap items-center gap-1">
          {(Object.keys(ACOES_LOTE) as AcaoLote[]).map((k) => {
            const a = ACOES_LOTE[k];
            return (
              <button
                key={k}
                type="button"
                onClick={() => rodarLote(marcadas, k)}
                disabled={ocupado || !marcadas.length}
                className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-40 ${a.perigo ? "text-vg-erro hover:bg-vg-erro/10" : "text-vg-accent hover:bg-vg-accent/10"}`}
              >
                <Icone nome={a.icone} tamanho={18} />
                {a.rotulo}
              </button>
            );
          })}
          {/* Extra: abre a janela de pastas do botão PASTA com as marcadas. Some na aba
           *  Automações da campanha (Etapa 3N) — a lista global continua com ele. */}
          {moverParaPasta && (
            <button
              type="button"
              onClick={() => setPastaAberta(true)}
              disabled={ocupado || !marcadas.length}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium text-vg-accent transition-colors hover:bg-vg-accent/10 disabled:pointer-events-none disabled:opacity-40"
            >
              <Icone nome="drive_file_move" tamanho={18} />
              Mover para pasta
            </button>
          )}
        </div>
      </div>
      <p role="status" className={`px-1 text-sm empty:hidden ${msg?.erro ? "text-vg-erro" : "text-vg-muted"}`}>{msg?.texto}</p>

      {automacoes.length === 0 ? (
        <div className="rounded-xl border border-vg-line">
          <Vazio texto="Nenhum registro encontrado" />
        </div>
      ) : (
        <ul className="space-y-3">
          {automacoes.map((a) => {
            const aberta = abertas.has(a.id);
            const idDetalhe = `detalhe-${a.id}`;
            const itensMenu: ItemMenuCartao[] = [
              { rotulo: "Duplicar", icone: "content_copy", onClick: () => duplicar(a) },
              { rotulo: "Cancelar tudo", icone: "cancel", onClick: () => cancelarTudo(a) },
              { rotulo: "Exportar JSON", icone: "data_object", onClick: () => exportarJson(a) },
              { rotulo: "Exportar números", icone: "download", onClick: () => exportarNumeros(a, "todos") },
              { rotulo: "Exportar números com status", icone: "download", onClick: () => exportarNumeros(a, "com_status") },
              { rotulo: "Exportar números com falhas", icone: "download", onClick: () => exportarNumeros(a, "falhas") },
              { rotulo: "Editar", icone: "edit", onClick: () => router.push(`/automacoes/${a.id}`) },
              { rotulo: "Mover para Pasta", icone: "folder", onClick: () => moverUmaPasta(a.id) },
              { rotulo: "Excluir", icone: "delete", perigo: true, onClick: () => excluirUma(a) },
            ];
            return (
              <li key={a.id} className="overflow-hidden rounded-xl border border-vg-line">
                {/* A linha inteira abre a edição (Etapa 3N); os controles internos (seleção, expandir,
                 *  ativar/desativar, contadores, menu) interrompem a propagação pra não navegar junto. */}
                <div
                  role="link"
                  tabIndex={0}
                  onClick={() => router.push(`/automacoes/${a.id}`)}
                  onKeyDown={(e) => {
                    // Só a própria linha reage ao Enter: um Enter dado dentro de um controle interno (checkbox,
                    // botão de expandir, menu) borbulha até aqui e não deve navegar (revisão final B, item 3).
                    if (!enterNaPropriaLinha(e.key, e.target, e.currentTarget)) return;
                    e.preventDefault();
                    router.push(`/automacoes/${a.id}`);
                  }}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-vg-panel-2 px-3 py-2.5 outline-none hover:bg-[#2a352f] focus-visible:ring-2 focus-visible:ring-vg-accent/50"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={marcadas.includes(a.id)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => alternarMarca(a.id, e.target.checked)}
                      aria-label={`Selecionar ${a.nome}`}
                    />
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); alternarAberta(a.id); }}
                      aria-expanded={aberta}
                      aria-controls={idDetalhe}
                      aria-label={`${aberta ? "Esconder" : "Mostrar"} detalhes de ${a.nome}`}
                      className="grid size-7 shrink-0 place-items-center rounded-md text-vg-text-2 transition-colors hover:bg-white/5 hover:text-white"
                    >
                      <Icone nome={aberta ? "expand_less" : "expand_more"} />
                    </button>
                    <div className="min-w-0 text-[13px]">
                      <p className="truncate text-[14px] font-semibold">
                        {a.nome}
                        {a.pasta && <span className="ml-2 inline-flex items-center gap-0.5 align-middle text-[11px] font-normal text-vg-text-3"><Icone nome="folder" tamanho={13} />{a.pasta}</span>}
                      </p>
                      <p className="text-vg-text-2">
                        Acionar ao <strong className="font-semibold text-vg-text">{rotuloGatilho(a.gatilho, a.provedor)}</strong>
                        {a.gatilho === "checkout" && a.produto && <span className="text-vg-text-3"> · {a.produto}</span>}
                      </p>
                      {!a.ativo && a.motivoDesativada && (
                        <p className="text-amber-400">Desativada: {a.motivoDesativada}</p>
                      )}
                      {a.gatilho === "cronograma" && a.quando && (
                        <p className="tabular-nums text-vg-text-3">Agendado para: <span className="text-amber-400 underline">{dataHoraCompleta(a.quando)}</span></p>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-[13px]" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={a.ativo}
                      aria-label={`${a.nome}: ${a.ativo ? "ativada" : "desativada"}`}
                      disabled={ocupado}
                      onClick={() => alternarUma(a.id, !a.ativo)}
                      className="flex items-center gap-2 disabled:opacity-50"
                    >
                      <span aria-hidden className={`relative h-5 w-9 rounded-full transition-colors ${a.ativo ? "bg-vg-accent/60" : "bg-white/20"}`}>
                        <span className={`absolute top-0.5 size-4 rounded-full transition-all ${a.ativo ? "left-[18px] bg-vg-accent" : "left-0.5 bg-[#b4bdb7]"}`} />
                      </span>
                      <span className={a.ativo ? "text-vg-text" : "text-vg-text-3"}>{a.ativo ? "Ativado" : "Desativado"}</span>
                    </button>
                    <PlacarLink automacaoId={a.id} rotulo="Todas as ações" valor={a.placar.total} />
                    <PlacarLink automacaoId={a.id} aba="processando" icone="double_arrow" rotulo="Processando" valor={a.placar.enviando} cor="text-vg-accent" />
                    <PlacarLink automacaoId={a.id} aba="sucesso" icone="check_circle" rotulo="Sucesso" valor={a.placar.concluidas} cor="text-vg-ok" />
                    <PlacarLink automacaoId={a.id} aba="falhas" icone="remove_circle" rotulo="Fracasso" valor={a.placar.falhas} cor="text-vg-erro" />
                    <MenuCartao itens={itensMenu} />
                  </div>
                </div>
                {aberta && (
                  <div id={idDetalhe} className="space-y-4 border-t border-vg-line px-4 py-3">
                    <div>
                      <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-vg-text-3">Ações em ordem</h4>
                      {a.acoesDetalhe.length === 0 ? (
                        <p className="text-sm text-vg-muted">Sem ações.</p>
                      ) : (
                        <ol className="list-inside list-decimal space-y-1 text-[13px]">
                          {a.acoesDetalhe.map((x, i) => {
                            const resumo = resumoAcaoAutomacao(x);
                            return (
                              <li key={i} className="text-vg-text">
                                <span className="font-medium">{ehAcaoDePessoa(x.tipo) ? textoAcaoDePessoa(x.tipo, x.alvo) : ROTULO_ACAO[x.tipo]}</span>
                                {resumo && <span className="text-vg-text-2"> — {resumo}</span>}
                                {x.atraso_min > 0 && <span className="text-vg-text-3"> · {x.atraso_min} min depois</span>}
                              </li>
                            );
                          })}
                        </ol>
                      )}
                    </div>
                    <div>
                      <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-vg-text-3">Execuções recentes</h4>
                      {a.execucoes.length === 0 ? (
                        <p className="text-sm text-vg-muted">Nenhuma execução ainda.</p>
                      ) : (
                        <ul className="divide-y divide-vg-line text-[13px]">
                          {a.execucoes.map((e) => (
                            <li key={e.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
                              <span className="font-medium">{ROTULO_TIPO[e.tipo] ?? e.tipo}</span>
                              <span className="tabular-nums text-vg-text-2">{dataHoraCompleta(e.agendadaPara)}</span>
                              <SeloSituacao situacao={e.situacao} detalhe={e.detalhe} />
                              <Link href={`/campanhas/${e.campanhaId}/mensagens/${e.id}`} className="inline-flex items-center gap-1 font-medium text-vg-accent transition-colors hover:text-vg-accent-3">
                                Ver detalhes
                                <Icone nome="chevron_right" tamanho={16} />
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                      {a.execucoes.length >= 20 && <p className="pt-2 text-xs text-vg-text-3">Mostrando as 20 mais recentes.</p>}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
