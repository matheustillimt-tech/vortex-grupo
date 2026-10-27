import { redirect } from "next/navigation";
import { env } from "@/src/lib/env";
import { filtrarDeeplinks, pastasDeDeeplinks, type DeeplinkLista } from "@/src/lib/regras/deeplinks";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { Paginacao } from "../_componentes/paginacao";
import { Pagina } from "../_componentes/ui";
import { lerFiltrosDeeplinks, urlDeeplinks } from "./filtros";
import {
  BarraEmMassaDeeplinks,
  BotaoNovaPasta,
  BotaoNovoDeeplink,
  FaixaPastas,
  FiltrosDeeplinksBarra,
  ListaDeeplinks,
  OrdenacaoDeeplinks,
  ProvedorDeeplinks,
  type DeeplinkCartao,
} from "./lista";
import { BotaoPesquisarUrl } from "./pesquisar-url";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";

export const dynamic = "force-dynamic";

const POR_PAGINA = 12;
/** Teto de deep links lidos de uma vez (busca, pastas e ordenação são feitas aqui, em memória — igual modelos). */
const MAXIMO = 1000;
const COLUNAS = "id, created_at, nome, destino, slug, pasta, cliques";

const paraCartao = (d: DeeplinkLista): DeeplinkCartao => ({ id: d.id, nome: d.nome, destino: d.destino, slug: d.slug, pasta: d.pasta, cliques: d.cliques });

export default async function Deeplinks({ searchParams }: { searchParams: Promise<{ q?: string; pasta?: string; ordem?: string; pagina?: string }> }) {
  const b = await bloqueio("campanhas");
  if (b) return b;
  const filtros = lerFiltrosDeeplinks(await searchParams);
  const db = await dbUsuario();
  const { data, error } = await db.from("deeplinks").select(COLUNAS).order("created_at", { ascending: false }).limit(MAXIMO);
  if (error) throw new Error(`Não foi possível carregar os deep links: ${error.message}`);

  const todos = (data ?? []) as DeeplinkLista[];
  const pastas = pastasDeDeeplinks(todos);
  const filtrados = filtrarDeeplinks(todos, { busca: filtros.q, pasta: filtros.pasta, ordem: filtros.ordem });
  const total = filtrados.length;
  const inicio = (filtros.pagina - 1) * POR_PAGINA;
  const daPagina = filtrados.slice(inicio, inicio + POR_PAGINA);
  // Página além do fim (a lista encolheu): volta pra primeira.
  if (!daPagina.length && filtros.pagina > 1) redirect(urlDeeplinks(filtros, { pagina: 1 }));

  const de = total ? inicio + 1 : 0;
  const ate = inicio + daPagina.length;
  const base = env("NEXT_PUBLIC_SITE_URL");

  return (
    <ProvedorDeeplinks ids={daPagina.map((d) => d.id)} pastasBanco={pastas.map((p) => p.nome)}>
      <Pagina
        acoes={
          <>
            <BotaoPesquisarUrl filtros={filtros} />
            <BotaoNovaPasta />
            <BotaoNovoDeeplink pastaAtual={filtros.pasta} />
          </>
        }
      >
        <FaixaPastas pastas={pastas} filtros={filtros} />
        {/* Ordem da tela: busca → barra em massa → ordenação → paginação. */}
        <FiltrosDeeplinksBarra filtros={filtros} />
        <BarraEmMassaDeeplinks deeplinks={daPagina.map(paraCartao)} />
        <div className="flex justify-end">
          <OrdenacaoDeeplinks filtros={filtros} />
        </div>
        <Paginacao
          de={de}
          ate={ate}
          total={total}
          porPagina={POR_PAGINA}
          anterior={filtros.pagina > 1 ? urlDeeplinks(filtros, { pagina: filtros.pagina - 1 }) : undefined}
          proxima={ate < total ? urlDeeplinks(filtros, { pagina: filtros.pagina + 1 }) : undefined}
        />
        <ListaDeeplinks deeplinks={daPagina.map(paraCartao)} base={base} />
        {todos.length >= MAXIMO && <p className="px-1 text-xs text-vg-text-3">Mostrando os {MAXIMO} deep links mais recentes.</p>}
      </Pagina>
    </ProvedorDeeplinks>
  );
}
