import { redirect } from "next/navigation";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { Abas } from "../_componentes/abas";
import { Icone } from "../_componentes/icone";
import { Paginacao } from "../_componentes/paginacao";
import { BotaoLink, Pagina } from "../_componentes/ui";
import { ABAS_AUTOMACOES, lerFiltrosAutomacoes, urlAutomacoes } from "./abas";
import { carregarAutomacoes, carregarCampanhasParaImportar, POR_PAGINA_AUTOMACOES } from "./comum";
import { BotaoImportarJson, BotaoPasta, FiltrosAutomacoes, ListaAutomacoes, SelecaoAutomacoes } from "./lista";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";

export const dynamic = "force-dynamic";

export default async function Automacoes({ searchParams }: {
  searchParams: Promise<{ q?: string; gatilho?: string; provedor?: string; pasta?: string; estado?: string; pagina?: string }>;
}) {
  const b = await bloqueio("automacoes");
  if (b) return b;
  const filtros = lerFiltrosAutomacoes(await searchParams);
  const db = await dbUsuario();

  const { automacoes, pastas, total } = await carregarAutomacoes(db, { filtros });
  const campanhasImportar = await carregarCampanhasParaImportar(db);
  // Página além do fim (a lista encolheu): volta pra primeira.
  if (!automacoes.length && filtros.pagina > 1) redirect(urlAutomacoes("/automacoes", filtros, { pagina: 1 }));

  const inicio = (filtros.pagina - 1) * POR_PAGINA_AUTOMACOES;
  const de = total ? inicio + 1 : 0;
  const ate = inicio + automacoes.length;

  return (
    <SelecaoAutomacoes ids={automacoes.map((a) => a.id)}>
      <Pagina
        titulo="Automações"
        acoes={
          <>
            <BotaoPasta pastas={pastas} filtros={filtros} />
            <BotaoLink href="/automacoes/nova" icone={<Icone nome="add" />}>ADICIONAR</BotaoLink>
            <BotaoImportarJson campanhas={campanhasImportar} />
          </>
        }
      >
        <Abas itens={ABAS_AUTOMACOES} />
        <FiltrosAutomacoes filtros={filtros} pastas={pastas} />
        <Paginacao
          de={de}
          ate={ate}
          total={total}
          porPagina={POR_PAGINA_AUTOMACOES}
          anterior={filtros.pagina > 1 ? urlAutomacoes("/automacoes", filtros, { pagina: filtros.pagina - 1 }) : undefined}
          proxima={ate < total ? urlAutomacoes("/automacoes", filtros, { pagina: filtros.pagina + 1 }) : undefined}
          pontas={false}
        />
        <ListaAutomacoes automacoes={automacoes} />
      </Pagina>
    </SelecaoAutomacoes>
  );
}
