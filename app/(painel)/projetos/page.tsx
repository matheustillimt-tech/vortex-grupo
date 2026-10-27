import { redirect } from "next/navigation";
import { algumTemPosicao, ordenarPorPosicao } from "@/src/lib/regras/projetos";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { Abas } from "../_componentes/abas";
import { Paginacao } from "../_componentes/paginacao";
import { Pagina } from "../_componentes/ui";
import { ABAS_PROJETOS, carregarResumosProjetos, escaparBuscaProjeto, lerFiltrosProjetos, urlProjetos, type ProjetoLinha } from "./comum";
import { BotaoNovoProjeto, FiltrosProjetosBarra, ListaProjetos, OrdenacaoProjetos } from "./lista";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";

export const dynamic = "force-dynamic";

const POR_PAGINA = 12;
const COLUNAS = "id, created_at, nome, descricao, cor, arquivado, posicao";

export default async function Projetos({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const b = await bloqueio("projetos");
  if (b) return b;
  const db = await dbUsuario();

  // "Posição" (Etapa 3N Task 7): padrão quando algum projeto ativo já tem `posicao`; consulta leve, uma vez por
  // página (nunca por linha). Também dá a ordem global pras setas "Mover para cima"/"Mover para baixo".
  const { data: posicoesAtivas, error: erroPosicoes } = await db.from("projetos").select("id, posicao, created_at").eq("arquivado", false);
  if (erroPosicoes) throw new Error(`Não foi possível carregar os projetos: ${erroPosicoes.message}`);
  const ordemGlobal = ordenarPorPosicao((posicoesAtivas ?? []) as { id: string; posicao: number | null; created_at: string }[]).map((p) => p.id);
  const f = lerFiltrosProjetos(await searchParams, algumTemPosicao(posicoesAtivas ?? []) ? "posicao" : "criacao");
  const inicio = (f.pagina - 1) * POR_PAGINA;

  let consulta = db.from("projetos").select(COLUNAS, { count: "exact" }).eq("arquivado", false);
  if (f.q) {
    const v = escaparBuscaProjeto(f.q);
    consulta = consulta.or(`nome.ilike.${v},descricao.ilike.${v}`);
  }
  // "nome" não é único (dois projetos podem ter o mesmo nome): "id" como critério de desempate, senão a
  // paginação pode repetir ou pular um projeto entre páginas quando o banco devolve a ordem diferente.
  if (f.ordem === "alfabetica") consulta = consulta.order("nome", { ascending: true }).order("id");
  else if (f.ordem === "posicao") consulta = consulta.order("posicao", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false });
  else consulta = consulta.order("created_at", { ascending: false });
  consulta = consulta.range(inicio, inicio + POR_PAGINA - 1);

  const { data, count, error } = await consulta;
  if (error) throw new Error(`Não foi possível carregar os projetos: ${error.message}`);

  const itens = (data ?? []) as ProjetoLinha[];
  const total = count ?? 0;
  if (!itens.length && f.pagina > 1) redirect(urlProjetos("/projetos", f, { pagina: 1 }));

  const resumos = await carregarResumosProjetos(db, itens.map((p) => p.id));
  const ate = inicio + itens.length;

  return (
    <Pagina titulo="Projetos" trilha={[{ rotulo: "Campanhas", href: "/campanhas" }]} infoTitulo={<OrdenacaoProjetos filtros={f} base="/projetos" />} acoes={<BotaoNovoProjeto />}>
      <Abas itens={ABAS_PROJETOS} />
      <FiltrosProjetosBarra filtros={f} base="/projetos" />
      <ListaProjetos projetos={itens} resumos={resumos} ordemGlobal={ordemGlobal} />
      <Paginacao
        de={total ? inicio + 1 : 0}
        ate={ate}
        total={total}
        porPagina={POR_PAGINA}
        anterior={f.pagina > 1 ? urlProjetos("/projetos", f, { pagina: f.pagina - 1 }) : undefined}
        proxima={ate < total ? urlProjetos("/projetos", f, { pagina: f.pagina + 1 }) : undefined}
      />
    </Pagina>
  );
}
