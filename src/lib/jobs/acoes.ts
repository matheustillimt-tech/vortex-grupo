import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credenciais, paraZapbot, type ConexaoLinha } from "../conexoes";
import { fotoPosta } from "../regras/foto";
import { erroDaImagemNoZapbot } from "../regras/imagem-grupo";
import { nomeDoGrupo } from "../regras/nome-grupo";
import { criacaoAutomatica, esperarModoSeguro, execucaoFecharGrupo, opcoesCriacao, proximoNumero, segundosTemporarias } from "../regras/criacao-grupos";
import { escolherCriadora } from "../regras/contingencia";
import { mascararTelefone, variantesTelefone } from "../telefone";
import { emLotes } from "../regras/admins-numeros";
import { eventoGrupoCriado, eventoSemConta } from "../regras/webhooks";
import { dbAdmin } from "../supabase/admin";
import { criarEmissor, type Emissor } from "../webhooks";
import { registrarHistorico } from "../historico";
import { zapbot, ZapbotError, type ZapbotClient, type ZapbotConexao } from "../zapbot/client";
import { dispararAutomacoes, telefonesAdministrativos, telefonesConectados } from "../automacoes";
import { lidDoId } from "../regras/administrativos";
import { CHAVE_ANTISPAM_CONTAS, contaPodeRemover, FONTE_BLOQUEADOS, lerAntispamContas, textoAlertaSemConta } from "../regras/antispam";
import { motivoDaOrigem } from "../regras/pessoas";
import { alertar } from "./alertas";
import { alertarSoLid, ehIdLid } from "./pessoas";
import { criarGatilhosGrupoNovo } from "./grupo-novo";
import { motivoBloqueioCriacao, motivoJaTemVaga } from "./novos-grupos";
import { restante, type Prazo } from "./tipos";

export type DadosCriacao = {
  criador: ZapbotConexao;
  admins: string[];
  nome: string;
  descricao: string;
  fechado: boolean;
  comunidadeId: string | null;
  criarComunidade: { nome: string; descricao: string } | null;
};
export type PassosFeitos = {
  groupId?: string;
  promovidos?: boolean;
  configurado?: boolean;
  comunidadeId?: string;
  ligado?: boolean;
  link?: string;
  numero?: number;
  nome?: string;
  gatilhos?: boolean;
  automacoes?: boolean;
  /** Etapa 3M: "Imagem do grupo" da campanha posta no grupo novo (`PUT group-picture`), antes dos passos da 3E
   *  (uma vez só; falha vira alerta, nunca desfaz). */
  foto?: boolean;
  /** Etapa 3E, depois de o grupo existir e estar salvo (cada um uma vez só; falha vira alerta, nunca desfaz). */
  aprovacao?: boolean;
  temporarias?: boolean;
  fecharAgendado?: boolean;
  /** Etapa 3K: administradores por número (`campanha_admins_numeros`) adicionados e promovidos (uma vez só). */
  adminsNumeros?: boolean;
  /** Números já tratados (lotes concluídos) enquanto `adminsNumeros` não termina: a retomada segue dali. */
  adminsNumerosFeitos?: string[];
  /** Conexão que cria este grupo (a criadora ou, com ela caída, uma associada conectada). Gravada antes de chamar o
   *  Zapbot: a retentativa usa a mesma e nunca cria o grupo por outro número. */
  criadorId?: string;
};

type ZapbotGrupos = Pick<ZapbotClient, "criarGrupo" | "participantes" | "configurarGrupo" | "criarComunidade" | "ligarGrupo" | "linkConvite">;
type ZapbotPosCriacao = Pick<ZapbotClient, "modoEntrada" | "mensagensTemporarias" | "trocarFoto">;

/** Cada passo grava em `feito` antes do próximo: se falhar, a próxima tentativa retoma dali.
 *  `aoAvancar`, se passado, é chamado depois de cada passo concluído pra persistir o progresso (ex.: na linha da ação). */
export async function criarGrupoPassos(
  z: ZapbotGrupos,
  d: DadosCriacao,
  feito: PassosFeitos,
  aoAvancar?: (f: PassosFeitos) => Promise<void>,
): Promise<PassosFeitos> {
  const c = d.criador;
  feito.groupId ??= await z.criarGrupo(c, d.nome, d.admins);
  await aoAvancar?.(feito);
  if (!feito.promovidos) {
    if (d.admins.length) await z.participantes(c, feito.groupId, d.admins, "promote");
    feito.promovidos = true;
  }
  await aoAvancar?.(feito);
  if (!feito.configurado) {
    await z.configurarGrupo(c, { groupId: feito.groupId, name: d.nome, description: d.descricao, announce: d.fechado });
    feito.configurado = true;
  }
  await aoAvancar?.(feito);
  const comunidade = feito.comunidadeId ?? d.comunidadeId ?? (d.criarComunidade ? await z.criarComunidade(c, d.criarComunidade.nome, d.criarComunidade.descricao) : null);
  if (comunidade) {
    feito.comunidadeId = comunidade;
    await aoAvancar?.(feito);
    if (!feito.ligado) {
      await z.ligarGrupo(c, comunidade, feito.groupId);
      feito.ligado = true;
    }
    await aoAvancar?.(feito);
  }
  feito.link ??= await z.linkConvite(c, feito.groupId);
  await aoAvancar?.(feito);
  return feito;
}

type Acao = {
  id: string;
  tipo: "criar_grupo" | "remover" | "entrar_grupo" | "bloquear_contato" | "desbloquear_contato";
  campanha_id: string | null;
  grupo_id: string | null;
  telefone: string | null;
  dados: PassosFeitos;
  tentativas: number;
  origem?: string | null;
  automacao_id?: string | null;
  created_at?: string;
};

const MAX_TENTATIVAS = 3;

export async function processarAcoes(prazo: Prazo): Promise<number> {
  // Hooks "Campanha sem conta associada" e "Grupo criado": juntos e enfileirados no fim da rodada (nunca lançam).
  const emissor = criarEmissor(dbAdmin());
  try {
    return await processarFila(prazo, emissor);
  } finally {
    await emissor.enviar();
  }
}

async function processarFila(prazo: Prazo, emissor: Emissor): Promise<number> {
  const db = dbAdmin();
  const { data, error } = await db.rpc("pegar_acoes", { limite: 10 });
  if (error) throw new Error(`Não foi possível buscar as ações pendentes: ${error.message}`);
  const acoes = (data ?? []) as Acao[];
  for (const a of acoes) {
    if (restante(prazo) < 8000) {
      await db.from("acoes").update({ status: "fila" }).eq("id", a.id);
      continue;
    }
    const feito: PassosFeitos = { ...(a.dados ?? {}) };
    const salvarProgresso = async (f: PassosFeitos) => {
      const { error } = await db.from("acoes").update({ dados: f }).eq("id", a.id);
      if (error) throw new Error(`Não foi possível salvar o progresso da ação: ${error.message}`);
    };
    try {
      let nota: string | null = null;
      if (a.tipo === "criar_grupo") {
        const r = await executarCriarGrupo(a.campanha_id!, feito, salvarProgresso, a.origem ?? null, prazo, emissor);
        if (r.adiarAte) {
          // Modo seguro (nada foi feito no WhatsApp) ou prazo do tick acabando nos administradores por número
          // (retoma de `dados`): volta pra fila sem gastar tentativa e sem marcar erro.
          const { error } = await db.from("acoes").update({ status: "fila", executar_apos: r.adiarAte.toISOString(), tentativas: a.tentativas - 1, erro: null, dados: feito }).eq("id", a.id);
          if (error) throw new Error(`Não foi possível adiar a criação (modo seguro): ${error.message}`);
          continue;
        }
        nota = r.nota ?? null;
      } else if (a.tipo === "entrar_grupo") {
        await executarEntrarNoGrupo(zapbot(), db, a.dados as unknown as DadosEntrarGrupo);
      } else if (a.tipo === "bloquear_contato" || a.tipo === "desbloquear_contato") {
        await executarContato(zapbot(), db, a.tipo, a.dados as unknown as DadosContato);
      } else nota = await executarRemover(a);
      await db.from("acoes").update({ status: "ok", erro: nota, dados: feito }).eq("id", a.id);
    } catch (e) {
      const erro = e instanceof Error ? e.message : String(e);
      // "Entrar no Grupo": convite recusado pelo WhatsApp (4xx que não é número caído) não melhora tentando de novo.
      const desistiu = a.tentativas >= MAX_TENTATIVAS || (a.tipo === "entrar_grupo" && erroDefinitivoEntrar(e));
      await db.from("acoes").update({ status: desistiu ? "erro" : "fila", erro, dados: feito }).eq("id", a.id);
      if (desistiu && a.tipo === "criar_grupo") await alertar({ tipo: "criacao_erro", texto: `Criação de grupo falhou: ${erro}`, campanhaId: a.campanha_id }, db);
      if (desistiu && (a.tipo === "bloquear_contato" || a.tipo === "desbloquear_contato")) {
        const conexaoId = (a.dados as unknown as DadosContato)?.conexao_id ?? null;
        const nome = await nomeDaConta(db, conexaoId);
        const verbo = a.tipo === "bloquear_contato" ? "bloquear" : "desbloquear";
        const tel = mascararTelefone((a.dados as unknown as DadosContato)?.telefone) ?? "o número";
        await alertar({ tipo: "criacao_erro", texto: `A conexão ${nome} não conseguiu ${verbo} ${tel} no WhatsApp: ${erro}`, campanhaId: null, conexaoId }, db);
      }
      if (desistiu && a.tipo === "entrar_grupo") {
        const conexaoId = (a.dados as unknown as DadosEntrarGrupo)?.conexao_id ?? null;
        const nome = await nomeDaConta(db, conexaoId);
        await alertar({ tipo: "criacao_erro", texto: `A conexão ${nome} não conseguiu entrar no grupo pelo convite: ${erro}`, campanhaId: null, conexaoId }, db);
      }
    }
  }
  return acoes.length;
}

/** `dados` de uma linha "Entrar no Grupo" (Etapa 3K). */
export type DadosEntrarGrupo = { link: string; conexao_id: string };

/** Erro que não adianta repetir: o Zapbot recusou o convite (400/403/409/410/422…). 401/404/408/429 e 5xx podem ser
 *  o número ou o servidor, e voltam pra fila até `MAX_TENTATIVAS`. */
export function erroDefinitivoEntrar(e: unknown): boolean {
  return e instanceof ZapbotError && e.status >= 400 && e.status < 500 && ![401, 404, 408, 429].includes(e.status);
}

async function nomeDaConta(db: Pick<SupabaseClient, "from">, conexaoId: string | null): Promise<string> {
  if (!conexaoId) return "sem conexão";
  const { data } = await db.from("conexoes").select("nome").eq("id", conexaoId).maybeSingle();
  return (data as { nome: string } | null)?.nome ?? "sem nome";
}

/** "Entrar no Grupo": a conta entra pelo convite (`join-group`). Conta desconectada ou removida = erro (volta pra
 *  fila até desistir e virar alerta). Deu certo → histórico "Conta {nome} entrou no grupo pelo convite". O grupo não
 *  vai pra campanha nenhuma (a resposta do Zapbot nem traz o `groupId`). */
export async function executarEntrarNoGrupo(
  z: Pick<ZapbotClient, "entrarNoGrupo">,
  db: Pick<SupabaseClient, "from">,
  d: DadosEntrarGrupo,
  pegarCredenciais: (conexaoId: string) => Promise<ZapbotConexao> = credenciais,
): Promise<void> {
  if (!d?.conexao_id || !d.link) throw new Error("Ação sem conexão ou sem link.");
  const { data, error } = await db.from("conexoes").select("nome, status").eq("id", d.conexao_id).maybeSingle();
  if (error) throw new Error(`Não foi possível ler a conexão: ${error.message}`);
  const conta = data as { nome: string; status: string } | null;
  if (!conta) throw new Error("Conexão não existe mais.");
  if (conta.status !== "conectado") throw new Error("Conexão desconectada.");
  try {
    await z.entrarNoGrupo(await pegarCredenciais(d.conexao_id), d.link);
  } catch (e) {
    // A conta já estava no grupo: o objetivo foi cumprido — sucesso, sem alerta.
    if (!jaParticipa(e)) throw e;
    await registrarHistorico(null, { acao: "executar", area: "Ações", resumo: `Conexão ${conta.nome} já estava no grupo do convite`, refId: d.conexao_id });
    return;
  }
  await registrarHistorico(null, { acao: "executar", area: "Ações", resumo: `Conexão ${conta.nome} entrou no grupo pelo convite`, refId: d.conexao_id });
}

/** "Denunciar golpista" / desbloquear golpista (Etapa 3K, Tarefa 6): uma linha por conta (`dados {telefone,
 *  conexao_id}`). Conta apagada ou desconectada = erro (volta pra fila até desistir e virar alerta). O Zapbot não
 *  tem denúncia: só `block`/`unblock` no WhatsApp da conta. */
export type DadosContato = { telefone: string; conexao_id: string };

export async function executarContato(
  z: Pick<ZapbotClient, "bloquearContato" | "desbloquearContato">,
  db: Pick<SupabaseClient, "from">,
  tipo: "bloquear_contato" | "desbloquear_contato",
  d: DadosContato,
  pegarCredenciais: (conexaoId: string) => Promise<ZapbotConexao> = credenciais,
): Promise<void> {
  if (!d?.conexao_id || !d.telefone) throw new Error("Ação sem conexão ou sem telefone.");
  const { data, error } = await db.from("conexoes").select("nome, status").eq("id", d.conexao_id).maybeSingle();
  if (error) throw new Error(`Não foi possível ler a conexão: ${error.message}`);
  const conta = data as { nome: string; status: string } | null;
  if (!conta) throw new Error("Conexão não existe mais.");
  if (conta.status !== "conectado") throw new Error("Conexão desconectada.");
  const c = await pegarCredenciais(d.conexao_id);
  if (tipo === "bloquear_contato") await z.bloquearContato(c, d.telefone);
  else await z.desbloquearContato(c, d.telefone);
  const tel = mascararTelefone(d.telefone) ?? "número";
  await registrarHistorico(null, {
    acao: "executar",
    area: "Anti-spam",
    resumo: tipo === "bloquear_contato" ? `Conexão ${conta.nome} bloqueou ${tel} no WhatsApp` : `Conexão ${conta.nome} desbloqueou ${tel} no WhatsApp`,
    refId: d.conexao_id,
  });
}

/** Erro do `join-group` que quer dizer "a conta já participa desse grupo" (texto do Zapbot/WhatsApp, em inglês ou
 *  português). Conta como sucesso. */
export function jaParticipa(e: unknown): boolean {
  if (!(e instanceof ZapbotError) || e.status < 400 || e.status >= 500) return false;
  return /already (a )?(participant|member|in (the )?group)|already joined|j[áa] (é )?(participante|membro|est[áa] no grupo|participa)/i.test(e.message);
}

/** `nota`: a criação não aconteceu de propósito (trava da campanha), a ação termina "ok" com essa nota.
 *  `adiarAte`: modo seguro (ou prazo do tick acabando nos administradores por número), a ação volta pra fila
 *  até essa hora. */
type ResultadoCriacao = { nota?: string; adiarAte?: Date };

async function executarCriarGrupo(campanhaId: string, feito: PassosFeitos, aoAvancar: (f: PassosFeitos) => Promise<void>, origem: string | null, prazo?: Prazo, emissor?: Emissor): Promise<ResultadoCriacao> {
  const db = dbAdmin();
  const { data: camp } = await db.from("campanhas").select("*").eq("id", campanhaId).single();
  // Hook "Campanha sem conta associada" (uma vez por campanha por dia, pela chave), antes do erro de sempre.
  const semConta = (motivo: string) => emissor?.adicionar(eventoSemConta({ campanhaId, campanhaSlug: camp?.slug, campanhaNome: camp?.nome, motivo }));
  if (camp && !camp.conexao_criadora_id) semConta("Campanha sem número criador");
  if (!camp?.conexao_criadora_id) throw new Error("Campanha sem número criador");
  const opcoes = opcoesCriacao(camp);
  // Travas e espera só antes de existir grupo no WhatsApp: uma retentativa de grupo já criado sempre termina.
  if (!feito.groupId) {
    if (criacaoAutomatica(origem)) {
      const motivo = (await motivoBloqueioCriacao(db, campanhaId, opcoes)) ?? (await motivoJaTemVaga(db, campanhaId, camp.folga ?? 1));
      if (motivo) return { nota: motivo };
    }
  }
  const { data: oficial } = await db.from("conexoes").select("*").eq("id", feito.criadorId ?? camp.conexao_criadora_id).single<ConexaoLinha>();
  let criador = oficial && oficial.status === "conectado" ? oficial : null;
  // Criadora caída (e grupo ainda não criado): uma conexão associada conectada cria no lugar dela (contingência). Fica
  // gravada em `feito.criadorId` antes de chamar o Zapbot, então a retentativa usa a mesma.
  if (!criador && !feito.criadorId && !feito.groupId) {
    const { data: assoc } = await db.from("campanha_conexoes").select("conexoes(*)").eq("campanha_id", campanhaId);
    const associadas = ((assoc ?? []) as unknown as { conexoes: ConexaoLinha | null }[]).map((r) => r.conexoes).filter((c): c is ConexaoLinha => !!c);
    const id = escolherCriadora({ criadoraId: camp.conexao_criadora_id, associadas, conexoes: associadas });
    criador = associadas.find((c) => c.id === id) ?? null;
    if (criador) {
      feito.criadorId = criador.id;
      await aoAvancar(feito);
      await alertar({ tipo: "numero_caiu", campanhaId, conexaoId: criador.id, texto: `${oficial?.nome ?? "O número criador"} está desconectado: o grupo novo da campanha ${camp.nome} vai ser criado pela conexão ${criador.nome}` }, db);
    }
  }
  if (!criador) {
    semConta("Número criador desconectado");
    throw new Error("Número criador desconectado");
  }
  if (!feito.groupId && opcoes.modo_criacao === "seguro") {
    const { data: ultimoDaConta, error: erroUltimo } = await db.from("grupos").select("created_at").eq("conexao_id", criador.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (erroUltimo) throw new Error(`Não foi possível ler a última criação da conexão (modo seguro): ${erroUltimo.message}`);
    const ultima = (ultimoDaConta as { created_at?: string } | null)?.created_at;
    const adiarAte = esperarModoSeguro(opcoes.modo_criacao, ultima ? new Date(ultima) : null, new Date());
    if (adiarAte) return { adiarAte };
  }
  const { data: adm } = await db.from("campanha_conexoes").select("conexoes(telefone, status)").eq("campanha_id", campanhaId);
  const admins = (adm ?? [])
    .map((r) => (r.conexoes as unknown as { telefone: string | null; status: string }))
    .filter((c) => c.status === "conectado" && c.telefone && c.telefone !== criador.telefone)
    .map((c) => c.telefone!);

  // Número e nome ficam fixos na primeira tentativa (gravados em `feito` antes de chamar o Zapbot): uma
  // retentativa não pode sortear outro número e acabar criando um segundo grupo duplicado.
  if (feito.numero === undefined || feito.nome === undefined) {
    const { data: ultimo } = await db.from("grupos").select("numero").eq("campanha_id", campanhaId).order("numero", { ascending: false }).limit(1).maybeSingle();
    const numero = proximoNumero(ultimo?.numero ?? null, opcoes.inicio_contagem);
    feito.numero = numero;
    feito.nome = nomeDoGrupo(camp.padrao_nome, numero, { caractere: opcoes.caractere_numeracao, noInicio: opcoes.numero_no_inicio });
    await aoAvancar(feito);
  }
  const numero = feito.numero;
  const nome = feito.nome;

  await criarGrupoPassos(zapbot(), {
    criador: paraZapbot(criador),
    admins,
    nome,
    descricao: camp.descricao,
    // "Criar aberto e fechar depois de 24h": nasce aberto e o "fechar" fica agendado (abaixo).
    fechado: opcoes.criar_aberto_fechar_24h ? false : camp.fechado,
    comunidadeId: camp.comunidade_id,
    criarComunidade: camp.usar_comunidade && !camp.comunidade_id ? { nome: camp.nome.slice(0, 25), descricao: camp.descricao } : null,
  }, feito, aoAvancar);

  if (feito.comunidadeId && feito.comunidadeId !== camp.comunidade_id) {
    await db.from("campanhas").update({ comunidade_id: feito.comunidadeId }).eq("id", campanhaId);
  }
  const { data: salvo, error } = await db
    .from("grupos")
    .upsert(
      { campanha_id: campanhaId, conexao_id: criador.id, group_id: feito.groupId, nome, numero, link_convite: feito.link, participantes: 1 + admins.length, conferido_em: new Date().toISOString() },
      { onConflict: "group_id" },
    )
    .select("id")
    .single();
  if (error || !salvo) throw new Error(`Grupo criado no WhatsApp mas não foi possível salvar: ${error?.message ?? "sem retorno"}`);
  // Hook "Grupo criado" (chave `grupo_criado:{id}`: a retomada da mesma ação não duplica).
  emissor?.adicionar(eventoGrupoCriado({ grupoId: salvo.id, grupoNome: nome, groupId: feito.groupId!, numero, link: feito.link, campanhaId, campanhaSlug: camp.slug, campanhaNome: camp.nome, conexaoId: criador.id }));
  const terminouAdmins = await adicionarAdminsNumeros(zapbot(), db, { campanhaId, groupId: feito.groupId!, nome, criador: paraZapbot(criador), conexaoId: criador.id }, feito, aoAvancar, prazo);
  // Prazo do tick acabando no meio dos administradores por número: volta pra fila agora (sem gastar tentativa) e
  // a próxima rodada retoma de `feito` (grupo já existe; nada é refeito no WhatsApp).
  if (!terminouAdmins) return { adiarAte: new Date() };
  await aplicarOpcoesPosCriacao(zapbot(), db, { campanhaId, grupoId: salvo.id, groupId: feito.groupId!, nome, criador: paraZapbot(criador), conexaoId: criador.id, opcoes }, feito, aoAvancar);
  // Gatilhos de grupo novo uma vez só: `gatilhos` fica gravado no progresso da ação antes de ela terminar.
  // O grupo já existe e está salvo: se agendar as mensagens dele falhar, a criação não falha (nem repete), avisa.
  if (!feito.gatilhos) {
    try {
      await criarGatilhosGrupoNovo(campanhaId, salvo.id, camp.mensagem_fixa ?? null);
    } catch (e) {
      const erro = e instanceof Error ? e.message : String(e);
      await alertar({ tipo: "criacao_erro", campanhaId, texto: `Grupo ${nome} criado, mas as mensagens do grupo novo não foram agendadas: ${erro}`, conexaoId: criador.id }, db);
    }
    feito.gatilhos = true;
    await aoAvancar(feito);
  }
  // Mesmo espírito dos gatilhos: o grupo já existe e está salvo; se o disparo das automações de "grupo criado"
  // falhar, a criação não falha (nem repete), só avisa. `automacoes` protege contra duplicar na retentativa.
  if (!feito.automacoes) {
    try {
      await dispararAutomacoes({ campanhaId, gatilho: "grupo_criado", grupoId: salvo.id });
    } catch (e) {
      const erro = e instanceof Error ? e.message : String(e);
      await alertar({ tipo: "criacao_erro", campanhaId, texto: `Grupo ${nome} criado, mas as automações do grupo novo não foram agendadas: ${erro}`, conexaoId: criador.id }, db);
    }
    feito.automacoes = true;
    await aoAvancar(feito);
  }
  return {};
}

type DadosAdminsNumeros = { campanhaId: string; groupId: string; nome: string; criador: ZapbotConexao; conexaoId: string };

/** Etapa 3K, Tarefa 1: depois de o grupo existir (criado, contas promovidas e salvo), cada número de
 *  `campanha_admins_numeros` entra (`add`) e vira admin (`promote`), de 5 em 5. O resultado vem por número na
 *  resposta de `group-participants` (`participantesComResultado`): um número que falhou no `add` (não tenta o
 *  `promote`) ou no `promote` vira alerta `criacao_erro` e nunca derruba a criação. Se a chamada do lote inteiro
 *  falhar, refaz número a número pra saber qual foi. Retomável: cada lote concluído fica em
 *  `feito.adminsNumerosFeitos` e, com o prazo do tick acabando (`restante(prazo)` antes de cada lote), devolve
 *  `false` pra ação voltar pra fila e seguir dali. No fim marca `feito.adminsNumeros` (a retentativa não repete).
 *  Campanha sem números: nenhuma chamada ao Zapbot e `feito` intacto (comportamento de hoje). */
export async function adicionarAdminsNumeros(
  z: Pick<ZapbotClient, "participantesComResultado">,
  db: Pick<SupabaseClient, "from">,
  d: DadosAdminsNumeros,
  feito: PassosFeitos,
  aoAvancar: (f: PassosFeitos) => Promise<void>,
  prazo?: Prazo,
): Promise<boolean> {
  if (feito.adminsNumeros) return true;
  const { data, error } = await db.from("campanha_admins_numeros").select("telefone").eq("campanha_id", d.campanhaId).order("created_at");
  if (error) {
    await alertar({ tipo: "criacao_erro", campanhaId: d.campanhaId, texto: `Grupo ${d.nome} criado, mas os administradores por número não foram lidos: ${error.message}`, conexaoId: d.conexaoId }, db);
    return true;
  }
  const jaFeitos = new Set((feito.adminsNumerosFeitos ?? []).flatMap(variantesTelefone));
  const telefones = ((data ?? []) as { telefone: string }[]).map((r) => r.telefone).filter((t) => t && !variantesTelefone(t).some((v) => jaFeitos.has(v)));
  if (!telefones.length && !feito.adminsNumerosFeitos) return true;

  /** Quem deu certo numa ação (variantes do nono dígito juntas). Resposta sem lista por número = todos. */
  const deramCerto = async (lote: string[], acao: "add" | "promote"): Promise<Set<string>> => {
    try {
      const ok = await z.participantesComResultado(d.criador, d.groupId, lote, acao);
      return new Set((ok ?? lote).flatMap((t) => variantesTelefone(t.replace(/\D/g, ""))));
    } catch {
      if (lote.length === 1) return new Set();
      const certos = new Set<string>();
      for (const t of lote) for (const v of await deramCerto([t], acao)) certos.add(v);
      return certos;
    }
  };
  const em = (s: Set<string>) => (t: string) => variantesTelefone(t).some((v) => s.has(v));

  for (const lote of emLotes(telefones, 5)) {
    if (prazo && restante(prazo) < 8000) return false;
    const adicionados = await deramCerto(lote, "add");
    const paraPromover = lote.filter(em(adicionados));
    const promovidos = paraPromover.length ? await deramCerto(paraPromover, "promote") : new Set<string>();
    for (const t of lote.filter((t) => !em(adicionados)(t) || !em(promovidos)(t))) {
      await alertar({ tipo: "criacao_erro", campanhaId: d.campanhaId, texto: `Não foi possível tornar ${mascararTelefone(t) ?? "um número"} administrador do grupo ${d.nome}`, conexaoId: d.conexaoId }, db);
    }
    feito.adminsNumerosFeitos = [...(feito.adminsNumerosFeitos ?? []), ...lote];
    await aoAvancar(feito);
  }
  feito.adminsNumeros = true;
  delete feito.adminsNumerosFeitos;
  await aoAvancar(feito);
  return true;
}

type DadosPosCriacao = {
  campanhaId: string;
  grupoId: string;
  groupId: string;
  nome: string;
  criador: ZapbotConexao;
  conexaoId: string;
  opcoes: ReturnType<typeof opcoesCriacao>;
};

/** Opções da campanha aplicadas depois que o grupo existe e está salvo: imagem do grupo (`group-picture`, Etapa 3M),
 *  aprovação de entrada (`group-mode`), mensagens temporárias (`chat-disappearing`) e o "fechar" agendado pra 24 h
 *  depois. Cada passo roda uma vez só (marcado em `feito`, mesmo quando falha) e uma falha vira alerta: nunca derruba
 *  nem desfaz a criação. Com as opções padrão, nada é chamado. Foto posta = `grupos.foto_url` já com ela (a
 *  conferência troca depois pela URL que o WhatsApp devolver). */
export async function aplicarOpcoesPosCriacao(
  z: ZapbotPosCriacao,
  db: Pick<SupabaseClient, "from">,
  d: DadosPosCriacao,
  feito: PassosFeitos,
  aoAvancar: (f: PassosFeitos) => Promise<void>,
): Promise<void> {
  const passo = async (marca: "foto" | "aprovacao" | "temporarias" | "fecharAgendado", ligado: boolean, oQue: string, f: () => Promise<void>) => {
    if (feito[marca] || !ligado) return;
    try {
      await f();
    } catch (e) {
      const erro = e instanceof Error ? e.message : String(e);
      await alertar({ tipo: "criacao_erro", campanhaId: d.campanhaId, texto: `Grupo ${d.nome} criado, mas ${oQue}: ${erro}`, conexaoId: d.conexaoId }, db);
    }
    feito[marca] = true;
    await aoAvancar(feito);
  };
  const imagem = d.opcoes.imagem_grupo_url;
  await passo("foto", !!imagem, "a foto não foi trocada", async () => {
    try {
      await z.trocarFoto(d.criador, d.groupId, imagem!);
    } catch (e) {
      // Imagem recusada pelo WhatsApp: o alerta diz a regra (lado mínimo), não a mensagem crua do Zapbot.
      const clara = e instanceof Error ? erroDaImagemNoZapbot(e.message) : null;
      throw clara ? new Error(clara) : e;
    }
    // A foto já está no WhatsApp: se o banco falhar aqui, só fica a letra até a próxima conferência (não é alerta).
    const { error } = await db.from("grupos").update(fotoPosta(imagem!, new Date().toISOString())).eq("id", d.grupoId);
    if (error) console.error(`Grupo ${d.grupoId}: foto trocada no WhatsApp mas não gravada no banco: ${error.message}`);
  });
  await passo("aprovacao", d.opcoes.aprovacao_entrada, "a aprovação de entrada não foi ligada", () => z.modoEntrada(d.criador, d.groupId, true));
  const segundos = segundosTemporarias(d.opcoes.mensagens_temporarias);
  await passo("temporarias", segundos !== null, "as mensagens temporárias não foram ligadas", () => z.mensagensTemporarias(d.criador, d.groupId, segundos!));
  await passo("fecharAgendado", d.opcoes.criar_aberto_fechar_24h, "o fechamento em 24 h não foi agendado (o grupo ficou aberto)", async () => {
    const { error } = await db.from("execucoes").insert(execucaoFecharGrupo(d.campanhaId, d.grupoId, new Date()));
    if (error) throw new Error(error.message);
  });
}

export const NOTA_AUTOMACAO_DESATIVADA = "Automação desativada: remoção não feita.";
export const NOTA_NUMERO_CONECTADO = "Número conectado no sistema: não removido.";
export const NOTA_NUMERO_ADMINISTRATIVO = "Número administrativo: não removido.";
export const NOTA_FORA_DO_GRUPO = "Já não estava no grupo.";
export const NOTA_VIROU_ADMIN = "Virou admin: não removido.";
export const NOTA_NAO_DUPLICADO = "Não é mais duplicado: removido do outro grupo antes.";
export const NOTA_CONTA_NAO_AUTORIZADA = "Anti-spam por Conexões Associadas: a conexão do grupo não está autorizada a remover.";
export const NOTA_NAO_MAIS_BLOQUEADO = "Número não está mais bloqueado";
export const NOTA_SO_LID = "Contato só aparece como LID no grupo: remova à mão.";
export const NOTA_NAO_MAIS_ANTERIOR = "Não está mais num grupo de campanha que remove desta: não removido.";

/** Início do dia em Brasília (UTC−3 fixo, como `regras/horario.ts`), em ISO UTC. */
function inicioDoDiaBrasilia(agora: Date = new Date()): string {
  const local = new Date(agora.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
  return new Date(`${local}T00:00:00-03:00`).toISOString();
}

/** "Antispam por Contas Associadas" (configuracoes `antispam_contas`): conferido na hora de remover, então vale
 *  também pra remoção que já estava na fila quando o interruptor foi ligado. Desligado (ou sem linha): toda conta
 *  remove, como antes. Conta não autorizada: não remove e alerta uma vez por grupo por dia. */
async function contaAutorizadaAntispam(db: ReturnType<typeof dbAdmin>, a: Acao, g: { conexao_id: string | null; nome?: string | null }): Promise<boolean> {
  const { data, error } = await db.from("configuracoes").select("valor").eq("chave", CHAVE_ANTISPAM_CONTAS).maybeSingle();
  if (error) throw new Error(`Não foi possível ler o Antispam por Conexões Associadas: ${error.message}`);
  const cfg = lerAntispamContas((data as { valor: unknown } | null)?.valor);
  if (contaPodeRemover(cfg, g.conexao_id)) return true;

  let conta = "sem conexão";
  if (g.conexao_id) {
    const { data: c } = await db.from("conexoes").select("nome").eq("id", g.conexao_id).maybeSingle();
    conta = (c as { nome: string } | null)?.nome ?? conta;
  }
  const texto = textoAlertaSemConta(g.nome ?? "sem nome", conta);
  const { data: ja, error: erroJa } = await db
    .from("alertas")
    .select("id")
    .eq("tipo", "antispam_sem_conta")
    .eq("texto", texto)
    .gte("created_at", inicioDoDiaBrasilia())
    .limit(1);
  // Sem conseguir conferir, alerta de novo: melhor repetido que perdido.
  if (erroJa || !((ja as unknown[] | null) ?? []).length) {
    await alertar({ tipo: "antispam_sem_conta", texto, campanhaId: a.campanha_id, conexaoId: g.conexao_id }, db);
  }
  return false;
}

/** Duplicado de verdade na hora de remover: a pessoa ainda tem participação aberta (não admin) em OUTRO grupo ativo
 *  da mesma campanha, e esse grupo foi conferido depois que a remoção entrou na fila (a participação não é resto de
 *  uma leitura velha). Se ela saiu do outro grupo nesse meio tempo, fica neste. */
async function aindaDuplicado(db: ReturnType<typeof dbAdmin>, a: Acao, variantes: string[]): Promise<boolean> {
  const { data, error } = await db
    .from("participantes")
    .select("grupo_id, grupos!inner(campanha_id, ativo, conferido_em)")
    .in("telefone", variantes)
    .is("saiu_em", null)
    .eq("admin", false)
    .neq("grupo_id", a.grupo_id!)
    .eq("grupos.campanha_id", a.campanha_id!)
    .eq("grupos.ativo", true)
    .gt("grupos.conferido_em", a.created_at ?? new Date(0).toISOString())
    .limit(1);
  if (error) throw new Error(`Não foi possível conferir se ainda é duplicado: ${error.message}`);
  return ((data as unknown[] | null) ?? []).length > 0;
}

/** "Remover Lead de Campanhas Anteriores": a remoção (5 min depois da rodada) só segue se a pessoa ainda está aberta
 *  num grupo ativo de uma campanha com a seção ligada e esta campanha (a antiga, `a.campanha_id`) ainda na lista
 *  dela. Saiu do grupo novo, a seção foi desligada ou a campanha saiu da lista: não remove. */
async function aindaEmCampanhaQueRemove(db: ReturnType<typeof dbAdmin>, a: Acao, variantes: string[]): Promise<boolean> {
  const { data, error } = await db
    .from("participantes")
    .select("grupo_id, grupos!inner(campanha_id, ativo, campanhas!inner(remover_anteriores_ativo, campanhas_anteriores))")
    .in("telefone", variantes)
    .is("saiu_em", null)
    .neq("grupo_id", a.grupo_id!)
    .eq("grupos.ativo", true)
    .eq("grupos.campanhas.remover_anteriores_ativo", true)
    .contains("grupos.campanhas.campanhas_anteriores", [a.campanha_id!])
    .limit(1);
  if (error) throw new Error(`Não foi possível conferir a campanha nova antes de remover: ${error.message}`);
  return ((data as unknown[] | null) ?? []).length > 0;
}

/** O bloqueio pode ter sido desfeito (desbloqueado, ou a blacklist dele desativada/apagada) entre a rodada que
 *  enfileirou e a execução, 60 s depois: confere de novo na fonte única antes de remover. */
async function aindaBloqueado(db: ReturnType<typeof dbAdmin>, variantes: string[], telefone: string): Promise<boolean> {
  const { data, error } = await db.from(FONTE_BLOQUEADOS).select("telefone").in("telefone", variantes).limit(1);
  if (error) throw new Error(`Não foi possível conferir se o número ainda está bloqueado: ${error.message}`);
  if (((data as unknown[] | null) ?? []).length > 0) return true;
  // Bloquear por LID (Etapa 3K, Tarefa 6): participante gravado com o id LID casa com `bloqueados.lid`.
  const lid = lidDoId(telefone);
  if (!lid) return false;
  const { data: porLid, error: erroLid } = await db.from("bloqueados").select("telefone").eq("lid", lid).limit(1);
  if (erroLid) throw new Error(`Não foi possível conferir se o LID ainda está bloqueado: ${erroLid.message}`);
  return ((porLid as unknown[] | null) ?? []).length > 0;
}

/** Remove o telefone do grupo no WhatsApp. Antes confere (e pula, devolvendo a nota que fica na ação): automação
 *  que gerou a remoção desativada ou apagada; número conectado no sistema; quem já não está no grupo pelo banco;
 *  quem virou admin; duplicado que já saiu do outro grupo; bloqueio que já não vale mais; remoção do anti-spam em
 *  grupo de conta não autorizada (Antispam por Contas Associadas ligado). Vale pra toda remoção (venda,
 *  automação). `null` = removeu. */
async function executarRemover(a: Acao): Promise<string | null> {
  const db = dbAdmin();
  const grupoId = a.grupo_id!;
  const telefone = a.telefone!;
  if (a.automacao_id || a.origem === "automacao") {
    // Automação apagada: `automacao_id` vira null (on delete set null), mas a origem continua "automacao".
    let ativa = false;
    if (a.automacao_id) {
      const { data: auto, error } = await db.from("automacoes").select("ativo").eq("id", a.automacao_id).maybeSingle();
      if (error) throw new Error(`Não foi possível ler a automação da remoção: ${error.message}`);
      ativa = !!(auto as { ativo: boolean } | null)?.ativo;
    }
    if (!ativa) return NOTA_AUTOMACAO_DESATIVADA;
  }
  const variantes = variantesTelefone(telefone);
  // Conferido de novo na hora de remover (a lista pode ter mudado desde que a remoção entrou na fila).
  const [conectados, administrativos] = await Promise.all([telefonesConectados(db), telefonesAdministrativos(db)]);
  if (variantes.some((v) => conectados.has(v))) return NOTA_NUMERO_CONECTADO;
  if (variantes.some((v) => administrativos.has(v))) return NOTA_NUMERO_ADMINISTRATIVO;
  const { data: abertas, error: erroAbertas } = await db.from("participantes").select("admin").eq("grupo_id", grupoId).in("telefone", variantes).is("saiu_em", null);
  if (erroAbertas) throw new Error(`Não foi possível ler o participante antes de remover: ${erroAbertas.message}`);
  const participacoes = (abertas as { admin: boolean }[] | null) ?? [];
  if (!participacoes.length) return NOTA_FORA_DO_GRUPO;
  if (participacoes.some((p) => p.admin)) return NOTA_VIROU_ADMIN;
  if (a.origem === "duplicado" && !(await aindaDuplicado(db, a, variantes))) return NOTA_NAO_DUPLICADO;
  if (a.origem === "bloqueado" && !(await aindaBloqueado(db, variantes, telefone))) return NOTA_NAO_MAIS_BLOQUEADO;
  if (a.origem === "campanha_anterior" && !(await aindaEmCampanhaQueRemove(db, a, variantes))) return NOTA_NAO_MAIS_ANTERIOR;

  const { data: g } = await db.from("grupos").select("group_id, conexao_id, nome").eq("id", grupoId).single();
  if (!g) return null;
  if (a.origem === "bloqueado" && !(await contaAutorizadaAntispam(db, a, g))) return NOTA_CONTA_NAO_AUTORIZADA;
  // Remoção de bloqueado por id LID que já estava na fila (de antes da trava): o Zapbot não remove por LID (falha e
  // volta pra fila). Não chama o Zapbot: fecha a ação com a nota e alerta (um por grupo por dia).
  if (a.origem === "bloqueado" && ehIdLid(telefone)) {
    await alertarSoLid(db, { grupoNome: g.nome ?? "sem nome", campanhaId: a.campanha_id ?? null, conexaoId: g.conexao_id ?? null });
    return NOTA_SO_LID;
  }
  await zapbot().participantes(await credenciais(g.conexao_id), g.group_id, [telefone], "remove");
  const { error } = await db
    .from("participantes")
    .update({ saiu_em: new Date().toISOString(), motivo_saida: motivoDaOrigem(a.origem ?? null) })
    .eq("grupo_id", grupoId)
    .in("telefone", variantesTelefone(telefone))
    .is("saiu_em", null);
  if (error) throw new Error(`Removido do WhatsApp mas não foi possível atualizar o participante: ${error.message}`);
  return null;
}
