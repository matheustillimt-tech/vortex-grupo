import { redirect } from "next/navigation";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";
import { permitido } from "@/src/lib/permissoes";
import { resumoConteudo } from "@/src/lib/regras/conteudo";
import { isoParaBrasilia } from "@/src/lib/regras/horario";
import { formatarNumero } from "@/src/lib/regras/inicio";
import { AVISO_DADOS_POR_PESSOA, CRITERIOS, deslocamentoDaPagina, larguraBarra, lerCriterio, tituloTopGrupos, type Criterio } from "@/src/lib/regras/leadscore";
import { ehUuid } from "@/src/lib/regras/uuid";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { BotaoInfo } from "../../../_componentes/botao-info";
import { CampoBusca } from "../../../_componentes/campo-busca";
import { BotaoFaixa, FaixaBotoes } from "../../../_componentes/faixa-botoes";
import { Icone } from "../../../_componentes/icone";
import { Cartao, estiloBotao, Pagina } from "../../../_componentes/ui";
import { FiltroAcao } from "./filtro-acao";
import { Tabela, type LinhaDesempenho } from "./tabela";

export const dynamic = "force-dynamic";

type Linha = { grupo_id: string; numero: number; nome: string; participantes: number; pontos: number; pontuacao: number | string };

const OPCOES_LINHAS = [10, 25, 50] as const;
const PADRAO_LINHAS = 10;

const valorPt = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function lerLinhas(v: string | undefined): number {
  const n = Number(v);
  return OPCOES_LINHAS.includes(n as (typeof OPCOES_LINHAS)[number]) ? n : PADRAO_LINHAS;
}

/** Aba Desempenho por grupo: pontuação ponderada (pontos ÷ participantes atuais) por grupo. */
export default async function Desempenho({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ criterio?: string; q?: string; execucao?: string; pagina?: string; linhas?: string }>;
}) {
  const b = await bloqueio("campanhas");
  if (b) return b;
  const verLeads = await permitido("leads", "ver");
  const { id } = await params;
  const sp = await searchParams;
  const criterio = lerCriterio(sp.criterio);
  const q = (sp.q ?? "").trim().slice(0, 60);
  const execucao = ehUuid(sp.execucao) ? sp.execucao : null;
  const porPagina = lerLinhas(sp.linhas);
  const pagina = Math.max(1, Math.floor(Number(sp.pagina)) || 1);
  const deTabela = deslocamentoDaPagina(pagina, porPagina);

  const db = await dbUsuario();
  const [{ data: linhas, error }, { data: disparos, error: erroDisparos }, { data: linhasTabela, error: erroTabela }, { data: vendas, error: erroVendas }] = await Promise.all([
    db.rpc("desempenho_grupos", { p_campanha: id, p_criterio: criterio, p_execucao: execucao, p_limite: 20, p_busca: q || null }),
    db
      .from("execucoes")
      .select("id, tipo, agendada_para, conteudo, conteudo_final")
      .eq("campanha_id", id)
      .in("tipo", ["mensagem", "enquete"])
      .in("status", ["enviando", "concluida"])
      .order("agendada_para", { ascending: false })
      .limit(50),
    db.rpc("desempenho_grupos_tabela", { p_campanha: id, p_criterio: criterio, p_execucao: execucao, p_busca: q || null, p_offset: deTabela, p_limite: porPagina }),
    db.rpc("vendas_por_grupo", { p_campanha: id }),
  ]);
  if (error) throw new Error("Não foi possível carregar o desempenho dos grupos.");
  if (erroDisparos) throw new Error("Não foi possível carregar os disparos da campanha.");
  if (erroTabela) throw new Error("Não foi possível carregar a tabela de desempenho.");
  if (erroVendas) throw new Error("Não foi possível carregar as vendas dos grupos.");
  const vendasDoGrupo = new Map(((vendas ?? []) as { grupo_id: string; vendas: number | string }[]).map((v) => [v.grupo_id, Number(v.vendas)]));

  const lista = ((linhas ?? []) as Linha[]).map((l) => ({ ...l, pontos: Number(l.pontos), pontuacao: Number(l.pontuacao) }));
  const maior = Math.max(0, ...lista.map((l) => l.pontuacao));

  type LinhaTabela = { grupo_id: string; numero: number; nome: string; group_id: string; participantes: number; geral: string | number; visualizacao: string | number; reproducao: string | number; recebimento: string | number; total: number };
  const listaTabela: LinhaDesempenho[] = ((linhasTabela ?? []) as LinhaTabela[]).map((l) => ({
    grupo_id: l.grupo_id,
    numero: l.numero,
    nome: l.nome,
    group_id: l.group_id,
    participantes: l.participantes,
    geral: Number(l.geral),
    visualizacao: Number(l.visualizacao),
    reproducao: Number(l.reproducao),
    recebimento: Number(l.recebimento),
  }));
  const totalTabela = (linhasTabela as LinhaTabela[] | null)?.[0]?.total ?? 0;
  const totalPaginasTabela = Math.max(1, Math.ceil(totalTabela / porPagina));

  const url = (c: Criterio) => {
    const p = new URLSearchParams();
    if (c !== "geral") p.set("criterio", c);
    if (q) p.set("q", q);
    if (execucao) p.set("execucao", execucao);
    const s = p.toString();
    return `/campanhas/${id}/desempenho${s ? `?${s}` : ""}`;
  };
  const urlTabela = (o: { pagina?: number; linhas?: number } = {}) => {
    const p = new URLSearchParams();
    if (criterio !== "geral") p.set("criterio", criterio);
    if (q) p.set("q", q);
    if (execucao) p.set("execucao", execucao);
    const l = o.linhas ?? porPagina;
    if (l !== PADRAO_LINHAS) p.set("linhas", String(l));
    const pg = o.pagina ?? pagina;
    if (pg > 1) p.set("pagina", String(pg));
    const s = p.toString();
    return `/campanhas/${id}/desempenho${s ? `?${s}` : ""}`;
  };
  // `?pagina=` ficou pra trás (trocou o filtro de ação/busca com uma página alta aberta, ou a lista encolheu):
  // sem linha nenhuma numa página que não é a 1, volta pra página 1 (revisão final B, item m6; mesmo padrão
  // de `webhooks/[id]/page.tsx`).
  if (!listaTabela.length && pagina > 1) redirect(urlTabela({ pagina: 1 }));
  const exportar = (() => {
    const p = new URLSearchParams({ campanha: id, criterio });
    if (execucao) p.set("execucao", execucao);
    if (q) p.set("q", q);
    return `/api/exportar/desempenho?${p.toString()}`;
  })();

  return (
    <Pagina
      titulo="Desempenho por grupo"
      infoTitulo={
        <BotaoInfo
          icone="info_outline"
          titulo="Desempenho por grupo"
          texto={<p>A pontuação soma os disparos da campanha. Filtre por ação para ver um único envio.</p>}
        />
      }
      subtitulo={AVISO_DADOS_POR_PESSOA}
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-vg-muted">Ranquear por:</span>
            <FaixaBotoes>
              {CRITERIOS.map((c) => (
                <BotaoFaixa key={c.valor} icone={c.icone} href={url(c.valor)} ativo={c.valor === criterio}>{c.rotulo}</BotaoFaixa>
              ))}
            </FaixaBotoes>
          </div>
          <form method="get" className="flex flex-wrap items-center gap-2">
            {criterio !== "geral" && <input type="hidden" name="criterio" value={criterio} />}
            {execucao && <input type="hidden" name="execucao" value={execucao} />}
            <CampoBusca nome="q" valorInicial={q} rotulo="Buscar grupo" className="w-full sm:w-64" />
          </form>
          <FiltroAcao
            valor={execucao ?? ""}
            disparos={(disparos ?? []).map((d) => ({ id: d.id, rotulo: `${isoParaBrasilia(d.agendada_para)} · ${resumoConteudo(d.tipo, d.conteudo_final ?? d.conteudo).slice(0, 60)}` }))}
          />
          {verLeads && <a href={exportar} className={estiloBotao("contorno")}><Icone nome="download" />EXPORTAR</a>}
        </div>
      </div>

      <Cartao titulo={tituloTopGrupos(criterio)}>
        <p className="mb-3 text-[13px] text-vg-muted">Pontuação ponderada (mais alta = melhor desempenho relativo no sinal escolhido).</p>
        {lista.length === 0 ? (
          <p className="py-6 text-center text-[15px] text-vg-text">{q ? "Nenhum grupo encontrado" : "Nenhum grupo nesta campanha"}</p>
        ) : (
          <ol className="space-y-2">
            {lista.map((l) => (
              <li key={l.grupo_id} className="grid grid-cols-[minmax(0,17rem)_1fr_auto] items-center gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate" title={l.nome}>{l.nome}</span>
                  {(vendasDoGrupo.get(l.grupo_id) ?? 0) > 0 && (
                    <span
                      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-vg-accent/15 px-2 py-0.5 text-xs font-semibold tabular-nums text-vg-accent"
                      title={`${formatarNumero(vendasDoGrupo.get(l.grupo_id)!)} venda(s) de quem está ou esteve neste grupo (checkout ou remoção de comprador)`}
                    >
                      <Icone nome="shopping_cart" tamanho={14} />
                      {formatarNumero(vendasDoGrupo.get(l.grupo_id)!)}
                    </span>
                  )}
                </span>
                <span className="h-3 rounded bg-white/5" aria-hidden>
                  <span className="block h-3 rounded bg-vg-accent" style={{ width: `${larguraBarra(l.pontuacao, maior)}%` }} />
                </span>
                <span className="tabular-nums text-vg-text" title={`${formatarNumero(l.pontos)} pontos ÷ ${formatarNumero(l.participantes)} participantes`}>
                  {valorPt(l.pontuacao)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Cartao>

      <Tabela
        linhas={listaTabela}
        criterio={criterio}
        de={deTabela}
        busca={!!q}
        paginacao={{
          ate: Math.min(deTabela + porPagina, totalTabela),
          total: totalTabela,
          porPagina,
          primeira: pagina > 1 ? urlTabela({ pagina: 1 }) : undefined,
          anterior: pagina > 1 ? urlTabela({ pagina: pagina - 1 }) : undefined,
          proxima: pagina < totalPaginasTabela ? urlTabela({ pagina: pagina + 1 }) : undefined,
          ultima: pagina < totalPaginasTabela ? urlTabela({ pagina: totalPaginasTabela }) : undefined,
        }}
      />
    </Pagina>
  );
}
