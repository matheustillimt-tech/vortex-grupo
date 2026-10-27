import { caminhoArea, caminhoLinha, pontosDoGrafico, rotulosDoEixo, topoDaEscala } from "@/src/lib/regras/grafico";

const LARGURA = 600;
const ALTURA = 140;

/** Cliques (linha laranja com área em degradê) e entradas (tracejada cinza) por dia. `idGradiente` único por página. */
export function Grafico({ dados, idGradiente = "vg-grafico-cliques" }: { dados: { dia: string; cliques: number; entradas: number }[]; idGradiente?: string }) {
  const topo = topoDaEscala(Math.max(0, ...dados.map((d) => Math.max(d.cliques, d.entradas))));
  const cliques = pontosDoGrafico(dados.map((d) => d.cliques), LARGURA, ALTURA, topo);
  const entradas = pontosDoGrafico(dados.map((d) => d.entradas), LARGURA, ALTURA, topo);
  const rotulos = rotulosDoEixo(dados.map((d) => d.dia));
  return (
    <figure className="space-y-2">
      <div className="relative">
        <span className="absolute right-0 -top-1 text-[10px] tabular-nums text-vg-text-3">{topo.toLocaleString("pt-BR")}</span>
        <svg viewBox={`0 0 ${LARGURA} ${ALTURA}`} preserveAspectRatio="none" className="h-36 w-full overflow-visible md:h-40" role="img" aria-label="Cliques e entradas por dia">
          <defs>
            <linearGradient id={idGradiente} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#0FA968" stopOpacity="0.35" />
              <stop offset="1" stopColor="#0FA968" stopOpacity="0" />
            </linearGradient>
          </defs>
          <g stroke="rgba(255,255,255,0.08)">
            {[0, 0.5, 1].map((f) => <line key={f} x1="0" x2={LARGURA} y1={ALTURA * f} y2={ALTURA * f} vectorEffect="non-scaling-stroke" />)}
          </g>
          {dados.length > 0 && (
            <>
              <path d={caminhoArea(cliques, ALTURA)} fill={`url(#${idGradiente})`} />
              <path d={caminhoLinha(entradas)} fill="none" stroke="#929F96" strokeWidth="2" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
              <path d={caminhoLinha(cliques)} fill="none" stroke="#0FA968" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            </>
          )}
        </svg>
      </div>
      <div className="relative h-4 text-[10px] tabular-nums text-vg-text-3">
        {rotulos.map((r) => (
          <span
            key={r.indice}
            className="absolute top-0 whitespace-nowrap"
            style={{ left: `${r.posicao}%`, transform: `translateX(${r.posicao === 0 ? "0" : r.posicao === 100 ? "-100%" : "-50%"})` }}
          >
            {r.rotulo}
          </span>
        ))}
      </div>
      <figcaption className="flex gap-4 text-[11px] text-vg-muted">
        <span className="flex items-center gap-1.5"><span aria-hidden className="h-0.5 w-4 rounded bg-vg-accent" /> cliques</span>
        <span className="flex items-center gap-1.5"><span aria-hidden className="w-4 border-t-2 border-dashed border-vg-muted" /> entradas</span>
      </figcaption>
    </figure>
  );
}
