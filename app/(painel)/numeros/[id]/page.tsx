import { notFound } from "next/navigation";
import { TelaAcoes, type SpTelaAcoes } from "@/app/(painel)/_acoes/tela-acoes";
import { nomeDaTag, type TagLinha } from "@/app/(painel)/leads/comum";
import { ABA_DETALHE_CONTA_PADRAO, lerAbaDetalheConta, webhookValeParaCampanhas, type AbaDetalheConta } from "@/src/lib/regras/contas";
import { permitido } from "@/src/lib/permissoes";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { Abas } from "../../_componentes/abas";
import { CabecalhoConta } from "./cabecalho";
import { CampanhasDaConta, type CampanhaDaContaSelecao } from "./campanhas-conta";
import { ContatosConta } from "./contatos-conta";
import { CriacaoDeGruposConta, type AcaoCriarGrupo, type CampanhaCriadora } from "./criacao-grupos";
import { GruposConta, type GrupoDaContaLinha } from "./grupos-conta";
import { WebhooksDaConta, type WebhookLinhaConta } from "./webhooks-conta";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";

export const dynamic = "force-dynamic";

const ABAS: { valor: AbaDetalheConta; rotulo: string }[] = [
  { valor: "contatos", rotulo: "Contatos" },
  { valor: "grupos", rotulo: "Grupos" },
  { valor: "campanhas", rotulo: "Campanhas" },
  { valor: "webhooks", rotulo: "Webhooks" },
  { valor: "criacao_grupos", rotulo: "Criação de grupos" },
  { valor: "acoes", rotulo: "Ações" },
];

const LIMITE_GRUPOS = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Omite `?aba=` quando é a padrão (Ações, desde a Etapa 3L), como as outras telas fazem; a aba "Grupos" passa
 *  a escrever `?aba=grupos` (links antigos com esse parâmetro continuam abrindo a mesma aba). A aba "Ações"
 *  cuida da própria paginação (`?subpagina=`, dentro de `TelaAcoes`) — não entra aqui. */
function urlAba(id: string, aba: AbaDetalheConta): string {
  return aba === ABA_DETALHE_CONTA_PADRAO ? `/numeros/${id}` : `/numeros/${id}?aba=${aba}`;
}

type GrupoCampanhaLinha = {
  group_id: string;
  nome: string;
  numero: number;
  participantes: number;
  cheio: boolean;
  ativo: boolean;
  link_convite: string | null;
  campanha_id: string;
  foto_url: string | null;
  campanhas: { nome: string } | null;
};

export default async function Conta({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SpTelaAcoes>;
}) {
  const b = await bloqueio("contas");
  if (b) return b;
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const sp = await searchParams;
  const podeVerWebhooks = await permitido("webhooks", "ver");
  const aba = lerAbaDetalheConta(sp.aba, podeVerWebhooks);

  const db = await dbUsuario();
  const [{ data: conta, error: erroConta }, { data: projetosAtivos, error: erroProjetos }] = await Promise.all([
    db.from("conexoes").select("id, nome, telefone, status, ultimo_erro, pausado_ate, created_at, projeto_id").eq("id", id).maybeSingle(),
    db.from("projetos").select("id, nome").eq("arquivado", false).order("nome"),
  ]);
  if (erroConta) throw new Error("Não foi possível carregar esta conexão.");
  if (!conta) notFound();
  if (erroProjetos) throw new Error("Não foi possível carregar os projetos.");
  const conectada = (conta as { status: string }).status === "conectado";

  const podeEditarContas = await permitido("contas", "editar");
  const podeEditarCampanhas = await permitido("campanhas", "editar");
  const abasVisiveis = podeVerWebhooks ? ABAS : ABAS.filter((a) => a.valor !== "webhooks");

  let conteudo: React.ReactNode = null;
  let erroAba: string | null = null;

  if (aba === "contatos") {
    const { data: tagsData, error: erroTags } = await db.from("tags").select("id, nome, tipo, campanhas!tags_campanha_id_fkey(nome)").order("nome");
    if (erroTags) {
      erroAba = "Não foi possível carregar as tags.";
    } else {
      const tags = ((tagsData ?? []) as unknown as TagLinha[])
        .map((t) => ({ id: t.id, nome: nomeDaTag(t) }))
        .sort((a, c) => a.nome.localeCompare(c.nome, "pt-BR"));
      conteudo = <ContatosConta contaId={id} conectada={conectada} tags={tags} />;
    }
  } else if (aba === "grupos") {
    const [{ data: contaGrupos, error: erroContaGrupos }, { data: gruposCampanha, error: erroGruposCampanha }] = await Promise.all([
      db.from("conta_grupos").select("group_id, nome, participantes, foto_url").eq("conexao_id", id).order("nome"),
      db
        .from("grupos")
        .select("group_id, nome, numero, participantes, cheio, ativo, link_convite, campanha_id, foto_url, campanhas(nome)")
        .eq("conexao_id", id)
        .order("campanha_id")
        .order("numero")
        .limit(LIMITE_GRUPOS),
    ]);
    if (erroContaGrupos || erroGruposCampanha) {
      erroAba = "Não foi possível carregar os grupos.";
    } else {
      const campanhaPorGroupId = new Map(((gruposCampanha ?? []) as unknown as GrupoCampanhaLinha[]).map((g) => [g.group_id, g]));
      // Antes do primeiro "Atualizar" (`conta_grupos` vazia pra esta conta): mostra os grupos de campanha de
      // hoje, com a dica pra atualizar (comportamento de hoje).
      const escaneado = (contaGrupos ?? []).length > 0;
      const linhas: GrupoDaContaLinha[] = escaneado
        ? (contaGrupos ?? []).map((cg) => {
            const g = cg as { group_id: string; nome: string | null; participantes: number; foto_url: string | null };
            const camp = campanhaPorGroupId.get(g.group_id);
            return {
              groupId: g.group_id,
              nome: g.nome ?? camp?.nome ?? "",
              participantes: g.participantes,
              campanhaNome: camp?.campanhas?.nome ?? null,
              cheio: camp?.cheio ?? null,
              ativo: camp?.ativo ?? null,
              linkConvite: camp?.link_convite ?? null,
              // Foto da conta (`conta_grupos`), senão a que a conferência guardou no grupo de campanha (Etapa 3M).
              foto: g.foto_url ?? camp?.foto_url ?? null,
            };
          })
        : ((gruposCampanha ?? []) as unknown as GrupoCampanhaLinha[]).map((g) => ({
            groupId: g.group_id,
            nome: g.nome,
            participantes: g.participantes,
            campanhaNome: g.campanhas?.nome ?? null,
            cheio: g.cheio,
            ativo: g.ativo,
            linkConvite: g.link_convite,
            foto: g.foto_url ?? null,
          }));
      // "Escanear" enfileira remoções do anti-spam: só pra quem edita Contas E Anti-spam (a ação confere de novo).
      const podeEscanear = podeEditarContas && (await permitido("antispam", "editar"));
      conteudo = (
        <GruposConta
          contaId={id}
          contaNome={(conta as { nome: string }).nome}
          conectada={conectada}
          linhas={linhas}
          escaneado={escaneado}
          podeEscanear={podeEscanear}
          podeEditar={podeEditarContas}
        />
      );
    }
  } else if (aba === "campanhas") {
    const [{ data: todasCampanhas, error: erroCampanhas }, { data: minhasAdmin, error: erroAdmin }] = await Promise.all([
      db.from("campanhas").select("id, nome, conexao_criadora_id").eq("arquivada", false).order("nome"),
      db.from("campanha_conexoes").select("campanha_id").eq("conexao_id", id),
    ]);
    if (erroCampanhas || erroAdmin) {
      erroAba = "Não foi possível carregar as campanhas.";
    } else {
      const adminSet = new Set((minhasAdmin ?? []).map((a) => a.campanha_id as string));
      const selecao: CampanhaDaContaSelecao[] = ((todasCampanhas ?? []) as { id: string; nome: string; conexao_criadora_id: string | null }[]).map((c) => ({
        id: c.id,
        nome: c.nome,
        criadora: c.conexao_criadora_id === id,
        admin: adminSet.has(c.id),
      }));
      conteudo = <CampanhasDaConta contaId={id} campanhas={selecao} podeEditar={podeEditarContas} />;
    }
  } else if (aba === "webhooks") {
    const [{ data: criadas, error: erroCriadas }, { data: admin, error: erroAdmin }, { data: webhooksAtivos, error: erroWebhooks }] = await Promise.all([
      db.from("campanhas").select("id").eq("conexao_criadora_id", id),
      db.from("campanha_conexoes").select("campanha_id").eq("conexao_id", id),
      db.from("webhooks").select("id, nome, url, eventos, campanhas, ativo").eq("arquivado", false).order("nome"),
    ]);
    if (erroCriadas || erroAdmin || erroWebhooks) {
      erroAba = "Não foi possível carregar os webhooks.";
    } else {
      const campanhaIds = [...new Set([...(criadas ?? []).map((c) => c.id as string), ...(admin ?? []).map((a) => a.campanha_id as string)])];
      const aplicaveis: WebhookLinhaConta[] = (
        (webhooksAtivos ?? []) as { id: string; nome: string; url: string; eventos: string[]; campanhas: string[] | null; ativo: boolean }[]
      )
        .filter((w) => webhookValeParaCampanhas(w.campanhas, campanhaIds))
        .map((w) => ({ id: w.id, nome: w.nome, url: w.url, eventos: w.eventos, ativo: w.ativo }));
      conteudo = <WebhooksDaConta webhooks={aplicaveis} />;
    }
  } else if (aba === "criacao_grupos") {
    const { data: campanhasCriadas, error: erroCampanhasCriadas } = await db
      .from("campanhas")
      .select("id, nome, arquivada")
      .eq("conexao_criadora_id", id);
    if (erroCampanhasCriadas) {
      erroAba = "Não foi possível carregar as campanhas desta conexão.";
    } else {
      const idsCriadas = (campanhasCriadas ?? []).map((c) => c.id as string);
      let acoesCriacao: AcaoCriarGrupo[] = [];
      if (idsCriadas.length) {
        const { data: linhasAcoes, error: erroAcoes } = await db
          .from("acoes")
          .select("id, created_at, status, erro, campanha_id")
          .eq("tipo", "criar_grupo")
          .in("campanha_id", idsCriadas)
          .order("created_at", { ascending: false })
          .limit(50);
        if (erroAcoes) erroAba = "Não foi possível carregar a criação de grupos.";
        else {
          const nomePorCampanha = new Map((campanhasCriadas ?? []).map((c) => [c.id as string, c.nome as string]));
          acoesCriacao = (linhasAcoes ?? []).map((a) => ({
            id: a.id as string,
            created_at: a.created_at as string,
            status: a.status as AcaoCriarGrupo["status"],
            erro: a.erro as string | null,
            campanhaId: a.campanha_id as string,
            campanhaNome: nomePorCampanha.get(a.campanha_id as string) ?? "",
          }));
        }
      }
      if (!erroAba) {
        const campanhasParaCriar: CampanhaCriadora[] = ((campanhasCriadas ?? []) as { id: string; nome: string; arquivada: boolean }[])
          .filter((c) => !c.arquivada)
          .map((c) => ({ id: c.id, nome: c.nome }));
        conteudo = <CriacaoDeGruposConta acoes={acoesCriacao} campanhas={campanhasParaCriar} podeEditar={podeEditarCampanhas} />;
      }
    }
  } else {
    conteudo = <TelaAcoes sp={sp} base={`/numeros/${id}`} conexaoId={id} cabecalhoAdicionar={`/acoes/nova?conta=${id}`} />;
  }

  return (
    <div className="space-y-5 pb-6">
      <CabecalhoConta conta={conta} aba={{ rotulo: abasVisiveis.find((a) => a.valor === aba)!.rotulo }} projetos={projetosAtivos ?? []} podeEditar={podeEditarContas} />
      <div className="mx-auto max-w-[1200px] space-y-4 px-4 md:px-6">
        <Abas itens={abasVisiveis.map((a) => ({ href: urlAba(id, a.valor), rotulo: a.rotulo, ativo: aba === a.valor }))} />
        {erroAba ? <p role="alert" className="text-sm text-vg-erro">{erroAba}</p> : conteudo}
      </div>
    </div>
  );
}
