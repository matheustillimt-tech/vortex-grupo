import Link from "next/link";
import { carregarCalendario } from "@/src/lib/calendario";
import { janelaDaGrade, janelaDoDiaUnico, matrizDoMes, validarDataAncora, validarVisao } from "@/src/lib/regras/calendario-grade";
import { janelaDoPeriodo } from "@/src/lib/regras/linha-do-tempo";
import { inicioDoDiaBrasilia } from "@/src/lib/regras/metricas";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { AlternanciaCalendario, GradeMensal, GradeSemanal } from "../../../_componentes/calendario-grade";
import { Calendario } from "../../../_componentes/calendario";
import { FiltrosCalendario } from "../../../_componentes/filtros-calendario";
import { Pagina } from "../../../_componentes/ui";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";
import { permitido } from "@/src/lib/permissoes";

export const dynamic = "force-dynamic";

export default async function CalendarioCampanha({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ periodo?: string; visao?: string; data?: string; dia?: string }> }) {
  const b = await bloqueio("campanhas");
  if (b) return b;
  const podeEditar = await permitido("campanhas", "editar");
  const { id } = await params;
  const sp = await searchParams;
  const db = await dbUsuario();
  const agora = new Date();
  const visao = validarVisao(sp.visao);
  const dataAncora = validarDataAncora(sp.data, agora);
  const hoje = validarDataAncora(undefined, agora);
  const janelaAgenda = janelaDoPeriodo(sp.periodo, new Date(inicioDoDiaBrasilia(agora)), 30);
  // Agenda com ?dia=: mostra só aquele dia (clique num dia do mês/semana ou no "+N" de uma célula) — `dia` é um
  // parâmetro separado de `data` (a âncora) de propósito: o alternador de visão e o filtro "Filtrar" continuam
  // só com `data`/`periodo`, pra voltarem ao período normal (±45 dias, com executar/cancelar) em vez do dia só.
  const diaUnico = visao === "agenda" ? janelaDoDiaUnico(sp.dia) : null;
  const janela = diaUnico ?? (visao === "agenda" ? janelaAgenda : janelaDaGrade(visao, dataAncora));
  const baseHref = `/campanhas/${id}/calendario`;
  const [{ data: camp }, { dias, lidos }] = await Promise.all([
    db.from("campanhas").select("data_aula").eq("id", id).maybeSingle(),
    carregarCalendario(db, id, janela.de, janela.ate, agora),
  ]);
  const porDia = new Map(dias.map((d) => [d.dia, d.itens]));
  // "Ver período": mesma visão/âncora/período, só tira o `dia`.
  const paramsPeriodo = new URLSearchParams({ visao });
  if (sp.periodo) paramsPeriodo.set("periodo", sp.periodo);
  if (sp.data) paramsPeriodo.set("data", sp.data);
  const hrefPeriodo = `${baseHref}?${paramsPeriodo.toString()}`;

  return (
    <Pagina
      titulo="Calendário"
      acoes={
        <div className="flex flex-wrap items-center gap-2">
          <AlternanciaCalendario visao={visao} data={dataAncora} baseHref={baseHref} />
          {diaUnico ? (
            <Link href={hrefPeriodo} className="text-sm font-medium text-vg-accent-2 transition-colors hover:text-vg-accent-3">Ver período</Link>
          ) : (
            <FiltrosCalendario periodo={janelaAgenda.periodo} diasAntes={30} visao={visao} data={dataAncora} mostrarPeriodo={visao === "agenda"} />
          )}
        </div>
      }
    >
      {visao === "mes" && <GradeMensal semanas={matrizDoMes(dataAncora)} hoje={hoje} porDia={porDia} baseHref={baseHref} />}
      {visao === "semana" && <GradeSemanal data={dataAncora} hoje={hoje} porDia={porDia} baseHref={baseHref} />}
      {visao === "agenda" && <Calendario dias={dias} dataAula={(camp?.data_aula as string | null) ?? null} lidos={lidos} agora={agora} podeEditar={podeEditar} />}
    </Pagina>
  );
}
