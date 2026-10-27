import Link from "next/link";
import { redirect } from "next/navigation";
import { escaparBuscaIlike } from "@/src/lib/regras/busca";
import { lerFiltrosIntegracoes, ROTULO_PLATAFORMA, urlIntegracoes } from "@/src/lib/regras/integracoes";
import type { Provedor } from "@/src/lib/checkout/parsers";
import { permitido } from "@/src/lib/permissoes";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";
import { Abas } from "../_componentes/abas";
import { Icone } from "../_componentes/icone";
import { Paginacao } from "../_componentes/paginacao";
import { Pagina, Vazio } from "../_componentes/ui";
import { BotaoCriarWebhook, FiltrosIntegracoesBarra } from "./lista";

export const dynamic = "force-dynamic";

const POR_PAGINA = 12;

type IntegracaoLinha = { id: string; created_at: string; nome: string; plataforma: Provedor; arquivada: boolean };

/** Webhooks de checkout (entrada): abas Integrações/Arquivadas, ordenação, busca e um
 *  cartão `webhook` por integração (nome + plataforma) que abre o detalhe. Os webhooks de saída são os Hooks. */
export default async function Webhooks({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const b = await bloqueio("webhooks");
  if (b) return b;
  const f = lerFiltrosIntegracoes(await searchParams);
  const db = await dbUsuario();
  const podeEditar = await permitido("webhooks", "editar");
  const inicio = (f.pagina - 1) * POR_PAGINA;

  // Sem a coluna segredo (authenticated nem tem permissão de lê-la).
  let consulta = db.from("integracoes_checkout").select("id, created_at, nome, plataforma, arquivada", { count: "exact" }).eq("arquivada", f.aba === "arquivadas");
  if (f.q) consulta = consulta.or(`nome.ilike.${escaparBuscaIlike(f.q)}`);
  consulta = consulta.order("created_at", { ascending: f.ordem === "antigos" }).range(inicio, inicio + POR_PAGINA - 1);
  const { data, count, error } = await consulta;
  if (error) throw new Error(`Não foi possível carregar os webhooks: ${error.message}`);

  const itens = (data ?? []) as IntegracaoLinha[];
  const total = count ?? 0;
  if (!itens.length && f.pagina > 1) redirect(urlIntegracoes(f, { pagina: 1 }));
  const ate = inicio + itens.length;

  return (
    <Pagina acoes={<BotaoCriarWebhook podeEditar={podeEditar} />}>
      <Abas
        itens={[
          { href: urlIntegracoes(f, { aba: "ativas" }), rotulo: "Integrações", ativo: f.aba === "ativas" },
          { href: urlIntegracoes(f, { aba: "arquivadas" }), rotulo: "Arquivadas", ativo: f.aba === "arquivadas" },
        ]}
      />
      <FiltrosIntegracoesBarra filtros={f} />
      {itens.length === 0 ? (
        <div className="rounded-xl border border-vg-line">
          <Vazio texto="Nenhum registro encontrado" />
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {itens.map((i) => (
            <li key={i.id}>
              <Link
                href={`/webhooks/${i.id}`}
                className="flex items-center gap-3 rounded-xl border border-vg-line bg-vg-bg p-4 transition-colors hover:border-vg-line-2 hover:bg-white/[0.02]"
              >
                <Icone nome="webhook" tamanho={24} className="shrink-0 text-vg-accent" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold">{i.nome}</p>
                  <p className="truncate text-xs text-vg-muted">{ROTULO_PLATAFORMA[i.plataforma] ?? i.plataforma}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Paginacao
        de={total ? inicio + 1 : 0}
        ate={ate}
        total={total}
        porPagina={POR_PAGINA}
        anterior={f.pagina > 1 ? urlIntegracoes(f, { pagina: f.pagina - 1 }) : undefined}
        proxima={ate < total ? urlIntegracoes(f, { pagina: f.pagina + 1 }) : undefined}
      />
    </Pagina>
  );
}
