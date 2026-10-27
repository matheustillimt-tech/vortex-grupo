import { redirect } from "next/navigation";
import { permitido } from "@/src/lib/permissoes";
import { ABAS_MENSAGENS, fimDoDiaIso, inicioDoDiaIso, lerAbaMensagens } from "@/src/lib/regras/abas-mensagens";
import { filtroTipos } from "@/src/lib/regras/acoes";
import { avisoCriada } from "@/src/lib/regras/assistente-acao";
import { TIPOS_EXECUCAO } from "@/src/lib/regras/conteudo";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";
import { carregarAcoes, lerAgrupar, lerPorPagina } from "@/app/(painel)/_acoes/comum";
import { FiltrosAcoesBarra } from "@/app/(painel)/_acoes/filtros";
import { urlAcoes, type FiltrosAcoes } from "@/app/(painel)/_acoes/tipos";
import { Icone } from "../../../_componentes/icone";
import { ListaAcoes } from "../../../_componentes/lista-acoes";
import { BotaoLink, Pagina } from "../../../_componentes/ui";

export const dynamic = "force-dynamic";

const dataValida = (v: string | undefined) => (inicioDoDiaIso(v) ? (v as string) : "");

export default async function AcoesCampanha({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ aba?: string; tipos?: string; agrupar?: string; inicio?: string; fim?: string; por?: string; pagina?: string; criada?: string }>;
}) {
  const b = await bloqueio("campanhas");
  if (b) return b;
  const { id } = await params;
  const sp = await searchParams;
  const podeEditar = await permitido("campanhas", "editar");

  const aba = lerAbaMensagens(sp.aba);
  const tipos = filtroTipos(sp.tipos);
  const agrupar = lerAgrupar(sp.agrupar);
  const inicio = dataValida(sp.inicio);
  const fim = dataValida(sp.fim);
  const porPagina = lerPorPagina(sp.por);
  const pagina = Math.max(1, Math.floor(Number(sp.pagina)) || 1);

  const filtros: FiltrosAcoes = { aba, tipos, agrupar, inicio, fim, por: porPagina, pagina };
  const url = (mudar: Partial<FiltrosAcoes>) => urlAcoes(`/campanhas/${id}/acoes`, filtros, mudar);

  const db = await dbUsuario();
  const { linhas, totalAcoes } = await carregarAcoes(db, {
    campanhaId: id,
    tipos,
    aba,
    inicioIso: inicioDoDiaIso(inicio),
    fimIso: fimDoDiaIso(fim),
    porPagina,
    pagina,
    agrupar,
  });
  if (!linhas.length && pagina > 1) redirect(url({ pagina: 1 }));

  const aviso = avisoCriada(sp.criada);
  const de = totalAcoes ? (pagina - 1) * porPagina + 1 : 0;
  const ate = Math.min(pagina * porPagina, totalAcoes);

  return (
    <Pagina
      titulo="Ações"
      acoes={podeEditar ? <BotaoLink href={`/acoes/nova?campanha=${id}`} icone={<Icone nome="add" tamanho={18} />}>ADICIONAR</BotaoLink> : undefined}
    >
      {aviso && <p role="status" className="rounded-lg border border-vg-ok/40 bg-vg-ok/10 px-3 py-2 text-sm text-vg-text">{aviso}</p>}
      <FiltrosAcoesBarra
        filtros={filtros}
        base={`/campanhas/${id}/acoes`}
        tiposFixos={[...TIPOS_EXECUCAO]}
        abas={ABAS_MENSAGENS.map((a) => ({ href: url({ aba: a.valor }), rotulo: a.rotulo, ativo: a.valor === aba }))}
        paginacao={{ de, ate, total: totalAcoes, anterior: pagina > 1 ? url({ pagina: pagina - 1 }) : undefined, proxima: ate < totalAcoes ? url({ pagina: pagina + 1 }) : undefined }}
      />
      <ListaAcoes acoes={linhas} podeEditar={podeEditar} agrupar={agrupar} />
    </Pagina>
  );
}
