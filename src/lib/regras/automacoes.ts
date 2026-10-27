import { PROVEDORES, type Provedor } from "../checkout/parsers";
import { ICONE_ACAO } from "./acoes";
import { validarConteudo, type TipoExecucao } from "./conteudo";
import { ehUuid } from "./uuid";

export const GATILHOS = ["cronograma", "grupo_criado", "grupo_cheio", "entrou", "saiu", "checkout"] as const;
export type Gatilho = (typeof GATILHOS)[number];

export const ROTULO_GATILHO: Record<Gatilho, string> = {
  cronograma: "Cronograma de disparo",
  grupo_criado: "Criar Grupo na Campanha",
  grupo_cheio: "Encher Grupo da Campanha",
  entrou: "Participante entrar no grupo",
  saiu: "Participante sair do grupo",
  checkout: "Checkout - Compra aprovada",
};

/** Nome do checkout pra mostrar na tela (assistente de automações e lista). */
export const ROTULO_PROVEDOR: Record<Provedor, string> = { vortex: "Checkout próprio", pagarme: "Pagar.me", hotmart: "Hotmart", kiwify: "Kiwify" };

/** Eventos de venda que o gatilho de checkout aceita. Só "aprovada": a venda guarda `aprovada` (true/false) e uma
 *  não aprovada pode ser recusa, estorno, boleto gerado etc. (os parsers não separam), então "recusada" fica
 *  reservada no banco (`automacoes.checkout_evento`) e ainda não é aceita aqui. */
export const EVENTOS_CHECKOUT = ["aprovada"] as const;
export type EventoCheckout = (typeof EVENTOS_CHECKOUT)[number];

/** Ordem de exibição dos gatilhos de campanha no assistente de automação: "Cronograma de
 *  disparo", "Encher Grupo da Campanha", "Criar Grupo na Campanha", "Participante sair do grupo", "Participante
 *  entrar no grupo" — só a ordem na tela; `GATILHOS` (e a validação/JSON que usam) não muda. */
export const ORDEM_GATILHOS_ASSISTENTE: readonly Gatilho[] = ["cronograma", "grupo_cheio", "grupo_criado", "saiu", "entrou"];

/** Gatilhos de checkout por plataforma, na ordem do assistente. `provedor` null = qualquer plataforma (o gatilho
 *  "Checkout - Compra aprovada" de sempre); com plataforma, só as vendas dela disparam. */
export const GATILHOS_CHECKOUT: { provedor: Provedor | null; rotulo: string }[] = [
  { provedor: null, rotulo: ROTULO_GATILHO.checkout },
  { provedor: "hotmart", rotulo: "Hotmart - Compra aprovada" },
  { provedor: "kiwify", rotulo: "Kiwify - Compra aprovada" },
  { provedor: "pagarme", rotulo: "Pagar.me - Compra aprovada" },
  { provedor: "vortex", rotulo: "Checkout próprio - Compra aprovada" },
];

/** Rótulo do gatilho de uma automação: no checkout, com o nome da plataforma ("Hotmart - Compra aprovada"). */
export function rotuloGatilho(gatilho: Gatilho, provedor?: string | null): string {
  if (gatilho !== "checkout" || !provedor) return ROTULO_GATILHO[gatilho];
  return GATILHOS_CHECKOUT.find((g) => g.provedor === provedor)?.rotulo ?? ROTULO_GATILHO.checkout;
}

/** O que uma ação de automação pode fazer: os tipos de execução (TipoExecucao, incluindo as ações de grupo da
 *  fase de massa e as da Etapa 3C), "remover participante" (vira uma linha na fila de remoções, não uma execução),
 *  "Tag Condicional" (não vira nada: decide se as ações seguintes são criadas pra pessoa do gatilho) e as ações de
 *  pessoa da Etapa 3J (tags e blacklist: aplicadas na hora pelo motor, sem execução nem remoção). */
export const TIPOS_ACAO_AUTOMACAO = [
  "mensagem", "enquete", "nome", "descricao", "abrir", "fechar", "admin_add", "admin_remover", "redefinir_link", "remover_participante",
  "configuracao", "atualizar_links", "desativar_comunidade", "mover_grupos", "tag_condicional",
  "adicionar_tag", "remover_tag", "adicionar_blacklist", "remover_blacklist", "imagem",
] as const;
export type TipoAcaoAutomacao = (typeof TIPOS_ACAO_AUTOMACAO)[number];

/** Ações de pessoa (Etapa 3J): mexem nas tags ou nas blacklists da pessoa do gatilho, na hora (atraso sempre 0). */
export const TIPOS_ACAO_PESSOA = ["adicionar_tag", "remover_tag", "adicionar_blacklist", "remover_blacklist"] as const;
export type TipoAcaoPessoa = (typeof TIPOS_ACAO_PESSOA)[number];

export function ehAcaoDePessoa(t: string): t is TipoAcaoPessoa {
  return (TIPOS_ACAO_PESSOA as readonly string[]).includes(t);
}

/** Conteúdo das ações de tag e de blacklist. */
export type ConteudoAcaoTag = { tag_id: string };
export type ConteudoAcaoBlacklist = { blacklist_id: string };

/** Valida o conteúdo de uma ação de pessoa: `{ tag_id }` nas de tag, `{ blacklist_id }` nas de blacklist (só o id,
 *  qualquer outro campo sai). Se a tag é `manual` e se a blacklist existe, quem confere é o servidor (banco). */
export function validarAcaoDePessoa(tipo: TipoAcaoPessoa, bruto: unknown): { ok: true; valor: ConteudoAcaoTag | ConteudoAcaoBlacklist } | { ok: false; erro: string } {
  const c = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  if (tipo === "adicionar_tag" || tipo === "remover_tag") {
    if (!ehUuid(c.tag_id)) return { ok: false, erro: "Escolha a tag." };
    return { ok: true, valor: { tag_id: c.tag_id } };
  }
  if (!ehUuid(c.blacklist_id)) return { ok: false, erro: "Escolha a blacklist." };
  return { ok: true, valor: { blacklist_id: c.blacklist_id } };
}

/** Tag ou blacklist que uma ação de pessoa usa (null pra outras ações ou conteúdo sem id válido). */
export function alvoDaAcaoDePessoa(a: { tipo: string; conteudo: unknown }): { tipo: "tag" | "blacklist"; id: string } | null {
  if (!ehAcaoDePessoa(a.tipo)) return null;
  const c = (a.conteudo && typeof a.conteudo === "object" ? a.conteudo : {}) as Record<string, unknown>;
  const id = a.tipo === "adicionar_tag" || a.tipo === "remover_tag" ? c.tag_id : c.blacklist_id;
  if (!ehUuid(id)) return null;
  return { tipo: a.tipo === "adicionar_tag" || a.tipo === "remover_tag" ? "tag" : "blacklist", id };
}

/** Texto de uma ação de pessoa na confirmação e na lista: "Adicionar tag: {nome}" (nome que sumiu = "(apagada)"). */
export function textoAcaoDePessoa(tipo: TipoAcaoPessoa, nome: string | null | undefined): string {
  return `${ROTULO_ACAO[tipo]}: ${nome ?? "(apagada)"}`;
}

/** Rótulos das ações. */
export const ROTULO_ACAO: Record<TipoAcaoAutomacao, string> = {
  mensagem: "Enviar mensagem",
  enquete: "Enviar enquete",
  nome: "Atualizar assunto do grupo",
  descricao: "Atualizar descrição do grupo",
  configuracao: "Atualizar configurações do grupo",
  atualizar_links: "Atualizar links dos grupos",
  redefinir_link: "Redefinir link de convite",
  fechar: "Fechar Grupos",
  abrir: "Abrir Grupos",
  admin_add: "Tornar administrador do grupo",
  admin_remover: "Remover administrador do grupo",
  remover_participante: "Remover Lead",
  desativar_comunidade: "Desativar comunidade",
  tag_condicional: "Tag Condicional",
  mover_grupos: "Mover grupos para outra campanha",
  adicionar_tag: "Adicionar tag",
  remover_tag: "Remover tag",
  adicionar_blacklist: "Adicionar à blacklist",
  remover_blacklist: "Remover da blacklist",
  imagem: "Atualizar foto do grupo",
};

/** Ícone Material de cada ação (botões do passo Ação do assistente). As de execução usam os da tela de Ações. */
export const ICONE_ACAO_AUTOMACAO: Record<TipoAcaoAutomacao, string> = {
  mensagem: ICONE_ACAO.mensagem,
  enquete: ICONE_ACAO.enquete,
  nome: ICONE_ACAO.nome,
  descricao: ICONE_ACAO.descricao,
  abrir: ICONE_ACAO.abrir,
  fechar: ICONE_ACAO.fechar,
  admin_add: ICONE_ACAO.admin_add,
  admin_remover: ICONE_ACAO.admin_remover,
  redefinir_link: ICONE_ACAO.redefinir_link,
  configuracao: ICONE_ACAO.configuracao,
  atualizar_links: ICONE_ACAO.atualizar_links,
  desativar_comunidade: ICONE_ACAO.desativar_comunidade,
  mover_grupos: ICONE_ACAO.mover_grupos,
  tag_condicional: "rule",
  remover_participante: "person_remove",
  adicionar_tag: "label",
  remover_tag: "label_off",
  adicionar_blacklist: "block",
  remover_blacklist: "check_circle_outline",
  imagem: ICONE_ACAO.imagem,
};

/** Gatilhos que têm uma pessoa (o telefone de quem entrou, saiu ou comprou): só neles a Tag Condicional vale. */
export const GATILHOS_DE_PESSOA: readonly Gatilho[] = ["entrou", "saiu", "checkout"];

/** Quais ações cada gatilho aceita. Cronograma: as ações de grupo (as 9 da fila em massa mais configuração,
 *  atualizar links, desativar comunidade e mover grupos). Grupo cheio: sem desativar comunidade. Grupo criado: sem
 *  desativar comunidade nem mover grupos (as duas são perigosas demais pra disparar sozinhas a cada grupo novo).
 *  Entrou: mensagem (uma vez a cada 10 min por grupo), Tag Condicional, "Remover Lead" (do grupo em que entrou) e as
 *  ações de pessoa (tags e blacklist). Saiu e checkout: as mesmas sem mensagem ("Remover Lead" tira dos outros grupos
 *  da campanha / de todos os grupos ativos). "Mover grupos" não entra nos gatilhos de pessoa: move grupos inteiros e,
 *  disparado a cada pessoa, moveria o grupo no primeiro evento. */
export function acoesPermitidas(g: Gatilho): TipoAcaoAutomacao[] {
  const deGrupo = TIPOS_ACAO_AUTOMACAO.filter((t) => t !== "remover_participante" && t !== "tag_condicional" && !ehAcaoDePessoa(t));
  const dePessoa: TipoAcaoAutomacao[] = ["tag_condicional", "remover_participante", ...TIPOS_ACAO_PESSOA];
  switch (g) {
    case "cronograma":
      return deGrupo;
    case "grupo_cheio":
      return deGrupo.filter((t) => t !== "desativar_comunidade");
    case "grupo_criado":
      return deGrupo.filter((t) => t !== "desativar_comunidade" && t !== "mover_grupos");
    case "entrou":
      return ["mensagem", ...dePessoa];
    case "saiu":
    case "checkout":
      return [...dePessoa];
  }
}

export type AcaoAutomacao = { tipo: TipoAcaoAutomacao; conteudo: unknown; atraso_min: number };

/** Conteúdo da Tag Condicional: segue se a pessoa do gatilho `tem` (true) ou não tem (false) a tag. */
export type ConteudoTagCondicional = { tag_id: string; tem: boolean };

export function validarTagCondicional(bruto: unknown): { ok: true; valor: ConteudoTagCondicional } | { ok: false; erro: string } {
  const c = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  if (!ehUuid(c.tag_id)) return { ok: false, erro: "Escolha a tag." };
  if (typeof c.tem !== "boolean") return { ok: false, erro: "Escolha se a pessoa tem ou não tem a tag." };
  return { ok: true, valor: { tag_id: c.tag_id, tem: c.tem } };
}

export type EntradaAutomacao = {
  nome: string;
  campanha_id: string;
  gatilho: string;
  quando: string | null;
  alvo_grupos: string[] | null;
  pasta: string | null;
  provedor: string | null;
  produto: string | null;
  /** Contas da campanha que fazem as execuções (null/ausente = todas). */
  alvo_contas?: string[] | null;
  /** Evento da venda no gatilho de checkout (null/ausente = compra aprovada). */
  checkout_evento?: string | null;
  acoes: AcaoAutomacao[];
};

export const MAXIMO_ACOES = 20;
export const MAXIMO_GRUPOS_ALVO = 500;
export const MAXIMO_CONTAS_ALVO = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type OpcoesValidacao = {
  /** `quando` salvo hoje (edição). `undefined` = automação nova. */
  quandoAnterior?: string | null;
  /** A automação fica ativa depois de salvar/alternar. */
  ativando?: boolean;
};

const mesmoInstante = (a: string | null | undefined, b: string) => !!a && new Date(a).getTime() === new Date(b).getTime();

/** Valida a entrada do assistente. Data futura no cronograma só é exigida quando o `quando` mudou (ou é nova) ou
 *  quando a automação fica ativa: editar o nome/pasta de um cronograma já disparado e desativado não trava. */
export function validarAutomacao(e: EntradaAutomacao, agora: Date = new Date(), opcoes: OpcoesValidacao = {}):
  | { ok: true; valor: EntradaAutomacao & { gatilho: Gatilho; alvo_contas: string[] | null; checkout_evento: EventoCheckout | null } }
  | { ok: false; erro: string } {
  const nome = e.nome.trim();
  if (!nome || nome.length > 80) return { ok: false, erro: "Dê um nome de até 80 caracteres." };
  if (typeof e.campanha_id !== "string" || !UUID.test(e.campanha_id)) return { ok: false, erro: "Campanha inválida." };
  if (!(GATILHOS as readonly string[]).includes(e.gatilho)) return { ok: false, erro: "Escolha um gatilho." };
  const gatilho = e.gatilho as Gatilho;
  const pasta = e.pasta?.trim() || null;
  if (pasta && pasta.length > 40) return { ok: false, erro: "Pasta com até 40 caracteres." };
  let quando: string | null = null;
  let alvo: string[] | null = null;
  if (gatilho === "cronograma") {
    if (!e.quando || Number.isNaN(new Date(e.quando).getTime())) return { ok: false, erro: "Escolha a data e a hora do disparo." };
    const exigeFutura = opcoes.ativando || !mesmoInstante(opcoes.quandoAnterior, e.quando);
    if (exigeFutura && new Date(e.quando) <= agora) return { ok: false, erro: "Escolha uma data futura." };
    quando = e.quando;
    if (e.alvo_grupos && !e.alvo_grupos.length) return { ok: false, erro: "Marque pelo menos um grupo." };
    if (e.alvo_grupos && e.alvo_grupos.length > MAXIMO_GRUPOS_ALVO) return { ok: false, erro: `No máximo ${MAXIMO_GRUPOS_ALVO} grupos.` };
    if (e.alvo_grupos?.some((g) => typeof g !== "string" || !UUID.test(g))) return { ok: false, erro: "Grupo inválido." };
    alvo = e.alvo_grupos;
  }
  let provedor: string | null = null;
  let produto: string | null = null;
  let checkoutEvento: EventoCheckout | null = null;
  if (gatilho === "checkout") {
    // Sem plataforma (null/vazio) = qualquer plataforma; com plataforma, tem que ser uma das conhecidas.
    if (e.provedor !== null && e.provedor !== undefined && e.provedor !== "") {
      if (typeof e.provedor !== "string" || !(PROVEDORES as readonly string[]).includes(e.provedor)) return { ok: false, erro: "Escolha o checkout." };
      provedor = e.provedor;
    }
    const p = (e.produto ?? "").trim();
    if (!p || p.length > 120) return { ok: false, erro: "Escreva o nome do produto." };
    produto = p;
    const evento = e.checkout_evento ?? "aprovada";
    if (!(EVENTOS_CHECKOUT as readonly string[]).includes(evento)) return { ok: false, erro: "Escolha o evento da venda." };
    checkoutEvento = evento as EventoCheckout;
  }
  let contas: string[] | null = null;
  if (e.alvo_contas !== null && e.alvo_contas !== undefined) {
    if (!Array.isArray(e.alvo_contas) || !e.alvo_contas.length) return { ok: false, erro: "Marque pelo menos uma conexão." };
    if (e.alvo_contas.length > MAXIMO_CONTAS_ALVO) return { ok: false, erro: `No máximo ${MAXIMO_CONTAS_ALVO} conexões.` };
    if (e.alvo_contas.some((c) => !ehUuid(c))) return { ok: false, erro: "Conexão inválida." };
    contas = [...new Set(e.alvo_contas)];
  }
  if (!e.acoes.length) return { ok: false, erro: "Adicione pelo menos uma ação." };
  if (e.acoes.length > MAXIMO_ACOES) return { ok: false, erro: `No máximo ${MAXIMO_ACOES} ações.` };
  const permitidas = acoesPermitidas(gatilho);
  const acoes: AcaoAutomacao[] = [];
  for (const [i, a] of e.acoes.entries()) {
    if (!(TIPOS_ACAO_AUTOMACAO as readonly string[]).includes(a.tipo)) return { ok: false, erro: `Ação ${i + 1}: tipo inválido.` };
    if (!permitidas.includes(a.tipo)) return { ok: false, erro: `Ação ${i + 1}: não vale para este gatilho.` };
    if (!Number.isInteger(a.atraso_min) || a.atraso_min < 0 || a.atraso_min > 1440) return { ok: false, erro: `Ação ${i + 1}: atraso entre 0 e 1440 minutos.` };
    if (a.tipo === "remover_participante") {
      acoes.push({ tipo: a.tipo, conteudo: {}, atraso_min: a.atraso_min });
      continue;
    }
    if (ehAcaoDePessoa(a.tipo)) {
      // Aplicadas na hora pelo motor (não viram execução): atraso não vale.
      if (a.atraso_min !== 0) return { ok: false, erro: `Ação ${i + 1}: ${ROTULO_ACAO[a.tipo]} é aplicada na hora, sem atraso.` };
      const p = validarAcaoDePessoa(a.tipo, a.conteudo);
      if (!p.ok) return { ok: false, erro: `Ação ${i + 1}: ${p.erro}` };
      acoes.push({ tipo: a.tipo, conteudo: p.valor, atraso_min: 0 });
      continue;
    }
    if (a.tipo === "tag_condicional") {
      const t = validarTagCondicional(a.conteudo);
      if (!t.ok) return { ok: false, erro: `Ação ${i + 1}: ${t.erro}` };
      if (i === e.acoes.length - 1) return { ok: false, erro: `Ação ${i + 1}: a Tag Condicional precisa de pelo menos uma ação depois dela.` };
      // Na entrada a mensagem é do grupo (uma por bloco de 10 min), não da pessoa: condicionar por tag não faz sentido.
      if (gatilho === "entrou" && e.acoes.slice(i + 1).some((x) => x.tipo === "mensagem")) {
        return { ok: false, erro: "Na entrada, a Tag Condicional só vale para remover ou marcar tags; mensagens vão pro grupo inteiro." };
      }
      // A condição é avaliada na hora do gatilho: atraso não vale pra ela.
      acoes.push({ tipo: a.tipo, conteudo: t.valor, atraso_min: 0 });
      continue;
    }
    const v = validarConteudo(a.tipo as TipoExecucao, a.conteudo);
    if (!v.ok) return { ok: false, erro: `Ação ${i + 1}: ${v.erro}` };
    if (a.tipo === "mover_grupos" && (v.valor as { campanha_destino: string }).campanha_destino === e.campanha_id) {
      return { ok: false, erro: `Ação ${i + 1}: escolha outra campanha de destino.` };
    }
    acoes.push({ tipo: a.tipo, conteudo: v.valor, atraso_min: a.atraso_min });
  }
  return { ok: true, valor: { ...e, nome, gatilho, quando, alvo_grupos: alvo, pasta, provedor, produto, alvo_contas: contas, checkout_evento: checkoutEvento, acoes } };
}

// ---------- Exportar/importar JSON (Etapa 3F, Tarefa 2) ----------

/** Versão do formato de exportação/importação de automações em JSON. Só essa é aceita na importação. */
export const VERSAO_JSON_AUTOMACAO = 1;

export type AcaoExportada = { tipo: TipoAcaoAutomacao; conteudo: unknown; ordem: number; atraso?: number };

/** O que sai em "Exportar JSON" e entra em "Importar JSON": só o que define a automação (nome, gatilho, ações) —
 *  nunca id, campanha, contas ou grupos (esses são escolhidos de novo em cada ambiente). */
export type AutomacaoExportada = {
  versao: typeof VERSAO_JSON_AUTOMACAO;
  nome: string;
  gatilho: Gatilho;
  quando?: string | null;
  provedor?: string | null;
  produto?: string | null;
  checkout_evento?: string | null;
  acoes: AcaoExportada[];
};

/** Monta o JSON de exportação a partir da automação salva (ordem das ações pela posição no array). */
export function exportarAutomacaoJson(a: {
  nome: string;
  gatilho: string;
  quando: string | null;
  provedor: string | null;
  produto: string | null;
  checkout_evento: string | null;
  acoes: { tipo: string; conteudo: unknown; atraso_min: number }[];
}): AutomacaoExportada {
  return {
    versao: VERSAO_JSON_AUTOMACAO,
    nome: a.nome,
    gatilho: a.gatilho as Gatilho,
    quando: a.quando,
    provedor: a.provedor,
    produto: a.produto,
    checkout_evento: a.checkout_evento,
    acoes: a.acoes.map((x, ordem) => ({
      tipo: x.tipo as TipoAcaoAutomacao,
      conteudo: x.conteudo,
      ordem,
      ...(x.atraso_min ? { atraso: x.atraso_min } : {}),
    })),
  };
}

/** Lê um JSON importado (bruto, de arquivo ou colado) e monta a `EntradaAutomacao` pra validar com as mesmas
 *  regras do salvar (`validarAutomacao`). Rejeita versão desconhecida/ausente antes de olhar o resto. A automação
 *  nasce sem campanha de destino aqui: quem chama preenche `campanha_id` com a escolhida na janela de importação. */
export function entradaDoImportJson(bruto: unknown, campanhaId: string): { ok: true; valor: EntradaAutomacao } | { ok: false; erro: string } {
  if (!bruto || typeof bruto !== "object") return { ok: false, erro: "Arquivo inválido: não é um JSON de automação." };
  const j = bruto as Record<string, unknown>;
  if (j.versao !== VERSAO_JSON_AUTOMACAO) return { ok: false, erro: `Versão do arquivo não suportada (esperado ${VERSAO_JSON_AUTOMACAO}).` };
  if (typeof j.nome !== "string") return { ok: false, erro: "Arquivo inválido: falta o nome." };
  if (typeof j.gatilho !== "string") return { ok: false, erro: "Arquivo inválido: falta o gatilho." };
  if (!Array.isArray(j.acoes)) return { ok: false, erro: "Arquivo inválido: falta a lista de ações." };
  const acoesOrdenadas = [...j.acoes].sort((x, y) => {
    const ox = typeof (x as { ordem?: unknown })?.ordem === "number" ? (x as { ordem: number }).ordem : 0;
    const oy = typeof (y as { ordem?: unknown })?.ordem === "number" ? (y as { ordem: number }).ordem : 0;
    return ox - oy;
  });
  const acoes: AcaoAutomacao[] = acoesOrdenadas.map((bruta) => {
    const b = (bruta && typeof bruta === "object" ? bruta : {}) as Record<string, unknown>;
    return {
      tipo: b.tipo as TipoAcaoAutomacao,
      conteudo: b.conteudo ?? {},
      atraso_min: typeof b.atraso === "number" ? b.atraso : 0,
    };
  });
  const valor: EntradaAutomacao = {
    nome: j.nome,
    campanha_id: campanhaId,
    gatilho: j.gatilho,
    quando: typeof j.quando === "string" ? j.quando : null,
    alvo_grupos: null,
    pasta: null,
    provedor: typeof j.provedor === "string" ? j.provedor : null,
    produto: typeof j.produto === "string" ? j.produto : null,
    alvo_contas: null,
    checkout_evento: typeof j.checkout_evento === "string" ? j.checkout_evento : null,
    acoes,
  };
  return { ok: true, valor };
}

export type LinhaExecucao = {
  campanha_id: string;
  origem: "automacao";
  tipo: TipoExecucao;
  conteudo: unknown;
  alvo_grupos: string[] | null;
  /** Contas da automação (null = todas): o job de execuções só usa os grupos dessas contas. */
  alvo_contas: string[] | null;
  agendada_para: string;
  automacao_id: string;
  automacao_acao_id: string;
  gatilho_chave: string;
};

/** Uma linha da fila de remoções (tabela `acoes`, tipo `remover`) gerada por uma automação, com atraso
 *  (`executar_apos`) e sem repetir o mesmo disparo (`gatilho_chave`, único junto com `automacao_acao_id`). */
export type LinhaRemocao = {
  tipo: "remover";
  campanha_id: string;
  grupo_id: string;
  telefone: string;
  origem: "automacao";
  executar_apos: string;
  automacao_id: string;
  automacao_acao_id: string;
  gatilho_chave: string;
};

const mais = (iso: string | Date, min: number) => new Date(new Date(iso).getTime() + min * 60_000).toISOString();

/** Início (ISO) do bloco de 10 minutos em que `agora` cai. Usado pra limitar "entrou" a uma mensagem por grupo a
 *  cada 10 minutos, mesmo que muita gente entre junto. */
export function bucket10min(agora: Date): string {
  const BLOCO_MS = 10 * 60_000;
  return new Date(Math.floor(agora.getTime() / BLOCO_MS) * BLOCO_MS).toISOString();
}

/** Automação vista pelas funções de linhas. `alvo_contas` ausente/null = todas as contas. */
type AutomacaoLinhas = { id: string; campanha_id: string; alvo_contas?: string[] | null };

/** Ações que viram execução (nem remoção, nem Tag Condicional, nem ação de pessoa). */
const viraExecucao = (t: TipoAcaoAutomacao) => t !== "remover_participante" && t !== "tag_condicional" && !ehAcaoDePessoa(t);

export function linhasDoCronograma(a: AutomacaoLinhas & { quando: string; alvo_grupos: string[] | null }, acoes: (AcaoAutomacao & { id: string })[]): LinhaExecucao[] {
  return acoes
    .filter((x) => viraExecucao(x.tipo))
    .map((x) => ({
      campanha_id: a.campanha_id, origem: "automacao", tipo: x.tipo as TipoExecucao, conteudo: x.conteudo, alvo_grupos: a.alvo_grupos, alvo_contas: a.alvo_contas ?? null,
      agendada_para: mais(a.quando, x.atraso_min), automacao_id: a.id, automacao_acao_id: x.id, gatilho_chave: "cronograma",
    }));
}

export function linhasDoEvento(a: AutomacaoLinhas, acoes: (AcaoAutomacao & { id: string })[], grupoId: string, agora: Date): LinhaExecucao[] {
  return acoes
    .filter((x) => viraExecucao(x.tipo))
    .map((x) => ({
      campanha_id: a.campanha_id, origem: "automacao", tipo: x.tipo as TipoExecucao, conteudo: x.conteudo, alvo_grupos: [grupoId], alvo_contas: a.alvo_contas ?? null,
      agendada_para: mais(agora, x.atraso_min), automacao_id: a.id, automacao_acao_id: x.id, gatilho_chave: grupoId,
    }));
}

/** A automação tem alguma Tag Condicional? Sem nenhuma, o motor segue exatamente o caminho de antes (nem lê tags). */
export function temTagCondicional(acoes: { tipo: TipoAcaoAutomacao }[]): boolean {
  return acoes.some((x) => x.tipo === "tag_condicional");
}

/** Ids das tags usadas pelas Tags Condicionais das ações. */
export function tagsDasCondicionais(acoes: { tipo: TipoAcaoAutomacao; conteudo: unknown }[]): string[] {
  const ids = acoes.filter((x) => x.tipo === "tag_condicional").map((x) => (x.conteudo as Partial<ConteudoTagCondicional> | null)?.tag_id);
  return [...new Set(ids.filter((id): id is string => typeof id === "string"))];
}

/** Decisão de uma Tag Condicional que falhou: as ações depois dela foram puladas pra essa pessoa. */
export type AcoesPuladas = { acao_id: string; motivo: string; puladas: string[] };

/** Avalia as ações em ordem pra uma pessoa: cada Tag Condicional confere se a pessoa tem (ou não tem) a tag; se a
 *  condição falha, nenhuma ação daí em diante é criada pra ela (e a decisão volta como "pulada", com motivo). As Tags
 *  Condicionais nunca entram na lista de ações a criar. Conteúdo sem `tag_id` válido conta como condição falha.
 *
 *  O pulo não é gravado em lugar nenhum (nem execução nem remoção), então NÃO trava o `gatilho_chave`: se o mesmo
 *  disparo for reavaliado depois (retry de uma venda que falhou no meio, conferência que repete a mesma entrada/saída
 *  com o mesmo instante) e a pessoa já tiver ganhado (ou perdido) a tag, as ações puladas são criadas nessa vez —
 *  uma vez só, pelo índice único `automacao_acao_id, gatilho_chave`. */
export function acoesDaPessoa<T extends AcaoAutomacao & { id: string }>(acoes: T[], temTag: (tagId: string) => boolean): { acoes: T[]; pulada: AcoesPuladas | null } {
  const liberadas: T[] = [];
  for (const [i, x] of acoes.entries()) {
    if (x.tipo !== "tag_condicional") {
      liberadas.push(x);
      continue;
    }
    const c = (x.conteudo ?? {}) as Partial<ConteudoTagCondicional>;
    const tem = typeof c.tag_id === "string" && temTag(c.tag_id);
    const querTer = c.tem !== false;
    if (typeof c.tag_id === "string" && tem === querTer) continue;
    return {
      acoes: liberadas,
      pulada: {
        acao_id: x.id,
        motivo: `Tag Condicional (ação ${i + 1}): a pessoa ${tem ? "tem" : "não tem"} a tag; era pra ${querTer ? "ter" : "não ter"}.`,
        puladas: acoes.slice(i + 1).filter((y) => y.tipo !== "tag_condicional").map((y) => y.id),
      },
    };
  }
  return { acoes: liberadas, pulada: null };
}

/** Gatilho "entrou": ações de mensagem viram uma execução só pro grupo (uma por bloco de 10 min, mesmo com vários
 *  telefones entrando juntos); ações de remover viram uma linha de remoção por telefone (removido do grupo em que
 *  entrou). `agora` é o instante da entrada (o `entrou_em` que a conferência grava): a chave da remoção leva esse
 *  instante, então a mesma entrada não repete, mas sair e entrar de novo dispara outra vez. */
export function linhasEntrou(
  a: AutomacaoLinhas,
  acoes: (AcaoAutomacao & { id: string })[],
  grupoId: string,
  telefones: string[],
  agora: Date,
): { execucoes: LinhaExecucao[]; remocoes: LinhaRemocao[] } {
  const bucket = bucket10min(agora);
  const execucoes: LinhaExecucao[] = acoes
    .filter((x) => x.tipo === "mensagem")
    .map((x) => ({
      campanha_id: a.campanha_id, origem: "automacao", tipo: x.tipo as TipoExecucao, conteudo: x.conteudo, alvo_grupos: [grupoId], alvo_contas: a.alvo_contas ?? null,
      agendada_para: mais(agora, x.atraso_min), automacao_id: a.id, automacao_acao_id: x.id, gatilho_chave: `${grupoId}:${bucket}`,
    }));
  const remover = acoes.filter((x) => x.tipo === "remover_participante");
  const remocoes: LinhaRemocao[] = remover.flatMap((x) =>
    telefones.map((telefone) => ({
      tipo: "remover" as const,
      campanha_id: a.campanha_id,
      grupo_id: grupoId,
      telefone,
      origem: "automacao" as const,
      executar_apos: mais(agora, x.atraso_min),
      automacao_id: a.id,
      automacao_acao_id: x.id,
      gatilho_chave: `${grupoId}:${telefone}:${agora.toISOString()}`,
    })),
  );
  return { execucoes, remocoes };
}

/** "Entrou" com Tag Condicional: avalia as ações pra cada telefone (`acoesDaPessoa`). Remoções: só as liberadas
 *  pra cada pessoa. Mensagens: a execução é do grupo (uma por bloco de 10 min, mesma chave de `linhasEntrou`), então
 *  é criada se a condição passar pra pelo menos uma das pessoas que entraram; se ninguém passar, não é criada (e uma
 *  entrada posterior no mesmo bloco, de quem passe, ainda cria — sem duplicar, pelo índice único). Desde a revisão
 *  da 3F, `validarAutomacao` recusa mensagem depois de uma Tag Condicional no "entrou"; essa regra fica só como
 *  defesa pra linha gravada antes. */
export function linhasEntrouCondicional(
  a: AutomacaoLinhas,
  acoes: (AcaoAutomacao & { id: string })[],
  grupoId: string,
  telefones: string[],
  agora: Date,
  temTag: (telefone: string, tagId: string) => boolean,
): { execucoes: LinhaExecucao[]; remocoes: LinhaRemocao[]; puladas: AcoesPuladas[] } {
  const execucoes = new Map<string, LinhaExecucao>();
  const remocoes: LinhaRemocao[] = [];
  const puladas: AcoesPuladas[] = [];
  for (const telefone of telefones) {
    const d = acoesDaPessoa(acoes, (tag) => temTag(telefone, tag));
    if (d.pulada) puladas.push(d.pulada);
    const l = linhasEntrou(a, d.acoes, grupoId, [telefone], agora);
    for (const e of l.execucoes) execucoes.set(`${e.automacao_acao_id}|${e.gatilho_chave}`, e);
    remocoes.push(...l.remocoes);
  }
  return { execucoes: [...execucoes.values()], remocoes, puladas };
}

/** Gatilho "saiu": remove quem saiu dos outros grupos da mesma campanha em que ainda está. `agora` é o instante da
 *  saída (o `saiu_em` que a conferência grava): entra na chave, então a mesma saída não repete, mas uma saída nova
 *  (depois de voltar) dispara outra vez. */
export function linhasSaiu(
  a: AutomacaoLinhas,
  acoes: (AcaoAutomacao & { id: string })[],
  telefone: string,
  outrasParticipacoes: { grupoId: string; telefone: string }[],
  grupoOrigem: string,
  agora: Date,
): LinhaRemocao[] {
  const remover = acoes.filter((x) => x.tipo === "remover_participante");
  return remover.flatMap((x) =>
    outrasParticipacoes.map((p) => ({
      tipo: "remover" as const,
      campanha_id: a.campanha_id,
      grupo_id: p.grupoId,
      telefone: p.telefone,
      origem: "automacao" as const,
      executar_apos: mais(agora, x.atraso_min),
      automacao_id: a.id,
      automacao_acao_id: x.id,
      gatilho_chave: `saiu:${grupoOrigem}:${telefone}:${agora.toISOString()}:${p.grupoId}`,
    })),
  );
}

/** Gatilho "checkout": remove o comprador de todos os grupos ativos da campanha em que participa. */
export function linhasCheckout(
  a: AutomacaoLinhas,
  acoes: (AcaoAutomacao & { id: string })[],
  vendaId: string,
  participacoes: { grupoId: string; telefone: string }[],
  agora: Date,
): LinhaRemocao[] {
  const remover = acoes.filter((x) => x.tipo === "remover_participante");
  return remover.flatMap((x) =>
    participacoes.map((p) => ({
      tipo: "remover" as const,
      campanha_id: a.campanha_id,
      grupo_id: p.grupoId,
      telefone: p.telefone,
      origem: "automacao" as const,
      executar_apos: mais(agora, x.atraso_min),
      automacao_id: a.id,
      automacao_acao_id: x.id,
      gatilho_chave: `venda:${vendaId}:${p.grupoId}`,
    })),
  );
}

/** O que fazer com uma rodada suspeita da conferência de um grupo:
 *  - `ignorar_rodada`: a leitura do WhatsApp não é confiável; nada do grupo é gravado nesta rodada.
 *  - `sem_automacoes`: a leitura é plausível; grava como sempre, mas não dispara as automações de pessoas. */
export type RodadaSuspeita =
  | { tipo: "ignorar_rodada"; motivo: "lista_vazia" | "sem_numero_conectado" | "metade_saiu" }
  | { tipo: "sem_automacoes"; motivo: "entrada_em_massa" };

/** Tamanho mínimo (pessoas) pras regras de "metade do grupo" valerem. */
export const MUDANCA_GRANDE_MINIMO = 10;

/** Classifica uma rodada da conferência (provável leitura errada do WhatsApp, não gente entrando/saindo de verdade).
 *  Ignorar a rodada: lista vazia; nenhum dos números desta conexão na lista (o número que confere sempre é membro;
 *  `telefonesConexao` vazio, número sem telefone gravado, não barra por aqui); ou mais da metade dos conhecidos
 *  (com pelo menos `MUDANCA_GRANDE_MINIMO` conhecidos) some de uma vez, típico de lista parcial. Remoções feitas
 *  pelo sistema não contam: `executarRemover` grava `saiu_em` antes da conferência ver. Sem automações: mais da
 *  metade da lista nova é de quem entrou, com pelo menos `MUDANCA_GRANDE_MINIMO` entradas e
 *  `MUDANCA_GRANDE_MINIMO` conhecidos antes (grupo novo/pequeno enchendo rápido não conta). Os telefones da lista
 *  podem vir com `@sufixo`. */
export function rodadaSuspeita(r: {
  conhecidos: number;
  lista: string[];
  entraram: number;
  sairam: number;
  telefonesConexao: string[];
}): RodadaSuspeita | null {
  if (!r.lista.length) return { tipo: "ignorar_rodada", motivo: "lista_vazia" };
  if (r.telefonesConexao.length) {
    const naLista = new Set(r.lista.map((t) => t.split("@")[0]));
    if (!r.telefonesConexao.some((t) => naLista.has(t))) return { tipo: "ignorar_rodada", motivo: "sem_numero_conectado" };
  }
  if (r.conhecidos >= MUDANCA_GRANDE_MINIMO && r.sairam > r.conhecidos / 2) return { tipo: "ignorar_rodada", motivo: "metade_saiu" };
  if (r.conhecidos >= MUDANCA_GRANDE_MINIMO && r.entraram >= MUDANCA_GRANDE_MINIMO && r.entraram > r.lista.length / 2) {
    return { tipo: "sem_automacoes", motivo: "entrada_em_massa" };
  }
  return null;
}
