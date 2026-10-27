import { AVISO_COMUNIDADES } from "@/src/lib/regras/solicitacoes";
import { Abas } from "../../../_componentes/abas";
import { Icone } from "../../../_componentes/icone";

/** Topo da aba "Solicitações de entrada" (Etapa 3M, Tarefa 4): o aviso fixo sobre comunidades e as
 *  sub-abas Pendentes / Processadas / Configurações (o mesmo componente de abas das outras telas). Só dados (hrefs)
 *  vão pro componente cliente. */
export function AbasSolicitacoes({ campanhaId }: { campanhaId: string }) {
  const base = `/campanhas/${campanhaId}/solicitacoes`;
  return (
    <div className="space-y-3">
      <p role="note" className="flex items-start gap-2 rounded-lg border border-vg-line bg-vg-panel-3 px-3 py-2 text-[13px] text-vg-text-2">
        <Icone nome="info" tamanho={18} className="text-vg-text-3" />
        {AVISO_COMUNIDADES}
      </p>
      <Abas
        itens={[
          { href: base, rotulo: "Pendentes", exato: true },
          { href: `${base}/processadas`, rotulo: "Processadas" },
          { href: `${base}/configuracoes`, rotulo: "Configurações" },
        ]}
      />
    </div>
  );
}
