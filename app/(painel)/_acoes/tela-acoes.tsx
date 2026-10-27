import { redirect } from "next/navigation";
import { permitido } from "@/src/lib/permissoes";
import { ABAS_MENSAGENS, fimDoDiaIso, inicioDoDiaIso } from "@/src/lib/regras/abas-mensagens";
import { avisoCriada } from "@/src/lib/regras/assistente-acao";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { Icone } from "../_componentes/icone";
import { ListaAcoes } from "../_componentes/lista-acoes";
import { BotaoLink } from "../_componentes/ui";
import { carregarAcoes, lerFiltrosDaTelaAcoes, type SpTelaAcoes } from "./comum";
import { FiltrosAcoesBarra } from "./filtros";
import { urlAcoes, type FiltrosAcoes, type OpcoesUrlAcoes } from "./tipos";

export type { SpTelaAcoes };

/**
 * Corpo da tela de Ações — extraído de `/acoes` (Etapa 3K, Tarefa 4) pra também desenhar a aba "Ações" do
 * detalhe da conta: mesmas sub-abas, "Agrupar", intervalo de datas,
 * barra em massa e cartões. `conexaoId` filtra `listar_acoes` por conta (a RPC já aceita `p_conexao`); sem ele,
 * o comportamento é exatamente o de hoje (tela global `/acoes`, sem mudar nada) — a leitura dos filtros em si
 * mora em `lerFiltrosDaTelaAcoes` (`comum.ts`), pura e testável sem montar este componente.
 *
 * Embutida (`conexaoId` presente), os parâmetros de filtro ganham o prefixo "sub" (`?subaba=`, `?subtipos=`…) e
 * toda URL leva `?aba=acoes` fixo — o `?aba=` sem prefixo é a aba de cima do detalhe da conta (Grupos/Campanhas/
 * Webhooks/…), que não pode ser pisada pelas sub-abas de Ações (Visão geral/Na fila/…). `cabecalhoAdicionar`
 * (só na versão embutida) desenha aqui dentro o título "Ações" + `add` "ADICIONAR" que a tela global já tem no
 * topo da página via `Pagina`.
 */
export async function TelaAcoes({ sp, base, conexaoId, cabecalhoAdicionar }: {
  sp: SpTelaAcoes;
  base: string;
  conexaoId: string | null;
  cabecalhoAdicionar?: string;
}) {
  const opcoesUrl: OpcoesUrlAcoes | undefined = conexaoId ? { prefixo: "sub", fixos: { aba: "acoes" } } : undefined;
  const podeEditar = await permitido("campanhas", "editar");
  // "Histórico" (auditoria do painel, `/historico`) é a última sub-aba, depois de Falhas — só na tela global.
  const veHistorico = !conexaoId && (await permitido("historico", "ver"));

  const { filtros, automacaoId } = lerFiltrosDaTelaAcoes(sp, !!conexaoId);
  const { aba, pagina, por: porPagina } = filtros;

  const url = (mudar: Partial<FiltrosAcoes>) => {
    const comFiltros = urlAcoes(base, filtros, mudar, opcoesUrl);
    if (!automacaoId) return comFiltros;
    return `${comFiltros}${comFiltros.includes("?") ? "&" : "?"}automacao=${automacaoId}`;
  };
  const limparAutomacao = conexaoId ? `${base}?aba=acoes` : base;

  const db = await dbUsuario();
  const { linhas, totalAcoes } = await carregarAcoes(db, {
    campanhaId: null,
    conexaoId,
    tipos: filtros.tipos,
    aba,
    inicioIso: inicioDoDiaIso(filtros.inicio),
    fimIso: fimDoDiaIso(filtros.fim),
    porPagina,
    pagina,
    agrupar: filtros.agrupar,
    automacaoId,
  });
  // Página além do fim (a lista encolheu): volta pra primeira.
  if (!linhas.length && pagina > 1) redirect(url({ pagina: 1 }));

  const aviso = avisoCriada(sp.criada);
  const de = totalAcoes ? (pagina - 1) * porPagina + 1 : 0;
  const ate = Math.min(pagina * porPagina, totalAcoes);

  return (
    <div className="space-y-4">
      {cabecalhoAdicionar && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-medium">Ações</h2>
          {podeEditar && (
            <BotaoLink href={cabecalhoAdicionar} icone={<Icone nome="add" tamanho={18} />}>
              ADICIONAR
            </BotaoLink>
          )}
        </div>
      )}
      {aviso && <p role="status" className="rounded-lg border border-vg-ok/40 bg-vg-ok/10 px-3 py-2 text-sm text-vg-text">{aviso}</p>}
      {automacaoId && (
        <p className="flex items-center gap-2 rounded-lg border border-vg-accent/40 bg-vg-accent/10 px-3 py-2 text-sm text-vg-text">
          <Icone nome="filter_alt" tamanho={16} className="text-vg-accent" />
          Filtrado por uma automação.
          <a href={limparAutomacao} className="font-medium text-vg-accent hover:underline">Limpar filtro</a>
        </p>
      )}
      <FiltrosAcoesBarra
        filtros={filtros}
        base={base}
        opcoesUrl={opcoesUrl}
        abas={[
          ...ABAS_MENSAGENS.map((a) => ({ href: url({ aba: a.valor }), rotulo: a.rotulo, ativo: a.valor === aba })),
          ...(veHistorico ? [{ href: "/historico", rotulo: "Histórico", ativo: false }] : []),
        ]}
        paginacao={{ de, ate, total: totalAcoes, anterior: pagina > 1 ? url({ pagina: pagina - 1 }) : undefined, proxima: ate < totalAcoes ? url({ pagina: pagina + 1 }) : undefined }}
      />
      <ListaAcoes acoes={linhas} podeEditar={podeEditar} agrupar={filtros.agrupar} />
    </div>
  );
}
