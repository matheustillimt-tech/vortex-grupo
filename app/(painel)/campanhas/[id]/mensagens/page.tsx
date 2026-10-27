import { redirect } from "next/navigation";
import { permitido } from "@/src/lib/permissoes";
import { textoEntrega, type PlacarEntrega } from "@/src/lib/regras/entregas";
import { ABAS_MENSAGENS, fimDoDiaIso, inicioDoDiaIso, lerAbaMensagens } from "@/src/lib/regras/abas-mensagens";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";
import { carregarAcoes, lerAgrupar } from "@/app/(painel)/_acoes/comum";
import { FiltrosAcoesBarra } from "@/app/(painel)/_acoes/filtros";
import { lerPorPaginaMensagens, POR_PAGINA_MENSAGENS, urlAcoes, type AcaoCartao, type FiltrosAcoes } from "@/app/(painel)/_acoes/tipos";
import { Icone } from "../../../_componentes/icone";
import { ListaAcoes } from "../../../_componentes/lista-acoes";
import { BotaoLink, Pagina } from "../../../_componentes/ui";

export const dynamic = "force-dynamic";

/** Seção "Confirmação de entrega" ligada: cada cartão de mensagem/enquete ganha a linha "Entrega confirmada: N/M
 *  grupos". Desligada (ou erro na leitura), os cartões ficam como antes. */
async function comEntrega(db: Awaited<ReturnType<typeof dbUsuario>>, campanhaId: string, linhas: AcaoCartao[]): Promise<AcaoCartao[]> {
  if (!linhas.length) return linhas;
  const { data: camp } = await db.from("campanhas").select("confirmar_entrega").eq("id", campanhaId).maybeSingle();
  if (!(camp as { confirmar_entrega?: boolean } | null)?.confirmar_entrega) return linhas;
  const ids = [...new Set(linhas.map((l) => l.execucaoId))];
  const { data, error } = await db.rpc("entregas_das_execucoes", { p_ids: ids });
  if (error) return linhas;
  const placar = new Map(((data ?? []) as (PlacarEntrega & { execucao_id: string })[]).map((p) => [p.execucao_id, p]));
  return linhas.map((l) => (l.tipo === "mensagem" || l.tipo === "enquete" ? { ...l, entrega: textoEntrega(placar.get(l.execucaoId)) } : l));
}

const dataValida = (v: string | undefined) => (inicioDoDiaIso(v) ? (v as string) : "");
const TIPOS_MENSAGENS = ["mensagem", "enquete"] as const;

export default async function Mensagens({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ aba?: string; agrupar?: string; inicio?: string; fim?: string; por?: string; pagina?: string }>;
}) {
  const b = await bloqueio("campanhas");
  if (b) return b;
  const { id } = await params;
  const sp = await searchParams;
  const podeEditar = await permitido("campanhas", "editar");

  const aba = lerAbaMensagens(sp.aba);
  const agrupar = lerAgrupar(sp.agrupar);
  const inicio = dataValida(sp.inicio);
  const fim = dataValida(sp.fim);
  const porPagina = lerPorPaginaMensagens(sp.por);
  const pagina = Math.max(1, Math.floor(Number(sp.pagina)) || 1);

  const filtros: FiltrosAcoes = { aba, tipos: [...TIPOS_MENSAGENS], agrupar, inicio, fim, por: porPagina, pagina };
  const url = (mudar: Partial<FiltrosAcoes>) => urlAcoes(`/campanhas/${id}/mensagens`, filtros, mudar);

  const db = await dbUsuario();
  const { linhas, totalAcoes } = await carregarAcoes(db, {
    campanhaId: id,
    tipos: [...TIPOS_MENSAGENS],
    aba,
    inicioIso: inicioDoDiaIso(inicio),
    fimIso: fimDoDiaIso(fim),
    porPagina,
    pagina,
    agrupar,
  });
  // Página além do fim (a lista encolheu): volta para a primeira, onde a paginação informa o total.
  if (!linhas.length && pagina > 1) redirect(url({ pagina: 1 }));
  const cartoes = await comEntrega(db, id, linhas);

  const de = totalAcoes ? (pagina - 1) * porPagina + 1 : 0;
  const ate = Math.min(pagina * porPagina, totalAcoes);

  return (
    <Pagina
      titulo="Mensagens"
      acoes={
        <>
          <BotaoLink href="/modelos" icone={<Icone nome="speaker_notes" tamanho={18} />}>MODELOS DE MENSAGENS</BotaoLink>
          {/* "MENSAGEM AUTOMATICA" abre o assistente de automação já com a campanha escolhida (começa em "Grupo"). */}
          <BotaoLink href={`/automacoes/nova?campanha=${id}`} icone={<Icone nome="forum" tamanho={18} />}>MENSAGEM AUTOMATICA</BotaoLink>
          {/* "Enviar mensagem" abre o assistente de ação já com a campanha e a ação escolhidas, em "Contas". */}
          {podeEditar && (
            <BotaoLink href={`/acoes/nova?campanha=${id}&acao=mensagem`} icone={<Icone nome="send" tamanho={18} />}>ENVIAR MENSAGEM</BotaoLink>
          )}
        </>
      }
    >
      <FiltrosAcoesBarra
        filtros={filtros}
        base={`/campanhas/${id}/mensagens`}
        tiposFixos={[...TIPOS_MENSAGENS]}
        abas={ABAS_MENSAGENS.map((a) => ({ href: url({ aba: a.valor }), rotulo: a.rotulo, ativo: a.valor === aba }))}
        paginacao={{ de, ate, total: totalAcoes, anterior: pagina > 1 ? url({ pagina: pagina - 1 }) : undefined, proxima: ate < totalAcoes ? url({ pagina: pagina + 1 }) : undefined }}
        pontas={false}
        opcoesPorPagina={POR_PAGINA_MENSAGENS}
      />
      <ListaAcoes acoes={cartoes} podeEditar={podeEditar} agrupar={agrupar} />
    </Pagina>
  );
}
