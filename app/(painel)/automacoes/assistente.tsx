"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { dataHoraCompleta } from "@/src/lib/regras/abas-mensagens";
import {
  acoesValidasParaGatilho,
  gruposValidos,
  montarEntrada,
  passosDoAssistente,
  passosVisiveisAutomacao,
  proximoPassoVisivel,
  pendenciaDoPasso,
  podeIrPara,
  quandoIso,
  ROTULO_PASSO,
  type AcaoRascunho,
  type EstadoAssistente,
  type PassoAssistente,
} from "@/src/lib/regras/assistente-automacao";
import {
  acoesPermitidas,
  alvoDaAcaoDePessoa,
  ehAcaoDePessoa,
  GATILHOS_CHECKOUT,
  ICONE_ACAO_AUTOMACAO,
  ORDEM_GATILHOS_ASSISTENTE,
  ROTULO_ACAO,
  ROTULO_GATILHO,
  ROTULO_PROVEDOR,
  textoAcaoDePessoa,
  type ConteudoTagCondicional,
  type Gatilho,
  type TipoAcaoAutomacao,
  type TipoAcaoPessoa,
} from "@/src/lib/regras/automacoes";
import { conteudoInicial, resumoConteudo, type ConteudoConfiguracao, type ConteudoMoverGrupos, type TipoExecucao } from "@/src/lib/regras/conteudo";
import { conteudoV2Vazio, paraV2, type ConteudoV2 } from "@/src/lib/regras/conteudo-v2";
import type { Provedor } from "@/src/lib/checkout/parsers";
import type { ContaDaCampanha } from "../_acoes/contas-da-campanha";
import { Avatar } from "../_componentes/avatar";
import { ConteudoEditor, type Valor } from "../_componentes/conteudo-editor";
import { DicaVariaveis } from "../_componentes/dica-variaveis";
import { EditorMensagens, type ModeloParaEditor } from "../_componentes/editor-mensagens";
import { SegmentoRadio } from "../_componentes/editor-mensagens/segmento-radio";
import { EscolherModelo, type ModeloLinha } from "../_componentes/escolher-modelo";
import { Icone } from "../_componentes/icone";
import { Passos } from "../_componentes/passos";
import { DefinirTrilha } from "../_componentes/trilha";
import { estiloAcao, estiloBotao, estiloCartao, estiloInput, Vazio } from "../_componentes/ui";
import { contasDaCampanhaAutomacao, salvarAutomacao } from "./actions";
import type { BlacklistOpcao, TagOpcao } from "./opcoes-assistente";

export type CampanhaOpcao = { id: string; nome: string; descricao: string | null };
export type GrupoOpcao = { id: string; nome: string; campanha_id: string };
type DadosContas = { contas: ContaDaCampanha[] } | { erro: string };

const DESCRICAO_GATILHO: Record<Gatilho, string> = {
  cronograma: "Dispara uma vez, na data e hora escolhidas.",
  grupo_criado: "Dispara em cada grupo novo criado na campanha.",
  grupo_cheio: "Dispara em cada grupo que encher na campanha.",
  entrou: "Dispara quando alguém entra num grupo da campanha.",
  saiu: "Dispara quando alguém sai de um grupo da campanha.",
  checkout: "Dispara quando uma venda do produto escolhido é aprovada.",
};

/** Texto explicativo de "Remover Lead": não tem conteúdo, só o que ela faz em cada gatilho. */
const EXPLICACAO_REMOVER: Partial<Record<Gatilho, string>> = {
  entrou: "Remove a pessoa do grupo em que ela entrou.",
  saiu: "Remove a pessoa dos outros grupos da campanha em que ela ainda está.",
  checkout: "Remove quem comprou de todos os grupos ativos da campanha.",
};

/** Conteúdo inicial de uma ação nova: idêntico ao de execução pra quem tem conteúdo; vazio pra "Remover Lead"; tag ou
 *  blacklist ainda não escolhida nas ações de pessoa; v2 (sem mensagem ainda) pra "mensagem". */
function conteudoInicialAcao(tipo: TipoAcaoAutomacao): unknown {
  if (tipo === "remover_participante") return {};
  if (tipo === "adicionar_tag" || tipo === "remover_tag") return { tag_id: "" };
  if (tipo === "adicionar_blacklist" || tipo === "remover_blacklist") return { blacklist_id: "" };
  if (tipo === "tag_condicional") return { tag_id: "", tem: true };
  if (tipo === "mensagem") return conteudoV2Vazio();
  return conteudoInicial(tipo);
}

function modelosParaEditor(modelos: ModeloLinha[], tipo: TipoExecucao): ModeloParaEditor[] {
  return modelos.filter((m) => m.tipo === tipo).map((m) => ({ id: m.id, nome: m.nome, mensagens: paraV2(m.conteudo).mensagens }));
}

/** Resumo de uma ação pra lista de confirmação: "Remover Lead" não tem conteúdo; as de pessoa mostram o nome da
 *  tag/blacklist à parte (`textoAcaoDePessoa`). */
function resumoAcao(a: AcaoRascunho): string {
  return a.tipo === "remover_participante" || a.tipo === "tag_condicional" || ehAcaoDePessoa(a.tipo) ? "" : resumoConteudo(a.tipo, a.conteudo);
}

/** Nome da tag/blacklist de uma ação de pessoa (null se não escolhida ou apagada). */
function nomeDoAlvo(a: { tipo: string; conteudo: unknown }, tags: TagOpcao[], blacklists: BlacklistOpcao[]): string | null {
  const alvo = alvoDaAcaoDePessoa(a);
  if (!alvo) return null;
  return (alvo.tipo === "tag" ? tags.find((t) => t.id === alvo.id)?.nome : blacklists.find((b) => b.id === alvo.id)?.nome) ?? null;
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

let contador = 0;
const novaChave = () => `acao-${++contador}`;

export function Assistente({ automacaoId, inicial, ativo = false, campanhas, grupos, modelos, telefones, pastas, tags = [], blacklists = [], entradasComMensagem = [], campanhaInicial = null }: {
  automacaoId: string | null;
  inicial?: Omit<EstadoAssistente, "acoes"> & { acoes: Omit<AcaoRascunho, "chave">[] };
  ativo?: boolean;
  campanhas: CampanhaOpcao[];
  grupos: GrupoOpcao[];
  modelos: ModeloLinha[];
  telefones: { nome: string; telefone: string }[];
  pastas: string[];
  tags?: TagOpcao[];
  blacklists?: BlacklistOpcao[];
  entradasComMensagem?: { id: string; campanha_id: string }[];
  /** `?campanha=` de `/automacoes/nova` (ex.: vindo do "ADICIONAR" da aba Automações da campanha): entra com a
   *  categoria e a campanha já escolhidas, direto no passo "Grupo". Ignorado
   *  em edição e se o id não bater com nenhuma campanha da lista. */
  campanhaInicial?: string | null;
}) {
  const router = useRouter();
  const editando = !!inicial;
  const campanhaPreSelecionada = !editando && !!campanhaInicial && campanhas.some((c) => c.id === campanhaInicial);
  const [estado, setEstado] = useState<EstadoAssistente>(() => {
    if (inicial) return { ...inicial, acoes: inicial.acoes.map((a) => ({ ...a, chave: novaChave() })) };
    return {
      categoria: campanhaPreSelecionada ? "campanha" : null,
      campanhaId: campanhaPreSelecionada ? campanhaInicial : null,
      gatilho: null,
      quando: "",
      todosGrupos: true,
      grupos: [],
      todasContas: true,
      contas: [],
      provedor: null,
      produto: "",
      acoes: [],
      nome: "",
      pasta: "",
    };
  });
  const passos = passosDoAssistente();
  const [atualChave, setAtualChave] = useState<PassoAssistente>(editando ? "confirmar" : campanhaPreSelecionada ? "grupos" : "categoria");
  const [visitados, setVisitados] = useState<Set<PassoAssistente>>(() =>
    new Set(editando ? passosDoAssistente() : campanhaPreSelecionada ? (["categoria", "campanha", "grupos"] as const) : ["categoria"]),
  );
  const [idSalvo, setIdSalvo] = useState<string | null>(automacaoId);
  const [erro, setErro] = useState<string | null>(null);
  const [avisoAcoes, setAvisoAcoes] = useState<string | null>(null);
  const [salvando, iniciar] = useTransition();
  const tituloRef = useRef<HTMLHeadingElement>(null);

  // Dados da conta (passo "Conta"): carregados só quando a campanha está escolhida e o passo chega lá (ou, em
  // edição, o assistente já começa no Confirmar com contas específicas salvas).
  const [contasPorCampanha, setContasPorCampanha] = useState<Record<string, DadosContas>>({});
  const pedidosContas = useRef(new Set<string>());
  const carregarContas = useRef((campanhaId: string) => {
    pedidosContas.current.add(campanhaId);
    contasDaCampanhaAutomacao(campanhaId).then(
      (r) => {
        if ("erro" in r) pedidosContas.current.delete(campanhaId);
        setContasPorCampanha((d) => ({ ...d, [campanhaId]: r }));
      },
      () => {
        pedidosContas.current.delete(campanhaId);
        setContasPorCampanha((d) => ({ ...d, [campanhaId]: { erro: "Não foi possível carregar as conexões." } }));
      },
    );
  }).current;

  const atual = passos.indexOf(atualChave);
  const passo = passos[atual];

  const ativosDaCampanha = useMemo(() => grupos.filter((g) => g.campanha_id === estado.campanhaId), [grupos, estado.campanhaId]);
  const ctx = { ativosDaCampanha: ativosDaCampanha.map((g) => g.id) };
  const pendencia = pendenciaDoPasso(passo, estado, ctx);
  const campanha = campanhas.find((c) => c.id === estado.campanhaId) ?? null;
  const dadosContas = estado.campanhaId ? contasPorCampanha[estado.campanhaId] : undefined;

  // Carrega as contas da campanha a partir do passo "Conta" (ou direto, em edição que já começa no Confirmar).
  useEffect(() => {
    if (!estado.campanhaId || atual < passos.indexOf("contas") || pedidosContas.current.has(estado.campanhaId)) return;
    carregarContas(estado.campanhaId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado.campanhaId, atual]);

  const mudar = (p: Partial<EstadoAssistente>) => {
    setEstado((e) => ({ ...e, ...p }));
    setErro(null);
  };

  /** Trocar a campanha zera grupos e contas específicos (eram da campanha anterior). */
  const mudarCampanha = (campanhaId: string) =>
    mudar(campanhaId === estado.campanhaId ? {} : { campanhaId, todosGrupos: true, grupos: [], todasContas: true, contas: [] });

  /** Troca de gatilho: tira as ações que deixaram de valer pro gatilho novo (com aviso), limpa provedor/produto
   *  quando sai do checkout e, fora do cronograma, força "todos os grupos" (Ruling 1: o motor só usa `alvo_grupos`
   *  no cronograma). `provedorEscolhido` vem do cartão de checkout por plataforma (null = qualquer plataforma). */
  function escolherGatilho(g: Gatilho, provedorEscolhido: Provedor | null = null) {
    const mantidas = acoesValidasParaGatilho(estado.acoes, g);
    const removidas = estado.acoes.length - mantidas.length;
    setAvisoAcoes(removidas > 0 ? `${removidas} ${removidas === 1 ? "ação removida" : "ações removidas"}: não ${removidas === 1 ? "vale" : "valem"} mais para este gatilho.` : null);
    setEstado((e) => ({
      ...e,
      gatilho: g,
      acoes: mantidas,
      provedor: g === "checkout" ? provedorEscolhido : null,
      produto: g === "checkout" ? e.produto : "",
      todosGrupos: g === "cronograma" ? e.todosGrupos : true,
      grupos: g === "cronograma" ? e.grupos : [],
    }));
    setErro(null);
  }

  function ir(indice: number) {
    const alvo = passos[indice];
    if (!alvo) return;
    setAtualChave(alvo);
    setVisitados((v) => new Set(v).add(alvo));
    setErro(null);
    requestAnimationFrame(() => tituloRef.current?.focus());
  }

  function salvar(ativar: boolean) {
    setErro(null);
    for (const p of passos) {
      const falta = pendenciaDoPasso(p, estado, ctx);
      if (falta) return setErro(`${ROTULO_PASSO[p].rotulo}: ${falta}`);
    }
    iniciar(async () => {
      try {
        const r = await salvarAutomacao(idSalvo, montarEntrada(estado, ctx.ativosDaCampanha), ativar);
        if (r.id) setIdSalvo(r.id);
        if (r.erro) return setErro(r.erro);
        router.push("/automacoes");
      } catch {
        setErro("Não foi possível salvar. Tente de novo.");
      }
    });
  }

  const trilha = [{ rotulo: "Automações", href: "/automacoes" }, { rotulo: inicial ? inicial.nome : "Nova automação" }];
  // Barra do topo (Etapa 3N): começa menor (Categoria, Gatilho, Ação, Confirmar) e cresce com as escolhas;
  // os índices continuam em `passos` (de `passosDoAssistente`), e PRÓXIMA pula os passos que a barra esconde.
  const passosExibidos = passosVisiveisAutomacao(estado);

  return (
    <div className="mx-auto max-w-[1000px] space-y-6 px-4 py-6 md:px-6">
      <DefinirTrilha itens={trilha} />
      {inicial && <p className="text-sm text-vg-muted">{inicial.nome} · {ativo ? "Ativada" : "Desativada"}</p>}

      <Passos
        passos={passosExibidos.map((p) => ({ ...ROTULO_PASSO[p], liberado: podeIrPara(passos.indexOf(p), passos, visitados, estado, ctx) }))}
        atual={passosExibidos.indexOf(passo)}
        aoIr={(i) => ir(passos.indexOf(passosExibidos[i]))}
      />

      <section aria-labelledby="titulo-passo" className={`${estiloCartao} space-y-4 p-4 md:p-6`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="titulo-passo" ref={tituloRef} tabIndex={-1} className="text-lg font-medium outline-none">
            {ROTULO_PASSO[passo].rotulo}
          </h2>
          <div className="flex flex-wrap items-center justify-end gap-3">
            {pendencia && passo !== "confirmar" && <span aria-live="polite" className="text-xs text-vg-muted">{pendencia}</span>}
            {passo === "confirmar" ? (
              <>
                <button type="button" className={estiloBotao("contorno")} disabled={salvando} onClick={() => salvar(false)}>
                  {salvando ? "Salvando…" : "SALVAR"}
                </button>
                <button type="button" className={estiloBotao()} disabled={salvando} onClick={() => salvar(true)}>
                  {salvando ? "Salvando…" : "SALVAR E ATIVAR"}
                </button>
              </>
            ) : (
              <button type="button" className={estiloBotao()} disabled={!!pendencia} onClick={() => {
                const proximo = proximoPassoVisivel(estado, passo);
                if (proximo) ir(passos.indexOf(proximo));
              }}>
                PRÓXIMA
                <Icone nome="east" tamanho={18} />
              </button>
            )}
          </div>
        </div>

        {passo === "categoria" && <PassoCategoria valor={estado.categoria} aoMudar={(categoria) => mudar({ categoria })} />}
        {passo === "campanha" && <PassoCampanha campanhas={campanhas} valor={estado.campanhaId} aoMudar={mudarCampanha} />}
        {passo === "grupos" && (
          <PassoGrupos gatilho={estado.gatilho} grupos={ativosDaCampanha} todos={estado.todosGrupos} marcados={estado.grupos} aoMudar={mudar} />
        )}
        {passo === "gatilho" && (
          <PassoGatilho
            gatilho={estado.gatilho}
            quando={estado.quando}
            provedor={estado.provedor}
            produto={estado.produto}
            aoEscolherGatilho={escolherGatilho}
            aoMudar={mudar}
            outraEntradaComMensagem={entradasComMensagem.some((a) => a.campanha_id === estado.campanhaId && a.id !== idSalvo)}
          />
        )}
        {passo === "contas" && (
          <PassoContas
            dados={dadosContas}
            todas={estado.todasContas}
            marcadas={estado.contas}
            aoMudar={mudar}
            aoTentarDeNovo={() => estado.campanhaId && carregarContas(estado.campanhaId)}
          />
        )}
        {passo === "acao" && (
          <PassoAcoes
            gatilho={estado.gatilho}
            aviso={avisoAcoes}
            acoes={estado.acoes}
            aoMudar={(acoes) => mudar({ acoes })}
            modelos={modelos}
            telefones={telefones}
            tags={tags}
            blacklists={blacklists}
            campanhas={campanhas}
            campanhaAtual={estado.campanhaId}
            pasta={`automacoes/${idSalvo ?? "novas"}`}
          />
        )}
        {passo === "confirmar" && (
          <PassoConfirmar estado={estado} campanha={campanha} grupos={ativosDaCampanha} dadosContas={dadosContas} pastas={pastas} tags={tags} blacklists={blacklists} aoMudar={mudar} />
        )}
      </section>

      {erro && <p role="alert" className="rounded-lg border border-vg-erro/40 bg-vg-erro/10 px-3 py-2 text-sm text-vg-erro">{erro}</p>}
    </div>
  );
}

// ---------- Cartão de escolha (rádio com cara de cartão) ----------

/** Cartão de escolha do assistente: sem a descrição visível embaixo do
 *  título — quem tinha descrição ganha `title` (dica ao passar o mouse), sem perder a informação. */
function CartaoEscolha({ nome, marcado, aoMarcar, icone, titulo, descricao }: {
  nome: string;
  marcado: boolean;
  aoMarcar: () => void;
  icone: React.ReactNode;
  titulo: string;
  descricao?: string | null;
}) {
  return (
    <label
      title={descricao ?? undefined}
      className={`flex cursor-pointer items-center gap-3 rounded-xl border p-4 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-vg-accent/50 ${marcado ? "border-vg-accent bg-vg-accent/10" : "border-vg-line hover:border-vg-line-2 hover:bg-white/[0.03]"}`}
    >
      <input type="radio" name={nome} checked={marcado} onChange={aoMarcar} className="sr-only" />
      {icone}
      <span className="min-w-0 flex-1 text-[14px] font-semibold">{titulo}</span>
      <Icone nome={marcado ? "radio_button_checked" : "radio_button_unchecked"} className={marcado ? "text-vg-accent" : "text-vg-text-3"} />
    </label>
  );
}

const iconeRedondo = (nome: string) => (
  <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-vg-pilula text-vg-accent">
    <Icone nome={nome} />
  </span>
);

// ---------- Passos ----------

function PassoCategoria({ valor, aoMudar }: { valor: "campanha" | null; aoMudar: (v: "campanha") => void }) {
  const nome = useId();
  return (
    <fieldset className="space-y-3">
      <legend className="sr-only">Categoria</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <CartaoEscolha nome={nome} marcado={valor === "campanha"} aoMarcar={() => aoMudar("campanha")} icone={iconeRedondo("campaign")} titulo="Campanha" descricao="Disparos e ações nos grupos de uma campanha." />
        <Link
          href="/sequencias"
          title="Mensagens relativas à data da aula (abre Sequências)."
          className="flex items-center gap-3 rounded-xl border border-vg-line p-4 transition-colors hover:border-vg-line-2 hover:bg-white/[0.03]"
        >
          {iconeRedondo("timeline")}
          <span className="min-w-0 flex-1 text-[14px] font-semibold">Sequência</span>
          <Icone nome="chevron_right" className="text-vg-text-3" />
        </Link>
      </div>
    </fieldset>
  );
}

function PassoCampanha({ campanhas, valor, aoMudar }: { campanhas: CampanhaOpcao[]; valor: string | null; aoMudar: (id: string) => void }) {
  const [busca, setBusca] = useState("");
  const nome = useId();
  const q = semAcento(busca.trim());
  const visiveis = campanhas.filter((c) => !q || semAcento(c.nome).includes(q) || semAcento(c.descricao ?? "").includes(q));
  return (
    <fieldset className="space-y-3">
      <legend className="sr-only">Escolha a campanha</legend>
      <label className="relative block max-w-sm">
        <Icone nome="search" tamanho={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-vg-text-3" />
        <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar" aria-label="Buscar campanha" className={`${estiloInput} pl-9`} />
      </label>
      {visiveis.length === 0 ? (
        <div className="rounded-xl border border-vg-line"><Vazio texto={campanhas.length ? "Nenhuma campanha encontrada" : "Nenhuma campanha ativa"} compacto /></div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {visiveis.map((c) => (
            <CartaoEscolha key={c.id} nome={nome} marcado={valor === c.id} aoMarcar={() => aoMudar(c.id)} icone={<Avatar nome={c.nome} />} titulo={c.nome} descricao={c.descricao} />
          ))}
        </div>
      )}
    </fieldset>
  );
}

function PassoGatilho({ gatilho, quando, provedor, produto, aoEscolherGatilho, aoMudar, outraEntradaComMensagem }: {
  outraEntradaComMensagem: boolean;
  gatilho: Gatilho | null;
  quando: string;
  provedor: Provedor | null;
  produto: string;
  aoEscolherGatilho: (g: Gatilho, provedorEscolhido?: Provedor | null) => void;
  aoMudar: (p: Partial<EstadoAssistente>) => void;
}) {
  const nome = useId();
  const idQuando = useId();
  const idProduto = useId();
  // Ordem da tela: Cronograma, Encher Grupo, Criar Grupo, Sair, Entrar — só a ordem na
  // tela, `GATILHOS` e a validação não mudam.
  const outrosGatilhos = ORDEM_GATILHOS_ASSISTENTE;
  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="sr-only">Acionar ao</legend>
        <div className="grid gap-3 md:grid-cols-3">
          {outrosGatilhos.map((g) => (
            <CartaoEscolha key={g} nome={nome} marcado={gatilho === g} aoMarcar={() => aoEscolherGatilho(g)} icone={iconeRedondo("input")} titulo={ROTULO_GATILHO[g]} descricao={DESCRICAO_GATILHO[g]} />
          ))}
          {/* Checkout por plataforma: cada cartão já escolhe gatilho "checkout" + a plataforma (ou
           *  qualquer uma, no cartão genérico). */}
          {GATILHOS_CHECKOUT.map((c) => (
            <CartaoEscolha
              key={c.rotulo}
              nome={nome}
              marcado={gatilho === "checkout" && provedor === c.provedor}
              aoMarcar={() => aoEscolherGatilho("checkout", c.provedor)}
              icone={iconeRedondo("input")}
              titulo={c.rotulo}
              descricao={DESCRICAO_GATILHO.checkout}
            />
          ))}
        </div>
      </fieldset>
      {gatilho === "entrou" && outraEntradaComMensagem && (
        <p role="status" className="rounded-lg border border-vg-line bg-vg-panel-3 px-3 py-2 text-sm text-vg-text-2">
          Esta campanha já tem outra automação de entrada com mensagem: cada uma envia até 1 mensagem a cada 10 minutos por grupo.
        </p>
      )}
      {gatilho === "cronograma" && (
        <div className="max-w-xs space-y-1.5">
          <label htmlFor={idQuando} className="block text-[13.3px] text-[#e3e9e5]">Data e hora do disparo (Brasília)</label>
          <input id={idQuando} type="datetime-local" value={quando} onChange={(e) => aoMudar({ quando: e.target.value })} className={estiloInput} />
        </div>
      )}
      {gatilho === "checkout" && (
        <div className="max-w-xs space-y-1.5">
          <label htmlFor={idProduto} className="block text-[13.3px] text-[#e3e9e5]">Nome do produto</label>
          <input id={idProduto} value={produto} maxLength={120} onChange={(e) => aoMudar({ produto: e.target.value })} className={estiloInput} placeholder="Como aparece no checkout" />
        </div>
      )}
    </div>
  );
}

function PassoGrupos({ gatilho, grupos, todos, marcados, aoMudar }: {
  gatilho: Gatilho | null;
  grupos: GrupoOpcao[];
  todos: boolean;
  marcados: string[];
  aoMudar: (p: Partial<EstadoAssistente>) => void;
}) {
  const nome = useId();
  const alternar = (id: string, sim: boolean) => aoMudar({ grupos: sim ? [...marcados, id] : marcados.filter((m) => m !== id) });
  // Ruling 1: o motor só usa o alvo de grupos no cronograma. Com outro gatilho já escolhido, o passo fica preso
  // em "todos" e só mostra o texto explicativo; com o gatilho ainda não escolhido, a escolha livre continua.
  if (gatilho && gatilho !== "cronograma") {
    return (
      <p role="status" className="rounded-lg border border-vg-line bg-vg-panel-3 px-3 py-2 text-sm text-vg-text-2">
        Nos outros gatilhos a automação vale para o grupo em que o evento acontece.
      </p>
    );
  }
  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="sr-only">Grupos</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <CartaoEscolha nome={nome} marcado={todos} aoMarcar={() => aoMudar({ todosGrupos: true })} icone={iconeRedondo("groups")} titulo="Enviar para todos os grupos da campanha" descricao="Os grupos ativos na hora do disparo." />
          <CartaoEscolha nome={nome} marcado={!todos} aoMarcar={() => aoMudar({ todosGrupos: false })} icone={iconeRedondo("checklist")} titulo="Enviar para grupos específicos da campanha" />
        </div>
      </fieldset>
      {!todos && (
        grupos.length === 0 ? (
          <div className="rounded-xl border border-vg-line"><Vazio texto="Nenhum grupo ativo nesta campanha" compacto /></div>
        ) : (
          <fieldset className="space-y-2">
            <legend className="flex w-full items-center justify-between gap-3 text-[13px] text-vg-text-2">
              <span>Grupos da campanha ({marcados.filter((m) => grupos.some((g) => g.id === m)).length}/{grupos.length})</span>
            </legend>
            <div className="flex gap-3">
              <button type="button" className={estiloAcao.normal} onClick={() => aoMudar({ grupos: grupos.map((g) => g.id) })}>Marcar todos</button>
              <button type="button" className={estiloAcao.neutro} onClick={() => aoMudar({ grupos: [] })}>Desmarcar</button>
            </div>
            <ul className="max-h-80 divide-y divide-vg-line overflow-y-auto rounded-xl border border-vg-line">
              {grupos.map((g) => (
                <li key={g.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-[13.3px] hover:bg-white/[0.03]">
                    <input type="checkbox" checked={marcados.includes(g.id)} onChange={(e) => alternar(g.id, e.target.checked)} />
                    {g.nome}
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        )
      )}
    </div>
  );
}

/** Aviso forte de "Desativar comunidade" (texto fixo da tela, idêntico ao assistente de ação). */
const AVISO_DESATIVAR_COMUNIDADE = "A comunidade da campanha será desativada no WhatsApp. Não dá pra desfazer.";

type TriEstado = "manter" | "sim" | "nao";
const OPCOES_TRI: { valor: TriEstado; rotulo: string }[] = [
  { valor: "manter", rotulo: "Não mudar" },
  { valor: "sim", rotulo: "Sim" },
  { valor: "nao", rotulo: "Não" },
];
type ChaveConfiguracaoBooleana = "so_admins_enviam" | "so_admins_editam" | "aprovacao_entrada";
const CONFIGURACOES: { chave: ChaveConfiguracaoBooleana; rotulo: string }[] = [
  { chave: "so_admins_enviam", rotulo: "Só admins enviam mensagens" },
  { chave: "so_admins_editam", rotulo: "Só admins editam o grupo" },
  { chave: "aprovacao_entrada", rotulo: "Aprovar entrada de novos participantes" },
];

/** Tag Condicional: escolher uma tag + "tem"/"não tem". */
function TagCondicionalCampo({ tags, valor, aoMudar }: { tags: TagOpcao[]; valor: unknown; aoMudar: (c: ConteudoTagCondicional) => void }) {
  const c = (valor && typeof valor === "object" ? valor : {}) as Partial<ConteudoTagCondicional>;
  const idTag = useId();
  const tem: TriEstado = c.tem === false ? "nao" : "sim";
  return (
    <div className="grid max-w-md gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <label htmlFor={idTag} className="block text-[13.3px] text-[#e3e9e5]">Tag</label>
        <select id={idTag} value={c.tag_id ?? ""} onChange={(e) => aoMudar({ tag_id: e.target.value, tem: c.tem !== false })} className={estiloInput}>
          <option value="" disabled>Escolha…</option>
          {tags.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
        </select>
      </div>
      <SegmentoRadio<"sim" | "nao"> legenda="A pessoa" opcoes={[{ valor: "sim", rotulo: "Tem a tag" }, { valor: "nao", rotulo: "Não tem a tag" }]} valor={tem} aoMudar={(v) => aoMudar({ tag_id: c.tag_id ?? "", tem: v === "sim" })} />
    </div>
  );
}

/** Ações de pessoa: um select só — "Tag" (só as manuais) ou "Blacklist" (ativas e inativas, estas com
 *  "(inativa)"). Aplicadas na hora, sem atraso. */
function AcaoPessoaCampo({ tipo, tags, blacklists, valor, aoMudar }: {
  tipo: TipoAcaoPessoa;
  tags: TagOpcao[];
  blacklists: BlacklistOpcao[];
  valor: unknown;
  aoMudar: (c: { tag_id: string } | { blacklist_id: string }) => void;
}) {
  const id = useId();
  const c = (valor && typeof valor === "object" ? valor : {}) as { tag_id?: string; blacklist_id?: string };
  const deTag = tipo === "adicionar_tag" || tipo === "remover_tag";
  const opcoes = deTag
    ? tags.filter((t) => t.tipo === "manual").map((t) => ({ id: t.id, nome: t.nome }))
    : blacklists.map((b) => ({ id: b.id, nome: b.ativa ? b.nome : `${b.nome} (inativa)` }));
  const atual = (deTag ? c.tag_id : c.blacklist_id) ?? "";
  return (
    <div className="max-w-md space-y-1.5">
      <label htmlFor={id} className="block text-[13.3px] text-[#e3e9e5]">{deTag ? "Tag" : "Blacklist"}</label>
      <select id={id} value={opcoes.some((o) => o.id === atual) ? atual : ""} onChange={(e) => aoMudar(deTag ? { tag_id: e.target.value } : { blacklist_id: e.target.value })} className={estiloInput}>
        <option value="" disabled>Escolha…</option>
        {opcoes.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
      </select>
      {opcoes.length === 0 && <p className="text-xs text-vg-muted">{deTag ? "Nenhuma tag manual cadastrada." : "Nenhuma blacklist cadastrada."}</p>}
    </div>
  );
}

/** "Trocar configuração": os 3 campos booleanos, cada um em tri-estado (não mudar/sim/não). */
function ConfiguracaoCampo({ valor, aoMudar }: { valor: unknown; aoMudar: (c: ConteudoConfiguracao) => void }) {
  const c = (valor && typeof valor === "object" ? valor : {}) as ConteudoConfiguracao;
  const tri = (v: boolean | undefined): TriEstado => (v === undefined ? "manter" : v ? "sim" : "nao");
  const mudar = (chave: ChaveConfiguracaoBooleana, t: TriEstado) => {
    const novo: ConteudoConfiguracao = { ...c };
    if (t === "manter") delete novo[chave];
    else novo[chave] = t === "sim";
    aoMudar(novo);
  };
  return (
    <div className="space-y-4">
      {CONFIGURACOES.map((k) => (
        <SegmentoRadio<TriEstado> key={k.chave} legenda={k.rotulo} opcoes={OPCOES_TRI} valor={tri(c[k.chave])} aoMudar={(t) => mudar(k.chave, t)} />
      ))}
    </div>
  );
}

/** "Mover grupos para outra campanha": destino é qualquer campanha oferecida, exceto a atual (não arquivada — o
 *  servidor confere de novo no salvar). */
function MoverGruposCampo({ campanhas, campanhaAtual, valor, aoMudar }: { campanhas: CampanhaOpcao[]; campanhaAtual: string | null; valor: unknown; aoMudar: (c: ConteudoMoverGrupos) => void }) {
  const idDestino = useId();
  const destinos = campanhas.filter((c) => c.id !== campanhaAtual);
  const c = (valor && typeof valor === "object" ? valor : {}) as Partial<ConteudoMoverGrupos>;
  const destino = c.campanha_destino ?? "";
  return (
    <div className="max-w-md space-y-1.5">
      <label htmlFor={idDestino} className="block text-[13.3px] text-[#e3e9e5]">Campanha de destino</label>
      <select id={idDestino} value={destinos.some((d) => d.id === destino) ? destino : ""} onChange={(e) => aoMudar({ campanha_destino: e.target.value })} className={estiloInput}>
        <option value="" disabled>Escolha…</option>
        {destinos.map((d) => <option key={d.id} value={d.id}>{d.nome}</option>)}
      </select>
      <p className="text-xs text-vg-muted">Os grupos saem da campanha atual e entram nesta, com os próximos números dela.</p>
    </div>
  );
}

function PassoAcoes({ gatilho, aviso, acoes, aoMudar, modelos, telefones, tags, blacklists, campanhas, campanhaAtual, pasta }: {
  gatilho: Gatilho | null;
  aviso: string | null;
  acoes: AcaoRascunho[];
  aoMudar: (a: AcaoRascunho[]) => void;
  modelos: ModeloLinha[];
  telefones: { nome: string; telefone: string }[];
  tags: TagOpcao[];
  blacklists: BlacklistOpcao[];
  campanhas: CampanhaOpcao[];
  campanhaAtual: string | null;
  pasta: string;
}) {
  const [escolhendo, setEscolhendo] = useState(false);
  const idMenu = useId();
  const permitidas = gatilho ? acoesPermitidas(gatilho) : [];
  const mudarUma = (i: number, p: Partial<AcaoRascunho>) => aoMudar(acoes.map((a, k) => (k === i ? { ...a, ...p } : a)));
  const mover = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= acoes.length) return;
    const nova = [...acoes];
    [nova[i], nova[j]] = [nova[j], nova[i]];
    aoMudar(nova);
  };
  const adicionar = (tipo: TipoAcaoAutomacao) => {
    aoMudar([...acoes, { chave: novaChave(), tipo, conteudo: conteudoInicialAcao(tipo), atraso_min: 0 }]);
    setEscolhendo(false);
  };

  const temMensagem = acoes.some((a) => a.tipo === "mensagem");

  return (
    <div className="space-y-4">
      {aviso && <p role="status" className="rounded-lg border border-vg-line bg-vg-panel-3 px-3 py-2 text-sm text-vg-text-2">{aviso}</p>}
      {/* Uma dica só pra todas as ações de mensagem da lista (cada `EditorMensagens` abaixo oculta a própria). */}
      {temMensagem && <DicaVariaveis />}
      {acoes.length === 0 ? (
        <div className="rounded-xl border border-vg-line"><Vazio texto="Nenhuma ação ainda" compacto /></div>
      ) : (
        <ol className="space-y-3">
          {acoes.map((a, i) => {
            const rotulo = `Ação ${i + 1}: ${ROTULO_ACAO[a.tipo]}`;
            const temModelo = modelos.some((m) => m.tipo === a.tipo);
            return (
              <li key={a.chave} className="space-y-3 rounded-xl border border-vg-line p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <h3 className="flex-1 text-[14px] font-semibold">{rotulo}</h3>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => mover(i, -1)} disabled={i === 0} aria-label={`Subir ${rotulo}`} className="grid size-8 place-items-center rounded-md text-vg-text-2 hover:bg-white/5 hover:text-white disabled:opacity-30">
                      <Icone nome="arrow_upward" tamanho={18} />
                    </button>
                    <button type="button" onClick={() => mover(i, 1)} disabled={i === acoes.length - 1} aria-label={`Descer ${rotulo}`} className="grid size-8 place-items-center rounded-md text-vg-text-2 hover:bg-white/5 hover:text-white disabled:opacity-30">
                      <Icone nome="arrow_downward" tamanho={18} />
                    </button>
                    <button type="button" onClick={() => aoMudar(acoes.filter((_, k) => k !== i))} aria-label={`Remover ${rotulo}`} className="grid size-8 place-items-center rounded-md text-vg-erro hover:bg-vg-erro/10">
                      <Icone nome="delete" tamanho={18} />
                    </button>
                  </div>
                </div>
                {!ehAcaoDePessoa(a.tipo) && (
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="block w-40 space-y-1.5">
                      <span className="text-[13.3px] text-[#e3e9e5]">Atraso (minutos)</span>
                      <input
                        type="number"
                        min={0}
                        max={1440}
                        step={1}
                        value={Number.isFinite(a.atraso_min) ? a.atraso_min : ""}
                        onChange={(e) => mudarUma(i, { atraso_min: e.target.value === "" ? Number.NaN : Number(e.target.value) })}
                        className={estiloInput}
                      />
                    </label>
                    {temModelo && a.tipo !== "mensagem" && (
                      <label className="block space-y-1.5">
                        <span className="sr-only">Usar modelo na {rotulo}</span>
                        <EscolherModelo tipo={a.tipo as TipoExecucao} modelos={modelos} aoEscolher={(c) => mudarUma(i, { conteudo: c })} />
                      </label>
                    )}
                  </div>
                )}
                {ehAcaoDePessoa(a.tipo) ? (
                  <p className="text-xs text-vg-muted">Aplicada na hora do disparo.</p>
                ) : (
                  <p className="text-xs text-vg-muted">Depois do disparo (0 = na hora). Até 1440 minutos (24 h).</p>
                )}
                {ehAcaoDePessoa(a.tipo) ? (
                  <AcaoPessoaCampo tipo={a.tipo} tags={tags} blacklists={blacklists} valor={a.conteudo} aoMudar={(c) => mudarUma(i, { conteudo: c, atraso_min: 0 })} />
                ) : a.tipo === "remover_participante" ? (
                  <p className="text-sm text-vg-text-2">{gatilho ? EXPLICACAO_REMOVER[gatilho] : null}</p>
                ) : a.tipo === "tag_condicional" ? (
                  <div className="space-y-2">
                    <TagCondicionalCampo tags={tags} valor={a.conteudo} aoMudar={(c) => mudarUma(i, { conteudo: c })} />
                    <p className="text-sm text-vg-text-2">Segue para as próximas ações só se a condição acima for verdadeira.</p>
                  </div>
                ) : a.tipo === "mensagem" ? (
                  <EditorMensagens
                    valor={paraV2(a.conteudo)}
                    onChange={(c: ConteudoV2) => mudarUma(i, { conteudo: c })}
                    modelos={modelosParaEditor(modelos, "mensagem")}
                    pasta={pasta}
                    rotuloIntervaloGrupos="Intervalo de envio entre destinatários"
                    ocultarDicaVariaveis
                  />
                ) : a.tipo === "configuracao" ? (
                  <ConfiguracaoCampo valor={a.conteudo} aoMudar={(c) => mudarUma(i, { conteudo: c })} />
                ) : a.tipo === "mover_grupos" ? (
                  <MoverGruposCampo campanhas={campanhas} campanhaAtual={campanhaAtual} valor={a.conteudo} aoMudar={(c) => mudarUma(i, { conteudo: c })} />
                ) : a.tipo === "desativar_comunidade" ? (
                  <p role="alert" className="flex items-start gap-2 rounded-lg border border-vg-erro/50 bg-vg-erro/10 px-3 py-2 text-sm font-semibold text-vg-erro">
                    <Icone nome="warning" tamanho={18} />
                    {AVISO_DESATIVAR_COMUNIDADE}
                  </p>
                ) : (
                  <ConteudoEditor tipo={a.tipo} valor={(a.conteudo ?? {}) as Valor} onChange={(c) => mudarUma(i, { conteudo: c })} pasta={pasta} telefones={telefones} />
                )}
              </li>
            );
          })}
        </ol>
      )}
      <div className="space-y-2">
        <button type="button" className={estiloBotao("contorno")} aria-expanded={escolhendo} aria-controls={idMenu} onClick={() => setEscolhendo((v) => !v)}>
          <Icone nome="add" />
          {/* Com uma ação já na lista, as próximas saem em ordem (cada uma com o seu atraso): mesmo motor de antes. */}
          {acoes.length ? "Adicionar outra ação" : "Adicionar ação"}
        </button>
        {escolhendo && (
          <ul id={idMenu} aria-label="Tipo da ação" className="flex flex-wrap gap-2">
            {permitidas.map((t) => (
              <li key={t}>
                <button type="button" className={`${estiloBotao("secundario")} !px-3 !py-1`} onClick={() => adicionar(t)}>
                  <Icone nome={ICONE_ACAO_AUTOMACAO[t]} tamanho={18} />
                  {ROTULO_ACAO[t]}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Passo "Conta": "Todas as contas da campanha" / "Contas especificas" — a mesma lista de contas que o
 *  assistente "Adicionar ação" oferece (`contasDaCampanha`). */
function PassoContas({ dados, todas, marcadas, aoMudar, aoTentarDeNovo }: {
  dados: DadosContas | undefined;
  todas: boolean;
  marcadas: string[];
  aoMudar: (p: Partial<EstadoAssistente>) => void;
  aoTentarDeNovo: () => void;
}) {
  const nome = useId();
  const alternar = (id: string, sim: boolean) => aoMudar({ todasContas: false, contas: sim ? [...marcadas, id] : marcadas.filter((m) => m !== id) });
  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="sr-only">Conexões</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <CartaoEscolha nome={nome} marcado={todas} aoMarcar={() => aoMudar({ todasContas: true, contas: [] })} icone={iconeRedondo("qr_code_2")} titulo="Todas as conexões da campanha" />
          <CartaoEscolha nome={nome} marcado={!todas} aoMarcar={() => aoMudar({ todasContas: false })} icone={iconeRedondo("checklist")} titulo="Conexões especificas" />
        </div>
      </fieldset>
      {!todas && (
        !dados ? (
          <p className="text-sm text-vg-muted">Carregando conexões…</p>
        ) : "erro" in dados ? (
          <div className="space-y-2">
            <p role="alert" className="text-sm text-vg-erro">{dados.erro}</p>
            <button type="button" className={estiloBotao("contorno")} onClick={aoTentarDeNovo}>TENTAR DE NOVO</button>
          </div>
        ) : dados.contas.length === 0 ? (
          <div className="rounded-xl border border-vg-line"><Vazio texto="Nenhuma conexão nesta campanha" compacto /></div>
        ) : (
          <fieldset className="space-y-2">
            <legend className="mb-1 text-[13px] text-vg-text-2">Conexões ({marcadas.length}/{dados.contas.length})</legend>
            <ul className="divide-y divide-vg-line overflow-y-auto rounded-xl border border-vg-line">
              {dados.contas.map((c) => (
                <li key={c.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-[13.3px] hover:bg-white/[0.03]">
                    <input type="checkbox" checked={marcadas.includes(c.id)} onChange={(e) => alternar(c.id, e.target.checked)} />
                    <Avatar nome={c.nome} cor={c.status === "conectado" ? "ok" : "erro"} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{c.nome}</span>
                      <span className="block text-vg-text-2">{c.telefone ?? "sem telefone"} · {c.status === "conectado" ? "Conectada" : "Desconectada"}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        )
      )}
    </div>
  );
}

function PassoConfirmar({ estado, campanha, grupos, dadosContas, pastas, tags, blacklists, aoMudar }: {
  estado: EstadoAssistente;
  campanha: CampanhaOpcao | null;
  grupos: GrupoOpcao[];
  dadosContas: DadosContas | undefined;
  pastas: string[];
  tags: TagOpcao[];
  blacklists: BlacklistOpcao[];
  aoMudar: (p: Partial<EstadoAssistente>) => void;
}) {
  const idNome = useId();
  const idPasta = useId();
  const idLista = useId();
  const iso = quandoIso(estado.quando);
  const marcados = gruposValidos(estado, grupos.map((g) => g.id));
  const nomesMarcados = grupos.filter((g) => marcados.includes(g.id)).map((g) => g.nome);
  const contasDisponiveis = dadosContas && "contas" in dadosContas ? dadosContas.contas : [];
  const nomesContas = contasDisponiveis.filter((c) => estado.contas.includes(c.id)).map((c) => c.nome);
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor={idNome} className="block text-[13.3px] text-[#e3e9e5]">Nome da automação</label>
          <input id={idNome} value={estado.nome} maxLength={80} onChange={(e) => aoMudar({ nome: e.target.value })} className={estiloInput} placeholder="Ex.: Abrir grupos no dia da aula" />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={idPasta} className="block text-[13.3px] text-[#e3e9e5]">Pasta (opcional)</label>
          <input id={idPasta} value={estado.pasta} maxLength={40} list={idLista} onChange={(e) => aoMudar({ pasta: e.target.value })} className={estiloInput} />
          <datalist id={idLista}>{pastas.map((p) => <option key={p} value={p} />)}</datalist>
        </div>
      </div>

      <dl className="divide-y divide-vg-line rounded-xl border border-vg-line text-[13.3px]">
        <Linha rotulo="Categoria">Campanha</Linha>
        <Linha rotulo="Campanha">{campanha?.nome ?? "—"}</Linha>
        <Linha rotulo="Gatilho">
          {estado.gatilho ? ROTULO_GATILHO[estado.gatilho] : "—"}
          {estado.gatilho === "cronograma" && <span className="block tabular-nums text-vg-text-2">{iso ? `${dataHoraCompleta(iso)} (Brasília)` : "sem data"}</span>}
          {estado.gatilho === "checkout" && <span className="block text-vg-text-2">{estado.provedor ? ROTULO_PROVEDOR[estado.provedor] : "Qualquer plataforma"} · {estado.produto.trim() || "—"}</span>}
        </Linha>
        {estado.gatilho === "cronograma" && (
          <Linha rotulo="Grupos">
            {estado.todosGrupos ? "Todos os grupos da campanha" : `${nomesMarcados.length} ${nomesMarcados.length === 1 ? "grupo" : "grupos"}: ${nomesMarcados.join(", ")}`}
          </Linha>
        )}
        <Linha rotulo="Conexões">
          {estado.todasContas ? "Todas as conexões da campanha" : `${nomesContas.length} ${nomesContas.length === 1 ? "conexão" : "conexões"}${nomesContas.length ? `: ${nomesContas.join(", ")}` : ""}`}
        </Linha>
        <Linha rotulo="Ações">
          {estado.acoes.length === 0 ? (
            "—"
          ) : (
            <ol className="list-decimal space-y-1 pl-5">
              {estado.acoes.map((a) => {
                const resumo = resumoAcao(a);
                if (ehAcaoDePessoa(a.tipo)) {
                  return (
                    <li key={a.chave}>
                      <span className="font-medium">{textoAcaoDePessoa(a.tipo, nomeDoAlvo(a, tags, blacklists))}</span>
                      <span className="text-vg-text-3"> · na hora</span>
                    </li>
                  );
                }
                return (
                  <li key={a.chave}>
                    <span className="font-medium">{ROTULO_ACAO[a.tipo]}</span>
                    {resumo && <span className="text-vg-text-2">: {resumo.length > 80 ? `${resumo.slice(0, 80)}…` : resumo}</span>}
                    <span className="text-vg-text-3"> · {a.atraso_min ? `${a.atraso_min} min depois` : "na hora"}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </Linha>
      </dl>
    </div>
  );
}

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 px-4 py-2.5 sm:grid-cols-[140px_1fr]">
      <dt className="text-vg-text-3">{rotulo}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}
