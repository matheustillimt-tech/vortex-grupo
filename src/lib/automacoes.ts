import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { produtoCasa, PROVEDORES, type Provedor } from "./checkout/parsers";
import {
  acoesDaPessoa,
  alvoDaAcaoDePessoa,
  ehAcaoDePessoa,
  linhasCheckout,
  linhasDoCronograma,
  linhasDoEvento,
  linhasEntrou,
  linhasEntrouCondicional,
  linhasSaiu,
  tagsDasCondicionais,
  temTagCondicional,
  type AcaoAutomacao,
  type Gatilho,
  type LinhaExecucao,
  type LinhaRemocao,
} from "./regras/automacoes";
import { dbAdmin } from "./supabase/admin";
import { variantesTelefone } from "./telefone";

export type Db = Pick<SupabaseClient, "from" | "rpc">;

type AcaoRow = AcaoAutomacao & { id: string; ordem: number };
type AutomacaoRow = {
  id: string;
  campanha_id: string;
  gatilho: Gatilho;
  quando: string | null;
  alvo_grupos: string[] | null;
  /** Ausente nas linhas de antes da Etapa 3F = null = todas as contas. */
  alvo_contas?: string[] | null;
  ativo: boolean;
  provedor?: string | null;
  produto?: string | null;
  checkout_evento?: string | null;
  automacao_acoes: AcaoRow[];
};

const SELECAO = "id, campanha_id, gatilho, quando, alvo_grupos, alvo_contas, ativo, automacao_acoes(id, ordem, tipo, conteudo, atraso_min)";

const SELECAO_CHECKOUT = "id, campanha_id, gatilho, quando, alvo_grupos, alvo_contas, ativo, provedor, produto, checkout_evento, automacao_acoes(id, ordem, tipo, conteudo, atraso_min)";

const porOrdem = (acoes: AcaoRow[]) => [...acoes].sort((a, b) => a.ordem - b.ordem);

/** Apaga as execuções ainda `agendada` de uma automação e as remoções dela ainda na fila (`acoes` em `fila`, ex.:
 *  remoção com atraso): nada disso rodou, então não há histórico a guardar. Apagar em vez de marcar `cancelada` não
 *  deixa "lápide" nos índices únicos `automacao_acao_id,gatilho_chave`: desativar → reativar (ou trocar o gatilho e
 *  voltar) consegue agendar de novo. Uma remoção já `processando` é barrada no `processarAcoes` (automação
 *  desativada/apagada). Devolve quantas apagou (execuções + remoções). */
export async function removerPendentes(automacaoId: string, db: Db = dbAdmin()): Promise<number> {
  const { data, error } = await db.from("execucoes").delete().eq("automacao_id", automacaoId).eq("status", "agendada").select("id");
  if (error) throw new Error(`Não foi possível remover as execuções pendentes: ${error.message}`);
  const { data: remocoes, error: erroRemocoes } = await db.from("acoes").delete().eq("automacao_id", automacaoId).eq("status", "fila").select("id");
  if (erroRemocoes) throw new Error(`Não foi possível remover as remoções pendentes: ${erroRemocoes.message}`);
  return ((data as unknown[] | null) ?? []).length + ((remocoes as unknown[] | null) ?? []).length;
}

/** Recalcula as execuções agendadas do cronograma de uma automação: apaga só as `agendada` dela (nunca rodaram) e
 *  reinsere via `upsert` com `ignoreDuplicates`. Uma execução já `enviando`/`concluida` pra mesma ação+disparo é
 *  mantida (não falha o lote todo) e as demais ações ainda são agendadas; uma `cancelada` à mão também fica (o
 *  índice único a protege e ela não é recriada). Automação desativada ou que não é cronograma: só remove as
 *  pendentes (`removerPendentes`). Devolve quantas inseriu (ou quantas removeu, quando não insere). */
export async function sincronizarCronograma(automacaoId: string, db: Db = dbAdmin()): Promise<number> {
  const { data, error } = await db.from("automacoes").select(SELECAO).eq("id", automacaoId).single();
  if (error) throw new Error(`Não foi possível ler a automação: ${error.message}`);
  const automacao = data as AutomacaoRow;
  if (automacao.gatilho !== "cronograma" || !automacao.ativo) return removerPendentes(automacaoId, db);

  const { error: erroDelete } = await db.from("execucoes").delete().eq("automacao_id", automacaoId).eq("status", "agendada");
  if (erroDelete) throw new Error(`Não foi possível limpar as execuções agendadas do cronograma: ${erroDelete.message}`);

  const linhas = linhasDoCronograma(
    { id: automacao.id, campanha_id: automacao.campanha_id, quando: automacao.quando!, alvo_grupos: automacao.alvo_grupos, alvo_contas: automacao.alvo_contas },
    porOrdem(automacao.automacao_acoes),
  );
  if (!linhas.length) return 0;
  const { data: inseridas, error: erroUpsert } = await db
    .from("execucoes")
    .upsert(linhas, { onConflict: "automacao_acao_id,gatilho_chave", ignoreDuplicates: true })
    .select("id");
  if (erroUpsert) throw new Error(`Não foi possível agendar o cronograma: ${erroUpsert.message}`);
  return ((inseridas as unknown[] | null) ?? []).length;
}

/** Dispara as automações ativas de uma campanha/gatilho pra um grupo (ex.: grupo criado, grupo cheio).
 *  `upsert` com `ignoreDuplicates` protege contra repetir o mesmo disparo (índice único `automacao_acao_id,gatilho_chave`).
 *  Devolve quantas linhas foram geradas; lança se o banco falhar. */
export async function dispararAutomacoes(
  e: { campanhaId: string; gatilho: "grupo_criado" | "grupo_cheio"; grupoId: string },
  agora: Date = new Date(),
  db: Db = dbAdmin(),
): Promise<number> {
  const { data, error } = await db
    .from("automacoes")
    .select(SELECAO)
    .eq("campanha_id", e.campanhaId)
    .eq("gatilho", e.gatilho)
    .eq("ativo", true);
  if (error) throw new Error(`Não foi possível ler as automações: ${error.message}`);
  const automacoes = ((data as AutomacaoRow[] | null) ?? []);
  const linhas = automacoes.flatMap((a) => linhasDoEvento({ id: a.id, campanha_id: a.campanha_id, alvo_contas: a.alvo_contas }, porOrdem(a.automacao_acoes), e.grupoId, agora));
  if (!linhas.length) return 0;
  const { error: erroUpsert } = await db.from("execucoes").upsert(linhas, { onConflict: "automacao_acao_id,gatilho_chave", ignoreDuplicates: true });
  if (erroUpsert) throw new Error(`Não foi possível disparar as automações: ${erroUpsert.message}`);
  return linhas.length;
}

async function lerAutomacoes(db: Db, campanhaId: string, gatilho: Gatilho): Promise<AutomacaoRow[]> {
  const { data, error } = await db.from("automacoes").select(SELECAO).eq("campanha_id", campanhaId).eq("gatilho", gatilho).eq("ativo", true);
  if (error) throw new Error(`Não foi possível ler as automações: ${error.message}`);
  return (data as AutomacaoRow[] | null) ?? [];
}

/** Telefones dos números conectados no sistema (nas duas formas do nono dígito). Só eles: é o que decide quem
 *  nunca é rebaixado de admin (`admin_remover`), onde um Número administrativo não entra (rebaixar é sempre ação
 *  explícita de alguém). */
export async function telefonesConectados(db: Db = dbAdmin()): Promise<Set<string>> {
  const { data, error } = await db.from("conexoes").select("telefone");
  if (error) throw new Error(`Não foi possível ler os números conectados: ${error.message}`);
  const protegidos = new Set<string>();
  for (const c of (data as { telefone: string | null }[] | null) ?? []) {
    if (c.telefone) for (const v of variantesTelefone(c.telefone)) protegidos.add(v);
  }
  return protegidos;
}

/** Números administrativos cadastrados no Anti-spam (Etapa 3K, Tarefa 6), nas duas formas do nono dígito.
 *  Tabela vazia (ou sem linha) = conjunto vazio = comportamento de antes. */
export async function telefonesAdministrativos(db: Db = dbAdmin()): Promise<Set<string>> {
  const { data, error } = await db.from("numeros_administrativos").select("telefone");
  if (error) throw new Error(`Não foi possível ler os números administrativos: ${error.message}`);
  const out = new Set<string>();
  for (const c of (data as { telefone: string | null }[] | null) ?? []) {
    if (c.telefone) for (const v of variantesTelefone(c.telefone)) out.add(v);
  }
  return out;
}

/** Telefones que nunca são removidos nem bloqueados (nas duas formas do nono dígito): os números conectados no
 *  sistema e, desde a Etapa 3K (Tarefa 6), os Números administrativos do Anti-spam. Vale pro anti-spam, duplicado,
 *  campanha anterior, "Remover Lead", remoção em massa e automações. */
export async function telefonesProtegidos(db: Db = dbAdmin()): Promise<Set<string>> {
  const [conectados, administrativos] = await Promise.all([telefonesConectados(db), telefonesAdministrativos(db)]);
  for (const v of administrativos) conectados.add(v);
  return conectados;
}

/** Tags (das Tags Condicionais) de cada telefone: `temTag(telefone, tagId, campanhaId)`. Lê `pessoa_tags` uma vez
 *  pros telefones (nas duas formas do nono dígito) e tags pedidos. Uma tag por campanha (ex.: "Saiu") só conta na
 *  campanha da automação; tag sem campanha (manual, "Comprador", a da campanha) conta em qualquer uma. */
const LOTE_TELEFONES_TAGS = 200;

async function lerTagsDasPessoas(db: Db, telefones: string[], tagIds: string[]): Promise<(telefone: string, tagId: string, campanhaId: string) => boolean> {
  if (!telefones.length || !tagIds.length) return () => false;
  const variantes = [...new Set(telefones.flatMap((t) => variantesTelefone(t)))];
  // Em lotes de 200 telefones: muita gente entrando junto não estoura o tamanho da URL do PostgREST.
  const linhas: { telefone: string; tag_id: string; campanha_id: string | null }[] = [];
  for (let i = 0; i < variantes.length; i += LOTE_TELEFONES_TAGS) {
    const { data, error } = await db
      .from("pessoa_tags")
      .select("telefone, tag_id, campanha_id")
      .in("tag_id", tagIds)
      .in("telefone", variantes.slice(i, i + LOTE_TELEFONES_TAGS));
    if (error) throw new Error(`Não foi possível ler as tags das pessoas: ${error.message}`);
    linhas.push(...((data as typeof linhas | null) ?? []));
  }
  return (telefone, tagId, campanhaId) => {
    const formas = new Set(variantesTelefone(telefone));
    return linhas.some((l) => l.tag_id === tagId && formas.has(l.telefone) && (l.campanha_id === null || l.campanha_id === campanhaId));
  };
}

/** Participações abertas (não admin) de um telefone (com e sem nono dígito) nos grupos ativos de uma campanha. */
async function participacoesAbertas(db: Db, campanhaId: string, telefone: string, excetoGrupo?: string): Promise<{ grupoId: string; telefone: string }[]> {
  let q = db
    .from("participantes")
    .select("telefone, grupo_id, grupos!inner(campanha_id, ativo)")
    .in("telefone", variantesTelefone(telefone))
    .is("saiu_em", null)
    .eq("admin", false)
    .eq("grupos.campanha_id", campanhaId)
    .eq("grupos.ativo", true);
  if (excetoGrupo) q = q.neq("grupo_id", excetoGrupo);
  const { data, error } = await q;
  if (error) throw new Error(`Não foi possível ler os grupos em que o participante está: ${error.message}`);
  return ((data as { telefone: string; grupo_id: string }[] | null) ?? []).map((p) => ({ grupoId: p.grupo_id, telefone: p.telefone }));
}

/** Enfileira as remoções uma a uma: 23505 (já existe esse disparo, ou já há um "remover" em fila/processando pro
 *  mesmo grupo+telefone) é "já está na fila", não falha. Devolve quantas entraram de fato. */
async function enfileirarRemocoes(db: Db, linhas: LinhaRemocao[]): Promise<number> {
  let inseridas = 0;
  for (const l of linhas) {
    const { error } = await db.from("acoes").insert(l);
    if (error && error.code === "23505") continue;
    if (error) throw new Error(`Não foi possível enfileirar a remoção de ${l.telefone}: ${error.message}`);
    inseridas++;
  }
  return inseridas;
}

/** Telefone que cabe em `blacklist_numeros` (check `^[0-9]{11,15}$`). */
const TELEFONE_BLACKLIST = /^[0-9]{11,15}$/;

/** Telefones (da lista `tels`, na forma que vieram) que têm uma participação aberta como admin (em qualquer grupo,
 *  em qualquer variante do nono dígito) — nunca entram em blacklist por automação, pra um admin não ficar barrado
 *  de voltar pros grupos da campanha. */
async function telefonesAdmin(db: Db, tels: string[]): Promise<Set<string>> {
  if (!tels.length) return new Set();
  const variantes = [...new Set(tels.flatMap((t) => variantesTelefone(t)))];
  const { data, error } = await db.from("participantes").select("telefone").in("telefone", variantes).is("saiu_em", null).eq("admin", true);
  if (error) throw new Error(`Não foi possível conferir administradores: ${error.message}`);
  const admins = new Set(((data as { telefone: string }[] | null) ?? []).map((p) => p.telefone));
  return new Set(tels.filter((t) => variantesTelefone(t).some((v) => admins.has(v))));
}

/** Ações de pessoa (Etapa 3J) já liberadas pra esses telefones (depois da Tag Condicional, `acoesDaPessoa`):
 *  aplicadas na hora, em ordem, sem execução nem remoção. Tudo idempotente — o mesmo disparo reavaliado não muda
 *  nada: `por_tag` (on conflict do nothing), `tirar_tag`, `insert ... on conflict do nothing` na blacklist e `delete`
 *  com as variantes do telefone. Tags sempre do telefone (`p_campanha` null), e só `manual`: tag que sumiu ou que não
 *  é manual, e blacklist que sumiu, são puladas (sem erro, pra uma lista apagada não travar a conferência). Números
 *  conectados (`protegidos`) nunca entram em blacklist nem ganham/perdem tag. Adicionar à blacklist não remove
 *  ninguém aqui: a blacklist ativa alimenta o anti-spam (`bloqueados_efetivos`), que só remove quem ENTRA depois e
 *  nunca admin nem número conectado (`candidatosDaRodada` e `executarRemover`). `campanhaId` só identifica o erro.
 *  Devolve quantas ações foram aplicadas. */
export async function aplicarAcoesDePessoa(
  db: Db,
  acoes: { tipo: string; conteudo: unknown }[],
  telefones: string[],
  campanhaId: string,
  protegidos?: Set<string>,
): Promise<number> {
  const daPessoa = acoes.filter((x) => ehAcaoDePessoa(x.tipo));
  if (!daPessoa.length || !telefones.length) return 0;
  const nunca = protegidos ?? (await telefonesProtegidos(db));
  const tels = [...new Set(telefones.filter((t) => !variantesTelefone(t).some((v) => nunca.has(v))))];
  if (!tels.length) return 0;

  const alvos = daPessoa.map((x) => alvoDaAcaoDePessoa(x));
  const idsTag = [...new Set(alvos.filter((a) => a?.tipo === "tag").map((a) => a!.id))];
  const idsBlacklist = [...new Set(alvos.filter((a) => a?.tipo === "blacklist").map((a) => a!.id))];
  const tagsManuais = new Set<string>();
  if (idsTag.length) {
    const { data, error } = await db.from("tags").select("id").in("id", idsTag).eq("tipo", "manual");
    if (error) throw new Error(`Campanha ${campanhaId}: não foi possível conferir as tags das automações: ${error.message}`);
    for (const t of (data as { id: string }[] | null) ?? []) tagsManuais.add(t.id);
  }
  const blacklists = new Set<string>();
  if (idsBlacklist.length) {
    const { data, error } = await db.from("blacklists").select("id").in("id", idsBlacklist);
    if (error) throw new Error(`Campanha ${campanhaId}: não foi possível conferir as blacklists das automações: ${error.message}`);
    for (const b of (data as { id: string }[] | null) ?? []) blacklists.add(b.id);
  }

  // Admins (participação aberta em qualquer grupo): calculado uma vez, só se alguma ação é "adicionar à blacklist".
  let adminsTels: Set<string> | null = null;
  const admins = async () => (adminsTels ??= await telefonesAdmin(db, tels));

  let aplicadas = 0;
  for (const [i, x] of daPessoa.entries()) {
    const alvo = alvos[i];
    if (!alvo) continue;
    if (alvo.tipo === "tag") {
      if (!tagsManuais.has(alvo.id)) continue;
      const { error } = await db.rpc(x.tipo === "adicionar_tag" ? "por_tag" : "tirar_tag", { p_telefones: tels, p_tag: alvo.id, p_campanha: null });
      if (error) throw new Error(`Campanha ${campanhaId}: não foi possível ${x.tipo === "adicionar_tag" ? "pôr" : "tirar"} a tag: ${error.message}`);
      aplicadas++;
      continue;
    }
    if (!blacklists.has(alvo.id)) continue;
    if (x.tipo === "adicionar_blacklist") {
      // Número admin (participação aberta, em qualquer grupo) nunca entra em blacklist por automação.
      const adminSet = await admins();
      const linhas = tels.filter((t) => TELEFONE_BLACKLIST.test(t) && !adminSet.has(t)).map((telefone) => ({ blacklist_id: alvo.id, telefone }));
      if (!linhas.length) continue;
      const { error } = await db.from("blacklist_numeros").upsert(linhas, { onConflict: "blacklist_id,telefone", ignoreDuplicates: true });
      if (error) throw new Error(`Campanha ${campanhaId}: não foi possível adicionar à blacklist: ${error.message}`);
    } else {
      const variantes = [...new Set(tels.flatMap((t) => variantesTelefone(t)))];
      const { error } = await db.from("blacklist_numeros").delete().eq("blacklist_id", alvo.id).in("telefone", variantes);
      if (error) throw new Error(`Campanha ${campanhaId}: não foi possível remover da blacklist: ${error.message}`);
    }
    aplicadas++;
  }
  return aplicadas;
}

/** Aplica as ações de pessoa de uma automação pros telefones, cada um com as ações que a Tag Condicional liberou
 *  pra ele. Sem Tag Condicional, uma chamada só pra todos; com, os telefones são agrupados pelas ações liberadas
 *  (quem passou junto vai junto). */
async function aplicarDaAutomacao(
  db: Db,
  a: AutomacaoRow,
  telefones: string[],
  temTag: (telefone: string, tagId: string, campanhaId: string) => boolean,
  protegidos: Set<string>,
): Promise<number> {
  const acoes = porOrdem(a.automacao_acoes);
  if (!acoes.some((x) => ehAcaoDePessoa(x.tipo))) return 0;
  if (!temTagCondicional(acoes)) return aplicarAcoesDePessoa(db, acoes, telefones, a.campanha_id, protegidos);
  const grupos = new Map<string, { acoes: AcaoRow[]; telefones: string[] }>();
  for (const t of telefones) {
    const liberadas = acoesDaPessoa(acoes, (tag) => temTag(t, tag, a.campanha_id)).acoes.filter((x) => ehAcaoDePessoa(x.tipo));
    if (!liberadas.length) continue;
    const chave = liberadas.map((x) => x.id).join("|");
    const g = grupos.get(chave) ?? { acoes: liberadas, telefones: [] };
    g.telefones.push(t);
    grupos.set(chave, g);
  }
  let total = 0;
  for (const g of grupos.values()) total += await aplicarAcoesDePessoa(db, g.acoes, g.telefones, a.campanha_id, protegidos);
  return total;
}

/** Gatilhos "entrou"/"saiu" (vistos pela conferência de grupos). Entrou: mensagem no grupo (uma por bloco de 10 min)
 *  e/ou remoção de quem entrou. Saiu: remove quem saiu dos outros grupos ativos da campanha. Números conectados no
 *  sistema nunca são removidos nem contam como "entrou"/"saiu". Devolve quantas linhas foram criadas; lança se o
 *  banco falhar. */
export async function dispararPorPessoas(
  e: { campanhaId: string; gatilho: "entrou" | "saiu"; grupoId: string; telefones: string[] },
  agora: Date = new Date(),
  db: Db = dbAdmin(),
): Promise<number> {
  if (!e.telefones.length) return 0;
  const automacoes = await lerAutomacoes(db, e.campanhaId, e.gatilho);
  if (!automacoes.length) return 0;
  const protegidos = await telefonesProtegidos(db);
  const telefones = e.telefones.filter((t) => !protegidos.has(t));
  if (!telefones.length) return 0;

  // Tag Condicional: só lê as tags quando alguma automação tem uma (as que não têm seguem o caminho de sempre).
  const temTag = await lerTagsDasPessoas(db, telefones, automacoes.flatMap((a) => tagsDasCondicionais(a.automacao_acoes)));

  if (e.gatilho === "entrou") {
    const execucoes: LinhaExecucao[] = [];
    const remocoes: LinhaRemocao[] = [];
    for (const a of automacoes) {
      const auto = { id: a.id, campanha_id: a.campanha_id, alvo_contas: a.alvo_contas };
      const acoes = porOrdem(a.automacao_acoes);
      // Condição falha = ação pulada pra essa pessoa: nada é criado (o motor não tem onde registrar pulos; ver
      // `linhasEntrouCondicional`). Como nada é gravado, o mesmo `gatilho_chave` reavaliado depois (retry) pode
      // criar as ações puladas, se a pessoa ganhou a tag nesse meio tempo (ver `acoesDaPessoa`).
      const l = temTagCondicional(acoes)
        ? linhasEntrouCondicional(auto, acoes, e.grupoId, telefones, agora, (t, tag) => temTag(t, tag, a.campanha_id))
        : linhasEntrou(auto, acoes, e.grupoId, telefones, agora);
      execucoes.push(...l.execucoes);
      remocoes.push(...l.remocoes);
    }
    if (execucoes.length) {
      const { error } = await db.from("execucoes").upsert(execucoes, { onConflict: "automacao_acao_id,gatilho_chave", ignoreDuplicates: true });
      if (error) throw new Error(`Não foi possível agendar as mensagens de boas-vindas: ${error.message}`);
    }
    const criadas = execucoes.length + (await enfileirarRemocoes(db, remocoes));
    // Ações de pessoa (tags, blacklist): na hora, depois da Tag Condicional de cada pessoa. Não contam no total
    // (não criam linha de execução nem de remoção).
    for (const a of automacoes) await aplicarDaAutomacao(db, a, telefones, temTag, protegidos);
    return criadas;
  }

  // Saiu: o atalho de antes (sem "Remover Lead" = nada a fazer) agora também olha as ações de pessoa.
  const comRemocao = automacoes.filter((a) => a.automacao_acoes.some((x) => x.tipo === "remover_participante"));
  const comPessoa = automacoes.filter((a) => a.automacao_acoes.some((x) => ehAcaoDePessoa(x.tipo)));
  if (!comRemocao.length && !comPessoa.length) return 0;
  let total = 0;
  if (comRemocao.length) {
    for (const telefone of telefones) {
      const outras = (await participacoesAbertas(db, e.campanhaId, telefone, e.grupoId)).filter((p) => !protegidos.has(p.telefone));
      if (!outras.length) continue;
      const linhas = comRemocao.flatMap((a) =>
        linhasSaiu({ id: a.id, campanha_id: a.campanha_id }, acoesDaPessoa(porOrdem(a.automacao_acoes), (tag) => temTag(telefone, tag, a.campanha_id)).acoes, telefone, outras, e.grupoId, agora),
      );
      total += await enfileirarRemocoes(db, linhas);
    }
  }
  for (const a of comPessoa) await aplicarDaAutomacao(db, a, telefones, temTag, protegidos);
  return total;
}

/** Gatilho "checkout": venda aprovada com o produto escolhido remove o comprador de todos os grupos ativos da
 *  campanha da automação. Vale a automação da plataforma da venda ("Hotmart - Compra aprovada") e a de qualquer
 *  plataforma (`provedor` null, "Checkout - Compra aprovada"); `checkout_evento` null = aprovada. Só é chamado com
 *  venda aprovada (`processarVendas`). Sem repetir (índice único por venda+grupo). Devolve quantas remoções entraram
 *  na fila; lança se o banco falhar. */
export async function dispararCheckout(
  e: { vendaId: string; provedor: string; produtos: string[]; telefone: string },
  agora: Date = new Date(),
  db: Db = dbAdmin(),
): Promise<number> {
  // O provedor entra no filtro `or` do PostgREST: só valores conhecidos (a venda já vem de uma rota que confere).
  const conhecido = (PROVEDORES as readonly string[]).includes(e.provedor) ? (e.provedor as Provedor) : null;
  const { data, error } = await db
    .from("automacoes")
    .select(SELECAO_CHECKOUT)
    .eq("gatilho", "checkout")
    .eq("ativo", true)
    .or(conhecido ? `provedor.eq.${conhecido},provedor.is.null` : "provedor.is.null");
  if (error) throw new Error(`Não foi possível ler as automações de checkout: ${error.message}`);
  const automacoes = ((data as AutomacaoRow[] | null) ?? []).filter(
    (a) => !!a.produto && produtoCasa(a.produto, e.produtos) && (a.checkout_evento ?? "aprovada") === "aprovada",
  );
  if (!automacoes.length) return 0;
  const protegidos = await telefonesProtegidos(db);
  if (protegidos.has(e.telefone)) return 0;
  const temTag = await lerTagsDasPessoas(db, [e.telefone], automacoes.flatMap((a) => tagsDasCondicionais(a.automacao_acoes)));
  let total = 0;
  for (const a of automacoes) {
    // Tag Condicional que falha: as remoções depois dela não são criadas pra essa venda (nada é gravado).
    const acoes = acoesDaPessoa(porOrdem(a.automacao_acoes), (tag) => temTag(e.telefone, tag, a.campanha_id)).acoes;
    // Ações de pessoa (tags, blacklist): na hora. Idempotentes, então o retry de uma venda que falhou no meio não
    // duplica nada. Não contam no total (que é de remoções).
    await aplicarAcoesDePessoa(db, acoes, [e.telefone], a.campanha_id, protegidos);
    if (!acoes.some((x) => x.tipo === "remover_participante")) continue;
    const participacoes = (await participacoesAbertas(db, a.campanha_id, e.telefone)).filter((p) => !protegidos.has(p.telefone));
    if (!participacoes.length) continue;
    total += await enfileirarRemocoes(db, linhasCheckout({ id: a.id, campanha_id: a.campanha_id }, acoes, e.vendaId, participacoes, agora));
  }
  return total;
}
