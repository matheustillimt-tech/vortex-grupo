import { caminhoArea, caminhoBanda, caminhoLinha, pontosDoGrafico } from "@/src/lib/regras/grafico";
import { indicesComEtiqueta, rotuloData } from "@/src/lib/regras/serie-metrica";
import { ChipAtualizar } from "./chip-atualizar";
import { MenuGrafico } from "./menu-grafico";

const LARGURA = 600;
const ALTURA = 220;
const ESQ = 28;
const DIR = 28;
const TOPO = 30;
const BASE = 186; // fundo da área; as datas ficam abaixo
const GRADE = [0, 0.25, 0.5, 0.75, 1];

const valorPt = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

const COR_SERIE = { destaque: "#0FA968", neutro: "#929F96" } as const;

/** Pontos de uma série de 2 séries, dentro da mesma caixa do gráfico de 1 série (reaproveita `pontosDoGrafico`
 *  de `src/lib/regras/grafico.ts`, só deslocando pro retângulo ESQ/DIR/TOPO/BASE daqui). */
function pontosNaCaixa(valores: number[], topo: number) {
  return pontosDoGrafico(valores, LARGURA - ESQ - DIR, BASE - TOPO, topo).map((p) => ({ x: p.x + ESQ, y: p.y + TOPO }));
}

export type SerieGrafico = { nome: string; valores: number[]; cor: "destaque" | "neutro" };
export type SerieEmpilhada = { nome: string; valores: number[]; cor: string };

/** Um gráfico por métrica: título, "N Total" (opcional) + "N nos ultimos N Dias", área
 *  amarela com o valor de cada dia numa etiqueta amarela e a data embaixo — ou, com `series`, duas linhas
 *  (Entraram/Sairam…) na mesma caixa. Cabeçalho com `cabecalhoExtra` (ex.: seletor de intervalo), chip
 *  ATUALIZAR (opcional) e o menu de download/tela cheia (opcional). Só apresentação; `idGradiente` único por
 *  gráfico na página. */
export function GraficoMetrica({
  titulo,
  total,
  sufixoTotal = "",
  rotuloTotal,
  totalGeral,
  atualizar = true,
  telaCheia = true,
  serie,
  series,
  empilhado,
  rotulosSeries,
  diasRotulo,
  idGradiente,
  id,
  cabecalhoExtra,
  menu = true,
}: {
  titulo: string;
  /** Sem `series`, obrigatório: o total do período (ex.: "1.284"). Com `series`, não é usado (cada série tem
   *  a própria linha de total). */
  total?: string;
  sufixoTotal?: string;
  /** Texto depois do total. Sem valor, usa "nos ultimos N Dias" (N = pontos da série),
   *  sem disparar nenhuma consulta nova: é só a contagem do que já veio pronto. */
  rotuloTotal?: string;
  /** Linha "{totalGeral} Total" acima da linha do total do período. */
  totalGeral?: string;
  /** Chip "ATUALIZAR" do cabeçalho; `false` esconde. */
  atualizar?: boolean;
  /** Botão `fullscreen` do menu; `false` tira ele e "Ver em tela cheia" (Atividades).
   *  Padrão `true` = hoje. */
  telaCheia?: boolean;
  /** `rotulo` opcional troca a data embaixo do ponto (ex.: "16/10 14h" no gráfico por hora). Modo de 1 série
   *  (o desenho de sempre); ausente quando `series` é usado. */
  serie?: { data: string; valor: number; rotulo?: string }[];
  /** Modo de 2 séries (ex.: Entraram/Sairam): área amarela + linha `vg-muted` tracejada, legenda embaixo. */
  series?: SerieGrafico[];
  /** Modo empilhado (Leadscoring): bandas de área sobrepostas (cada série soma por cima da
   *  anterior) com cor própria + legenda embaixo, no lugar de `serie`/`series`. */
  empilhado?: SerieEmpilhada[];
  /** Texto de cada linha de total em modo `series` (ex.: ["Entraram", "Sairam"]); sem valor, usa `series[].nome`. */
  rotulosSeries?: string[];
  /** "nos ultimos N Dias" do modo `series` (Atividades): o período **escolhido**, não a
   *  contagem de pontos do eixo (que pode ter um ponto mais, "hoje" incluso — `serieComTodosOsDias`). Sem
   *  valor, usa a contagem de pontos (comportamento de hoje). */
  diasRotulo?: number;
  idGradiente: string;
  /** Id do `<section>` pro menu de download/tela cheia mirar; sem valor, usa `idGradiente`. */
  id?: string;
  /** Slot à direita do cabeçalho, antes do ATUALIZAR/menu (ex.: `<SeletorIntervalo>`). */
  cabecalhoExtra?: React.ReactNode;
  /** `fullscreen` + menu "Download SVG/PNG/CSV" e "Ver em tela cheia"; `false` esconde os dois. */
  menu?: boolean;
}) {
  const idAlvo = id ?? idGradiente;
  const modoSeries = !!series && series.length > 0;
  const modoEmpilhado = !!empilhado && empilhado.length > 0;

  return (
    <section id={idAlvo} className="rounded-xl border border-vg-line p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[15px] font-medium">{titulo}</h3>
        <div className="flex items-center gap-1">
          {cabecalhoExtra}
          {atualizar && <ChipAtualizar />}
          {menu && <MenuGrafico idAlvo={idAlvo} titulo={titulo} serie={modoSeries || modoEmpilhado ? undefined : serie} telaCheia={telaCheia} />}
        </div>
      </div>
      {totalGeral && <p className="text-[13px] font-medium text-vg-text tabular-nums">{totalGeral} Total</p>}
      {modoEmpilhado ? (
        <GraficoEmpilhado series={empilhado!} total={total} rotuloTotal={rotuloTotal} idGradiente={idGradiente} />
      ) : modoSeries ? (
        <GraficoSeries series={series!} rotulosSeries={rotulosSeries} diasRotulo={diasRotulo} idGradiente={idGradiente} />
      ) : (
        <GraficoSerieUnica total={total ?? ""} sufixoTotal={sufixoTotal} rotuloTotal={rotuloTotal} serie={serie ?? []} idGradiente={idGradiente} titulo={titulo} />
      )}
    </section>
  );
}

function GraficoSerieUnica({ total, sufixoTotal, rotuloTotal, serie, idGradiente, titulo }: {
  total: string;
  sufixoTotal: string;
  rotuloTotal?: string;
  serie: { data: string; valor: number; rotulo?: string }[];
  idGradiente: string;
  titulo: string;
}) {
  const n = serie.length;
  const rotuloTotalFinal = rotuloTotal ?? `nos ultimos ${n} Dias`;
  const maximo = Math.max(0, ...serie.map((p) => p.valor));
  const topo = maximo > 0 ? maximo * 1.15 : 1; // folga de 15% para as etiquetas
  const x = (i: number) => (n <= 1 ? LARGURA / 2 : ESQ + (i * (LARGURA - ESQ - DIR)) / (n - 1));
  const y = (v: number) => BASE - (v / topo) * (BASE - TOPO);
  const pontos = serie.map((p, i) => ({ ...p, x: x(i), y: y(p.valor) }));
  const linha = pontos.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = n ? `${linha} L${pontos[n - 1].x.toFixed(1)},${BASE} L${pontos[0].x.toFixed(1)},${BASE} Z` : "";
  // Datas "dd/mm/aaaa" ocupam ~60 unidades: acima de 7 pontos elas se encostariam, então mostra 1 a cada ceil(n/7).
  const passoDatas = n > 7 ? Math.ceil(n / 7) : 1;
  const comEtiqueta = new Set(indicesComEtiqueta(serie.map((p) => p.valor)));

  return (
    <>
      <p className="text-[13px] text-vg-text tabular-nums">
        {total}
        {sufixoTotal} {rotuloTotalFinal}
      </p>
      {/* min-w: o viewBox de 600 nunca encolhe abaixo de ~0,93 (texto ≥ 10 px); no celular o gráfico rola de lado. */}
      <div className="mt-2 overflow-x-auto">
        <svg viewBox={`0 0 ${LARGURA} ${ALTURA}`} className="h-auto w-full min-w-[560px]" role="img" aria-label={`${titulo}: total ${total}${sufixoTotal}`}>
          <defs>
            <linearGradient id={idGradiente} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#0FA968" stopOpacity="0.45" />
              <stop offset="1" stopColor="#0FA968" stopOpacity="0.05" />
            </linearGradient>
          </defs>
          <g stroke="rgba(255,255,255,0.12)" strokeDasharray="4 4">
            {GRADE.map((f) => {
              const gy = TOPO + (BASE - TOPO) * f;
              return <line key={f} x1={ESQ} x2={LARGURA - DIR} y1={gy} y2={gy} />;
            })}
          </g>
          {n > 0 && (
            <>
              <path d={area} fill={`url(#${idGradiente})`} />
              <path d={linha} fill="none" stroke="#0FA968" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
            </>
          )}
          {pontos.map((p) => (
            <circle key={`p-${p.data}`} cx={p.x} cy={p.y} r={3} fill="#0FA968" />
          ))}
          {pontos.map((p, i) => {
            if (!comEtiqueta.has(i)) return null;
            const texto = valorPt(p.valor);
            const largura = texto.length * 6.6 + 10;
            const ey = Math.max(2, p.y - 24);
            return (
              <g key={p.data}>
                <rect x={p.x - largura / 2} y={ey} width={largura} height={18} rx={5} fill="#0FA968" />
                {/* `fontSize` inline (não só a classe Tailwind): o SVG exportado (Download SVG/PNG) é
                 *  serializado sem a folha de estilo da página, então o texto saía no tamanho padrão do
                 *  navegador — enorme — fora daqui. */}
                <text x={p.x} y={ey + 13} textAnchor="middle" fill="#04130c" fontSize={11} fontWeight={600} className="text-[11px] font-semibold tabular-nums">
                  {texto}
                </text>
              </g>
            );
          })}
          {pontos.map((p, i) =>
            i % passoDatas === 0 ? (
              <text key={`d-${p.data}`} x={p.x} y={ALTURA - 10} textAnchor={n > 1 && i === 0 ? "start" : n > 1 && i === n - 1 ? "end" : "middle"} fill="#929F96" fontSize={11} className="text-[11px] tabular-nums">
                {p.rotulo ?? rotuloData(p.data)}
              </text>
            ) : null,
          )}
        </svg>
      </div>
    </>
  );
}

/** Modo de 2 séries (Entraram/Sairam…): a "destaque" ganha área + linha cheia (como hoje); a "neutro" vira
 *  linha tracejada, sem área. Legenda embaixo e uma linha de total por série. */
function GraficoSeries({ series, rotulosSeries, diasRotulo, idGradiente }: { series: SerieGrafico[]; rotulosSeries?: string[]; diasRotulo?: number; idGradiente: string }) {
  const maximo = Math.max(0, ...series.flatMap((s) => s.valores));
  const topo = maximo > 0 ? maximo * 1.15 : 1;
  const caminhos = series.map((s) => {
    const pontos = pontosNaCaixa(s.valores, topo);
    return { serie: s, pontos, linha: caminhoLinha(pontos), area: caminhoArea(pontos, BASE) };
  });
  const n = Math.max(...series.map((s) => s.valores.length), 0);

  return (
    <>
      {caminhos.map(({ serie: s }, i) => {
        const soma = s.valores.reduce((acc, v) => acc + v, 0);
        const texto = rotulosSeries?.[i] ?? s.nome;
        return (
          <p key={s.nome} className="text-[13px] text-vg-text tabular-nums">
            {texto}: {valorPt(soma)} nos ultimos {diasRotulo ?? s.valores.length} Dias
          </p>
        );
      })}
      <div className="mt-2 overflow-x-auto">
        <svg viewBox={`0 0 ${LARGURA} ${ALTURA}`} className="h-auto w-full min-w-[560px]" role="img" aria-label="Série de 2 linhas">
          <defs>
            <linearGradient id={idGradiente} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#0FA968" stopOpacity="0.45" />
              <stop offset="1" stopColor="#0FA968" stopOpacity="0.05" />
            </linearGradient>
          </defs>
          <g stroke="rgba(255,255,255,0.12)" strokeDasharray="4 4">
            {GRADE.map((f) => {
              const gy = TOPO + (BASE - TOPO) * f;
              return <line key={f} x1={ESQ} x2={LARGURA - DIR} y1={gy} y2={gy} />;
            })}
          </g>
          {caminhos.map(({ serie: s, linha, area }) =>
            s.cor === "destaque" ? (
              <g key={s.nome}>
                <path d={area} fill={`url(#${idGradiente})`} />
                <path d={linha} fill="none" stroke={COR_SERIE.destaque} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
              </g>
            ) : (
              <path key={s.nome} d={linha} fill="none" stroke={COR_SERIE.neutro} strokeWidth="2" strokeDasharray="5 4" strokeLinejoin="round" strokeLinecap="round" />
            ),
          )}
        </svg>
      </div>
      <ul className="mt-1 flex flex-wrap items-center gap-4 text-[12px] text-vg-text-2">
        {series.map((s) => (
          <li key={s.nome} className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-0.5 w-4 rounded-full" style={{ background: COR_SERIE[s.cor] }} />
            {s.nome}
          </li>
        ))}
      </ul>
      <span className="sr-only">{n} dias</span>
    </>
  );
}

/** Modo empilhado (Leadscoring): bandas de área sobrepostas, uma por série, na ordem dada
 *  (a 1ª fica embaixo). Linha de total geral (acima, como as outras) + legenda com a cor de cada série. */
function GraficoEmpilhado({ series, total, rotuloTotal, idGradiente }: { series: SerieEmpilhada[]; total?: string; rotuloTotal?: string; idGradiente: string }) {
  const n = Math.max(0, ...series.map((s) => s.valores.length));
  // Acumulado por ponto: cada camada soma por cima da anterior (a última linha é o topo = soma de todas).
  const acumulados: number[][] = [];
  let anterior = Array.from({ length: n }, () => 0);
  for (const s of series) {
    const atual = Array.from({ length: n }, (_, i) => anterior[i] + (s.valores[i] ?? 0));
    acumulados.push(atual);
    anterior = atual;
  }
  const topoValor = Math.max(0, ...(acumulados[acumulados.length - 1] ?? [0]));
  const topo = topoValor > 0 ? topoValor * 1.15 : 1;
  const linhaZero = Array.from({ length: n }, () => 0);
  const bandas = series.map((s, i) => {
    const superior = pontosNaCaixa(acumulados[i], topo);
    const inferior = pontosNaCaixa(i === 0 ? linhaZero : acumulados[i - 1], topo);
    return { serie: s, area: caminhoBanda(superior, inferior), linha: caminhoLinha(superior) };
  });

  return (
    <>
      {total !== undefined && (
        <p className="text-[13px] text-vg-text tabular-nums">
          {total} {rotuloTotal}
        </p>
      )}
      <div className="mt-2 overflow-x-auto">
        <svg viewBox={`0 0 ${LARGURA} ${ALTURA}`} className="h-auto w-full min-w-[560px]" role="img" aria-label="Recibos por período (Recebeu, Visualizou, Reproduziu)">
          <defs>
            <linearGradient id={idGradiente} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#0FA968" stopOpacity="0.45" />
              <stop offset="1" stopColor="#0FA968" stopOpacity="0.05" />
            </linearGradient>
          </defs>
          <g stroke="rgba(255,255,255,0.12)" strokeDasharray="4 4">
            {GRADE.map((f) => {
              const gy = TOPO + (BASE - TOPO) * f;
              return <line key={f} x1={ESQ} x2={LARGURA - DIR} y1={gy} y2={gy} />;
            })}
          </g>
          {n === 0 ? (
            <text x={LARGURA / 2} y={(TOPO + BASE) / 2} textAnchor="middle" fill="#929F96" fontSize={13} className="text-[13px]">
              Sem dados no período.
            </text>
          ) : (
            bandas.map(({ serie: s, area, linha }) => (
              <g key={s.nome}>
                <path d={area} fill={s.cor} fillOpacity={0.35} />
                <path d={linha} fill="none" stroke={s.cor} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
              </g>
            ))
          )}
        </svg>
      </div>
      <ul className="mt-1 flex flex-wrap items-center gap-4 text-[12px] text-vg-text-2">
        {series.map((s) => {
          const soma = s.valores.reduce((acc, v) => acc + v, 0);
          return (
            <li key={s.nome} className="flex items-center gap-1.5">
              <span aria-hidden className="inline-block size-2.5 rounded-full" style={{ background: s.cor }} />
              {s.nome} · {valorPt(soma)}
            </li>
          );
        })}
      </ul>
    </>
  );
}
