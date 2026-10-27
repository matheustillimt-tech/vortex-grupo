import { ABAS_INTEGRACOES } from "@/src/lib/regras/topo";
import { Abas } from "./abas";

/** Faixa do topo das telas de Integrações (19/10/2026): Hooks, Webhooks, API e MCP saíram do submenu
 *  lateral e viram abas aqui; Deep link entrou depois, no mesmo dia. Entra pelo `layout.tsx` de cada uma, então vale também nas subpáginas. */
export function AbasIntegracoes({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="mx-auto max-w-[1200px] space-y-1 px-4 pt-6 md:px-6">
        <h1 className="text-2xl font-normal leading-8">Integrações</h1>
        <Abas itens={ABAS_INTEGRACOES} />
      </div>
      {children}
    </>
  );
}
