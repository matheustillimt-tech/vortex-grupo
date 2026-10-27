import Link from "next/link";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";
import { permitido } from "@/src/lib/permissoes";
import { formatarNumero } from "@/src/lib/regras/inicio";
import {
  AGRUPAMENTOS,
  alternarTipo,
  AVISO_DADOS_POR_PESSOA,
  CHIPS_RECIBO,
  deslocamentoDaPagina,
  janelaDoVolume,
  lerAgrupamento,
  lerTipos,
  porHoraDoDia,
  POR_PAGINA_LEADSCORE,
  serieDoVolume,
  tiposParaParametro,
  type Agrupamento,
  type TipoRecibo,
  type VolumeLinha,
} from "@/src/lib/regras/leadscore";
import { telefoneLegivel } from "@/src/lib/telefone";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { BotaoFaixa, FaixaBotoes } from "../../../_componentes/faixa-botoes";
import { GraficoMetrica } from "../../../_componentes/grafico-metrica";
import { Icone } from "../../../_componentes/icone";
import { Paginacao } from "../../../_componentes/paginacao";
import { estiloBotao, estiloInput, Pagina, Tabela } from "../../../_componentes/ui";
import { MenuLinha } from "./menu-linha";

export const dynamic = "force-dynamic";

type Linha = { telefone: string; pontos: number; recebeu: number; visualizou: number; reproduziu: number; total: number };

/** Aba Leadscoring: pontos por pessoa na campanha, a partir dos recibos por pessoa. */
export default async function Leadscoring({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; tipos?: string; agrupar?: string; pagina?: string }>;
}) {
  const b = await bloqueio("campanhas");
  if (b) return b;
  const verLeads = await permitido("leads", "ver");
  const { id } = await params;
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 40);
  const tipos = lerTipos(sp.tipos);
  const agrupar = lerAgrupamento(sp.agrupar);
  const pagina = Math.max(1, Math.floor(Number(sp.pagina)) || 1);
  const janela = janelaDoVolume(agrupar);
  const pTipos = tiposParaParametro(tipos) ? tipos : null;

  const db = await dbUsuario();
  const [{ data: linhas, error: erroLinhas }, { data: volume, error: erroVolume }] = await Promise.all([
    db.rpc("leadscore_campanha", {
      p_campanha: id, p_busca: q || null, p_limite: POR_PAGINA_LEADSCORE, p_deslocamento: deslocamentoDaPagina(pagina), p_tipos: pTipos,
    }),
    db.rpc("volume_recibos", { p_campanha: id, p_agrupar: agrupar, p_inicio: janela.inicio.toISOString() }),
  ]);
  if (erroLinhas) throw new Error("Não foi possível carregar o leadscoring.");
  if (erroVolume) throw new Error("Não foi possível carregar o volume de recibos.");

  const lista = ((linhas ?? []) as Linha[]).map((l) => ({ ...l, pontos: Number(l.pontos), total: Number(l.total) }));
  const total = lista[0]?.total ?? 0;
  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA_LEADSCORE));
  const de = deslocamentoDaPagina(pagina);
  // Gráfico empilhado: sempre as 3 séries (Recebeu/Visualizou/Reproduziu), sem os chips de
  // "Status:" — esses continuam filtrando só o ranking por pessoa (`pTipos`) e o CSV. "Volume por hora" agrupa
  // por hora do dia (00h…23h).9; os outros agrupamentos continuam na linha do
  // tempo de hoje.
  const aplicarAgrupamento = (s: { data: string; valor: number; rotulo: string }[]) => (agrupar === "hora" ? porHoraDoDia(s) : s);
  const serieRecebeu = aplicarAgrupamento(serieDoVolume((volume ?? []) as VolumeLinha[], agrupar, ["recebeu"]));
  const serieVisualizou = aplicarAgrupamento(serieDoVolume((volume ?? []) as VolumeLinha[], agrupar, ["visualizou"]));
  const serieReproduziu = aplicarAgrupamento(serieDoVolume((volume ?? []) as VolumeLinha[], agrupar, ["reproduziu"]));
  const empilhado = [
    { nome: "Recebeu", valores: serieRecebeu.map((p) => p.valor), cor: "#0FA968" },
    { nome: "Visualizou", valores: serieVisualizou.map((p) => p.valor), cor: "#F1CE87" },
    { nome: "Reproduziu", valores: serieReproduziu.map((p) => p.valor), cor: "#7FB8E6" },
  ];
  const totalVolume = empilhado.reduce((s, serie) => s + serie.valores.reduce((a, v) => a + v, 0), 0);

  const url = (o: { tipos?: TipoRecibo[]; agrupar?: Agrupamento; pagina?: number } = {}) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    const t = tiposParaParametro(o.tipos ?? tipos);
    if (t) p.set("tipos", t);
    const a = o.agrupar ?? agrupar;
    if (a !== "hora") p.set("agrupar", a);
    if (o.pagina && o.pagina > 1) p.set("pagina", String(o.pagina));
    const s = p.toString();
    return `/campanhas/${id}/leadscoring${s ? `?${s}` : ""}`;
  };
  const exportar = (() => {
    const p = new URLSearchParams({ campanha: id });
    const t = tiposParaParametro(tipos);
    if (t) p.set("tipos", t);
    if (q) p.set("q", q);
    return `/api/exportar/leadscore?${p.toString()}`;
  })();

  return (
    <Pagina
      titulo="Leadscoring"
      subtitulo={AVISO_DADOS_POR_PESSOA}
      acoes={verLeads ? <a href={exportar} className={estiloBotao("contorno")}><Icone nome="download" />EXPORTAR</a> : undefined}
    >
      <div className="space-y-3">
        <form method="get" className="flex items-center gap-2">
          {tiposParaParametro(tipos) && <input type="hidden" name="tipos" value={tiposParaParametro(tipos) ?? ""} />}
          {agrupar !== "hora" && <input type="hidden" name="agrupar" value={agrupar} />}
          <label className="relative block w-full max-w-sm">
            <span className="pointer-events-none absolute -top-2 left-8 z-10 bg-vg-bg px-1 text-[11px] leading-4 text-vg-text-2">Buscar</span>
            <Icone nome="search" tamanho={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-vg-text-3" />
            <input type="search" name="q" defaultValue={q} aria-label="Buscar número" className={`${estiloInput} pl-9`} />
          </label>
        </form>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-vg-muted">Status:</span>
          {CHIPS_RECIBO.map((c) => {
            const ligado = tipos.includes(c.tipo);
            return (
              <Link
                key={c.tipo}
                href={url({ tipos: alternarTipo(tipos, c.tipo) })}
                scroll={false}
                aria-pressed={ligado}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] transition-colors ${
                  ligado ? "border-vg-accent bg-vg-accent/15 text-vg-accent" : "border-vg-line-2 text-vg-text-2 hover:bg-white/5"
                }`}
              >
                <Icone nome={c.icone} tamanho={16} />
                {c.rotulo}
              </Link>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-vg-muted">{janela.subtitulo}</p>
          <FaixaBotoes>
            {AGRUPAMENTOS.map((a) => (
              <BotaoFaixa key={a.valor} href={url({ agrupar: a.valor })} ativo={a.valor === agrupar}>{a.rotulo}</BotaoFaixa>
            ))}
          </FaixaBotoes>
        </div>
        <GraficoMetrica titulo={janela.titulo} total={formatarNumero(totalVolume)} rotuloTotal={`recibos · ${janela.subtitulo.toLowerCase()}`} empilhado={empilhado} idGradiente="vg-grafico-leadscore" />
      </div>

      <Tabela colunas={["#", "Número", "Pontos", ""]} vazio={lista.length ? undefined : q ? "Nenhum número encontrado" : "Nenhum recibo por pessoa ainda"}>
        {lista.map((l, i) => (
          <tr key={l.telefone}>
            <td className="px-3 py-2.5 tabular-nums text-vg-muted">{de + i + 1}</td>
            <td className="px-3 py-2.5 tabular-nums">{telefoneLegivel(l.telefone)}</td>
            <td className="px-3 py-2.5 tabular-nums">{formatarNumero(l.pontos)}</td>
            <td className="px-3 py-2.5 text-right"><MenuLinha telefone={l.telefone} /></td>
          </tr>
        ))}
      </Tabela>
      {total > 0 && (
        <Paginacao
          de={de + 1}
          ate={Math.min(de + POR_PAGINA_LEADSCORE, total)}
          total={total}
          porPagina={POR_PAGINA_LEADSCORE}
          primeira={pagina > 1 ? url({ pagina: 1 }) : undefined}
          anterior={pagina > 1 ? url({ pagina: pagina - 1 }) : undefined}
          proxima={pagina < totalPaginas ? url({ pagina: pagina + 1 }) : undefined}
          ultima={pagina < totalPaginas ? url({ pagina: totalPaginas }) : undefined}
        />
      )}
    </Pagina>
  );
}
