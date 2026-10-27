"use client";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import {
  DESCRICAO_EVENTO,
  EVENTOS_INDISPONIVEIS,
  EVENTOS_WEBHOOK,
  EXEMPLOS_SOLICITACOES,
  eventosDaBusca,
  GRUPOS_EVENTOS,
  ICONE_EVENTO,
  PASSOS_HOOK,
  pendenciaHook,
  ROTULO_EVENTO,
  textoEventos,
  type Evento,
} from "@/src/lib/regras/webhooks";
import { CampoBusca } from "../../_componentes/campo-busca";
import { Icone } from "../../_componentes/icone";
import { Passos } from "../../_componentes/passos";
import { DefinirTrilha } from "../../_componentes/trilha";
import { estiloBotao, estiloCartao, estiloInput } from "../../_componentes/ui";
import { novoToken, salvarWebhook, testarHook, type ResultadoTesteHook } from "../actions";
import type { CampanhaOpcao } from "../comum";

/** Webhook carregado na edição (`null` = criação). */
export type HookInicial = { id: string; nome: string; url: string; eventos: Evento[]; campanhas: string[] | null };

const semAcento = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function AssistenteHook({ campanhas, inicial, eventosIniciais }: { campanhas: CampanhaOpcao[]; inicial: HookInicial | null; eventosIniciais?: Evento[] }) {
  const router = useRouter();
  const [passo, setPasso] = useState(0);
  const [visitado, setVisitado] = useState(0);
  const [nome, setNome] = useState(inicial?.nome ?? "");
  const [url, setUrl] = useState(inicial?.url ?? "");
  // Criação com `?evento=` (ex.: atalho das Solicitações): o evento já vem marcado.
  const [eventos, setEventos] = useState<Evento[]>(inicial?.eventos ?? eventosIniciais ?? []);
  const [todas, setTodas] = useState(inicial ? inicial.campanhas === null : true);
  const [marcadas, setMarcadas] = useState<string[]>(inicial?.campanhas ?? []);
  const [token, setToken] = useState<string | null>(null);
  const [erroToken, setErroToken] = useState<string | null>(null);
  const [teste, setTeste] = useState<ResultadoTesteHook | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();
  const tituloRef = useRef<HTMLHeadingElement>(null);
  const idEdicao = inicial?.id ?? null;

  // token: na criação, um novo (mostrado agora, uma vez). Na edição o gravado nunca é relido nem mostrado: só
  // "Gerar novo" cria outro, e só esse vai no "SALVAR" (sem ele, o token gravado fica como está).
  useEffect(() => {
    if (idEdicao) return;
    let vivo = true;
    novoToken()
      .then((r) => {
        if (!vivo) return;
        if (r.erro || !r.token) setErroToken(r.erro ?? "Não foi possível carregar o token.");
        else setToken(r.token);
      })
      .catch(() => vivo && setErroToken("Não foi possível carregar o token."));
    return () => {
      vivo = false;
    };
  }, [idEdicao]);

  const campanhasEscolhidas = todas ? null : marcadas;
  const pendencia = pendenciaHook({ nome, url, eventos, campanhas: campanhasEscolhidas, token, criacao: !idEdicao });

  function ir(i: number) {
    setErro(null);
    setPasso(i);
    setVisitado((v) => Math.max(v, i));
    requestAnimationFrame(() => tituloRef.current?.focus());
  }

  function gerarNovo() {
    if (!window.confirm("Gerar um novo token? Ele só passa a valer depois de SALVAR; aí o sistema que recebe precisa trocar pelo novo.")) return;
    setErroToken(null);
    iniciar(async () => {
      try {
        const r = await novoToken();
        if (r.erro || !r.token) return setErroToken(r.erro ?? "Não foi possível gerar o token.");
        setToken(r.token);
        setTeste(null);
      } catch {
        setErroToken("Não foi possível gerar o token.");
      }
    });
  }

  function enviarTeste() {
    setTeste(null);
    iniciar(async () => {
      try {
        setTeste(await testarHook(url.trim(), token, idEdicao));
      } catch {
        setTeste({ erro: "Não foi possível enviar o teste. Tente de novo." });
      }
    });
  }

  function salvar() {
    if (pendencia) return;
    setErro(null);
    iniciar(async () => {
      try {
        const r = await salvarWebhook(idEdicao, { nome, url: url.trim(), eventos, campanhas: campanhasEscolhidas }, token ?? undefined);
        if (r.erro) return setErro(r.erro);
        router.push("/hooks");
        router.refresh();
      } catch {
        setErro("Não foi possível salvar. Tente de novo.");
      }
    });
  }

  const titulo = idEdicao ? "Editar webhook" : "Adicionar webhook";
  const passos = PASSOS_HOOK.map((p, i) => ({ rotulo: p.rotulo, icone: p.icone, liberado: i <= visitado && (i === 0 || !pendencia) }));

  return (
    <div className="mx-auto max-w-[1100px] space-y-6 px-4 py-6 md:px-6">
      <DefinirTrilha itens={[{ rotulo: "Webhooks de saída", href: "/hooks" }, { rotulo: titulo }]} />
      <h1 className="text-2xl font-normal leading-8">{titulo}</h1>

      <Passos passos={passos} atual={passo} aoIr={ir} />

      <section aria-labelledby="titulo-passo" className={`${estiloCartao} space-y-4 p-4 md:p-6`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="titulo-passo" ref={tituloRef} tabIndex={-1} className="text-lg font-medium outline-none">
            {PASSOS_HOOK[passo].rotulo}
          </h2>
          <div className="flex flex-wrap items-center justify-end gap-3">
            {passo === 0 && <p aria-live="polite" className="text-sm text-vg-muted empty:hidden">{pendencia}</p>}
            {passo > 0 && (
              <button type="button" className={estiloBotao("secundario")} onClick={() => ir(passo - 1)}>
                VOLTAR
              </button>
            )}
            {passo === 0 && (
              <button type="button" className={estiloBotao()} disabled={!!pendencia} onClick={() => ir(1)}>
                PRÓXIMA
                <Icone nome="east" tamanho={18} />
              </button>
            )}
            {passo === 1 && (
              <>
                <button type="button" className={estiloBotao("contorno")} disabled={ocupado} onClick={() => ir(2)}>
                  PULAR TESTE
                </button>
                <button type="button" className={estiloBotao()} disabled={ocupado || !!pendencia} onClick={enviarTeste}>
                  {ocupado ? "Enviando…" : "ENVIAR TESTE"}
                  <Icone nome="play_arrow" tamanho={18} />
                </button>
              </>
            )}
            {passo === 2 && (
              <button type="button" className={estiloBotao()} disabled={ocupado || !!pendencia} onClick={salvar}>
                {ocupado ? "Salvando…" : "SALVAR"}
                <Icone nome="check" tamanho={18} />
              </button>
            )}
          </div>
        </div>

        {passo === 0 && (
          <PassoHook
            nome={nome}
            url={url}
            token={token}
            erroToken={erroToken}
            edicao={!!idEdicao}
            ocupado={ocupado}
            eventos={eventos}
            todas={todas}
            marcadas={marcadas}
            campanhas={campanhas}
            aoMudarNome={setNome}
            aoMudarUrl={(v) => {
              setUrl(v);
              setTeste(null);
            }}
            aoGerarNovo={gerarNovo}
            aoMudarEventos={setEventos}
            aoMudarTodas={setTodas}
            aoMudarMarcadas={setMarcadas}
          />
        )}
        {passo === 1 && <PassoTeste url={url.trim()} teste={teste} eventos={eventos} />}
        {passo === 2 && <PassoConfirmar nome={nome} url={url.trim()} eventos={eventos} campanhas={campanhas} escolhidas={campanhasEscolhidas} teste={teste} />}

        <p role="status" className="text-sm text-vg-erro empty:hidden">{erro}</p>
      </section>
    </div>
  );
}

// ---------- Passo 1: Hook ----------

function PassoHook(p: {
  nome: string;
  url: string;
  token: string | null;
  erroToken: string | null;
  edicao: boolean;
  ocupado: boolean;
  eventos: Evento[];
  todas: boolean;
  marcadas: string[];
  campanhas: CampanhaOpcao[];
  aoMudarNome: (v: string) => void;
  aoMudarUrl: (v: string) => void;
  aoGerarNovo: () => void;
  aoMudarEventos: (v: Evento[]) => void;
  aoMudarTodas: (v: boolean) => void;
  aoMudarMarcadas: (v: string[]) => void;
}) {
  const idNome = useId();
  const idUrl = useId();
  const idToken = useId();
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    if (!p.token) return;
    try {
      await navigator.clipboard.writeText(p.token);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // sem permissão de clipboard: o campo é só leitura e dá pra selecionar e copiar à mão
    }
  }

  return (
    <div className="space-y-5">
      <label htmlFor={idNome} className="block space-y-1.5">
        <span className="text-[13.3px] text-[#e3e9e5]">Nome</span>
        <input id={idNome} className={estiloInput} value={p.nome} maxLength={60} onChange={(e) => p.aoMudarNome(e.target.value)} placeholder="Ex.: CRM de vendas" />
      </label>
      <label htmlFor={idUrl} className="block space-y-1.5">
        <span className="text-[13.3px] text-[#e3e9e5]">Link</span>
        <input id={idUrl} className={estiloInput} value={p.url} maxLength={500} inputMode="url" onChange={(e) => p.aoMudarUrl(e.target.value)} placeholder="https://" />
      </label>

      <div className="space-y-1.5">
        <label htmlFor={idToken} className="text-[13.3px] text-[#e3e9e5]">TOKEN</label>
        <div className="flex items-center gap-2">
          <input
            id={idToken}
            readOnly
            className={`${estiloInput} font-mono text-xs`}
            value={p.token ?? (p.erroToken ? "" : p.edicao ? "" : "Carregando…")}
            placeholder={p.edicao ? "Não é mostrado de novo. Use \"Gerar novo\" para trocar." : undefined}
            onFocus={(e) => e.currentTarget.select()}
          />
          <button type="button" className={estiloBotao("secundario")} disabled={!p.token} onClick={copiar} aria-label="Copiar token" title="Copiar">
            <Icone nome={copiado ? "check" : "content_copy"} tamanho={18} />
          </button>
          {p.edicao && (
            <button type="button" className={estiloBotao("secundario")} disabled={p.ocupado} onClick={p.aoGerarNovo}>
              Gerar novo
            </button>
          )}
        </div>
        {p.erroToken && <p className="text-xs text-vg-erro">{p.erroToken}</p>}
        <p className="text-xs text-vg-muted">
          Cada envio leva o cabeçalho <code className="text-vg-text-2">X-Vortex-Grupo-Token</code> com este token. Copie agora: ele só aparece
          quando é gerado. A assinatura <code className="text-vg-text-2">X-Vortex-Grupo-Assinatura</code> usa outro segredo (menu do cartão,
          &quot;Gerar novo segredo de assinatura&quot;).
        </p>
      </div>

      <EscolherEventos marcados={p.eventos} aoMudar={p.aoMudarEventos} />

      <fieldset className="space-y-2">
        <legend className="text-[13.3px] text-[#e3e9e5]">Campanhas</legend>
        <p className="text-xs text-vg-muted">Eventos de conexão e de mensagem recebida não são de campanha: só chegam em hooks de todas as campanhas.</p>
        <label className="flex items-center gap-2 text-sm text-vg-text">
          <input type="radio" name="modoCampanhas" checked={p.todas} onChange={() => p.aoMudarTodas(true)} />
          Todas as campanhas
        </label>
        <label className="flex items-center gap-2 text-sm text-vg-text">
          <input type="radio" name="modoCampanhas" checked={!p.todas} onChange={() => p.aoMudarTodas(false)} />
          Escolher
        </label>
        {!p.todas && <EscolherCampanhas campanhas={p.campanhas} marcadas={p.marcadas} aoMudar={p.aoMudarMarcadas} />}
      </fieldset>
    </div>
  );
}

function EscolherEventos({ marcados, aoMudar }: { marcados: Evento[]; aoMudar: (v: Evento[]) => void }) {
  const [busca, setBusca] = useState("");
  const visiveis = new Set(eventosDaBusca(busca));
  const alternar = (ev: Evento) => aoMudar(marcados.includes(ev) ? marcados.filter((x) => x !== ev) : [...marcados, ev]);
  const grupos = GRUPOS_EVENTOS.map((g) => ({ ...g, eventos: g.eventos.filter((ev) => visiveis.has(ev)) })).filter((g) => g.eventos.length);

  return (
    <fieldset className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <legend className="text-[13.3px] text-[#e3e9e5]">Eventos</legend>
        <span className="text-sm tabular-nums text-vg-text-2" aria-label={`${marcados.length} de ${EVENTOS_WEBHOOK.length} eventos marcados`}>
          {marcados.length}/{EVENTOS_WEBHOOK.length}
        </span>
      </div>
      <CampoBusca valor={busca} aoMudar={setBusca} rotulo="Buscar evento" className="w-full max-w-xs" />
      {grupos.length === 0 ? (
        <p className="text-xs text-vg-muted">Nenhum evento encontrado.</p>
      ) : (
        <div className="space-y-4">
          {grupos.map((g) => (
            <div key={g.titulo} role="group" aria-label={g.titulo} className="space-y-1.5">
              <p className="text-xs font-semibold tracking-wide text-vg-text-3">{g.titulo}</p>
              <ul className="grid gap-1.5 md:grid-cols-2">
                {g.eventos.map((ev) => {
                  const marcado = marcados.includes(ev);
                  return (
                    <li key={ev}>
                      <label
                        className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${marcado ? "border-vg-accent/60 bg-vg-accent/10" : "border-vg-line-2 hover:border-white/40"}`}
                      >
                        <input type="checkbox" className="mt-0.5" checked={marcado} onChange={() => alternar(ev)} />
                        <Icone nome={ICONE_EVENTO[ev]} tamanho={18} className={marcado ? "text-vg-accent" : "text-vg-text-3"} />
                        <span className="min-w-0">
                          <span className="block text-vg-text">{ROTULO_EVENTO[ev]}</span>
                          {DESCRICAO_EVENTO[ev] && <span className="block text-xs text-vg-muted">{DESCRICAO_EVENTO[ev]}</span>}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
      <details className="rounded-lg border border-vg-line-2 px-3 py-2 text-sm">
        <summary className="cursor-pointer text-vg-text-2">Eventos que o Vórtex Grupo não recebe</summary>
        <ul className="mt-2 space-y-1">
          {EVENTOS_INDISPONIVEIS.map((e) => (
            <li key={e.rotulo} className="text-vg-muted">
              <span className="text-vg-text-2">{e.rotulo}</span>: {e.motivo}.
            </li>
          ))}
        </ul>
      </details>
    </fieldset>
  );
}

function EscolherCampanhas({ campanhas, marcadas, aoMudar }: { campanhas: CampanhaOpcao[]; marcadas: string[]; aoMudar: (v: string[]) => void }) {
  const [busca, setBusca] = useState("");
  const filtradas = campanhas.filter((c) => semAcento(c.nome).includes(semAcento(busca.trim())));
  return (
    <div className="space-y-2 rounded-lg border border-vg-line-2 p-3">
      {campanhas.length > 10 && <CampoBusca valor={busca} aoMudar={setBusca} rotulo="Buscar campanha" />}
      <div className="max-h-48 space-y-1 overflow-y-auto">
        {filtradas.length === 0 ? (
          <p className="text-xs text-vg-muted">Nenhuma campanha encontrada.</p>
        ) : (
          filtradas.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-sm text-vg-text">
              <input type="checkbox" checked={marcadas.includes(c.id)} onChange={() => aoMudar(marcadas.includes(c.id) ? marcadas.filter((x) => x !== c.id) : [...marcadas, c.id])} />
              {c.nome}
            </label>
          ))
        )}
      </div>
      <p className="text-xs text-vg-muted">{marcadas.length} campanha(s) marcada(s).</p>
    </div>
  );
}

// ---------- Passo 2: teste ----------

function PassoTeste({ url, teste, eventos }: { url: string; teste: ResultadoTesteHook | null; eventos: Evento[] }) {
  return (
    <div className="space-y-3 text-sm">
      <p className="text-vg-text-2">
        &quot;ENVIAR TESTE&quot; manda agora um <code className="text-vg-text">{`{"evento":"teste","em":"…","isTest":true}`}</code> para{" "}
        <span className="break-all text-vg-text">{url}</span>, com <code className="text-vg-text">X-Vortex-Grupo-Token</code> (quando há um token novo) e, na
        edição, <code className="text-vg-text">X-Vortex-Grupo-Assinatura</code>. Redirecionamentos não são seguidos; espera até 10 s; até 10
        testes a cada 10 minutos.
      </p>
      {eventos.includes("solicitacoes_entrada") && (
        <details className="rounded-lg border border-vg-line-2 px-3 py-2">
          <summary className="cursor-pointer text-vg-text-2">Exemplo de payload: {ROTULO_EVENTO.solicitacoes_entrada}</summary>
          <p className="mt-2 text-xs text-vg-muted">
            Sai em lotes de até 100 pedidos por grupo. <code className="text-vg-text">tipo</code> é{" "}
            <code className="text-vg-text">pendentes</code> (pedidos novos) ou <code className="text-vg-text">decisao</code> (aprovada, recusada,
            cancelada ou expirada).
          </p>
          {EXEMPLOS_SOLICITACOES.map((ex) => (
            <div key={ex.tipo} className="mt-2 space-y-1">
              <p className="text-xs text-vg-text-2">tipo: {ex.tipo}</p>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-vg-panel-3 p-2 text-xs text-vg-text-2">{JSON.stringify(ex.payload, null, 2)}</pre>
            </div>
          ))}
        </details>
      )}
      {teste && (
        <div aria-live="polite" className="space-y-2 rounded-lg border border-vg-line-2 p-3">
          {teste.erro ? (
            <p className="text-vg-erro">{teste.erro}</p>
          ) : (
            <>
              <p className={teste.status && teste.status >= 200 && teste.status < 300 ? "text-vg-ok" : "text-vg-aviso"}>Status HTTP {teste.status}</p>
              {teste.resposta ? (
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-vg-panel-3 p-2 text-xs text-vg-text-2">{teste.resposta}</pre>
              ) : (
                <p className="text-xs text-vg-muted">Resposta vazia.</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Passo 3: Confirmar ----------

function PassoConfirmar({ nome, url, eventos, campanhas, escolhidas, teste }: {
  nome: string;
  url: string;
  eventos: Evento[];
  campanhas: CampanhaOpcao[];
  escolhidas: string[] | null;
  teste: ResultadoTesteHook | null;
}) {
  const nomes = escolhidas === null ? "Todas as campanhas" : campanhas.filter((c) => escolhidas.includes(c.id)).map((c) => c.nome).join(", ") || "Nenhuma";
  const linhas: [string, string][] = [
    ["Nome", nome.trim()],
    ["Link", url],
    ["Eventos", textoEventos(EVENTOS_WEBHOOK.filter((ev) => eventos.includes(ev)))],
    ["Campanhas", nomes],
    ["Teste", teste ? (teste.erro ? `Falhou: ${teste.erro}` : `HTTP ${teste.status}`) : "Não enviado"],
  ];
  return (
    <dl className="grid gap-x-6 gap-y-2 text-sm md:grid-cols-[160px_1fr]">
      {linhas.map(([rotulo, valor]) => (
        <div key={rotulo} className="contents">
          <dt className="text-vg-text-3">{rotulo}</dt>
          <dd className="break-words text-vg-text">{valor}</dd>
        </div>
      ))}
    </dl>
  );
}
