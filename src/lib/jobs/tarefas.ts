import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { telefonesConectados, telefonesProtegidos } from "../automacoes";
import { paraZapbot, type ConexaoLinha } from "../conexoes";
import { ROTULO_TIPO, type TipoExecucao } from "../regras/conteudo";
import { compararTarefas, decidirExecucaoVazia } from "../regras/tarefas";
import { variantesTelefone } from "../telefone";
import { eventoAcaoConcluida, eventoFalhaDisparo, eventoGrupoSuspenso } from "../regras/webhooks";
import { dbAdmin } from "../supabase/admin";
import { criarEmissor, type Emissor } from "../webhooks";
import { zapbot } from "../zapbot/client";
import { classificarErro, type ReacaoErro } from "../zapbot/erros";
import { alertar } from "./alertas";
import { campanhasDoNumero } from "./monitor";
import { executarTarefa, ProgressoNaoSalvo, type ContextoTarefa, type ResultadoTarefa } from "./executar-tarefa";
import { restante, type Prazo } from "./tipos";

const MAX_TENTATIVAS = 3;
const DEZ_MIN = 600_000;
const MARGEM_MS = 5000;
const INTERVALO_MIN_MS = 3000;
const INTERVALO_MAX_MS = 8000;
/** Entre duas mensagens da mesma tarefa: só segue se, depois da espera, ainda sobram 10 s no lote (um envio pode
 *  demorar; mesma folga que o laço exige pra pegar tarefa nova). */
const MARGEM_ENTRE_MENSAGENS_MS = 10_000;

export function resultadoErro(reacao: ReacaoErro, tentativas: number) {
  if (reacao === "desconectado") return { status: "erro" as const, esperaMs: 0, pausarConexaoMs: 0, desconectar: true };
  if (reacao === "falha" || tentativas >= MAX_TENTATIVAS) return { status: "erro" as const, esperaMs: 0, pausarConexaoMs: 0, desconectar: false };
  if (reacao === "pausar") return { status: "fila" as const, esperaMs: DEZ_MIN, pausarConexaoMs: DEZ_MIN, desconectar: false };
  return { status: "fila" as const, esperaMs: 30_000, pausarConexaoMs: 0, desconectar: false };
}

/** Horário em que a tarefa pode sair: o mais tardio entre o agendado dela e a liberação do número (intervalo entre tarefas). */
export function calcularAlvo(enviarAposMs: number, proximoPermitidoMs: number): number {
  return Math.max(enviarAposMs, proximoPermitidoMs);
}

/** Cabe no prazo do lote quando, depois de esperar até `alvoMs`, ainda sobra a margem de segurança. */
export function cabeNoPrazo(alvoMs: number, agoraMs: number, restanteMs: number, margemMs = MARGEM_MS): boolean {
  return alvoMs - agoraMs <= restanteMs - margemMs;
}

type Tarefa = {
  id: string;
  execucao_id: string;
  grupo_id: string;
  conexao_id: string;
  tipo: TipoExecucao;
  prioridade: number;
  tentativas: number;
  enviar_apos: string;
  /** Índice da próxima mensagem v2 (coluna da Etapa 3C; ausente = 0). */
  progresso?: number | null;
  message_id?: string | null;
  /** Conteúdo resolvido com as variáveis do grupo (Etapa 3E); ausente/null = `conteudo_final` da execução. */
  conteudo_grupo?: unknown;
};
type Exec = { id: string; tipo: TipoExecucao; conteudo_final: unknown };
type Grupo = { group_id: string; numero: number; nome: string; campanha_id: string };

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Marca a tarefa como feita; tenta algumas vezes porque já aconteceu no WhatsApp — não dá pra repetir se a escrita falhar. */
async function marcarFeita(db: SupabaseClient, tarefaId: string, messageId: string | null, nota: string | null = null): Promise<void> {
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    const { error } = await db.from("tarefas").update({ status: "enviado", message_id: messageId, erro: nota, enviado_em: new Date().toISOString() }).eq("id", tarefaId);
    if (!error) return;
    if (tentativa < 3) await sleep(500);
    else console.error(`Tarefa ${tarefaId} feita mas não foi possível atualizar o status depois de 3 tentativas: ${error.message}`);
  }
}

/** Grava o andamento da mensagem v2 antes da próxima. Tenta 3 vezes; se não der, lança (quem chama vira
 *  `ProgressoNaoSalvo`: erro sem nova tentativa automática, porque a mensagem já saiu). */
async function gravarProgresso(db: SupabaseClient, tarefaId: string, proximo: number, messageId: string | null): Promise<void> {
  let ultimo = "";
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    const { error } = await db.from("tarefas").update(messageId ? { progresso: proximo, message_id: messageId } : { progresso: proximo }).eq("id", tarefaId);
    if (!error) return;
    ultimo = error.message;
    if (tentativa < 3) await sleep(500);
  }
  throw new Error(ultimo);
}

/** Pessoas removidas pelo `remover_participantes`: saem do grupo no banco também (motivo "manual"). */
async function marcarRemovidos(db: SupabaseClient, grupoId: string, telefones: string[]): Promise<void> {
  if (!telefones.length) return;
  const { error } = await db
    .from("participantes")
    .update({ saiu_em: new Date().toISOString(), motivo_saida: "manual" })
    .eq("grupo_id", grupoId)
    .in("telefone", telefones.flatMap(variantesTelefone))
    .is("saiu_em", null);
  if (error) console.error(`Grupo ${grupoId}: participantes removidos no WhatsApp mas não atualizados no banco: ${error.message}`);
}

/** Comunidade desativada: a campanha que usava ela fica sem comunidade (e não cria outra sozinha no próximo grupo). */
async function soltarComunidade(db: SupabaseClient, comunidadeId: string): Promise<void> {
  const { error } = await db.from("campanhas").update({ comunidade_id: null, usar_comunidade: false }).eq("comunidade_id", comunidadeId);
  if (error) console.error(`Comunidade ${comunidadeId} desativada mas a campanha não foi atualizada: ${error.message}`);
}

async function semFalhar(oQue: string, f: () => Promise<void>): Promise<void> {
  try {
    await f();
  } catch (e) {
    console.error(`${oQue} falhou depois de feita no WhatsApp: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Nome novo, link novo ou foto nova ("Trocar imagem", `foto_url`): o banco acompanha o WhatsApp. */
async function atualizarGrupo(db: SupabaseClient, grupoId: string, r: ResultadoTarefa): Promise<void> {
  if (!r.grupo) return;
  const { error } = await db.from("grupos").update(r.grupo).eq("id", grupoId);
  if (error) console.error(`Grupo ${grupoId} mudou no WhatsApp mas não foi possível atualizar o banco: ${error.message}`);
}

/** Sorteia quando o número fica livre de novo: 3–8 s depois da última chamada ao Zapbot (deu certo ou não). */
export function liberarNumero(proximoPermitido: Map<string, number>, conexaoId: string, agoraMs = Date.now(), aleatorio = Math.random()): void {
  proximoPermitido.set(conexaoId, agoraMs + INTERVALO_MIN_MS + Math.round(aleatorio * (INTERVALO_MAX_MS - INTERVALO_MIN_MS)));
}

/** `proximoPermitido`: quando cada número fica livre de novo. A rota do tick passa o mesmo mapa nas duas chamadas
 *  (tarefas e tarefas2) pra o intervalo de 3–8 s valer entre elas também. */
export async function processarTarefas(prazo: Prazo, proximoPermitido: Map<string, number> = new Map()): Promise<number> {
  // Hooks "Grupo suspenso", "Falha em disparo agendado" e "Ação concluída": juntos e enfileirados no fim da
  // rodada (uma leitura de webhooks, só se houver evento). Nunca lançam.
  const emissor = criarEmissor(dbAdmin());
  try {
    return await processarLote(prazo, proximoPermitido, emissor);
  } finally {
    await emissor.enviar();
  }
}

async function processarLote(prazo: Prazo, proximoPermitido: Map<string, number>, emissor: Emissor): Promise<number> {
  const db = dbAdmin();
  let total = 0;
  const cacheExec = new Map<string, Exec>();
  const cacheConexao = new Map<string, ConexaoLinha>();
  const cacheGrupo = new Map<string, Grupo>();
  // Número faz uma tarefa de cada vez (mensagem ou ação): fica livre de novo só depois do intervalo sorteado
  // (em `proximoPermitido`, recebido de fora).
  // Número que travou neste lote (pausado ou desconectado): as tarefas seguintes dele não são tentadas.
  const bloqueadas = new Map<string, number | "desconectado">();
  // Números conectados (lidos uma vez, só se aparecer um `admin_remover`): nunca rebaixados.
  let protegidos: Set<string> | undefined;
  let protegidosRemover: Set<string> | undefined;

  while (restante(prazo) > 10_000) {
    const { data, error } = await db.rpc("pegar_tarefas", { limite: 20 });
    if (error) throw new Error(`Não foi possível buscar as tarefas pendentes: ${error.message}`);
    const lote = ((data ?? []) as Tarefa[]).sort(compararTarefas);
    if (!lote.length) break;
    for (const t of lote) {
      const bloqueio = bloqueadas.get(t.conexao_id);
      if (bloqueio !== undefined) {
        if (bloqueio === "desconectado") {
          await db.from("tarefas").update({ status: "erro", erro: "número desconectado" }).eq("id", t.id);
        } else {
          const { error } = await db.from("tarefas").update({ status: "fila", enviar_apos: new Date(bloqueio).toISOString(), tentativas: t.tentativas - 1 }).eq("id", t.id);
          if (error) console.error(`Tarefa ${t.id} não pôde voltar pra fila (número pausado): ${error.message}`);
        }
        continue;
      }

      const alvo = calcularAlvo(new Date(t.enviar_apos).getTime(), proximoPermitido.get(t.conexao_id) ?? 0);
      if (!cabeNoPrazo(alvo, Date.now(), restante(prazo))) {
        const { error } = await db.from("tarefas").update({ status: "fila", enviar_apos: new Date(alvo).toISOString(), tentativas: t.tentativas - 1 }).eq("id", t.id);
        if (error) console.error(`Tarefa ${t.id} não pôde voltar pra fila (sem tempo no lote): ${error.message}`);
        continue;
      }
      if (alvo > Date.now()) await sleep(alvo - Date.now());

      let exec = cacheExec.get(t.execucao_id);
      if (!exec) {
        const r = await db.from("execucoes").select("id, tipo, conteudo_final").eq("id", t.execucao_id).single<Exec>();
        exec = r.data ?? undefined;
      }
      let conexao = cacheConexao.get(t.conexao_id);
      if (!conexao) {
        const r = await db.from("conexoes").select("*").eq("id", t.conexao_id).single<ConexaoLinha>();
        conexao = r.data ?? undefined;
      }
      let grupo = cacheGrupo.get(t.grupo_id);
      if (!grupo) {
        const r = await db.from("grupos").select("group_id, numero, nome, campanha_id").eq("id", t.grupo_id).single<Grupo>();
        grupo = r.data ?? undefined;
      }

      if (!exec || !exec.conteudo_final || !conexao || !grupo) {
        await db.from("tarefas").update({ status: "erro", erro: "Não foi possível carregar a execução, a conexão ou o grupo desta tarefa." }).eq("id", t.id);
        continue;
      }
      cacheExec.set(t.execucao_id, exec);
      cacheConexao.set(t.conexao_id, conexao);
      cacheGrupo.set(t.grupo_id, grupo);

      const g = grupo;
      const aoGrupoSumir = async () => {
        const { error } = await db.from("grupos").update({ ativo: false, suspenso: true }).eq("id", t.grupo_id);
        if (error) console.error(`Grupo ${t.grupo_id} sumiu do WhatsApp mas não foi possível desativar: ${error.message}`);
        await alertar({ tipo: "grupo_sumiu", texto: `Grupo ${g.nome} não existe mais no WhatsApp e foi desativado`, campanhaId: g.campanha_id, conexaoId: t.conexao_id }, db);
        emissor.adicionar(eventoGrupoSuspenso({ grupoId: t.grupo_id, grupoNome: g.nome, groupId: g.group_id, campanhaId: g.campanha_id, conexaoId: t.conexao_id }));
      };
      try {
        let r: ResultadoTarefa;
        // Remoção em massa: conectados + Números administrativos (Etapa 3K, Tarefa 6). Rebaixar admin: só os
        // conectados, como sempre (rebaixar é ação explícita; um número administrativo pode ser rebaixado).
        if (exec.tipo === "remover_participantes") protegidosRemover ??= await telefonesProtegidos(db);
        if (exec.tipo === "admin_remover") protegidos ??= await telefonesConectados(db);
        const ctx: ContextoTarefa = {
          progresso: t.progresso ?? 0,
          messageIdInicial: t.message_id ?? null,
          salvarProgresso: (proximo, messageId) => gravarProgresso(db, t.id, proximo, messageId),
          podeContinuar: (esperaMs) => cabeNoPrazo(Date.now() + esperaMs, Date.now(), restante(prazo), MARGEM_ENTRE_MENSAGENS_MS),
          esperar: sleep,
        };
        try {
          r = await executarTarefa(zapbot(), paraZapbot(conexao), exec.tipo, t.conteudo_grupo ?? exec.conteudo_final, { groupId: grupo.group_id, numero: grupo.numero }, aoGrupoSumir, exec.tipo === "remover_participantes" ? protegidosRemover : protegidos, ctx);
        } finally {
          // Toda chamada ao Zapbot conta pro intervalo do número, mesmo a que falhou.
          liberarNumero(proximoPermitido, t.conexao_id);
        }
        if (r.pausada) {
          // Sem tempo no lote entre duas mensagens: o progresso já está salvo; volta pra fila (não é erro nem tentativa).
          const { error } = await db
            .from("tarefas")
            .update({ status: "fila", enviar_apos: new Date(Date.now() + r.pausada.esperaMs).toISOString(), tentativas: t.tentativas - 1 })
            .eq("id", t.id);
          if (error) console.error(`Tarefa ${t.id} parou entre mensagens e não pôde voltar pra fila: ${error.message}`);
          continue;
        }
        // Já aconteceu no WhatsApp: daqui pra frente nada pode devolver a tarefa pra fila (repetiria). Cada escrita
        // é isolada; falha vira log (e, no pior caso, a tarefa fica em 'processando' até o "pode ter sido feita").
        const r2 = r;
        await semFalhar(`tarefa ${t.id}: marcar feita`, () => marcarFeita(db, t.id, r2.messageId, r2.nota ?? null));
        await semFalhar(`tarefa ${t.id}: atualizar grupo`, () => atualizarGrupo(db, t.grupo_id, r2));
        if (r2.removidos) await semFalhar(`tarefa ${t.id}: marcar removidos`, () => marcarRemovidos(db, t.grupo_id, r2.removidos!));
        if (r2.comunidadeDesativada) await semFalhar(`tarefa ${t.id}: soltar comunidade`, () => soltarComunidade(db, r2.comunidadeDesativada!));
        total++;
      } catch (err) {
        if (err instanceof ProgressoNaoSalvo) {
          // Mensagem saiu e o progresso não foi gravado: erro definitivo (uma retentativa poderia mandar de novo).
          // Se nem isso gravar, a tarefa fica em 'processando' e o `pegar_tarefas` a marca como "pode ter sido feita".
          const { error } = await db.from("tarefas").update({ status: "erro", erro: err.message }).eq("id", t.id);
          if (error) console.error(`Tarefa ${t.id}: ${err.message} E não foi possível marcar o erro: ${error.message}`);
          continue;
        }
        const r = resultadoErro(classificarErro(err), t.tentativas);
        await db.from("tarefas").update({
          status: r.status,
          erro: err instanceof Error ? err.message : String(err),
          enviar_apos: new Date(Date.now() + r.esperaMs).toISOString(),
        }).eq("id", t.id);
        if (r.pausarConexaoMs) {
          const fimPausa = Date.now() + r.pausarConexaoMs;
          await db.from("conexoes").update({ pausado_ate: new Date(fimPausa).toISOString() }).eq("id", t.conexao_id);
          bloqueadas.set(t.conexao_id, fimPausa);
        }
        if (r.desconectar) {
          await db.from("conexoes").update({ status: "desconectado", ultimo_erro: "Desconectou durante uma tarefa" }).eq("id", t.conexao_id);
          // Início da queda, só na transição (`caiu_em` vazio): erros repetidos de envio não empurram a espera de
          // 10 min da "Atualização de links" para frente.
          const { error: erroQueda } = await db.from("conexoes").update({ caiu_em: new Date().toISOString() }).eq("id", t.conexao_id).is("caiu_em", null);
          if (erroQueda) console.error(`[tarefas] não foi possível gravar o início da queda da conexão ${t.conexao_id}: ${erroQueda.message}`);
          bloqueadas.set(t.conexao_id, "desconectado");
          await alertar({ tipo: "numero_caiu", texto: `Número ${conexao.nome} caiu durante um envio`, campanhaId: null, avisarCampanhas: await campanhasDoNumero(t.conexao_id), conexaoId: t.conexao_id }, db);
        }
      }
    }
  }
  await concluirExecucoes(emissor);
  return total;
}

/** Execução sem tarefa pendente vira concluída; se sobrou erro, avisa uma vez (um alerta por execução, não por grupo).
 *  Execução sem nenhuma tarefa não é fechada aqui: a de zero grupos o `iniciar` já fecha, e as outras podem estar
 *  no meio do `iniciar` de outro tick (tarefas ainda não inseridas). Se ficou assim mais de 5 min, o `iniciar`
 *  morreu no meio: volta pra 'agendada' (ou vira 'pulada', se for passo de sequência já atrasado demais). */
async function concluirExecucoes(emissor: Emissor) {
  const db = dbAdmin();
  const agora = new Date();
  const { data, error } = await db.from("execucoes").select("id, campanha_id, tipo, origem, gatilho_chave, agendada_para, iniciada_em, campanhas(nome)").eq("status", "enviando");
  if (error) throw new Error(`Não foi possível buscar as execuções em andamento: ${error.message}`);
  const falhas: string[] = [];
  type Linha = { id: string; campanha_id: string; tipo: TipoExecucao; origem: string; gatilho_chave: string | null; agendada_para: string; iniciada_em: string | null; campanhas: { nome: string } | null };
  for (const e of (data ?? []) as unknown as Linha[]) {
    const [pend, tot] = await Promise.all([
      db.from("tarefas").select("id", { count: "exact", head: true }).eq("execucao_id", e.id).in("status", ["fila", "processando"]),
      db.from("tarefas").select("id", { count: "exact", head: true }).eq("execucao_id", e.id),
    ]);
    if (pend.error || tot.error) {
      falhas.push(`execução ${e.id}: não foi possível contar as tarefas (${(pend.error ?? tot.error)!.message})`);
      continue;
    }
    const total = tot.count ?? 0;
    if (!total) {
      const decisao = decidirExecucaoVazia({ iniciadaEm: e.iniciada_em, origem: e.origem, gatilhoChave: e.gatilho_chave, agendadaPara: e.agendada_para }, agora);
      if (decisao === "esperar") continue;
      const mudanca =
        decisao === "pular"
          ? { status: "pulada", motivo: "Ficou parada sem tarefas e já passou mais de 15 min do horário." }
          : { status: "agendada", iniciada_em: null };
      const { data: mudou, error: erroMudar } = await db.from("execucoes").update(mudanca).eq("id", e.id).eq("status", "enviando").select("id");
      if (erroMudar) {
        falhas.push(`execução ${e.id}: ficou parada sem tarefas e não foi possível ${decisao === "pular" ? "marcar como pulada" : "voltar pra agendada"} (${erroMudar.message})`);
        continue;
      }
      if (!mudou?.length) continue;
      const oQue = decisao === "pular" ? "foi pulada (passou mais de 15 min do horário)" : "voltou pra fila e sai no próximo minuto";
      const texto = `${ROTULO_TIPO[e.tipo]} ficou parada sem tarefas por mais de 5 min e ${oQue} (campanha ${e.campanhas?.nome ?? "?"})`;
      await alertar({ tipo: "tarefa_erro", texto, campanhaId: e.campanha_id }, db);
      emissor.adicionar(eventoFalhaDisparo({ campanhaId: e.campanha_id, campanhaNome: e.campanhas?.nome, execucaoId: e.id, tipo: e.tipo, tipoNome: ROTULO_TIPO[e.tipo], motivo: "parada", texto }));
      continue;
    }
    if (pend.count) continue;
    const { data: fechou, error: erroFechar } = await db.from("execucoes").update({ status: "concluida" }).eq("id", e.id).eq("status", "enviando").select("id");
    if (erroFechar) {
      falhas.push(`execução ${e.id}: não foi possível marcar como concluída (${erroFechar.message})`);
      continue;
    }
    if (!fechou?.length) continue;
    const { count: erros, error: erroErros } = await db.from("tarefas").select("id", { count: "exact", head: true }).eq("execucao_id", e.id).eq("status", "erro");
    const concluida = { campanhaId: e.campanha_id, campanhaNome: e.campanhas?.nome, execucaoId: e.id, tipo: e.tipo, tipoNome: ROTULO_TIPO[e.tipo], total };
    if (erroErros) {
      falhas.push(`execução ${e.id}: concluída, mas não foi possível contar os erros (${erroErros.message})`);
      emissor.adicionar(eventoAcaoConcluida({ ...concluida, enviadas: null, erros: null }));
      continue;
    }
    emissor.adicionar(eventoAcaoConcluida({ ...concluida, enviadas: total - (erros ?? 0), erros: erros ?? 0 }));
    if (erros) {
      const texto = `${ROTULO_TIPO[e.tipo]}: ${erros} de ${total} grupo(s) com erro (campanha ${e.campanhas?.nome ?? "?"})`;
      await alertar({ tipo: "tarefa_erro", texto, campanhaId: e.campanha_id }, db);
      emissor.adicionar(eventoFalhaDisparo({ ...concluida, motivo: "erros", texto }));
    }
  }
  if (falhas.length) throw new Error(`Falha ao concluir execuções: ${falhas.join("; ")}`);
}
