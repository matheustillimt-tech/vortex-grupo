import { notFound } from "next/navigation";
import { Moldura } from "@/app/(painel)/_componentes/moldura";
import { SecaoCalendario } from "./secoes/calendario";
import { SecaoCampanha } from "./secoes/campanha";
import { SecaoComponentes } from "./secoes/componentes";
import { SecaoInicio } from "./secoes/inicio";
import { SecaoMetricas } from "./secoes/metricas";

export const metadata = { title: "Vitrine · Vórtex Grupo", robots: { index: false, follow: false } };

const CAMPANHAS_MENTIRA = [
  { id: "1", nome: "Lançamento de outubro" },
  { id: "2", nome: "Reativação de leads" },
];

const CONTAS_MENTIRA = [
  { id: "1", nome: "Captação 01" },
  { id: "2", nome: "Captação 02" },
];

/** Só no `next dev`: todos os componentes e as telas redesenhadas com dados de mentira, sem login.
 *  As ações (marcar como visto, executar agora…) são as server actions de verdade: não clicar. */
export default function Vitrine() {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <div className="min-h-screen md:flex">
      <Moldura email="ana.souza@exemplo.com" campanhas={CAMPANHAS_MENTIRA} contas={CONTAS_MENTIRA} avisos={2} atual="/">
        <div className="mx-auto max-w-6xl space-y-14 px-4 py-6 md:px-6">
          <SecaoInicio />
          <SecaoMetricas />
          <SecaoCampanha />
          <SecaoCalendario />
          <SecaoComponentes />
        </div>
      </Moldura>
    </div>
  );
}
