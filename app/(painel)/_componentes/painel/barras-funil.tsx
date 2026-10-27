const CORES = ["#0FA968", "#65DFAB", "#B6F0D2"];

export type EtapaFunil = { rotulo: string; valor: number; pctAnterior: string | null };

/** Três barras horizontais proporcionais (cliques → entradas → participantes), cada uma com o valor e o
 *  percentual sobre a etapa anterior à direita. */
export function BarrasFunil({ etapas }: { etapas: EtapaFunil[] }) {
  const maior = Math.max(1, ...etapas.map((e) => e.valor));
  return (
    <div className="space-y-4">
      {etapas.map((e, i) => (
        <div key={e.rotulo} className="space-y-1.5">
          <div className="flex items-start justify-between gap-3 text-sm">
            <span className="text-vg-text">{e.rotulo}</span>
            {/* Duas linhas: "36.4% da etapa anterior" e o número embaixo, numa linha própria. */}
            <span className="text-right text-vg-muted">
              {e.pctAnterior !== null && <span className="block">{e.pctAnterior}% da etapa anterior</span>}
              <span className="block font-medium text-vg-text tabular-nums">{e.valor.toLocaleString("pt-BR")}</span>
            </span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full"
              style={{ width: `${(e.valor / maior) * 100}%`, backgroundColor: CORES[i % CORES.length] }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
