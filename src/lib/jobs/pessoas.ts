import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CHAVE_ANTISPAM_CONTAS, contaPodeRemover, FONTE_BLOQUEADOS, lerAntispamContas } from "../regras/antispam";
import {
  campanhasAnterioresValidas,
  candidatosDaRodada,
  operacoesDeTags,
  planoDaRodada,
  remocoesAnteriores,
  TETO_REMOCOES_ANTERIORES,
  type PlanoRodada,
  type TagsDaCampanha,
} from "../regras/pessoas";
import type { Membro } from "../regras/participantes";
import { lidDoId } from "../regras/administrativos";
import { inicioDoDiaBrasilia } from "../regras/metricas";
import { variantesTelefone } from "../telefone";
import { alertar } from "./alertas";

export type Db = Pick<SupabaseClient, "from" | "rpc">;

/** Lotes para `.in()` não estourar o tamanho da URL do PostgREST. */
const LOTE = 200;

function lotes<T>(lista: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < lista.length; i += LOTE) out.push(lista.slice(i, i + LOTE));
  return out;
}

/** Uma ação `remover` por telefone. 23505 = já existe remoção em fila/processando pro par (grupo, telefone): não é
 *  falha. `executarApos` (ISO) adia a remoção; sem ele vale o default do banco (agora). Devolve quantas entraram na
 *  fila agora.
 *
 *  Bloqueio manda mais que a remoção que já estava na fila: se o par já tem uma `remover` em `fila` (ex.: de
 *  automação agendada pra semana que vem, ou de duplicado), ela vira `bloqueado` (sem `automacao_id`, pra uma
 *  automação desativada não cancelar a remoção) e é antecipada pra `executarApos` (ou agora) se estava pra depois. */
export async function enfileirarRemocoes(
  db: Db,
  a: { campanhaId: string; grupoId: string; telefones: string[]; origem: string; executarApos?: string },
): Promise<number> {
  const linha = (telefone: string) => ({ tipo: "remover", campanha_id: a.campanhaId, grupo_id: a.grupoId, telefone, origem: a.origem, ...(a.executarApos ? { executar_apos: a.executarApos } : {}) });
  let novas = 0;
  // Uma por vez (como sempre foi) só quando precisa: telefone sozinho, ou lote que bateu num 23505 (aí cada linha
  // decide por si se é nova ou já estava na fila).
  const umaPorVez = async (telefone: string) => {
    const { error } = await db.from("acoes").insert(linha(telefone));
    if (error && error.code !== "23505") throw new Error(`Não foi possível enfileirar a remoção de ${telefone}: ${error.message}`);
    if (!error) novas++;
    else if (a.origem === "bloqueado") await priorizarBloqueio(db, a.grupoId, telefone, a.executarApos ?? new Date().toISOString());
  };
  for (const lote of lotes(a.telefones)) {
    if (lote.length === 1) {
      await umaPorVez(lote[0]);
      continue;
    }
    // Lote num insert só: o insert é atômico, então com 23505 nada do lote entrou e ele refaz linha a linha.
    const { error } = await db.from("acoes").insert(lote.map(linha));
    if (!error) {
      novas += lote.length;
      continue;
    }
    if (error.code !== "23505") throw new Error(`Não foi possível enfileirar as remoções: ${error.message}`);
    for (const telefone of lote) await umaPorVez(telefone);
  }
  return novas;
}

/** A `remover` em fila do par (grupo, telefone) passa a ser de bloqueio e vence até `ate`. */
async function priorizarBloqueio(db: Db, grupoId: string, telefone: string, ate: string): Promise<void> {
  const { error: erroOrigem } = await db
    .from("acoes")
    .update({ origem: "bloqueado", automacao_id: null })
    .eq("tipo", "remover")
    .eq("grupo_id", grupoId)
    .eq("telefone", telefone)
    .eq("status", "fila");
  if (erroOrigem) throw new Error(`Não foi possível priorizar a remoção de ${telefone}: ${erroOrigem.message}`);
  const { error: erroData } = await db
    .from("acoes")
    .update({ executar_apos: ate })
    .eq("tipo", "remover")
    .eq("grupo_id", grupoId)
    .eq("telefone", telefone)
    .eq("status", "fila")
    .gt("executar_apos", ate);
  if (erroData) throw new Error(`Não foi possível antecipar a remoção de ${telefone}: ${erroData.message}`);
}

export async function tagFixa(db: Db, tipo: "comprador" | "saiu"): Promise<string> {
  const { data, error } = await db.from("tags").select("id").eq("tipo", tipo).single();
  if (error || !data) throw new Error(`Não foi possível ler a tag ${tipo}: ${error?.message ?? "não existe"}`);
  return (data as { id: string }).id;
}

async function rpc(db: Db, nome: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(nome, args);
  if (error) throw new Error(`Não foi possível gravar as tags (${nome}): ${error.message}`);
  return data;
}

export async function marcarComprador(db: Db, telefone: string): Promise<void> {
  await rpc(db, "por_tag", { p_telefones: [telefone], p_tag: await tagFixa(db, "comprador"), p_campanha: null });
}

export type Rodada = {
  grupoId: string;
  grupoNome: string;
  campanhaId: string;
  campanhaNome: string;
  entraram: Membro[];
  sairam: Membro[];
  /** Telefones dos números conectados no sistema (`telefonesProtegidos` de `../automacoes`): nunca sofrem regra. */
  protegidos: string[];
  /** Instante da rodada (ISO), o mesmo gravado em `entrou_em`/`saiu_em`. */
  agora: string;
  /** Rodada suspeita (entrada em massa ou leitura estranha aceita): remove bloqueado, mas não remove duplicado (a
   *  leitura pode estar errada e remover em massa é pior que deixar um duplicado); alerta quantos ficaram. */
  pularDuplicados?: boolean;
  /** Seção "Checar participantes duplicados" da campanha (padrão ligado = como sempre foi). Desligada: ninguém sai
   *  por duplicado nesta campanha e não há alerta de duplicado mantido. */
  checarDuplicados?: boolean;
  /** Conta (conexão) do grupo: decide se o `bloqueado_removido` desta rodada é levantado (abaixo). */
  conexaoId?: string | null;
  /** Seção "Gerenciamento de Tags" da campanha (padrão: sem tags = como sempre foi). */
  tags?: TagsDaCampanha;
  /** Seção "Remover Lead de Campanhas Anteriores": as campanhas escolhidas, só com a seção ligada (padrão: nenhuma =
   *  como sempre foi). Quem ganha a tag Campanha sai dos grupos ativos delas (5 min de espera). */
  removerAnteriores?: string[];
};

export type ResultadoRodada = PlanoRodada & {
  /** Duplicados que ficaram no grupo porque a rodada era suspeita. */
  duplicadosMantidos: string[];
};

/** Espera da remoção de bloqueado: a conferência grava a entrada logo depois de enfileirar, e a ação `remover` só
 *  tira quem tem participação aberta. */
const ESPERA_REMOCAO_MS = 60_000;
/** Duplicado espera mais: dá tempo da conferência do outro grupo ver se a pessoa já saiu de lá (aí não é mais
 *  duplicado e a ação, ao rodar, desiste). */
const ESPERA_DUPLICADO_MS = 5 * 60_000;
/** Participação em outro grupo só conta como duplicado se esse grupo foi conferido há pouco: grupo parado (número
 *  desconectado) pode ter participação aberta de quem já saiu faz tempo. */
const CONFERIDO_HA_MS = 10 * 60_000;

/** Bloqueio, duplicado e tags de uma rodada de conferência. Roda ANTES de gravar entradas e saídas: se lançar, nada
 *  do grupo foi gravado e a próxima rodada vê a mesma diferença (tudo aqui é idempotente). */
/** Com "Antispam por Contas Associadas" ligado e a conta do grupo sem autorização, a remoção nem vai ser feita (a
 *  ação, ao rodar, desiste e levanta `antispam_sem_conta` — ver `contaAutorizadaAntispam` em `jobs/acoes.ts`): não
 *  duplica o aviso aqui com um `bloqueado_removido` que promete uma "remoção na fila" que não vai acontecer.
 *  Desligado (ou sem linha) = sempre autorizada, como antes. */
export async function contaAutorizadaParaAlertar(db: Db, conexaoId: string | null): Promise<boolean> {
  const { data, error } = await db.from("configuracoes").select("valor").eq("chave", CHAVE_ANTISPAM_CONTAS).maybeSingle();
  if (error) throw new Error(`Não foi possível ler o Antispam por Conexões Associadas: ${error.message}`);
  const cfg = lerAntispamContas((data as { valor: unknown } | null)?.valor);
  return contaPodeRemover(cfg, conexaoId);
}

/** Participante gravado com o id LID (`…@lid`): o Zapbot não remove por esse id (a remoção falha e volta pra fila). */
export function ehIdLid(id: string): boolean {
  return /@lid$/i.test(id.trim());
}

export function textoAlertaSoLid(grupoNome: string): string {
  return `Contato bloqueado no grupo ${grupoNome} aparece só como LID — remova à mão`;
}

/** Bloqueado que só aparece como LID no grupo: nunca entra na fila de remoção (falharia ou ficaria em laço); vira
 *  um alerta por grupo por dia (mesmo texto no mesmo dia de Brasília = não alerta de novo). */
export async function alertarSoLid(
  db: Pick<SupabaseClient, "from">,
  g: { grupoNome: string; campanhaId: string | null; conexaoId?: string | null },
  agora: Date = new Date(),
): Promise<void> {
  const texto = textoAlertaSoLid(g.grupoNome);
  const { data: ja, error } = await db
    .from("alertas")
    .select("id")
    .eq("tipo", "bloqueado_removido")
    .eq("texto", texto)
    .gte("created_at", inicioDoDiaBrasilia(agora))
    .limit(1);
  // Sem conseguir conferir, alerta de novo: melhor repetido que perdido.
  if (!error && ((ja as unknown[] | null) ?? []).length) return;
  await alertar({ tipo: "bloqueado_removido", texto, campanhaId: g.campanhaId, conexaoId: g.conexaoId ?? null }, db);
}

/** Bloquear por LID (Etapa 3K, Tarefa 6): quem entrou com id LID (`…@lid` ou só dígitos) e não casou pelo
 *  telefone casa com `bloqueados.lid`. Devolve os ids crus (como estão em `participantes.telefone`) que são
 *  bloqueados. Esses só existem como LID no grupo: a rodada não enfileira remoção pra eles, só alerta.
 *  Bloqueados sem lid (todos os antigos) nunca casam aqui: nada muda pra eles. */
export async function bloqueadosPorLid(db: Db, candidatos: string[], jaBloqueados: string[]): Promise<string[]> {
  const ja = new Set(jaBloqueados.flatMap(variantesTelefone));
  const porLid = new Map<string, string[]>();
  for (const id of candidatos) {
    if (variantesTelefone(id).some((v) => ja.has(v))) continue;
    const lid = lidDoId(id);
    if (lid) porLid.set(lid, [...(porLid.get(lid) ?? []), id]);
  }
  if (!porLid.size) return [];
  const out: string[] = [];
  for (const lote of lotes([...porLid.keys()])) {
    const { data, error } = await db.from("bloqueados").select("lid").in("lid", lote);
    if (error) throw new Error(`Não foi possível ler os LIDs bloqueados: ${error.message}`);
    for (const b of (data ?? []) as { lid: string | null }[]) if (b.lid) out.push(...(porLid.get(b.lid) ?? []));
  }
  return out;
}

export async function tratarRodada(db: Db, r: Rodada): Promise<ResultadoRodada> {
  // Rodada sem mudança (a maioria, a cada 2 min por grupo): nada a decidir, nenhuma consulta.
  if (!r.entraram.length && !r.sairam.length) {
    return { ...planoDaRodada({ grupoId: r.grupoId, entraram: [], sairam: [], protegidos: [], bloqueados: [], abertos: [], pendentes: [] }), duplicadosMantidos: [] };
  }
  // Só remoção já vencida segura a saída: uma `remover` de automação agendada pro futuro não pode prender aberta a
  // participação de quem saiu sozinho.
  const { data: pend, error: erroPend } = await db
    .from("acoes")
    .select("telefone")
    .eq("tipo", "remover")
    .eq("grupo_id", r.grupoId)
    .in("status", ["fila", "processando"])
    .lte("executar_apos", r.agora);
  if (erroPend) throw new Error(`Não foi possível ler as remoções pendentes: ${erroPend.message}`);

  const conferidoDesde = new Date(Date.parse(r.agora) - CONFERIDO_HA_MS).toISOString();
  const bloqueados: string[] = [];
  const abertos: { telefone: string; grupoId: string }[] = [];
  for (const lote of lotes(candidatosDaRodada(r.entraram, r.protegidos))) {
    const variantes = [...new Set(lote.flatMap(variantesTelefone))];
    // Fonte única: bloqueados + números das blacklists ativas (mesma remoção, mesmos cuidados).
    const { data: b, error: erroB } = await db.from(FONTE_BLOQUEADOS).select("telefone").in("telefone", variantes);
    if (erroB) throw new Error(`Não foi possível ler os bloqueados: ${erroB.message}`);
    bloqueados.push(...((b ?? []) as { telefone: string }[]).map((x) => x.telefone));
    const { data: a, error: erroA } = await db
      .from("participantes")
      .select("telefone, grupo_id, grupos!inner(campanha_id, ativo)")
      .in("telefone", variantes)
      .is("saiu_em", null)
      .eq("admin", false)
      .eq("grupos.campanha_id", r.campanhaId)
      .eq("grupos.ativo", true)
      .gte("grupos.conferido_em", conferidoDesde);
    if (erroA) throw new Error(`Não foi possível ler as participações na campanha: ${erroA.message}`);
    abertos.push(...((a ?? []) as { telefone: string; grupo_id: string }[]).map((x) => ({ telefone: x.telefone, grupoId: x.grupo_id })));
  }
  // Bloqueado só por LID: conta como bloqueado (não vira duplicado), mas não entra na fila de remoção (o Zapbot
  // não remove pelo id LID): vira alerta, abaixo.
  const soLid = await bloqueadosPorLid(db, candidatosDaRodada(r.entraram, r.protegidos), bloqueados);
  bloqueados.push(...soLid);
  const ehSoLid = new Set(soLid);

  const calculado = planoDaRodada({
    grupoId: r.grupoId,
    entraram: r.entraram,
    sairam: r.sairam,
    protegidos: r.protegidos,
    bloqueados,
    abertos,
    pendentes: ((pend ?? []) as { telefone: string }[]).map((p) => p.telefone),
  });

  const checarDuplicados = r.checarDuplicados !== false;
  const duplicadosMantidos = checarDuplicados && r.pularDuplicados ? calculado.removerDuplicado : [];
  const soLidNoGrupo = calculado.removerBloqueio.filter((t) => ehSoLid.has(t));
  const plano = {
    ...calculado,
    removerBloqueio: calculado.removerBloqueio.filter((t) => !ehSoLid.has(t)),
    removerDuplicado: !checarDuplicados || r.pularDuplicados ? [] : calculado.removerDuplicado,
  };

  const depois = (ms: number) => new Date(Date.parse(r.agora) + ms).toISOString();
  const fila = { campanhaId: r.campanhaId, grupoId: r.grupoId };
  await enfileirarRemocoes(db, { ...fila, telefones: plano.removerBloqueio, origem: "bloqueado", executarApos: depois(ESPERA_REMOCAO_MS) });
  await enfileirarRemocoes(db, { ...fila, telefones: plano.removerDuplicado, origem: "duplicado", executarApos: depois(ESPERA_DUPLICADO_MS) });

  // Remover Lead de Campanhas Anteriores: nunca na rodada suspeita (mesma trava do duplicado: a leitura pode estar
  // errada e remover em massa é pior). A ação `remover`, ao rodar, confere de novo (ainda no grupo, não virou admin,
  // não é número conectado).
  const anteriores = r.pularDuplicados ? [] : campanhasAnterioresValidas(r.removerAnteriores, r.campanhaId);
  let excedenteAnteriores = 0;
  if (anteriores.length && plano.ganhamCampanha.length) {
    const abertasAnteriores: { telefone: string; grupoId: string; campanhaId: string }[] = [];
    for (const lote of lotes(plano.ganhamCampanha)) {
      const variantes = [...new Set(lote.flatMap(variantesTelefone))];
      const { data, error } = await db
        .from("participantes")
        .select("telefone, grupo_id, grupos!inner(campanha_id, ativo)")
        .in("telefone", variantes)
        .is("saiu_em", null)
        .eq("admin", false)
        .in("grupos.campanha_id", anteriores)
        .eq("grupos.ativo", true);
      if (error) throw new Error(`Não foi possível ler as participações nas campanhas anteriores: ${error.message}`);
      for (const x of (data ?? []) as { telefone: string; grupo_id: string; grupos: { campanha_id: string } | { campanha_id: string }[] }[]) {
        const grupo = Array.isArray(x.grupos) ? x.grupos[0] : x.grupos;
        // Defesa extra além do filtro: só grupos das campanhas escolhidas, nunca a própria campanha.
        if (!grupo || grupo.campanha_id === r.campanhaId || !anteriores.includes(grupo.campanha_id)) continue;
        abertasAnteriores.push({ telefone: x.telefone, grupoId: x.grupo_id, campanhaId: grupo.campanha_id });
      }
    }
    const { grupos, excedente } = remocoesAnteriores(abertasAnteriores, r.grupoId);
    for (const g of grupos) {
      await enfileirarRemocoes(db, { campanhaId: g.campanhaId, grupoId: g.grupoId, telefones: g.telefones, origem: "campanha_anterior", executarApos: depois(ESPERA_DUPLICADO_MS) });
    }
    excedenteAnteriores = excedente;
  }

  if (plano.ganhamCampanha.length || plano.ganhamSaiu.length) {
    const saiu = await tagFixa(db, "saiu");
    if (plano.ganhamCampanha.length) {
      const tagCampanha = await rpc(db, "tag_da_campanha", { p_campanha: r.campanhaId });
      await rpc(db, "por_tag", { p_telefones: plano.ganhamCampanha, p_tag: tagCampanha, p_campanha: null });
      await rpc(db, "tirar_tag", { p_telefones: plano.ganhamCampanha, p_tag: saiu, p_campanha: r.campanhaId });
    }
    if (plano.ganhamSaiu.length) await rpc(db, "por_tag", { p_telefones: plano.ganhamSaiu, p_tag: saiu, p_campanha: r.campanhaId });
    // Gerenciamento de Tags (só ligado): tags manuais, do telefone (sem campanha). Idempotente como as de cima.
    for (const op of operacoesDeTags(r.tags, plano.ganhamCampanha, plano.ganhamSaiu)) {
      await rpc(db, op.rpc, { p_telefones: op.telefones, p_tag: op.tag, p_campanha: null });
    }
  }

  // Alertas por último: se algo acima falhar, a rodada não é gravada e a seguinte refaz tudo (a fila ignora a
  // remoção repetida) e alerta uma vez só, quando der certo.
  const autorizada = plano.removerBloqueio.length || soLidNoGrupo.length ? await contaAutorizadaParaAlertar(db, r.conexaoId ?? null) : false;
  if (plano.removerBloqueio.length && autorizada) {
    const n = plano.removerBloqueio.length;
    await alertar({ tipo: "bloqueado_removido", texto: `${n} número${n > 1 ? "s" : ""} bloqueado${n > 1 ? "s" : ""} entrou no ${r.grupoNome}: remoção na fila (campanha ${r.campanhaNome})`, campanhaId: r.campanhaId }, db);
  }
  if (soLidNoGrupo.length && autorizada) {
    await alertarSoLid(db, { grupoNome: r.grupoNome, campanhaId: r.campanhaId, conexaoId: r.conexaoId ?? null }, new Date(r.agora));
  }
  if (duplicadosMantidos.length) {
    const n = duplicadosMantidos.length;
    await alertar({
      tipo: "criacao_erro",
      texto: `Grupo ${r.grupoNome}: ${n} ${n > 1 ? "duplicados não foram removidos" : "duplicado não foi removido"} porque a leitura desta rodada foi suspeita (entrada em massa ou leitura estranha). Confira o grupo (campanha ${r.campanhaNome}).`,
      campanhaId: r.campanhaId,
    }, db);
  }
  if (excedenteAnteriores) {
    const n = excedenteAnteriores;
    await alertar({
      tipo: "criacao_erro",
      texto: `Grupo ${r.grupoNome}: ${n} ${n > 1 ? "remoções" : "remoção"} de campanhas anteriores ${n > 1 ? "passaram" : "passou"} do teto de ${TETO_REMOCOES_ANTERIORES} por rodada e não ${n > 1 ? "entraram" : "entrou"} na fila (campanha ${r.campanhaNome}).`,
      campanhaId: r.campanhaId,
    }, db);
  }
  return { ...plano, duplicadosMantidos };
}
