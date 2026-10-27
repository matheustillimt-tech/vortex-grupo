import { permitido } from "@/src/lib/permissoes";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";
import { Pagina } from "../../../_componentes/ui";
import { AbasSolicitacoes } from "./abas";
import { Pendentes } from "./pendentes";

export const dynamic = "force-dynamic";

/** Aba "Solicitações de entrada" › Pendentes. A lista é lida ao vivo pelo componente cliente (action
 *  `listarPendentes`), pra página abrir na hora mesmo com o Zapbot lento. */
export default async function SolicitacoesPendentes({ params }: { params: Promise<{ id: string }> }) {
  const b = await bloqueio("campanhas");
  if (b) return b;
  const { id } = await params;
  const [podeEditar, verLeads] = await Promise.all([permitido("campanhas", "editar"), permitido("leads", "ver")]);
  return (
    <Pagina titulo="Solicitações de entrada">
      <AbasSolicitacoes campanhaId={id} />
      <Pendentes campanhaId={id} podeEditar={podeEditar} verLeads={verLeads} />
    </Pagina>
  );
}
