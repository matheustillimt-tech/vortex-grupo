import { Assistente } from "../assistente";
import { carregarOpcoesAssistente } from "../opcoes-assistente";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";
import { ehUuid } from "@/src/lib/regras/uuid";

export const dynamic = "force-dynamic";

/** `?campanha={id}` (ex.: "ADICIONAR" na aba Automações da campanha) entra com a campanha já escolhida —
 *  ver `campanhaInicial` do `Assistente`. Só vale se for uuid, e não amplia a lista: automação nova só oferece
 *  campanhas não arquivadas (uma arquivada na URL é ignorada pelo `Assistente`, e `salvarAutomacao` recusa). */
export default async function NovaAutomacao({ searchParams }: { searchParams: Promise<{ campanha?: string }> }) {
  const b = await bloqueio("automacoes");
  if (b) return b;
  const { campanha } = await searchParams;
  const opcoes = await carregarOpcoesAssistente();
  return <Assistente automacaoId={null} {...opcoes} campanhaInicial={ehUuid(campanha) ? campanha : null} />;
}
