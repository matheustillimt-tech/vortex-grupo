import "server-only";
import { FONTE_BLOQUEADOS } from "../regras/antispam";
import {
  ERRO_BLOQUEADO,
  ERRO_CHEIO,
  ERRO_LID,
  MAX_AUTOMATICO_POR_GRUPO,
  MAX_GRUPOS_PENDENTES,
  MOTIVO_APROVADA_CELULAR,
  MOTIVO_EXPIRADA_NAO_EXISTE,
  MOTIVO_EXPIRADA_SEM_LEITURA,
  AJUDA_CANCELADA,
  RESERVA_MS,
  planoAutomatico,
  ehPedidoLid,
  ehTelefoneBR,
  reconciliarLeitura,
  reservadosDoGrupo,
  separarPedidos,
  type Classificacao,
  type Visto,
} from "../regras/solicitacoes";
import { eventosSolicitacoes, webhooksQueCasam, type EventoHook, type ItemSolicitacaoHook } from "../regras/webhooks";
import { variantesTelefone } from "../telefone";
import { carregarWebhooks, enfileirarEventos, type WebhookComUrl } from "../webhooks";
// Só tipos do cliente do Zapbot: quem chama passa o cliente (a conferência e as ações usam `zapbot()`).
import type { ZapbotClient, ZapbotConexao, ZapbotPedido } from "../zapbot/client";
import { bloqueadosPorLid, type Db } from "./pessoas";
import { restante, type Prazo } from "./tipos";

/** Pedidos de entrada (Etapa 3M, Tarefa 4): leitura ao vivo da aba Pendentes, decisão (manual ou automática) e o log
 *  em `solicitacoes_entrada`. **Nunca aprova número bloqueado**: `decidirPedidos` reclassifica na hora, no servidor,
 *  contra `bloqueados_efetivos` (as duas formas do nono dígito) e `bloqueados.lid`, mesmo que a tela tenha mandado. */

/** Lotes para `.in()` não estourar o tamanho da URL do PostgREST (mesmo tamanho de `jobs/pessoas.ts`). */
const LOTE = 200;
/** Máximo de números por chamada de `group-review` (= `MAX_REVISAO` do cliente; não importado pra não depender do
 *  valor do módulo do cliente, que os testes da conferência trocam). */
const FATIA_REVISAO = 50;
/** Leitura dos pendentes dentro da conferência: menor que o timeout padrão do cliente (30 s). */
const TIMEOUT_PENDENTES_RODADA_MS = 15_000;
/** Margem deixada no prazo do tick em cada chamada ao Zapbot das regras automáticas (o resto da conferência e a
 *  gravação do log ainda precisam caber). */
export const MARGEM_PRAZO_REGRA_MS = 5_000;
/** Abaixo disto de prazo útil, a regra automática não faz a próxima chamada ao Zapbot. */
const MINIMO_CHAMADA_MS = 2_000;

function lotes<T>(lista: T[], n = LOTE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < lista.length; i += n) out.push(lista.slice(i, i + n));
  return out;
}

/** Quem, entre os telefones (ou ids LID) que pediram pra entrar, está bloqueado: `bloqueados_efetivos` nas variantes
 *  do nono dígito, mais a forma LID (`bloqueadosPorLid`, a mesma da conferência). Erro de leitura lança: na dúvida,
 *  ninguém é aprovado. */
export async function classificarPedidos(db: Db, telefones: readonly string[]): Promise<Classificacao> {
  const unicos = [...new Set(telefones.map((t) => t.trim()).filter(Boolean))];
  const bloqueados: string[] = [];
  for (const lote of lotes(unicos)) {
    const variantes = [...new Set(lote.flatMap(variantesTelefone))];
    const { data, error } = await db.from(FONTE_BLOQUEADOS).select("telefone").in("telefone", variantes);
    if (error) throw new Error(`Não foi possível ler os bloqueados: ${error.message}`);
    bloqueados.push(...((data ?? []) as { telefone: string }[]).map((b) => b.telefone));
  }
  const lidsBloqueados = unicos.length ? await bloqueadosPorLid(db, unicos, bloqueados) : [];
  return { bloqueados, lidsBloqueados };
}

export type GrupoDecisao = { id: string; groupId: string; nome: string | null };

export type DecisaoEntrada = {
  campanhaId: string;
  grupo: GrupoDecisao;
  telefones: readonly string[];
  decisao: "aprovada" | "recusada";
  origem: "manual" | "automatica";
  /** Quem decidiu (manual); `null` na regra automática. */
  usuario: string | null;
  motivo?: string | null;
  /** Quando cada telefone pediu (vai pra coluna `pedido_em`). */
  pedidoEm?: Readonly<Record<string, string | null>>;
  /** Motivo por telefone (aprovação automática × por tag); o que não estiver aqui leva `motivo`. */
  motivoPorTelefone?: Readonly<Record<string, string>>;
  /** Só pra `aprovada`: quantas vagas o grupo tem. O que passar disso não é aprovado (grupo cheio). Ausente = sem teto. */
  vagas?: number;
  /** Prazo de cada chamada ao Zapbot (tela: `PRAZO_TELA_MS`). */
  prazoTotalMs?: number;
};

export type ResultadoDecisao = {
  ok: number;
  falhas: number;
  bloqueados: number;
  /** Telefones que deram certo ou cujo pedido já não existia (saem de `solicitacoes_vistas`). */
  decididos?: string[];
  /** As mesmas linhas de `decididos`, com a decisão gravada (Hook `decisao`). */
  decisoes?: ItemSolicitacaoHook[];
};

type Linha = { telefone: string; resultado: "ok" | "erro"; erro: string | null; expirada?: boolean };

/** "Não encontrado" que é da chamada inteira, não do pedido: a conta (instância/sessão/token) ou o grupo. Nunca vira
 *  `expirada` (revisão final A, m1): o pedido pode continuar lá. */
const NAO_ENCONTRADO_NAO_E_PEDIDO = /\b(instance|inst[aâ]ncia|session|sess[aã]o|token|client|connection|conex[aã]o|group|grupo)[\s_-]*(id[\s_-]*)?(not.?found|n[aã]o.?(encontrad[oa]|existe))/i;

/** O Zapbot respondeu que o PEDIDO não existe (só no nível do item): 404 ou "not found" no texto, menos quando o que
 *  não existe é a conta ou o grupo (`NAO_ENCONTRADO_NAO_E_PEDIDO`). A decisão vira `expirada`. */
export function pedidoNaoExiste(e: unknown): boolean {
  const texto = `${e instanceof Error ? e.message : String(e)} ${JSON.stringify((e as { body?: unknown } | null)?.body ?? "")}`;
  if (NAO_ENCONTRADO_NAO_E_PEDIDO.test(texto)) return false;
  const status = (e as { status?: unknown } | null)?.status;
  if (status === 404) return true;
  return /not.?found/i.test(texto);
}

/** Aprova ou recusa os pedidos de um grupo. Para `aprovada`, reclassifica **na hora**: bloqueado e LID nunca chegam ao
 *  Zapbot (viram linha `erro`), nem o que passar das vagas. Fatia em 50 e chama `group-review`; grava uma linha por
 *  telefone em `solicitacoes_entrada` com o resultado (`null` na resposta = todos ok). Falha do Zapbot numa fatia
 *  vira `erro` nessas linhas e segue pra próxima. Erro ao ler os bloqueados lança antes de chamar o Zapbot. */
export async function decidirPedidos(db: Db, z: Pick<ZapbotClient, "revisarPedidos">, c: ZapbotConexao, d: DecisaoEntrada): Promise<ResultadoDecisao> {
  const unicos = [...new Set(d.telefones.map((t) => t.trim()).filter(Boolean))];
  const linhas: Linha[] = [];
  let enviar = unicos;
  if (d.decisao === "aprovada") {
    const sep = separarPedidos(unicos.map((telefone) => ({ telefone })), await classificarPedidos(db, unicos));
    for (const p of sep.bloqueados) linhas.push({ telefone: p.telefone, resultado: "erro", erro: ERRO_BLOQUEADO });
    for (const p of sep.soLid) linhas.push({ telefone: p.telefone, resultado: "erro", erro: ERRO_LID });
    enviar = sep.livres.map((p) => p.telefone);
    if (d.vagas !== undefined) {
      const teto = Math.max(0, Math.floor(Number.isFinite(d.vagas) ? d.vagas : 0));
      for (const t of enviar.slice(teto)) linhas.push({ telefone: t, resultado: "erro", erro: ERRO_CHEIO });
      enviar = enviar.slice(0, teto);
    }
  }
  const acao = d.decisao === "aprovada" ? "approve" : "reject";
  for (const fatia of lotes(enviar, FATIA_REVISAO)) {
    try {
      const deram = await z.revisarPedidos(c, d.grupo.groupId, fatia, acao, d.prazoTotalMs ? { prazoTotalMs: d.prazoTotalMs } : {});
      const certos = deram === null ? null : new Set(deram.flatMap(variantesTelefone));
      for (const t of fatia) {
        const ok = certos === null || variantesTelefone(t.split("@")[0]).some((v) => certos.has(v));
        linhas.push({ telefone: t, resultado: ok ? "ok" : "erro", erro: ok ? null : "O WhatsApp não aceitou o pedido." });
      }
    } catch (e) {
      // Pedido que já não existia (404/"not found"): vira `expirada` (Histórico › EXPIRADAS), não erro.
      if (pedidoNaoExiste(e)) {
        for (const t of fatia) linhas.push({ telefone: t, resultado: "ok", erro: null, expirada: true });
        continue;
      }
      const erro = (e instanceof Error ? e.message : String(e)).slice(0, 300) || "Falha no Zapbot.";
      for (const t of fatia) linhas.push({ telefone: t, resultado: "erro", erro });
    }
  }
  if (linhas.length) {
    const { error } = await db.from("solicitacoes_entrada").insert(
      linhas.map((l) => ({
        campanha_id: d.campanhaId,
        grupo_id: d.grupo.id,
        grupo_nome: d.grupo.nome,
        telefone: l.telefone,
        pedido_em: d.pedidoEm?.[l.telefone] ?? null,
        decisao: l.expirada ? "expirada" : d.decisao,
        origem: d.origem,
        motivo: l.expirada ? MOTIVO_EXPIRADA_NAO_EXISTE : (d.motivoPorTelefone?.[l.telefone] ?? d.motivo ?? null),
        decidida_por: d.usuario,
        resultado: l.resultado,
        erro: l.erro,
      })),
    );
    // A decisão já foi pro WhatsApp: falha no log não desfaz nem esconde o resultado (fica no log do servidor).
    if (error) console.error(`[solicitacoes] não foi possível gravar ${linhas.length} decisão(ões) do grupo ${d.grupo.id}: ${error.message}`);
  }
  // O que foi decidido (ou já não existia) sai dos pedidos vistos: não vira "cancelada" nem "expirada" depois.
  const decididos = linhas.filter((l) => l.resultado === "ok").map((l) => l.telefone);
  for (const lote of lotes(decididos)) {
    const { error } = await db.from("solicitacoes_vistas").delete().eq("grupo_id", d.grupo.id).in("telefone", lote);
    if (error) console.error(`[solicitacoes] não foi possível tirar ${lote.length} pedido(s) decidido(s) dos vistos do grupo ${d.grupo.id}: ${error.message}`);
  }
  const decisoes: ItemSolicitacaoHook[] = linhas
    .filter((l) => l.resultado === "ok")
    .map((l) => ({
      telefone: l.telefone,
      pedidoEm: d.pedidoEm?.[l.telefone] ?? null,
      decisao: l.expirada ? "expirada" : d.decisao,
      origem: d.origem,
      motivo: l.expirada ? MOTIVO_EXPIRADA_NAO_EXISTE : (d.motivoPorTelefone?.[l.telefone] ?? d.motivo ?? null),
    }));
  return {
    ok: linhas.filter((l) => l.resultado === "ok" && !l.expirada).length,
    bloqueados: linhas.filter((l) => l.erro === ERRO_BLOQUEADO).length,
    falhas: linhas.filter((l) => (l.resultado === "erro" && l.erro !== ERRO_BLOQUEADO) || l.expirada).length,
    decididos,
    decisoes,
  };
}

/** Teto de pedidos vistos lidos/gravados por grupo numa leitura. */
export const MAX_VISTOS_POR_GRUPO = 1_000;
/** `ultimo_visto_em` só é regravado quando tem mais que isto (a expiração é em 48 h): leitura igual não escreve nada. */
export const REFRESCAR_VISTO_MS = 60 * 60_000;
/** Teto de pedidos vistos expirados por tick. */
export const MAX_EXPIRAR_POR_TICK = 500;

export type PedidoVisto = { telefone: string; pedidoEm: string | null };
export type ResultadoLeitura = {
  /** Pedidos vistos pela primeira vez (Task 3: Hook `pendentes`). */
  novos: PedidoVisto[];
  /** Pedidos que sumiram e foram fechados pelo WhatsApp (Task 3: Hook `decisao`). */
  fechados: { telefone: string; decisao: "aprovada" | "cancelada"; pedidoEm: string | null }[];
  /** Pedidos vistos que continuam pendentes depois desta leitura (base da reserva de vaga). */
  vistos: Visto[];
};

type VistoLinha = { telefone: string; pedido_em: string | null; visto_em: string; ultimo_visto_em: string };

/** Decisões já gravadas (`resultado 'ok'`, qualquer origem) de um grupo pra esses telefones (nas variantes) desde
 *  `desde`. Erro lança. */
async function decisoesDepois(db: Db, grupoId: string, telefones: readonly string[], desde: string): Promise<{ telefone: string; created_at: string }[]> {
  const out: { telefone: string; created_at: string }[] = [];
  for (const lote of lotes([...telefones])) {
    const variantes = [...new Set(lote.flatMap((t) => [t, ...variantesTelefone(t.split("@")[0])]))];
    const { data, error } = await db.from("solicitacoes_entrada").select("telefone, created_at").eq("grupo_id", grupoId).in("telefone", variantes).eq("resultado", "ok").gte("created_at", desde);
    if (error) throw new Error(`Não foi possível ler as decisões já gravadas: ${error.message}`);
    out.push(...((data ?? []) as { telefone: string; created_at: string }[]));
  }
  return out;
}

/** Registra uma leitura de pendentes de um grupo em `solicitacoes_vistas`. Pedido novo é inserido (`visto_em` só no
 *  insert); pedido que continua só regrava `ultimo_visto_em` depois de `REFRESCAR_VISTO_MS` (leitura igual = nenhuma
 *  escrita). Com `completa` (o grupo respondeu), o que sumiu é reconciliado (`reconciliarLeitura`) contra os
 *  participantes abertos do grupo que entraram depois de `visto_em` e as decisões já gravadas depois de `visto_em`:
 *  grava as linhas `whatsapp` (aprovada pelo celular / cancelada, `resultado 'ok'`) e tira os fechados dos vistos.
 *  `participantesFrescos: false` (aba Pendentes, sem a lista de participantes recém-lida) não cancela ninguém: só a
 *  conferência, que acabou de ler os participantes, cancela. Erro de leitura lança antes de escrever. */
export async function registrarLeitura(
  db: Db,
  p: { campanhaId: string; grupo: GrupoDecisao; pedidos: readonly PedidoVisto[]; completa: boolean; agora: string; participantesFrescos?: boolean },
): Promise<ResultadoLeitura> {
  const porTel = new Map<string, PedidoVisto>();
  for (const x of p.pedidos) if (x.telefone?.trim() && !porTel.has(x.telefone.trim())) porTel.set(x.telefone.trim(), { telefone: x.telefone.trim(), pedidoEm: x.pedidoEm ?? null });
  const lidos = [...porTel.values()].slice(0, MAX_VISTOS_POR_GRUPO);

  const { data, error } = await db
    .from("solicitacoes_vistas")
    .select("telefone, pedido_em, visto_em, ultimo_visto_em")
    .eq("grupo_id", p.grupo.id)
    .limit(MAX_VISTOS_POR_GRUPO);
  if (error) throw new Error(`Não foi possível ler os pedidos já vistos: ${error.message}`);
  const vistos = (data ?? []) as VistoLinha[];
  // Leitura vazia com pedidos já vistos (revisão final A): não dá pra distinguir "todos foram decididos" de uma
  // resposta vazia por engano, então vale como incompleta (nada é fechado). Se foram mesmo decididos, a próxima
  // leitura com algum pedido fecha, ou expiram em 48 h (`expirarVistos`).
  const completa = p.completa && !(lidos.length === 0 && vistos.length > 0);

  // Só com leitura completa: quem sumiu precisa de participantes e decisões pra ser fechado.
  const lidosSet = new Set(lidos.map((l) => l.telefone));
  const sumidos = completa ? vistos.filter((v) => !lidosSet.has(v.telefone)) : [];
  const participantesNovos: { telefone: string; entrou_em: string }[] = [];
  const decididos: { telefone: string; created_at: string }[] = [];
  if (sumidos.length) {
    const desde = sumidos.map((v) => v.visto_em).sort()[0];
    for (const lote of lotes(sumidos.map((v) => v.telefone))) {
      const variantes = [...new Set(lote.flatMap((t) => [t, ...variantesTelefone(t.split("@")[0])]))];
      const part = await db.from("participantes").select("telefone, entrou_em").eq("grupo_id", p.grupo.id).in("telefone", variantes).is("saiu_em", null).gte("entrou_em", desde);
      if (part.error) throw new Error(`Não foi possível ler quem entrou no grupo: ${part.error.message}`);
      participantesNovos.push(...((part.data ?? []) as { telefone: string; entrou_em: string }[]));
    }
    decididos.push(...(await decisoesDepois(db, p.grupo.id, sumidos.map((v) => v.telefone), desde)));
  }
  const r = reconciliarLeitura({ vistos, lidos, completa, participantesNovos, decididos, participantesFrescos: p.participantesFrescos });

  // Novos: insert (concorrência com outra leitura = ignora o repetido; `visto_em` fica o do primeiro).
  const novos = r.novos.map((t) => porTel.get(t)!).filter(Boolean);
  for (const lote of lotes(novos)) {
    const { error: e } = await db.from("solicitacoes_vistas").upsert(
      lote.map((n) => ({ grupo_id: p.grupo.id, campanha_id: p.campanhaId, telefone: n.telefone, pedido_em: n.pedidoEm, visto_em: p.agora, ultimo_visto_em: p.agora })),
      { onConflict: "grupo_id,telefone", ignoreDuplicates: true },
    );
    if (e) throw new Error(`Não foi possível gravar os pedidos vistos: ${e.message}`);
  }
  // Continuam: só regrava `ultimo_visto_em` de quem foi visto de novo e está velho.
  const agoraMs = Date.parse(p.agora);
  const refrescar = r.manter.filter((v) => lidosSet.has(v.telefone) && agoraMs - Date.parse(v.ultimo_visto_em) >= REFRESCAR_VISTO_MS).map((v) => v.telefone);
  for (const lote of lotes(refrescar)) {
    const { error: e } = await db.from("solicitacoes_vistas").update({ ultimo_visto_em: p.agora }).eq("grupo_id", p.grupo.id).in("telefone", lote);
    if (e) throw new Error(`Não foi possível atualizar os pedidos vistos: ${e.message}`);
  }
  // Sumiram: relê as decisões logo antes de gravar (uma decisão manual pode ter sido gravada no meio desta leitura:
  // ela já é a linha do Histórico, não duplica). A linha do Histórico vem primeiro; só depois sai dos vistos (se a
  // gravação falhar, a próxima leitura tenta de novo).
  const pedidoDe = new Map(vistos.map((v) => [v.telefone, v.pedido_em]));
  const vistoDe = new Map(vistos.map((v) => [v.telefone, v.visto_em]));
  let sumiram = r.sumiram;
  const descartados = [...r.descartados];
  if (sumiram.length) {
    const recentes = await decisoesDepois(db, p.grupo.id, sumiram.map((x) => x.telefone), sumiram.map((x) => vistoDe.get(x.telefone)!).sort()[0]);
    const jaDecididos = new Set(
      sumiram
        .filter((x) => {
          const vs = new Set([x.telefone, ...variantesTelefone(x.telefone.split("@")[0])]);
          const desde = Date.parse(vistoDe.get(x.telefone)!);
          return recentes.some((d) => vs.has(d.telefone) && Date.parse(d.created_at) >= desde);
        })
        .map((x) => x.telefone),
    );
    descartados.push(...jaDecididos);
    sumiram = sumiram.filter((x) => !jaDecididos.has(x.telefone));
  }
  if (sumiram.length) {
    const { error: e } = await db.from("solicitacoes_entrada").insert(
      sumiram.map((s) => ({
        campanha_id: p.campanhaId,
        grupo_id: p.grupo.id,
        grupo_nome: p.grupo.nome,
        telefone: s.telefone,
        pedido_em: pedidoDe.get(s.telefone) ?? null,
        decisao: s.decisao,
        origem: "whatsapp",
        motivo: s.decisao === "aprovada" ? MOTIVO_APROVADA_CELULAR : AJUDA_CANCELADA,
        decidida_por: null,
        resultado: "ok",
        erro: null,
      })),
    );
    if (e) throw new Error(`Não foi possível gravar os pedidos fechados pelo WhatsApp: ${e.message}`);
  }
  const fechar = [...sumiram.map((s) => s.telefone), ...descartados];
  for (const lote of lotes(fechar)) {
    const { error: e } = await db.from("solicitacoes_vistas").delete().eq("grupo_id", p.grupo.id).in("telefone", lote);
    if (e) throw new Error(`Não foi possível tirar os pedidos fechados dos vistos: ${e.message}`);
  }
  return {
    novos,
    fechados: sumiram.map((s) => ({ ...s, pedidoEm: pedidoDe.get(s.telefone) ?? null })),
    vistos: [
      ...r.manter.map((v) => ({ telefone: v.telefone, visto_em: v.visto_em, pedido_em: v.pedido_em })),
      ...novos.map((n) => ({ telefone: n.telefone, visto_em: p.agora, pedido_em: n.pedidoEm })),
    ],
  };
}

/** Pedidos vistos sem leitura há 48 h (o grupo deixou de ser lido: regras desligadas, grupo desativado): viram linha
 *  `expirada` (`origem 'whatsapp'`) e saem dos vistos — a não ser que o número tenha entrado no grupo depois de
 *  `visto_em` (`participantes`, nas variantes): aí vira `aprovada` (pelo celular). Até `MAX_EXPIRAR_POR_TICK` por chamada; só lê
 *  `solicitacoes_vistas` (com os nomes dos grupos), nenhuma chamada ao Zapbot. Sem nada vencido, nenhuma escrita.
 *  Devolve quantos expirou. */
export async function expirarVistos(db: Db, agora: Date | string = new Date(), emitir?: (eventos: EventoHook[]) => void): Promise<number> {
  const ms = typeof agora === "string" ? Date.parse(agora) : agora.getTime();
  const corte = new Date(ms - RESERVA_MS).toISOString();
  const { data, error } = await db
    .from("solicitacoes_vistas")
    .select("grupo_id, campanha_id, telefone, pedido_em, visto_em, grupos(nome, group_id), campanhas(slug, nome)")
    .lt("ultimo_visto_em", corte)
    .order("ultimo_visto_em")
    .limit(MAX_EXPIRAR_POR_TICK);
  if (error) throw new Error(`Não foi possível ler os pedidos vistos: ${error.message}`);
  type Um<T> = T | T[] | null;
  type L = {
    grupo_id: string;
    campanha_id: string;
    telefone: string;
    pedido_em: string | null;
    visto_em: string;
    grupos: Um<{ nome: string | null; group_id?: string | null }>;
    campanhas?: Um<{ slug: string | null; nome: string | null }>;
  };
  const linhas = (data ?? []) as L[];
  if (!linhas.length) return 0;
  // Antes de expirar: quem entrou no grupo (nas variantes do telefone) depois de `visto_em` foi aprovado pelo celular.
  const aprovados = new Set<string>();
  const doGrupo = new Map<string, L[]>();
  for (const l of linhas) doGrupo.set(l.grupo_id, [...(doGrupo.get(l.grupo_id) ?? []), l]);
  for (const [grupoId, ls] of doGrupo) {
    const desde = ls.map((l) => l.visto_em).sort()[0];
    for (const lote of lotes(ls)) {
      const variantes = [...new Set(lote.flatMap((l) => variantesTelefone(l.telefone.split("@")[0])))];
      const { data: part, error: ep } = await db.from("participantes").select("telefone, entrou_em").eq("grupo_id", grupoId).in("telefone", variantes).gte("entrou_em", desde);
      if (ep) throw new Error(`Não foi possível ler quem entrou nos grupos: ${ep.message}`);
      const entradas = (part ?? []) as { telefone: string; entrou_em: string }[];
      for (const l of lote) {
        const vs = new Set(variantesTelefone(l.telefone.split("@")[0]));
        if (entradas.some((x) => vs.has(x.telefone) && Date.parse(x.entrou_em) >= Date.parse(l.visto_em))) aprovados.add(`${grupoId}:${l.telefone}`);
      }
    }
  }
  const { error: e1 } = await db.from("solicitacoes_entrada").insert(
    linhas.map((l) => {
      const g = Array.isArray(l.grupos) ? l.grupos[0] : l.grupos;
      const aprovada = aprovados.has(`${l.grupo_id}:${l.telefone}`);
      return {
        campanha_id: l.campanha_id,
        grupo_id: l.grupo_id,
        grupo_nome: g?.nome ?? null,
        telefone: l.telefone,
        pedido_em: l.pedido_em,
        decisao: aprovada ? "aprovada" : "expirada",
        origem: "whatsapp",
        motivo: aprovada ? MOTIVO_APROVADA_CELULAR : MOTIVO_EXPIRADA_SEM_LEITURA,
        decidida_por: null,
        resultado: "ok",
        erro: null,
      };
    }),
  );
  if (e1) throw new Error(`Não foi possível gravar os pedidos expirados: ${e1.message}`);
  // Hook `decisao` (Etapa 3N, Tarefa 3): só depois do Histórico gravado; nunca lança.
  if (emitir) {
    try {
      const primeiro = <T>(x: Um<T> | undefined): T | null => (Array.isArray(x) ? (x[0] ?? null) : (x ?? null));
      const porGrupoEv = new Map<string, L[]>();
      for (const l of linhas) porGrupoEv.set(l.grupo_id, [...(porGrupoEv.get(l.grupo_id) ?? []), l]);
      const eventos: EventoHook[] = [];
      for (const [grupoId, ls] of porGrupoEv) {
        const g = primeiro(ls[0].grupos);
        const c = primeiro(ls[0].campanhas);
        eventos.push(
          ...eventosSolicitacoes({
            campanhaId: ls[0].campanha_id,
            campanhaSlug: c?.slug ?? undefined,
            campanhaNome: c?.nome ?? undefined,
            grupoId,
            grupoNome: g?.nome ?? null,
            groupId: g?.group_id ?? null,
            tipo: "decisao",
            itens: ls.map((l) => {
              const aprovada = aprovados.has(`${l.grupo_id}:${l.telefone}`);
              return { telefone: l.telefone, pedidoEm: l.pedido_em, decisao: aprovada ? "aprovada" : "expirada", origem: "whatsapp", motivo: aprovada ? MOTIVO_APROVADA_CELULAR : MOTIVO_EXPIRADA_SEM_LEITURA };
            }),
            agora: new Date(ms),
          }),
        );
      }
      emitir(eventos);
    } catch (e) {
      console.error(`[solicitacoes] Hook das expiradas não foi montado: ${e instanceof Error ? e.message : e}`);
    }
  }
  const porGrupo = new Map<string, string[]>();
  for (const l of linhas) porGrupo.set(l.grupo_id, [...(porGrupo.get(l.grupo_id) ?? []), l.telefone]);
  for (const [grupoId, telefones] of porGrupo) {
    for (const lote of lotes(telefones)) {
      const { error: e2 } = await db.from("solicitacoes_vistas").delete().eq("grupo_id", grupoId).in("telefone", lote).lt("ultimo_visto_em", corte);
      if (e2) throw new Error(`Não foi possível tirar os pedidos expirados dos vistos: ${e2.message}`);
    }
  }
  return linhas.length;
}

/** Quem, entre os telefones, já está aberto (não saiu) noutro grupo ativo da campanha ou num grupo ativo das
 *  `anteriores` (só quando a seção "Remover Lead de Campanhas Anteriores" está ligada: quem chama passa a lista).
 *  Nas duas formas do nono dígito. Erro de leitura lança: na dúvida, ninguém é aprovado. */
export async function jaParticipam(db: Db, p: { telefones: readonly string[]; campanhaId: string; grupoId: string; anteriores: readonly string[] }): Promise<string[]> {
  const unicos = [...new Set(p.telefones.map((t) => t.trim()).filter(Boolean))];
  const achados: string[] = [];
  for (const lote of lotes(unicos)) {
    const variantes = [...new Set(lote.flatMap(variantesTelefone))];
    const { data, error } = await db
      .from("participantes")
      .select("telefone, grupo_id, grupos!inner(campanha_id, ativo)")
      .in("telefone", variantes)
      .is("saiu_em", null)
      .eq("grupos.campanha_id", p.campanhaId)
      .eq("grupos.ativo", true)
      .neq("grupo_id", p.grupoId);
    if (error) throw new Error(`Não foi possível ler as participações na campanha: ${error.message}`);
    for (const x of (data ?? []) as { telefone: string; grupo_id: string }[]) if (x.grupo_id !== p.grupoId) achados.push(x.telefone);
    const anteriores = p.anteriores.filter((c) => c !== p.campanhaId);
    if (anteriores.length) {
      const { data: d2, error: e2 } = await db
        .from("participantes")
        .select("telefone, grupo_id, grupos!inner(campanha_id, ativo)")
        .in("telefone", variantes)
        .is("saiu_em", null)
        .in("grupos.campanha_id", anteriores)
        .eq("grupos.ativo", true);
      if (e2) throw new Error(`Não foi possível ler as participações nas campanhas anteriores: ${e2.message}`);
      achados.push(...((d2 ?? []) as { telefone: string }[]).map((x) => x.telefone));
    }
  }
  return [...new Set(achados)];
}

/** Quem, entre os telefones (ou ids LID) que pediram pra entrar, tem ao menos uma das `tags` em `pessoa_tags` (com ou
 *  sem `campanha_id`), nas duas formas do nono dígito. Devolve os telefones do jeito que vieram nos pedidos. Erro de
 *  leitura lança: na dúvida, ninguém é aprovado por tag. */
export async function telefonesComTag(db: Db, telefones: readonly string[], tags: readonly string[]): Promise<string[]> {
  const unicos = [...new Set(telefones.map((t) => t.trim()).filter(Boolean))];
  if (!unicos.length || !tags.length) return [];
  const achados = new Set<string>();
  for (const lote of lotes(unicos)) {
    const variantes = [...new Set(lote.flatMap(variantesTelefone))];
    const { data, error } = await db.from("pessoa_tags").select("telefone").in("telefone", variantes).in("tag_id", [...tags]);
    if (error) throw new Error(`Não foi possível ler as tags de quem pediu pra entrar: ${error.message}`);
    for (const x of (data ?? []) as { telefone: string }[]) achados.add(x.telefone);
  }
  return unicos.filter((t) => variantesTelefone(t).some((v) => achados.has(v)));
}

/** Leitura e regras de um grupo, dentro da conferência (rodada gravada e com aprovação ligada — quem chama confere):
 *  1. lê os pendentes (`completa` = o grupo respondeu);
 *  2. `registrarLeitura` (vistos, aprovados pelo celular, cancelados);
 *  3. com a aprovação por tag ligada, lê `pessoa_tags` dos livres (nas variantes), filtrando `aprovarTags`;
 *  4. `planoAutomatico` (rodada suspeita: lê e registra, mas não decide);
 *  5. `decidirPedidos` (`origem 'automatica'`);
 *  6. com `reservarVaga`, grava `grupos.pendentes_reservados` (vistos de até 48 h que continuam pendentes) e
 *     `pendentes_lidos_em`, só quando o número mudou ou a última marca tem mais de `REFRESCAR_RESERVA_MS`.
 *  Com `prazo`, cada chamada ao Zapbot leva `restante(prazo) - MARGEM_PRAZO_REGRA_MS` como prazo total; sem tempo
 *  útil, a chamada seguinte não é feita. Qualquer erro lança: quem chama alerta e segue (nada da rodada é desfeito). */
export async function lerEResponderPedidos(
  db: Db,
  z: Pick<ZapbotClient, "pedidosPendentes" | "revisarPedidos">,
  c: ZapbotConexao,
  p: {
    campanhaId: string;
    grupo: GrupoDecisao;
    recusarBloqueados: boolean;
    aprovarAutomaticamente: boolean;
    /** Aprovação automática por tag (Etapa 3N) e as tags escolhidas (ids). */
    aprovarPorTag?: boolean;
    aprovarTags?: readonly string[];
    /** Reservar vaga para solicitações pendentes (Etapa 3N). */
    reservarVaga?: boolean;
    /** `grupos.pendentes_reservados` / `pendentes_lidos_em` antes desta leitura (pra só escrever quando muda). */
    reservadosAtual?: number;
    lidosEmAtual?: string | null;
    vagas: number;
    suspeita: boolean;
    /** Quantas pessoas o grupo tem agora (com admins): limita a aprovação pra não parecer entrada em massa. */
    membros: number;
    /** Campanhas anteriores (só com a seção ligada; senão vazio). */
    anteriores?: readonly string[];
    /** Prazo do tick. Sem ele (fora do cron), as chamadas usam o timeout padrão. */
    prazo?: Prazo;
    /** Instante desta rodada (o mesmo de `entrou_em` dos participantes). */
    agora?: string;
    /** Há Hook assinado em `solicitacoes_entrada` pra esta campanha (Etapa 3N, Tarefa 3): lê e registra mesmo
     *  sem nenhuma regra ligada (sem decidir nada). Ausente/false = como antes. */
    hook?: boolean;
    /** Recebe os eventos `solicitacoes_entrada` (novos, fechados pelo WhatsApp e decisões automáticas) desta leitura.
     *  Montar ou entregar nunca lança nem muda o resultado. */
    emitir?: (eventos: EventoHook[]) => void;
    campanhaSlug?: string;
    campanhaNome?: string;
  },
): Promise<{ aprovadas: number; recusadas: number; leitura: ResultadoLeitura | null }> {
  const nada = { aprovadas: 0, recusadas: 0, leitura: null };
  const tags = p.aprovarPorTag === true ? [...new Set(p.aprovarTags ?? [])] : [];
  const porTag = tags.length > 0;
  // Hook sem `emitir` não conta: ler e marcar como visto sem ninguém receber faria os pedidos nunca saírem como
  // `pendentes` (a próxima leitura já não os vê como novos).
  const hook = p.hook === true && typeof p.emitir === "function";
  if (!p.recusarBloqueados && !p.aprovarAutomaticamente && !porTag && p.reservarVaga !== true && !hook) return nada;
  /** Prazo útil pra próxima chamada; `null` = não dá tempo; `undefined` = sem prazo (fora do cron). */
  const util = (): number | null | undefined => {
    if (!p.prazo) return undefined;
    const ms = restante(p.prazo) - MARGEM_PRAZO_REGRA_MS;
    return ms >= MINIMO_CHAMADA_MS ? ms : null;
  };
  const leituraMs = util();
  if (leituraMs === null) return nada;
  const resposta = await z.pedidosPendentes(c, p.grupo.groupId, {
    timeoutMs: Math.min(TIMEOUT_PENDENTES_RODADA_MS, leituraMs ?? TIMEOUT_PENDENTES_RODADA_MS),
    ...(leituraMs ? { prazoTotalMs: leituraMs } : {}),
  });
  const agora = p.agora ?? new Date().toISOString();
  const pedidos = resposta ?? [];
  const leitura = await registrarLeitura(db, { campanhaId: p.campanhaId, grupo: p.grupo, pedidos, completa: resposta !== null, agora });

  let recusadas = 0;
  let aprovadas = 0;
  const decididos = new Set<string>();
  const decisoesAuto: ItemSolicitacaoHook[] = [];
  const decide = !p.suspeita && pedidos.length > 0 && (p.recusarBloqueados || p.aprovarAutomaticamente || porTag);
  const reserva = p.reservarVaga === true && resposta !== null;
  // Uma classificação só (bloqueados_efetivos + LID), usada pra decidir e pra contar a reserva.
  const sep = pedidos.length && (decide || reserva) ? separarPedidos(pedidos, await classificarPedidos(db, pedidos.map((x) => x.telefone))) : null;
  if (decide && sep) {
    const candidatos = p.aprovarAutomaticamente ? sep.livres.map((x) => x.telefone).filter(ehTelefoneBR) : [];
    const ja = candidatos.length ? await jaParticipam(db, { telefones: candidatos, campanhaId: p.campanhaId, grupoId: p.grupo.id, anteriores: p.anteriores ?? [] }) : [];
    const comTag = porTag && sep.livres.length ? await telefonesComTag(db, sep.livres.map((x) => x.telefone), tags) : [];
    const plano = planoAutomatico({
      pedidos: sep,
      recusarBloqueados: p.recusarBloqueados,
      aprovarAutomaticamente: p.aprovarAutomaticamente,
      aprovarPorTag: porTag,
      comTag,
      vagas: p.vagas,
      suspeita: p.suspeita,
      membros: p.membros,
      jaParticipam: ja,
    });
    const pedidoEm = Object.fromEntries(pedidos.map((x) => [x.telefone, x.pedidoEm]));
    let semTempo = false;
    if (plano.recusar.length) {
      const ms = util();
      if (ms === null) semTempo = true;
      else {
        const r = await decidirPedidos(db, z, c, {
          campanhaId: p.campanhaId,
          grupo: p.grupo,
          telefones: plano.recusar,
          decisao: "recusada",
          origem: "automatica",
          usuario: null,
          motivo: "Bloqueado",
          pedidoEm,
          ...(ms ? { prazoTotalMs: ms } : {}),
        });
        recusadas = r.ok;
        for (const t of r.decididos ?? []) decididos.add(t);
        decisoesAuto.push(...(r.decisoes ?? []));
      }
    }
    if (plano.aprovar.length && !semTempo) {
      const ms = util();
      if (ms !== null) {
        const r = await decidirPedidos(db, z, c, {
          campanhaId: p.campanhaId,
          grupo: p.grupo,
          telefones: plano.aprovar.slice(0, MAX_AUTOMATICO_POR_GRUPO),
          decisao: "aprovada",
          origem: "automatica",
          usuario: null,
          motivo: "Aprovação automática",
          motivoPorTelefone: plano.motivo,
          pedidoEm,
          vagas: p.vagas,
          ...(ms ? { prazoTotalMs: ms } : {}),
        });
        aprovadas = r.ok;
        for (const t of r.decididos ?? []) decididos.add(t);
        decisoesAuto.push(...(r.decisoes ?? []));
      }
    }
  }

  // Reserva de vaga: só com leitura completa (numa leitura que falhou o número fica como estava).
  if (reserva) {
    // Bloqueado e LID nunca são aprovados: não seguram vaga.
    const fora = new Set([...(sep?.bloqueados ?? []), ...(sep?.soLid ?? [])].map((x) => x.telefone));
    const reservados = reservadosDoGrupo(
      leitura.vistos.filter((v) => !decididos.has(v.telefone) && !fora.has(v.telefone) && !ehPedidoLid(v.telefone)),
      agora,
    );
    const velho = !p.lidosEmAtual || Date.parse(agora) - Date.parse(p.lidosEmAtual) >= REFRESCAR_RESERVA_MS;
    if (reservados !== (p.reservadosAtual ?? 0) || velho) {
      const { error } = await db.from("grupos").update({ pendentes_reservados: reservados, pendentes_lidos_em: agora }).eq("id", p.grupo.id);
      if (error) throw new Error(`Não foi possível gravar as vagas reservadas: ${error.message}`);
    }
  }
  if (p.emitir) {
    try {
      p.emitir(
        eventosDaLeitura({
          campanhaId: p.campanhaId,
          campanhaSlug: p.campanhaSlug,
          campanhaNome: p.campanhaNome,
          grupo: p.grupo,
          leitura,
          decisoes: decisoesAuto,
          agora,
        }),
      );
    } catch (e) {
      console.error(`[solicitacoes] Hook do grupo ${p.grupo.id} não foi montado: ${e instanceof Error ? e.message : e}`);
    }
  }
  return { aprovadas, recusadas, leitura };
}

/** Eventos `solicitacoes_entrada` de uma leitura de um grupo: `pendentes` com os novos e `decisao` com os fechados
 *  pelo WhatsApp (aprovada pelo celular / cancelada) mais as `decisoes` já gravadas (automáticas ou manuais). */
export function eventosDaLeitura(p: {
  campanhaId: string;
  campanhaSlug?: string;
  campanhaNome?: string;
  grupo: GrupoDecisao;
  leitura?: Pick<ResultadoLeitura, "novos" | "fechados"> | null;
  decisoes?: readonly ItemSolicitacaoHook[];
  agora?: string;
}): EventoHook[] {
  const base = { campanhaId: p.campanhaId, campanhaSlug: p.campanhaSlug, campanhaNome: p.campanhaNome, grupoId: p.grupo.id, grupoNome: p.grupo.nome, groupId: p.grupo.groupId, agora: p.agora };
  const fechados: ItemSolicitacaoHook[] = (p.leitura?.fechados ?? []).map((f) => ({
    telefone: f.telefone,
    pedidoEm: f.pedidoEm,
    decisao: f.decisao,
    origem: "whatsapp",
    motivo: f.decisao === "aprovada" ? MOTIVO_APROVADA_CELULAR : AJUDA_CANCELADA,
  }));
  return [
    // `vistoEm` (o instante desta leitura, que vira `visto_em`) entra na chave quando falta `pedido_em`: um pedido que
    // some e volta no mesmo dia sai de novo.
    ...eventosSolicitacoes({ ...base, tipo: "pendentes", itens: (p.leitura?.novos ?? []).map((n) => ({ telefone: n.telefone, pedidoEm: n.pedidoEm, vistoEm: p.agora })) }),
    ...eventosSolicitacoes({ ...base, tipo: "decisao", itens: [...fechados, ...(p.decisoes ?? [])] }),
  ];
}

/** Aba Pendentes e botões aprovar/recusar (Etapa 3N, Tarefa 3): entrega pelo menos uma vez (a chave de idempotência
 *  evita a maior parte das repetições, não todas). Enfileira os `solicitacoes_entrada` de vários grupos
 *  de uma campanha, uma leitura de `webhooks` por chamada. Sem Hook assinado pra campanha, não lê mais nada nem
 *  escreve. Nunca lança: falha só vai pro log (a resposta da tela não muda). */
export async function enfileirarSolicitacoes(
  db: Db,
  campanhaId: string,
  porGrupo: readonly { grupo: GrupoDecisao; leitura?: Pick<ResultadoLeitura, "novos" | "fechados"> | null; decisoes?: readonly ItemSolicitacaoHook[] }[],
  o: { webhooks?: WebhookComUrl[] | null; agora?: string } = {},
): Promise<void> {
  try {
    const tem = porGrupo.some((g) => (g.leitura?.novos.length ?? 0) + (g.leitura?.fechados.length ?? 0) + (g.decisoes?.length ?? 0) > 0);
    if (!tem) return;
    const webhooks = o.webhooks !== undefined ? o.webhooks : await carregarWebhooks(db);
    if (!webhooksQueCasam(webhooks ?? [], "solicitacoes_entrada", campanhaId).length) return;
    const { data: camp, error } = await db.from("campanhas").select("slug, nome").eq("id", campanhaId).maybeSingle();
    if (error) throw new Error(`Não foi possível ler a campanha: ${error.message}`);
    const c = (camp ?? null) as { slug: string | null; nome: string | null } | null;
    const eventos = porGrupo.flatMap((g) =>
      eventosDaLeitura({ campanhaId, campanhaSlug: c?.slug ?? undefined, campanhaNome: c?.nome ?? undefined, grupo: g.grupo, leitura: g.leitura, decisoes: g.decisoes, agora: o.agora }),
    );
    await enfileirarEventos(db, eventos, webhooks);
  } catch (e) {
    console.error(`[solicitacoes] Hook da campanha ${campanhaId} não foi enfileirado: ${e instanceof Error ? e.message : e}`);
  }
}

/** Aba Pendentes (revisão final A): a leitura feita ao abrir a aba só é registrada em `solicitacoes_vistas` (e só vira
 *  Hook) quando a campanha usa os pedidos vistos: recusar bloqueados, aprovar automaticamente, aprovar por tag
 *  (com tag escolhida), reservar vaga, ou um webhook ativo assinando "Solicitações de entrada em grupos" pra ela. Com
 *  tudo desligado, abrir a aba não grava nada (só lê). Falha ao ler a campanha ou os webhooks = não grava. Devolve os
 *  webhooks já carregados (quando carregou), pra quem chama não ler de novo. */
export async function abaRegistraLeitura(db: Db, campanhaId: string): Promise<{ grava: boolean; webhooks?: WebhookComUrl[] | null }> {
  try {
    const { data, error } = await db
      .from("campanhas")
      .select("recusar_bloqueados, aprovar_automaticamente, aprovar_por_tag, aprovar_tags, reservar_vaga_pendentes")
      .eq("id", campanhaId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const c = (data ?? {}) as { recusar_bloqueados?: boolean; aprovar_automaticamente?: boolean; aprovar_por_tag?: boolean; aprovar_tags?: string[] | null; reservar_vaga_pendentes?: boolean };
    const porTag = c.aprovar_por_tag === true && (c.aprovar_tags ?? []).filter(Boolean).length > 0;
    if (c.recusar_bloqueados === true || c.aprovar_automaticamente === true || porTag || c.reservar_vaga_pendentes === true) return { grava: true };
    const webhooks = await carregarWebhooks(db);
    return { grava: webhooksQueCasam(webhooks ?? [], "solicitacoes_entrada", campanhaId).length > 0, webhooks };
  } catch (e) {
    console.error(`[solicitacoes] não foi possível conferir se a aba registra a leitura da campanha ${campanhaId}: ${e instanceof Error ? e.message : e}`);
    return { grava: false };
  }
}

/** `pendentes_lidos_em` é regravado no máximo a cada isto quando o número de reservados não muda. */
export const REFRESCAR_RESERVA_MS = 5 * 60_000;

export type GrupoParaLeitura = { id: string; groupId: string; nome: string; conexaoId: string; conexao: ZapbotConexao };
export type PedidoLido = { grupoId: string; telefone: string; pedidoEm: string | null };

/** Promessa com teto: passou de `ms`, rejeita (o `AbortSignal` do cliente também corta, isto é a garantia). */
function comTeto<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<never>((_, rejeitar) => {
    t = setTimeout(() => rejeitar(new Error("Tempo esgotado.")), Math.max(0, ms));
  });
  return Promise.race([p, limite]).finally(() => clearTimeout(t));
}

/** Aba Pendentes: lê ao vivo (`GET groups/{id}/pending`, sem cache) até 40 grupos (já na ordem de quem chama: maior
 *  número primeiro), 4 em paralelo, até 8 s por chamada e `prazoMs` no total. Grupo que deu erro, sumiu (404) ou não
 *  coube no prazo entra em `semResposta` (a tela mostra "N grupo(s) não responderam"). Antes, uma leitura `GET groups`
 *  por conta (até 5 s, melhor esforço) acha os grupos de aviso de comunidade, que são pulados. */
export async function lerPendentes(
  z: Pick<ZapbotClient, "pedidosPendentes" | "listarGrupos">,
  grupos: readonly GrupoParaLeitura[],
  o: { paralelo?: number; porChamadaMs?: number; prazoMs?: number; listaMs?: number; agora?: () => number } = {},
): Promise<{ pedidos: PedidoLido[]; semResposta: string[]; responderam: string[] }> {
  const agora = o.agora ?? Date.now;
  const fim = agora() + (o.prazoMs ?? 20_000);
  const porChamada = o.porChamadaMs ?? 8_000;
  const lista = grupos.slice(0, MAX_GRUPOS_PENDENTES);

  // Grupos de aviso de comunidade: uma leitura por conta, em paralelo; falhou = não pula nada.
  const avisos = new Set<string>();
  const contas = new Map(lista.map((g) => [g.conexaoId, g.conexao]));
  const listaMs = Math.min(o.listaMs ?? 5_000, Math.max(0, fim - agora()));
  await Promise.allSettled(
    [...contas.values()].map(async (c) => {
      const todos = await comTeto(z.listarGrupos(c, { prazoTotalMs: Math.max(1_000, listaMs) }), listaMs);
      for (const g of todos) if (g.isAnnouncementGroup === true || g.isCommunity === true) avisos.add(g.groupId);
    }),
  );

  const alvos = lista.filter((g) => !avisos.has(g.groupId));
  const porGrupo: (ZapbotPedido[] | null)[] = new Array(alvos.length).fill(null);
  const semResposta: string[] = [];
  let proximo = 0;
  const trabalhador = async () => {
    for (;;) {
      const i = proximo++;
      if (i >= alvos.length) return;
      const g = alvos[i];
      const sobra = fim - agora();
      if (sobra < 1_000) {
        semResposta.push(g.id);
        continue;
      }
      const ms = Math.min(porChamada, sobra);
      try {
        const r = await comTeto(z.pedidosPendentes(g.conexao, g.groupId, { timeoutMs: ms, prazoTotalMs: ms }), ms);
        if (r === null) semResposta.push(g.id);
        else porGrupo[i] = r;
      } catch {
        semResposta.push(g.id);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, o.paralelo ?? 4), alvos.length) }, trabalhador));
  const pedidos = alvos.flatMap((g, i) => (porGrupo[i] ?? []).map((p) => ({ grupoId: g.id, telefone: p.telefone, pedidoEm: p.pedidoEm })));
  // Grupos com resposta (leitura completa): a aba registra a leitura deles em `solicitacoes_vistas`.
  const responderam = alvos.filter((_, i) => porGrupo[i] !== null).map((g) => g.id);
  return { pedidos, semResposta, responderam };
}
