import { permitido } from "@/src/lib/permissoes";
import { bloqueio } from "../_componentes/guarda";
import { TelaAcoes, type SpTelaAcoes } from "../_acoes/tela-acoes";
import { Icone } from "../_componentes/icone";
import { BotaoLink, Pagina } from "../_componentes/ui";

export const dynamic = "force-dynamic";

export default async function Acoes({ searchParams }: { searchParams: Promise<SpTelaAcoes> }) {
  const b = await bloqueio("campanhas");
  if (b) return b;
  const sp = await searchParams;
  const podeEditar = await permitido("campanhas", "editar");

  return (
    <Pagina titulo="Ações" acoes={podeEditar ? <BotaoLink href="/acoes/nova" icone={<Icone nome="add" tamanho={18} />}>ADICIONAR</BotaoLink> : undefined}>
      <TelaAcoes sp={sp} base="/acoes" conexaoId={null} />
    </Pagina>
  );
}
