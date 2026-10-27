import { redirect } from "next/navigation";
import { permitido } from "@/src/lib/permissoes";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";
import { Icone } from "@/app/(painel)/_componentes/icone";
import { Paginacao } from "@/app/(painel)/_componentes/paginacao";
import { SemAcesso } from "@/app/(painel)/_componentes/sem-acesso";
import { BotaoLink, Pagina } from "@/app/(painel)/_componentes/ui";
import { lerFiltrosAutomacoes, urlAutomacoes } from "@/app/(painel)/automacoes/abas";
import { carregarAutomacoes, carregarCampanhasParaImportar, POR_PAGINA_AUTOMACOES } from "@/app/(painel)/automacoes/comum";
import { BotaoImportarJson, FiltrosAutomacoes, ListaAutomacoes, SelecaoAutomacoes } from "@/app/(painel)/automacoes/lista";

export const dynamic = "force-dynamic";

/** Aba "Automações" da campanha (Etapa 3B, Task 3): a mesma lista de `/automacoes` (carregador e lista
 *  compartilhados em `automacoes/comum.ts` e `automacoes/lista.tsx`), filtrada pela campanha. A área da página é
 *  "campanhas" (`areaDoCaminho`), mas a lista é de automações: sem "ver" em automações, mostra `<SemAcesso />`
 *  nesta aba (a campanha em si continua visível). */
export default async function AutomacoesCampanha({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; gatilho?: string; provedor?: string; pasta?: string; estado?: string; pagina?: string }>;
}) {
  const b = await bloqueio("campanhas");
  if (b) return b;
  const { id } = await params;
  const podeVerAutomacoes = await permitido("automacoes", "ver");
  if (!podeVerAutomacoes) return <SemAcesso />;
  const podeEditarAutomacoes = await permitido("automacoes", "editar");

  const base = `/campanhas/${id}/automacoes`;
  const filtros = lerFiltrosAutomacoes(await searchParams);
  const db = await dbUsuario();

  const { automacoes, pastas, total } = await carregarAutomacoes(db, { campanhaId: id, filtros });
  const campanhasImportar = podeEditarAutomacoes ? await carregarCampanhasParaImportar(db) : [];
  // Página além do fim (a lista encolheu): volta pra primeira.
  if (!automacoes.length && filtros.pagina > 1) redirect(urlAutomacoes(base, filtros, { pagina: 1 }));

  const inicio = (filtros.pagina - 1) * POR_PAGINA_AUTOMACOES;
  const de = total ? inicio + 1 : 0;
  const ate = inicio + automacoes.length;

  return (
    <SelecaoAutomacoes ids={automacoes.map((a) => a.id)}>
      <Pagina
        titulo="Automações"
        acoes={
          podeEditarAutomacoes ? (
            <>
              <BotaoLink href={`/automacoes/nova?campanha=${id}`} icone={<Icone nome="add" />}>ADICIONAR</BotaoLink>
              <BotaoImportarJson campanhas={campanhasImportar} campanhaPadrao={id} />
            </>
          ) : undefined
        }
      >
        <FiltrosAutomacoes filtros={filtros} pastas={pastas} base={base} />
        <Paginacao
          de={de}
          ate={ate}
          total={total}
          porPagina={POR_PAGINA_AUTOMACOES}
          anterior={filtros.pagina > 1 ? urlAutomacoes(base, filtros, { pagina: filtros.pagina - 1 }) : undefined}
          proxima={ate < total ? urlAutomacoes(base, filtros, { pagina: filtros.pagina + 1 }) : undefined}
        />
        <ListaAutomacoes automacoes={automacoes} moverParaPasta={false} />
      </Pagina>
    </SelecaoAutomacoes>
  );
}
