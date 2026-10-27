import Link from "next/link";
import type { ItemCalendario } from "@/src/lib/regras/calendario";
import { corDaSituacao } from "@/src/lib/regras/calendario";
import {
  navegarAncora,
  rotuloEvento,
  rotuloMes,
  semanaDoDia,
  validarDataAncora,
  type Visao,
} from "@/src/lib/regras/calendario-grade";
import { ROTULO_TIPO } from "@/src/lib/regras/conteudo";
import { Icone } from "./icone";
import { PONTO } from "./ui";

const fmtHora = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
const fmtDataLonga = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "full" });
const fmtDataCurta = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
/** Sem `uppercase` no CSS: "dom.", "seg." … como lá, não "DOM", "SEG". */
const SEMANA_ABREV = ["dom.", "seg.", "ter.", "qua.", "qui.", "sex.", "sáb."];

function montarHref(baseHref: string, extra: Record<string, string>, params: Record<string, string>): string {
  const sp = new URLSearchParams({ ...extra, ...params });
  return `${baseHref}?${sp.toString()}`;
}

const botaoNav = "grid size-8 shrink-0 place-items-center rounded-lg border border-vg-line-2 text-vg-text transition-colors hover:bg-white/5";
const botaoVisao = (ativo: boolean) =>
  `grid size-8 shrink-0 place-items-center rounded-lg transition-colors ${ativo ? "bg-vg-primario text-white" : "border border-vg-line-2 text-vg-muted hover:bg-white/5"}`;

/** Botão "today", setas de mês/semana e alternância mês/semana/agenda. Tudo em `<Link>` (GET), sem JS. */
export function AlternanciaCalendario({ visao, data, baseHref, extra = {} }: { visao: Visao; data: string; baseHref: string; extra?: Record<string, string> }) {
  const hoje = validarDataAncora(undefined);
  const navegavel = visao === "mes" || visao === "semana";
  const rotulo =
    visao === "mes"
      ? rotuloMes(data)
      : visao === "semana"
        ? (() => {
            const [d0, , , , , , d6] = semanaDoDia(data);
            return `${fmtDataCurta.format(new Date(`${d0}T12:00:00Z`))} – ${fmtDataCurta.format(new Date(`${d6}T12:00:00Z`))}`;
          })()
        : null;

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Sem título "Calendário" aqui (revisão final B, item m9): as duas páginas que usam este alternador já
       *  abrem com `<Pagina titulo="Calendário">` — um segundo "Calendário" só duplicava o título da página. */}
      {navegavel && (
        <Link href={montarHref(baseHref, extra, { visao, data: hoje })} role="button" aria-label="Ir para hoje" title="Hoje" className={botaoNav}>
          <Icone nome="today" tamanho={18} />
        </Link>
      )}
      <div className="flex items-center gap-1.5" role="group" aria-label="Visão do calendário">
        <Link href={montarHref(baseHref, extra, { visao: "mes", data })} aria-label="Visão em mês" title="Mês" className={botaoVisao(visao === "mes")}>
          <Icone nome="view_module" tamanho={18} />
        </Link>
        <Link href={montarHref(baseHref, extra, { visao: "semana", data })} aria-label="Visão em semana" title="Semana" className={botaoVisao(visao === "semana")}>
          <Icone nome="view_week" tamanho={18} />
        </Link>
        <Link href={montarHref(baseHref, extra, { visao: "agenda", data })} aria-label="Visão em agenda" title="Agenda" className={botaoVisao(visao === "agenda")}>
          <Icone nome="view_agenda" tamanho={18} />
        </Link>
      </div>
      {navegavel && (
        <div className="flex items-center gap-1.5">
          <Link href={montarHref(baseHref, extra, { visao, data: navegarAncora(visao, data, -1) })} role="button" aria-label={visao === "mes" ? "Mês anterior" : "Semana anterior"} className={botaoNav}>
            <Icone nome="chevron_left" tamanho={18} />
          </Link>
          {rotulo && <p className="min-w-[11ch] px-1 text-sm font-medium">{rotulo}</p>}
          <Link href={montarHref(baseHref, extra, { visao, data: navegarAncora(visao, data, 1) })} role="button" aria-label={visao === "mes" ? "Próximo mês" : "Próxima semana"} className={botaoNav}>
            <Icone nome="chevron_right" tamanho={18} />
          </Link>
        </div>
      )}
    </div>
  );
}

function EventoNaCelula({ item }: { item: ItemCalendario }) {
  const cor = corDaSituacao(item.situacao, item.detalhe);
  const rotulo = rotuloEvento(item.tipo, item.origem, fmtHora.format(new Date(item.quando)), item.automacaoNome);
  const conteudo = (
    <span className="flex min-w-0 items-center gap-1.5">
      <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${PONTO[cor]}`} />
      <span className="min-w-0 truncate">{rotulo}</span>
    </span>
  );
  return item.execucaoId ? (
    <Link href={`/campanhas/${item.campanhaId}/mensagens/${item.execucaoId}`} className="block truncate rounded px-1 py-0.5 text-[11px] text-vg-text-2 transition-colors hover:bg-white/5 hover:text-vg-text" title={`${ROTULO_TIPO[item.tipo]} · ${rotulo}`}>
      {conteudo}
    </Link>
  ) : (
    <p className="truncate px-1 py-0.5 text-[11px] text-vg-text-2" title={rotulo}>
      {conteudo}
    </p>
  );
}

/** Todos os eventos do dia, numa lista com rolagem interna — sem "+N" (Etapa 3N): um dia muito cheio cresce
 *  dentro da própria célula em vez de cortar o resto atrás de um link. */
function ListaEventos({ itens, className = "" }: { itens: ItemCalendario[]; className?: string }) {
  return (
    <div className={`min-w-0 max-h-32 space-y-0.5 overflow-y-auto ${className}`}>
      {itens.map((i) => <EventoNaCelula key={i.chave} item={i} />)}
    </div>
  );
}

/** Resumo só de bolinhas (sem texto), pra não vazar da célula no mobile — toca no número do dia abre a agenda. */
function PontosDoDia({ itens }: { itens: ItemCalendario[] }) {
  if (!itens.length) return null;
  const visiveis = itens.slice(0, 6);
  return (
    <div className="flex flex-wrap items-center gap-1 px-1">
      {visiveis.map((i) => <span key={i.chave} aria-hidden className={`size-1.5 rounded-full ${PONTO[corDaSituacao(i.situacao, i.detalhe)]}`} />)}
      {itens.length > visiveis.length && <span className="text-[10px] text-vg-text-3">+{itens.length - visiveis.length}</span>}
    </div>
  );
}

function Celula({ dia, hoje, itens, baseHref, extra }: { dia: string; hoje: string; itens: ItemCalendario[]; baseHref: string; extra: Record<string, string> }) {
  const ehHoje = dia === hoje;
  const numero = Number(dia.slice(8, 10));
  const rotuloCompleto = fmtDataLonga.format(new Date(`${dia}T12:00:00Z`));

  return (
    <div role="gridcell" aria-label={rotuloCompleto} className="flex min-h-[64px] min-w-0 flex-col gap-0.5 border-b border-r border-vg-line p-1 sm:min-h-[104px] sm:p-1.5">
      <Link
        href={montarHref(baseHref, extra, { visao: "agenda", data: dia, dia })}
        className={`mb-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium transition-colors hover:bg-white/10 ${ehHoje ? "bg-vg-primario text-white" : "text-vg-text-2"}`}
        aria-label={`Abrir agenda de ${rotuloCompleto}`}
      >
        {numero}
      </Link>
      {/* Mobile: só as bolinhas, pra grade não vazar da tela. A partir de sm: lista com todos os eventos (sem "+N"). */}
      <div className="sm:hidden"><PontosDoDia itens={itens} /></div>
      <ListaEventos itens={itens} className="hidden sm:block" />
    </div>
  );
}

/** Grade mensal dom.–sáb. (com os dias de completar das semanas), cada dia com todos os eventos (célula cresce). */
export function GradeMensal({ semanas, hoje, porDia, baseHref, extra = {} }: { semanas: string[][]; hoje: string; porDia: Map<string, ItemCalendario[]>; baseHref: string; extra?: Record<string, string> }) {
  return (
    <div role="grid" aria-label="Calendário em grade mensal" className="overflow-hidden rounded-xl border-l border-t border-vg-line">
      <div role="row" className="grid grid-cols-7 border-b border-vg-line bg-vg-panel-3 text-center text-[11px] font-medium text-vg-text-3">
        {SEMANA_ABREV.map((s) => <div key={s} role="columnheader" className="border-r border-vg-line px-1 py-1.5 last:border-r-0">{s}</div>)}
      </div>
      {semanas.map((semana, i) => (
        <div key={i} role="row" className="grid grid-cols-7">
          {semana.map((dia) => <Celula key={dia} dia={dia} hoje={hoje} itens={porDia.get(dia) ?? []} baseHref={baseHref} extra={extra} />)}
        </div>
      ))}
    </div>
  );
}

/** 7 colunas (dom.–sáb.), cada uma a lista do dia ordenada por horário — sem grade de hora. */
export function GradeSemanal({ data, hoje, porDia, baseHref, extra = {} }: { data: string; hoje: string; porDia: Map<string, ItemCalendario[]>; baseHref: string; extra?: Record<string, string> }) {
  const dias = semanaDoDia(data);
  return (
    <div role="grid" aria-label="Calendário em grade semanal" className="grid grid-cols-1 gap-2 sm:grid-cols-7">
      {dias.map((dia, i) => {
        const itens = porDia.get(dia) ?? [];
        return (
          <div key={dia} role="gridcell" aria-label={fmtDataLonga.format(new Date(`${dia}T12:00:00Z`))} className="min-w-0 rounded-xl border border-vg-line p-2">
            <Link
              href={montarHref(baseHref, extra, { visao: "agenda", data: dia, dia })}
              className={`mb-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold transition-colors hover:bg-white/10 ${dia === hoje ? "bg-vg-primario text-white" : "text-vg-text-2"}`}
            >
              {SEMANA_ABREV[i]} {dia.slice(8, 10)}/{dia.slice(5, 7)}
            </Link>
            <ListaEventos itens={itens} />
            {!itens.length && <p className="px-1 text-[11px] text-vg-text-3">Nada.</p>}
          </div>
        );
      })}
    </div>
  );
}
