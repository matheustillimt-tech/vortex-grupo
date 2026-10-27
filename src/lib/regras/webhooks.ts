/** Eventos dos Hooks (Etapa 3K, Tarefa 5). Os 4 primeiros são os de antes (mesma chave, mesmo payload).
 *  A ordem aqui é a da tela (grupos abaixo). */
export const EVENTOS_WEBHOOK = [
  "entrou",
  "saiu",
  "alerta",
  "compra",
  "metricas_campanha",
  "metricas_mensagens",
  "sem_conta",
  "falha_disparo",
  "acao_concluida",
  "grupo_criado",
  "grupo_cheio",
  "grupo_suspenso",
  "mensagem_recebida",
  "conta_pareada",
  "conta_deslogada",
  // Etapa 3N, Tarefa 3: no fim da lista, pra não mexer na ordem dos eventos já gravados.
  "solicitacoes_entrada",
] as const;
export type Evento = (typeof EVENTOS_WEBHOOK)[number];

/** Os 4 eventos que existiam antes desta etapa (regressão: webhook antigo continua recebendo só estes). */
export const EVENTOS_ANTIGOS: readonly Evento[] = ["entrou", "saiu", "alerta", "compra"];

export const ROTULO_EVENTO: Record<Evento, string> = {
  entrou: "Membro adicionado",
  saiu: "Membro removido",
  alerta: "Alerta",
  compra: "Compra aprovada",
  metricas_campanha: "Métricas da campanha",
  metricas_mensagens: "Métricas de mensagens da campanha",
  sem_conta: "Campanha sem conexão associada",
  falha_disparo: "Falha em disparo agendado",
  acao_concluida: "Ação concluída",
  grupo_criado: "Grupo criado",
  grupo_cheio: "Grupo cheio",
  grupo_suspenso: "Grupo suspenso",
  mensagem_recebida: "Mensagem recebida (PV)",
  conta_pareada: "Conexão pareada",
  conta_deslogada: "Conexão deslogada",
  solicitacoes_entrada: "Solicitações de entrada em grupos",
};

/** Ícone (Material Symbols) de cada evento no assistente. */
export const ICONE_EVENTO: Record<Evento, string> = {
  entrou: "person_add",
  saiu: "person_remove",
  alerta: "notifications",
  compra: "shopping_cart",
  metricas_campanha: "analytics",
  metricas_mensagens: "visibility",
  sem_conta: "link_off",
  falha_disparo: "event_busy",
  acao_concluida: "task_alt",
  grupo_criado: "group_add",
  grupo_cheio: "groups",
  grupo_suspenso: "block",
  mensagem_recebida: "move_to_inbox",
  conta_pareada: "phonelink_ring",
  conta_deslogada: "phonelink_erase",
  solicitacoes_entrada: "pending_actions",
};

/** Descrição embaixo do rótulo no assistente, no texto: o que vem no payload (e quando sai, se o rótulo
 *  sozinho não diz). Todo evento tem a sua. */
export const DESCRICAO_EVENTO: Record<Evento, string> = {
  entrou: "Nome da campanha, nome do grupo e WhatsApp do participante",
  saiu: "Nome da campanha, nome do grupo e WhatsApp do participante",
  alerta: "Tipo e texto do alerta, com a campanha quando o alerta é de uma campanha",
  compra: "WhatsApp do comprador e produtos da venda aprovada",
  metricas_campanha: "Às 7h, 12h e 17h: nome da campanha, cliques, entradas, saídas, participantes e grupos das últimas 24 h",
  metricas_mensagens: "Às 7h, 12h e 17h: nome da campanha, entregues e lidos de cada mensagem das últimas 24 h",
  sem_conta: "Nome da campanha e o motivo: a criação de um grupo parou porque a campanha não tem conexão criadora conectada",
  falha_disparo: "Nome da campanha, tipo do envio agendado, motivo e texto da falha (bloqueado ou com erro)",
  acao_concluida: "Nome da campanha, tipo da ação e o total de grupos, de enviadas e de erros",
  grupo_criado: "Nome da campanha, nome e número do grupo, link de convite e a conexão que criou",
  grupo_cheio: "Nome da campanha, nome do grupo e participantes no momento em que encheu",
  grupo_suspenso: "Nome da campanha, nome do grupo e a conexão: o grupo deixou de aparecer na conexão (suspenso ou apagado)",
  mensagem_recebida: "Conexão conectada, WhatsApp de quem mandou, tipo e texto da mensagem privada",
  conta_pareada: "Nome da conexão e o WhatsApp conectado",
  conta_deslogada: "Nome da conexão, WhatsApp e o motivo da desconexão",
  solicitacoes_entrada:
    "Pedidos de entrada novos e as decisões (aprovada, recusada, cancelada, expirada), lidos quando a aba abre ou pela conferência a cada 2 minutos.",
};

/** Texto que vai no campo `descricao` do payload de `grupo_suspenso` (fixo: o payload não muda junto com a tela). */
export const DESCRICAO_PAYLOAD_SUSPENSO = "O grupo deixou de aparecer na conexão (suspenso ou apagado)";

/** Grupos da lista de eventos do assistente (passo "Webhook"). */
export const GRUPOS_EVENTOS: { titulo: string; eventos: Evento[] }[] = [
  { titulo: "CAMPANHA", eventos: ["metricas_campanha", "metricas_mensagens", "sem_conta", "falha_disparo", "acao_concluida", "solicitacoes_entrada"] },
  { titulo: "GRUPOS", eventos: ["entrou", "saiu", "grupo_criado", "grupo_cheio", "grupo_suspenso"] },
  { titulo: "MENSAGENS", eventos: ["mensagem_recebida"] },
  { titulo: "CONEXÕES", eventos: ["conta_pareada", "conta_deslogada"] },
  { titulo: "OUTROS", eventos: ["alerta", "compra"] },
];

/** Eventos que o Vórtex Grupo ainda não consegue detectar (lista recolhida no assistente, com o motivo). */
export const EVENTOS_INDISPONIVEIS: { rotulo: string; motivo: string }[] = [
  { rotulo: "Bloqueio de crescimento do grupo", motivo: "o Zapbot não avisa" },
  { rotulo: "Status de mensagem (PV)", motivo: "o Vórtex Grupo não envia PV" },
  { rotulo: "Conexão banida", motivo: "o Zapbot não separa de \"Conexão deslogada\"" },
  { rotulo: "Restrição temporária", motivo: "o Zapbot não separa de \"Conexão deslogada\"" },
  { rotulo: "Novo QR Code gerado", motivo: "o Zapbot não avisa" },
  { rotulo: "QR Code expirado", motivo: "o Zapbot não avisa" },
];

/** Busca do passo "Eventos": sem acento e sem caixa, no rótulo. */
export function eventosDaBusca(busca: string): Evento[] {
  const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const q = norm(busca.trim());
  if (!q) return [...EVENTOS_WEBHOOK];
  return EVENTOS_WEBHOOK.filter((ev) => norm(ROTULO_EVENTO[ev]).includes(q));
}

/** "Envia eventos de Membro adicionado, Membro removido" (texto do cartão). */
export function textoEventos(eventos: string[]): string {
  return `Envia eventos de ${eventos.map((ev) => ROTULO_EVENTO[ev as Evento] ?? ev).join(", ")}`;
}

/** token = `webhooks.segredo`: 24 bytes em hex (48 caracteres). */
export const FORMATO_TOKEN = /^[0-9a-f]{48}$/;
export function tokenValido(s: unknown): s is string {
  return typeof s === "string" && FORMATO_TOKEN.test(s);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAXIMO_CAMPANHAS = 200;

/** IPv4 literal (v4-mapeado em IPv6 não entra aqui: o host já teria de vir como IPv6 puro). */
function ipv4Privado(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a > 255 || Number(m[3]) > 255 || Number(m[4]) > 255 || b > 255) return false;
  if (a === 0) return true; // 0/8 (inclui 0.0.0.0)
  if (a === 10) return true; // 10/8
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 (CGNAT)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 127) return true; // 127/8
  if (a === 169 && b === 254) return true; // 169.254/16
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15 (testes de rede)
  if (a >= 224) return true; // 224/4 (multicast) e 240/4 (reservado, inclui 255.255.255.255)
  return false;
}

/** Expande um host IPv6 (sem colchetes, pode terminar em "a.b.c.d" embutido) nos 8 grupos de 16 bits, ou
 *  null se não for um IPv6 válido nesse formato simples. */
function gruposIpv6(host: string): number[] | null {
  let h = host;
  const ultimoDoisPontos = h.lastIndexOf(":");
  if (ultimoDoisPontos === -1) return null;
  const rabo = h.slice(ultimoDoisPontos + 1);
  if (rabo.includes(".")) {
    // Forma com IPv4 embutido (ex.: ::ffff:127.0.0.1 ou ::127.0.0.1): troca pelos dois grupos hex equivalentes.
    const partes = rabo.split(".");
    if (partes.length !== 4 || !partes.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)) return null;
    const [a, b, c, d] = partes.map(Number);
    const alto = ((a << 8) | b).toString(16);
    const baixo = ((c << 8) | d).toString(16);
    h = `${h.slice(0, ultimoDoisPontos + 1)}${alto}:${baixo}`;
  }
  if (h.includes("::")) {
    const partesDuplos = h.split("::");
    if (partesDuplos.length !== 2) return null;
    const [esq, dir] = partesDuplos;
    const esqP = esq ? esq.split(":") : [];
    const dirP = dir ? dir.split(":") : [];
    const faltam = 8 - esqP.length - dirP.length;
    if (faltam < 0) return null;
    const grupos = [...esqP, ...Array(faltam).fill("0"), ...dirP];
    if (grupos.length !== 8 || grupos.some((g) => !/^[0-9a-f]{1,4}$/.test(g || "0"))) return null;
    return grupos.map((g) => parseInt(g || "0", 16));
  }
  const partes = h.split(":");
  if (partes.length !== 8 || partes.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return partes.map((g) => parseInt(g, 16));
}

/** IPv6 literal: loopback (::1), não especificado (::), link-local (fe80::/10), ULA (fc00::/7), e os dois
 *  jeitos de embutir um IPv4 (::ffff:a.b.c.d mapeado e ::a.b.c.d compatível/legado) resolvidos pela mesma
 *  regra de IPv4 privado — fecha o SSRF por `::ffff:127.0.0.1` etc. Host vem sem os colchetes de URL. */
function ipv6Privado(host: string): boolean {
  const grupos = gruposIpv6(host.toLowerCase());
  if (!grupos) return false;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = grupos;
  if (grupos.every((g) => g === 0)) return true; // :: (não especificado)
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g6 === 0 && g7 === 1) return true; // ::1
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0xffff || g5 === 0)) {
    // ::ffff:a.b.c.d (mapeado) ou ::a.b.c.d (compatível, legado): os últimos 32 bits são o IPv4 embutido.
    const ipv4 = `${g6 >> 8}.${g6 & 0xff}.${g7 >> 8}.${g7 & 0xff}`;
    return ipv4Privado(ipv4);
  }
  return false;
}

/** Host (sem os colchetes de URL) é local ou privado: localhost, `.local`/`.internal`, ou IP privado (v4 ou v6,
 *  incluindo IPv4 embutido em IPv6). Mesma regra usada por `validarUrlWebhook`; reaproveitada por quem já filtrou
 *  o protocolo antes (ex.: checagem de mídia expirada em `/modelos`), pra nunca virar sonda de SSRF. */
export function hostPrivadoOuLocal(hostnameSemColchetes: string): boolean {
  const host = hostnameSemColchetes.replace(/\.+$/, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;
  return ipv4Privado(host) || ipv6Privado(host);
}

/** Só https, sem credenciais embutidas, host não pode ser local/privado, até 500 caracteres. Retorna o erro ou null. */
export function validarUrlWebhook(url: string): string | null {
  if (typeof url !== "string" || !url) return "Informe a URL.";
  if (url.length > 500) return "URL com até 500 caracteres.";
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "URL inválida.";
  }
  if (u.protocol !== "https:") return "A URL precisa começar com https://.";
  if (u.username || u.password) return "A URL não pode ter usuário ou senha.";
  const host = u.hostname.replace(/^\[/, "").replace(/\]$/, "");
  if (hostPrivadoOuLocal(host)) {
    const limpo = host.replace(/\.+$/, "").toLowerCase();
    if (limpo === "localhost" || limpo.endsWith(".localhost")) return "A URL não pode apontar para localhost.";
    if (limpo.endsWith(".local") || limpo.endsWith(".internal")) return "A URL não pode apontar para um host interno.";
    return "A URL não pode apontar para um IP privado.";
  }
  return null;
}

export type EntradaWebhook = { nome: string; url: string; eventos: string[]; campanhas: string[] | null };
export type Webhook = { nome: string; url: string; eventos: Evento[]; campanhas: string[] | null };

export function validarWebhook(e: EntradaWebhook): { ok: true; valor: Webhook } | { ok: false; erro: string } {
  const nome = (e.nome ?? "").trim();
  if (!nome || nome.length > 60) return { ok: false, erro: "Dê um nome de até 60 caracteres." };
  const erroUrl = validarUrlWebhook(e.url);
  if (erroUrl) return { ok: false, erro: erroUrl };
  if (!Array.isArray(e.eventos) || e.eventos.length === 0) return { ok: false, erro: "Marque pelo menos um evento." };
  if (!e.eventos.every((ev) => (EVENTOS_WEBHOOK as readonly string[]).includes(ev))) return { ok: false, erro: "Evento inválido." };
  if (e.campanhas !== null) {
    if (!Array.isArray(e.campanhas)) return { ok: false, erro: "Campanhas inválidas." };
    if (e.campanhas.length > MAXIMO_CAMPANHAS) return { ok: false, erro: `No máximo ${MAXIMO_CAMPANHAS} campanhas.` };
    if (!e.campanhas.every((c) => typeof c === "string" && UUID.test(c))) return { ok: false, erro: "Campanha inválida." };
  }
  return { ok: true, valor: { nome, url: e.url, eventos: e.eventos as Evento[], campanhas: e.campanhas } };
}

export type WebhookCadastrado = { id: string; eventos: string[]; campanhas: string[] | null; ativo: boolean; arquivado: boolean };

/** Webhooks ativos, não arquivados, que escutam o evento e casam com a campanha. `campanhas: null` = todas as
 *  campanhas; para um evento sem campanha (campanhaId null) só os de "todas" casam. `apenas` restringe ainda
 *  mais: "restritos" exclui os de "todas as campanhas" (mesmo que casassem); "todas" exclui os restritos a
 *  campanhas específicas (mesmo que casassem) — usado por quem enfileira o mesmo evento uma vez por campanha
 *  envolvida sem duplicar o aviso nos webhooks de "todas" (ver `alertar`). */
export function webhooksQueCasam(ws: WebhookCadastrado[], evento: Evento, campanhaId: string | null, apenas?: "restritos" | "todas"): WebhookCadastrado[] {
  return ws.filter((w) => {
    if (!w.ativo || w.arquivado) return false;
    if (!w.eventos.includes(evento)) return false;
    if (apenas === "restritos" && w.campanhas === null) return false;
    if (apenas === "todas" && w.campanhas !== null) return false;
    if (w.campanhas === null) return true;
    if (campanhaId === null) return false;
    return w.campanhas.includes(campanhaId);
  });
}

// ---------- Eventos novos (Etapa 3K, Tarefa 5): montagem pura, usada pelos jobs e testada sozinha ----------

/** Mesmo formato de `NovoEventoSaida` (src/lib/webhooks.ts), sem os campos de legado. */
export type EventoHook = { evento: Evento; campanhaId: string | null; dados: Record<string, unknown>; chave?: string };

/** Tira as chaves `undefined` (o JSON do payload não leva campo vazio à toa). */
function limpo(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

/** "2026-10-17" em Brasília (UTC−3, sem horário de verão desde 2019), pras chaves diárias. */
export function diaBrasilia(agora: Date): string {
  return new Date(agora.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
}

/** Hora e minuto de Brasília. */
export function horaBrasilia(agora: Date): { hora: number; minuto: number } {
  const b = new Date(agora.getTime() - 3 * 3600_000);
  return { hora: b.getUTCHours(), minuto: b.getUTCMinutes() };
}

/** Horários (Brasília) dos envios de métricas: "7h, 12h e 17h". */
export const HORAS_METRICAS = [7, 12, 17] as const;
/** Minutos depois da hora cheia em que o passo ainda tenta (um tick perdido não perde o horário). A chave
 *  `metricas:{id}:{data}:{hora}` impede repetir dentro da janela. */
export const JANELA_METRICAS_MIN = 15;

export function horaDeMetricas(agora: Date): number | null {
  const { hora, minuto } = horaBrasilia(agora);
  return (HORAS_METRICAS as readonly number[]).includes(hora) && minuto < JANELA_METRICAS_MIN ? hora : null;
}

type CampanhaDoEvento = { campanhaId: string; campanhaSlug?: string; campanhaNome?: string };

export function eventoGrupoSuspenso(g: CampanhaDoEvento & { grupoId: string; grupoNome: string; groupId?: string; conexaoId?: string | null }, agora = new Date()): EventoHook {
  return {
    evento: "grupo_suspenso",
    campanhaId: g.campanhaId,
    dados: limpo({ grupo_id: g.grupoId, grupo: g.grupoNome, group_id: g.groupId, campanha: g.campanhaSlug, campanha_nome: g.campanhaNome, conta_id: g.conexaoId ?? undefined, descricao: DESCRICAO_PAYLOAD_SUSPENSO }),
    chave: `grupo_suspenso:${g.grupoId}:${diaBrasilia(agora)}`,
  };
}

/** `conferidoEm` é o lido ANTES de marcar cheio (o mesmo que a redefinição de link usa): link e conferência que
 *  virem o mesmo enchimento geram a mesma chave e o evento não duplica. */
export function eventoGrupoCheio(g: CampanhaDoEvento & { grupoId: string; grupoNome: string; participantes: number; conferidoEm: string | null | undefined; origem: "conferencia" | "link" }): EventoHook {
  const marca = g.conferidoEm && Number.isFinite(Date.parse(g.conferidoEm)) ? new Date(g.conferidoEm).toISOString() : "nunca";
  return {
    evento: "grupo_cheio",
    campanhaId: g.campanhaId,
    dados: limpo({ grupo_id: g.grupoId, grupo: g.grupoNome, participantes: g.participantes, campanha: g.campanhaSlug, campanha_nome: g.campanhaNome, origem: g.origem }),
    chave: `grupo_cheio:${g.grupoId}:${marca}`,
  };
}

export function eventoGrupoCriado(g: CampanhaDoEvento & { grupoId: string; grupoNome: string; groupId: string; numero: number; link: string | null | undefined; conexaoId: string }): EventoHook {
  return {
    evento: "grupo_criado",
    campanhaId: g.campanhaId,
    dados: limpo({ grupo_id: g.grupoId, grupo: g.grupoNome, group_id: g.groupId, numero: g.numero, link_convite: g.link ?? null, campanha: g.campanhaSlug, campanha_nome: g.campanhaNome, conta_id: g.conexaoId }),
    chave: `grupo_criado:${g.grupoId}`,
  };
}

export function eventoSemConta(c: CampanhaDoEvento & { motivo: string }, agora = new Date()): EventoHook {
  return {
    evento: "sem_conta",
    campanhaId: c.campanhaId,
    dados: limpo({ campanha: c.campanhaSlug, campanha_nome: c.campanhaNome, motivo: c.motivo }),
    chave: `sem_conta:${c.campanhaId}:${diaBrasilia(agora)}`,
  };
}

/** Nos pontos que criam os alertas `execucao_bloqueada` e `tarefa_erro` (mesmo texto do alerta). */
export function eventoFalhaDisparo(f: CampanhaDoEvento & { execucaoId: string; tipo: string; tipoNome?: string; motivo: "bloqueada" | "parada" | "erros"; texto: string }): EventoHook {
  return {
    evento: "falha_disparo",
    campanhaId: f.campanhaId,
    dados: limpo({ execucao_id: f.execucaoId, tipo: f.tipo, tipo_nome: f.tipoNome, motivo: f.motivo, texto: f.texto, campanha: f.campanhaSlug, campanha_nome: f.campanhaNome }),
  };
}

export function eventoAcaoConcluida(a: CampanhaDoEvento & { execucaoId: string; tipo: string; tipoNome?: string; total: number; enviadas: number | null; erros: number | null }): EventoHook {
  return {
    evento: "acao_concluida",
    campanhaId: a.campanhaId,
    dados: limpo({ execucao_id: a.execucaoId, tipo: a.tipo, tipo_nome: a.tipoNome, total: a.total, enviadas: a.enviadas, erros: a.erros, campanha: a.campanhaSlug, campanha_nome: a.campanhaNome }),
    chave: `acao:${a.execucaoId}`,
  };
}

export function eventoContaPareada(c: { conexaoId: string; nome?: string | null; telefone: string | null }): EventoHook {
  return { evento: "conta_pareada", campanhaId: null, dados: limpo({ conta_id: c.conexaoId, conta: c.nome ?? undefined, telefone: c.telefone }) };
}

export function eventoContaDeslogada(c: { conexaoId: string; nome: string; telefone: string | null; motivo: string }): EventoHook {
  return { evento: "conta_deslogada", campanhaId: null, dados: { conta_id: c.conexaoId, conta: c.nome, telefone: c.telefone, motivo: c.motivo } };
}

export const MAXIMO_TEXTO_MENSAGEM = 4096;

/** Tipos de conteúdo do ReceivedCallback do Zapbot (a primeira chave presente decide). */
const TIPOS_RECEBIDA = ["text", "image", "audio", "video", "document", "sticker", "location", "contact", "reaction", "buttonsResponseMessage", "listResponseMessage", "poll"] as const;

type Recebida = {
  type?: unknown;
  isGroup?: unknown;
  fromMe?: unknown;
  isNewsletter?: unknown;
  broadcast?: unknown;
  phone?: unknown;
  messageId?: unknown;
  [k: string]: unknown;
};

/** Mensagem privada recebida (ReceivedCallback que não é de grupo, nem enviada pela própria conta, nem de
 *  status/lista/canal) → `{ telefone, tipo, texto, messageId }`; o resto → null. Texto cortado em 4096. */
export function lerMensagemRecebida(e: Recebida): { telefone: string; tipo: string; texto: string; messageId: string | null } | null {
  if (!e || e.type !== "ReceivedCallback") return null;
  if (e.isGroup === true || e.fromMe === true || e.isNewsletter === true || e.broadcast === true) return null;
  if (typeof e.phone !== "string" || !e.phone.trim()) return null;
  const telefone = e.phone.trim();
  // Id de grupo, canal ou lista de transmissão: não é PV.
  if (/@(g\.us|newsletter|broadcast)$/i.test(telefone) || /-group$/i.test(telefone)) return null;
  const tipo = TIPOS_RECEBIDA.find((t) => e[t] !== undefined && e[t] !== null) ?? "outro";
  const conteudo = e[tipo] as Record<string, unknown> | undefined;
  const bruto = tipo === "text" ? conteudo?.message : (conteudo?.caption ?? conteudo?.message ?? conteudo?.title);
  const texto = typeof bruto === "string" ? bruto.slice(0, MAXIMO_TEXTO_MENSAGEM) : "";
  return { telefone, tipo, texto, messageId: typeof e.messageId === "string" && e.messageId ? e.messageId : null };
}

export function eventoMensagemRecebida(m: { conexaoId: string; conta: string | null; telefone: string; tipo: string; texto: string; messageId: string | null }): EventoHook {
  return {
    evento: "mensagem_recebida",
    campanhaId: null,
    dados: { conta_id: m.conexaoId, conta: m.conta, telefone: m.telefone, tipo: m.tipo, texto: m.texto, messageId: m.messageId },
    ...(m.messageId ? { chave: `mensagem:${m.conexaoId}:${m.messageId}` } : {}),
  };
}

// ---------- Solicitações de entrada em grupos (Etapa 3N, Tarefa 3) ----------

/** SHA-1 em hex, puro (sem `node:crypto`: este arquivo também roda no cliente, no assistente). Só pra chave de
 *  idempotência, não é segurança. */
export function sha1Hex(texto: string): string {
  const bytes = new TextEncoder().encode(texto);
  const len = bytes.length;
  const total = (((len + 8) >> 6) + 1) << 6;
  const m = new Uint8Array(total);
  m.set(bytes);
  m[len] = 0x80;
  const bits = len * 8;
  const dv = new DataView(m.buffer);
  dv.setUint32(total - 8, Math.floor(bits / 0x100000000));
  dv.setUint32(total - 4, bits >>> 0);
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  const rol = (x: number, n: number) => (x << n) | (x >>> (32 - n));
  for (let i = 0; i < total; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = dv.getUint32(i + t * 4);
    for (let t = 16; t < 80; t++) w[t] = rol(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1);
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let t = 0; t < 80; t++) {
      const f = t < 20 ? (b & c) | (~b & d) : t < 40 ? b ^ c ^ d : t < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d;
      const k = t < 20 ? 0x5a827999 : t < 40 ? 0x6ed9eba1 : t < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const tmp = (rol(a, 5) + f + e + k + w[t]) >>> 0;
      e = d;
      d = c;
      c = rol(b, 30) >>> 0;
      b = a;
      a = tmp;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }
  return [h0, h1, h2, h3, h4].map((x) => x.toString(16).padStart(8, "0")).join("");
}

/** Pedidos por evento de `solicitacoes_entrada` (o resto vai em outro evento, com chave própria). */
export const LOTE_SOLICITACOES_HOOK = 100;

export type ItemSolicitacaoHook = {
  telefone: string;
  pedidoEm: string | null;
  /** Só no `tipo: "decisao"`. */
  decisao?: string;
  origem?: string;
  motivo?: string | null;
  /** Quando o pedido foi visto pela primeira vez (`visto_em`): entra na chave quando falta `pedidoEm`. Não vai no payload. */
  vistoEm?: string | null;
};

/** Eventos `solicitacoes_entrada` de um grupo: `pendentes` (pedidos vistos pela primeira vez) ou `decisao` (aprovada,
 *  recusada, cancelada, expirada), em lotes de `LOTE_SOLICITACOES_HOOK`. Itens repetidos (mesmo telefone e
 *  decisão) entram uma vez e a ordem é a do telefone, então a mesma lista sempre dá os mesmos lotes. A chave
 *  `solicitacoes:{tipo}:{grupoId}:{sha1 curto}` vem dos telefones, decisões e `pedido_em` do lote (sem `pedido_em`, o
 *  `visto_em` do pedido; sem os dois, o dia de `agora` em Brasília). A entrega é pelo menos uma vez: a chave evita que
 *  o mesmo lote vá de novo pro mesmo webhook, mas leituras concorrentes (aba e conferência) ou lotes cortados de outro
 *  jeito ainda podem repetir um pedido; quem recebe deve tratar `telefone` + `tipo` como idempotente. Nenhum telefone
 *  aparece na chave. */
export function eventosSolicitacoes(s: CampanhaDoEvento & {
  grupoId: string;
  grupoNome: string | null;
  groupId?: string | null;
  tipo: "pendentes" | "decisao";
  itens: readonly ItemSolicitacaoHook[];
  agora?: Date | string;
}): EventoHook[] {
  const agora = s.agora === undefined ? new Date() : typeof s.agora === "string" ? new Date(s.agora) : s.agora;
  const dia = diaBrasilia(Number.isFinite(agora.getTime()) ? agora : new Date());
  const unicos = new Map<string, ItemSolicitacaoHook>();
  for (const i of s.itens) {
    const telefone = i.telefone?.trim();
    if (!telefone) continue;
    const k = `${telefone}|${s.tipo === "decisao" ? (i.decisao ?? "") : ""}`;
    if (!unicos.has(k)) unicos.set(k, { ...i, telefone });
  }
  const ordenados = [...unicos.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, i]) => i);
  const eventos: EventoHook[] = [];
  for (let n = 0; n < ordenados.length; n += LOTE_SOLICITACOES_HOOK) {
    const lote = ordenados.slice(n, n + LOTE_SOLICITACOES_HOOK);
    const base = lote.map((i) => `${i.telefone}|${s.tipo === "decisao" ? (i.decisao ?? "") : ""}|${i.pedidoEm ?? i.vistoEm ?? dia}`).join("\n");
    eventos.push({
      evento: "solicitacoes_entrada",
      campanhaId: s.campanhaId,
      dados: limpo({
        tipo: s.tipo,
        campanha: s.campanhaSlug,
        campanha_nome: s.campanhaNome,
        grupo_id: s.grupoId,
        grupo: s.grupoNome ?? undefined,
        group_id: s.groupId ?? undefined,
        total: lote.length,
        solicitacoes: lote.map((i) =>
          limpo({
            telefone: i.telefone,
            pedido_em: i.pedidoEm ?? null,
            decisao: s.tipo === "decisao" ? i.decisao : undefined,
            origem: s.tipo === "decisao" ? i.origem : undefined,
            motivo: s.tipo === "decisao" ? (i.motivo ?? undefined) : undefined,
          }),
        ),
      }),
      chave: `solicitacoes:${s.tipo}:${s.grupoId}:${sha1Hex(base).slice(0, 16)}`,
    });
  }
  return eventos;
}

/** Exemplo de payload de cada `tipo` de `solicitacoes_entrada` (passo "teste" do assistente). Números fictícios. */
export const EXEMPLOS_SOLICITACOES: { tipo: "pendentes" | "decisao"; payload: Record<string, unknown> }[] = [
  {
    tipo: "pendentes",
    payload: {
      evento: "solicitacoes_entrada",
      tipo: "pendentes",
      campanha: "aulao",
      campanha_nome: "Aulão",
      grupo_id: "…",
      grupo: "Turma 01",
      group_id: "120363000000000000@g.us",
      total: 1,
      solicitacoes: [{ telefone: "5511" + "900000000", pedido_em: "2026-10-17T12:00:00.000Z" }],
      em: "2026-10-17T12:01:00.000Z",
    },
  },
  {
    tipo: "decisao",
    payload: {
      evento: "solicitacoes_entrada",
      tipo: "decisao",
      campanha: "aulao",
      campanha_nome: "Aulão",
      grupo_id: "…",
      grupo: "Turma 01",
      group_id: "120363000000000000@g.us",
      total: 1,
      solicitacoes: [{ telefone: "5511" + "900000000", pedido_em: "2026-10-17T12:00:00.000Z", decisao: "aprovada", origem: "automatica", motivo: "Aprovação automática" }],
      em: "2026-10-17T12:03:00.000Z",
    },
  },
];

/** Webhooks ativos (não arquivados) que pediram algum destes eventos: serve pra pular o trabalho quando ninguém escuta. */
export function alguemEscuta(ws: WebhookCadastrado[] | null | undefined, eventos: Evento[]): boolean {
  return !!ws?.some((w) => w.ativo && !w.arquivado && eventos.some((ev) => w.eventos.includes(ev)));
}

/** Passos do assistente de webhooks de saída. */
export const PASSOS_HOOK = [
  { rotulo: "Webhook", icone: "webhook" },
  { rotulo: "teste", icone: "play_arrow" },
  { rotulo: "Confirmar", icone: "check" },
] as const;

/** O que falta no passo "Webhook" pra seguir (null = pode seguir). Mesmas regras do `validarWebhook`. */
/** `token`: o token novo que o assistente tem na mão (criação ou "Gerar novo"); null na edição sem "Gerar novo"
 *  (o gravado não é mostrado nem mexido). Na criação (`criacao`) ele é obrigatório. */
export function pendenciaHook(e: { nome: string; url: string; eventos: string[]; campanhas: string[] | null; token: string | null; criacao?: boolean }): string | null {
  if (e.criacao !== false && !e.token) return "Aguarde o token.";
  if (e.token && !tokenValido(e.token)) return "Token inválido.";
  const v = validarWebhook({ nome: e.nome, url: e.url.trim(), eventos: e.eventos, campanhas: e.campanhas });
  if (!v.ok) return v.erro;
  if (e.campanhas !== null && !e.campanhas.length) return "Marque pelo menos uma campanha ou escolha todas.";
  return null;
}
