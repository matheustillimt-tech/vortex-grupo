import { notFound } from "next/navigation";
import { env } from "@/src/lib/env";
import { inicioDoPeriodo, lerPeriodo, resumoDaLinha, type Resumo } from "@/src/lib/regras/campanhas";
import { lerIntervalo } from "@/src/lib/regras/grafico-exportar";
import { isoParaCampoBrasilia } from "@/src/lib/regras/horario";
import { preencherDias } from "@/src/lib/regras/metricas";
import { MAXIMO_GLOBAIS_NA_CAMPANHA } from "@/src/lib/regras/variaveis-globais";
import { fotoDaCampanha, mapaFotosCampanhas } from "@/src/lib/regras/foto";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { telefoneLegivel, variantesTelefone } from "@/src/lib/telefone";
import { listarNumeros, resumirContingencia, type Contingencia } from "@/src/lib/regras/contingencia";
import { Aula } from "./configuracoes/aula";
import { Variaveis } from "./configuracoes/variaveis";
import { type CampanhaSecoes, type SecaoCampanha } from "@/src/lib/regras/secoes-campanha";
import { CampanhasAnteriores, ChipsDivisao } from "./secoes/anteriores";
import { CampoPixel, Interruptor } from "./secoes/interruptor";
import { LinksPorDia } from "./secoes/links-por-dia";
import { TagsCampanha } from "./secoes/tags";
import { TelefonesAviso } from "./secoes/telefones-aviso";
import { Secao } from "./secoes/secao";
import { PERIODOS_GRAFICO, PainelVisaoGeral, TituloSecao, lerSecao } from "./visao-geral";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";
import { estiloBotao } from "@/app/(painel)/_componentes/ui";
import { Icone } from "@/app/(painel)/_componentes/icone";
import { BotaoInfoBotao } from "@/app/(painel)/_componentes/botao-info";

export const dynamic = "force-dynamic";

const RESUMO_ZERO: Resumo = { cliques: 0, entradas: 0, saidas: 0, participantes: 0, admins: 0, grupos: 0, gruposCheios: 0 };
const nada = Promise.resolve({ data: null, error: null });

export default async function VisaoGeral({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ dias?: string; grafico?: string; secao?: string; de?: string; ate?: string }>;
}) {
  const b = await bloqueio("campanhas");
  if (b) return b;
  const { id } = await params;
  const sp = await searchParams;
  const dias = lerPeriodo(sp.dias);
  const grafico = lerPeriodo(sp.grafico, PERIODOS_GRAFICO, 7);
  const secao = lerSecao(sp.secao);
  // Seletor de intervalo do cabeçalho dos gráficos: com `?de=&ate=` válidos, o início da
  // consulta passa a ser `de` e a série é cortada em `ate` (em vez do `?grafico=` de sempre); sem eles, nada
  // muda. `metricas_campanha` continua a mesma RPC — só o `p_desde` muda.
  const intervalo = lerIntervalo(sp.de ?? "", sp.ate ?? "");
  const desdeGrafico = intervalo ? new Date(`${intervalo.de}T00:00:00-03:00`).toISOString() : inicioDoPeriodo(grafico);

  const db = await dbUsuario();
  // Contagens agregadas no banco (resumo_campanhas / metricas_campanha): contar linhas aqui cortaria em max_rows.
  // As tabelas das seções de configuração só são lidas na seção aberta. `admins` e `projetosAtivos` alimentam o
  // diálogo "Editar" do menu CONFIGURAÇÕES (nome, tipo, projeto, término — os outros campos vão sem mudar).
  const [camp, resumo, metricas, variaveis, globais, sequencias, admins, projetosAtivos, tagsManuais, outrasCampanhas, fotos, chips] = await Promise.all([
    db.from("campanhas").select("*").eq("id", id).maybeSingle(),
    db.rpc("resumo_campanhas", { p_desde: inicioDoPeriodo(dias), p_campanha: id }),
    db.rpc("metricas_campanha", { p_campanha: id, p_desde: desdeGrafico }),
    secao === "variaveis" ? db.from("campanha_variaveis").select("chave, valor").eq("campanha_id", id).order("chave") : nada,
    secao === "variaveis" ? db.from("variaveis_globais").select("chave, tipo").order("chave").limit(MAXIMO_GLOBAIS_NA_CAMPANHA) : nada,
    secao === "aula" ? db.from("sequencias").select("id, nome").order("nome") : nada,
    db.from("campanha_conexoes").select("conexao_id").eq("campanha_id", id),
    db.from("projetos").select("id, nome").eq("arquivado", false).order("nome"),
    secao === "tags" ? db.from("tags").select("id, nome").eq("tipo", "manual").order("nome") : nada,
    secao === "anteriores" ? db.from("campanhas").select("id, nome, arquivada").neq("id", id).order("nome") : nada,
    // Foto do primeiro grupo ativo (Etapa 3M). Fora do `erro` abaixo: se falhar, fica a letra.
    db.rpc("fotos_campanhas", { p_ids: [id] }),
    secao === "dividir-chips" ? db.from("conexoes").select("id, nome, status").order("nome") : nada,
  ]);
  const erro =
    camp.error ?? resumo.error ?? metricas.error ?? variaveis.error ?? globais.error ?? sequencias.error ?? admins.error ?? projetosAtivos.error ??
    tagsManuais.error ?? outrasCampanhas.error ?? chips.error;
  if (erro) throw new Error(`Não foi possível carregar a campanha: ${erro.message}`);
  const c = camp.data;
  if (!c) notFound();

  // O projeto atual da campanha pode estar arquivado (não está em `projetosAtivos`): entra como opção extra,
  // igual a `/campanhas/[id]/configuracoes`, pra não sumir do select do diálogo "Editar".
  let projetos = projetosAtivos.data ?? [];
  if (c.projeto_id && !projetos.some((p) => p.id === c.projeto_id)) {
    const { data: projetoArquivado } = await db.from("projetos").select("id, nome").eq("id", c.projeto_id).maybeSingle();
    if (projetoArquivado) projetos = [...projetos, { id: projetoArquivado.id, nome: `${projetoArquivado.nome} (arquivado)` }];
  }

  const linha = (resumo.data ?? [])[0] as Record<string, unknown> | undefined;
  const brutas = (metricas.data ?? []) as { dia: string; cliques: number; entradas: number; saidas: number }[];
  // Com intervalo válido, a série termina em `ate` (meio-dia de Brasília evita problemas de fuso na borda do
  // dia) em vez de hoje; a quantidade de dias é a do intervalo (`lerIntervalo` já limita a 90).
  const metricasPreenchidas = intervalo
    ? preencherDias(
        brutas,
        Math.round((Date.parse(`${intervalo.ate}T00:00:00Z`) - Date.parse(`${intervalo.de}T00:00:00Z`)) / 86_400_000) + 1,
        new Date(`${intervalo.ate}T12:00:00-03:00`),
      )
    : preencherDias(brutas, grafico);

  const secoes = c as typeof c & CampanhaSecoes;
  const interruptor = (chave: string, ativo: boolean, desabilitado?: boolean) => ({ campanhaId: id, chave, ativo, desabilitado });

  // Uma entrada por seção (a de Métricas é desenhada pelo próprio painel). Cada uma só usa o que foi lido acima
  // para ela (as outras consultas viram `nada`).
  // Remover Lead de Campanhas Anteriores: ativas primeiro, arquivadas no fim com "(arquivada)".
  const anterioresOpcoes = ((outrasCampanhas.data ?? []) as { id: string; nome: string; arquivada: boolean }[])
    .slice()
    .sort((a, b) => Number(a.arquivada) - Number(b.arquivada))
    .map((x) => ({ id: x.id, nome: x.arquivada ? `${x.nome} (arquivada)` : x.nome }));
  // Verificação de Colaboradores: contas associadas + a que cria os grupos (as mesmas da página pública).
  const idsEquipe = new Set((admins.data ?? []).map((a) => a.conexao_id as string));
  if (c.conexao_criadora_id) idsEquipe.add(c.conexao_criadora_id);
  // Só as contas da campanha (e só com a seção aberta).
  let equipe: { id: string; nome: string; telefone: string | null }[] = [];
  if (secao === "colaboradores" && idsEquipe.size) {
    const { data: contas, error: erroContas } = await db.from("conexoes").select("id, nome, telefone").in("id", [...idsEquipe]).order("nome");
    if (erroContas) throw new Error(`Não foi possível carregar a campanha: ${erroContas.message}`);
    equipe = (contas ?? []) as typeof equipe;
  }

  // Atualização de links: quantos grupos têm outra conexão conectada e admin pra assumir se a dona cair (só com a
  // seção aberta). Dono de grupo fora das conexões da campanha também entra na leitura das conexões.
  let contingencia: Contingencia | null = null;
  if (secao === "links-banimento") {
    const { data: gs, error: erroGs } = await db.from("grupos").select("id, numero, conexao_id").eq("campanha_id", id).eq("ativo", true).order("numero");
    if (erroGs) throw new Error(`Não foi possível carregar a campanha: ${erroGs.message}`);
    const grupos = (gs ?? []) as { id: string; numero: number; conexao_id: string }[];
    const ids = new Set([...idsEquipe, ...grupos.map((g) => g.conexao_id)]);
    const { data: cs, error: erroCs } = ids.size ? await db.from("conexoes").select("id, nome, telefone, status").in("id", [...ids]) : { data: [], error: null };
    if (erroCs) throw new Error(`Não foi possível carregar a campanha: ${erroCs.message}`);
    const conexoes = ((cs ?? []) as { id: string; nome: string; telefone: string | null; status: string }[]).filter((x) => idsEquipe.has(x.id) || grupos.some((g) => g.conexao_id === x.id));
    // Reserva só pode ser conexão da campanha (associada ou criadora), igual à troca automática.
    const reservas = conexoes.filter((x) => idsEquipe.has(x.id));
    const telefones = [...new Set(reservas.flatMap((x) => (x.telefone ? variantesTelefone(x.telefone) : [])))];
    const admins: { grupo_id: string; telefone: string }[] = [];
    for (let i = 0; telefones.length && i < grupos.length; i += 200) {
      const { data: adms, error: erroAs } = await db
        .from("participantes")
        .select("grupo_id, telefone")
        .in("grupo_id", grupos.slice(i, i + 200).map((g) => g.id))
        .eq("admin", true)
        .is("saiu_em", null)
        .in("telefone", telefones)
        .limit(1000);
      if (erroAs) throw new Error(`Não foi possível carregar a campanha: ${erroAs.message}`);
      admins.push(...((adms ?? []) as typeof admins));
    }
    contingencia = resumirContingencia(grupos, [...reservas, ...conexoes.filter((x) => !idsEquipe.has(x.id)).map((x) => ({ ...x, telefone: null }))], admins);
  }

  const CONTEUDO: Record<Exclude<SecaoCampanha, "metricas">, () => React.ReactNode> = {
    tags: () => (
      <Secao
        titulo="Gerenciamento de Tags"
        subtitulo="Selecione uma tag para adicionar ou remover automaticamente aos participantes quando entrarem ou sairem de um grupo da campanha."
        comoFunciona={[
          "Ao entrar num grupo da campanha, o participante recebe a tag de \"Adicionar\" e perde a de \"Remover\" (quando escolhidas).",
          "Ao sair, o mesmo vale para as tags do bloco \"sair\".",
          "Limpar um select (clear) para de aplicar aquela tag; as outras continuam.",
        ]}
        casosDeUso={[
          "Marcar participantes que estão ativos em campanhas específicas",
          "Organizar leads por status de participação",
          "Criar segmentações automáticas para automações",
          "Gerenciar grupos VIP ou categorias especiais",
        ]}
      >
        <TagsCampanha
          campanhaId={id}
          tags={(tagsManuais.data ?? []) as { id: string; nome: string }[]}
          ativo={secoes.tags_ativo}
          inicial={{
            entrou: { adicionar: secoes.tag_entrou_adicionar ?? "", remover: secoes.tag_entrou_remover ?? "" },
            saiu: { adicionar: secoes.tag_saiu_adicionar ?? "", remover: secoes.tag_saiu_remover ?? "" },
          }}
        />
      </Secao>
    ),
    colaboradores: () => (
      <Secao
        titulo="Verificação de Colaboradores"
        subtitulo="Verificação de Colaboradores pelo telefone"
        interruptor={interruptor("colaboradores", secoes.verificacao_colaboradores)}
        texto="Página pública onde o lead digita um número e confere se ele é da equipe desta campanha."
        casosDeUso={["Golpista se passando pela equipe no privado: o lead confere o número antes de pagar ou passar dados."]}
      >
        <div className="space-y-3 rounded-lg border border-vg-line p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-[15px] font-semibold">Ativar Verificação de Colaboradores</h3>
            <div className="flex flex-wrap gap-2">
              <a href={`/campanhas/${id}/contas`} className={estiloBotao("contorno")}>
                <Icone nome="settings" tamanho={16} /> Configurar
              </a>
              <BotaoInfoBotao
                titulo="Verificação de Colaboradores"
                rotulo="Documentação"
                texto={
                  <>
                    <p>O lead abre a página pública da campanha, digita um número e confere se ele é da equipe desta campanha.</p>
                    <p>A lista vem das conexões associadas à campanha (em "Associe uma conexão") mais a conexão que cria os grupos.</p>
                  </>
                }
              />
              <a href={`${env("NEXT_PUBLIC_SITE_URL")}/l/${c.slug}/colaboradores`} target="_blank" rel="noopener noreferrer" className={estiloBotao("contorno")}>
                <Icone nome="open_in_new" tamanho={16} /> Visualizar
              </a>
            </div>
          </div>
          {equipe.length ? (
            <ul className="divide-y divide-vg-line">
              {equipe.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13px]">
                  <span className="text-vg-text">{x.nome}</span>
                  <span className="text-vg-text-2">{x.telefone ? telefoneLegivel(x.telefone) : "Sem número"}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-vg-text-2">Nenhuma conexão nesta campanha ainda.</p>
          )}
        </div>
      </Secao>
    ),
    "dividir-chips": () => {
      const opcoes = ((chips.data ?? []) as { id: string; nome: string; status: string }[]).map((x) => ({
        id: x.id,
        nome: x.status === "conectado" ? x.nome : `${x.nome} (${x.status})`,
      }));
      return (
        <Secao
          titulo="Dividir envios entre chips"
          subtitulo="Mensagens e enquetes da campanha saem por mais de um chip ao mesmo tempo, e a fila anda mais rápido."
          interruptor={interruptor("dividir-chips", secoes.dividir_chips)}
          itens={[
            "Cada grupo recebe pelo chip escolhido com menos envios na fila",
            "Só entra chip conectado e admin do grupo; sem nenhum apto, sai pelo dono do grupo",
            "Nenhum chip escolhido = todos os chips conectados",
            "Troca de nome, imagem e descrição continuam pelo dono do grupo",
            "Disparo com contas escolhidas (\"só grupos destas contas\") não é dividido",
          ]}
          casosDeUso={["Lançamento com vários disparos seguidos: 14 grupos em 2 chips viram 7 em cada, enviando juntos."]}
        >
          <ChipsDivisao campanhaId={id} chips={opcoes} inicial={(secoes.chips_divisao ?? []).filter((x: string) => opcoes.some((o) => o.id === x))} />
        </Secao>
      );
    },
    "aviso-queda": () => (
      <Secao
        titulo="Aviso de chip caído"
        subtitulo="Quando um chip da campanha cai (desconectou ou foi banido), outro chip conectado manda mensagem no privado destes telefones."
        itens={[
          "A mensagem diz qual chip caiu, o número dele e se foi desconectado ou possivelmente banido",
          "Sai por outro chip conectado (de preferência um da campanha)",
          "Um aviso por queda: só manda de novo se o chip voltar e cair outra vez",
          "Sem telefone na lista = sem aviso",
        ]}
        casosDeUso={["Chip 1 caiu no meio do lançamento: o Chip 2 avisa o responsável no WhatsApp na hora, com o link pra reconectar."]}
      >
        <TelefonesAviso campanhaId={id} inicial={secoes.telefones_aviso_queda ?? []} />
      </Secao>
    ),
    anteriores: () => (
      <Secao
        titulo="Remover Lead de Campanhas Anteriores"
        subtitulo="Ao ingressar nesta campanha, o participante será automaticamente removido das campanhas anteriores selecionadas."
        interruptor={interruptor("anteriores", secoes.remover_anteriores_ativo)}
        itens={[
          "Só sai de grupos ativos das campanhas escolhidas",
          "A remoção espera 5 minutos e confere de novo antes de tirar",
          "Admins e números conectados nunca saem",
        ]}
        casosDeUso={["Lançamento novo com a mesma base: quem entrar no grupo novo sai do grupo antigo e não recebe mensagem dobrada."]}
      >
        <CampanhasAnteriores campanhaId={id} campanhas={anterioresOpcoes} inicial={(secoes.campanhas_anteriores ?? []).filter((x: string) => anterioresOpcoes.some((o) => o.id === x))} />
      </Secao>
    ),
    variaveis: () => (
      <>
        <TituloSecao titulo="Variáveis" subtitulo="Defina abaixo os valores que serão usados nesta campanha." />
        <Variaveis campanhaId={id} globais={globais.data ?? []} variaveis={variaveis.data ?? []} />
      </>
    ),
    aula: () => (
      <>
        <TituloSecao titulo="Data da aula e sequência" />
        <Aula
          campanhaId={id}
          sequencias={sequencias.data ?? []}
          inicial={{
            data_aula: c.data_aula ? isoParaCampoBrasilia(c.data_aula) : "", link_aula: c.link_aula ?? "", sequencia_id: c.sequencia_id ?? "",
            mensagem_fixa: c.mensagem_fixa ?? "", alertas_webhook_url: c.alertas_webhook_url ?? "",
          }}
        />
      </>
    ),
    cookie: () => (
      <Secao
        titulo="Cookie de redirecionamento"
        subtitulo="Redireciona o lead para o primeiro grupo que ele tentou entrar evitando que ele entre em mais de um grupo"
        interruptor={interruptor("cookie", secoes.cookie_redirecionamento)}
        texto="Esta funcionalidade garante que:"
        itens={[
          "O lead seja sempre redirecionado para o primeiro grupo que ele tentou acessar",
          "Mesmo que o lead tente acessar outros links de grupos diferentes da mesma campanha, ele será automaticamente redirecionado para o grupo inicial",
          "Isso evita que a mesma pessoa ocupe vagas em múltiplos grupos",
        ]}
        casosDeUso={["Lançamento com vários grupos: quem clica de novo no link volta pro mesmo grupo enquanto ele tiver vaga."]}
      />
    ),
    comunidades: () => (
      <Secao
        titulo="Gestão de comunidades"
        subtitulo="Cria comunidades ao invés de grupos normais"
        interruptor={interruptor("comunidades", secoes.usar_comunidade)}
        itens={["Os grupos novos da campanha entram na comunidade", "Grupos já criados não mudam"]}
        aviso="Remover comentários automaticamente não está disponível: o WhatsApp não avisa o Vórtex Grupo sobre comentários na comunidade."
        casosDeUso={["Avisos num canal só da comunidade, com os grupos embaixo."]}
      >
        <p className="text-[13px] text-vg-text-2">
          {c.comunidade_id ? <>Comunidade atual: <span className="break-all text-vg-text">{c.comunidade_id}</span></> : "Nenhuma comunidade criada ainda"}
        </p>
      </Secao>
    ),
    "deep-linking": () => (
      <Secao
        titulo="Deep Linking"
        subtitulo={"Elimina a necessidade do lead clicar em \"Entrar na conversa\" no site do WhatsApp"}
        interruptor={interruptor("deep-linking", secoes.deep_linking)}
        texto="Quando ativado, permite acessar funcionalidades adicionais como Meta Pixel"
        itens={["No celular, o WhatsApp abre direto no convite do grupo", "Se não abrir, a página mostra o botão \"Entrar no grupo\"", "No computador nada muda"]}
        casosDeUso={["Anúncio com destino no link da campanha: menos gente perdida no meio do caminho e o Lead contado no Pixel."]}
      >
        <div className="space-y-3 rounded-lg border border-vg-line p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h3 className="flex items-center gap-1 text-[15px] font-semibold">
              Pixel da Meta
              <span title="Dispara PageView e Lead na página de abertura do link" className="text-vg-text-2">
                <Icone nome="help" tamanho={16} />
                <span className="sr-only">Dispara PageView e Lead na página de abertura do link</span>
              </span>
            </h3>
            <Interruptor campanhaId={id} interruptor="pixel" ativo={secoes.pixel_meta_ativo} rotulo="Pixel da Meta" desabilitado={!secoes.deep_linking} />
          </div>
          <CampoPixel campanhaId={id} inicial={secoes.pixel_meta_id ?? ""} desabilitado={!secoes.deep_linking} />
        </div>
      </Secao>
    ),
    entrega: () => (
      <Secao
        titulo="Confirmação de entrega"
        subtitulo="Confirma se a mensagem chegou nos grupos usando as outras conexões da campanha"
        interruptor={interruptor("entrega", secoes.confirmar_entrega)}
        itens={[
          "O card da mensagem no disparo mostra quantos grupos tiveram a entrega confirmada",
          "Grupos sem confirmação geram um alerta",
          "Só entram na checagem as mensagens enviadas depois de ligar a opção",
          // Retenção real (conferida em `src/lib/jobs/entregas.ts` e nas migrações `…_links_entregas*.sql`): a
          // conferência só olha execuções/confirmações dos últimos 7 dias — não 90.
          "Os dados ficam guardados por 7 dias",
        ]}
        casosDeUso={["Saber na hora se uma mensagem importante não chegou num grupo (conexão limitada, grupo travado)."]}
      >
        <div className="space-y-1 rounded-lg border border-vg-line px-4 py-3">
          <h3 className="text-[13px] font-semibold">Requisito</h3>
          <p className="text-[13px] text-vg-text-2">
            A campanha precisa de pelo menos duas conexões. Grupos onde só a conexão que enviou participa aparecem como &quot;sem observador&quot;.
          </p>
        </div>
      </Secao>
    ),
    "links-banimento": () => (
      <Secao
        titulo="Atualização de links"
        subtitulo="Atualizar os links de maneira automática quando algum número é banido"
        interruptor={interruptor("links-banimento", secoes.atualizar_links_banimento)}
        aviso="Atenção: Para que essa funcionalidade funcione corretamente, é necessário ter uma outra conexão associada na campanha que seja administradora dos grupos."
        texto="A troca acontece quando a conexão fica 10 minutos fora do ar (uma queda rápida não mexe nos grupos). Enquanto ela não volta, a troca é tentada de novo a cada 10 minutos: uma conexão reserva que entrar depois assume os grupos que ficaram parados."
        itens={[
          "Os grupos da conexão que caiu passam para outra conexão admin da campanha",
          "O que estava na fila desses grupos sai pela conexão nova",
          "O link de cada grupo é atualizado pela conexão nova",
          "Grupo sem outra conexão admin gera alerta",
        ]}
        casosDeUso={["Número banido no meio do lançamento: o link da campanha continua levando a grupos que funcionam."]}
      >
        {contingencia && <PainelContingencia c={contingencia} ligada={secoes.atualizar_links_banimento} />}
      </Secao>
    ),
    "links-periodicos": () => (
      <Secao
        titulo="Atualização periódica de links"
        subtitulo="Atualiza periodicamente os links de convite de todos os grupos da campanha"
        casosDeUso={["Link que circulou em lugar errado deixa de ser o único caminho; o link da campanha sempre leva ao convite atual."]}
      >
        {/* Sem interruptor nem "SALVAR" (Etapa 3N): o campo salva ao sair. Campanha desligada chega com o campo
         *  vazio — nada muda no deploy até a pessoa digitar um número (Global Constraints). */}
        <LinksPorDia campanhaId={id} inicial={secoes.links_periodicos ? secoes.links_por_dia ?? 1 : ""} />
        <p className="text-[13px] text-vg-text-2">A verificação ocorre a cada hora.</p>
      </Secao>
    ),
    "redefinir-link": () => (
      <Secao
        titulo="Redefinir link de convite"
        subtitulo="Quando um grupo enche, o link de convite é revogado automaticamente"
        interruptor={interruptor("redefinir-link", secoes.redefinir_link_cheio)}
        texto="Esta funcionalidade garante que:"
        itens={["Quem guardou o convite antigo não entra mais no grupo cheio", "O novo link fica salvo no grupo"]}
        casosDeUso={["Grupo de lançamento que lota: ninguém fura a fila com o convite antigo."]}
      />
    ),
    duplicados: () => (
      <Secao
        titulo="Checar participantes duplicados"
        subtitulo="Checar automaticamente participantes duplicados"
        interruptor={interruptor("duplicados", secoes.checar_duplicados)}
        texto="Esta funcionalidade garante que, a cada conferência dos grupos, quem entrar num segundo grupo da campanha seja removido do grupo mais novo."
        itens={["Números conectados e admins nunca são removidos", "Leitura suspeita do WhatsApp não remove ninguém (vira alerta)"]}
        casosDeUso={["Uma vaga por pessoa quando os grupos enchem rápido."]}
      />
    ),
  };
  const conteudo: React.ReactNode = secao === "metricas" ? null : CONTEUDO[secao]();

  return (
    <div className="mx-auto max-w-[1200px] space-y-4 px-4 py-5 md:px-6">
      <PainelVisaoGeral
        campanha={{
          id: c.id, nome: c.nome, descricao: c.descricao, created_at: c.created_at, arquivada: c.arquivada, fixada: c.fixada,
          slug: c.slug, padrao_nome: c.padrao_nome, fechado: c.fechado, limite_por_grupo: c.limite_por_grupo, folga: c.folga,
          conexao_criadora_id: c.conexao_criadora_id ?? "", usar_comunidade: c.usar_comunidade, crm_webhook_url: c.crm_webhook_url ?? "",
          projeto_id: c.projeto_id ?? null, tipo: c.tipo, termina_em: c.termina_em ? isoParaCampoBrasilia(c.termina_em) : "",
          link_apos_termino: c.link_apos_termino ?? "", admins: (admins.data ?? []).map((a) => a.conexao_id),
        }}
        foto={fotoDaCampanha(c as { imagem_grupo_url?: string | null }, fotos.error ? null : mapaFotosCampanhas(fotos.data).get(id))}
        projetos={projetos}
        link={`${env("NEXT_PUBLIC_SITE_URL")}/l/${c.slug}`}
        resumo={linha ? resumoDaLinha(linha) : RESUMO_ZERO}
        metricas={metricasPreenchidas}
        estado={{ dias, grafico, secao }}
        conteudo={conteudo}
      />
    </div>
  );
}

/** Situação da contingência agora (seção "Atualização de links"). Lê `participantes` (atualizado pela conferência
 *  dos grupos): uma conexão feita admin há pouco aparece depois da próxima conferência. */
function PainelContingencia({ c, ligada }: { c: Contingencia; ligada: boolean }) {
  if (!c.total) return null;
  const tudo = c.semReserva.length === 0;
  return (
    <div className="space-y-1.5 rounded-lg border border-vg-line px-4 py-3">
      <h3 className="text-[13px] font-semibold">Contingência agora</h3>
      <p className={`text-[13px] ${tudo ? "text-vg-ok" : "text-vg-aviso"}`}>
        {c.comReserva} de {c.total} grupo(s) têm outra conexão conectada e admin pra assumir se a dona cair.
      </p>
      {!tudo && (
        <p className="text-[13px] text-vg-text-2">
          Sem reserva: {listarNumeros(c.semReserva)}. Faça outra conexão da campanha admin desses grupos (e conectada).
        </p>
      )}
      {c.donoCaido.length > 0 && (
        <p className="text-[13px] text-vg-aviso">Conexão dona fora do ar agora: {listarNumeros(c.donoCaido)}.</p>
      )}
      {!ligada && <p className="text-[13px] text-vg-aviso">A troca automática está desligada: ligue a seção pra ela funcionar.</p>}
    </div>
  );
}
