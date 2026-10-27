import type {
  ConteudoAdmin,
  ConteudoConfiguracao,
  ConteudoDescricao,
  ConteudoEnquete,
  ConteudoImagem,
  ConteudoMensagem,
  ConteudoNome,
  ConteudoPrivacidade,
  ConteudoRemoverParticipantes,
  TipoExecucao,
} from "../regras/conteudo";
import type { ConteudoV2, MensagemV2, OpcaoTemporarias } from "../regras/conteudo-v2";
import { corpoEnvio, rotaEnvio } from "../regras/espacamento";
import { fotoPosta } from "../regras/foto";
import { erroDaImagemNoZapbot } from "../regras/imagem-grupo";
import { trocarN } from "../regras/nome-grupo";
import { variantesTelefone } from "../telefone";
import { ZapbotError, type ZapbotBotao, type ZapbotClient, type ZapbotConexao } from "../zapbot/client";

export type ZapbotTarefas = Pick<
  ZapbotClient,
  | "enviar"
  | "enviarEnquete"
  | "configurarGrupo"
  | "participantes"
  | "obterGrupo"
  | "linkConvite"
  | "status"
  | "enviarFigurinha"
  | "enviarGif"
  | "enviarContato"
  | "enviarEvento"
  | "enviarBotoes"
  | "fixarMensagem"
  | "mensagensTemporarias"
  | "modoEntrada"
  | "desativarComunidade"
  | "removerParticipantes"
  | "privacidadeAvancada"
  | "trocarFoto"
>;
export type GrupoAlvo = { groupId: string; numero: number };
/** Chamado quando o grupo não existe mais no WhatsApp (número conectado, mas a rota do grupo deu 404 ou o grupo
 *  não veio): quem chama desativa o grupo e avisa. Não pode lançar (o erro da tarefa é o que importa). */
export type AoGrupoSumir = () => Promise<void>;

const GRUPO_SUMIU = "O grupo não existe mais no WhatsApp.";
/** `messageId` só existe pra mensagem e enquete (no v2, o da PRIMEIRA mensagem). `grupo`: o que mudou no grupo e
 *  precisa ir pro banco. `nota`: a tarefa foi dada como feita sem mexer no WhatsApp (ou só em parte), e por quê.
 *  `pausada`: mensagem v2 parou entre duas mensagens por falta de tempo no lote — o progresso já está salvo e a
 *  tarefa volta pra fila daqui a `esperaMs` (não é erro). `removidos`: telefones tirados do grupo (pro banco).
 *  `comunidadeDesativada`: ID da comunidade desativada (o banco solta a campanha dela). */
export type ResultadoTarefa = {
  messageId: string | null;
  /** `foto_url` (Etapa 3M, "Trocar imagem"): a imagem posta no grupo, gravada já (a conferência troca depois pela
   *  URL que o WhatsApp devolver). */
  grupo?: { nome?: string; link_convite?: string; foto_url?: string; foto_atualizada_em?: string };
  nota?: string;
  pausada?: { esperaMs: number };
  removidos?: string[];
  comunidadeDesativada?: string;
};

/** Como a tarefa grava o andamento. Tudo opcional: sem nada, mensagem v2 manda tudo de uma vez (sem salvar
 *  progresso). */
export type ContextoTarefa = {
  /** Índice da próxima mensagem v2 a mandar (`tarefas.progresso`). */
  progresso?: number;
  /** `tarefas.message_id` já salvo (o da primeira mensagem, numa retentativa). */
  messageIdInicial?: string | null;
  /** Grava `progresso = proximo` (e o messageId da primeira) ANTES da próxima mensagem. Lança se não conseguir. */
  salvarProgresso?: (proximo: number, messageIdPrimeira: string | null) => Promise<void>;
  /** Cabe esperar `esperaMs` e mandar mais uma mensagem no prazo do lote? */
  podeContinuar?: (esperaMs: number) => boolean;
  esperar?: (ms: number) => Promise<void>;
  aleatorio?: () => number;
};

/** A mensagem saiu no WhatsApp, mas o progresso não foi gravado: repetir poderia mandar de novo. Vira erro sem
 *  nova tentativa automática (mesmo espírito do "pode ter sido feita" do `pegar_tarefas`). */
export class ProgressoNaoSalvo extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProgressoNaoSalvo";
  }
}

export const NOTA_ADMIN_CONECTADO = "Número conectado no sistema: não foi rebaixado.";
export const NOTA_SEM_COMUNIDADE = "Campanha sem comunidade.";
const COMUNIDADE_SUMIU = "A comunidade não existe mais no WhatsApp.";
export const NOTA_MOVER_SO_BANCO = "Mover grupos é feito no banco ao iniciar a execução: nada a fazer no WhatsApp.";

const SEGUNDOS_TEMPORARIAS: Record<Exclude<OpcaoTemporarias, "nao">, 86400 | 604800 | 7776000> = { "24h": 86400, "7d": 604800, "90d": 7776000 };
/** Entre duas mensagens da mesma tarefa: 3–6 s com "intervalo entre mensagens", 1 s sem. */
export function esperaEntreMensagens(comIntervalo: boolean, aleatorio: () => number = Math.random): number {
  return comIntervalo ? 3000 + Math.round(aleatorio() * 3000) : 1000;
}
const LOTE_REMOVER = 50;

async function ehMembro(z: ZapbotTarefas, c: ZapbotConexao, groupId: string, telefone: string): Promise<boolean> {
  const g = await z.obterGrupo(c, groupId);
  // Erro de negócio (400 → "falha"): não tenta de novo e não marca o número como desconectado (404 marcaria).
  if (!g) throw new ZapbotError(400, GRUPO_SUMIU, {});
  const variantes = variantesTelefone(telefone);
  return g.participants.some((p) => variantes.includes(p.phone.split("@")[0]));
}

async function avisarSumico(aoGrupoSumir?: AoGrupoSumir): Promise<void> {
  try {
    await aoGrupoSumir?.();
  } catch (e) {
    console.error("[tarefa] não foi possível desativar o grupo que sumiu", e);
  }
}

/** Faz no WhatsApp o que a tarefa pede, com o conteúdo já resolvido (variáveis trocadas).
 *  Toda tarefa é num grupo: um 404 pode ser o grupo que sumiu, não o número. Se o número responde conectado, vira
 *  erro de negócio ("falha": não repete e não derruba o número) e o grupo é desativado; senão o 404 segue como está. */
export async function executarTarefa(
  z: ZapbotTarefas,
  c: ZapbotConexao,
  tipo: TipoExecucao,
  conteudo: unknown,
  g: GrupoAlvo,
  aoGrupoSumir?: AoGrupoSumir,
  /** Telefones dos números conectados (nas duas formas do nono dígito): `admin_remover` nunca rebaixa um deles e
   *  `remover_participantes` nunca remove. */
  protegidos: ReadonlySet<string> = new Set(),
  ctx: ContextoTarefa = {},
): Promise<ResultadoTarefa> {
  try {
    return await executarNoGrupo(z, c, tipo, conteudo, g, protegidos, ctx);
  } catch (e) {
    if (e instanceof ZapbotError && e.message === GRUPO_SUMIU && e.status === 400) {
      await avisarSumico(aoGrupoSumir);
      throw e;
    }
    if (!(e instanceof ZapbotError) || e.status !== 404) throw e;
    let conectado = false;
    try {
      conectado = (await z.status(c)).connected;
    } catch {
      conectado = false; // sem resposta do status: fica o 404 original (número tratado como desconectado)
    }
    if (!conectado) throw e;
    await avisarSumico(aoGrupoSumir);
    throw new ZapbotError(400, GRUPO_SUMIU, {});
  }
}

async function executarNoGrupo(
  z: ZapbotTarefas,
  c: ZapbotConexao,
  tipo: TipoExecucao,
  conteudo: unknown,
  g: GrupoAlvo,
  protegidos: ReadonlySet<string>,
  ctx: ContextoTarefa,
): Promise<ResultadoTarefa> {
  switch (tipo) {
    case "mensagem": {
      if ((conteudo as { versao?: unknown } | null)?.versao === 2) return enviarMensagensV2(z, c, conteudo as ConteudoV2, g, ctx);
      // Formato antigo: exatamente a mesma chamada de antes da Etapa 3C.
      const m = conteudo as ConteudoMensagem;
      const corpo = corpoEnvio({ tipo: m.formato, texto: m.texto, midia_url: m.midia_url, nome_arquivo: m.nome_arquivo, mencionar_todos: m.mencionar_todos }, g.groupId);
      return { messageId: await z.enviar(c, rotaEnvio(m.formato, m.nome_arquivo), corpo) };
    }
    case "enquete": {
      const e = conteudo as ConteudoEnquete;
      return { messageId: await z.enviarEnquete(c, g.groupId, e.pergunta, e.opcoes, e.max_respostas) };
    }
    case "nome": {
      const k = conteudo as ConteudoNome;
      const nome = trocarN(k.padrao, g.numero, typeof k.caractere === "string" ? k.caractere : "");
      await z.configurarGrupo(c, { groupId: g.groupId, name: nome });
      return { messageId: null, grupo: { nome } };
    }
    case "descricao":
      await z.configurarGrupo(c, { groupId: g.groupId, description: (conteudo as ConteudoDescricao).texto });
      return { messageId: null };
    case "abrir":
      await z.configurarGrupo(c, { groupId: g.groupId, announce: false });
      return { messageId: null };
    case "fechar":
      await z.configurarGrupo(c, { groupId: g.groupId, announce: true });
      return { messageId: null };
    case "admin_add": {
      const { telefone } = conteudo as ConteudoAdmin;
      if (!(await ehMembro(z, c, g.groupId, telefone))) await z.participantes(c, g.groupId, [telefone], "add");
      await z.participantes(c, g.groupId, [telefone], "promote");
      return { messageId: null };
    }
    case "admin_remover": {
      const { telefone } = conteudo as ConteudoAdmin;
      if (variantesTelefone(telefone).some((v) => protegidos.has(v))) return { messageId: null, nota: NOTA_ADMIN_CONECTADO };
      if (await ehMembro(z, c, g.groupId, telefone)) await z.participantes(c, g.groupId, [telefone], "demote");
      return { messageId: null };
    }
    case "redefinir_link": {
      const link = await z.linkConvite(c, g.groupId, true);
      return { messageId: null, grupo: { link_convite: link } };
    }
    case "configuracao": {
      const k = conteudo as ConteudoConfiguracao;
      const ajustes: { groupId: string; announce?: boolean; locked?: boolean } = { groupId: g.groupId };
      if (typeof k.so_admins_enviam === "boolean") ajustes.announce = k.so_admins_enviam;
      if (typeof k.so_admins_editam === "boolean") ajustes.locked = k.so_admins_editam;
      if (ajustes.announce !== undefined || ajustes.locked !== undefined) await z.configurarGrupo(c, ajustes);
      if (typeof k.aprovacao_entrada === "boolean") await z.modoEntrada(c, g.groupId, k.aprovacao_entrada);
      // Troca explícita (diferente da opção de envio de mensagens v2, que só liga): "nao" desliga as temporárias.
      if (k.temporarias !== undefined) await z.mensagensTemporarias(c, g.groupId, k.temporarias === "nao" ? 0 : SEGUNDOS_TEMPORARIAS[k.temporarias]);
      return { messageId: null };
    }
    case "remover_participantes":
      return removerParticipantes(z, c, (conteudo as ConteudoRemoverParticipantes).telefones ?? [], g, protegidos);
    case "desativar_comunidade": {
      // Uma tarefa só por execução (criada no início, no grupo de menor número): o alvo é a comunidade da campanha.
      const comunidade = (conteudo as { comunidade_id?: unknown } | null)?.comunidade_id;
      if (typeof comunidade !== "string" || !comunidade) return { messageId: null, nota: NOTA_SEM_COMUNIDADE };
      try {
        await z.desativarComunidade(c, comunidade);
      } catch (e) {
        // 404 aqui é a comunidade, não o grupo da tarefa: não pode cair no "grupo sumiu" (desativaria o grupo).
        if (!(e instanceof ZapbotError) || e.status !== 404) throw e;
        const conectado = await z.status(c).then((s) => s.connected, () => false);
        if (!conectado) throw e;
        throw new ZapbotError(400, COMUNIDADE_SUMIU, {});
      }
      return { messageId: null, comunidadeDesativada: comunidade };
    }
    case "atualizar_links": {
      const link = await z.linkConvite(c, g.groupId);
      return { messageId: null, grupo: { link_convite: link } };
    }
    case "mover_grupos":
      return { messageId: null, nota: NOTA_MOVER_SO_BANCO };
    case "privacidade_avancada":
      await z.privacidadeAvancada(c, g.groupId, (conteudo as ConteudoPrivacidade).valor === true);
      return { messageId: null };
    case "imagem": {
      // `PUT group-picture` (rota própria: falha da foto nunca mexe em nome/descrição). 404 cai no "grupo sumiu" acima.
      const { url } = conteudo as ConteudoImagem;
      try {
        await z.trocarFoto(c, g.groupId, url);
      } catch (e) {
        // Imagem recusada (pequena demais, ilegível) vem como 502: sem isto a fila repetiria à toa. Vira erro
        // definitivo (400) com a regra da imagem; qualquer outro erro segue igual.
        const clara = e instanceof ZapbotError ? erroDaImagemNoZapbot(e.message) : null;
        if (clara) throw new ZapbotError(400, clara, e instanceof ZapbotError ? e.body : {});
        throw e;
      }
      // Com o instante (`fotoPosta`): a carência de 24 h protege a foto recém-posta na conferência.
      return { messageId: null, grupo: fotoPosta(url, new Date().toISOString()) };
    }
  }
}

/** Remove os telefones do grupo, conferindo na lista ATUAL do WhatsApp (GET do grupo): nunca remove número
 *  conectado no sistema nem admin (mesmas regras de `executarRemover`), e pula quem já não está. */
async function removerParticipantes(z: ZapbotTarefas, c: ZapbotConexao, telefones: string[], g: GrupoAlvo, protegidos: ReadonlySet<string>): Promise<ResultadoTarefa> {
  const grupo = await z.obterGrupo(c, g.groupId);
  if (!grupo) throw new ZapbotError(400, GRUPO_SUMIU, {});
  const membros = new Map(grupo.participants.map((p) => [p.phone.split("@")[0], p]));
  const remover: string[] = [];
  let conectados = 0;
  let admins = 0;
  let fora = 0;
  for (const t of new Set(telefones)) {
    const variantes = variantesTelefone(t);
    if (variantes.some((v) => protegidos.has(v))) {
      conectados++;
      continue;
    }
    const achado = variantes.map((v) => (membros.has(v) ? v : null)).find((v) => v !== null) ?? null;
    if (!achado) {
      fora++;
      continue;
    }
    if (membros.get(achado)!.isAdmin) {
      admins++;
      continue;
    }
    if (!remover.includes(achado)) remover.push(achado);
  }
  const removidos: string[] = [];
  let recusados = 0;
  for (let i = 0; i < remover.length; i += LOTE_REMOVER) {
    const lote = remover.slice(i, i + LOTE_REMOVER);
    const saiu = await z.removerParticipantes(c, g.groupId, lote);
    // Resposta sem resultado por número (formato não documentado): considera o lote todo removido, como antes.
    const ok = saiu === null ? lote : lote.filter((t) => variantesTelefone(t).some((v) => saiu.includes(v)));
    recusados += lote.length - ok.length;
    removidos.push(...ok);
  }
  const partes = [
    `${removidos.length} removido(s)`,
    conectados ? `${conectados} número(s) conectado(s) no sistema não removido(s)` : "",
    admins ? `${admins} admin(s) não removido(s)` : "",
    fora ? `${fora} já fora do grupo` : "",
    recusados ? `${recusados} recusado(s) pelo WhatsApp` : "",
  ].filter(Boolean);
  return { messageId: null, removidos, ...(partes.length > 1 || !removidos.length ? { nota: partes.join("; ") + "." } : {}) };
}

function botaoZapbot(b: { tipo: string; rotulo: string; valor: string }): ZapbotBotao {
  switch (b.tipo) {
    case "link":
      return { type: "URL", label: b.rotulo, url: b.valor };
    case "ligar":
      return { type: "CALL", label: b.rotulo, phone: b.valor.replace(/\D/g, "") };
    case "copiar":
      return { type: "COPY", label: b.rotulo, copyCode: b.valor };
    default:
      return { type: "REPLY", id: b.valor, label: b.rotulo };
  }
}

const segundosUnix = (iso: string) => Math.floor(Date.parse(iso) / 1000);

/** Uma mensagem v2 no grupo. `mencionar_todos` vale pras de texto (como no formato antigo). */
async function enviarUma(z: ZapbotTarefas, c: ZapbotConexao, m: MensagemV2, groupId: string, mencionarTodos: boolean): Promise<string> {
  switch (m.formato) {
    case "texto":
      return z.enviar(c, "send-text", corpoEnvio({ tipo: "texto", texto: m.texto, midia_url: null, nome_arquivo: null, mencionar_todos: mencionarTodos }, groupId));
    case "imagem":
    case "video":
    case "audio":
    case "documento":
      return z.enviar(
        c,
        rotaEnvio(m.formato, m.nome_arquivo),
        corpoEnvio({ tipo: m.formato, texto: m.formato === "audio" ? "" : m.legenda, midia_url: m.midia_url, nome_arquivo: m.nome_arquivo, mencionar_todos: false }, groupId),
      );
    case "gif":
      return z.enviarGif(c, groupId, m.midia_url, m.legenda);
    case "figurinha":
      return z.enviarFigurinha(c, groupId, m.midia_url);
    case "contato":
      return z.enviarContato(c, groupId, m.contato.nome, m.contato.telefone);
    case "evento":
      return z.enviarEvento(c, groupId, {
        nome: m.evento.nome,
        descricao: m.evento.descricao,
        inicio: segundosUnix(m.evento.inicio),
        fim: m.evento.fim ? segundosUnix(m.evento.fim) : null,
        local: m.evento.local,
      });
    case "botoes":
      return z.enviarBotoes(c, groupId, m.texto, m.botoes.map(botaoZapbot));
    case "enquete":
      return z.enviarEnquete(c, groupId, m.enquete.pergunta, m.enquete.opcoes, m.enquete.max_respostas);
  }
}

/** Várias mensagens em ordem, a partir de `ctx.progresso`. Depois de cada envio grava o progresso (e o messageId
 *  da primeira) antes de seguir: uma retentativa nunca manda de novo o que já saiu. Sem tempo no lote pra esperar
 *  o intervalo e mandar a próxima, devolve `pausada` (progresso salvo, a tarefa volta pra fila). Temporárias são
 *  ligadas antes da primeira; a primeira é fixada no fim (falha ao fixar vira nota, as mensagens já saíram). */
async function enviarMensagensV2(z: ZapbotTarefas, c: ZapbotConexao, conteudo: ConteudoV2, g: GrupoAlvo, ctx: ContextoTarefa): Promise<ResultadoTarefa> {
  const mensagens = conteudo.mensagens ?? [];
  const o = conteudo.opcoes;
  const inicio = Math.max(0, ctx.progresso ?? 0);
  let primeira = ctx.messageIdInicial ?? null;
  const esperar = ctx.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  if (inicio === 0 && o.temporarias !== "nao") await z.mensagensTemporarias(c, g.groupId, SEGUNDOS_TEMPORARIAS[o.temporarias]);

  for (let i = inicio; i < mensagens.length; i++) {
    if (i > inicio) {
      const espera = esperaEntreMensagens(o.intervalo_mensagens, ctx.aleatorio);
      if (ctx.podeContinuar && !ctx.podeContinuar(espera)) return { messageId: primeira, pausada: { esperaMs: espera } };
      await esperar(espera);
    }
    const id = await enviarUma(z, c, mensagens[i], g.groupId, o.mencionar_todos);
    if (i === 0) primeira = id;
    if (ctx.salvarProgresso) {
      try {
        await ctx.salvarProgresso(i + 1, primeira);
      } catch (e) {
        const motivo = e instanceof Error ? e.message : String(e);
        throw new ProgressoNaoSalvo(
          `Mensagem ${i + 1} de ${mensagens.length} enviada, mas o progresso não foi salvo (${motivo}). Pode ter sido feita: confira no grupo antes de repetir.`,
        );
      }
    }
  }

  if (o.fixar !== "nao" && primeira) {
    try {
      await z.fixarMensagem(c, g.groupId, primeira, o.fixar);
    } catch (e) {
      return { messageId: primeira, nota: `Mensagens enviadas, mas não foi possível fixar a primeira: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  return { messageId: primeira };
}
