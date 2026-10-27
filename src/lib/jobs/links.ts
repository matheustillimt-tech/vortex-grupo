import "server-only";
import { paraZapbot, type ConexaoLinha } from "../conexoes";
import { dbAdmin } from "../supabase/admin";
import { variantesTelefone } from "../telefone";
import { zapbot } from "../zapbot/client";
import { alertar } from "./alertas";
import { restante, type Prazo } from "./tipos";

/* Seções de links da campanha (Etapa 3J, Tarefa 3). Todas criam execuções comuns (`origem 'campanha'`), que passam
   pela fila de tarefas de sempre: 3–8 s entre tarefas do mesmo número (limite do Zapbot) e o link novo gravado em
   `grupos.link_convite` só quando o Zapbot devolve. Até lá o link público continua levando ao convite antigo. */

type DB = ReturnType<typeof dbAdmin>;

/** A conta tem que estar caída há pelo menos isto (e continuar caída na conferência do monitor) antes de os grupos
 *  dela mudarem de dono. Uma queda rápida (o WhatsApp reconecta sozinho, o monitor confere de 2 em 2 min) nunca
 *  mexe em grupo. */
export const MINIMO_CAIDA_MS = 10 * 60_000;
/** Orçamento próprio da troca de dono dentro do tick (o monitor passa um prazo de no máximo isto). */
export const ORCAMENTO_TROCA_MS = 15_000;
/** Tempo mínimo que sobra do orçamento para começar mais um grupo/campanha. */
const FOLGA_PRAZO_MS = 3_000;

const minutoIso = (d: Date) => new Date(Math.floor(d.getTime() / 60_000) * 60_000).toISOString();
const horaIso = (d: Date) => new Date(Math.floor(d.getTime() / 3_600_000) * 3_600_000).toISOString();

/** Enquanto a conta continua caída, a troca é tentada de novo a cada isto: um chip reserva conectado (ou feito admin)
 *  depois da primeira tentativa assume os grupos que ficaram sem reserva (queda de 19/10/2026: o Chip 2 entrou 4 min
 *  depois da única tentativa e os grupos ficaram parados). */
export const RETENTAR_TROCA_MS = 10 * 60_000;

/** Monitor: está na hora de trocar o dono dos grupos desta conta? Só com a conta caída há `MINIMO_CAIDA_MS`; depois da
 *  primeira tentativa desta queda (`grupos_trocados_em` depois de `caiu_em`), de novo a cada `RETENTAR_TROCA_MS`
 *  enquanto ela não volta. Os grupos já trocados não são mais da conta caída, então nada repete. */
export function trocaDeDonoVencida(c: { caiu_em?: string | null; grupos_trocados_em?: string | null }, agora: Date): boolean {
  if (!c.caiu_em) return false;
  const caiu = Date.parse(c.caiu_em);
  if (!Number.isFinite(caiu) || agora.getTime() - caiu < MINIMO_CAIDA_MS) return false;
  const trocou = c.grupos_trocados_em ? Date.parse(c.grupos_trocados_em) : NaN;
  if (!Number.isFinite(trocou) || trocou < caiu) return true;
  return agora.getTime() - trocou >= RETENTAR_TROCA_MS;
}

type GrupoDaCaida = { id: string; nome: string; group_id: string; campanha_id: string; campanhas: { nome: string; conexao_criadora_id: string | null } };

/** "Atualização de links": a conta `conexaoId` caiu (há `MINIMO_CAIDA_MS`, conferido pelo monitor). Em cada campanha
 *  com `atualizar_links_banimento` ligado (e não arquivada), cada grupo ativo da conta passa para outra conta da
 *  campanha (associada ou a criadora) que:
 *    * está `conectado` no banco E respondeu conectada ao Zapbot agora;
 *    * é admin do grupo no banco (`participantes`) E o Zapbot confirma agora (GET do grupo pela conta nova).
 *  Os trocados ganham UMA execução `atualizar_links` (a conta nova lê o link) e um alerta dizendo o que mudou; os
 *  sem reserva, um alerta. `completo: false` = o tempo do tick acabou ou algo falhou no banco: o monitor tenta de
 *  novo na próxima volta (os já trocados não são mais da conta caída, então nada repete). */
export async function trocarDonoECorrigirLinks(conexaoId: string, prazo: Prazo, db: DB = dbAdmin(), agora: Date = new Date()): Promise<{ completo: boolean; movidos: number }> {
  const { data: caida, error: erroCaida } = await db.from("conexoes").select("id, nome, status, caiu_em").eq("id", conexaoId).maybeSingle();
  if (erroCaida) throw new Error(`Não foi possível ler a conexão caída: ${erroCaida.message}`);
  const conta = caida as { id: string; nome: string; status: string; caiu_em: string | null } | null;
  // Voltou (ou sumiu) no meio do caminho: nada a fazer.
  if (!conta || conta.status !== "desconectado") return { completo: true, movidos: 0 };

  const { data, error } = await db
    .from("grupos")
    .select("id, nome, group_id, campanha_id, campanhas!inner(nome, conexao_criadora_id)")
    .eq("conexao_id", conexaoId)
    .eq("ativo", true)
    .eq("campanhas.atualizar_links_banimento", true)
    .eq("campanhas.arquivada", false)
    .order("numero");
  if (error) throw new Error(`Não foi possível ler os grupos da conexão caída: ${error.message}`);
  const porCampanha = new Map<string, GrupoDaCaida[]>();
  for (const g of (data ?? []) as unknown as GrupoDaCaida[]) porCampanha.set(g.campanha_id, [...(porCampanha.get(g.campanha_id) ?? []), g]);

  const conectada = new Map<string, boolean>(); // status ao vivo de cada conta reserva, uma vez por chamada
  let completo = true;
  let movidos = 0;
  for (const [campanhaId, grupos] of porCampanha) {
    if (restante(prazo) < FOLGA_PRAZO_MS) {
      completo = false;
      break;
    }
    try {
      const r = await trocarNaCampanha(db, conta, campanhaId, grupos, conectada, prazo, agora);
      movidos += r.movidos;
      if (!r.completo) {
        completo = false;
        break;
      }
    } catch (e) {
      // Uma campanha que falha não para as outras; a próxima volta do monitor tenta de novo.
      console.error(`[links] troca de dono da conexão ${conexaoId} na campanha ${campanhaId}:`, e instanceof Error ? e.message : e);
      completo = false;
    }
  }
  return { completo, movidos };
}

async function trocarNaCampanha(
  db: DB,
  caida: { id: string; nome: string; caiu_em: string | null },
  campanhaId: string,
  grupos: GrupoDaCaida[],
  conectada: Map<string, boolean>,
  prazo: Prazo,
  agora: Date,
): Promise<{ completo: boolean; movidos: number }> {
  const nomeCampanha = grupos[0].campanhas.nome;
  const { data: assoc, error: erroAssoc } = await db.from("campanha_conexoes").select("conexao_id").eq("campanha_id", campanhaId);
  if (erroAssoc) throw new Error(`conexões da campanha: ${erroAssoc.message}`);
  const ids = new Set(((assoc ?? []) as { conexao_id: string }[]).map((a) => a.conexao_id));
  if (grupos[0].campanhas.conexao_criadora_id) ids.add(grupos[0].campanhas.conexao_criadora_id);
  ids.delete(caida.id);

  let reservas: (ConexaoLinha & { telefone: string })[] = [];
  if (ids.size) {
    const { data: contas, error: erroContas } = await db.from("conexoes").select("*").in("id", [...ids]).eq("status", "conectado");
    if (erroContas) throw new Error(`conexões reserva: ${erroContas.message}`);
    reservas = ((contas ?? []) as ConexaoLinha[]).filter((c): c is ConexaoLinha & { telefone: string } => !!c.telefone && c.id !== caida.id);
  }
  // Conectada de verdade agora (o `status` do banco pode ter até 2 min).
  const vivas: (ConexaoLinha & { telefone: string })[] = [];
  for (const c of reservas) {
    if (!conectada.has(c.id)) conectada.set(c.id, await zapbot().status(paraZapbot(c)).then((s) => s.connected, () => false));
    if (conectada.get(c.id)) vivas.push(c);
  }

  // Quem é admin de cada grupo segundo o banco (só pra escolher quem conferir no Zapbot).
  const adminNoBanco = new Set<string>();
  if (vivas.length) {
    const telefones = [...new Set(vivas.flatMap((c) => variantesTelefone(c.telefone)))];
    for (let i = 0; i < grupos.length; i += 200) {
      const { data: adms, error: erroAdms } = await db
        .from("participantes")
        .select("grupo_id, telefone")
        .in("grupo_id", grupos.slice(i, i + 200).map((g) => g.id))
        .eq("admin", true)
        .is("saiu_em", null)
        .in("telefone", telefones)
        .limit(1000);
      if (erroAdms) throw new Error(`admins dos grupos: ${erroAdms.message}`);
      for (const a of (adms ?? []) as { grupo_id: string; telefone: string }[]) adminNoBanco.add(`${a.grupo_id}:${a.telefone}`);
    }
  }
  const ehAdminNoBanco = (grupoId: string, c: { telefone: string }) => variantesTelefone(c.telefone).some((t) => adminNoBanco.has(`${grupoId}:${t}`));

  const trocados: { grupo: GrupoDaCaida; para: ConexaoLinha & { telefone: string } }[] = [];
  const semReserva: GrupoDaCaida[] = [];
  let filaPresa = 0;
  let completo = true;
  for (const g of grupos) {
    if (restante(prazo) < FOLGA_PRAZO_MS) {
      completo = false;
      break;
    }
    let escolhida: (ConexaoLinha & { telefone: string }) | null = null;
    for (const c of vivas.filter((x) => ehAdminNoBanco(g.id, x))) {
      try {
        const z = paraZapbot(c);
        // Leitura leve primeiro (sem lista nem link): `amAdmin: true` já confirma a conta. Qualquer outra coisa (false,
        // grupo não encontrado, erro) cai na leitura completa de sempre — nunca escolhe conta sem confirmação.
        const leve = await zapbot().obterGrupo(z, g.group_id, { participantes: false, link: false }).catch((e: unknown) => {
          console.error(`[links] leitura leve do grupo ${g.id} pela conexão ${c.id}:`, e instanceof Error ? e.message : e);
          return null;
        });
        if (leve?.amAdmin === true) {
          escolhida = c;
          break;
        }
        const atual = await zapbot().obterGrupo(z, g.group_id);
        const tels = new Set(variantesTelefone(c.telefone));
        if (atual && (atual.amAdmin || atual.participants.some((p) => p.isAdmin && tels.has(p.phone.split("@")[0])))) {
          escolhida = c;
          break;
        }
      } catch (e) {
        // Sem resposta confiável: essa conta não é confirmada para este grupo.
        console.error(`[links] conferência do grupo ${g.id} pela conexão ${c.id}:`, e instanceof Error ? e.message : e);
      }
    }
    if (!escolhida) {
      semReserva.push(g);
      continue;
    }
    // Só troca se o grupo ainda é da conta caída (outra troca ou o usuário pode ter mexido nesse meio tempo).
    const { data: feito, error: erroTroca } = await db.from("grupos").update({ conexao_id: escolhida.id }).eq("id", g.id).eq("conexao_id", caida.id).eq("ativo", true).select("id");
    if (erroTroca) {
      console.error(`[links] não foi possível trocar o dono do grupo ${g.id}: ${erroTroca.message}`);
      completo = false;
      continue;
    }
    if (!feito?.length) continue;
    trocados.push({ grupo: g, para: escolhida });
    // O que estava na fila da conta caída para este grupo (mensagens agendadas etc.) sai pela conta nova. Só `fila`:
    // `processando` pode já ter ido e `erro` fica como está (reenviar falhas é decisão de quem olha).
    const { error: erroFila } = await db.from("tarefas").update({ conexao_id: escolhida.id }).eq("grupo_id", g.id).eq("conexao_id", caida.id).eq("status", "fila");
    if (erroFila) {
      console.error(`[links] grupo ${g.id} trocou de conexão, mas a fila dele não foi passada pra conexão nova: ${erroFila.message}`);
      filaPresa++;
    }
  }

  if (trocados.length) {
    const { error: erroExec } = await db.from("execucoes").insert({
      campanha_id: campanhaId,
      origem: "campanha",
      tipo: "atualizar_links",
      conteudo: {},
      agendada_para: agora.toISOString(),
      alvo_grupos: trocados.map((t) => t.grupo.id),
      gatilho_chave: `banimento:${caida.id}:${minutoIso(agora)}`,
    });
    if (erroExec && erroExec.code !== "23505") {
      // `numero_caiu` (não `criacao_erro`): o aviso de "sem reserva" é deduplicado por tipo + conta desde a queda.
      await alertar({ tipo: "numero_caiu", campanhaId, conexaoId: caida.id, texto: `${trocados.length} grupo(s) da campanha ${nomeCampanha} mudaram de conexão, mas a atualização dos links não foi agendada: ${erroExec.message}` }, db);
    }
    const porConta = new Map<string, number>();
    for (const t of trocados) porConta.set(t.para.nome, (porConta.get(t.para.nome) ?? 0) + 1);
    const destino = [...porConta].map(([nome, n]) => `${nome}: ${n}`).join(", ");
    await alertar({
      tipo: "numero_caiu",
      campanhaId,
      conexaoId: caida.id,
      texto: `${trocados.length} grupo(s) da campanha ${nomeCampanha} passaram da conexão ${caida.nome}, que caiu, para outra conexão admin (${destino}); o link de cada um é atualizado pela conexão nova${filaPresa ? ` (${filaPresa} grupo(s) ficaram com envios na fila da conexão caída)` : ""}`,
    }, db);
  }
  if (semReserva.length) {
    const texto = `${semReserva.length} grupos da campanha ${nomeCampanha} ficaram sem conexão reserva para atualizar o link`;
    // Uma vez por queda e campanha (tipo + conta + campanha desde `caiu_em`): a próxima volta (tick que acabou no
    // meio) não repete, mesmo que o número de grupos sem reserva mude.
    const { data: ja } = await db
      .from("alertas")
      .select("id")
      .eq("tipo", "criacao_erro")
      .eq("conexao_id", caida.id)
      .eq("campanha_id", campanhaId)
      .gte("created_at", caida.caiu_em ?? agora.toISOString())
      .limit(1);
    if (!(ja ?? []).length) await alertar({ tipo: "criacao_erro", campanhaId, conexaoId: caida.id, texto }, db);
  }
  return { completo, movidos: trocados.length };
}

/** Campanhas pedidas ao banco por tick no passo `links`. */
export const LIMITE_PERIODICOS = 20;

/** Passo `links` do tick ("Atualização periódica de links"). O banco (`campanhas_links_vencidas`) devolve só as
 *  campanhas que precisam mesmo: ligadas, não arquivadas, não terminadas, com grupo ativo, vencidas
 *  (`24 h / links_por_dia` desde a última) e sem mensagem marcada pros próximos 30 min. Assim uma campanha que não
 *  precisa nunca ocupa a vez das outras. Cada uma é reivindicada (update condicional em `links_atualizados_em`):
 *  dois ticks ao mesmo tempo não criam duas; o índice único (`periodico:{hora}`) segura o resto. A execução sai
 *  com prioridade de ação (`prioridadeDaExecucao`), sem passar na frente dos disparos. */
export async function atualizarLinksPeriodicos(prazo: Prazo, db: DB = dbAdmin(), agora: Date = new Date()): Promise<number> {
  if (restante(prazo) < 5_000) return 0;
  const { data, error } = await db.rpc("campanhas_links_vencidas", { p_limite: LIMITE_PERIODICOS });
  if (error) throw new Error(`Não foi possível ler as campanhas com links periódicos: ${error.message}`);
  let criadas = 0;
  const erros: string[] = [];
  for (const c of (data ?? []) as { id: string; links_por_dia: number; links_atualizados_em: string | null }[]) {
    if (restante(prazo) < 5_000) break;
    const porDia = Math.min(24, Math.max(1, Math.floor(Number(c.links_por_dia) || 1)));
    const intervaloMs = (24 * 3_600_000) / porDia;
    try {
      const limite = new Date(agora.getTime() - intervaloMs).toISOString();
      const marca = agora.toISOString();
      const { data: tomada, error: erroTomar } = await db
        .from("campanhas")
        .update({ links_atualizados_em: marca })
        .eq("id", c.id)
        .eq("links_periodicos", true)
        .eq("links_por_dia", c.links_por_dia)
        .or(`links_atualizados_em.is.null,links_atualizados_em.lte.${limite}`)
        .select("id");
      if (erroTomar) throw new Error(`reivindicar: ${erroTomar.message}`);
      if (!tomada?.length) continue; // outro tick pegou (ou a configuração mudou)
      const { error: erroExec } = await db.from("execucoes").insert({
        campanha_id: c.id,
        origem: "campanha",
        tipo: "atualizar_links",
        conteudo: {},
        agendada_para: marca,
        alvo_grupos: null,
        gatilho_chave: `periodico:${horaIso(agora)}`,
      });
      if (erroExec && erroExec.code !== "23505") {
        // Devolve a vez (só se ninguém mexeu de novo): o próximo tick tenta outra vez.
        await db.from("campanhas").update({ links_atualizados_em: c.links_atualizados_em }).eq("id", c.id).eq("links_atualizados_em", marca);
        throw new Error(`execução: ${erroExec.message}`);
      }
      if (!erroExec) criadas++;
    } catch (e) {
      erros.push(`campanha ${c.id}: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (erros.length) throw new Error(`Links periódicos: ${erros.join("; ")} (${criadas} criada(s))`);
  return criadas;
}

/** "Redefinir link de convite": o grupo acabou de virar cheio (link ou conferência; nunca marcação manual). Uma
 *  execução `redefinir_link` só dele. Chave = grupo + `conferido_em` que quem marcou leu: o link e a conferência
 *  que enxergam o mesmo enchimento leem o mesmo `conferido_em` (a conferência só grava o novo junto com o `cheio`),
 *  então o segundo dá 23505 e nada repete; um enchimento novo só acontece depois de uma conferência que esvaziou,
 *  com outro `conferido_em`. Nunca lança: falha vira log + alerta e o fluxo (redirecionamento, conferência) segue. */
export async function pedirRedefinicaoAoEncher(
  db: Pick<DB, "from">,
  g: { campanhaId: string; grupoId: string; grupoNome: string; conferidoEm: string | null | undefined; conexaoId?: string },
): Promise<void> {
  const marca = g.conferidoEm && Number.isFinite(Date.parse(g.conferidoEm)) ? new Date(g.conferidoEm).toISOString() : "nunca";
  try {
    const { error } = await db.from("execucoes").insert({
      campanha_id: g.campanhaId,
      origem: "campanha",
      tipo: "redefinir_link",
      conteudo: {},
      agendada_para: new Date().toISOString(),
      alvo_grupos: [g.grupoId],
      gatilho_chave: `cheio:${g.grupoId}:${marca}`,
    });
    if (!error || error.code === "23505") return;
    throw new Error(error.message);
  } catch (e) {
    console.error(`[links] redefinir link do grupo cheio ${g.grupoId} não foi agendado`, e);
    await alertar({
      tipo: "criacao_erro",
      campanhaId: g.campanhaId,
      texto: `Grupo ${g.grupoNome} encheu, mas a redefinição do link de convite não foi agendada: ${e instanceof Error ? e.message : e}`,
      ...(g.conexaoId ? { conexaoId: g.conexaoId } : {}),
    }, db);
  }
}

/** Conferência: a conexão dona não está mais no grupo (saiu, foi removida, ou o grupo foi passado pra ela sem ela ser
 *  admin — queda de 19/10/2026, #01 a #03 com o Chip 2). Outra conexão da campanha (criadora ou associada),
 *  conectada agora e admin do grupo confirmada no Zapbot, vira a dona; a fila do grupo vai junto. Sem nenhuma, o
 *  grupo fica como está e quem chama avisa. Nunca lança. Devolve o nome da conexão que assumiu, ou null. */
export async function passarGrupoParaOutraConexao(
  db: DB,
  g: { id: string; nome: string; group_id: string; campanha_id: string },
  donaAtual: { id: string; nome: string },
): Promise<string | null> {
  try {
    const { data: camp } = await db.from("campanhas").select("nome, conexao_criadora_id").eq("id", g.campanha_id).maybeSingle();
    const { data: assoc } = await db.from("campanha_conexoes").select("conexao_id").eq("campanha_id", g.campanha_id);
    const ids = new Set(((assoc ?? []) as { conexao_id: string }[]).map((a) => a.conexao_id));
    const criadora = (camp as { conexao_criadora_id: string | null } | null)?.conexao_criadora_id;
    if (criadora) ids.add(criadora);
    ids.delete(donaAtual.id);
    if (!ids.size) return null;
    const { data: contas } = await db.from("conexoes").select("*").in("id", [...ids]).eq("status", "conectado");
    for (const c of ((contas ?? []) as ConexaoLinha[]).filter((x) => !!x.telefone)) {
      const z = paraZapbot(c);
      const atual = await zapbot().obterGrupo(z, g.group_id, { link: false }).catch(() => null);
      const tels = new Set(variantesTelefone(c.telefone!));
      if (!atual || !(atual.amAdmin || atual.participants.some((p) => p.isAdmin && tels.has(p.phone.split("@")[0])))) continue;
      const { data: feito, error } = await db.from("grupos").update({ conexao_id: c.id }).eq("id", g.id).eq("conexao_id", donaAtual.id).select("id");
      if (error || !feito?.length) return null;
      await db.from("tarefas").update({ conexao_id: c.id }).eq("grupo_id", g.id).eq("conexao_id", donaAtual.id).eq("status", "fila");
      await alertar({
        tipo: "numero_caiu",
        campanhaId: g.campanha_id,
        conexaoId: c.id,
        texto: `A conexão ${donaAtual.nome} não está no grupo ${g.nome}: a conexão ${c.nome}, que é admin dele, assumiu o grupo`,
      }, db);
      return c.nome;
    }
  } catch (e) {
    console.error(`[links] não foi possível passar o grupo ${g.id} pra outra conexão:`, e instanceof Error ? e.message : e);
  }
  return null;
}
