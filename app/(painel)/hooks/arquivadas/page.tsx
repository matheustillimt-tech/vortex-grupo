import { redirect } from "next/navigation";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { Abas } from "../../_componentes/abas";
import { Paginacao } from "../../_componentes/paginacao";
import { Pagina } from "../../_componentes/ui";
import { ABAS_HOOKS, TEXTO_HOOKS, carregarEntregas, escaparBuscaWebhook, lerFiltrosWebhooks, urlWebhooks, type WebhookLinha } from "../comum";
import { FiltrosWebhooksBarra, ListaWebhooks } from "../lista";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";

export const dynamic = "force-dynamic";

const POR_PAGINA = 12;
const COLUNAS = "id, created_at, nome, url, eventos, campanhas, ativo, arquivado";

export default async function HooksArquivados({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const b = await bloqueio("webhooks");
  if (b) return b;
  const f = lerFiltrosWebhooks(await searchParams);
  const db = await dbUsuario();
  const inicio = (f.pagina - 1) * POR_PAGINA;

  let consulta = db.from("webhooks").select(COLUNAS, { count: "exact" }).eq("arquivado", true);
  if (f.q) {
    const v = escaparBuscaWebhook(f.q);
    consulta = consulta.or(`nome.ilike.${v},url.ilike.${v}`);
  }
  consulta = consulta.order("created_at", { ascending: f.ordem === "antigos" }).range(inicio, inicio + POR_PAGINA - 1);

  const { data, count, error } = await consulta;
  if (error) throw new Error(`Não foi possível carregar os hooks arquivados: ${error.message}`);

  const itens = (data ?? []) as WebhookLinha[];
  const total = count ?? 0;
  if (!itens.length && f.pagina > 1) redirect(urlWebhooks("/hooks/arquivadas", f, { pagina: 1 }));

  const entregasPorId = await carregarEntregas(db, itens.map((w) => w.id));
  const ate = inicio + itens.length;

  return (
    <Pagina titulo="Arquivados" subtitulo={TEXTO_HOOKS}>
      <Abas itens={ABAS_HOOKS.map((a) => ({ ...a, ativo: false }))} />
      <FiltrosWebhooksBarra filtros={f} base="/hooks/arquivadas" />
      <ListaWebhooks webhooks={itens} entregasPorId={entregasPorId} />
      <Paginacao
        de={total ? inicio + 1 : 0}
        ate={ate}
        total={total}
        porPagina={POR_PAGINA}
        anterior={f.pagina > 1 ? urlWebhooks("/hooks/arquivadas", f, { pagina: f.pagina - 1 }) : undefined}
        proxima={ate < total ? urlWebhooks("/hooks/arquivadas", f, { pagina: f.pagina + 1 }) : undefined}
      />
    </Pagina>
  );
}
