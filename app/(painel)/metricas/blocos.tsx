import Link from "next/link";
import { cartoesDoResumo, PERIODOS, percentual, somarResumos, type Resumo } from "@/src/lib/regras/campanhas";
import type { Distintos } from "@/src/lib/regras/grupos-distintos";
import { isoParaBrasilia } from "@/src/lib/regras/horario";
import { formatarNumero, numeroOuTraco, quandoCurto } from "@/src/lib/regras/inicio";
import type { MetricaDia } from "@/src/lib/regras/metricas";
import {
  emQueda, etapasDoFunil, filtrarPorProjeto, indicadores, maiorChurn, mediaDiaria7d, topPorCliques, topPorConversao, variacao, variacaoDoDia, vazamento, type LinhaCampanha,
} from "@/src/lib/regras/painel-metricas";
import { serieDaMetrica, totalDaMetrica, type Metrica } from "@/src/lib/regras/serie-metrica";
import { marcarTodosVistos, marcarVisto } from "../actions";
import { Avatar } from "../_componentes/avatar";
import { BotaoFaixa, FaixaBotoes } from "../_componentes/faixa-botoes";
import { GraficoMetrica } from "../_componentes/grafico-metrica";
import { Icone } from "../_componentes/icone";
import { Informativo } from "../_componentes/numeros";
import { BarrasFunil } from "../_componentes/painel/barras-funil";
import { CartaoFunil } from "../_componentes/painel/cartao-funil";
import { Ranking, type ItemRanking } from "../_componentes/painel/ranking";
import { Recolhivel } from "../_componentes/painel/recolhivel";
import { Rosca } from "../_componentes/painel/rosca";
import { Secao } from "../_componentes/painel/secao";
import { SeletorPeriodo } from "../_componentes/periodo";
import { estiloAcao, estiloBotao, estiloCartao, Pagina, Vazio } from "../_componentes/ui";
import { SeletorProjetoMetricas } from "./seletor-projeto";

export const PERIODOS_TENDENCIA = [7, 14, 21, 28] as const;

const ROTULO_ALERTA: Record<string, string> = {
  grupo_cheio: "grupo cheio",
  numero_caiu: "número caiu",
  execucao_bloqueada: "envio bloqueado",
  tarefa_erro: "erro no envio",
  grupo_sumiu: "grupo sumiu",
  criacao_erro: "criação de grupo",
  bloqueado_removido: "bloqueado removido",
  antispam_sem_conta: "anti-spam sem conexão autorizada",
  entrega_nao_confirmada: "confirmação de entrega",
};
/** Bolinha amarela para aviso; o resto é erro (vermelha). */
const GRAVIDADE: Record<string, "aviso" | "erro"> = { grupo_cheio: "aviso", grupo_sumiu: "aviso", bloqueado_removido: "aviso" };

/** Ordem da tela: Campanhas, Contas, Automações, Webhooks. */
const ATALHOS = [
  { href: "/campanhas", rotulo: "Campanhas", icone: "campaign" },
  { href: "/numeros", rotulo: "Conexões", icone: "qr_code" },
  { href: "/sequencias", rotulo: "Automações", icone: "bolt" },
  { href: "/webhooks", rotulo: "Webhooks", icone: "webhook" },
];

export type AlertaNovo = { id: string; created_at: string; tipo: string; texto: string; campanha_id: string | null };
export type CartaoAtencao = { chave: string; titulo: string; subtitulo: string; href: string };
export type ProximoEnvioMetricas = { quando: string; descricao: string; campanha: string; campanhaId: string };
/** `tc`/`te`/`ts`: período de cada gráfico de Tendências (Clicks/Entraram/Sairam),
 *  cada um com o próprio seletor 7/14/21/28. */
export type EstadoMetricas = { dias: number; tc: number; te: number; ts: number; projetoId: string };

/** `null` em qualquer campo = a consulta daquele bloco falhou (vira "—" ou uma frase de erro só nele). */
export type DadosMetricas = {
  agora: Date;
  /** `user_metadata.nome`, quando cadastrado. Nunca derivar nome do e-mail. */
  nome: string | null;
  estado: EstadoMetricas;
  alertas: { lista: AlertaNovo[]; total: number } | null;
  atencao: CartaoAtencao[];
  erroAtencao: boolean;
  proximo: ProximoEnvioMetricas | null;
  hoje: { cliques: number | null; cliques7d: number | null; entradas: number | null; entradas7d: number | null };
  semCliquesHoje: { id: string; nome: string }[] | null;
  desconectadas24h: { id: string; created_at: string; texto: string }[] | null;
  linhas: LinhaCampanha[] | null;
  total: Resumo | null;
  /** Total do período anterior de mesmo tamanho; `null` quando não deu para ler (sem selos "vs ant."). */
  totalAnterior: Resumo | null;
  diasPeriodo: MetricaDia[] | null;
  /** Um por gráfico de Tendências (Clicks/Entraram/Sairam): cada um no próprio período (`estado.tc`/`te`/`ts`). */
  diasTendenciaCliques: MetricaDia[] | null;
  diasTendenciaEntradas: MetricaDia[] | null;
  diasTendenciaSaidas: MetricaDia[] | null;
  /** "Grupos distintos de WhatsApp" do Funil: grupos ativos das campanhas já filtradas
   *  pelo projeto escolhido; pura leitura, sem efeito em nenhum outro bloco. */
  distintosFunil: Distintos;
  contas: { total: number; conectadas: number; desconectadas: number } | null;
  campanhasAtivas: number | null;
  /** Projetos ativos pro select "Projeto" do Funil de campanhas. */
  projetos: { id: string; nome: string }[];
};

/** `?dias=&tc=&te=&ts=&projeto=` omitindo os padrões (90, 7 e "todos"). */
export function urlMetricas(e: EstadoMetricas, mudar: Partial<EstadoMetricas>): string {
  const p = { ...e, ...mudar };
  const params = new URLSearchParams();
  if (p.dias !== 90) params.set("dias", String(p.dias));
  if (p.tc !== 7) params.set("tc", String(p.tc));
  if (p.te !== 7) params.set("te", String(p.te));
  if (p.ts !== 7) params.set("ts", String(p.ts));
  if (p.projetoId) params.set("projeto", p.projetoId);
  const s = params.toString();
  return s ? `?${s}` : "?";
}

function Falha({ texto = "Não foi possível carregar estes dados." }: { texto?: string }) {
  return <p className="text-sm text-vg-erro">{texto}</p>;
}

function Ponto({ cor }: { cor: "erro" | "aviso" }) {
  return <span aria-hidden className={`mt-[7px] size-1.5 shrink-0 rounded-full ${cor === "erro" ? "bg-vg-erro" : "bg-vg-aviso"}`} />;
}

/** Caixa com título e subtítulo pequenos (listas e rankings dentro das seções). `icone` é opcional (Destaques,
 *  `ads_click`/`percent` nos títulos dos quadros de Top campanhas). */
function Quadro({ titulo, subtitulo, icone, children }: { titulo: string; subtitulo?: string; icone?: string; children: React.ReactNode }) {
  return (
    <div className={`${estiloCartao} p-4`}>
      <h3 className="flex items-center gap-1.5 text-[15px] font-medium">
        {icone && <Icone nome={icone} tamanho={16} className="text-vg-muted" />}
        {titulo}
      </h3>
      {subtitulo && <p className="text-xs text-vg-muted">{subtitulo}</p>}
      <div className="mt-2">{children}</div>
    </div>
  );
}

/** Cartão de aviso clicável: quadrado amarelo com `warning` (ou outro ícone), título, subtítulo e seta. */
function CartaoAviso({ href, titulo, subtitulo, icone = "warning", children }: { href: string; titulo: string; subtitulo?: string; icone?: string; children?: React.ReactNode }) {
  return (
    <Link href={href} className={`${estiloCartao} flex items-center gap-3 p-4 transition-colors hover:bg-white/[0.03]`}>
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-vg-accent/15 text-vg-accent">
        <Icone nome={icone} tamanho={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-vg-text">{titulo}</span>
        {subtitulo && <span className="block truncate text-xs text-vg-muted">{subtitulo}</span>}
        {children}
      </span>
      <Icone nome="chevron_right" tamanho={20} className="text-vg-muted" />
    </Link>
  );
}

const pct = (parte: number, total: number) => `${percentual(parte, total)}%`;
const link = (id: string) => `/campanhas/${id}`;

const MINILINHAS: { metrica: Metrica; icone: string; rotulo: string; maiorEhMelhor: boolean; sufixo?: string }[] = [
  { metrica: "cliques", icone: "ads_click", rotulo: "Clicks", maiorEhMelhor: true },
  { metrica: "entradas", icone: "login", rotulo: "Entraram", maiorEhMelhor: true },
  { metrica: "pct_entrada", icone: "percent", rotulo: "Percentual de entrada", maiorEhMelhor: true, sufixo: " %" },
  { metrica: "saidas", icone: "logout", rotulo: "Sairam", maiorEhMelhor: false },
];

/** Valor do período para a variação "vs ant." (percentual de entrada em pontos de %). */
function valorDe(r: Resumo, m: Metrica): number {
  if (m === "pct_entrada") return r.cliques ? (r.entradas / r.cliques) * 100 : 0;
  if (m === "pct_saida") return r.entradas ? (r.saidas / r.entradas) * 100 : 0;
  return r[m];
}

/** Tela Métricas (13 blocos, na ordem da tela). Só apresentação: a página carrega os dados. */
export function PainelMetricas(d: DadosMetricas) {
  const { agora, estado, total, linhas } = d;
  const url = (mudar: Partial<EstadoMetricas>) => urlMetricas(estado, mudar);
  const ind = total && d.campanhasAtivas !== null ? indicadores(total, d.campanhasAtivas) : null;
  const semAtencao = d.atencao.length === 0;

  // Select "Projeto" do Funil de campanhas: só esse bloco (cartões + CSV) fica restrito ao projeto escolhido; o
  // resto da tela (Destaques, Qualidade do funil, Campanhas em queda…) continua mostrando todos os projetos.
  const linhasFunil = linhas ? filtrarPorProjeto(linhas, estado.projetoId) : null;
  const totalFunil = linhasFunil ? somarResumos(linhasFunil.map((l) => l.atual)) : null;
  const totalAnteriorFunil = linhasFunil && d.totalAnterior ? somarResumos(linhasFunil.map((l) => l.anterior)) : null;
  const cartoesFunil = totalFunil ? cartoesDoResumo(totalFunil, d.distintosFunil) : null;
  const rodapeFunil = `Últimos ${estado.dias} dias`;
  const exportarFunilUrl = `/api/exportar/funil?${new URLSearchParams({ dias: String(estado.dias), ...(estado.projetoId ? { projeto: estado.projetoId } : {}) }).toString()}`;

  return (
    <Pagina
      titulo={d.nome ? `Olá, ${d.nome}!` : "Olá!"}
      subtitulo="Por onde podemos começar hoje?"
      acoes={ATALHOS.map((a) => (
        <Link key={a.href} href={a.href} className={estiloBotao("contorno")}>
          <Icone nome={a.icone} tamanho={16} />
          {a.rotulo}
        </Link>
      ))}
    >
      <div className="space-y-8">
        {/* 2. Alertas */}
        <Recolhivel
          titulo="Alertas"
          icone="notifications"
          subtitulo={
            d.alertas === null
              ? "Não foi possível carregar os alertas."
              : d.alertas.total === 0
                ? ""
                : `${formatarNumero(d.alertas.total)} não vistos`
          }
        >
          {d.alertas === null ? (
            <Falha texto="Não foi possível carregar os alertas." />
          ) : d.alertas.lista.length === 0 ? (
            <p className="text-sm text-vg-muted">Não há notificações por enquanto.</p>
          ) : (
            <>
              <ul className="divide-y divide-vg-line">
                {d.alertas.lista.map((a) => (
                  <li key={a.id} className="flex items-start gap-2.5 py-2.5 text-sm">
                    <Ponto cor={GRAVIDADE[a.tipo] ?? "erro"} />
                    <div className="min-w-0 flex-1">
                      <p className="break-words"><span className="text-vg-muted">{ROTULO_ALERTA[a.tipo] ?? a.tipo} · </span>{a.texto}</p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-vg-muted">
                        <span className="tabular-nums">{isoParaBrasilia(a.created_at)}</span>
                        {a.campanha_id && <Link href={link(a.campanha_id)} className={estiloAcao.normal}>ver</Link>}
                        <form action={marcarVisto.bind(null, a.id)}><button className={estiloAcao.neutro}>marcar como visto</button></form>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              <form action={marcarTodosVistos}><button className={estiloAcao.normal}>marcar todos como vistos</button></form>
            </>
          )}
        </Recolhivel>

        {/* 3. O que precisa de atenção */}
        <Secao titulo="O que precisa de atenção" subtitulo="Prioridades operacionais do momento.">
          {d.erroAtencao && <Falha texto="Não foi possível carregar parte das prioridades." />}
          {semAtencao && !d.erroAtencao && <div className={estiloCartao}><Vazio compacto icone={<Icone nome="check_circle" tamanho={16} />} texto="Tudo certo por aqui." /></div>}
          {(!semAtencao || d.proximo) && (
            <div className="grid gap-3 md:grid-cols-2">
              {d.atencao.map((c) => <CartaoAviso key={c.chave} href={c.href} titulo={c.titulo} subtitulo={c.subtitulo} />)}
              {d.proximo && (
                <CartaoAviso href={`/campanhas/${d.proximo.campanhaId}/calendario`} icone="schedule" titulo={`Próximo envio · ${quandoCurto(d.proximo.quando, agora)}`} subtitulo={d.proximo.descricao}>
                  {d.proximo.campanha && <span className="block truncate text-xs text-vg-muted">{d.proximo.campanha}</span>}
                </CartaoAviso>
              )}
            </div>
          )}
        </Secao>

        {/* 4. Operação do dia */}
        <Secao titulo="Operação do dia" subtitulo="Pulso de hoje, campanhas sem cliques e conexões que desconectaram nas últimas 24h.">
          <div className="grid gap-3 md:grid-cols-2">
            <CartaoFunil
              icone="ads_click"
              rotulo="Cliques hoje"
              valor={numeroOuTraco(d.hoje.cliques)}
              rodape={d.hoje.cliques7d === null ? undefined : `Média 7d: ${mediaDiaria7d(d.hoje.cliques7d)}`}
              variacao={d.hoje.cliques !== null && d.hoje.cliques7d !== null ? variacaoDoDia(d.hoje.cliques, d.hoje.cliques7d) ?? undefined : undefined}
            />
            <CartaoFunil
              icone="login"
              rotulo="Entradas hoje"
              valor={numeroOuTraco(d.hoje.entradas)}
              rodape={d.hoje.entradas7d === null ? undefined : `Média 7d: ${mediaDiaria7d(d.hoje.entradas7d)}`}
              variacao={d.hoje.entradas !== null && d.hoje.entradas7d !== null ? variacaoDoDia(d.hoje.entradas, d.hoje.entradas7d) ?? undefined : undefined}
            />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Quadro titulo="Campanhas ativas sem cliques hoje" subtitulo="Possível falha de link ou tráfego">
              {d.semCliquesHoje === null ? (
                <Falha />
              ) : d.semCliquesHoje.length === 0 ? (
                <Vazio compacto texto="Todas as campanhas ativas tiveram cliques hoje." />
              ) : (
                <ul className="divide-y divide-vg-line">
                  {d.semCliquesHoje.map((c) => (
                    <li key={c.id}>
                      <Link href={link(c.id)} className="flex items-center gap-3 py-2 text-sm transition-colors hover:text-vg-accent-2">
                        <Avatar nome={c.nome} tamanho={32} />
                        <span className="min-w-0 truncate">{c.nome}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Quadro>
            <Quadro titulo="Desconectadas nas últimas 24h" subtitulo="Com base no último horário de desconexão">
              {d.desconectadas24h === null ? (
                <Falha />
              ) : d.desconectadas24h.length === 0 ? (
                <Vazio compacto texto="Nenhuma conexão desconectou nas últimas 24 horas." />
              ) : (
                <ul className="divide-y divide-vg-line">
                  {d.desconectadas24h.map((a) => (
                    <li key={a.id} className="flex items-start gap-2.5 py-2.5 text-sm">
                      <Ponto cor="erro" />
                      <div className="min-w-0 flex-1">
                        <p className="break-words">{a.texto}</p>
                        <p className="text-xs text-vg-muted tabular-nums">{isoParaBrasilia(a.created_at)}</p>
                      </div>
                      <Link href="/numeros?aba=desconectadas" className={estiloAcao.normal}>reconectar</Link>
                    </li>
                  ))}
                </ul>
              )}
            </Quadro>
          </div>
        </Secao>

        {/* 5. Funil de campanhas */}
        <Secao
          titulo="Funil de campanhas"
          subtitulo="Indicadores agregados de cliques, entradas, saídas e grupos."
          acoes={
            <>
              <SeletorProjetoMetricas
                atual={estado.projetoId}
                projetos={d.projetos}
                hrefs={Object.fromEntries([["", url({ projetoId: "" })], ...d.projetos.map((p) => [p.id, url({ projetoId: p.id })])])}
              />
              <SeletorPeriodo atual={estado.dias} opcoes={PERIODOS} href={(dias) => url({ dias })} rotulo="Período do funil" />
              <a href={exportarFunilUrl} className={estiloBotao("contorno")}>
                <Icone nome="download" tamanho={16} />
                Exportar CSV
              </a>
            </>
          }
        >
          <Informativo>Dados dos últimos {estado.dias} dias</Informativo>
          {!totalFunil || !cartoesFunil ? (
            <Falha />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {MINILINHAS.map((m, i) => (
                <CartaoFunil
                  key={m.metrica}
                  cabecalhoComIcone
                  icone={m.icone}
                  rotulo={m.rotulo}
                  valor={`${cartoesFunil[i].valor}${m.sufixo ?? ""}`}
                  rodape={rodapeFunil}
                  variacao={!estado.projetoId && totalAnteriorFunil ? variacao(valorDe(totalFunil, m.metrica), valorDe(totalAnteriorFunil, m.metrica), m.maiorEhMelhor) : undefined}
                  serie={!estado.projetoId && d.diasPeriodo ? serieDaMetrica(d.diasPeriodo, m.metrica).map((p) => p.valor) : undefined}
                />
              ))}
              {/* "Participantes (total)", "Grupos (total)", "Grupos cheios" e "Grupos disponíveis": aqui
                  vale "Total atual" (não são números do período, como os 4 de cima). */}
              {cartoesFunil.slice(4).map((c) => (
                <CartaoFunil key={c.rotulo} cabecalhoComIcone icone={c.icone} rotulo={c.rotulo} valor={c.valor} rodape="Total atual" detalhe={c.detalhe} />
              ))}
            </div>
          )}
        </Secao>

        <div className="grid gap-8 lg:grid-cols-2">
          {/* 6. Funil em etapas */}
          <Secao titulo="Funil em etapas" subtitulo="Cliques → entradas → participantes atuais">
            <div className={`${estiloCartao} p-4`}>{total ? <BarrasFunil etapas={etapasDoFunil(total)} /> : <Falha />}</div>
          </Secao>

          {/* 7. Status das contas */}
          <Secao titulo="Status das conexões" subtitulo="Distribuição operacional atual">
            <div className={`${estiloCartao} p-4`}>
              {d.contas ? (
                <Rosca
                  total={d.contas.total}
                  rotulo="Conexões"
                  fatias={[
                    { rotulo: "Conectadas", valor: d.contas.conectadas, cor: "#65DFAB" },
                    { rotulo: "Desconectadas", valor: d.contas.desconectadas, cor: "#F26D68" },
                    { rotulo: "Outras", valor: d.contas.total - d.contas.conectadas - d.contas.desconectadas, cor: "#929F96" },
                  ]}
                />
              ) : (
                <Falha />
              )}
            </div>
          </Secao>
        </div>

        {/* 8. Indicadores derivados */}
        <Secao titulo="Indicadores derivados">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <CartaoFunil icone="percent" rotulo="Conversão" valor={ind ? `${ind.conversao} %` : "—"} rodape="Taxa de conversão global" />
            <CartaoFunil icone="logout" rotulo="Churn" valor={ind ? `${ind.churn} %` : "—"} rodape="Saídas / participantes" />
            <CartaoFunil icone="ads_click" rotulo="Cliques médios" valor={ind ? ind.cliquesMedios : "—"} rodape="Por campanha ativa" />
          </div>
        </Secao>

        {/* 9. Tendências */}
        <Secao titulo="Tendências">
          <div className="space-y-5">
            {(
              [
                ["cliques", "Clicks", `no período de ${estado.tc} dias`, d.diasTendenciaCliques, estado.tc, "tc"],
                ["entradas", "Entraram", "entradas no período", d.diasTendenciaEntradas, estado.te, "te"],
                ["saidas", "Sairam", "saídas no período", d.diasTendenciaSaidas, estado.ts, "ts"],
              ] as const
            ).map(([m, titulo, rotuloTotal, diasMetrica, periodoAtual, parametro]) =>
              diasMetrica === null ? (
                <Falha key={m} texto={`Não foi possível carregar "${titulo}".`} />
              ) : (
                <GraficoMetrica
                  key={m}
                  titulo={titulo}
                  total={totalDaMetrica(diasMetrica, m)}
                  rotuloTotal={rotuloTotal}
                  serie={serieDaMetrica(diasMetrica, m)}
                  idGradiente={`vg-tendencia-${m}`}
                  atualizar={false}
                  cabecalhoExtra={
                    <FaixaBotoes>
                      {PERIODOS_TENDENCIA.map((p) => (
                        <BotaoFaixa key={p} caixaNormal href={url({ [parametro]: p })} ativo={periodoAtual === p}>
                          {p}
                        </BotaoFaixa>
                      ))}
                    </FaixaBotoes>
                  }
                />
              ),
            )}
          </div>
        </Secao>

        {/* 10. Destaques */}
        <Secao titulo="Destaques">
          <div className="grid gap-3 md:grid-cols-2">
            <Quadro titulo="Top campanhas por cliques" icone="ads_click">
              {linhas ? (
                <Ranking
                  semAvatar
                  vazio="Nenhum clique no período."
                  itens={topPorCliques(linhas).map((l): ItemRanking => ({
                    chave: l.id,
                    nome: l.nome,
                    href: link(l.id),
                    linha2: `${formatarNumero(l.atual.entradas)} entradas · ${pct(l.atual.entradas, l.atual.cliques)} conv.`,
                    valor: formatarNumero(l.atual.cliques),
                  }))}
                />
              ) : <Falha />}
            </Quadro>
            <Quadro titulo="Top campanhas por conversão" icone="percent">
              {linhas ? (
                <Ranking
                  semAvatar
                  vazio="Nenhum clique no período."
                  itens={topPorConversao(linhas).map((l): ItemRanking => ({
                    chave: l.id,
                    nome: l.nome,
                    href: link(l.id),
                    linha2: `${formatarNumero(l.atual.cliques)} cliques · ${formatarNumero(l.atual.entradas)} entradas`,
                    valor: pct(l.atual.entradas, l.atual.cliques),
                  }))}
                />
              ) : <Falha />}
            </Quadro>
          </div>
        </Secao>

        {/* 11. Campanhas em queda */}
        <Secao titulo="Campanhas em queda" subtitulo={`Comparando os últimos ${estado.dias} dias com o período anterior.`}>
          <div className={`${estiloCartao} p-4`}>
            {linhas && d.totalAnterior ? (
              <Ranking
                vazio="Nenhuma campanha com queda relevante de cliques no período."
                itens={emQueda(linhas).map((l): ItemRanking => ({
                  chave: l.id,
                  nome: l.nome,
                  href: link(l.id),
                  linha2: `${formatarNumero(l.anterior.cliques)} cliques antes → ${formatarNumero(l.atual.cliques)} agora`,
                  valor: `-${Math.round((1 - l.atual.cliques / l.anterior.cliques) * 100)}%`,
                  tom: "erro",
                }))}
              />
            ) : <Falha />}
          </div>
        </Secao>

        {/* 12. Qualidade do funil */}
        <Secao titulo="Qualidade do funil" subtitulo="Vazamento de conversão, churn por campanha e ocupação de grupos.">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <CartaoFunil icone="check_box" rotulo="Grupos cheios" valor={total ? formatarNumero(total.gruposCheios) : "—"} rodape={total ? `${pct(total.gruposCheios, total.grupos)} de ocupação` : undefined} />
            <CartaoFunil
              icone="check_box_outline_blank"
              rotulo="Grupos disponíveis"
              valor={total ? formatarNumero(total.grupos - total.gruposCheios) : "—"}
              rodape={total ? `${formatarNumero(total.grupos)} grupos no total` : undefined}
            />
            <CartaoFunil icone="pie_chart" rotulo="Taxa de preenchimento" valor={total ? `${percentual(total.gruposCheios, total.grupos)} %` : "—"} rodape="Cheios ÷ total de grupos" />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Quadro titulo="Vazamento (alto clique, baixa conversão)" subtitulo="Mín. 20 cliques e conversão abaixo de 15%">
              {linhas ? (
                <Ranking
                  vazio="Nenhuma campanha com vazamento relevante no período."
                  itens={vazamento(linhas).map((l): ItemRanking => ({
                    chave: l.id,
                    nome: l.nome,
                    href: link(l.id),
                    linha2: `${formatarNumero(l.atual.cliques)} cliques · ${formatarNumero(l.atual.entradas)} entradas`,
                    valor: pct(l.atual.entradas, l.atual.cliques),
                    tom: "erro",
                  }))}
                />
              ) : <Falha />}
            </Quadro>
            <Quadro titulo="Maior churn por campanha" subtitulo="Saídas ÷ entradas no período (proxy)">
              {linhas ? (
                <Ranking
                  vazio="Nenhuma entrada no período."
                  itens={maiorChurn(linhas).map((l): ItemRanking => ({
                    chave: l.id,
                    nome: l.nome,
                    href: link(l.id),
                    linha2: `${formatarNumero(l.atual.saidas)} saídas · ${formatarNumero(l.atual.entradas)} entradas`,
                    valor: pct(l.atual.saidas, l.atual.entradas),
                    tom: "erro",
                  }))}
                />
              ) : <Falha />}
            </Quadro>
          </div>
        </Secao>
      </div>
    </Pagina>
  );
}
