import { redirect } from "next/navigation";
import { nomeGeradaPor } from "@/src/lib/exportacoes";
import { permitido } from "@/src/lib/permissoes";
import { isoParaBrasilia } from "@/src/lib/regras/horario";
import { AJUDA_CANCELADA, ROTULO_DECISAO, ROTULO_ORIGEM, condicaoFiltroHistorico, lerFiltroHistorico } from "@/src/lib/regras/solicitacoes";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { mascararTelefone, normalizarTelefone, telefoneLegivel, variantesTelefone } from "@/src/lib/telefone";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";
import { CampoBusca } from "../../../../_componentes/campo-busca";
import { Icone } from "../../../../_componentes/icone";
import { Paginacao } from "../../../../_componentes/paginacao";
import { Pagina, Selo, Tabela, estiloBotao } from "../../../../_componentes/ui";
import { AbasSolicitacoes } from "../abas";
import { FiltrosHistorico } from "./filtros";

export const dynamic = "force-dynamic";

const POR_PAGINA = 25;

type Linha = {
  id: string;
  created_at: string;
  grupo_nome: string | null;
  telefone: string;
  decisao: string;
  origem: string;
  motivo: string | null;
  decidida_por: string | null;
  resultado: string;
  erro: string | null;
};

/** Aba "Solicitações de entrada" › Processadas: o "Histórico de solicitações" (`solicitacoes_entrada`: manual,
 *  automática, por tag e pelo WhatsApp), 25 por página, com filtros de status (`?status=`). Número
 *  inteiro só para quem tem Leads/ver (senão mascarado, sem busca nem CSV). */
export default async function SolicitacoesProcessadas({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; pagina?: string; status?: string }>;
}) {
  const b = await bloqueio("campanhas");
  if (b) return b;
  const { id } = await params;
  const sp = await searchParams;
  const verLeads = await permitido("leads", "ver");
  const q = verLeads ? (sp.q ?? "").trim() : "";
  const pagina = Math.max(1, Math.floor(Number(sp.pagina)) || 1);
  const status = lerFiltroHistorico(sp.status);
  const cond = condicaoFiltroHistorico(status);
  const inicio = (pagina - 1) * POR_PAGINA;
  const digitos = q.replace(/\D/g, "");
  const variantes = digitos ? [...new Set([...variantesTelefone(digitos), ...variantesTelefone(normalizarTelefone(digitos) ?? digitos)])] : [];

  const db = await dbUsuario();
  let consulta = db
    .from("solicitacoes_entrada")
    .select("id, created_at, grupo_nome, telefone, decisao, origem, motivo, decidida_por, resultado, erro", { count: "exact" })
    .eq("campanha_id", id);
  if (cond.decisao) consulta = consulta.eq("decisao", cond.decisao);
  if (cond.resultado) consulta = consulta.eq("resultado", cond.resultado);
  if (variantes.length) consulta = consulta.in("telefone", variantes);
  const { data, count, error } = await consulta.order("created_at", { ascending: false }).range(inicio, inicio + POR_PAGINA - 1);
  if (error) throw new Error(`Não foi possível carregar as solicitações processadas: ${error.message}`);
  const linhas = (data ?? []) as Linha[];
  const total = count ?? 0;

  const url = (p: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status !== "todas") params.set("status", status);
    if (p > 1) params.set("pagina", String(p));
    const s = params.toString();
    return `/campanhas/${id}/solicitacoes/processadas${s ? `?${s}` : ""}`;
  };
  if (!linhas.length && pagina > 1) redirect(url(1));

  // `membros` só deixa ler a própria linha pelo RLS: os nomes vêm pelo serviço (só nome, nada mais).
  const ids = [...new Set(linhas.map((l) => l.decidida_por).filter((x): x is string => !!x))];
  const nomes = new Map<string, string>();
  if (ids.length) {
    const { data: membros } = await dbAdmin().from("membros").select("usuario_id, nome").in("usuario_id", ids);
    for (const m of (membros ?? []) as { usuario_id: string; nome: string }[]) nomes.set(m.usuario_id, m.nome);
  }
  const ate = inicio + linhas.length;

  return (
    <Pagina titulo="Solicitações de entrada">
      <AbasSolicitacoes campanhaId={id} />
      <h2 className="text-lg font-normal">Histórico de solicitações</h2>
      <FiltrosHistorico base={`/campanhas/${id}/solicitacoes/processadas`} atual={status} busca={q} pagina={pagina} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        {verLeads ? (
          <form method="get" className="w-full max-w-md space-y-1">
            {status !== "todas" && <input type="hidden" name="status" value={status} />}
            <CampoBusca valorInicial={q} rotulo="Buscar número" rotuloVisivel="Buscar número" inputMode="numeric" />
            <p className="text-xs text-vg-text-3">Busca pelo número completo do participante</p>
          </form>
        ) : (
          <span />
        )}
        {verLeads && (
          <a href={`/api/exportar/solicitacoes?campanha=${encodeURIComponent(id)}${status !== "todas" ? `&status=${status}` : ""}`} className={estiloBotao("secundario")}>
            <Icone nome="cloud_download" tamanho={18} /> CSV
          </a>
        )}
      </div>
      <Tabela colunas={["Número", "Grupo", "Decisão", "Origem", "Por", "Data"]} vazio={linhas.length ? undefined : q ? "Nenhuma solicitação com esse número." : status !== "todas" ? "Nenhuma solicitação com esse status." : "Nenhuma solicitação processada ainda."}>
        {linhas.map((l) => (
          <tr key={l.id}>
            <td className="px-3 py-2.5 tabular-nums">{verLeads ? telefoneLegivel(l.telefone) : (mascararTelefone(l.telefone) ?? "••••")}</td>
            <td className="px-3 py-2.5 text-vg-text-2">{l.grupo_nome ?? "—"}</td>
            <td className="px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <Selo cor={l.resultado === "erro" ? "erro" : l.decisao === "aprovada" ? "ok" : l.decisao === "expirada" ? "aviso" : "neutro"}>{ROTULO_DECISAO[l.decisao] ?? l.decisao}</Selo>
                {l.resultado === "erro" && <Selo cor="erro" semPonto>Erro</Selo>}
                {l.motivo === "Aprovação por tag" && <Selo cor="destaque" semPonto>Por tag</Selo>}
                {l.origem === "whatsapp" && l.decisao === "aprovada" && <Selo cor="neutro" semPonto>Aprovada pelo celular</Selo>}
              </div>
              {l.resultado === "erro" && <p className="mt-1 max-w-xs text-xs text-vg-erro">{l.erro ?? "Erro"}</p>}
              {l.decisao === "cancelada" && <p className="mt-1 max-w-xs text-xs text-vg-text-3">{AJUDA_CANCELADA}</p>}
              {l.decisao === "expirada" && l.motivo && <p className="mt-1 max-w-xs text-xs text-vg-text-3">{l.motivo}</p>}
            </td>
            <td className="px-3 py-2.5">
              <Selo cor="neutro" semPonto>{ROTULO_ORIGEM[l.origem] ?? l.origem}</Selo>
            </td>
            <td className="px-3 py-2.5 text-vg-text-2">{l.origem === "automatica" ? "Vórtex Grupo" : l.origem === "whatsapp" ? "WhatsApp" : l.decidida_por ? nomeGeradaPor(nomes.get(l.decidida_por), null) : "—"}</td>
            <td className="px-3 py-2.5 tabular-nums text-vg-text-2">{isoParaBrasilia(l.created_at)}</td>
          </tr>
        ))}
      </Tabela>
      <Paginacao
        de={total ? inicio + 1 : 0}
        ate={ate}
        total={total}
        porPagina={POR_PAGINA}
        primeira={pagina > 1 ? url(1) : undefined}
        anterior={pagina > 1 ? url(pagina - 1) : undefined}
        proxima={ate < total ? url(pagina + 1) : undefined}
      />
    </Pagina>
  );
}
