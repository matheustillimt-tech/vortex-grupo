import { Icone } from "@/app/(painel)/_componentes/icone";
import { estiloCartao } from "@/app/(painel)/_componentes/ui";

const LARGURA = 80;
const ALTURA = 28;

/** Traço amarelo fino + área leve, sem eixos — só o desenho da tendência. */
function MiniLinha({ serie }: { serie: number[] }) {
  const n = serie.length;
  if (n < 2) return null;
  const maximo = Math.max(...serie);
  const minimo = Math.min(0, ...serie);
  const escala = maximo - minimo || 1;
  const x = (i: number) => (i * LARGURA) / (n - 1);
  const y = (v: number) => ALTURA - ((v - minimo) / escala) * ALTURA;
  const pontos = serie.map((v, i) => ({ x: x(i), y: y(v) }));
  const linha = pontos.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = `${linha} L${pontos[n - 1].x.toFixed(1)},${ALTURA} L${pontos[0].x.toFixed(1)},${ALTURA} Z`;
  return (
    <svg viewBox={`0 0 ${LARGURA} ${ALTURA}`} className="h-7 w-20 shrink-0" role="img" aria-label="Tendência dos últimos dias">
      <path d={area} fill="#0FA968" fillOpacity="0.15" />
      <path d={linha} fill="none" stroke="#0FA968" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

const SELO_TOM: Record<"ok" | "erro" | "neutro", string> = {
  ok: "bg-[#0fa968]/15 text-[#8de7bb]",
  neutro: "bg-white/10 text-vg-text-2",
  erro: "bg-[#f26d68]/15 text-[#f4aaa8]",
};

/** `neutro` (ex.: "0% vs ant.") não é alta nem queda, então usa uma seta reta em vez de subir/cair. */
function iconeVariacao(v: { tom: "ok" | "erro" | "neutro"; sobe: boolean }): string {
  if (v.tom === "neutro") return "trending_flat";
  return v.sobe ? "trending_up" : "trending_down";
}

/** Cartão de indicador do funil: ícone, rótulo, valor grande, rodapé, selo de variação opcional e minilinha opcional.
 *  `cabecalhoComIcone` (opcional): ícone + título numa linha só no topo, com o selo "vs
 *  ant." ao lado do título (em vez do canto absoluto); padrão `false` reproduz o visual de hoje. */
export function CartaoFunil({ icone, rotulo, valor, rodape, variacao, serie, detalhe, cabecalhoComIcone = false }: {
  icone: string;
  rotulo: string;
  valor: string | number;
  rodape?: string;
  variacao?: { texto: string; tom: "ok" | "erro" | "neutro"; sobe: boolean };
  serie?: number[];
  detalhe?: React.ReactNode;
  cabecalhoComIcone?: boolean;
}) {
  if (cabecalhoComIcone) {
    return (
      <div className={`${estiloCartao} p-4`}>
        <div className="flex items-center gap-2">
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-vg-accent/15 text-vg-accent">
            <Icone nome={icone} tamanho={16} />
          </span>
          <p className="min-w-0 truncate text-[13px] text-vg-muted">{rotulo}</p>
          {variacao && (
            <span className={`ml-auto inline-flex shrink-0 items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${SELO_TOM[variacao.tom]}`}>
              <Icone nome={iconeVariacao(variacao)} tamanho={13} />
              {variacao.texto}
            </span>
          )}
        </div>
        <div className="mt-2 flex items-end justify-between gap-3">
          <p className="truncate text-2xl font-bold tabular-nums">{valor}</p>
          {serie && serie.length > 0 && <MiniLinha serie={serie} />}
        </div>
        {rodape && <p className="mt-1 text-xs text-vg-muted">{rodape}</p>}
        {detalhe && <div className="mt-1 text-xs text-vg-muted">{detalhe}</div>}
      </div>
    );
  }
  return (
    <div className={`relative ${estiloCartao} p-4`}>
      {variacao && (
        <span
          className={`absolute right-3 top-3 inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${SELO_TOM[variacao.tom]}`}
        >
          <Icone nome={iconeVariacao(variacao)} tamanho={13} />
          {variacao.texto}
        </span>
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <span className="grid size-9 place-items-center rounded-lg bg-vg-accent/15 text-vg-accent">
            <Icone nome={icone} tamanho={18} />
          </span>
          <p className="text-[13px] text-vg-muted">{rotulo}</p>
          <p className="truncate text-2xl font-bold tabular-nums">{valor}</p>
          {rodape && <p className="text-xs text-vg-muted">{rodape}</p>}
          {detalhe && <div className="text-xs text-vg-muted">{detalhe}</div>}
        </div>
        {/* Embaixo, na altura do valor: em cima ficaria por baixo do selo de variação. */}
        {serie && serie.length > 0 && <div className="self-end pb-1"><MiniLinha serie={serie} /></div>}
      </div>
    </div>
  );
}
