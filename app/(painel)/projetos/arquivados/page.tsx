import { redirect } from "next/navigation";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { Abas } from "../../_componentes/abas";
import { Paginacao } from "../../_componentes/paginacao";
import { Pagina } from "../../_componentes/ui";
import { ABAS_PROJETOS, carregarResumosProjetos, escaparBuscaProjeto, lerFiltrosProjetos, urlProjetos, type ProjetoLinha } from "../comum";
import { FiltrosProjetosBarra, ListaProjetos, OrdenacaoProjetos } from "../lista";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";

export const dynamic = "force-dynamic";

const POR_PAGINA = 12;
const COLUNAS = "id, created_at, nome, descricao, cor, arquivado, posicao";

export default async function ProjetosArquivados({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const b = await bloqueio("projetos");
  if (b) return b;
  const f = lerFiltrosProjetos(await searchParams);
  const db = await dbUsuario();
  const inicio = (f.pagina - 1) * POR_PAGINA;

  let consulta = db.from("projetos").select(COLUNAS, { count: "exact" }).eq("arquivado", true);
  if (f.q) {
    const v = escaparBuscaProjeto(f.q);
    consulta = consulta.or(`nome.ilike.${v},descricao.ilike.${v}`);
  }
  // "nome" não é único: "id" como critério de desempate (mesma regra de `/projetos`). "Posição" não tem as
  // setas "Mover" aqui (só pra Ativos), mas a ordenação em si vale igual, se algum arquivado tiver `posicao`.
  if (f.ordem === "alfabetica") consulta = consulta.order("nome", { ascending: true }).order("id");
  else if (f.ordem === "posicao") consulta = consulta.order("posicao", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false });
  else consulta = consulta.order("created_at", { ascending: false });
  consulta = consulta.range(inicio, inicio + POR_PAGINA - 1);

  const { data, count, error } = await consulta;
  if (error) throw new Error(`Não foi possível carregar os projetos arquivados: ${error.message}`);

  const itens = (data ?? []) as ProjetoLinha[];
  const total = count ?? 0;
  if (!itens.length && f.pagina > 1) redirect(urlProjetos("/projetos/arquivados", f, { pagina: 1 }));

  const resumos = await carregarResumosProjetos(db, itens.map((p) => p.id));
  const ate = inicio + itens.length;

  return (
    <Pagina titulo="Projetos" infoTitulo={<OrdenacaoProjetos filtros={f} base="/projetos/arquivados" />}>
      <Abas itens={ABAS_PROJETOS} />
      <FiltrosProjetosBarra filtros={f} base="/projetos/arquivados" />
      <ListaProjetos projetos={itens} resumos={resumos} />
      <Paginacao
        de={total ? inicio + 1 : 0}
        ate={ate}
        total={total}
        porPagina={POR_PAGINA}
        anterior={f.pagina > 1 ? urlProjetos("/projetos/arquivados", f, { pagina: f.pagina - 1 }) : undefined}
        proxima={ate < total ? urlProjetos("/projetos/arquivados", f, { pagina: f.pagina + 1 }) : undefined}
      />
    </Pagina>
  );
}
