import Link from "next/link";
import { carregarCalendario } from "@/src/lib/calendario";
import { janelaDaGrade, janelaDoDiaUnico, matrizDoMes, validarDataAncora, validarVisao } from "@/src/lib/regras/calendario-grade";
import { janelaDoPeriodo } from "@/src/lib/regras/linha-do-tempo";
import { inicioDoDiaBrasilia } from "@/src/lib/regras/metricas";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { AlternanciaCalendario, GradeMensal, GradeSemanal } from "../_componentes/calendario-grade";
import { Calendario } from "../_componentes/calendario";
import { FiltrosCalendario } from "../_componentes/filtros-calendario";
import { Pagina } from "../_componentes/ui";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";
import { permitido } from "@/src/lib/permissoes";

export const dynamic = "force-dynamic";

export default async function CalendarioGeral({ searchParams }: { searchParams: Promise<{ campanha?: string; periodo?: string; visao?: string; data?: string; dia?: string }> }) {
  const b = await bloqueio("campanhas");
  if (b) return b;
  const podeEditar = await permitido("campanhas", "editar");
  const sp = await searchParams;
  const db = await dbUsuario();
  const agora = new Date();
  const visao = validarVisao(sp.visao);
  const dataAncora = validarDataAncora(sp.data, agora);
  const hoje = validarDataAncora(undefined, agora);
  const { data: dadosCamp, error } = await db.from("campanhas").select("id, nome, data_aula").eq("arquivada", false).order("nome");
  if (error) throw new Error(`Não foi possível ler as campanhas: ${error.message}`);
  const campanhas = (dadosCamp ?? []) as { id: string; nome: string; data_aula: string | null }[];
  const escolhida = campanhas.find((c) => c.id === sp.campanha) ?? null;
  // D-N só quando o calendário mostra uma campanha só.
  const unica = escolhida ?? (campanhas.length === 1 ? campanhas[0] : null);
  const janelaAgenda = janelaDoPeriodo(sp.periodo, new Date(inicioDoDiaBrasilia(agora)), 7);
  // Agenda com ?dia=: mostra só aquele dia (clique num dia do mês/semana ou no "+N" de uma célula) — `dia` é um
  // parâmetro separado de `data` (a âncora) de propósito: o alternador de visão e o filtro "Filtrar" continuam
  // só com `data`/`periodo`, pra voltarem ao período normal (±45 dias, com executar/cancelar) em vez do dia só.
  const diaUnico = visao === "agenda" ? janelaDoDiaUnico(sp.dia) : null;
  const janela = diaUnico ?? (visao === "agenda" ? janelaAgenda : janelaDaGrade(visao, dataAncora));
  const { dias, nomes, lidos } = await carregarCalendario(db, escolhida?.id ?? null, janela.de, janela.ate, agora);
  const porDia = new Map(dias.map((d) => [d.dia, d.itens]));
  const extra: Record<string, string> = escolhida ? { campanha: escolhida.id } : {};
  // "Ver período": mesma visão/âncora/período, só tira o `dia`.
  const paramsPeriodo = new URLSearchParams({ ...extra, visao });
  if (sp.periodo) paramsPeriodo.set("periodo", sp.periodo);
  if (sp.data) paramsPeriodo.set("data", sp.data);
  const hrefPeriodo = `/calendario?${paramsPeriodo.toString()}`;

  return (
    <Pagina
      titulo="Calendário"
      subtitulo="Todas as campanhas ativas. Passos de sequência ainda não agendados aparecem como projetados."
      acoes={
        <div className="flex flex-wrap items-center gap-2">
          <AlternanciaCalendario visao={visao} data={dataAncora} baseHref="/calendario" extra={extra} />
          {diaUnico ? (
            <Link href={hrefPeriodo} className="text-sm font-medium text-vg-accent-2 transition-colors hover:text-vg-accent-3">Ver período</Link>
          ) : (
            <FiltrosCalendario campanhas={campanhas} campanha={escolhida?.id ?? ""} periodo={janelaAgenda.periodo} diasAntes={7} visao={visao} data={dataAncora} mostrarPeriodo={visao === "agenda"} />
          )}
        </div>
      }
    >
      {visao === "mes" && <GradeMensal semanas={matrizDoMes(dataAncora)} hoje={hoje} porDia={porDia} baseHref="/calendario" extra={extra} />}
      {visao === "semana" && <GradeSemanal data={dataAncora} hoje={hoje} porDia={porDia} baseHref="/calendario" extra={extra} />}
      {visao === "agenda" && <Calendario dias={dias} nomes={escolhida ? undefined : nomes} dataAula={unica?.data_aula ?? null} lidos={lidos} agora={agora} podeEditar={podeEditar} />}
    </Pagina>
  );
}
