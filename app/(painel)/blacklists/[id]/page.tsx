import { notFound, redirect } from "next/navigation";
import { permitido } from "@/src/lib/permissoes";
import { ehUuid } from "@/src/lib/regras/uuid";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { Pagina } from "../../_componentes/ui";
import { NumerosBlacklist, type NumeroLinha } from "./numeros";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";

export const dynamic = "force-dynamic";

const POR_PAGINA = 50;

function url(id: string, busca: string | null, pagina: number): string {
  const q = new URLSearchParams();
  if (busca) q.set("q", busca);
  if (pagina > 1) q.set("pagina", String(pagina));
  const s = q.toString();
  return s ? `/blacklists/${id}?${s}` : `/blacklists/${id}`;
}

/** Uma blacklist aberta: números (colar vários, remover, exportar CSV). */
export default async function Blacklist({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string; pagina?: string }> }) {
  const b = await bloqueio("antispam");
  if (b) return b;
  const { id } = await params;
  if (!ehUuid(id)) notFound();
  const sp = await searchParams;
  const busca = typeof sp.q === "string" ? sp.q.replace(/\D/g, "").slice(0, 15) || null : null;
  const paginaBruta = Number(sp.pagina);
  const pagina = Number.isInteger(paginaBruta) && paginaBruta > 0 && paginaBruta < 100_000 ? paginaBruta : 1;
  const inicio = (pagina - 1) * POR_PAGINA;

  const db = await dbUsuario();
  const { data: lista, error: erroLista } = await db.from("blacklists").select("id, nome, ativa").eq("id", id).maybeSingle();
  if (erroLista) throw new Error(`Não foi possível carregar a blacklist: ${erroLista.message}`);
  if (!lista) notFound();
  const l = lista as { id: string; nome: string; ativa: boolean };

  let consulta = db.from("blacklist_numeros").select("telefone, created_at").eq("blacklist_id", id);
  let contagem = db.from("blacklist_numeros").select("telefone", { count: "exact", head: true }).eq("blacklist_id", id);
  if (busca) {
    consulta = consulta.ilike("telefone", `%${busca}%`);
    contagem = contagem.ilike("telefone", `%${busca}%`);
  }
  const [{ data, error }, { count }, podeEditar] = await Promise.all([
    consulta.order("created_at", { ascending: false }).order("telefone", { ascending: true }).range(inicio, inicio + POR_PAGINA - 1),
    contagem,
    permitido("antispam", "editar"),
  ]);
  if (error) throw new Error(`Não foi possível carregar os números: ${error.message}`);
  const itens = (data ?? []) as NumeroLinha[];
  const total = count ?? 0;
  if (!itens.length && pagina > 1) redirect(url(id, busca, 1));
  const ate = inicio + itens.length;

  return (
    <Pagina
      titulo={l.nome}
      trilha={[{ rotulo: "Blacklists", href: "/blacklists" }, { rotulo: l.nome }]}
      subtitulo={`${total.toLocaleString("pt-BR")} número${total === 1 ? "" : "s"} · ${l.ativa ? "ativa (conta como bloqueado)" : "inativa (não bloqueia)"}`}
    >
      <NumerosBlacklist
        id={id}
        itens={itens}
        busca={busca}
        podeEditar={podeEditar}
        ativa={l.ativa}
        paginacao={{
          de: total ? inicio + 1 : 0,
          ate,
          total,
          porPagina: POR_PAGINA,
          anterior: pagina > 1 ? url(id, busca, pagina - 1) : undefined,
          proxima: ate < total ? url(id, busca, pagina + 1) : undefined,
        }}
      />
    </Pagina>
  );
}
