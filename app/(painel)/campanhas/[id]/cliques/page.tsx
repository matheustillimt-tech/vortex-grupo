import Link from "next/link";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";
import {
  analisarVisitantes,
  cartoesAnaliseVisitantes,
  contagemComportamento,
  dataHoraCompleta,
  deslocamentoDaPagina,
  desdeDoPeriodo,
  filtrarVisitantes,
  lerComportamentoVisitante,
  lerPeriodoGrafico,
  lerSubAbaClicks,
  LIMITE_PAGINA_EXPORTACAO,
  parametrosUrl,
  PERIODOS_GRAFICO,
  POR_PAGINA_CLIQUES,
  ROTULO_SINAL,
  visitanteCurto,
  type CliqueParaAnalise,
} from "@/src/lib/regras/analises";
import { formatarNumero } from "@/src/lib/regras/inicio";
import { larguraBarra } from "@/src/lib/regras/leadscore";
import { serieComTodosOsDias } from "@/src/lib/regras/serie-metrica";
import { ehUuid } from "@/src/lib/regras/uuid";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { BotaoInfo } from "../../../_componentes/botao-info";
import { CampoTextoEnviar, DataEnviar, SelectEnviar } from "../../../_componentes/campos-auto-enviar";
import { BotaoFaixa, FaixaBotoes } from "../../../_componentes/faixa-botoes";
import { GraficoMetrica } from "../../../_componentes/grafico-metrica";
import { Icone } from "../../../_componentes/icone";
import { Paginacao } from "../../../_componentes/paginacao";
import { Cartao, estiloBotao, Numero, Pagina, Selo, Tabela } from "../../../_componentes/ui";

export const dynamic = "force-dynamic";

type Linha = {
  id: number; visitante: string; grupo_id: string | null; grupo_nome: string | null; grupo_numero: number | null; criado_em: string;
  utm_source: string | null; utm_medium: string | null; utm_campaign: string | null; utm_content: string | null; utm_term: string | null; total: number;
};

/** Aba Clicks: título → filtros (Grupo, datas, sem "Filtrar": enviam ao mudar) → sub-abas
 *  "Histórico"/"Análise" → tabela → paginação → gráfico "Cliques diários" (reaproveita `metricas_campanha`). A
 *  sub-aba "Análise" usa o visitante (cookie) no lugar do IP — os mesmos cliques do período que o gráfico já lê,
 *  só leitura, agregados por `analisarVisitantes` (`src/lib/regras/analises.ts`). */
export default async function Cliques({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ aba?: string; grupo?: string; inicio?: string; fim?: string; pagina?: string; periodo?: string; comportamento?: string; minCliques?: string }>;
}) {
  const b = await bloqueio("campanhas");
  if (b) return b;
  const { id } = await params;
  const sp = await searchParams;
  const aba = lerSubAbaClicks(sp.aba);
  const grupo = ehUuid(sp.grupo) ? sp.grupo! : null;
  const inicio = sp.inicio ? `${sp.inicio}T00:00:00-03:00` : null;
  const fim = sp.fim ? `${sp.fim}T23:59:59-03:00` : null;
  const pagina = Math.max(1, Math.floor(Number(sp.pagina)) || 1);
  const de = deslocamentoDaPagina(pagina, POR_PAGINA_CLIQUES);
  const periodo = lerPeriodoGrafico(sp.periodo);

  const db = await dbUsuario();
  const urlBase = (extra: Record<string, string> = {}) => {
    const p = new URLSearchParams({ aba, ...extra });
    const s = p.toString();
    return `/campanhas/${id}/cliques${s ? `?${s}` : ""}`;
  };
  const urlAba = (a: "historico" | "analise") => urlBase(a === "historico" ? {} : { aba: a });

  const [{ data: grupos, error: erroGrupos }, { data: dias, error: erroDias }] = await Promise.all([
    db.from("grupos").select("id, numero, nome").eq("campanha_id", id).order("numero").limit(500),
    db.rpc("metricas_campanha", { p_campanha: id, p_desde: desdeDoPeriodo(periodo).toISOString() }),
  ]);
  if (erroGrupos) throw new Error("Não foi possível carregar os grupos.");
  if (erroDias) throw new Error("Não foi possível carregar o gráfico diário.");
  const linhasDias = (dias ?? []) as { dia: string; cliques: number | string; entradas: number | string; saidas: number | string }[];
  // "todo o período" soma só os dias com clique; um período fixo (7/14/21/28) mostra exatamente `periodo`
  // pontos no eixo (hoje incluso), com zero onde não há dado (`serieComTodosOsDias`, mesma função de
  // Atividades.9). O rótulo do total bate com a contagem real de pontos (revisão final B,
  // item m8).
  const cliquesSerie = periodo === "todo"
    ? linhasDias.map((l) => ({ data: l.dia, valor: Number(l.cliques) }))
    : serieComTodosOsDias(linhasDias.map((l) => ({ data: l.dia, valor: Number(l.cliques) })), periodo);
  const totalCliques = cliquesSerie.reduce((s, d) => s + d.valor, 0);
  const rotuloPeriodo = periodo === "todo" ? "todo o período" : `últimos ${periodo} dias`;

  const exportar = (() => {
    const p = new URLSearchParams({ campanha: id });
    if (grupo) p.set("grupo", grupo);
    if (sp.inicio) p.set("inicio", sp.inicio);
    if (sp.fim) p.set("fim", sp.fim);
    return `/api/exportar/cliques?${p.toString()}`;
  })();

  const url = (o: { grupo?: string | null; inicio?: string; fim?: string; pagina?: number } = {}) => {
    const p = new URLSearchParams({ aba });
    const g = "grupo" in o ? o.grupo : grupo;
    if (g) p.set("grupo", g);
    const i = o.inicio ?? sp.inicio;
    if (i) p.set("inicio", i);
    const f = o.fim ?? sp.fim;
    if (f) p.set("fim", f);
    if (periodo !== "todo") p.set("periodo", String(periodo));
    if (o.pagina && o.pagina > 1) p.set("pagina", String(o.pagina));
    const s = p.toString();
    return `/campanhas/${id}/cliques${s ? `?${s}` : ""}`;
  };

  return (
    <Pagina
      titulo="Histórico de cliques"
      infoTitulo={<BotaoInfo titulo="Histórico de cliques" texto={<p>Cliques no link da campanha, por visitante e por grupo.</p>} />}
      acoes={<a href={exportar} className={estiloBotao("contorno")}><Icone nome="download" />EXPORTAR HISTORICO</a>}
    >
      <Cartao>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="aba" value={aba} />
          {periodo !== "todo" && <input type="hidden" name="periodo" value={periodo} />}
          <label className="relative block w-full sm:w-56">
            <span className="pointer-events-none absolute -top-2 left-2 bg-vg-bg px-1 text-[11px] leading-4 text-vg-text-2">Grupo</span>
            <SelectEnviar name="grupo" defaultValue={grupo ?? ""} ariaLabel="Filtrar por grupo" className="w-full rounded border border-vg-line-2 bg-transparent px-3 pt-2.5 pb-2 text-[13.3px] text-vg-text outline-none transition hover:border-white/60 focus:border-vg-accent focus:ring-1 focus:ring-vg-accent">
              <option value="">Todos</option>
              {(grupos ?? []).map((g) => <option key={g.id} value={g.id}>#{g.numero} {g.nome}</option>)}
            </SelectEnviar>
          </label>
          <label className="relative block w-full sm:w-44">
            <span className="pointer-events-none absolute -top-2 left-2 bg-vg-bg px-1 text-[11px] leading-4 text-vg-text-2">Data de início</span>
            <DataEnviar name="inicio" defaultValue={sp.inicio ?? ""} ariaLabel="Data de início" className="w-full rounded border border-vg-line-2 bg-transparent px-3 pt-2.5 pb-2 text-[13.3px] text-vg-text outline-none transition hover:border-white/60 focus:border-vg-accent focus:ring-1 focus:ring-vg-accent" />
          </label>
          <label className="relative block w-full sm:w-44">
            <span className="pointer-events-none absolute -top-2 left-2 bg-vg-bg px-1 text-[11px] leading-4 text-vg-text-2">Data de fim</span>
            <DataEnviar name="fim" defaultValue={sp.fim ?? ""} ariaLabel="Data de fim" className="w-full rounded border border-vg-line-2 bg-transparent px-3 pt-2.5 pb-2 text-[13.3px] text-vg-text outline-none transition hover:border-white/60 focus:border-vg-accent focus:ring-1 focus:ring-vg-accent" />
          </label>
        </form>
      </Cartao>

      <div role="tablist" className="flex gap-1 border-b border-vg-line">
        {(["historico", "analise"] as const).map((a) => (
          <Link
            key={a}
            href={urlAba(a)}
            role="tab"
            aria-selected={aba === a}
            className={`px-4 py-2 text-sm font-medium transition-colors ${aba === a ? "border-b-2 border-vg-accent text-vg-accent" : "text-vg-muted hover:text-vg-text"}`}
          >
            {a === "historico" ? "Histórico" : "Análise"}
          </Link>
        ))}
      </div>

      {aba === "historico" ? (
        <HistoricoCliques db={db} id={id} grupo={grupo} inicio={inicio} fim={fim} pagina={pagina} de={de} url={url} />
      ) : (
        <AnaliseCliques db={db} id={id} grupo={grupo} inicio={inicio} fim={fim} desde={desdeDoPeriodo(periodo).toISOString()} aba={aba} periodo={periodo} sp={sp} />
      )}

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-vg-muted">Cliques por dia</p>
          <FaixaBotoes>
            {PERIODOS_GRAFICO.map((p) => (
              <BotaoFaixa key={p.valor} caixaNormal href={urlBase({ periodo: String(p.valor) })} ativo={p.valor === periodo}>{p.rotulo}</BotaoFaixa>
            ))}
          </FaixaBotoes>
        </div>
        <GraficoMetrica
          titulo="Cliques diários"
          total={formatarNumero(totalCliques)}
          rotuloTotal={periodo === "todo" ? rotuloPeriodo : `nos ultimos ${periodo} Dias`}
          serie={cliquesSerie}
          idGradiente="vg-grafico-cliques"
        />
      </div>
    </Pagina>
  );
}

async function HistoricoCliques({ db, id, grupo, inicio, fim, pagina, de, url }: {
  db: Awaited<ReturnType<typeof dbUsuario>>;
  id: string;
  grupo: string | null;
  inicio: string | null;
  fim: string | null;
  pagina: number;
  de: number;
  url: (o?: { grupo?: string | null; inicio?: string; fim?: string; pagina?: number }) => string;
}) {
  const { data: linhas, error } = await db.rpc("cliques_campanha", { p_campanha: id, p_grupo: grupo, p_inicio: inicio, p_fim: fim, p_limite: POR_PAGINA_CLIQUES, p_deslocamento: de });
  if (error) throw new Error("Não foi possível carregar os cliques.");
  const lista = ((linhas ?? []) as Linha[]).map((l) => ({ ...l, total: Number(l.total) }));
  const total = lista[0]?.total ?? 0;
  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA_CLIQUES));

  return (
    <>
      <Tabela colunas={["Visitante", "Grupo", "Data", "Parâmetros da URL"]} vazio={lista.length ? undefined : "Nenhum clique encontrado"}>
        {lista.map((l) => (
          <tr key={l.id}>
            <td className="px-3 py-2.5 font-mono text-xs">{visitanteCurto(l.visitante)}</td>
            <td className="px-3 py-2.5">{l.grupo_nome ? <>#{l.grupo_numero} {l.grupo_nome}</> : "—"}</td>
            <td className="px-3 py-2.5 tabular-nums">{dataHoraCompleta(l.criado_em)}</td>
            <td className="px-3 py-2.5 text-xs text-vg-muted">{parametrosUrl(l)}</td>
          </tr>
        ))}
      </Tabela>
      {total > 0 && (
        <Paginacao
          de={de + 1}
          ate={Math.min(de + POR_PAGINA_CLIQUES, total)}
          total={total}
          porPagina={POR_PAGINA_CLIQUES}
          primeira={pagina > 1 ? url({ pagina: 1 }) : undefined}
          anterior={pagina > 1 ? url({ pagina: pagina - 1 }) : undefined}
          proxima={pagina < totalPaginas ? url({ pagina: pagina + 1 }) : undefined}
          ultima={pagina < totalPaginas ? url({ pagina: totalPaginas }) : undefined}
        />
      )}
    </>
  );
}

/** Sub-aba "Análise": lê os mesmos cliques do período que o gráfico já lê (`desde`, só
 *  leitura, até `LIMITE_PAGINA_EXPORTACAO` linhas — teto generoso, idêntico ao das rotas de exportação) e agrega por
 *  visitante com `analisarVisitantes`. "Cliques por origem"/"Cliques por grupo" (extras do Vórtex Grupo) ficam
 *  abaixo, com os RPCs de sempre. */
async function AnaliseCliques({ db, id, grupo, inicio, fim, desde, aba, periodo, sp }: {
  db: Awaited<ReturnType<typeof dbUsuario>>;
  id: string;
  grupo: string | null;
  inicio: string | null;
  fim: string | null;
  desde: string;
  aba: string;
  periodo: number | "todo";
  sp: { grupo?: string; inicio?: string; fim?: string };
}) {
  const comportamento = lerComportamentoVisitante(sp && (sp as unknown as { comportamento?: string }).comportamento);
  const minCliques = Math.max(0, Math.floor(Number((sp as unknown as { minCliques?: string }).minCliques)) || 0);

  let consultaCliques = db
    .from("cliques")
    .select("visitante, grupo_id, criado_em:created_at, grupos(numero, nome)")
    .eq("campanha_id", id)
    .gte("created_at", inicio ?? desde)
    .lte("created_at", fim ?? new Date().toISOString());
  if (grupo) consultaCliques = consultaCliques.eq("grupo_id", grupo);

  const [{ data: cliques, error: erroCliques }, { data: origens, error: erroOrigens }, { data: porGrupo, error: erroGrupo }] = await Promise.all([
    consultaCliques.order("created_at", { ascending: false }).limit(LIMITE_PAGINA_EXPORTACAO),
    db.rpc("cliques_por_origem", { p_campanha: id }),
    db.rpc("cliques_por_grupo", { p_campanha: id }),
  ]);
  if (erroCliques) throw new Error("Não foi possível carregar os cliques para a análise.");
  if (erroOrigens) throw new Error("Não foi possível carregar os cliques por origem.");
  if (erroGrupo) throw new Error("Não foi possível carregar os cliques por grupo.");

  const linhasAnalise: CliqueParaAnalise[] = (
    (cliques ?? []) as unknown as { visitante: string; grupo_id: string | null; criado_em: string; grupos: { numero: number; nome: string } | null }[]
  ).map((c) => ({
    visitante: c.visitante,
    grupo_id: c.grupo_id,
    grupo_numero: c.grupos?.numero ?? null,
    grupo_nome: c.grupos?.nome ?? null,
    criado_em: c.criado_em,
  }));
  // O teto (`LIMITE_PAGINA_EXPORTACAO`, idêntico ao das rotas de exportação) pode cortar cliques mais antigos do
  // período: avisa quando bate nele, já que a lista vem do mais recente pro mais antigo (`order` acima).
  const atingiuTeto = linhasAnalise.length >= LIMITE_PAGINA_EXPORTACAO;
  const agregados = analisarVisitantes(linhasAnalise);
  const cartoes = cartoesAnaliseVisitantes(agregados);
  const { umGrupo, variosGrupos } = contagemComportamento(agregados);
  const visitantes = filtrarVisitantes(agregados, { comportamento, minimoCliques: minCliques }).slice(0, 20);

  const urlAnalise = (o: { comportamento?: string; minCliques?: string } = {}) => {
    const p = new URLSearchParams({ aba });
    if (sp.grupo) p.set("grupo", sp.grupo);
    if (sp.inicio) p.set("inicio", sp.inicio);
    if (sp.fim) p.set("fim", sp.fim);
    if (periodo !== "todo") p.set("periodo", String(periodo));
    const c = o.comportamento ?? comportamento;
    if (c !== "todos") p.set("comportamento", c);
    const m = o.minCliques ?? String(minCliques);
    if (m !== "0") p.set("minCliques", m);
    const s = p.toString();
    return `/campanhas/${id}/cliques${s ? `?${s}` : ""}`;
  };

  const listaOrigens = ((origens ?? []) as { origem: string; cliques: number }[]).map((o) => ({ ...o, cliques: Number(o.cliques) }));
  const listaGrupos = ((porGrupo ?? []) as { grupo_id: string; numero: number; nome: string; cliques: number }[]).map((g) => ({ ...g, cliques: Number(g.cliques) }));
  const maiorOrigem = Math.max(0, ...listaOrigens.map((o) => o.cliques));
  const maiorGrupo = Math.max(0, ...listaGrupos.map((g) => g.cliques));

  return (
    <div className="space-y-4">
      {atingiuTeto && (
        <p role="status" className="text-sm text-vg-muted">Esta análise considera só os últimos {formatarNumero(LIMITE_PAGINA_EXPORTACAO)} cliques do período.</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Numero icone="ads_click" rotulo="Clicks" valor={formatarNumero(cartoes.clicks)} />
        <Numero icone="devices" rotulo="Visitantes únicos" valor={formatarNumero(cartoes.visitantesUnicos)} />
        <Numero icone="functions" rotulo="Média cliques/visitante" valor={cartoes.mediaCliquesPorVisitante.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} />
        <Numero icone="leaderboard" rotulo="Participação do top visitante" valor={`${cartoes.participacaoTopVisitante.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`} />
      </div>

      <Cartao>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="aba" value={aba} />
          {sp.grupo && <input type="hidden" name="grupo" value={sp.grupo} />}
          {sp.inicio && <input type="hidden" name="inicio" value={sp.inicio} />}
          {sp.fim && <input type="hidden" name="fim" value={sp.fim} />}
          {periodo !== "todo" && <input type="hidden" name="periodo" value={periodo} />}
          <label className="relative block w-full sm:w-56">
            <span className="pointer-events-none absolute -top-2 left-2 bg-vg-bg px-1 text-[11px] leading-4 text-vg-text-2">Comportamento do visitante</span>
            <SelectEnviar name="comportamento" defaultValue={comportamento} ariaLabel="Comportamento do visitante" className="w-full rounded border border-vg-line-2 bg-transparent px-3 pt-2.5 pb-2 text-[13.3px] text-vg-text outline-none transition hover:border-white/60 focus:border-vg-accent focus:ring-1 focus:ring-vg-accent">
              <option value="todos">Todos</option>
              <option value="1grupo">1 grupo</option>
              <option value="varios">Vários grupos</option>
            </SelectEnviar>
          </label>
          <label className="relative block w-full sm:w-44">
            <span className="pointer-events-none absolute -top-2 left-2 bg-vg-bg px-1 text-[11px] leading-4 text-vg-text-2">Mín. cliques por visitante</span>
            <CampoTextoEnviar name="minCliques" defaultValue={String(minCliques)} ariaLabel="Mín. cliques por visitante" className="w-full rounded border border-vg-line-2 bg-transparent px-3 pt-2.5 pb-2 text-[13.3px] text-vg-text outline-none transition placeholder:text-vg-text-3 hover:border-white/60 focus:border-vg-accent focus:ring-1 focus:ring-vg-accent" />
          </label>
        </form>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Link href={urlAnalise({ comportamento: "1grupo" })} className="transition-colors hover:opacity-80"><Selo cor="neutro">1 grupo: {umGrupo}</Selo></Link>
          <Link href={urlAnalise({ comportamento: "varios" })} className="transition-colors hover:opacity-80"><Selo cor="aviso">Vários grupos: {variosGrupos}</Selo></Link>
        </div>
      </Cartao>

      <Cartao titulo="Top visitantes">
        <Tabela colunas={["Visitante", "Clicks", "Grupo", "Data", "Sinais suspeitos"]} vazio={visitantes.length ? undefined : "Nenhum visitante encontrado"}>
          {visitantes.map((v) => (
            <tr key={v.visitante}>
              <td className="px-3 py-2.5 font-mono text-xs">{visitanteCurto(v.visitante)}</td>
              <td className="px-3 py-2.5 tabular-nums">{formatarNumero(v.cliques)}</td>
              <td className="px-3 py-2.5">{v.ultimoGrupoNome ? <>#{v.ultimoGrupoNumero} {v.ultimoGrupoNome}</> : "—"}</td>
              <td className="px-3 py-2.5 tabular-nums">{v.ultimoClique ? dataHoraCompleta(v.ultimoClique) : "—"}</td>
              <td className="px-3 py-2.5">
                <div className="flex flex-wrap gap-1">
                  {v.sinais.length === 0 ? "—" : v.sinais.map((s) => <Selo key={s} cor="aviso">{ROTULO_SINAL[s]}</Selo>)}
                </div>
              </td>
            </tr>
          ))}
        </Tabela>
      </Cartao>

      <div className="grid gap-4 sm:grid-cols-2">
        <Cartao titulo="Cliques por origem (utm_source)">
          {listaOrigens.length === 0 ? (
            <p className="py-6 text-center text-[15px] text-vg-text">Nenhum clique ainda</p>
          ) : (
            <ol className="space-y-2">
              {listaOrigens.map((o) => (
                <li key={o.origem} className="grid grid-cols-[minmax(0,8rem)_1fr_auto] items-center gap-3 text-sm">
                  <span className="truncate" title={o.origem}>{o.origem}</span>
                  <span className="h-3 rounded bg-white/5" aria-hidden>
                    <span className="block h-3 rounded bg-vg-accent" style={{ width: `${larguraBarra(o.cliques, maiorOrigem)}%` }} />
                  </span>
                  <span className="tabular-nums text-vg-text">{formatarNumero(o.cliques)}</span>
                </li>
              ))}
            </ol>
          )}
        </Cartao>
        <Cartao titulo="Cliques por grupo">
          {listaGrupos.length === 0 ? (
            <p className="py-6 text-center text-[15px] text-vg-text">Nenhum grupo nesta campanha</p>
          ) : (
            <ol className="space-y-2">
              {listaGrupos.map((g) => (
                <li key={g.grupo_id} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-sm">
                  <span className="truncate" title={g.nome}>#{g.numero} {g.nome}</span>
                  <span className="h-3 rounded bg-white/5" aria-hidden>
                    <span className="block h-3 rounded bg-vg-accent" style={{ width: `${larguraBarra(g.cliques, maiorGrupo)}%` }} />
                  </span>
                  <span className="tabular-nums text-vg-text">{formatarNumero(g.cliques)}</span>
                </li>
              ))}
            </ol>
          )}
        </Cartao>
      </div>
    </div>
  );
}

