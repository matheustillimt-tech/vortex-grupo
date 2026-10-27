import { ABAS_MODELOS } from "@/src/lib/regras/topo";
import { Abas } from "./abas";

/** Faixa do topo das telas de Modelos (19/10/2026): o grupo "Personalização" saiu do menu lateral e
 *  Variáveis virou aba aqui. Entra pelo `layout.tsx` de cada uma, então vale também nas subpáginas. */
export function AbasModelos({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="mx-auto max-w-[1200px] space-y-1 px-4 pt-6 md:px-6">
        <h1 className="text-2xl font-normal leading-8">Modelos</h1>
        <Abas itens={ABAS_MODELOS} />
      </div>
      {children}
    </>
  );
}
