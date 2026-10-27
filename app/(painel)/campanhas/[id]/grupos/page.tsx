import { situacaoDaExecucao } from "@/src/lib/regras/calendario";
import { ROTULO_TIPO, resumoConteudo, type TipoExecucao } from "@/src/lib/regras/conteudo";
import { opcoesCriacao } from "@/src/lib/regras/criacao-grupos";
import { isoParaBrasilia } from "@/src/lib/regras/horario";
import { MAXIMO_GLOBAIS_NA_CAMPANHA } from "@/src/lib/regras/variaveis-globais";
import { resumoDasExecucoes } from "@/src/lib/resumo-execucoes";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { cancelarExecucao, reexecutarFalhas } from "../../../_acoes/execucoes";
import { SeloSituacao } from "../../../_componentes/situacao";
import { BotaoFaixa, FaixaBotoes } from "../../../_componentes/faixa-botoes";
import { Paginacao } from "../../../_componentes/paginacao";
import { Cartao, estiloAcao, estiloCartao, Pagina, Selo } from "../../../_componentes/ui";
import { CampoBusca } from "../../../_componentes/campo-busca";
import { tentarDeNovo } from "./actions";
import { ListaGrupos, type GrupoLinha } from "./lista";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";
import { permitido } from "@/src/lib/permissoes";

export const dynamic = "force-dynamic";

type Filtro = "todos" | "cheios" | "nao_cheios" | "suspensos";

function lerFiltro(v: string | undefined): Filtro {
  return v === "cheios" || v === "nao_cheios" || v === "suspensos" ? v : "todos";
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const POR_PAGINA = 12;

export default async function Grupos({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ filtro?: string; q?: string; pagina?: string }>;
}) {
  const b = await bloqueio("campanhas");
  if (b) return b;
  // Quem só vê Campanhas não ganha os botões que mudam algo (as ações recusariam lançando erro).
  const [podeEditar, podeVerCampanhas, verLeads] = await Promise.all([
    permitido("campanhas", "editar"),
    permitido("campanhas", "ver"),
    permitido("leads", "ver"),
  ]);
  const { id } = await params;
  const sp = await searchParams;
  const filtro = lerFiltro(sp.filtro);
  const q = (sp.q ?? "").trim();
  const pagina = Math.max(1, Math.floor(Number(sp.pagina)) || 1);
  const db = await dbUsuario();
  const [
    { data: grupos },
    { data: acoes },
    { data: campanhas },
    { data: conexoes },
    { data: modelos },
    { data: massa },
    { data: campanha },
    { data: todasContas, error: erroContas },
    { data: adminsCampanha, error: erroAdmins },
    { data: numeros, error: erroNumeros },
    { data: globais, error: erroGlobais },
    { data: variaveisCampanha, error: erroVariaveisCampanha },
    { data: adminsNumeros, error: erroAdminsNumeros },
  ] = await Promise.all([
    db.from("grupos").select("id, group_id, nome, numero, participantes, cheio, cheio_manual, ativo, suspenso, link_convite, created_at, conferido_em, foto_url, conexoes(nome)").eq("campanha_id", id).order("numero"),
    db.from("acoes").select("id, status, erro, created_at").eq("campanha_id", id).eq("tipo", "criar_grupo").in("status", ["fila", "processando", "erro"]).order("created_at", { ascending: false }).limit(5),
    db.from("campanhas").select("id, nome").eq("arquivada", false).neq("id", id).order("nome"),
    db.from("conexoes").select("nome, telefone").eq("status", "conectado").not("telefone", "is", null),
    db.from("modelos").select("id, nome, tipo, conteudo").eq("arquivado", false).in("tipo", ["nome", "descricao"]).order("nome"),
    db.from("execucoes").select("id, tipo, status, motivo, agendada_para, conteudo, conteudo_final").eq("campanha_id", id).eq("origem", "massa").order("agendada_para", { ascending: false }).limit(10),
    db
      .from("campanhas")
      .select(
        "conexao_criadora_id, padrao_nome, descricao, fechado, limite_por_grupo, folga, usar_comunidade, caractere_numeracao, inicio_contagem, numero_no_inicio, nao_criar_grupos, limite_cliques_sem_criar, criar_aberto_fechar_24h, mensagens_temporarias, aprovacao_entrada, modo_criacao, imagem_grupo_url, recusar_bloqueados",
      )
      .eq("id", id)
      .maybeSingle(),
    db.from("conexoes").select("id, nome, telefone, status").order("nome"),
    db.from("campanha_conexoes").select("conexao_id").eq("campanha_id", id),
    db.rpc("resumo_grupos", { p_campanha: id }),
    db.from("variaveis_globais").select("chave, tipo").order("chave").limit(MAXIMO_GLOBAIS_NA_CAMPANHA),
    db.from("campanha_variaveis").select("chave, valor").eq("campanha_id", id).order("chave"),
    db.from("campanha_admins_numeros").select("telefone").eq("campanha_id", id).order("created_at"),
  ]);
  if (erroNumeros) throw new Error("Não foi possível carregar os números dos grupos.");
  if (erroGlobais || erroVariaveisCampanha) throw new Error("Não foi possível carregar as variáveis.");
  if (erroContas || erroAdmins || erroAdminsNumeros) throw new Error("Não foi possível carregar as conexões admin da campanha.");
  const porGrupo = new Map(
    ((numeros ?? []) as { grupo_id: string; cliques: number; cliques_reais: number; admins: number; leads: number }[]).map((n) => [n.grupo_id, n]),
  );
  const todos: GrupoLinha[] = (grupos ?? []).map((g) => {
    const n = porGrupo.get(g.id);
    return {
      id: g.id, groupId: g.group_id, nome: g.nome, numero: g.numero, participantes: g.participantes, cheio: g.cheio, cheioManual: g.cheio_manual,
      ativo: g.ativo, suspenso: g.suspenso, link_convite: g.link_convite, created_at: g.created_at, conferido_em: g.conferido_em,
      conexao: (g.conexoes as unknown as { nome: string } | null)?.nome ?? "", foto: (g.foto_url as string | null) ?? null,
      cliques: Number(n?.cliques ?? 0), cliquesReais: Number(n?.cliques_reais ?? 0), admins: Number(n?.admins ?? 0), leads: Number(n?.leads ?? 0),
    };
  });
  const busca = semAcento(q);
  // Grupo excluído (inativo e não suspenso) some da lista. Cheios / não cheios olham só os ativos; "todos"
  // mostra os ativos e os suspensos; "suspensos" mostra só quem o WhatsApp tirou do ar.
  const naLista = todos.filter((g) => g.ativo || g.suspenso);
  const filtrados = naLista
    .filter((g) => {
      if (filtro === "todos") return true;
      if (filtro === "suspensos") return g.suspenso;
      if (filtro === "cheios") return g.ativo && g.cheio;
      return g.ativo && !g.cheio;
    })
    .filter((g) => !busca || semAcento(g.nome).includes(busca));
  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const de = (paginaAtual - 1) * POR_PAGINA;
  const visiveis = filtrados.slice(de, de + POR_PAGINA);
  const url = (f: Filtro, p?: number) => {
    const params = new URLSearchParams();
    if (f !== "todos") params.set("filtro", f);
    if (q) params.set("q", q);
    if (p && p > 1) params.set("pagina", String(p));
    const s = params.toString();
    return `/campanhas/${id}/grupos${s ? `?${s}` : ""}`;
  };
  const listaMassa = (massa ?? []) as { id: string; tipo: TipoExecucao; status: string; motivo: string | null; agendada_para: string; conteudo: unknown; conteudo_final: unknown }[];
  const resumo = await resumoDasExecucoes(db, listaMassa.map((m) => m.id));
  return (
    <Pagina titulo="Grupos">
      {(acoes ?? []).map((a) => (
        <div key={a.id} className={`${estiloCartao} flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm`}>
          <span className="flex flex-wrap items-center gap-2">Criação de grupo: <Selo cor={a.status === "erro" ? "erro" : "aviso"}>{a.status}</Selo> {a.erro && <span className="text-vg-erro">{a.erro}</span>}</span>
          {podeEditar && a.status === "erro" && <form action={tentarDeNovo.bind(null, a.id, id)}><button className={estiloAcao.normal}>Tentar de novo</button></form>}
        </div>
      ))}
      <ListaGrupos
        campanhaId={id}
        grupos={visiveis}
        totalGrupos={naLista.length}
        ativos={todos.filter((g) => g.ativo).map((g) => g.id)}
        limite={campanha?.limite_por_grupo ?? 0}
        tipoGrupo={campanha?.usar_comunidade ? "Comunidade" : "Grupo normal"}
        podeVerCampanhas={podeVerCampanhas}
        verLeads={verLeads}
        podeEditar={podeEditar}
        campanhas={campanhas ?? []}
        telefones={(conexoes ?? []) as { nome: string; telefone: string }[]}
        modelos={modelos ?? []}
        globais={(globais ?? []) as { chave: string; tipo: string }[]}
        variaveisCampanha={(variaveisCampanha ?? []) as { chave: string; valor: string }[]}
        informacoesCriacao={{
          padrao_nome: campanha?.padrao_nome ?? "", descricao: campanha?.descricao ?? "", fechado: campanha?.fechado ?? true,
          limite_por_grupo: campanha?.limite_por_grupo ?? 350, folga: campanha?.folga ?? 1, usar_comunidade: campanha?.usar_comunidade ?? false,
          ...opcoesCriacao(campanha),
        }}
        alterarEmLote={{
          padrao_nome: campanha?.padrao_nome ?? "", descricao: campanha?.descricao ?? "", fechado: campanha?.fechado ?? true,
          aprovacao_entrada: opcoesCriacao(campanha).aprovacao_entrada, caractere_numeracao: opcoesCriacao(campanha).caractere_numeracao,
          mensagens_temporarias: opcoesCriacao(campanha).mensagens_temporarias, imagem_grupo_url: opcoesCriacao(campanha).imagem_grupo_url, forcar: false,
        }}
        contas={(todasContas ?? []) as { id: string; nome: string; telefone: string | null; status: string }[]}
        criadoraId={campanha?.conexao_criadora_id ?? null}
        adminsIniciais={(adminsCampanha ?? []).map((a) => a.conexao_id as string)}
        adminsNumerosIniciais={((adminsNumeros ?? []) as { telefone: string }[]).map((a) => a.telefone)}
        filtros={
          <FaixaBotoes>
            <BotaoFaixa icone="list" href={url("todos")} ativo={filtro === "todos"}>Todos os grupos</BotaoFaixa>
            <BotaoFaixa icone="check_circle" href={url("cheios")} ativo={filtro === "cheios"}>Grupos cheios</BotaoFaixa>
            <BotaoFaixa icone="radio_button_unchecked" href={url("nao_cheios")} ativo={filtro === "nao_cheios"}>Grupos não cheios</BotaoFaixa>
            <BotaoFaixa icone="block" href={url("suspensos")} ativo={filtro === "suspensos"}>Grupo suspenso</BotaoFaixa>
          </FaixaBotoes>
        }
        busca={
          <form method="get" className="flex items-center gap-2">
            {filtro !== "todos" && <input type="hidden" name="filtro" value={filtro} />}
            <CampoBusca valorInicial={q} rotulo="Buscar grupos" />
          </form>
        }
      />
      {filtrados.length > 0 && (
        <Paginacao
          de={de + 1}
          ate={Math.min(de + POR_PAGINA, filtrados.length)}
          total={filtrados.length}
          porPagina={POR_PAGINA}
          primeira={paginaAtual > 1 ? url(filtro, 1) : undefined}
          anterior={paginaAtual > 1 ? url(filtro, paginaAtual - 1) : undefined}
          proxima={paginaAtual < totalPaginas ? url(filtro, paginaAtual + 1) : undefined}
          ultima={paginaAtual < totalPaginas ? url(filtro, totalPaginas) : undefined}
        />
      )}
      {listaMassa.length > 0 && (
        <Cartao titulo="Ações em massa recentes">
          <ul className="divide-y divide-vg-line text-sm">
            {listaMassa.map((m) => {
              const r = resumo.get(m.id);
              const s = situacaoDaExecucao(m.status, r);
              return (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span className="min-w-0">
                    <span className="tabular-nums text-vg-muted">{isoParaBrasilia(m.agendada_para)}</span> · <b className="font-medium">{ROTULO_TIPO[m.tipo]}</b> {resumoConteudo(m.tipo, m.conteudo_final ?? m.conteudo)}
                    {m.motivo && <span className="block text-xs text-vg-erro">{m.motivo}</span>}
                  </span>
                  <span className="flex flex-wrap items-center gap-3">
                    <SeloSituacao situacao={s.situacao} detalhe={s.detalhe} />
                    {podeEditar && m.status === "agendada" && <form action={cancelarExecucao.bind(null, m.id, id)}><button className={estiloAcao.perigo}>cancelar</button></form>}
                    {podeEditar && (r?.erros ?? 0) > 0 && m.status !== "enviando" && <form action={reexecutarFalhas.bind(null, m.id, id)}><button className={estiloAcao.normal}>reexecutar falhas</button></form>}
                  </span>
                </li>
              );
            })}
          </ul>
        </Cartao>
      )}
    </Pagina>
  );
}
