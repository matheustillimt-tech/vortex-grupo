import { bloqueio } from "@/app/(painel)/_componentes/guarda";
import { permitido } from "@/src/lib/permissoes";
import { contaDesatualizada, dataHoraCompleta, deslocamentoDaPagina, POR_PAGINA_DIAGNOSTICOS } from "@/src/lib/regras/analises";
import { formatarTelefone } from "@/src/lib/regras/inicio";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { CampoBusca } from "../../../_componentes/campo-busca";
import { Cartao, estiloBotao, Pagina, Vazio } from "../../../_componentes/ui";
import { Paginacao } from "../../../_componentes/paginacao";
import { VerificarBotao } from "./verificar-botao";
import { VerificarTodas } from "./verificar-todas";

export const dynamic = "force-dynamic";

type Linha = {
  conexao_id: string;
  nome: string;
  telefone: string | null;
  total_grupos: number;
  admin_grupos: number;
  donos: number;
  criadora: boolean;
  ultima_conferencia: string | null;
  algum_pendente: boolean;
  total: number;
};

/** Aba Diagnósticos: "Compatibilidade de contas" — por conta associada à campanha, em
 *  quantos dos grupos ativos dela a conta é admin, com o botão de conferência imediata por conta. */
export default async function Diagnosticos({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; pagina?: string }>;
}) {
  const b = await bloqueio("campanhas");
  if (b) return b;
  const podeEditar = await permitido("campanhas", "editar");
  const { id } = await params;
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 60);
  const pagina = Math.max(1, Math.floor(Number(sp.pagina)) || 1);
  const de = deslocamentoDaPagina(pagina, POR_PAGINA_DIAGNOSTICOS);

  const db = await dbUsuario();
  const { data, error } = await db.rpc("diagnostico_contas", { p_campanha: id, p_busca: q || null, p_limite: POR_PAGINA_DIAGNOSTICOS, p_deslocamento: de });
  if (error) throw new Error("Não foi possível carregar o diagnóstico das conexões.");

  const lista = ((data ?? []) as Linha[]).map((l) => ({
    ...l, total_grupos: Number(l.total_grupos), admin_grupos: Number(l.admin_grupos), donos: Number(l.donos ?? 0), total: Number(l.total),
  }));
  const total = lista[0]?.total ?? 0;
  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA_DIAGNOSTICOS));

  const url = (p: number) => {
    const sb = new URLSearchParams();
    if (q) sb.set("q", q);
    if (p > 1) sb.set("pagina", String(p));
    const s = sb.toString();
    return `/campanhas/${id}/diagnosticos${s ? `?${s}` : ""}`;
  };

  return (
    <Pagina titulo="Diagnósticos">
      <Cartao
        titulo="Compatibilidade de conexões"
        acao={podeEditar ? <VerificarTodas campanhaId={id} conexaoIds={lista.map((l) => l.conexao_id)} /> : undefined}
      >
        <form method="get" className="mb-4">
          <CampoBusca nome="q" valorInicial={q} rotulo="Buscar conexão" className="w-full max-w-sm" />
        </form>
        <p className="mb-3 text-sm text-vg-muted">{total}/{total} conexão{total === 1 ? "" : "s"}</p>
        {lista.length === 0 ? (
          <Vazio texto={q ? "Nenhuma conexão encontrada" : "Nenhuma conexão associada a esta campanha"} />
        ) : (
          <div className="space-y-3">
            {lista.map((l) => {
              const desatualizada = contaDesatualizada(l.ultima_conferencia, l.algum_pendente);
              return (
                <div key={l.conexao_id} className="rounded-lg border border-vg-line p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[15px] font-medium">{l.nome}</p>
                      {l.telefone && <p className="text-sm text-vg-muted">{formatarTelefone(l.telefone)}</p>}
                      <p className="mt-1 text-xs text-vg-text-3">{l.criadora ? "Cria os grupos" : "Conexão associada (reserva)"} · dona de {l.donos} grupo{l.donos === 1 ? "" : "s"}</p>
                      <p className={`text-sm ${l.admin_grupos < l.total_grupos ? "text-vg-erro" : "text-vg-text"}`}>
                        É admin de <span className="tabular-nums">{l.admin_grupos}</span> / <span className="tabular-nums">{l.total_grupos}</span> Grupos
                        {l.admin_grupos < l.total_grupos && " · falta ser admin de alguns: sem contingência neles"}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-start gap-2">
                      <a href={`/api/exportar/diagnostico?campanha=${id}&conta=${l.conexao_id}`} className={estiloBotao("secundario")}>
                        Exportar CSV
                      </a>
                      {podeEditar && <VerificarBotao campanhaId={id} conexaoId={l.conexao_id} />}
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-vg-muted">
                    {l.donos === 0 ? (
                      "Não é dona de nenhum grupo: a contagem vem da conferência das outras conexões"
                    ) : l.algum_pendente ? (
                      "Conferindo os grupos agora (leva até 2 minutos)"
                    ) : (
                      <>
                        Última atualização {dataHoraCompleta(l.ultima_conferencia!)}
                        {desatualizada && " · Talvez desatualizado"}
                      </>
                    )}
                  </p>
                </div>
              );
            })}
          </div>
        )}
        {total > 0 && (
          <div className="mt-3">
            <Paginacao
              de={de + 1}
              ate={Math.min(de + POR_PAGINA_DIAGNOSTICOS, total)}
              total={total}
              porPagina={POR_PAGINA_DIAGNOSTICOS}
              anterior={pagina > 1 ? url(pagina - 1) : undefined}
              proxima={pagina < totalPaginas ? url(pagina + 1) : undefined}
              primeira={pagina > 1 ? url(1) : undefined}
              ultima={pagina < totalPaginas ? url(totalPaginas) : undefined}
            />
          </div>
        )}
      </Cartao>
    </Pagina>
  );
}
