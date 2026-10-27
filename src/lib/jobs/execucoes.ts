import "server-only";
import { env } from "../env";
import { ROTULO_TIPO, type ConteudoMoverGrupos, type TipoExecucao } from "../regras/conteudo";
import { segundosEntreGrupos, type ConteudoV2 } from "../regras/conteudo-v2";
import { nomeLongo, padraoNumerado } from "../regras/nome-grupo";
import { proximoNumero } from "../regras/criacao-grupos";
import { atrasadaDemais, pulaSeAtrasada } from "../regras/sequencia";
import { distribuirEntreChips, podeDistribuir } from "../regras/distribuir-chips";
import { planejarTarefas, prioridadeDaExecucao, type ExecucaoPlanejavel } from "../regras/tarefas";
import { juntarVariaveis, motivoVariaveis, resolverConteudo, variaveisAutomaticas, variaveisDoGrupo } from "../regras/variaveis";
import { eventoAcaoConcluida, eventoFalhaDisparo } from "../regras/webhooks";
import { dbAdmin } from "../supabase/admin";
import { variantesTelefone } from "../telefone";
import { criarEmissor, type Emissor } from "../webhooks";
import { alertar } from "./alertas";

type Vencida = {
  id: string;
  campanha_id: string;
  tipo: TipoExecucao;
  origem: string;
  gatilho_chave: string | null;
  conteudo: unknown;
  alvo_grupos: string[] | null;
  /** Só grupos destas contas (null = todas). Ausente em linha antiga = todas. */
  alvo_contas?: string[] | null;
  agendada_para: string;
};

/** Faixa entre grupos escolhida na mensagem v2 (`null` = espaçamento padrão). */
function intervaloDaExecucao(tipo: TipoExecucao, conteudo: unknown): { min: number; max: number } | null {
  if (tipo !== "mensagem" || (conteudo as { versao?: unknown } | null)?.versao !== 2) return null;
  const opcoes = (conteudo as ConteudoV2).opcoes;
  return opcoes?.intervalo_grupos ? segundosEntreGrupos(opcoes.intervalo_grupos) : null;
}
type Contexto = {
  nome: string;
  comunidadeId: string | null;
  vars: Record<string, string>;
  grupos: { id: string; conexao_id: string; numero: number }[];
  /** Valores preenchidos nos grupos (Etapa 3E), por grupo. Grupo sem linha aqui usa só os da campanha. */
  varsGrupo: Map<string, { chave: string; valor: string }[]>;
  /** Caractere da numeração da campanha ('' = como antes), usado no "Trocar nome". */
  caractere: string;
  /** Número no começo do nome (seção de numeração da campanha). */
  numeroNoInicio: boolean;
  /** Seção "Dividir envios entre chips": ligada e os chips escolhidos ([] = todos). */
  dividirChips: boolean;
  chipsDivisao: string[];
};

/** "Trocar nome": grava o caractere da numeração no conteúdo resolvido (só quando não é vazio: com o padrão, o
 *  conteúdo fica idêntico ao de antes). */
function comCaractere(tipo: TipoExecucao, conteudo: unknown, caractere: string): unknown {
  if (tipo !== "nome") return conteudo;
  // Quem criou a ação já escolheu o caractere ("Alterar grupos em lote" grava o novo, inclusive vazio): ele vale,
  // mesmo que a campanha ainda não tenha sido atualizada quando o cron pegar a execução.
  if (conteudo && typeof conteudo === "object" && "caractere" in conteudo) return conteudo;
  if (!caractere) return conteudo;
  return { ...(conteudo as Record<string, unknown>), caractere };
}

/** "Trocar nome" da campanha inteira (sem grupos escolhidos): padrão sem `{n}` ganha o número (`padraoNumerado`).
 *  Com grupos escolhidos, o nome fixo continua valendo (ex.: renomear um grupo só). */
function comNumero(v: Vencida, conteudo: unknown, ctx: Contexto): unknown {
  if (v.tipo !== "nome" || v.alvo_grupos?.length) return conteudo;
  const c = (conteudo ?? {}) as { padrao?: unknown; caractere?: unknown };
  if (typeof c.padrao !== "string") return conteudo;
  const caractere = typeof c.caractere === "string" ? c.caractere : ctx.caractere;
  return { ...c, padrao: padraoNumerado(c.padrao, caractere, ctx.numeroNoInicio) };
}

const PAGINA_VARIAVEIS = 1000;

/** Valores não vazios de variáveis dos grupos da campanha, em páginas (o max_rows da API é 1000). */
async function variaveisDosGrupos(db: ReturnType<typeof dbAdmin>, campanhaId: string): Promise<Map<string, { chave: string; valor: string }[]> | null> {
  const porGrupo = new Map<string, { chave: string; valor: string }[]>();
  for (let de = 0; ; de += PAGINA_VARIAVEIS) {
    const { data, error } = await db
      .from("grupo_variaveis")
      .select("grupo_id, chave, valor, grupos!inner(campanha_id)")
      .eq("grupos.campanha_id", campanhaId)
      .neq("valor", "")
      .order("grupo_id")
      .order("chave")
      .range(de, de + PAGINA_VARIAVEIS - 1);
    if (error) return null;
    const linhas = (data ?? []) as { grupo_id: string; chave: string; valor: string }[];
    for (const l of linhas) porGrupo.set(l.grupo_id, [...(porGrupo.get(l.grupo_id) ?? []), { chave: l.chave, valor: l.valor }]);
    if (linhas.length < PAGINA_VARIAVEIS) return porGrupo;
  }
}

/** Execução vencida → resolve variáveis (ou bloqueia) → uma tarefa por grupo-alvo. Todas as que vencem no mesmo
 *  tick são planejadas juntas: ações antes de mensagens, 3–8 s entre tarefas do mesmo número. */
export async function iniciarExecucoesVencidas(agora: Date = new Date()): Promise<number> {
  // Hooks "Falha em disparo agendado" e "Ação concluída": juntos e enfileirados no fim (nunca lançam).
  const emissor = criarEmissor(dbAdmin());
  try {
    return await iniciarVencidas(agora, emissor);
  } finally {
    await emissor.enviar();
  }
}

async function iniciarVencidas(agora: Date, emissor: Emissor): Promise<number> {
  const db = dbAdmin();
  const { data, error } = await db
    .from("execucoes")
    .update({ status: "enviando", iniciada_em: agora.toISOString() })
    .eq("status", "agendada")
    // Encadeada ("Adicionar outra ação") só começa depois que `liberarEncadeadas` a solta (anterior terminada).
    .is("depois_de", null)
    .lte("agendada_para", agora.toISOString())
    .select("id, campanha_id, tipo, origem, gatilho_chave, conteudo, alvo_grupos, alvo_contas, agendada_para");
  if (error) throw new Error(`Não foi possível buscar as execuções vencidas: ${error.message}`);
  const vencidas = (data ?? []) as Vencida[];
  const erros: string[] = [];
  const voltarPraFila = async (id: string, motivo: string) => {
    const { error: erroVolta } = await db.from("execucoes").update({ status: "agendada" }).eq("id", id);
    erros.push(`execução ${id}: ${motivo}${erroVolta ? ` (e não voltou pra agendada: ${erroVolta.message})` : ""}`);
  };

  const contextos = new Map<string, Contexto | null>();
  async function contexto(campanhaId: string): Promise<Contexto | null> {
    if (contextos.has(campanhaId)) return contextos.get(campanhaId)!;
    const [camp, pers, grupos, varsGrupo] = await Promise.all([
      db.from("campanhas").select("nome, slug, data_aula, link_aula, comunidade_id, caractere_numeracao, numero_no_inicio, dividir_chips, chips_divisao").eq("id", campanhaId).single(),
      db.from("campanha_variaveis").select("chave, valor").eq("campanha_id", campanhaId),
      db.from("grupos").select("id, conexao_id, numero").eq("campanha_id", campanhaId).eq("ativo", true).order("numero"),
      variaveisDosGrupos(db, campanhaId),
    ]);
    const ctx =
      camp.error || pers.error || grupos.error || !camp.data || !varsGrupo
        ? null
        : {
            nome: camp.data.nome as string,
            comunidadeId: (camp.data.comunidade_id as string | null) ?? null,
            vars: juntarVariaveis(variaveisAutomaticas(camp.data, env("NEXT_PUBLIC_SITE_URL")), pers.data ?? []),
            grupos: grupos.data ?? [],
            varsGrupo,
            caractere: typeof camp.data.caractere_numeracao === "string" ? camp.data.caractere_numeracao : "",
            numeroNoInicio: camp.data.numero_no_inicio === true,
            // Linha sem as colunas (antes da migração 20261020200000) = ligada com todos, como já funcionava.
            dividirChips: camp.data.dividir_chips !== false,
            chipsDivisao: Array.isArray(camp.data.chips_divisao) ? (camp.data.chips_divisao as string[]) : [],
          };
    contextos.set(campanhaId, ctx);
    return ctx;
  }

  const planejaveis: ExecucaoPlanejavel[] = [];
  /** Conteúdo resolvido com as variáveis do grupo, só dos grupos em que ele difere do da campanha. */
  const conteudosDosGrupos = new Map<string, Map<string, unknown>>();
  /** Execuções cujas tarefas são divididas entre os chips (`podeDistribuir` + seção ligada), com os chips
   *  escolhidos na campanha ([] = todos). */
  const distribuir = new Map<string, string[]>();
  for (const v of vencidas) {
    // Passo de sequência ou ação de cronograma parado na fila por mais de 15 min (cron fora do ar): não dispara atrasado.
    if (pulaSeAtrasada({ origem: v.origem, gatilhoChave: v.gatilho_chave }) && atrasadaDemais(new Date(v.agendada_para), agora)) {
      const pulada = await db.from("execucoes").update({ status: "pulada", motivo: "Passou mais de 15 min do horário antes de começar." }).eq("id", v.id);
      if (pulada.error) await voltarPraFila(v.id, `não foi possível marcar como pulada (${pulada.error.message})`);
      continue;
    }
    const ctx = await contexto(v.campanha_id);
    if (!ctx) {
      await voltarPraFila(v.id, "não foi possível carregar a campanha, as variáveis ou os grupos");
      continue;
    }
    // Variável preenchida só nos grupos (vazia na campanha): `conteudo_final` fica com o `{chave}` cru e o conteúdo
    // certo de cada grupo vai em `tarefas.conteudo_grupo`. Efeito colateral conhecido: se essa execução for
    // "importante", o reenvio pra um grupo novo copia o `conteudo_final` cru e bloqueia (com alerta) pela variável
    // vazia — o grupo novo não tem valor próprio. Sem mudança de comportamento por ora.
    const resolvido = resolverConteudo(v.tipo, v.conteudo, ctx.vars);
    const conteudo = comNumero(v, comCaractere(v.tipo, resolvido.conteudo, ctx.caractere), ctx);
    const faltandoCampanha = resolvido.faltando;
    const porGrupo = v.alvo_grupos ? ctx.grupos.filter((g) => v.alvo_grupos!.includes(g.id)) : ctx.grupos;
    // "Fechar em 24 h" de grupo novo (origem grupo_novo): o grupo pode ter sido movido de campanha nesse meio tempo.
    // Ele continua sendo o alvo: busca pelo id, em qualquer campanha, desde que ainda ativo.
    if (v.tipo === "fechar" && v.origem === "grupo_novo" && v.alvo_grupos?.length && porGrupo.length < v.alvo_grupos.length) {
      const faltam = v.alvo_grupos.filter((id) => !porGrupo.some((g) => g.id === id));
      const { data: movidos, error: erroMovidos } = await db.from("grupos").select("id, conexao_id, numero").in("id", faltam).eq("ativo", true);
      if (erroMovidos) {
        await voltarPraFila(v.id, `não foi possível ler o grupo a fechar (${erroMovidos.message})`);
        continue;
      }
      porGrupo.push(...((movidos ?? []) as Contexto["grupos"]));
    }
    // `alvo_contas` null ou [] = todas as contas.
    const alvo = v.alvo_contas?.length ? porGrupo.filter((g) => v.alvo_contas!.includes(g.conexao_id)) : porGrupo;
    const { conteudoPorGrupo, faltando } = resolverPorGrupo(v, ctx, alvo, conteudo, faltandoCampanha);
    const longo = v.tipo === "nome" ? nomeLongoPorGrupo(alvo, conteudo, conteudoPorGrupo, ctx.caractere) : null;
    const motivo = faltando.length ? motivoVariaveis(faltando, ctx.nome) : longo ? `Nome "${longo}" passa de 25 caracteres (campanha ${ctx.nome})` : null;
    if (motivo) {
      const bloqueada = await db.from("execucoes").update({ status: "bloqueada", motivo, conteudo_final: conteudo }).eq("id", v.id);
      if (bloqueada.error) {
        await voltarPraFila(v.id, `não foi possível marcar como bloqueada (${bloqueada.error.message})`);
        continue;
      }
      await alertar({ tipo: "execucao_bloqueada", texto: `${ROTULO_TIPO[v.tipo]} bloqueada: ${motivo}`, campanhaId: v.campanha_id }, db);
      emissor.adicionar(eventoFalhaDisparo({ campanhaId: v.campanha_id, campanhaNome: ctx.nome, execucaoId: v.id, tipo: v.tipo, tipoNome: ROTULO_TIPO[v.tipo], motivo: "bloqueada", texto: `${ROTULO_TIPO[v.tipo]} bloqueada: ${motivo}` }));
      continue;
    }
    if (v.tipo === "mover_grupos") {
      // Só banco, resolvido aqui: nada vai pro Zapbot e nenhuma tarefa é criada.
      const r = await moverGrupos(v, (conteudo as ConteudoMoverGrupos).campanha_destino, alvo.map((g) => g.id));
      if (r.tipo === "bloqueada") {
        const bloqueada = await db.from("execucoes").update({ status: "bloqueada", motivo: r.motivo, conteudo_final: conteudo }).eq("id", v.id);
        if (bloqueada.error) await voltarPraFila(v.id, `não foi possível marcar como bloqueada (${bloqueada.error.message})`);
        else {
          await alertar({ tipo: "execucao_bloqueada", texto: `${ROTULO_TIPO[v.tipo]} bloqueada: ${r.motivo}`, campanhaId: v.campanha_id }, db);
          emissor.adicionar(eventoFalhaDisparo({ campanhaId: v.campanha_id, campanhaNome: ctx.nome, execucaoId: v.id, tipo: v.tipo, tipoNome: ROTULO_TIPO[v.tipo], motivo: "bloqueada", texto: `${ROTULO_TIPO[v.tipo]} bloqueada: ${r.motivo}` }));
        }
        continue;
      }
      if (r.tipo === "falhou") {
        // Os grupos já movidos saíram da campanha de origem: a próxima tentativa só move o resto.
        await voltarPraFila(v.id, r.motivo);
        continue;
      }
      contextos.delete(v.campanha_id);
      contextos.delete((conteudo as ConteudoMoverGrupos).campanha_destino);
      const feita = await db.from("execucoes").update({ status: "concluida", conteudo_final: conteudo }).eq("id", v.id);
      if (feita.error) erros.push(`execução ${v.id}: ${r.movidos} grupo(s) movido(s), mas não foi possível marcar como concluída (${feita.error.message})`);
      else emissor.adicionar(concluida(v, ctx.nome, r.movidos));
      continue;
    }
    if (v.tipo === "desativar_comunidade") {
      // A comunidade é da campanha: UMA tarefa só, no grupo-alvo de menor número (com a conexão dele).
      if (!ctx.comunidadeId) {
        const sem = await db.from("execucoes").update({ status: "concluida", motivo: "Campanha sem comunidade", conteudo_final: {} }).eq("id", v.id);
        if (sem.error) await voltarPraFila(v.id, `não foi possível concluir (campanha sem comunidade): ${sem.error.message}`);
        else emissor.adicionar(concluida(v, ctx.nome, 0));
        continue;
      }
      const primeiro = [...alvo].sort((a, b) => a.numero - b.numero).slice(0, 1);
      const conteudoComunidade = { comunidade_id: ctx.comunidadeId };
      const salvo = await db.from("execucoes").update({ conteudo_final: conteudoComunidade, ...(primeiro.length ? {} : { status: "concluida" }) }).eq("id", v.id);
      if (salvo.error) {
        await voltarPraFila(v.id, `não foi possível salvar o conteúdo resolvido (${salvo.error.message})`);
        continue;
      }
      if (!primeiro.length) emissor.adicionar(concluida(v, ctx.nome, 0));
      if (primeiro.length) {
        planejaveis.push({ execucaoId: v.id, tipo: v.tipo, agendadaPara: v.agendada_para, grupos: primeiro.map((g) => ({ grupoId: g.id, conexaoId: g.conexao_id, numero: g.numero })) });
      }
      continue;
    }
    const final = await db.from("execucoes").update({ conteudo_final: conteudo, ...(alvo.length ? {} : { status: "concluida" }) }).eq("id", v.id);
    if (final.error) {
      await voltarPraFila(v.id, `não foi possível salvar o conteúdo resolvido (${final.error.message})`);
      continue;
    }
    if (!alvo.length) emissor.adicionar(concluida(v, ctx.nome, 0));
    if (v.tipo === "nome" && !v.alvo_grupos?.length) {
      // Grupo criado depois nasce com o nome atual e o número dele (`nomeDoGrupo` lê `padrao_nome`).
      const padrao = (conteudo as { padrao?: unknown }).padrao;
      if (typeof padrao === "string") {
        const { error: erroPadrao } = await db.from("campanhas").update({ padrao_nome: padrao }).eq("id", v.campanha_id);
        if (erroPadrao) console.error(`[execucoes] nome trocado, mas o padrão dos próximos grupos não mudou (${v.campanha_id})`, erroPadrao);
      }
    }
    if (conteudoPorGrupo.size) conteudosDosGrupos.set(v.id, conteudoPorGrupo);
    if (alvo.length) {
      if (ctx.dividirChips && podeDistribuir(v.tipo, v.alvo_contas)) distribuir.set(v.id, ctx.chipsDivisao);
      planejaveis.push({
        execucaoId: v.id,
        tipo: v.tipo,
        prioridade: prioridadeDaExecucao({ tipo: v.tipo, origem: v.origem, gatilhoChave: v.gatilho_chave }),
        agendadaPara: v.agendada_para,
        grupos: alvo.map((g) => ({ grupoId: g.id, conexaoId: g.conexao_id, numero: g.numero })),
        intervaloSeg: intervaloDaExecucao(v.tipo, conteudo),
      });
    }
  }

  if (distribuir.size) {
    try {
      await dividirEntreChips(db, planejaveis.filter((p) => distribuir.has(p.execucaoId)), distribuir);
    } catch (e) {
      // Sem a divisão, cada grupo segue pelo chip dono (como antes): o disparo não para por isso.
      console.error("[execucoes] não foi possível dividir os envios entre os chips", e);
    }
  }
  const tarefas = planejarTarefas(planejaveis, agora);
  for (const p of planejaveis) {
    const linhas = tarefas
      .filter((t) => t.execucaoId === p.execucaoId)
      .map((t) => {
        const doGrupo = conteudosDosGrupos.get(t.execucaoId)?.get(t.grupoId);
        return {
          execucao_id: t.execucaoId,
          grupo_id: t.grupoId,
          conexao_id: t.conexaoId,
          tipo: t.tipo,
          prioridade: t.prioridade,
          enviar_apos: t.enviarApos.toISOString(),
          // Só quando o grupo tem valor próprio que muda o conteúdo: o resto segue o `conteudo_final` da execução.
          ...(doGrupo !== undefined ? { conteudo_grupo: doGrupo } : {}),
        };
      });
    const { error: erroTarefas } = await db.from("tarefas").upsert(linhas, { onConflict: "execucao_id,grupo_id", ignoreDuplicates: true });
    if (erroTarefas) await voltarPraFila(p.execucaoId, `não foi possível enfileirar as tarefas (${erroTarefas.message})`);
  }
  if (erros.length) throw new Error(`Falha ao iniciar execuções: ${erros.join("; ")}`);
  return vencidas.length;
}

/** Mensagens e enquetes divididas entre os chips (`distribuirEntreChips`): apto = conexão conectada, sem pausa,
 *  admin do grupo (participante admin com o telefone dela) e entre os chips escolhidos na campanha (nenhum = todos).
 *  Carga inicial = tarefas já na fila de cada chip. */
async function dividirEntreChips(db: ReturnType<typeof dbAdmin>, planejaveis: ExecucaoPlanejavel[], chipsPorExecucao: Map<string, string[]>): Promise<void> {
  const grupoIds = [...new Set(planejaveis.flatMap((p) => p.grupos.map((g) => g.grupoId)))];
  const [conexoes, admins, fila] = await Promise.all([
    db.from("conexoes").select("id, telefone, status, pausado_ate"),
    db.from("participantes").select("grupo_id, telefone").in("grupo_id", grupoIds).eq("admin", true).is("saiu_em", null),
    db.from("tarefas").select("conexao_id").eq("status", "fila"),
  ]);
  if (conexoes.error || admins.error || fila.error) throw new Error((conexoes.error ?? admins.error ?? fila.error)!.message);
  const agora = Date.now();
  const porTelefone = new Map<string, string>();
  for (const c of (conexoes.data ?? []) as { id: string; telefone: string | null; status: string; pausado_ate: string | null }[]) {
    if (!c.telefone || c.status !== "conectado" || (c.pausado_ate && new Date(c.pausado_ate).getTime() > agora)) continue;
    for (const v of variantesTelefone(c.telefone)) porTelefone.set(v, c.id);
  }
  const aptos = new Map<string, string[]>();
  for (const a of (admins.data ?? []) as { grupo_id: string; telefone: string }[]) {
    const conexao = porTelefone.get(a.telefone);
    if (!conexao) continue;
    const lista = aptos.get(a.grupo_id) ?? [];
    if (!lista.includes(conexao)) lista.push(conexao);
    aptos.set(a.grupo_id, lista);
  }
  const carga = new Map<string, number>();
  for (const t of (fila.data ?? []) as { conexao_id: string }[]) carga.set(t.conexao_id, (carga.get(t.conexao_id) ?? 0) + 1);
  for (const p of planejaveis) {
    const escolhidos = chipsPorExecucao.get(p.execucaoId) ?? [];
    const aptosDaCampanha = escolhidos.length
      ? new Map([...aptos].map(([grupo, lista]) => [grupo, lista.filter((c) => escolhidos.includes(c))]))
      : aptos;
    p.grupos = distribuirEntreChips([...p.grupos].sort((a, b) => a.numero - b.numero), aptosDaCampanha, carga);
  }
}

/** Execução concluída aqui mesmo (sem tarefas: zero grupos, sem comunidade ou "mover grupos", só banco). */
function concluida(v: Vencida, campanhaNome: string, total: number) {
  return eventoAcaoConcluida({ campanhaId: v.campanha_id, campanhaNome, execucaoId: v.id, tipo: v.tipo, tipoNome: ROTULO_TIPO[v.tipo], total, enviadas: total, erros: 0 });
}

/** Tipos resolvidos no banco ou com conteúdo próprio (sem texto do usuário): variáveis do grupo não se aplicam. */
const SEM_VARIAVEIS_DO_GRUPO: readonly TipoExecucao[] = ["mover_grupos", "desativar_comunidade"];

/** Variáveis do grupo (Etapa 3E): pra cada grupo-alvo com valores próprios, resolve o conteúdo com eles por cima dos
 *  da campanha. Devolve só os conteúdos que mudam e as variáveis que faltam em algum grupo-alvo. Sem grupo com
 *  valores próprios (ou sem alvo), é exatamente o resultado da campanha, como antes. */
function resolverPorGrupo(
  v: Vencida,
  ctx: Contexto,
  alvo: { id: string }[],
  conteudoCampanha: unknown,
  faltandoCampanha: string[],
): { conteudoPorGrupo: Map<string, unknown>; faltando: string[] } {
  const conteudoPorGrupo = new Map<string, unknown>();
  const comValores = SEM_VARIAVEIS_DO_GRUPO.includes(v.tipo) ? [] : alvo.filter((g) => ctx.varsGrupo.get(g.id)?.length);
  if (!comValores.length) return { conteudoPorGrupo, faltando: faltandoCampanha };
  const faltando = new Set<string>(comValores.length < alvo.length ? faltandoCampanha : []);
  const base = JSON.stringify(conteudoCampanha);
  for (const g of comValores) {
    const r = resolverConteudo(v.tipo, v.conteudo, variaveisDoGrupo(ctx.vars, ctx.varsGrupo.get(g.id)!));
    r.faltando.forEach((f) => faltando.add(f));
    const doGrupo = comNumero(v, comCaractere(v.tipo, r.conteudo, ctx.caractere), ctx);
    if (JSON.stringify(doGrupo) !== base) conteudoPorGrupo.set(g.id, doGrupo);
  }
  return { conteudoPorGrupo, faltando: [...faltando] };
}

/** "Trocar nome": o primeiro nome longo entre os grupos-alvo, cada um com o seu padrão (o do grupo, se tiver). */
function nomeLongoPorGrupo(alvo: { id: string; numero: number }[], conteudoCampanha: unknown, conteudoPorGrupo: Map<string, unknown>, caractere: string): string | null {
  const padraoCampanha = (conteudoCampanha as { padrao: string }).padrao;
  if (!conteudoPorGrupo.size) return nomeLongo(padraoCampanha, alvo.map((g) => g.numero), caractere);
  for (const g of alvo) {
    const proprio = conteudoPorGrupo.get(g.id) as { padrao: string } | undefined;
    const longo = nomeLongo(proprio?.padrao ?? padraoCampanha, [g.numero], caractere);
    if (longo) return longo;
  }
  return null;
}

type ResultadoMover = { tipo: "ok"; movidos: number } | { tipo: "bloqueada"; motivo: string } | { tipo: "falhou"; motivo: string };

/** `mover_grupos`: troca a campanha dos grupos-alvo (com os próximos números da campanha de destino, como o
 *  "mover" da tela de grupos). Destino tem que existir, não estar arquivado e ser outra campanha. Igual à tela:
 *  com `alvo_grupos` escolhidos, move exatamente esses (inclusive inativos); sem, os ativos (`ativos`, já filtrados
 *  por conta). `alvo_contas` vale nos dois casos. */
async function moverGrupos(v: Vencida, destinoId: string, ativos: string[]): Promise<ResultadoMover> {
  const db = dbAdmin();
  let grupoIds = ativos;
  if (v.alvo_grupos) {
    const { data, error } = await db.from("grupos").select("id, conexao_id, numero").eq("campanha_id", v.campanha_id).in("id", v.alvo_grupos).order("numero");
    if (error) return { tipo: "falhou", motivo: `não foi possível ler os grupos escolhidos (${error.message})` };
    const linhas = (data as { id: string; conexao_id: string }[] | null) ?? [];
    grupoIds = linhas.filter((g) => !v.alvo_contas?.length || v.alvo_contas.includes(g.conexao_id)).map((g) => g.id);
  }
  if (!destinoId || destinoId === v.campanha_id) return { tipo: "bloqueada", motivo: "Campanha de destino é a mesma da ação." };
  const { data: destino, error: erroDestino } = await db.from("campanhas").select("id, arquivada, inicio_contagem").eq("id", destinoId).maybeSingle();
  if (erroDestino) return { tipo: "falhou", motivo: `não foi possível conferir a campanha de destino (${erroDestino.message})` };
  if (!destino) return { tipo: "bloqueada", motivo: "Campanha de destino não existe mais." };
  if ((destino as { arquivada: boolean }).arquivada) return { tipo: "bloqueada", motivo: "Campanha de destino está arquivada." };
  if (!grupoIds.length) return { tipo: "ok", movidos: 0 };
  const { data: ultimo, error: erroUltimo } = await db.from("grupos").select("numero").eq("campanha_id", destinoId).order("numero", { ascending: false }).limit(1).maybeSingle();
  if (erroUltimo) return { tipo: "falhou", motivo: `não foi possível ler os números da campanha de destino (${erroUltimo.message})` };
  // Mesma numeração da criação (`inicio_contagem` da campanha de destino; padrão 1 = o maior + 1, como antes).
  const inicio = (destino as { inicio_contagem?: unknown }).inicio_contagem;
  let numero = proximoNumero((ultimo as { numero: number } | null)?.numero ?? null, typeof inicio === "number" && inicio >= 0 ? inicio : 1) - 1;
  let movidos = 0;
  for (const id of grupoIds) {
    numero++;
    const { error } = await db.from("grupos").update({ campanha_id: destinoId, numero }).eq("id", id).eq("campanha_id", v.campanha_id);
    if (error) return { tipo: "falhou", motivo: `${movidos} grupo(s) movido(s); falhou ao mover o grupo ${id} (${error.message})` };
    movidos++;
  }
  return { tipo: "ok", movidos };
}
