import { normalizarTelefone } from "../telefone";

/** Conteúdo v2 de mensagens (Etapa 3C): várias mensagens por ação, formatos novos (contato, evento, botões,
 *  figurinha, gif, enquete embutida) e opções de envio (menção, temporárias, fixar, intervalos). Módulo puro —
 *  sem I/O, sem depender de `conteudo.ts` (é `conteudo.ts` que depende daqui, pra "mensagem" aceitar v1 e v2). */

export const FORMATOS_V2 = ["texto", "imagem", "video", "gif", "audio", "documento", "figurinha", "contato", "evento", "botoes", "enquete"] as const;
export type FormatoMensagemV2 = (typeof FORMATOS_V2)[number];

const FORMATOS_MIDIA: readonly FormatoMensagemV2[] = ["imagem", "video", "gif", "audio", "documento", "figurinha"];

export const TIPOS_BOTAO = ["resposta", "link", "ligar", "copiar"] as const;
export type TipoBotao = (typeof TIPOS_BOTAO)[number];
/** Tipos que dá pra escolher hoje. "copiar" fica de fora até o campo do Zapbot ser testado (a doc lista o tipo COPY
 *  mas não o campo do texto copiado). */
export const TIPOS_BOTAO_DISPONIVEIS: readonly TipoBotao[] = ["resposta", "link", "ligar"];
export type BotaoV2 = { tipo: TipoBotao; rotulo: string; valor: string };

export type MensagemTextoV2 = { formato: "texto"; texto: string };
export type MensagemMidiaV2 = { formato: "imagem" | "video" | "gif" | "audio" | "documento" | "figurinha"; midia_url: string; nome_arquivo: string | null; legenda: string };
export type MensagemContatoV2 = { formato: "contato"; contato: { nome: string; telefone: string } };
export type MensagemEventoV2 = { formato: "evento"; evento: { nome: string; descricao: string | null; inicio: string; fim: string | null; local: string | null } };
export type MensagemBotoesV2 = { formato: "botoes"; texto: string; botoes: BotaoV2[] };
export type MensagemEnqueteV2 = { formato: "enquete"; enquete: { pergunta: string; opcoes: string[]; max_respostas: number } };

export type MensagemV2 = MensagemTextoV2 | MensagemMidiaV2 | MensagemContatoV2 | MensagemEventoV2 | MensagemBotoesV2 | MensagemEnqueteV2;

export const OPCOES_TEMPORARIAS = ["nao", "24h", "7d", "90d"] as const;
export type OpcaoTemporarias = (typeof OPCOES_TEMPORARIAS)[number];

export const OPCOES_FIXAR = ["nao", "24h", "7d", "30d"] as const;
export type OpcaoFixar = (typeof OPCOES_FIXAR)[number];

export const PRESETS_INTERVALO = ["nao", "rapida", "normal", "lenta"] as const;
export type PresetIntervaloGrupos = (typeof PRESETS_INTERVALO)[number];
export type IntervaloGrupos = PresetIntervaloGrupos | { segundos: number };

export type OpcoesEnvio = {
  mencionar_todos: boolean;
  temporarias: OpcaoTemporarias;
  fixar: OpcaoFixar;
  intervalo_grupos: IntervaloGrupos;
  intervalo_mensagens: boolean;
};

export type ConteudoV2 = { versao: 2; mensagens: MensagemV2[]; opcoes: OpcoesEnvio };

export const OPCOES_ENVIO_PADRAO: OpcoesEnvio = {
  mencionar_todos: false,
  temporarias: "nao",
  fixar: "nao",
  intervalo_grupos: "nao",
  intervalo_mensagens: false,
};

/** `ConteudoV2` inicial do editor de mensagens: nenhuma mensagem ainda (o "SALVAR" do editor adiciona a
 *  primeira), opções padrão. */
export function conteudoV2Vazio(): ConteudoV2 {
  return { versao: 2, mensagens: [], opcoes: { ...OPCOES_ENVIO_PADRAO } };
}

/** Faixa em segundos de cada preset de intervalo entre grupos. `"nao"` devolve `null` — espaçamento atual do
 *  sistema (ver `espacamento.ts`), não um valor fixo daqui. Custom é fixo (min = max), travado em 1–600s. */
export function segundosEntreGrupos(opcao: IntervaloGrupos): { min: number; max: number } | null {
  if (opcao === "nao") return null;
  // "rapida" = o mínimo que o job já garante entre tarefas do mesmo número (3–8 s, `liberarNumero`).
  if (opcao === "rapida") return { min: 3, max: 8 };
  if (opcao === "normal") return { min: 5, max: 10 };
  if (opcao === "lenta") return { min: 15, max: 30 };
  const segundos = Math.min(600, Math.max(1, Math.round(opcao.segundos)));
  return { min: segundos, max: segundos };
}

/** Texto de uma mensagem "texto" com `@all` quando marca todos (mesma regra de `espacamento.ts#corpoEnvio`). */
export function textoComMencao(texto: string, mencionarTodos: boolean): string {
  return mencionarTodos ? `${texto} @all`.trim() : texto;
}

type ConteudoMensagemAntigo = { formato: string; texto: string; midia_url: string | null; nome_arquivo: string | null; mencionar_todos: boolean };
type ConteudoEnqueteAntigo = { pergunta: string; opcoes: string[]; max_respostas: number };

function ehV2(v: unknown): v is ConteudoV2 {
  return !!v && typeof v === "object" && (v as Record<string, unknown>).versao === 2;
}

function pareceEnqueteAntiga(v: Record<string, unknown>): v is ConteudoEnqueteAntigo {
  return "pergunta" in v || "opcoes" in v;
}

/** Converte o formato antigo de "mensagem" (`ConteudoMensagem`) ou "enquete" (`ConteudoEnquete`) para v2. Se já for
 *  v2, devolve como está (sem revalidar — use `validarConteudoV2` pra isso). Função pura, não lança. */
export function paraV2(conteudoAntigoOuV2: unknown): ConteudoV2 {
  if (ehV2(conteudoAntigoOuV2)) return conteudoAntigoOuV2;
  const c = (conteudoAntigoOuV2 && typeof conteudoAntigoOuV2 === "object" ? conteudoAntigoOuV2 : {}) as Record<string, unknown>;

  if (pareceEnqueteAntiga(c)) {
    const e = c as unknown as ConteudoEnqueteAntigo;
    const mensagem: MensagemEnqueteV2 = {
      formato: "enquete",
      enquete: { pergunta: e.pergunta ?? "", opcoes: Array.isArray(e.opcoes) ? e.opcoes : [], max_respostas: e.max_respostas ?? 1 },
    };
    return { versao: 2, mensagens: [mensagem], opcoes: { ...OPCOES_ENVIO_PADRAO } };
  }

  const m = c as unknown as Partial<ConteudoMensagemAntigo>;
  const formato = (m.formato ?? "texto") as FormatoMensagemV2;
  const mencionarTodos = m.mencionar_todos === true;
  const mensagem: MensagemV2 = FORMATOS_MIDIA.includes(formato)
    ? { formato: formato as MensagemMidiaV2["formato"], midia_url: m.midia_url ?? "", nome_arquivo: m.nome_arquivo ?? null, legenda: m.texto ?? "" }
    : { formato: "texto", texto: m.texto ?? "" };
  return { versao: 2, mensagens: [mensagem], opcoes: { ...OPCOES_ENVIO_PADRAO, mencionar_todos: mencionarTodos } };
}

export type ValidacaoConteudoV2 = { ok: true; valor: ConteudoV2 } | { ok: false; erro: string };

const MAX_TEXTO = 4096;
const MAX_LEGENDA = 1024;

function ehHttps(v: unknown): v is string {
  return typeof v === "string" && /^https:\/\//i.test(v);
}

function ehIso(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "" && !Number.isNaN(Date.parse(v));
}

function validarMensagem(bruto: unknown, i: number): { ok: true; valor: MensagemV2 } | { ok: false; erro: string } {
  const m = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  const formato = m.formato as FormatoMensagemV2;
  const prefixo = `Mensagem ${i + 1}:`;
  if (!FORMATOS_V2.includes(formato)) return { ok: false, erro: `${prefixo} escolha o tipo da mensagem.` };

  if (formato === "texto") {
    const texto = typeof m.texto === "string" ? m.texto : "";
    if (!texto.trim()) return { ok: false, erro: `${prefixo} escreva o texto.` };
    if (Array.from(texto).length > MAX_TEXTO) return { ok: false, erro: `${prefixo} o texto vai até ${MAX_TEXTO} caracteres.` };
    return { ok: true, valor: { formato: "texto", texto } };
  }

  if (FORMATOS_MIDIA.includes(formato)) {
    const midiaUrl = m.midia_url;
    if (!ehHttps(midiaUrl)) return { ok: false, erro: `${prefixo} envie o arquivo (URL https).` };
    const legenda = typeof m.legenda === "string" ? m.legenda : "";
    if (Array.from(legenda).length > MAX_LEGENDA) return { ok: false, erro: `${prefixo} a legenda vai até ${MAX_LEGENDA} caracteres.` };
    const nomeArquivo = typeof m.nome_arquivo === "string" ? m.nome_arquivo : null;
    return { ok: true, valor: { formato: formato as MensagemMidiaV2["formato"], midia_url: midiaUrl, nome_arquivo: nomeArquivo, legenda } };
  }

  if (formato === "contato") {
    const contato = (m.contato && typeof m.contato === "object" ? m.contato : {}) as Record<string, unknown>;
    const nome = typeof contato.nome === "string" ? contato.nome.trim() : "";
    const telefone = normalizarTelefone(typeof contato.telefone === "string" ? contato.telefone : "");
    if (!nome) return { ok: false, erro: `${prefixo} escreva o nome do contato.` };
    if (!telefone) return { ok: false, erro: `${prefixo} telefone do contato inválido.` };
    return { ok: true, valor: { formato: "contato", contato: { nome, telefone } } };
  }

  if (formato === "evento") {
    const evento = (m.evento && typeof m.evento === "object" ? m.evento : {}) as Record<string, unknown>;
    const nome = typeof evento.nome === "string" ? evento.nome.trim() : "";
    if (!nome) return { ok: false, erro: `${prefixo} escreva o nome do evento.` };
    if (!ehIso(evento.inicio)) return { ok: false, erro: `${prefixo} data de início do evento inválida.` };
    if (evento.fim !== undefined && evento.fim !== null && !ehIso(evento.fim)) return { ok: false, erro: `${prefixo} data de fim do evento inválida.` };
    const descricao = typeof evento.descricao === "string" ? evento.descricao : null;
    const local = typeof evento.local === "string" ? evento.local : null;
    const fim = typeof evento.fim === "string" ? evento.fim : null;
    return { ok: true, valor: { formato: "evento", evento: { nome, descricao, inicio: evento.inicio as string, fim, local } } };
  }

  if (formato === "botoes") {
    const texto = typeof m.texto === "string" ? m.texto : "";
    if (!texto.trim()) return { ok: false, erro: `${prefixo} escreva o texto da mensagem.` };
    const brutos = Array.isArray(m.botoes) ? m.botoes : [];
    if (brutos.length < 1 || brutos.length > 3) return { ok: false, erro: `${prefixo} de 1 a 3 botões.` };
    const botoes: BotaoV2[] = [];
    for (const b of brutos) {
      const bb = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
      const tipo = bb.tipo as TipoBotao;
      const rotulo = typeof bb.rotulo === "string" ? bb.rotulo.trim() : "";
      const valor = typeof bb.valor === "string" ? bb.valor.trim() : "";
      if (!TIPOS_BOTAO.includes(tipo)) return { ok: false, erro: `${prefixo} tipo de botão inválido.` };
      if (tipo === "copiar") return { ok: false, erro: "Botão de copiar ainda não está disponível." };
      if (!rotulo) return { ok: false, erro: `${prefixo} escreva o rótulo do botão.` };
      if (!valor) return { ok: false, erro: `${prefixo} preencha o valor do botão.` };
      if (tipo === "link" && !ehHttps(valor)) return { ok: false, erro: `${prefixo} o link do botão precisa ser https.` };
      botoes.push({ tipo, rotulo, valor });
    }
    return { ok: true, valor: { formato: "botoes", texto, botoes } };
  }

  // enquete
  const enquete = (m.enquete && typeof m.enquete === "object" ? m.enquete : {}) as Record<string, unknown>;
  const pergunta = typeof enquete.pergunta === "string" ? enquete.pergunta.trim() : "";
  const opcoes = (Array.isArray(enquete.opcoes) ? enquete.opcoes : []).map((o) => String(o).trim()).filter(Boolean);
  const max = Number(enquete.max_respostas);
  if (!pergunta) return { ok: false, erro: `${prefixo} escreva a pergunta da enquete.` };
  if (opcoes.length < 2 || opcoes.length > 12) return { ok: false, erro: `${prefixo} a enquete precisa de 2 a 12 opções.` };
  if (new Set(opcoes).size !== opcoes.length) return { ok: false, erro: `${prefixo} as opções da enquete não podem se repetir.` };
  if (!Number.isInteger(max) || max < 1 || max > opcoes.length) return { ok: false, erro: `${prefixo} o máximo de respostas vai de 1 a ${opcoes.length}.` };
  return { ok: true, valor: { formato: "enquete", enquete: { pergunta, opcoes, max_respostas: max } } };
}

function validarOpcoes(bruto: unknown): { ok: true; valor: OpcoesEnvio } | { ok: false; erro: string } {
  const o = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  const temporarias = (o.temporarias ?? "nao") as OpcaoTemporarias;
  const fixar = (o.fixar ?? "nao") as OpcaoFixar;
  if (!OPCOES_TEMPORARIAS.includes(temporarias)) return { ok: false, erro: "Opção de mensagens temporárias inválida." };
  if (!OPCOES_FIXAR.includes(fixar)) return { ok: false, erro: "Opção de fixar mensagem inválida." };

  const intervaloBruto = o.intervalo_grupos ?? "nao";
  let intervalo_grupos: IntervaloGrupos;
  if (typeof intervaloBruto === "string") {
    if (!PRESETS_INTERVALO.includes(intervaloBruto as PresetIntervaloGrupos)) return { ok: false, erro: "Intervalo de envio entre grupos inválido." };
    intervalo_grupos = intervaloBruto as PresetIntervaloGrupos;
  } else {
    const segundos = Number((intervaloBruto as Record<string, unknown>)?.segundos);
    if (!Number.isFinite(segundos) || segundos < 1 || segundos > 600) return { ok: false, erro: "O intervalo customizado vai de 1 a 600 segundos." };
    intervalo_grupos = { segundos };
  }

  return {
    ok: true,
    valor: {
      mencionar_todos: o.mencionar_todos === true,
      temporarias,
      fixar,
      intervalo_grupos,
      intervalo_mensagens: o.intervalo_mensagens === true,
    },
  };
}

/** Linha curta pra representar uma mensagem v2 em listas, calendário e título do card de Ações — cada formato
 *  resume no que tem de mais específico (texto, legenda, nome, pergunta…). Server-safe. */
export function resumoMensagemV2(m: MensagemV2): string {
  switch (m.formato) {
    case "texto":
      return m.texto;
    case "contato":
      return m.contato.nome;
    case "evento":
      return m.evento.nome;
    case "botoes":
      return m.texto;
    case "enquete":
      return m.enquete.pergunta;
    default:
      return m.legenda || `(${m.formato})`;
  }
}

/** Confere e limpa um `ConteudoV2` bruto: 1 a 10 mensagens, cada uma válida pro seu formato, e opções de envio
 *  válidas. Não resolve variáveis (feito ao iniciar a execução, como no v1). */
export function validarConteudoV2(bruto: unknown): ValidacaoConteudoV2 {
  const c = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  const mensagensBrutas = Array.isArray(c.mensagens) ? c.mensagens : [];
  if (mensagensBrutas.length < 1 || mensagensBrutas.length > 10) return { ok: false, erro: "De 1 a 10 mensagens por ação." };

  const mensagens: MensagemV2[] = [];
  for (let i = 0; i < mensagensBrutas.length; i++) {
    const r = validarMensagem(mensagensBrutas[i], i);
    if (!r.ok) return r;
    mensagens.push(r.valor);
  }

  const opcoes = validarOpcoes(c.opcoes);
  if (!opcoes.ok) return opcoes;

  return { ok: true, valor: { versao: 2, mensagens, opcoes: opcoes.valor } };
}
