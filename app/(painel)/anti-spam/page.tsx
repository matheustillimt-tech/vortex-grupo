import { redirect } from "next/navigation";
import { filtrosBloqueadosParaQuery, lerFiltrosBloqueados, urlBloqueados } from "@/src/lib/regras/filtros-bloqueados";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { Abas } from "../_componentes/abas";
import { Pagina } from "../_componentes/ui";
import { ABAS_ANTISPAM } from "./comum";
import { FiltrosBloqueadosBarra } from "./filtros";
import { BarraAcoesBloqueados, ProvedorBloqueados, TabelaBloqueados, type BloqueadoLinha } from "./lista";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";

export const dynamic = "force-dynamic";

const POR_PAGINA = 50;

export default async function AntiSpam({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const b = await bloqueio("antispam");
  if (b) return b;
  const f = lerFiltrosBloqueados(await searchParams);
  const db = await dbUsuario();
  const inicio = (f.pagina - 1) * POR_PAGINA;

  let consulta = db.from("bloqueados").select("telefone, nome, motivo, origem, created_at, lid, golpista");
  let contagem = db.from("bloqueados").select("telefone", { count: "exact", head: true });
  if (f.busca) {
    consulta = consulta.ilike("telefone", `%${f.busca}%`);
    contagem = contagem.ilike("telefone", `%${f.busca}%`);
  }
  if (f.inicio) {
    consulta = consulta.gte("created_at", `${f.inicio}T00:00:00-03:00`);
    contagem = contagem.gte("created_at", `${f.inicio}T00:00:00-03:00`);
  }
  if (f.fim) {
    consulta = consulta.lte("created_at", `${f.fim}T23:59:59-03:00`);
    contagem = contagem.lte("created_at", `${f.fim}T23:59:59-03:00`);
  }
  // created_at vem de inserções em lote (mesmo now() da transação): sem uma segunda coluna única, a
  // paginação por offset pode pular ou repetir linha com o mesmo timestamp entre páginas.
  consulta = consulta
    .order("created_at", { ascending: f.ordem === "antigos" })
    .order("telefone", { ascending: true })
    .range(inicio, inicio + POR_PAGINA - 1);

  const [{ data, error }, { count }] = await Promise.all([consulta, contagem]);
  if (error) throw new Error(`Não foi possível carregar os bloqueados: ${error.message}`);
  const itens = (data ?? []) as BloqueadoLinha[];
  const total = count ?? 0;
  // Página além do fim (a lista encolheu): volta pra primeira.
  if (!itens.length && f.pagina > 1) redirect(urlBloqueados(f, { pagina: 1 }));

  const ate = inicio + itens.length;
  const qExportar = filtrosBloqueadosParaQuery({ ...f, pagina: 1 });
  const exportarHref = qExportar ? `/api/exportar/bloqueados?${qExportar}` : "/api/exportar/bloqueados";

  return (
    <ProvedorBloqueados itens={itens}>
      <Pagina titulo="Anti-spam" subtitulo={`${total.toLocaleString("pt-BR")} bloqueado${total === 1 ? "" : "s"}`}>
        <Abas itens={ABAS_ANTISPAM} />
        <h2 className="text-[15px] font-medium text-vg-text">Números bloqueados</h2>
        {/* Ordem da tela: botões acima da busca. */}
        <BarraAcoesBloqueados exportarHref={exportarHref} />
        <FiltrosBloqueadosBarra filtros={f} />
        <TabelaBloqueados
          total={total}
          de={total ? inicio + 1 : 0}
          ate={ate}
          porPagina={POR_PAGINA}
          anterior={f.pagina > 1 ? urlBloqueados(f, { pagina: f.pagina - 1 }) : undefined}
          proxima={ate < total ? urlBloqueados(f, { pagina: f.pagina + 1 }) : undefined}
        />
      </Pagina>
    </ProvedorBloqueados>
  );
}
