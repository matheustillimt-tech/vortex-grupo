import { carregarCalendario } from "@/src/lib/calendario";
import { carregarGruposParaDistintos } from "@/app/(painel)/campanhas/dados";
import { inicioDoPeriodo, lerPeriodo, resumoDaLinha, somarResumos, type Resumo } from "@/src/lib/regras/campanhas";
import { gruposDistintos } from "@/src/lib/regras/grupos-distintos";
import { inicioDoDiaBrasilia, preencherDias, type MetricaDia } from "@/src/lib/regras/metricas";
import { filtrarPorProjeto, periodoAnterior, resolverPeriodosTendencia, type LinhaCampanha } from "@/src/lib/regras/painel-metricas";
import { proximoEnvio } from "@/src/lib/regras/proximo-envio";
import { ehUuid } from "@/src/lib/regras/uuid";
import { dbUsuario, exigirUsuario } from "@/src/lib/supabase/usuario";
import { PERIODOS_TENDENCIA, PainelMetricas, type CartaoAtencao, type ProximoEnvioMetricas } from "./blocos";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";

export const dynamic = "force-dynamic";

const DIA = 86_400_000;
const RESUMO_ZERO: Resumo = { cliques: 0, entradas: 0, saidas: 0, participantes: 0, admins: 0, grupos: 0, gruposCheios: 0 };

type LinhaRpc = Record<string, unknown>;

/** Linhas de `resumo_campanhas` → mapa por campanha (null quando a consulta falhou). */
function mapaResumo(linhas: LinhaRpc[] | null, erro: unknown): Map<string, Resumo> | null {
  if (erro) return null;
  const m = new Map<string, Resumo>();
  for (const l of linhas ?? []) {
    const { campanhaId, ...r } = resumoDaLinha(l);
    m.set(campanhaId, r);
  }
  return m;
}

/** Linhas de `cliques_por_campanha` → mapa campanha → cliques (null quando a consulta falhou). */
function mapaCliques(linhas: LinhaRpc[] | null, erro: unknown): Map<string, number> | null {
  if (erro) return null;
  const m = new Map<string, number>();
  for (const l of linhas ?? []) m.set(String(l.campanha_id), Number(l.cliques ?? 0));
  return m;
}

/** Um alerta `numero_caiu` por número (o texto traz o nome do número): fica o mais recente (lista já vem do mais
 *  novo para o mais antigo). */
function umaPorNumero<T extends { texto: string }>(alertas: T[]): T[] {
  const vistos = new Set<string>();
  return alertas.filter((a) => {
    const chave = a.texto.match(/^Número (.+?) caiu/)?.[1] ?? a.texto;
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
}

/** "/campanhas/{id}/grupos" quando a lista veio completa (sem cortar no limite de 50) e todos os itens são da
 *  mesma campanha; senão a lista de campanhas (com a lista cortada, pode haver outra campanha fora das 50). */
function ondeResolver(ids: (string | null)[], completa: boolean, sufixo = ""): string {
  const unicos = [...new Set(ids.filter(Boolean))];
  return completa && unicos.length === 1 ? `/campanhas/${unicos[0]}${sufixo}` : "/campanhas";
}

export default async function Metricas({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string; tendencia?: string; tc?: string; te?: string; ts?: string; projeto?: string }>;
}) {
  const b = await bloqueio("metricas");
  if (b) return b;
  const sp = await searchParams;
  const dias = lerPeriodo(sp.dias);
  // Tendências: cada gráfico tem o próprio período (`?tc=&te=&ts=`); o `?tendencia=`
  // antigo continua valendo como padrão dos três quando algum não vier na URL.
  const tendenciaLegado = lerPeriodo(sp.tendencia, PERIODOS_TENDENCIA, 7);
  const { tc, te, ts } = resolverPeriodosTendencia(sp.tc, sp.te, sp.ts, tendenciaLegado, PERIODOS_TENDENCIA);
  const projetoId = ehUuid(sp.projeto) ? sp.projeto : "";

  const usuario = await exigirUsuario();
  const db = await dbUsuario();
  const agora = new Date();
  const hoje = inicioDoDiaBrasilia(agora); // meia-noite de Brasília em UTC
  const seteDiasAntes = new Date(new Date(hoje).getTime() - 7 * DIA).toISOString();
  const umDiaAtras = new Date(agora.getTime() - DIA).toISOString();
  // Nome da saudação: o da Equipe; senão o do cadastro; senão a parte do e-mail antes do @.
  const { data: membro } = await db.from("membros").select("nome").eq("usuario_id", usuario.id).maybeSingle();
  const nomeEquipe = typeof membro?.nome === "string" && membro.nome.trim() ? membro.nome.trim() : null;
  const nomeCadastro = typeof usuario.user_metadata?.nome === "string" && usuario.user_metadata.nome.trim() ? (usuario.user_metadata.nome as string).trim() : null;
  const doEmail = (usuario.email ?? "").split("@")[0];
  const nome = nomeEquipe ?? nomeCadastro ?? (doEmail ? doEmail.charAt(0).toUpperCase() + doEmail.slice(1) : null);

  // Próximo envio: mesma leitura do calendário (execuções + passos projetados) das próximas 6 semanas.
  // Erro aqui não derruba a tela.
  const proximoP: Promise<ProximoEnvioMetricas | null> = carregarCalendario(db, null, agora, new Date(agora.getTime() + 45 * DIA), agora)
    .then(({ dias: d, nomes }) => {
      const p = proximoEnvio(d.flatMap((x) => x.itens), agora);
      return p ? { quando: p.quando, descricao: p.descricao, campanhaId: p.campanhaId, campanha: nomes.get(p.campanhaId) ?? "" } : null;
    })
    .catch((e) => {
      console.error("[metricas] não foi possível calcular o próximo envio", e);
      return null;
    });

  // Contagens sempre no banco (count + head): contar linhas aqui cortaria em max_rows = 1000. Cada consulta
  // devolve { data, error } sem lançar, então um erro só apaga o bloco que depende dela.
  const [
    { data: conexoes, error: erroConexoes },
    { data: campanhas, error: erroCampanhas },
    { data: projetos, error: erroProjetos },
    { data: acoesErro, count: totalAcoesErro, error: erroAcoes },
    { data: gruposSumidos, count: totalGruposSumidos, error: erroGrupos },
    { data: eventosErro, count: totalEventosErro, error: erroEventos },
    { data: alertas, count: totalAlertas, error: erroAlertas },
    { data: quedas24h, error: erroQuedas },
    { count: totalBloqueados, error: erroBloqueados },
    { count: cliquesHoje, error: erroCliquesHoje },
    { count: cliques7Dias, error: erroCliques7Dias },
    { count: entradasHoje, error: erroEntradasHoje },
    { count: entradas7Dias, error: erroEntradas7Dias },
    { data: linhasPeriodo, error: erroPeriodo },
    { data: linhasDobro, error: erroDobro },
    { data: linhasHoje, error: erroHojePorCampanha },
    { data: diasPeriodo, error: erroDiasPeriodo },
    proximo,
  ] = await Promise.all([
    db.from("conexoes").select("id, nome, telefone, status"),
    db.from("campanhas").select("id, nome, descricao, conexao_criadora_id, projeto_id").eq("arquivada", false).order("nome"),
    db.from("projetos").select("id, nome").eq("arquivado", false).order("nome"),
    // "Entrar no Grupo" e bloquear/desbloquear contato (Etapa 3K) não são de campanha nenhuma: ficam fora desta contagem.
    db.from("acoes").select("campanha_id", { count: "exact" }).eq("status", "erro").not("tipo", "in", "(entrar_grupo,bloquear_contato,desbloquear_contato)").limit(50),
    db.from("grupos").select("campanha_id", { count: "exact" }).eq("ativo", false).gte("conferido_em", hoje).limit(50),
    db.from("eventos_saida").select("id", { count: "exact", head: true }).eq("status", "erro"),
    db.from("alertas").select("id, created_at, tipo, texto, campanha_id", { count: "exact" }).eq("visto", false).order("created_at", { ascending: false }).limit(50),
    db.from("alertas").select("id, created_at, texto").eq("tipo", "numero_caiu").gte("created_at", umDiaAtras).order("created_at", { ascending: false }).limit(20),
    // Contagem exata (não o recorte de 50 da lista de alertas acima, que pode esconder outros bloqueados).
    db.from("alertas").select("id", { count: "exact", head: true }).eq("visto", false).eq("tipo", "execucao_bloqueada"),
    // Só campanhas não arquivadas (como metricas_gerais e resumo_campanhas filtram pra o resto da tela).
    db.from("cliques").select("id, campanhas!inner(arquivada)", { count: "exact", head: true }).eq("campanhas.arquivada", false).gte("created_at", hoje),
    db.from("cliques").select("id, campanhas!inner(arquivada)", { count: "exact", head: true }).eq("campanhas.arquivada", false).gte("created_at", seteDiasAntes).lt("created_at", hoje),
    db
      .from("participantes")
      .select("id, grupos!inner(campanhas!inner(arquivada))", { count: "exact", head: true })
      .eq("grupos.campanhas.arquivada", false)
      .eq("importado", false)
      .eq("admin", false)
      .gte("entrou_em", hoje),
    db
      .from("participantes")
      .select("id, grupos!inner(campanhas!inner(arquivada))", { count: "exact", head: true })
      .eq("grupos.campanhas.arquivada", false)
      .eq("importado", false)
      .eq("admin", false)
      .gte("entrou_em", seteDiasAntes)
      .lt("entrou_em", hoje),
    db.rpc("resumo_campanhas", { p_desde: inicioDoPeriodo(dias, agora) }),
    db.rpc("resumo_campanhas", { p_desde: inicioDoPeriodo(2 * dias, agora) }),
    db.rpc("cliques_por_campanha", { p_desde: hoje }),
    db.rpc("metricas_gerais", { p_desde: inicioDoPeriodo(dias, agora) }),
    proximoP,
  ]);

  for (const [onde, erro] of Object.entries({
    erroConexoes, erroCampanhas, erroProjetos, erroAcoes, erroGrupos, erroEventos, erroAlertas, erroQuedas, erroBloqueados, erroCliquesHoje, erroCliques7Dias,
    erroEntradasHoje, erroEntradas7Dias, erroPeriodo, erroDobro, erroHojePorCampanha, erroDiasPeriodo,
  })) {
    if (erro) console.error(`[metricas] ${onde}`, erro);
  }

  // Tendências: cada gráfico (Clicks/Entraram/Sairam) tem o próprio período — uma
  // leitura de `metricas_gerais` por período distinto entre os três (no máximo 3, só leitura).
  const periodosTendencia = [...new Set([tc, te, ts])];
  const resultadosTendencia = await Promise.all(periodosTendencia.map((p) => db.rpc("metricas_gerais", { p_desde: inicioDoPeriodo(p, agora) })));
  const diasPorPeriodoTendencia = new Map<number, MetricaDia[] | null>();
  periodosTendencia.forEach((p, i) => {
    const { data, error } = resultadosTendencia[i];
    if (error) console.error("[metricas] erroDiasTendencia", p, error);
    diasPorPeriodoTendencia.set(p, error ? null : preencherDias(data ?? [], p, agora));
  });

  // Só campanhas não arquivadas (resumo_campanhas devolve todas; filtra pela lista).
  const ativas: { id: string; nome: string; descricao: string; conexao_criadora_id: string | null; projeto_id: string | null }[] = erroCampanhas ? [] : campanhas ?? [];
  const resumoPeriodo = erroCampanhas ? null : mapaResumo(linhasPeriodo, erroPeriodo);
  const resumoDobro = erroCampanhas ? null : mapaResumo(linhasDobro, erroDobro);
  const cliquesHojePorCampanha = erroCampanhas ? null : mapaCliques(linhasHoje, erroHojePorCampanha);

  const linhas: LinhaCampanha[] | null = resumoPeriodo
    ? ativas.map((c) => {
        const atual = resumoPeriodo.get(c.id) ?? RESUMO_ZERO;
        const dobro = resumoDobro?.get(c.id) ?? atual;
        return { id: c.id, nome: c.nome, descricao: c.descricao ?? "", projetoId: c.projeto_id, atual, anterior: periodoAnterior(dobro, atual) };
      })
    : null;

  const total = linhas ? somarResumos(linhas.map((l) => l.atual)) : null;

  // "Grupos distintos de WhatsApp" do Funil: só
  // leitura, de grupos ativos das campanhas do funil (já filtradas pelo projeto escolhido).
  const linhasFunilParaDistintos = linhas ? filtrarPorProjeto(linhas, projetoId) : [];
  const gruposParaDistintos = linhasFunilParaDistintos.length ? await carregarGruposParaDistintos(db, linhasFunilParaDistintos.map((l) => l.id)) : [];
  const distintosFunil = gruposDistintos(gruposParaDistintos);
  const totalAnterior = linhas && resumoDobro ? somarResumos(linhas.map((l) => l.anterior)) : null;

  const listaConexoes: { id: string; nome: string; telefone: string | null; status: string }[] | null = erroConexoes ? null : conexoes ?? [];
  const contas = listaConexoes
    ? {
        total: listaConexoes.length,
        conectadas: listaConexoes.filter((c) => c.status === "conectado").length,
        desconectadas: listaConexoes.filter((c) => c.status === "desconectado").length,
      }
    : null;

  const semCliquesHoje = cliquesHojePorCampanha
    ? ativas.filter((c) => (cliquesHojePorCampanha.get(c.id) ?? 0) === 0).map((c) => ({ id: c.id, nome: c.nome }))
    : null;

  const alertasNaoVistos = erroAlertas ? [] : alertas ?? [];
  const n = (v: number | null | undefined) => v ?? 0;

  const atencao: CartaoAtencao[] = [
    ...(contas?.desconectadas
      ? [{ chave: "desconectados", titulo: `${contas.desconectadas} número(s) desconectado(s)`, subtitulo: "Reconecte para voltar a criar grupos e enviar", href: "/numeros?aba=desconectadas" }]
      : []),
    ...(!erroAcoes && n(totalAcoesErro) > 0
      ? [{
          chave: "acoes",
          titulo: `${n(totalAcoesErro)} ação(ões) com erro`,
          subtitulo: "Criação ou remoção de grupo que falhou",
          href: ondeResolver((acoesErro ?? []).map((a) => a.campanha_id as string | null), n(totalAcoesErro) === (acoesErro ?? []).length, "/grupos"),
        }]
      : []),
    ...(!erroGrupos && n(totalGruposSumidos) > 0
      ? [{
          chave: "grupos",
          titulo: `${n(totalGruposSumidos)} grupo(s) sumiram`,
          subtitulo: "Não foram encontrados no WhatsApp na conferência de hoje",
          href: ondeResolver((gruposSumidos ?? []).map((g) => g.campanha_id as string | null), n(totalGruposSumidos) === (gruposSumidos ?? []).length, "/grupos"),
        }]
      : []),
    ...(!erroEventos && n(totalEventosErro) > 0
      ? [{ chave: "eventos", titulo: `${n(totalEventosErro)} webhook(s) com erro`, subtitulo: "Envios ao CRM ou de alertas que falharam", href: "/hooks/historico" }]
      : []),
    ...(!erroBloqueados && n(totalBloqueados) > 0
      ? [{ chave: "bloqueados", titulo: `${n(totalBloqueados)} envio(s) bloqueado(s)`, subtitulo: "Envios que não puderam sair no horário", href: "/calendario" }]
      : []),
  ];
  // Contagem exata de bloqueados (não a lista de alertas, que corta em 50): sem isso, "Tudo certo por aqui."
  // poderia ficar errado.
  const erroAtencao = Boolean(erroConexoes || erroCampanhas || erroAcoes || erroGrupos || erroEventos || erroAlertas || erroBloqueados);

  return (
    <PainelMetricas
      agora={agora}
      nome={nome}
      estado={{ dias, tc, te, ts, projetoId }}
      projetos={erroProjetos ? [] : projetos ?? []}
      alertas={erroAlertas ? null : { lista: alertasNaoVistos, total: totalAlertas ?? alertasNaoVistos.length }}
      atencao={atencao}
      erroAtencao={erroAtencao}
      proximo={proximo}
      hoje={{
        cliques: erroCliquesHoje ? null : n(cliquesHoje),
        cliques7d: erroCliques7Dias ? null : n(cliques7Dias),
        entradas: erroEntradasHoje ? null : n(entradasHoje),
        entradas7d: erroEntradas7Dias ? null : n(entradas7Dias),
      }}
      semCliquesHoje={semCliquesHoje}
      desconectadas24h={erroQuedas ? null : umaPorNumero(quedas24h ?? [])}
      linhas={linhas}
      total={total}
      totalAnterior={totalAnterior}
      distintosFunil={distintosFunil}
      diasPeriodo={erroDiasPeriodo ? null : preencherDias(diasPeriodo ?? [], dias, agora)}
      diasTendenciaCliques={diasPorPeriodoTendencia.get(tc) ?? null}
      diasTendenciaEntradas={diasPorPeriodoTendencia.get(te) ?? null}
      diasTendenciaSaidas={diasPorPeriodoTendencia.get(ts) ?? null}
      contas={contas}
      campanhasAtivas={erroCampanhas ? null : ativas.length}
    />
  );
}
