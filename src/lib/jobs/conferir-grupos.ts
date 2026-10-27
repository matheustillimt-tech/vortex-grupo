import "server-only";
import { dispararAutomacoes, dispararPorPessoas, telefonesProtegidos } from "../automacoes";
import { paraZapbot, type ConexaoLinha } from "../conexoes";
import { rodadaSuspeita } from "../regras/automacoes";
import { erroDaConferencia, naoParticipaDoGrupo } from "../regras/contingencia";
import { decidirFoto, depoisDaConfirmacao } from "../regras/foto";
import { avisaQueEncheu, cheioFinal } from "../regras/ocupacao";
import { diffParticipantes, type Membro } from "../regras/participantes";
import { campanhasAnterioresValidas } from "../regras/pessoas";
import { FOLGA_REGRA_MS, MAX_GRUPOS_REGRA_POR_RODADA, reservadosEmVigor, vagasDoGrupo } from "../regras/solicitacoes";
import { alguemEscuta, eventoGrupoCheio, eventoGrupoSuspenso, webhooksQueCasam } from "../regras/webhooks";
import { dbAdmin } from "../supabase/admin";
import { variantesTelefone } from "../telefone";
import { carregarWebhooks, criarEmissor, enfileirarEventos, type Emissor, type NovoEventoSaida, type WebhookComUrl } from "../webhooks";
import { zapbot } from "../zapbot/client";
import { alertar } from "./alertas";
import { passarGrupoParaOutraConexao, pedirRedefinicaoAoEncher } from "./links";
import { tratarRodada } from "./pessoas";
import { expirarVistos, lerEResponderPedidos } from "./solicitacoes";
import { restante, type Prazo } from "./tipos";

const INTERVALO_MS = 2 * 60_000;
/** Tamanho da página na leitura dos participantes (o max_rows padrão da API do Supabase é 1000). */
const PAGINA = 1000;

/** Para cada número cuja vez chegou: lista os grupos no WhatsApp e atualiza participantes, lotação e link. */
export async function conferirGrupos(prazo: Prazo): Promise<number> {
  const db = dbAdmin();
  const { data, error } = await db.from("conexoes").select("*").eq("status", "conectado").lte("proxima_conferencia_em", new Date().toISOString()).order("proxima_conferencia_em").limit(5);
  if (error) throw new Error(`Não foi possível ler os números: ${error.message}`);
  // Carregado uma vez por tick: a conferência pode enfileirar muitos eventos (entrou/saiu de vários grupos e
  // conexões) e reler a tabela de webhooks a cada um seria N consultas evitáveis.
  const webhooksCadastrados = await carregarWebhooks(db);
  // Hooks novos (grupo suspenso, grupo cheio): juntos e enfileirados no fim da rodada, sem nunca lançar.
  const emissor = criarEmissor(db, webhooksCadastrados);
  let conferidas = 0;
  for (const conexao of (data ?? []) as (ConexaoLinha & { id: string; proxima_conferencia_em: string })[]) {
    if (restante(prazo) < 15_000) break;
    // Reivindica a conexão de forma atômica: só segue se ninguém mudou `proxima_conferencia_em` desde a leitura
    // acima (outro tick do cron já pode ter pego essa mesma conexão entre a leitura e aqui).
    const proximaNova = new Date(Date.now() + INTERVALO_MS).toISOString();
    const { data: tomada } = await db
      .from("conexoes")
      .update({ proxima_conferencia_em: proximaNova })
      .eq("id", conexao.id)
      .eq("proxima_conferencia_em", conexao.proxima_conferencia_em)
      .select("id");
    if (!tomada?.length) continue;
    try {
      await conferirConexao(conexao, webhooksCadastrados, emissor, prazo);
      conferidas++;
    } catch (e) {
      await db.from("conexoes").update({ ultimo_erro: `Conferência de grupos: ${e instanceof Error ? e.message : e}` }).eq("id", conexao.id);
    }
  }
  // Cada conexão já é isolada no try/catch acima: o que foi juntado (mesmo de uma conexão que falhou no meio) sai aqui.
  await emissor.enviar();
  // Pedidos vistos sem leitura há 48 h viram `expirada` (Etapa 3N). Só banco, sem Zapbot; sem nada vencido, nada é
  // escrito. Falha só vai pro log.
  // As expiradas viram Hook `decisao` (Etapa 3N, Tarefa 3) só com alguém assinando o evento: mesmo emissor, mesma
  // leitura de webhooks; `enviar` de novo só manda o que chegou depois e nunca lança.
  const ouvemSolicitacoes = alguemEscuta(webhooksCadastrados, ["solicitacoes_entrada"]);
  try {
    await expirarVistos(db, new Date(), ouvemSolicitacoes ? (eventos) => emissor.adicionar(...eventos) : undefined);
  } catch (e) {
    console.error(`[conferir-grupos] pedidos vistos não foram expirados: ${e instanceof Error ? e.message : e}`);
  }
  if (ouvemSolicitacoes) await emissor.enviar();
  return conferidas;
}

async function conferirConexao(conexao: ConexaoLinha, webhooksCadastrados: WebhookComUrl[] | null, emissor?: Emissor, prazo?: Prazo) {
  const db = dbAdmin();
  const z = paraZapbot(conexao);
  const { data: grupos, error: erroGrupos } = await db.from("grupos").select("id, campanha_id, group_id, nome, cheio, cheio_manual, conferido_em, leitura_suspeita_desde, foto_url, foto_atualizada_em, foto_conferida_em, pendentes_reservados, pendentes_lidos_em, campanhas(nome, limite_por_grupo, crm_webhook_url, slug, checar_duplicados, tags_ativo, tag_entrou_adicionar, tag_entrou_remover, tag_saiu_adicionar, tag_saiu_remover, remover_anteriores_ativo, campanhas_anteriores, redefinir_link_cheio, recusar_bloqueados, aprovar_automaticamente, aprovacao_entrada, aprovar_por_tag, aprovar_tags, reservar_vaga_pendentes)").eq("conexao_id", conexao.id).eq("ativo", true);
  if (erroGrupos) throw new Error(`Não foi possível ler os grupos: ${erroGrupos.message}`);

  const agora = new Date().toISOString();
  const telefonesConexao = conexao.telefone ? variantesTelefone(conexao.telefone) : [];
  /** Números conectados no sistema: lido só quando a primeira rodada com entrada ou saída for gravada (uma vez por
   *  conexão). */
  let protegidos: string[] | undefined;
  /** Grupos desta conexão em que a regra automática de pedidos de entrada já rodou nesta rodada (teto por rodada). */
  let gruposComRegra = 0;
  /** Grupos que só seriam lidos por causa do Hook: lidos depois dos com regra, com o que sobrar do teto. */
  const soHook: LeituraPedidos[] = [];
  /** Erro de algum grupo nesta rodada; sem nenhum, o erro antigo do cartão da conexão é apagado no fim. */
  let erroDaRodada: string | null = null;

  for (const g of grupos ?? []) {
    // Config das seções da campanha vem junto com o grupo (uma leitura): colunas ausentes = comportamento de antes.
    const camp = g.campanhas as unknown as {
      nome: string;
      limite_por_grupo: number;
      crm_webhook_url: string | null;
      slug: string;
      checar_duplicados?: boolean;
      tags_ativo?: boolean;
      tag_entrou_adicionar?: string | null;
      tag_entrou_remover?: string | null;
      tag_saiu_adicionar?: string | null;
      tag_saiu_remover?: string | null;
      remover_anteriores_ativo?: boolean;
      campanhas_anteriores?: string[] | null;
      redefinir_link_cheio?: boolean;
      // Solicitações de entrada (Etapa 3M, Tarefa 4): ausente/false = nenhum pedido lido nem respondido (hoje).
      recusar_bloqueados?: boolean;
      aprovar_automaticamente?: boolean;
      aprovacao_entrada?: boolean;
      // Etapa 3N: ausente/false = a conta e as chamadas de hoje.
      aprovar_por_tag?: boolean;
      aprovar_tags?: string[] | null;
      reservar_vaga_pendentes?: boolean;
    };
    let atual;
    try {
      // Sem o link (a conferência nunca usou); os participantes continuam vindo (o diff de entrou/saiu depende deles).
      atual = await zapbot().obterGrupo(z, g.group_id, { link: false });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // A conexão não está no grupo: outra conexão da campanha que é admin dele assume (a próxima rodada dela confere).
      if (naoParticipaDoGrupo(msg) && (await passarGrupoParaOutraConexao(db, g, { id: conexao.id, nome: conexao.nome }))) continue;
      if (naoParticipaDoGrupo(msg)) {
        await alertarSemRepetir(db, { tipo: "criacao_erro", campanhaId: g.campanha_id, conexaoId: conexao.id, texto: `A conexão ${conexao.nome} não está no grupo ${g.nome} e nenhuma outra conexão conectada da campanha é admin dele: o grupo está sem envio. Coloque um chip conectado da campanha como admin.` });
      }
      // Falha de rede/5xx: não é sinal de que o grupo saiu do ar, só tenta de novo na próxima rodada.
      erroDaRodada = erroDaConferencia(g.nome, msg);
      await db.from("conexoes").update({ ultimo_erro: erroDaRodada }).eq("id", conexao.id);
      continue;
    }
    if (!atual) {
      // 404: único sinal confiável de que o grupo saiu do ar (banido/indisponível): fica inativo e suspenso.
      const { error: erroInativar } = await db.from("grupos").update({ ativo: false, suspenso: true }).eq("id", g.id);
      if (erroInativar) throw new Error(`Não foi possível marcar o grupo como inativo: ${erroInativar.message}`);
      await alertar({ tipo: "grupo_sumiu", texto: `Grupo ${g.nome} sumiu do WhatsApp (campanha ${camp.nome})`, campanhaId: g.campanha_id, conexaoId: conexao.id }, db);
      emissor?.adicionar(eventoGrupoSuspenso({ grupoId: g.id, grupoNome: g.nome, groupId: g.group_id, campanhaId: g.campanha_id, campanhaSlug: camp.slug, campanhaNome: camp.nome, conexaoId: conexao.id }));
      continue;
    }
    const abertos = await participantesAbertos(g.id);
    const membros: Membro[] = atual.participants.map((p) => ({ telefone: p.phone, admin: p.isAdmin }));
    const diff = diffParticipantes(abertos, membros);
    const adminsAbertos = new Set(abertos.filter((m) => m.admin).map((m) => m.telefone));
    const entraramPessoas = diff.entraram.filter((m) => !m.admin).map((m) => m.telefone);
    const sairamPessoas = diff.sairam.filter((t) => !adminsAbertos.has(t));

    const suspeita = rodadaSuspeita({ conhecidos: abertos.length, lista: membros.map((m) => m.telefone), entraram: diff.entraram.length, sairam: diff.sairam.length, telefonesConexao });
    // Lista vazia, sem o nosso número ou mais da metade do grupo sumindo de uma vez: a resposta do Zapbot não é
    // confiável. Nada deste grupo é gravado nesta rodada (participantes, CRM, automações, lotação): marca desde
    // quando a leitura está assim, alerta (no máximo 1 vez por hora com o mesmo texto) e segue pro próximo. Se a
    // leitura estranha se mantém por `ACEITAR_LEITURA_MS`, ela é aceita: grava como sempre, sem automações de pessoas.
    let aceita = false;
    if (suspeita?.tipo === "ignorar_rodada") {
      const desde = g.leitura_suspeita_desde as string | null;
      if (desde && Date.parse(agora) - Date.parse(desde) >= ACEITAR_LEITURA_MS) {
        aceita = true;
        // Sem repetir: se uma escrita abaixo falhar, a marca não é limpa e a próxima rodada aceitaria de novo.
        await alertarSemRepetir(db, { tipo: "criacao_erro", campanhaId: g.campanha_id, texto: `Grupo ${g.nome}: a leitura estranha se manteve por 10 minutos e foi aceita (sem automações de pessoas)`, conexaoId: conexao.id });
      }
    }
    if (suspeita?.tipo === "ignorar_rodada" && !aceita) {
      if (!g.leitura_suspeita_desde) {
        const { error } = await db.from("grupos").update({ leitura_suspeita_desde: agora }).eq("id", g.id);
        if (error) console.error(`[conferir-grupos] não foi possível marcar a leitura estranha do grupo ${g.id}: ${error.message}`);
      }
      const motivo = {
        lista_vazia: "A leitura do grupo veio sem nenhum participante",
        sem_numero_conectado: "A leitura do grupo veio sem o número desta conexão",
        metade_saiu: "Mais da metade do grupo sumiu da leitura de uma vez",
      }[suspeita.motivo];
      await alertarSemRepetir(db, {
        tipo: "criacao_erro",
        campanhaId: g.campanha_id,
        texto: `Grupo ${g.nome}: ${motivo}: nada foi gravado nesta rodada (participantes, automações e lotação ficam como estavam).`,
        conexaoId: conexao.id,
      });
      continue;
    }
    // Entrada em massa com uma lista plausível: os dados são gravados como sempre, mas as automações de pessoas não
    // disparam nesta rodada (evita mandar/remover em massa).
    if (suspeita?.tipo === "sem_automacoes" && (entraramPessoas.length || sairamPessoas.length)) {
      await alertar({
        tipo: "criacao_erro",
        campanhaId: g.campanha_id,
        texto: `Mudança grande no grupo ${atual.name} (${diff.sairam.length} saíram / ${diff.entraram.length} entraram) — automações de pessoas não disparadas nesta rodada.`,
        conexaoId: conexao.id,
      }, db);
    }

    // Bloqueio, duplicado e tags (Etapa 2G), só em rodada que vai ser gravada e ANTES de gravar: se falhar, nada do
    // grupo é gravado nesta rodada (registra o erro na conexão e segue pro próximo grupo) e a próxima rodada vê a
    // mesma diferença (tudo ali é idempotente). Na rodada suspeita (entrada em massa ou leitura estranha aceita) o
    // bloqueado continua sendo removido (checado por telefone contra o banco), mas o duplicado não: a leitura pode
    // estar errada e remover em massa é pior que deixar um duplicado (alerta quantos ficaram).
    let plano: Awaited<ReturnType<typeof tratarRodada>>;
    try {
      if (diff.entraram.length || diff.sairam.length) protegidos ??= [...(await telefonesProtegidos(db))];
      const sairamSet = new Set(diff.sairam);
      plano = await tratarRodada(db, {
        grupoId: g.id,
        grupoNome: atual.name,
        campanhaId: g.campanha_id,
        campanhaNome: camp.nome,
        entraram: diff.entraram,
        sairam: abertos.filter((m) => sairamSet.has(m.telefone)),
        protegidos: protegidos ?? [],
        agora,
        pularDuplicados: !!suspeita,
        checarDuplicados: camp.checar_duplicados !== false,
        conexaoId: conexao.id,
        tags: {
          ativo: camp.tags_ativo === true,
          entrouAdicionar: camp.tag_entrou_adicionar ?? null,
          entrouRemover: camp.tag_entrou_remover ?? null,
          saiuAdicionar: camp.tag_saiu_adicionar ?? null,
          saiuRemover: camp.tag_saiu_remover ?? null,
        },
        removerAnteriores: camp.remover_anteriores_ativo === true ? (camp.campanhas_anteriores ?? []) : [],
      });
    } catch (e) {
      erroDaRodada = erroDaConferencia(g.nome, e instanceof Error ? e.message : String(e));
      await db.from("conexoes").update({ ultimo_erro: erroDaRodada }).eq("id", conexao.id);
      continue;
    }
    // Quem vai ser removido (bloqueado/duplicado) tem a entrada gravada, mas não dispara "entrou" nem vai pro CRM.
    const vaoSair = new Set([...plano.removerBloqueio, ...plano.removerDuplicado]);
    const entraramFicam = entraramPessoas.filter((t) => !vaoSair.has(t));
    // Quem sumiu com remoção na fila fica aberto: a ação `remover` fecha a participação com o motivo dela.
    const sozinhos = new Set(plano.sairamSozinhos);
    const sairamSozinhasPessoas = sairamPessoas.filter((t) => sozinhos.has(t));

    // Automações de "entrou"/"saiu" (admin não conta). Falha aqui não derruba a conferência: alerta e segue.
    // O instante passado é o mesmo gravado em `entrou_em`/`saiu_em` (entra na chave que evita repetir o disparo).
    const dispararPessoas = async (gatilho: "entrou" | "saiu", telefones: string[]) => {
      if (!telefones.length || suspeita) return;
      try {
        await dispararPorPessoas({ campanhaId: g.campanha_id, gatilho, grupoId: g.id, telefones }, new Date(agora), db);
      } catch (e) {
        console.error(`[conferir-grupos] automações de ${gatilho} (${g.id}) não foram agendadas`, e);
        const verbo = gatilho === "entrou" ? "entraram no" : "saíram do";
        await alertar({ tipo: "criacao_erro", campanhaId: g.campanha_id, texto: `Pessoas ${verbo} grupo ${atual.name}, mas as automações não foram agendadas: ${e instanceof Error ? e.message : e}`, conexaoId: conexao.id }, db);
      }
    };

    if (diff.entraram.length) {
      const { error } = await db.from("participantes").insert(diff.entraram.map((m) => ({ grupo_id: g.id, telefone: m.telefone, admin: m.admin, entrou_em: agora })));
      if (error) throw new Error(`Não foi possível salvar quem entrou no grupo: ${error.message}`);
      await dispararPessoas("entrou", entraramFicam);
    }
    if (plano.sairamSozinhos.length) {
      const { error } = await db.from("participantes").update({ saiu_em: agora, motivo_saida: "sozinho" }).eq("grupo_id", g.id).in("telefone", plano.sairamSozinhos).is("saiu_em", null);
      if (error) throw new Error(`Não foi possível salvar quem saiu do grupo: ${error.message}`);
      await dispararPessoas("saiu", sairamSozinhasPessoas);
    }
    for (const m of diff.adminMudou) {
      const { error } = await db.from("participantes").update({ admin: m.admin }).eq("grupo_id", g.id).eq("telefone", m.telefone).is("saiu_em", null);
      if (error) throw new Error(`Não foi possível atualizar quem é admin: ${error.message}`);
    }
    // Só chega aqui (e só enfileira os eventos) se as escritas de participantes acima não falharam. Pro CRM
    // (legado) só quando a campanha tem `crm_webhook_url`; pros webhooks cadastrados, casa por evento/campanha
    // independente do CRM legado estar configurado. Um telefone por evento, mas uma chamada (um ou dois
    // inserts) pro grupo inteiro, em vez de uma viagem ao banco por telefone.
    const eventoCrm = (evento: "entrou" | "saiu", telefone: string): NovoEventoSaida => ({
      evento,
      campanhaId: g.campanha_id,
      dados: { telefone, campanha: camp.slug, campanha_nome: camp.nome, grupo: atual.name },
      legado: camp.crm_webhook_url ? [{ url: camp.crm_webhook_url, payload: { evento, telefone, campanha: camp.slug, grupo: atual.name, em: agora } }] : [],
    });
    const eventosGrupo = [...entraramFicam.map((t) => eventoCrm("entrou", t)), ...plano.sairamSozinhos.map((t) => eventoCrm("saiu", t))];
    if (eventosGrupo.length) await enfileirarEventos(db, eventosGrupo, webhooksCadastrados);

    // Contagem real: os cliques anteriores já viraram (ou não) participantes. Grupo marcado cheio pela
    // estimativa do link volta a ter vaga se a contagem real mostrar espaço. Marcado à mão (`cheio_manual`), o
    // valor manual fica — salvo no limite do WhatsApp, que é sempre cheio.
    const cheioManual = (g.cheio_manual as boolean | null | undefined) ?? null;
    // "Reservar vaga para solicitações pendentes" (Etapa 3N): os pedidos das últimas 48 h contam contra o limite da
    // campanha, só com o interruptor ligado (desligado = a conta de hoje). As vagas da aprovação automática são
    // calculadas SEM a reserva: são justamente esses pedidos que ocupam as vagas reservadas.
    // Só vale reserva lida há até 15 min (`reservadosEmVigor`) e em grupo com aprovação ligada.
    const reservarVaga = camp.reservar_vaga_pendentes === true;
    const reservadosAtual = Math.max(0, Number(g.pendentes_reservados ?? 0) || 0);
    const comAprovacao = atual.requireApproval ?? camp.aprovacao_entrada === true;
    const reservadosValidos = reservadosEmVigor({ ligada: reservarVaga && comAprovacao, reservados: reservadosAtual, lidosEm: g.pendentes_lidos_em as string | null | undefined, agora });
    const cheio = cheioFinal(cheioManual, membros.length, 0, camp.limite_por_grupo, reservadosValidos);
    const cheioSemReserva = reservarVaga ? cheioFinal(cheioManual, membros.length, 0, camp.limite_por_grupo) : cheio;
    // Foto real (Etapa 3M): vem no mesmo GET do grupo e vai no mesmo `update`, só quando o caminho mudou. Se a chave
    // sumiu e o banco tem foto com mais de 24 h, confirma na rota `/avatar` (no máximo 1 vez por grupo por dia) antes
    // de apagar; sem tempo no tick ou com erro, mantém a gravada.
    const fotoNoBanco = g.foto_url as string | null | undefined;
    const decisaoFoto = decidirFoto({
      noBanco: fotoNoBanco,
      atualizadaEm: g.foto_atualizada_em as string | null | undefined,
      conferidaEm: g.foto_conferida_em as string | null | undefined,
      avatarUrl: atual.avatarUrl,
      agora,
    });
    let foto: Record<string, string | null> | null = decisaoFoto.tipo === "gravar" ? decisaoFoto.campos : null;
    if (decisaoFoto.tipo === "confirmar") {
      const util = prazo ? restante(prazo) - MARGEM_FOTO_MS : undefined;
      // Sem tempo: nem pergunta nem marca (tenta na próxima rodada).
      if (util === undefined || util >= MINIMO_FOTO_MS) {
        let confirmada: string | null | "erro" = "erro";
        try {
          confirmada = await zapbot().fotoDoGrupo(z, g.group_id, util === undefined ? {} : { prazoTotalMs: util });
        } catch (e) {
          console.error(`[conferir-grupos] foto do grupo ${g.id} não foi confirmada: ${e instanceof Error ? e.message : e}`);
        }
        foto = depoisDaConfirmacao(fotoNoBanco, confirmada, agora);
      }
    }
    const { error: erroGrupo } = await db.from("grupos").update({
      nome: atual.name,
      participantes: membros.length,
      cheio,
      conferido_em: agora,
      // Rodada gravada (normal, entrada em massa ou leitura estranha aceita): a contagem de leitura estranha zera.
      leitura_suspeita_desde: null,
      ...foto,
    }).eq("id", g.id);
    if (erroGrupo) throw new Error(`Não foi possível atualizar o grupo: ${erroGrupo.message}`);
    // Lotação marcada à mão (cheio_manual definido) não é "encheu": sem alerta nem automações de grupo cheio.
    // Cheio só por causa da reserva (Etapa 3N, revisão final A): conta como cheio pro link (`cheio` gravado acima),
    // mas não é "encheu" (sem alerta, Hook, automações nem redefinir link). Quando o grupo enche de verdade
    // depois de já estar marcado cheio pela reserva, aí sim dispara: a contagem anterior (`abertos`) ainda não
    // lotava. Reserva desligada = `cheioSemReserva === cheio` e a condição é a de antes.
    const jaEstavaCheioDeVerdade = !!g.cheio && (!reservarVaga || cheioFinal(cheioManual, abertos.length, 0, camp.limite_por_grupo));
    if (cheio && cheioSemReserva && !jaEstavaCheioDeVerdade && avisaQueEncheu(cheioManual)) {
      await alertar({ tipo: "grupo_cheio", texto: `Grupo ${atual.name} encheu (${membros.length} pessoas, campanha ${camp.nome})`, campanhaId: g.campanha_id, conexaoId: conexao.id }, db);
      emissor?.adicionar(eventoGrupoCheio({ grupoId: g.id, grupoNome: atual.name, campanhaId: g.campanha_id, campanhaSlug: camp.slug, campanhaNome: camp.nome, participantes: membros.length, conferidoEm: g.conferido_em as string | null, origem: "conferencia" }));
      // Automações de "encher grupo". O link (`app/l/[slug]`) também dispara quando marca cheio pela estimativa;
      // o índice único `automacao_acao_id,gatilho_chave` faz o segundo disparo não duplicar nada.
      try {
        await dispararAutomacoes({ campanhaId: g.campanha_id, gatilho: "grupo_cheio", grupoId: g.id }, new Date(), db);
      } catch (e) {
        console.error(`[conferir-grupos] automações de grupo cheio (${g.id}) não foram agendadas`, e);
        await alertar({ tipo: "criacao_erro", campanhaId: g.campanha_id, texto: `Grupo ${atual.name} encheu, mas as automações não foram agendadas: ${e instanceof Error ? e.message : e}`, conexaoId: conexao.id }, db);
      }
      // Seção "Redefinir link de convite". `conferido_em` lido ANTES desta gravação: é o mesmo que o link viu se ele
      // marcou o mesmo enchimento (a chave não repete). Nunca lança.
      if (camp.redefinir_link_cheio === true) {
        await pedirRedefinicaoAoEncher(db, { campanhaId: g.campanha_id, grupoId: g.id, grupoNome: atual.name, conferidoEm: g.conferido_em as string | null, conexaoId: conexao.id });
      }
    }

    // Leitura dos pedidos de entrada (Etapa 3M, Tarefa 4 + Etapa 3N): só depois de a rodada ter sido gravada, só em
    // grupo com aprovação ligada (o que o WhatsApp diz; sem o campo na resposta, o que a campanha pede), com folga no
    // prazo do tick e no máximo `MAX_GRUPOS_REGRA_POR_RODADA` grupos por conexão, e só se a campanha tiver ao menos
    // uma destas: recusar bloqueados, aprovar automaticamente, aprovar por tag (com tag) ou reservar vaga. Rodada
    // suspeita (entrada em massa ou leitura estranha aceita): lê e registra, mas não decide. Com tudo false (padrão),
    // nada aqui roda: nenhuma chamada nova ao Zapbot nem escrita nova. Falha vira alerta (sem repetir) e não desfaz
    // nada da rodada.
    const tagsAprovar = camp.aprovar_por_tag === true ? (camp.aprovar_tags ?? []).filter(Boolean) : [];
    const regraLigada = camp.recusar_bloqueados === true || camp.aprovar_automaticamente === true || tagsAprovar.length > 0;
    // Hook "Solicitações de entrada em grupos" (Etapa 3N, Tarefa 3): um webhook ativo assinado pra esta campanha
    // também faz ler (e registrar) os pendentes, sem decidir nada. Sem webhook assinado, a condição é a de antes.
    const hookSolicitacoes = webhooksQueCasam(webhooksCadastrados ?? [], "solicitacoes_entrada", g.campanha_id).length > 0;
    const leitura: LeituraPedidos = {
      grupoId: g.id,
      campanhaId: g.campanha_id,
      grupoNome: atual.name,
      args: {
        campanhaId: g.campanha_id,
        grupo: { id: g.id, groupId: g.group_id, nome: atual.name },
        recusarBloqueados: camp.recusar_bloqueados === true,
        aprovarAutomaticamente: camp.aprovar_automaticamente === true,
        aprovarPorTag: tagsAprovar.length > 0,
        aprovarTags: tagsAprovar,
        reservarVaga,
        reservadosAtual,
        lidosEmAtual: (g.pendentes_lidos_em as string | null | undefined) ?? null,
        vagas: vagasDoGrupo(camp.limite_por_grupo, membros.length, cheioSemReserva),
        suspeita: !!suspeita,
        membros: membros.length,
        anteriores: camp.remover_anteriores_ativo === true ? campanhasAnterioresValidas(camp.campanhas_anteriores ?? [], g.campanha_id) : [],
        prazo,
        agora,
        ...(hookSolicitacoes && emissor ? { hook: true, emitir: (eventos) => emissor.adicionar(...eventos), campanhaSlug: camp.slug, campanhaNome: camp.nome } : {}),
      },
    };
    // Prioridade: grupo com regra ou reserva ligada é lido aqui, dentro do teto. Grupo que só tem o Hook fica pra
    // depois do laço e usa o que sobrar do teto (nunca tira a vez de uma regra de outra campanha).
    if ((regraLigada || reservarVaga) && comAprovacao) {
      if (gruposComRegra < MAX_GRUPOS_REGRA_POR_RODADA && (!prazo || restante(prazo) > FOLGA_REGRA_MS)) {
        gruposComRegra++;
        await lerPedidosDoGrupo(db, z, conexao.id, leitura);
      }
    } else if (hookSolicitacoes && comAprovacao && emissor) {
      soHook.push(leitura);
    }
    if (reservadosAtual > 0 && (!reservarVaga || !comAprovacao)) {
      // Reserva desligada (ou grupo sem aprovação): zera uma vez a reserva que ficou gravada (só quando ≠ 0).
      const { error } = await db.from("grupos").update({ pendentes_reservados: 0 }).eq("id", g.id);
      if (error) console.error(`[conferir-grupos] não foi possível zerar as vagas reservadas do grupo ${g.id}: ${error.message}`);
    }
  }

  // Segunda passada: grupos só com o Hook, com o que sobrou do teto. A ordem gira a cada tick (deslocamento pelo
  // minuto), então os que passam do teto também são lidos em algum tick.
  if (soHook.length) {
    const desloc = Math.floor(Date.now() / 60_000) % soHook.length;
    for (const leitura of [...soHook.slice(desloc), ...soHook.slice(0, desloc)]) {
      if (gruposComRegra >= MAX_GRUPOS_REGRA_POR_RODADA || (prazo && restante(prazo) <= FOLGA_REGRA_MS)) break;
      gruposComRegra++;
      await lerPedidosDoGrupo(db, z, conexao.id, leitura);
    }
  }
  // Rodada inteira sem erro: o aviso antigo (ex.: grupo que já foi resolvido) sai do cartão da conexão.
  if (!erroDaRodada && conexao.ultimo_erro) {
    const { error } = await db.from("conexoes").update({ ultimo_erro: null }).eq("id", conexao.id).eq("status", "conectado");
    if (error) console.error(`[conferir-grupos] não foi possível limpar o erro da conexão ${conexao.id}: ${error.message}`);
  }
}

type LeituraPedidos = { grupoId: string; campanhaId: string; grupoNome: string; args: Parameters<typeof lerEResponderPedidos>[3] };

/** Lê (e responde, se houver regra) os pedidos de um grupo. Falha vira alerta (sem repetir) e não desfaz nada. */
async function lerPedidosDoGrupo(db: ReturnType<typeof dbAdmin>, z: ReturnType<typeof paraZapbot>, conexaoId: string, l: LeituraPedidos): Promise<void> {
  try {
    await lerEResponderPedidos(db, zapbot(), z, l.args);
  } catch (e) {
    try {
      await alertarSemRepetir(db, {
        tipo: "criacao_erro",
        campanhaId: l.campanhaId,
        texto: `Grupo ${l.grupoNome}: não foi possível responder os pedidos de entrada: ${e instanceof Error ? e.message : e}`,
        conexaoId,
      });
    } catch (erroAlerta) {
      console.error(`[conferir-grupos] alerta dos pedidos de entrada (${l.grupoId}) não foi gravado`, erroAlerta);
    }
  }
}

const UMA_HORA_MS = 60 * 60_000;
/** Margem no prazo do tick pra confirmar a foto na rota `/avatar`, e o mínimo útil pra tentar. */
const MARGEM_FOTO_MS = 10_000;
const MINIMO_FOTO_MS = 10_000;
/** Leitura estranha que se mantém por este tempo é aceita (sem automações de pessoas). */
const ACEITAR_LEITURA_MS = 10 * 60_000;

/** Alerta, a não ser que o mesmo texto já tenha sido alertado na última hora pra essa campanha (a conferência roda a
 *  cada 2 min: um problema que persiste não pode encher o Início). Se a checagem falhar, alerta mesmo assim. */
async function alertarSemRepetir(db: ReturnType<typeof dbAdmin>, a: { tipo: "criacao_erro"; campanhaId: string; texto: string; conexaoId?: string }) {
  const { data, error } = await db
    .from("alertas")
    .select("id")
    .eq("campanha_id", a.campanhaId)
    .eq("texto", a.texto)
    .gte("created_at", new Date(Date.now() - UMA_HORA_MS).toISOString())
    .limit(1);
  if (!error && (data ?? []).length) return;
  await alertar(a, db);
}

/** Quem está no grupo segundo o banco, em páginas: grupo com mais de 1000 membros passa do max_rows da API. */
async function participantesAbertos(grupoId: string): Promise<Membro[]> {
  const db = dbAdmin();
  const todos: Membro[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await db
      .from("participantes")
      .select("telefone, admin")
      .eq("grupo_id", grupoId)
      .is("saiu_em", null)
      .order("id")
      .range(de, de + PAGINA - 1);
    if (error) throw new Error(`Não foi possível ler os participantes do grupo: ${error.message}`);
    todos.push(...((data ?? []) as Membro[]));
    if ((data ?? []).length < PAGINA) return todos;
  }
}
