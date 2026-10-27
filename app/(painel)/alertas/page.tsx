import Link from "next/link";
import { redirect } from "next/navigation";
import { escaparBuscaIlike } from "@/src/lib/regras/busca";
import { isoParaBrasilia } from "@/src/lib/regras/horario";
import { agruparAlertas, contaDoAlerta, INFO_ALERTA, lerFiltrosAlertas, tipoAlertaValido, urlAlertas, type LinhaAlerta } from "@/src/lib/regras/alertas";
import { permitido } from "@/src/lib/permissoes";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { marcarTodosVistos } from "../actions";
import { Icone } from "../_componentes/icone";
import { Informativo } from "../_componentes/numeros";
import { Paginacao } from "../_componentes/paginacao";
import { estiloAcao, estiloCartao, estiloBotao, Pagina, Selo, Vazio } from "../_componentes/ui";
import { FiltrosAlertasBarra } from "./filtros";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";

export const dynamic = "force-dynamic";

const POR_PAGINA = 12;

export default async function Alertas({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const b = await bloqueio("metricas");
  if (b) return b;

  const f = lerFiltrosAlertas(await searchParams);
  const db = await dbUsuario();
  const inicio = (f.pagina - 1) * POR_PAGINA;
  const verContas = await permitido("contas", "ver");

  const { data: contas, error: erroContas } = await db.from("conexoes").select("id, nome").order("nome");
  const listaContas: { id: string; nome: string }[] = erroContas ? [] : contas ?? [];
  const contaFiltro = f.conta ? listaContas.find((c) => c.id === f.conta) : undefined;

  // Conta escolhida não existe mais (removida entre o clique no filtro e agora): não há como ela ter deixado
  // algum alerta, nem com o fallback de texto — nenhuma linha bate. Volta vazio sem nem consultar o banco.
  let linhas: LinhaAlerta[] = [];
  let total = 0;
  if (!f.conta || contaFiltro) {
    let consulta = db.from("alertas").select("id, created_at, tipo, texto, campanha_id, conexao_id, visto", { count: "exact" });
    if (f.tipo) consulta = consulta.eq("tipo", f.tipo);
    if (f.inicio) consulta = consulta.gte("created_at", `${f.inicio}T00:00:00-03:00`);
    if (f.fim) consulta = consulta.lte("created_at", `${f.fim}T23:59:59-03:00`);
    if (contaFiltro) {
      // `conexao_id` é o dado de verdade (Etapa 3A, revisão); o nome dentro do texto fica só de fallback pras
      // linhas antigas, gravadas antes da coluna existir (essas sempre têm `conexao_id` nulo).
      consulta = consulta.or(`conexao_id.eq.${contaFiltro.id},and(conexao_id.is.null,texto.ilike.${escaparBuscaIlike(contaFiltro.nome)})`);
    }
    consulta = consulta.order("created_at", { ascending: false }).order("id", { ascending: false }).range(inicio, inicio + POR_PAGINA - 1);

    const { data, count, error } = await consulta;
    if (error) throw new Error(`Não foi possível carregar os alertas: ${error.message}`);
    linhas = (data ?? []) as LinhaAlerta[];
    total = count ?? 0;
  }
  if (!linhas.length && f.pagina > 1) redirect(urlAlertas(f, { pagina: 1 }));

  const idsCampanha = [...new Set(linhas.map((l) => l.campanha_id).filter((id): id is string => !!id))];
  const { data: campanhasData } = idsCampanha.length
    ? await db.from("campanhas").select("id, nome").in("id", idsCampanha)
    : { data: [] as { id: string; nome: string }[] };
  const nomeCampanha = new Map((campanhasData ?? []).map((c) => [c.id, c.nome]));

  const ate = inicio + linhas.length;
  const grupos = agruparAlertas(linhas, f.agrupar, listaContas);

  return (
    <Pagina titulo="Alertas" subtitulo="Visualize quedas de número, grupos cheios, sumidos e erros de envio e criação">
      <Informativo>
        <strong>Legenda:</strong>
        <br />
        Quando um grupo exibir apenas o GID (ex.: 120363000000000000) em vez do nome, o grupo já foi excluído do sistema.
        <br />
        Quando aparecer &quot;Conexão não encontrada&quot;, a conexão não existe mais no sistema.
      </Informativo>

      <FiltrosAlertasBarra filtros={f} contas={listaContas} verContas={verContas} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <form action={marcarTodosVistos}>
          <button type="submit" className={estiloBotao("secundario")}>
            Marcar todos como vistos
          </button>
        </form>
        <Paginacao
          de={total ? inicio + 1 : 0}
          ate={ate}
          total={total}
          porPagina={POR_PAGINA}
          anterior={f.pagina > 1 ? urlAlertas(f, { pagina: f.pagina - 1 }) : undefined}
          proxima={ate < total ? urlAlertas(f, { pagina: f.pagina + 1 }) : undefined}
        />
      </div>

      {!grupos.length ? (
        <div className={estiloCartao}>
          <Vazio
            texto={total === 0 && !f.tipo && !f.conta && !f.inicio && !f.fim ? "Nenhum alerta encontrado" : "Não há registros de alertas com os filtros aplicados."}
          />
        </div>
      ) : (
        <div className="space-y-5">
          {grupos.map((g) => (
            <section key={g.chave} className="space-y-2">
              {g.rotulo && <h2 className="text-xs font-medium uppercase tracking-wide text-vg-muted">{g.rotulo}</h2>}
              <div className={`${estiloCartao} divide-y divide-vg-line`}>
                {g.linhas.map((l) => {
                  const info = tipoAlertaValido(l.tipo) ? INFO_ALERTA[l.tipo] : { rotulo: l.tipo, icone: "notifications" };
                  const campanha = l.campanha_id ? nomeCampanha.get(l.campanha_id) ?? null : null;
                  const conta = contaDoAlerta(l, listaContas);
                  return (
                    <div key={l.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3 sm:flex-nowrap sm:items-center">
                      <div className="flex min-w-0 items-start gap-3">
                        <Icone nome={info.icone} className="mt-0.5 shrink-0 text-vg-text-2" />
                        <div className="min-w-0">
                          <p className="text-sm text-vg-text">
                            <span className="font-medium text-vg-text-2">{info.rotulo}</span> — {l.texto}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-vg-muted">
                            <span className="tabular-nums">{isoParaBrasilia(l.created_at)}</span>
                            {campanha && (
                              <Link href={`/campanhas/${l.campanha_id}`} className={estiloAcao.normal}>
                                {campanha}
                              </Link>
                            )}
                            {l.campanha_id && !campanha && <span>Campanha não encontrada</span>}
                            {conta ? <span>{conta.nome}</span> : (l.conexao_id || l.tipo === "numero_caiu") && <span>Conexão não encontrada</span>}
                          </div>
                        </div>
                      </div>
                      {!l.visto && (
                        <Selo cor="destaque">Novo</Selo>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </Pagina>
  );
}
