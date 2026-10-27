const TAMANHO = 180;
const ESPESSURA = 22;
const RAIO = (TAMANHO - ESPESSURA) / 2;
const CIRCUNFERENCIA = 2 * Math.PI * RAIO;
const CENTRO = TAMANHO / 2;

export type FatiaRosca = { rotulo: string; valor: number; cor: string };

/** Anel de distribuição (status das contas): total no meio, legenda com bolinhas embaixo. Sem nenhum valor, mostra
 *  o anel cinza por inteiro. */
export function Rosca({ total, rotulo, fatias }: { total: number; rotulo: string; fatias: FatiaRosca[] }) {
  const zerado = total <= 0 || fatias.every((f) => f.valor <= 0);
  let acumulado = 0;

  return (
    <div className="flex flex-col items-center gap-4">
      <svg
        viewBox={`0 0 ${TAMANHO} ${TAMANHO}`}
        className="h-[180px] w-[180px]"
        role="img"
        aria-label={`${rotulo}: ${total.toLocaleString("pt-BR")}${fatias.map((f) => `, ${f.rotulo} ${f.valor.toLocaleString("pt-BR")}`).join("")}`}
      >
        {zerado ? (
          <circle cx={CENTRO} cy={CENTRO} r={RAIO} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={ESPESSURA} />
        ) : (
          fatias.map((f) => {
            const fracao = f.valor / total || 0;
            const comprimento = fracao * CIRCUNFERENCIA;
            const deslocamento = acumulado;
            acumulado += comprimento;
            return (
              <circle
                key={f.rotulo}
                cx={CENTRO}
                cy={CENTRO}
                r={RAIO}
                fill="none"
                stroke={f.cor}
                strokeWidth={ESPESSURA}
                strokeDasharray={`${comprimento} ${CIRCUNFERENCIA - comprimento}`}
                strokeDashoffset={-deslocamento}
                transform={`rotate(-90 ${CENTRO} ${CENTRO})`}
              />
            );
          })
        )}
        <text x={CENTRO} y={CENTRO - 8} textAnchor="middle" fill="#929F96" className="text-[11px]">
          {rotulo}
        </text>
        <text x={CENTRO} y={CENTRO + 16} textAnchor="middle" fill="#f6f7f6" className="text-2xl font-bold tabular-nums">
          {total.toLocaleString("pt-BR")}
        </text>
      </svg>
      <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-xs text-vg-muted">
        {fatias.map((f) => (
          <li key={f.rotulo} className="flex items-center gap-1.5">
            <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: f.cor }} />
            {f.rotulo} <span className="font-medium text-vg-text tabular-nums">{f.valor.toLocaleString("pt-BR")}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
