"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { dataHoraCompleta } from "@/src/lib/regras/abas-mensagens";
import {
  ACOES_ASSISTENTE,
  AVISO_DESATIVAR_COMUNIDADE,
  campanhasDoEstado,
  conteudoDoEstado,
  conteudoInicialAcao,
  destinoDepoisDeCriar,
  ehRelatorio,
  ehTipoExecucaoAssistente,
  escolheContasEGrupos,
  estadoComPreset,
  estadoDaSeguinte,
  hrefRelatorio,
  listaDeAcoes,
  montarEntradaAcao,
  NOTA_RELATORIO_STATUS,
  PASSOS_ACAO,
  passosDoTipo,
  passosVisiveis,
  pendenciaDoPassoAcao,
  podeIrParaAcao,
  quandoParaIso,
  rotuloAcaoAssistente,
  ROTULO_PASSO_ACAO,
  tituloPassoConteudo,
  telefonesDoTexto,
  type CampanhaDoAssistente,
  type CategoriaAcao,
  type EstadoAcao,
  type PassoAcao,
  type TipoAcaoAssistente,
} from "@/src/lib/regras/assistente-acao";
import { resumoConteudo, type ConteudoConfiguracao } from "@/src/lib/regras/conteudo";
import { paraV2, resumoMensagemV2 } from "@/src/lib/regras/conteudo-v2";
import { isoParaCampoBrasilia } from "@/src/lib/regras/horario";
import { PROVA } from "@/src/lib/zapbot/prova";
import { Avatar } from "../../_componentes/avatar";
import type { ModeloParaEditor } from "../../_componentes/editor-mensagens";
import { Icone } from "../../_componentes/icone";
import { Passos } from "../../_componentes/passos";
import { DefinirTrilha } from "../../_componentes/trilha";
import { estiloBotao, estiloInput, Vazio } from "../../_componentes/ui";
import { criarAcao, dadosDaCampanhaAcao, listarGruposAcao, type GrupoDaAcao } from "../actions";
import { AcoesSeguintes, ConteudoAcao, SeloBeta } from "./conteudo-acao";

type Projeto = { id: string; nome: string; descricao: string };
type Conta = { id: string; nome: string; telefone: string | null; status: string };
type DadosCampanha = { contas: Conta[]; variaveis: string[] };
/** Conta conectada (passo Contas de "Entrar no Grupo": qualquer conta, não só as da campanha). */
export type ContaConectada = { id: string; nome: string; telefone: string | null };

const POR_PAGINA_CAMPANHAS = 12;
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function AssistenteAcao({ campanhas, projetos, modelos, telefones, contasConectadas, campanhaInicial, acaoInicial, contaInicial }: {
  campanhas: CampanhaDoAssistente[];
  projetos: Projeto[];
  contasConectadas: ContaConectada[];
  modelos: { id: string; nome: string; tipo: string; conteudo: unknown }[];
  telefones: { nome: string; telefone: string }[];
  /** Presets da URL, já conferidos no servidor (campanha ativa, ação da lista). */
  campanhaInicial: string | null;
  acaoInicial: TipoAcaoAssistente | null;
  /** `?conta=<id>` (botão "ADICIONAR" da aba Ações do detalhe da conta, Etapa 3K Tarefa 4): marcada assim que
   *  o passo "Contas" oferecer essa conta (não força campanha nem ação). */
  contaInicial?: string | null;
}) {
  const router = useRouter();
  const inicio = useMemo(() => estadoComPreset(campanhaInicial, acaoInicial), [campanhaInicial, acaoInicial]);
  const [estado, setEstado] = useState<EstadoAcao>(inicio.estado);
  const [passo, setPasso] = useState<PassoAcao>(inicio.passo);
  const [visitados, setVisitados] = useState<Set<PassoAcao>>(() => new Set(PASSOS_ACAO.slice(0, PASSOS_ACAO.indexOf(inicio.passo) + 1)));
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [enviando, iniciar] = useTransition();
  const tituloRef = useRef<HTMLHeadingElement>(null);

  // Dados da campanha (contas + variáveis), carregados só quando a ação é de UMA campanha e o passo chega em "Contas".
  const [dados, setDados] = useState<Record<string, DadosCampanha | { erro: string }>>({});
  // Nome dos grupos já marcados (a lista é paginada; o resumo precisa dos nomes).
  const [nomesGrupos, setNomesGrupos] = useState<Record<string, string>>({});

  // Passos da ação escolhida (relatórios e "Entrar no Grupo" pulam alguns); `atual` é a posição neles.
  const passos = passosDoTipo(estado.tipo);
  const atual = passos.indexOf(passo);
  // Barra do topo (Etapa 3N): começa menor e cresce com as escolhas; a navegação de verdade continua em
  // `passos` (de `passosDoTipo`), que não mudam — isso é só o que a barra mostra.
  const passosExibidos = passosVisiveis(estado, campanhas);
  const alvo = campanhasDoEstado(estado, campanhas);
  const umaCampanha = escolheContasEGrupos(alvo.length) ? alvo[0] : null;
  const dadosUma = umaCampanha ? dados[umaCampanha] : undefined;
  const pendencia = pendenciaDoPassoAcao(passo, estado, campanhas);
  const modelosEditor: ModeloParaEditor[] = useMemo(() => modelos.map((m) => ({ id: m.id, nome: m.nome, mensagens: paraV2(m.conteudo).mensagens })), [modelos]);

  const pedidos = useRef(new Set<string>());
  /** Busca os dados de uma campanha (contas + variáveis). Em erro — da própria chamada (`{erro}`) ou de rede —
   *  tira do controle de pedidos já feitos, pra "Tentar de novo" poder chamar de novo. */
  const carregarDadosCampanha = useCallback((campanhaId: string) => {
    pedidos.current.add(campanhaId);
    dadosDaCampanhaAcao(campanhaId).then(
      (r) => {
        if ("erro" in r) pedidos.current.delete(campanhaId);
        setDados((d) => ({ ...d, [campanhaId]: r }));
      },
      () => {
        pedidos.current.delete(campanhaId);
        setDados((d) => ({ ...d, [campanhaId]: { erro: "Não foi possível carregar as conexões." } }));
      },
    );
  }, []);
  useEffect(() => {
    if (!umaCampanha || PASSOS_ACAO.indexOf(passo) < PASSOS_ACAO.indexOf("contas") || pedidos.current.has(umaCampanha)) return;
    carregarDadosCampanha(umaCampanha);
  }, [umaCampanha, passo, carregarDadosCampanha]);

  const mudar = (p: Partial<EstadoAcao>) => {
    setEstado((e) => ({ ...e, ...p }));
    setErro(null);
    setSucesso(null);
  };

  // `?conta=<id>` (ADICIONAR da aba Ações do detalhe da conta): marca a conta assim que ela aparecer na lista
  // que o passo "Contas" oferece — sem campanha nem ação pré-escolhidas, só dá pra saber isso depois que a
  // pessoa escolhe a campanha (ou entra em "Entrar no Grupo", que já lista todas as contas conectadas). Só
  // marca uma vez (contas/contasTodas ainda no estado inicial) — se a pessoa já tocou nisso, não sobrescreve.
  useEffect(() => {
    if (!contaInicial || estado.contas.length || !estado.contasTodas) return;
    if (estado.tipo === "entrar_grupo") {
      if (contasConectadas.some((c) => c.id === contaInicial)) mudar({ contasTodas: false, contas: [contaInicial] });
      return;
    }
    if (passo !== "contas" || !dadosUma || !("contas" in dadosUma)) return;
    if (dadosUma.contas.some((c) => c.id === contaInicial)) mudar({ contasTodas: false, contas: [contaInicial] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contaInicial, estado.tipo, estado.contas.length, estado.contasTodas, passo, dadosUma, contasConectadas]);
  /** Trocar campanha/projeto/categoria zera contas e grupos específicos (eram da campanha anterior). */
  const mudarAlvo = (p: Partial<EstadoAcao>) => mudar({ ...p, contasTodas: true, contas: [], gruposTodos: true, grupos: [] });
  const escolherTipo = (tipo: TipoAcaoAssistente) => {
    if (tipo === estado.tipo) return;
    // Relatórios e "Entrar no Grupo" não encadeiam ações nem agendam; "Entrar no Grupo" escolhe contas soltas.
    const proprio = !ehTipoExecucaoAssistente(tipo);
    mudar({
      tipo, conteudo: conteudoInicialAcao(tipo), telefonesTexto: "", importante: false,
      ...(proprio ? { seguintes: [], agendar: false } : {}),
      ...(tipo === "entrar_grupo" || estado.tipo === "entrar_grupo" ? { contasTodas: tipo !== "entrar_grupo", contas: [] } : {}),
    });
  };

  function ir(alvoPasso: PassoAcao) {
    setPasso(alvoPasso);
    setVisitados((v) => new Set(v).add(alvoPasso));
    setErro(null);
    requestAnimationFrame(() => tituloRef.current?.focus());
  }

  function enviar() {
    setErro(null);
    for (const p of passos) {
      const falta = pendenciaDoPassoAcao(p, estado, campanhas);
      if (falta) return setErro(`${ROTULO_PASSO_ACAO[p].rotulo}: ${falta}`);
    }
    const entrada = montarEntradaAcao(estado, campanhas);
    if (!entrada) return;
    const tipos = [estado.tipo, ...estado.seguintes.map((s) => s.tipo)];
    if (tipos.includes("desativar_comunidade") && !window.confirm(`Desativar a comunidade de ${alvo.length} campanha(s) no WhatsApp? Não dá pra desfazer.`)) return;
    iniciar(async () => {
      try {
        const r = await criarAcao(entrada);
        if ("erro" in r) return setErro(r.erro);
        if (estado.tipo === "entrar_grupo") {
          const n = r.ids.length;
          return setSucesso(`${n === 1 ? "1 conexão entra" : `${n} conexões entram`} no grupo no próximo minuto. O resultado aparece no Histórico.`);
        }
        // Com ações extras, cada campanha ganha 1 + N execuções: o aviso conta as ações da principal.
        router.push(destinoDepoisDeCriar(campanhaInicial, alvo, Math.max(1, Math.round(r.ids.length / (1 + estado.seguintes.length)))));
      } catch {
        setErro("Não foi possível salvar. Tente de novo.");
      }
    });
  }

  const veioDaCampanha = campanhaInicial ? campanhas.find((c) => c.id === campanhaInicial) : null;
  // Migalha: "Ações | Adicionar" — sem título de página nem cartão em volta.
  const trilha = veioDaCampanha
    ? [{ rotulo: "Campanhas", href: "/campanhas" }, { rotulo: veioDaCampanha.nome, href: `/campanhas/${veioDaCampanha.id}/acoes` }, { rotulo: "Adicionar" }]
    : [{ rotulo: "Ações", href: "/acoes" }, { rotulo: "Adicionar" }];
  const textoEnviar = estado.agendar ? "AGENDAR" : "ENVIAR AGORA";
  const linkRelatorio = ehRelatorio(estado.tipo) ? hrefRelatorio(estado, campanhas) : null;

  // Avança sozinho nos passos de escolha única: Categoria, Ação, Campanha quando a
  // categoria é Projeto, Contas e Grupos quando a escolha é "todas"/"todos" — só num clique ou Enter de
  // verdade (nunca na seleção por seta do teclado entre rádios, que já marca sozinha). Listas com caixa de
  // marcar continuam exigindo PRÓXIMA. Mesma validação (pendência nula) antes de avançar.
  const idPendencia = useId();
  function avancarSe(novo: EstadoAcao) {
    if (!pendenciaDoPassoAcao(passo, novo, campanhas)) ir(passosDoTipo(novo.tipo)[passosDoTipo(novo.tipo).indexOf(passo) + 1]);
  }
  function escolherCategoriaEAvancar(categoria: CategoriaAcao) {
    if (categoria !== estado.categoria) mudarAlvo({ categoria });
    avancarSe({ ...estado, categoria, contasTodas: true, contas: [], gruposTodos: true, grupos: [] });
  }
  function escolherProjetoEAvancar(projetoId: string) {
    if (projetoId !== estado.projetoId) mudarAlvo({ projetoId });
    avancarSe({ ...estado, projetoId, contasTodas: true, contas: [], gruposTodos: true, grupos: [] });
  }
  function escolherTipoEAvancar(tipo: TipoAcaoAssistente) {
    escolherTipo(tipo);
    const novosPassos = passosDoTipo(tipo);
    ir(novosPassos[novosPassos.indexOf("acao") + 1]);
  }
  function escolherContasTodasEAvancar() {
    mudar({ contasTodas: true, contas: [], gruposTodos: true, grupos: [] });
    avancarSe({ ...estado, contasTodas: true, contas: [], gruposTodos: true, grupos: [] });
  }
  function escolherGruposTodosEAvancar() {
    mudar({ gruposTodos: true, grupos: [] });
    avancarSe({ ...estado, gruposTodos: true, grupos: [] });
  }

  return (
    <div className="mx-auto max-w-[1100px] space-y-6 px-4 py-6 md:px-6">
      <DefinirTrilha itens={trilha} />

      <Passos
        passos={passosExibidos.map((p) => ({ ...ROTULO_PASSO_ACAO[p], liberado: podeIrParaAcao(passos.indexOf(p), visitados, estado, campanhas) }))}
        atual={passosExibidos.indexOf(passo)}
        aoIr={(i) => ir(passosExibidos[i])}
      />

      <section aria-labelledby="titulo-passo" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="titulo-passo" ref={tituloRef} tabIndex={-1} className="text-lg font-medium outline-none">
            {passo === "conteudo" ? tituloPassoConteudo(estado.tipo) : ROTULO_PASSO_ACAO[passo].rotulo}
          </h2>
          <div className="flex flex-wrap items-center justify-end gap-3">
            {pendencia && <span id={idPendencia} aria-live="polite" className="sr-only">{pendencia}</span>}
            {passo === "confirmar" && ehRelatorio(estado.tipo) ? (
              <BotaoRelatorio href={linkRelatorio} />
            ) : passo === "confirmar" ? (
              <button type="button" className={estiloBotao()} disabled={enviando || !!pendencia} title={pendencia ?? undefined} onClick={enviar}>
                {enviando ? "Salvando…" : textoEnviar}
                <Icone nome={estado.agendar ? "schedule_send" : "send"} tamanho={18} />
              </button>
            ) : (
              <button
                type="button"
                className={estiloBotao()}
                disabled={!!pendencia}
                title={pendencia ?? undefined}
                aria-describedby={pendencia ? idPendencia : undefined}
                onClick={() => ir(passos[atual + 1])}
              >
                PRÓXIMA
                <Icone nome="east" tamanho={18} />
              </button>
            )}
          </div>
        </div>

        {passo === "categoria" && <PassoCategoria valor={estado.categoria} aoMudar={(categoria) => categoria !== estado.categoria && mudarAlvo({ categoria })} aoAtivar={escolherCategoriaEAvancar} />}
        {passo === "campanha" &&
          (estado.categoria === "projeto" ? (
            <PassoProjeto
              projetos={projetos}
              campanhas={campanhas}
              valor={estado.projetoId}
              aoMudar={(projetoId) => projetoId !== estado.projetoId && mudarAlvo({ projetoId })}
              aoAtivar={escolherProjetoEAvancar}
            />
          ) : (
            <PassoCampanhas campanhas={campanhas} marcadas={estado.campanhas} aoMudar={(ids) => mudarAlvo({ campanhas: ids })} />
          ))}
        {passo === "acao" && <PassoTipo valor={estado.tipo} aoMudar={escolherTipo} aoAtivar={escolherTipoEAvancar} />}
        {passo === "contas" && estado.tipo === "entrar_grupo" && (
          <PassoContasEntrar contas={contasConectadas} marcadas={estado.contas} aoMudar={(contas) => mudar({ contasTodas: false, contas })} />
        )}
        {passo === "contas" && estado.tipo !== "entrar_grupo" && (
          <PassoContas
            varias={!umaCampanha}
            dados={dadosUma}
            todas={estado.contasTodas}
            marcadas={estado.contas}
            aoMudar={(p) => mudar({ ...p, gruposTodos: true, grupos: [] })}
            aoAtivarTodas={escolherContasTodasEAvancar}
            aoTentarDeNovo={() => umaCampanha && carregarDadosCampanha(umaCampanha)}
          />
        )}
        {passo === "grupos" && (
          <PassoGrupos
            campanhaId={umaCampanha}
            contas={estado.contasTodas ? null : estado.contas}
            todos={estado.gruposTodos}
            marcados={estado.grupos}
            aoMudar={mudar}
            aoAtivarTodos={escolherGruposTodosEAvancar}
            aoVerGrupos={(gs) => setNomesGrupos((n) => ({ ...n, ...Object.fromEntries(gs.map((g) => [g.id, g.nome])) }))}
          />
        )}
        {passo === "conteudo" && (
          <div className="space-y-5">
            {estado.seguintes.length > 0 && estado.tipo && <h3 className="text-[14px] font-semibold">Ação 1 — {rotuloAcaoAssistente(estado.tipo)}</h3>}
            <ConteudoAcao
              estado={estado}
              aoMudar={mudar}
              campanhasDaAcao={alvo}
              campanhas={campanhas}
              modelos={modelosEditor}
              variaveis={dadosUma && "variaveis" in dadosUma ? dadosUma.variaveis : undefined}
              telefones={telefones}
              pasta={umaCampanha ?? "acoes"}
            />
            {ehTipoExecucaoAssistente(estado.tipo) && <AcoesSeguintes
              estado={estado}
              aoMudar={mudar}
              campanhasDaAcao={alvo}
              campanhas={campanhas}
              modelos={modelosEditor}
              variaveis={dadosUma && "variaveis" in dadosUma ? dadosUma.variaveis : undefined}
              telefones={telefones}
              pasta={umaCampanha ?? "acoes"}
            />}
          </div>
        )}
        {passo === "confirmar" && (
          <PassoConfirmar
            estado={estado}
            aoMudar={mudar}
            campanhas={campanhas}
            alvo={alvo}
            projeto={projetos.find((p) => p.id === estado.projetoId) ?? null}
            contas={estado.tipo === "entrar_grupo" ? contasConectadas.map((c) => ({ ...c, status: "conectado" })) : dadosUma && "contas" in dadosUma ? dadosUma.contas : []}
            nomesGrupos={nomesGrupos}
          />
        )}
      </section>

      {erro && <p role="alert" className="rounded-lg border border-vg-erro/40 bg-vg-erro/10 px-3 py-2 text-sm text-vg-erro">{erro}</p>}
      {sucesso && <p role="status" className="rounded-lg border border-vg-ok/40 bg-vg-ok/10 px-3 py-2 text-sm text-vg-ok">{sucesso}</p>}
    </div>
  );
}

// ---------- Linha de escolha (rádio ou caixa à direita) ----------

/** Linha de escolha do assistente: sem a descrição visível embaixo do
 *  título (vira `title`). `aoAtivar` (só nas opções de escolha única listadas no brief) avança o passo sozinho —
 *  mas só num clique ou Enter de verdade, nunca na seleção por seta do teclado entre rádios do mesmo grupo (que só
 *  dispara `onChange`): por isso fica em `onClick`/`onKeyDown`, nunca em `onChange`. */
function LinhaEscolha({ tipo = "radio", nome, marcado, aoMudar, aoAtivar, icone, titulo, descricao, desabilitado = false, selo }: {
  selo?: React.ReactNode;
  tipo?: "radio" | "checkbox";
  nome?: string;
  marcado: boolean;
  aoMudar: (marcado: boolean) => void;
  /** Só pra rádio: avança o passo sozinho, acionado por clique ou Enter (nunca por seta do teclado). */
  aoAtivar?: () => void;
  icone?: React.ReactNode;
  titulo: string;
  descricao?: string | null;
  desabilitado?: boolean;
}) {
  const indicador = tipo === "radio" ? (marcado ? "radio_button_checked" : "radio_button_unchecked") : marcado ? "check_box" : "check_box_outline_blank";
  return (
    <label
      title={descricao ?? undefined}
      className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-vg-accent/50 ${
        desabilitado ? "cursor-not-allowed opacity-50" : "cursor-pointer"
      } ${marcado ? "border-vg-accent bg-vg-accent/10" : "border-vg-line hover:border-vg-line-2 hover:bg-white/[0.03]"}`}
    >
      <input
        type={tipo}
        name={nome}
        checked={marcado}
        disabled={desabilitado}
        onChange={(e) => aoMudar(e.target.checked)}
        // `e.detail > 0` só é verdade num clique real de ponteiro: um clique sintético disparado pelo teclado
        // (barra de espaço marcando o rádio focado) chega com `detail` 0, então nunca ativa sozinho — só Enter
        // (no onKeyDown abaixo) ou um clique de verdade avançam o passo.
        onClick={(e) => tipo === "radio" && !desabilitado && e.detail > 0 && aoAtivar?.()}
        onKeyDown={(e) => {
          if (tipo !== "radio" || desabilitado || e.key !== "Enter" || !aoAtivar) return;
          e.preventDefault();
          aoMudar(true);
          aoAtivar();
        }}
        className="sr-only"
      />
      {icone}
      <span className="flex min-w-0 flex-1 items-center gap-2 text-[14px] font-semibold">{titulo}{selo}</span>
      <Icone nome={indicador} className={marcado ? "text-vg-accent" : "text-vg-text-3"} />
    </label>
  );
}

const iconeRedondo = (nome: string) => (
  <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-vg-pilula text-vg-accent">
    <Icone nome={nome} />
  </span>
);

function Explicacao({ children }: { children: React.ReactNode }) {
  return <p role="status" className="rounded-lg border border-vg-line bg-vg-panel-3 px-3 py-2 text-sm text-vg-text-2">{children}</p>;
}

function Busca({ valor, aoMudar, rotulo }: { valor: string; aoMudar: (v: string) => void; rotulo: string }) {
  return (
    <label className="relative block w-full max-w-sm">
      <Icone nome="search" tamanho={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-vg-text-3" />
      <input type="search" value={valor} onChange={(e) => aoMudar(e.target.value)} placeholder="Buscar" aria-label={rotulo} className={`${estiloInput} pl-9`} />
    </label>
  );
}

function PaginacaoSimples({ pagina, paginas, aoIr }: { pagina: number; paginas: number; aoIr: (p: number) => void }) {
  if (paginas <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-2 text-sm text-vg-text-2">
      <button type="button" aria-label="Página anterior" disabled={pagina <= 1} onClick={() => aoIr(pagina - 1)} className="grid size-8 place-items-center rounded-md hover:bg-white/5 disabled:opacity-30">
        <Icone nome="chevron_left" />
      </button>
      <span className="tabular-nums">{pagina} de {paginas}</span>
      <button type="button" aria-label="Próxima página" disabled={pagina >= paginas} onClick={() => aoIr(pagina + 1)} className="grid size-8 place-items-center rounded-md hover:bg-white/5 disabled:opacity-30">
        <Icone nome="chevron_right" />
      </button>
    </div>
  );
}

/** Passo "Campanhas": mesmo visual da `Paginacao` compartilhada,
 *  só que em memória (sem URL) — por isso os botões, não `Link`. */
function PaginacaoCampanhas({ de, ate, total, pagina, paginas, aoIr }: { de: number; ate: number; total: number; pagina: number; paginas: number; aoIr: (p: number) => void }) {
  const botao = (p: number | null, nome: string, rotulo: string) => (
    <button type="button" aria-label={rotulo} disabled={p === null} onClick={() => p !== null && aoIr(p)} className="grid size-8 place-items-center rounded-full text-vg-text hover:bg-white/5 disabled:pointer-events-none disabled:text-vg-text-3">
      <Icone nome={nome} />
    </button>
  );
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-2 text-sm">
      <span className="text-vg-text">Linhas por página <span className="ml-3 tabular-nums">{POR_PAGINA_CAMPANHAS}</span></span>
      <span className="tabular-nums text-vg-text">{de}-{ate} de {total}</span>
      <span className="flex items-center">
        {botao(pagina > 1 ? 1 : null, "first_page", "Primeira página")}
        {botao(pagina > 1 ? pagina - 1 : null, "chevron_left", "Página anterior")}
        {botao(pagina < paginas ? pagina + 1 : null, "chevron_right", "Próxima página")}
        {botao(pagina < paginas ? paginas : null, "last_page", "Última página")}
      </span>
    </div>
  );
}

// ---------- Passos ----------

function PassoCategoria({ valor, aoMudar, aoAtivar }: { valor: CategoriaAcao | null; aoMudar: (v: CategoriaAcao) => void; aoAtivar: (v: CategoriaAcao) => void }) {
  const nome = useId();
  return (
    <fieldset className="space-y-2">
      <legend className="sr-only">Categoria</legend>
      <LinhaEscolha nome={nome} marcado={valor === "campanha"} aoMudar={() => aoMudar("campanha")} aoAtivar={() => aoAtivar("campanha")} icone={iconeRedondo("campaign")} titulo="Campanha" descricao="Uma ou mais campanhas escolhidas." />
      <LinhaEscolha nome={nome} marcado={valor === "projeto"} aoMudar={() => aoMudar("projeto")} aoAtivar={() => aoAtivar("projeto")} icone={iconeRedondo("folder_special")} titulo="Projeto" descricao="Todas as campanhas ativas do projeto." />
    </fieldset>
  );
}

function PassoCampanhas({ campanhas, marcadas, aoMudar }: { campanhas: CampanhaDoAssistente[]; marcadas: string[]; aoMudar: (ids: string[]) => void }) {
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(1);
  const q = semAcento(busca.trim());
  const filtradas = campanhas.filter((c) => !q || semAcento(c.nome).includes(q) || semAcento(c.descricao ?? "").includes(q));
  const paginas = Math.max(1, Math.ceil(filtradas.length / POR_PAGINA_CAMPANHAS));
  const p = Math.min(pagina, paginas);
  const visiveis = filtradas.slice((p - 1) * POR_PAGINA_CAMPANHAS, p * POR_PAGINA_CAMPANHAS);
  const todasMarcadas = filtradas.length > 0 && filtradas.every((c) => marcadas.includes(c.id));
  const alternarTudo = () => {
    const ids = new Set(filtradas.map((c) => c.id));
    aoMudar(todasMarcadas ? marcadas.filter((m) => !ids.has(m)) : [...new Set([...marcadas, ...ids])]);
  };
  return (
    <fieldset className="space-y-3">
      <legend className="sr-only">Escolha as campanhas</legend>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={estiloBotao("contorno")} disabled={!filtradas.length} onClick={alternarTudo}>
          {todasMarcadas ? "DESMARCAR TUDO" : "SELECIONAR TUDO"}
        </button>
        <Busca valor={busca} aoMudar={(v) => { setBusca(v); setPagina(1); }} rotulo="Buscar campanha" />
        <span className="text-sm tabular-nums text-vg-text-2">{filtradas.length}/{campanhas.length} Filtrado</span>
        {/* "0 selecionadas" não aparece (Etapa 3N): só mostra depois de marcar alguma. */}
        {marcadas.length > 0 && <span className="text-sm tabular-nums text-vg-text-3">{marcadas.length} {marcadas.length === 1 ? "selecionada" : "selecionadas"}</span>}
      </div>
      {visiveis.length === 0 ? (
        <div className="rounded-xl border border-vg-line"><Vazio texto={campanhas.length ? "Nenhuma campanha encontrada" : "Nenhuma campanha ativa"} compacto /></div>
      ) : (
        <div className="space-y-2">
          {visiveis.map((c) => (
            <LinhaEscolha
              key={c.id}
              tipo="checkbox"
              marcado={marcadas.includes(c.id)}
              aoMudar={(sim) => aoMudar(sim ? [...marcadas, c.id] : marcadas.filter((m) => m !== c.id))}
              icone={<Avatar nome={c.nome} />}
              titulo={c.nome}
              descricao={c.descricao}
            />
          ))}
        </div>
      )}
      <PaginacaoCampanhas
        de={filtradas.length ? (p - 1) * POR_PAGINA_CAMPANHAS + 1 : 0}
        ate={Math.min(p * POR_PAGINA_CAMPANHAS, filtradas.length)}
        total={filtradas.length}
        pagina={p}
        paginas={paginas}
        aoIr={setPagina}
      />
    </fieldset>
  );
}

function PassoProjeto({ projetos, campanhas, valor, aoMudar, aoAtivar }: { projetos: Projeto[]; campanhas: CampanhaDoAssistente[]; valor: string | null; aoMudar: (id: string) => void; aoAtivar: (id: string) => void }) {
  const nome = useId();
  const [busca, setBusca] = useState("");
  const q = semAcento(busca.trim());
  const visiveis = projetos.filter((p) => !q || semAcento(p.nome).includes(q));
  return (
    <fieldset className="space-y-3">
      <legend className="sr-only">Campanhas (projeto)</legend>
      <Busca valor={busca} aoMudar={setBusca} rotulo="Buscar projeto" />
      {visiveis.length === 0 ? (
        <div className="rounded-xl border border-vg-line"><Vazio texto={projetos.length ? "Nenhum projeto encontrado" : "Nenhum projeto ativo"} compacto /></div>
      ) : (
        <div className="space-y-2">
          {visiveis.map((p) => {
            const n = campanhas.filter((c) => c.projeto_id === p.id).length;
            return (
              <LinhaEscolha
                key={p.id}
                nome={nome}
                marcado={valor === p.id}
                aoMudar={() => aoMudar(p.id)}
                aoAtivar={() => aoAtivar(p.id)}
                icone={iconeRedondo("folder_special")}
                titulo={p.nome}
                descricao={`${n} ${n === 1 ? "campanha ativa" : "campanhas ativas"}${p.descricao ? ` · ${p.descricao}` : ""}`}
              />
            );
          })}
        </div>
      )}
    </fieldset>
  );
}

function PassoTipo({ valor, aoMudar, aoAtivar }: { valor: TipoAcaoAssistente | null; aoMudar: (t: TipoAcaoAssistente) => void; aoAtivar: (t: TipoAcaoAssistente) => void }) {
  const nome = useId();
  return (
    <fieldset className="space-y-2">
      <legend className="sr-only">Escolha a ação</legend>
      {ACOES_ASSISTENTE.map((a) => (
        <LinhaEscolha
          key={a.tipo}
          nome={nome}
          marcado={valor === a.tipo}
          aoMudar={() => aoMudar(a.tipo)}
          aoAtivar={() => aoAtivar(a.tipo)}
          icone={iconeRedondo(a.icone)}
          titulo={a.rotulo}
          selo={a.tipo === "privacidade_avancada" ? <SeloBeta /> : undefined}
          descricao={a.tipo === "privacidade_avancada" && !PROVA.privacidadeEmGrupo ? PROVA.privacidadeMotivo : undefined}
        />
      ))}
    </fieldset>
  );
}

function PassoContas({ varias, dados, todas, marcadas, aoMudar, aoAtivarTodas, aoTentarDeNovo }: {
  varias: boolean;
  dados: DadosCampanha | { erro: string } | undefined;
  todas: boolean;
  marcadas: string[];
  aoMudar: (p: Partial<EstadoAcao>) => void;
  aoAtivarTodas: () => void;
  aoTentarDeNovo: () => void;
}) {
  const nome = useId();
  return (
    <div className="space-y-3">
      <fieldset className="space-y-2">
        <legend className="sr-only">Conexões</legend>
        <LinhaEscolha nome={nome} marcado={varias || todas} aoMudar={() => aoMudar({ contasTodas: true, contas: [] })} aoAtivar={aoAtivarTodas} icone={iconeRedondo("qr_code_2")} titulo="Todas as conexões da campanha" />
        <LinhaEscolha nome={nome} marcado={!varias && !todas} desabilitado={varias} aoMudar={() => aoMudar({ contasTodas: false })} icone={iconeRedondo("checklist")} titulo="Conexões especificas" />
      </fieldset>
      {varias && <Explicacao>Com mais de uma campanha, a ação vale para todas as conexões de cada campanha.</Explicacao>}
      {!varias && !todas && (
        !dados ? (
          <p className="text-sm text-vg-muted">Carregando conexões…</p>
        ) : "erro" in dados ? (
          <div className="space-y-2">
            <p role="alert" className="text-sm text-vg-erro">{dados.erro}</p>
            <button type="button" className={estiloBotao("contorno")} onClick={aoTentarDeNovo}>
              TENTAR DE NOVO
            </button>
          </div>
        ) : dados.contas.length === 0 ? (
          <div className="rounded-xl border border-vg-line"><Vazio texto="Nenhuma conexão nesta campanha" compacto /></div>
        ) : (
          <fieldset className="space-y-2">
            <legend className="mb-1 text-[13px] text-vg-text-2">Conexões ({marcadas.length}/{dados.contas.length})</legend>
            {dados.contas.map((c) => (
              <LinhaEscolha
                key={c.id}
                tipo="checkbox"
                marcado={marcadas.includes(c.id)}
                aoMudar={(sim) => aoMudar({ contasTodas: false, contas: sim ? [...marcadas, c.id] : marcadas.filter((m) => m !== c.id) })}
                icone={<Avatar nome={c.nome} cor={c.status === "conectado" ? "ok" : "erro"} />}
                titulo={c.nome}
                descricao={`${c.telefone ?? "sem telefone"} · ${c.status === "conectado" ? "Conectada" : "Desconectada"}`}
              />
            ))}
          </fieldset>
        )
      )}
    </div>
  );
}

/** "GERAR RELATÓRIO": abre o CSV (a rota confere a permissão e grava em "Ver exportações"). */
function BotaoRelatorio({ href }: { href: string | null }) {
  return href ? (
    <a href={href} className={estiloBotao()}>
      <Icone nome="download" tamanho={18} />
      GERAR RELATÓRIO
    </a>
  ) : (
    <button type="button" className={estiloBotao()} disabled>
      <Icone nome="download" tamanho={18} />
      GERAR RELATÓRIO
    </button>
  );
}

/** Passo "Contas" de "Entrar no Grupo": as contas conectadas (qualquer uma, o grupo não é de campanha nenhuma). */
function PassoContasEntrar({ contas, marcadas, aoMudar }: { contas: ContaConectada[]; marcadas: string[]; aoMudar: (ids: string[]) => void }) {
  if (!contas.length) return <div className="rounded-xl border border-vg-line"><Vazio texto="Nenhuma conexão conectada" compacto /></div>;
  const todas = contas.every((c) => marcadas.includes(c.id));
  return (
    <fieldset className="space-y-2">
      <legend className="sr-only">Conexões</legend>
      <div className="mb-2 flex items-center gap-3">
        <button type="button" className={estiloBotao("contorno")} onClick={() => aoMudar(todas ? [] : contas.map((c) => c.id))}>
          {todas ? "DESMARCAR TUDO" : "SELECIONAR TUDO"}
        </button>
        <span className="text-sm tabular-nums text-vg-text-2">Só conexões conectadas ({marcadas.length}/{contas.length})</span>
      </div>
      {contas.map((c) => (
        <LinhaEscolha
          key={c.id}
          tipo="checkbox"
          marcado={marcadas.includes(c.id)}
          aoMudar={(sim) => aoMudar(sim ? [...marcadas, c.id] : marcadas.filter((m) => m !== c.id))}
          icone={<Avatar nome={c.nome} cor="ok" />}
          titulo={c.nome}
          descricao={c.telefone ?? "sem telefone"}
        />
      ))}
    </fieldset>
  );
}

function PassoGrupos({ campanhaId, contas, todos, marcados, aoMudar, aoAtivarTodos, aoVerGrupos }: {
  campanhaId: string | null;
  contas: string[] | null;
  todos: boolean;
  marcados: string[];
  aoMudar: (p: Partial<EstadoAcao>) => void;
  aoAtivarTodos: () => void;
  aoVerGrupos: (g: GrupoDaAcao[]) => void;
}) {
  const nome = useId();
  const varias = !campanhaId;
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(1);
  const [lista, setLista] = useState<{ grupos: GrupoDaAcao[]; total: number; porPagina: number } | { erro: string } | null>(null);
  const chaveContas = contas?.join(",") ?? "";

  useEffect(() => {
    if (!campanhaId || todos) return;
    let vivo = true;
    const t = setTimeout(() => {
      listarGruposAcao(campanhaId, { busca, pagina, contas: chaveContas ? chaveContas.split(",") : null }).then(
        (r) => {
          if (!vivo) return;
          setLista(r);
          if ("grupos" in r) aoVerGrupos(r.grupos);
        },
        () => vivo && setLista({ erro: "Não foi possível carregar os grupos." }),
      );
    }, 250);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
    // aoVerGrupos muda a cada render do pai e fica de fora: a busca só depende dos filtros.
  }, [campanhaId, todos, busca, pagina, chaveContas]);

  const grupos = lista && "grupos" in lista ? lista.grupos : [];
  const paginas = lista && "grupos" in lista ? Math.max(1, Math.ceil(lista.total / lista.porPagina)) : 1;
  const todosDaPagina = grupos.length > 0 && grupos.every((g) => marcados.includes(g.id));

  return (
    <div className="space-y-3">
      <fieldset className="space-y-2">
        <legend className="sr-only">Quais grupos recebem a ação?</legend>
        <LinhaEscolha nome={nome} marcado={varias || todos} aoMudar={() => aoMudar({ gruposTodos: true, grupos: [] })} aoAtivar={aoAtivarTodos} icone={iconeRedondo("groups")} titulo="Enviar para todos os grupos da campanha" descricao="Os grupos ativos na hora da execução." />
        <LinhaEscolha nome={nome} marcado={!varias && !todos} desabilitado={varias} aoMudar={() => aoMudar({ gruposTodos: false })} icone={iconeRedondo("check_box")} titulo="Enviar para grupos específicos da campanha" />
      </fieldset>
      {varias && <Explicacao>Com mais de uma campanha, a ação vale para todos os grupos de cada campanha.</Explicacao>}
      {!varias && !todos && (
        <div className="space-y-2">
          <p className="text-[13px] font-medium text-vg-text-2">Grupos da campanha</p>
          <div className="flex flex-wrap items-center gap-3">
            <Busca valor={busca} aoMudar={(v) => { setBusca(v); setPagina(1); }} rotulo="Buscar grupo" />
            <button
              type="button"
              className={estiloBotao("contorno")}
              disabled={!grupos.length}
              onClick={() => {
                const ids = new Set(grupos.map((g) => g.id));
                aoMudar({ grupos: todosDaPagina ? marcados.filter((m) => !ids.has(m)) : [...new Set([...marcados, ...ids])] });
              }}
            >
              {todosDaPagina ? "DESMARCAR PÁGINA" : "MARCAR PÁGINA"}
            </button>
            <span className="text-sm tabular-nums text-vg-text-2">{marcados.length} {marcados.length === 1 ? "grupo marcado" : "grupos marcados"}</span>
            {marcados.length > 0 && (
              <button type="button" className="text-sm text-vg-text-2 underline-offset-4 hover:text-vg-text hover:underline" onClick={() => aoMudar({ grupos: [] })}>Limpar</button>
            )}
          </div>
          {lista === null ? (
            <p className="text-sm text-vg-muted">Carregando grupos…</p>
          ) : "erro" in lista ? (
            <p role="alert" className="text-sm text-vg-erro">{lista.erro}</p>
          ) : grupos.length === 0 ? (
            <div className="rounded-xl border border-vg-line"><Vazio texto={busca ? "Nenhum grupo encontrado" : "Nenhum grupo ativo"} compacto /></div>
          ) : (
            <ul className="divide-y divide-vg-line rounded-xl border border-vg-line">
              {grupos.map((g) => (
                <li key={g.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 text-[13.3px] hover:bg-white/[0.03] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-vg-accent/50">
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={marcados.includes(g.id)}
                      onChange={(e) => aoMudar({ grupos: e.target.checked ? [...marcados, g.id] : marcados.filter((m) => m !== g.id) })}
                    />
                    <span className="min-w-0 flex-1 truncate">{g.nome}</span>
                    <Icone nome={marcados.includes(g.id) ? "check_box" : "check_box_outline_blank"} className={marcados.includes(g.id) ? "text-vg-accent" : "text-vg-text-3"} />
                  </label>
                </li>
              ))}
            </ul>
          )}
          <PaginacaoSimples pagina={pagina} paginas={paginas} aoIr={setPagina} />
        </div>
      )}
    </div>
  );
}

/** Linha curta do conteúdo pro resumo do "Confirmar". */
function previaConteudo(estado: EstadoAcao, campanhas: CampanhaDoAssistente[]): React.ReactNode {
  const tipo = estado.tipo;
  if (!tipo) return "—";
  const conteudo = conteudoDoEstado(estado);
  switch (tipo) {
    case "mensagem": {
      const v2 = paraV2(conteudo);
      return v2.mensagens.length ? (
        <ol className="list-decimal space-y-0.5 pl-5">{v2.mensagens.map((m, i) => <li key={i} className="break-words">{resumoMensagemV2(m).slice(0, 120)}</li>)}</ol>
      ) : "—";
    }
    case "configuracao": {
      const k = conteudo as ConteudoConfiguracao;
      const sn = (v: boolean | undefined) => (v === undefined ? null : v ? "Sim" : "Não");
      const partes = [
        sn(k.so_admins_enviam) && `Só admins enviam: ${sn(k.so_admins_enviam)}`,
        sn(k.so_admins_editam) && `Só admins editam: ${sn(k.so_admins_editam)}`,
        sn(k.aprovacao_entrada) && `Aprovar entrada: ${sn(k.aprovacao_entrada)}`,
      ].filter(Boolean);
      return partes.join(" · ") || "—";
    }
    case "remover_participantes": {
      const n = telefonesDoTexto(estado.telefonesTexto).telefones.length;
      return `${n} ${n === 1 ? "telefone" : "telefones"}`;
    }
    case "mover_grupos": {
      const destino = (conteudo as { campanha_destino?: string }).campanha_destino;
      return `Para: ${campanhas.find((c) => c.id === destino)?.nome ?? "—"}`;
    }
    case "desativar_comunidade":
      return <span className="font-semibold text-vg-erro">{AVISO_DESATIVAR_COMUNIDADE}</span>;
    case "privacidade_avancada": {
      const v = (conteudo as { valor?: unknown }).valor;
      return v === true ? "ATIVAR" : v === false ? "DESATIVAR" : "—";
    }
    case "imagem": {
      const k = conteudo as { url?: string; nome_arquivo?: string | null };
      const url = typeof k.url === "string" && k.url.startsWith("https://") ? k.url : "";
      return url ? (
        <span className="inline-flex items-center gap-2">
          <img src={url} alt="" width={40} height={40} referrerPolicy="no-referrer" className="size-10 rounded-full object-cover" />
          <span className="break-all">{resumoConteudo(tipo, conteudo)}</span>
        </span>
      ) : "—";
    }
    case "entrar_grupo":
      return <span className="break-all">{(conteudo as { link?: string }).link || "—"}</span>;
    case "relatorio_status": {
      const n = ((conteudo as { execucoes?: unknown[] }).execucoes ?? []).length;
      return `${n} ${n === 1 ? "ação marcada" : "ações marcadas"}`;
    }
    case "historico_enviadas": {
      const k = conteudo as { inicio?: string; fim?: string };
      const br = (d?: string) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "—");
      return `De ${br(k.inicio)} a ${br(k.fim)}`;
    }
    case "nome":
    case "descricao":
    case "admin_add":
    case "admin_remover":
      return resumoConteudo(tipo, conteudo) || "—";
    default:
      return "Sem conteúdo";
  }
}

function listaNomes(nomes: string[], limite = 8): string {
  return nomes.length > limite ? `${nomes.slice(0, limite).join(", ")} e mais ${nomes.length - limite}` : nomes.join(", ");
}

function PassoConfirmar({ estado, aoMudar, campanhas, alvo, projeto, contas, nomesGrupos }: {
  estado: EstadoAcao;
  aoMudar: (p: Partial<EstadoAcao>) => void;
  campanhas: CampanhaDoAssistente[];
  alvo: string[];
  projeto: Projeto | null;
  contas: Conta[];
  nomesGrupos: Record<string, string>;
}) {
  const nome = useId();
  const idData = useId();
  const nomesCampanhas = alvo.map((id) => campanhas.find((c) => c.id === id)?.nome ?? id);
  const uma = escolheContasEGrupos(alvo.length);
  const q = estado.agendar && estado.dataHora ? quandoParaIso(estado.dataHora) : null;
  const minimo = isoParaCampoBrasilia(new Date().toISOString());
  if (estado.tipo === "entrar_grupo") {
    return (
      <div className="space-y-5">
        <dl className="divide-y divide-vg-line rounded-xl border border-vg-line text-[13.3px]">
          <Linha rotulo="Ação">{rotuloAcaoAssistente(estado.tipo)}</Linha>
          <Linha rotulo={`Conexões (${estado.contas.length})`}>{listaNomes(estado.contas.map((id) => contas.find((c) => c.id === id)?.nome ?? "conexão"))}</Linha>
          <Linha rotulo="Link de convite">{previaConteudo(estado, campanhas)}</Linha>
          <Linha rotulo="Quando">No próximo minuto (sem agendamento)</Linha>
        </dl>
        <Explicacao>Cada conexão entra uma vez só. O resultado aparece no Histórico; se uma conexão não conseguir, vira alerta.</Explicacao>
      </div>
    );
  }
  if (ehRelatorio(estado.tipo)) {
    return (
      <div className="space-y-5">
        <dl className="divide-y divide-vg-line rounded-xl border border-vg-line text-[13.3px]">
          <Linha rotulo="Categoria">{estado.categoria === "projeto" ? `Projeto: ${projeto?.nome ?? "—"}` : "Campanha"}</Linha>
          <Linha rotulo={alvo.length === 1 ? "Campanha" : `Campanhas (${alvo.length})`}>{listaNomes(nomesCampanhas) || "—"}</Linha>
          <Linha rotulo="Relatório">{rotuloAcaoAssistente(estado.tipo!)}</Linha>
          <Linha rotulo="Filtros">{previaConteudo(estado, campanhas)}</Linha>
        </dl>
        <Explicacao>O arquivo sai na hora (CSV) e fica em Campanhas › Ver exportações, pra baixar de novo com os dados do dia.</Explicacao>
        {estado.tipo === "relatorio_status" && <p className="text-xs text-vg-muted">{NOTA_RELATORIO_STATUS}</p>}
      </div>
    );
  }
  return (
    <div className="space-y-5">
      <dl className="divide-y divide-vg-line rounded-xl border border-vg-line text-[13.3px]">
        <Linha rotulo="Categoria">{estado.categoria === "projeto" ? `Projeto: ${projeto?.nome ?? "—"}` : "Campanha"}</Linha>
        <Linha rotulo={alvo.length === 1 ? "Campanha" : `Campanhas (${alvo.length})`}>{listaNomes(nomesCampanhas) || "—"}</Linha>
        <Linha rotulo={estado.seguintes.length ? "Ações" : "Ação"}>
          {estado.seguintes.length ? listaDeAcoes(estado) : estado.tipo ? rotuloAcaoAssistente(estado.tipo) : "—"}
        </Linha>
        <Linha rotulo="Conexões">
          {!uma || estado.contasTodas ? "Todas as conexões da campanha" : listaNomes(estado.contas.map((id) => contas.find((c) => c.id === id)?.nome ?? "conexão"))}
        </Linha>
        <Linha rotulo="Grupos">
          {!uma || estado.gruposTodos
            ? "Enviar para todos os grupos da campanha"
            : `${estado.grupos.length} ${estado.grupos.length === 1 ? "grupo" : "grupos"}: ${listaNomes(estado.grupos.map((id) => nomesGrupos[id] ?? "grupo"))}`}
        </Linha>
        <Linha rotulo={estado.seguintes.length ? "Conteúdo (Ação 1)" : "Conteúdo"}>{previaConteudo(estado, campanhas)}</Linha>
        {estado.seguintes.map((_, i) => (
          <Linha key={i} rotulo={`Conteúdo (Ação ${i + 2})`}>{previaConteudo(estadoDaSeguinte(estado, i), campanhas)}</Linha>
        ))}
      </dl>
      {estado.seguintes.length > 0 && (
        <Explicacao>Cada ação começa só depois que a anterior terminar em todos os grupos. Se uma for cancelada ou bloqueada, as seguintes são canceladas.</Explicacao>
      )}

      {estado.tipo === "mensagem" && (!uma || (estado.contasTodas && estado.gruposTodos)) && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={estado.importante} onChange={(e) => aoMudar({ importante: e.target.checked })} />
          Importante (grupo novo recebe as 3 últimas importantes)
        </label>
      )}

      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm text-vg-text-2">Quando?</legend>
        <LinhaEscolha nome={nome} marcado={!estado.agendar} aoMudar={() => aoMudar({ agendar: false })} icone={iconeRedondo("send")} titulo="Enviar agora" descricao="Começa em até 1 minuto." />
        <LinhaEscolha nome={nome} marcado={estado.agendar} aoMudar={() => aoMudar({ agendar: true })} icone={iconeRedondo("schedule")} titulo="Agendar" descricao="Escolha a data e a hora (Brasília)." />
      </fieldset>
      {estado.agendar && (
        <div className="max-w-xs space-y-1.5">
          <label htmlFor={idData} className="block text-[13.3px] text-[#e3e9e5]">Data e hora (Brasília)</label>
          <input id={idData} type="datetime-local" min={minimo} value={estado.dataHora} onChange={(e) => aoMudar({ dataHora: e.target.value })} className={estiloInput} />
          {q?.ok && <p className="text-xs tabular-nums text-vg-muted">{dataHoraCompleta(q.iso)} (Brasília)</p>}
        </div>
      )}
    </div>
  );
}

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 px-4 py-2.5 sm:grid-cols-[160px_1fr]">
      <dt className="text-vg-text-3">{rotulo}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}
