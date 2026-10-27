import { bloqueio } from "@/app/(painel)/_componentes/guarda";
import { permitido } from "@/src/lib/permissoes";
import { telefonesConectados } from "@/src/lib/automacoes";
import {
  conectadosParaDescontar,
  dataHoraCompleta,
  deslocamentoDaPagina,
  desdeDoPeriodo,
  EVENTOS,
  lerEvento,
  lerPeriodoGrafico,
  PERIODOS_GRAFICO,
  POR_PAGINA_ATIVIDADES,
  rotuloEvento,
  semNumerosConectados,
  totalSemConectados,
  type Evento,
  type PeriodoGrafico,
} from "@/src/lib/regras/analises";
import { serieComTodosOsDias } from "@/src/lib/regras/serie-metrica";
import { ehUuid } from "@/src/lib/regras/uuid";
import { telefoneLegivel } from "@/src/lib/telefone";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { BotaoInfo } from "../../../_componentes/botao-info";
import { CampoTextoEnviar, DataEnviar, SelectEnviar } from "../../../_componentes/campos-auto-enviar";
import { BotaoFaixa, FaixaBotoes } from "../../../_componentes/faixa-botoes";
import { GraficoMetrica } from "../../../_componentes/grafico-metrica";
import { Icone } from "../../../_componentes/icone";
import { Paginacao } from "../../../_componentes/paginacao";
import { Cartao, estiloBotao, Pagina, Selo, Tabela } from "../../../_componentes/ui";

export const dynamic = "force-dynamic";

type Linha = { telefone: string; grupo_id: string; grupo_nome: string; grupo_numero: number; evento: "entrada" | "saida"; em: string; total: number };

/** Aba Atividades: histórico de entradas e saídas com filtros e o gráfico diário (reaproveita
 *  `metricas_campanha`, que já soma no banco). */
export default async function Atividades({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ numero?: string; grupo?: string; evento?: string; inicio?: string; fim?: string; pagina?: string; periodo?: string }>;
}) {
  const b = await bloqueio("campanhas");
  if (b) return b;
  const verLeads = await permitido("leads", "ver");
  const { id } = await params;
  const sp = await searchParams;
  const numero = (sp.numero ?? "").trim().slice(0, 40);
  const grupo = ehUuid(sp.grupo) ? sp.grupo! : null;
  const evento = lerEvento(sp.evento);
  const inicio = sp.inicio ? `${sp.inicio}T00:00:00-03:00` : null;
  const fim = sp.fim ? `${sp.fim}T23:59:59-03:00` : null;
  const pagina = Math.max(1, Math.floor(Number(sp.pagina)) || 1);
  const de = deslocamentoDaPagina(pagina, POR_PAGINA_ATIVIDADES);
  const periodo = lerPeriodoGrafico(sp.periodo);

  const db = await dbUsuario();
  const filtros = { p_campanha: id, p_grupo: grupo, p_evento: evento, p_inicio: inicio, p_fim: fim };
  // As contas conectadas (quem cria e administra os grupos) não contam como entrada/saída: saem da lista e o total
  // desconta as linhas delas (uma consulta de 1 linha por telefone, com os mesmos filtros). Só a tela muda.
  const conectados = await telefonesConectados(db);
  const descontar = conectadosParaDescontar(conectados, numero || null);
  const [{ data: linhas, error }, { data: grupos, error: erroGrupos }, { data: dias, error: erroDias }, ...dosConectados] = await Promise.all([
    db.rpc("atividades_campanha", { ...filtros, p_busca: numero || null, p_limite: POR_PAGINA_ATIVIDADES, p_deslocamento: de }),
    db.from("grupos").select("id, numero, nome").eq("campanha_id", id).order("numero").limit(500),
    db.rpc("metricas_campanha", { p_campanha: id, p_desde: desdeDoPeriodo(periodo).toISOString() }),
    ...descontar.map((t) => db.rpc("atividades_campanha", { ...filtros, p_busca: t, p_limite: 1, p_deslocamento: 0 })),
  ]);
  if (error || dosConectados.some((r) => r.error)) throw new Error("Não foi possível carregar as atividades.");
  if (erroGrupos) throw new Error("Não foi possível carregar os grupos.");
  if (erroDias) throw new Error("Não foi possível carregar o gráfico diário.");

  const pagina1 = ((linhas ?? []) as Linha[]).map((l) => ({ ...l, grupo_numero: Number(l.grupo_numero), total: Number(l.total) }));
  const lista = semNumerosConectados(pagina1, conectados);
  const total = totalSemConectados(pagina1[0]?.total ?? 0, dosConectados.map((r) => Number((r.data as Linha[] | null)?.[0]?.total ?? 0)));
  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA_ATIVIDADES));
  const linhasDias = (dias ?? []) as { dia: string; cliques: number | string; entradas: number | string; saidas: number | string }[];
  // Eixo: "todo o período" usa só os dias com movimento; um período fixo (7/14/21/28) mostra exatamente
  // `periodo` pontos (hoje incluso), com zero onde não há dado (`serieComTodosOsDias`.8). O
  // rótulo do total bate com a contagem real de pontos do eixo (revisão final B, item m8).
  const entradasSerie = periodo === "todo"
    ? linhasDias.map((l) => ({ data: l.dia, valor: Number(l.entradas) }))
    : serieComTodosOsDias(linhasDias.map((l) => ({ data: l.dia, valor: Number(l.entradas) })), periodo);
  const saidasSerie = periodo === "todo"
    ? linhasDias.map((l) => ({ data: l.dia, valor: Number(l.saidas) }))
    : serieComTodosOsDias(linhasDias.map((l) => ({ data: l.dia, valor: Number(l.saidas) })), periodo);
  const rotuloPeriodo = periodo === "todo" ? "todo o período" : `últimos ${periodo} dias`;

  const url = (o: { numero?: string; grupo?: string | null; evento?: Evento | null; inicio?: string; fim?: string; pagina?: number; periodo?: PeriodoGrafico } = {}) => {
    const p = new URLSearchParams();
    const n = o.numero ?? numero;
    if (n) p.set("numero", n);
    const g = o.grupo ?? grupo;
    if (g) p.set("grupo", g);
    const e = "evento" in o ? o.evento : evento;
    if (e) p.set("evento", e);
    const i = o.inicio ?? sp.inicio;
    if (i) p.set("inicio", i);
    const f = o.fim ?? sp.fim;
    if (f) p.set("fim", f);
    if (o.pagina && o.pagina > 1) p.set("pagina", String(o.pagina));
    const per = o.periodo ?? periodo;
    if (per !== "todo") p.set("periodo", String(per));
    const s = p.toString();
    return `/campanhas/${id}/atividades${s ? `?${s}` : ""}`;
  };
  const exportar = (() => {
    const p = new URLSearchParams({ campanha: id });
    if (numero) p.set("q", numero);
    if (grupo) p.set("grupo", grupo);
    if (evento) p.set("evento", evento);
    if (sp.inicio) p.set("inicio", sp.inicio);
    if (sp.fim) p.set("fim", sp.fim);
    return `/api/exportar/atividades?${p.toString()}`;
  })();

  return (
    <Pagina
      titulo="Histórico de atividades"
      infoTitulo={
        <BotaoInfo
          titulo="Histórico de atividades"
          texto={<p>Entradas e saídas por dia · {rotuloPeriodo}</p>}
        />
      }
      acoes={verLeads ? <a href={exportar} className={estiloBotao("contorno")}><Icone nome="download" />EXPORTAR HISTORICO</a> : undefined}
    >
      <Cartao>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="relative block w-full sm:w-56">
            <span className="pointer-events-none absolute -top-2 left-2 z-10 bg-vg-bg px-1 text-[11px] leading-4 text-vg-text-2">Número</span>
            <span className="absolute -top-3 left-14 z-10"><BotaoInfo titulo="Número" texto="Número com DDI, só dígitos." rotulo="Número com DDI, só dígitos" tamanho={14} /></span>
            <CampoTextoEnviar name="numero" defaultValue={numero} ariaLabel="Filtrar por número" title="Número com DDI, só dígitos" className="w-full rounded border border-vg-line-2 bg-transparent px-3 pt-2.5 pb-2 text-[13.3px] text-vg-text outline-none transition placeholder:text-vg-text-3 hover:border-white/60 focus:border-vg-accent focus:ring-1 focus:ring-vg-accent" />
          </label>
          <label className="relative block w-full sm:w-56">
            <span className="pointer-events-none absolute -top-2 left-2 bg-vg-bg px-1 text-[11px] leading-4 text-vg-text-2">Grupo</span>
            <SelectEnviar name="grupo" defaultValue={grupo ?? ""} ariaLabel="Filtrar por grupo" className="w-full rounded border border-vg-line-2 bg-transparent px-3 pt-2.5 pb-2 text-[13.3px] text-vg-text outline-none transition hover:border-white/60 focus:border-vg-accent focus:ring-1 focus:ring-vg-accent">
              <option value="">Todos</option>
              {(grupos ?? []).map((g) => <option key={g.id} value={g.id}>#{g.numero} {g.nome}</option>)}
            </SelectEnviar>
          </label>
          <label className="relative block w-full sm:w-44">
            <span className="pointer-events-none absolute -top-2 left-2 bg-vg-bg px-1 text-[11px] leading-4 text-vg-text-2">Evento</span>
            <SelectEnviar name="evento" defaultValue={evento ?? ""} ariaLabel="Filtrar por evento" className="w-full rounded border border-vg-line-2 bg-transparent px-3 pt-2.5 pb-2 text-[13.3px] text-vg-text outline-none transition hover:border-white/60 focus:border-vg-accent focus:ring-1 focus:ring-vg-accent">
              {EVENTOS.map((e) => <option key={e.rotulo} value={e.valor ?? ""}>{e.rotulo}</option>)}
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
          {periodo !== "todo" && <input type="hidden" name="periodo" value={periodo} />}
        </form>
      </Cartao>

      <Tabela colunas={["Número", "Grupo", "Evento", "Data"]} vazio={lista.length ? undefined : "Nenhuma atividade encontrada"}>
        {lista.map((l, i) => (
          <tr key={`${l.telefone}-${l.grupo_id}-${l.evento}-${i}`}>
            <td className="px-3 py-2.5 tabular-nums">{telefoneLegivel(l.telefone)}</td>
            <td className="px-3 py-2.5">#{l.grupo_numero} {l.grupo_nome}</td>
            <td className="px-3 py-2.5"><Selo cor={l.evento === "entrada" ? "ok" : "erro"}>{rotuloEvento(l.evento)}</Selo></td>
            <td className="px-3 py-2.5 tabular-nums">{dataHoraCompleta(l.em)}</td>
          </tr>
        ))}
      </Tabela>
      {total > 0 && (
        <Paginacao
          de={de + 1}
          ate={Math.min(de + POR_PAGINA_ATIVIDADES, total)}
          total={total}
          porPagina={POR_PAGINA_ATIVIDADES}
          primeira={pagina > 1 ? url({ pagina: 1 }) : undefined}
          anterior={pagina > 1 ? url({ pagina: pagina - 1 }) : undefined}
          proxima={pagina < totalPaginas ? url({ pagina: pagina + 1 }) : undefined}
          ultima={pagina < totalPaginas ? url({ pagina: totalPaginas }) : undefined}
        />
      )}

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-vg-muted">Entradas e saídas por dia</p>
          <FaixaBotoes>
            {PERIODOS_GRAFICO.map((p) => (
              <BotaoFaixa key={p.valor} caixaNormal href={url({ periodo: p.valor })} ativo={p.valor === periodo}>{p.rotulo}</BotaoFaixa>
            ))}
          </FaixaBotoes>
        </div>
        <GraficoMetrica
          titulo="Atividade Diaria"
          series={[
            { nome: "Entraram", valores: entradasSerie.map((d) => d.valor), cor: "destaque" },
            { nome: "Sairam", valores: saidasSerie.map((d) => d.valor), cor: "neutro" },
          ]}
          diasRotulo={periodo === "todo" ? undefined : periodo}
          atualizar={false}
          telaCheia={false}
          idGradiente="vg-grafico-atividade"
        />
      </div>
    </Pagina>
  );
}
