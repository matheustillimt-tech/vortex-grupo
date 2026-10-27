import "server-only";

/* Cliente da API do Zapbot (https://api.zapbot.online/docs). Só o backend chama.
   Conta (/account/*) usa JWT com relogin no 401; conexão (/instances/{id}/token/{token}/*) usa Client-Token.
   Nova tentativa só em 429 e em 502/503 sem JSON (reinício rápido do servidor do Zapbot).
   Cliente do Zapbot: rotas de instância e mensagem, mais as rotas de grupo. */

export type ZapbotConexao = { id: string; token: string; clientToken: string };
/** Item de `GET contacts` (Etapa 3K, Tarefa 4). Sem paginação nem "verificado" na doc. */
export type ZapbotContato = { phone: string; name: string; short: string; notify: string };
export type ZapbotGrupo = {
  groupId: string;
  name: string;
  amAdmin: boolean;
  participantCount: number;
  participants: { phone: string; isAdmin: boolean }[];
  /** Foto do grupo (Etapa 3M). Só `https://`; outro valor (vazio, `http:`) = `null`. Ausente na resposta =
   *  `undefined` ("não sei": quem chama decide se pergunta na rota `groups/{id}/avatar`). */
  avatarUrl?: string | null;
  /** Pedidos de entrada vão para a fila de aprovação (`group-mode` `requireApproval`). Ausente = `undefined`. */
  requireApproval?: boolean;
  isCommunity?: boolean;
  /** Grupo de avisos de uma comunidade. */
  isAnnouncementGroup?: boolean;
  /** Comunidade a que o grupo está ligado; `null` quando a resposta diz que não tem. Ausente = `undefined`. */
  communityId?: string | null;
};
/** Pedido de entrada na fila de aprovação (`GET groups/{id}/pending`, Etapa 3M). */
export type ZapbotPedido = { telefone: string; pedidoEm: string | null };
type Json = Record<string, unknown>;
/** Botão de send-button-actions. COPY: a doc lista o tipo, mas não o campo do texto copiado (ver `copyCode`). */
export type ZapbotBotao =
  | { type: "REPLY"; id: string; label: string }
  | { type: "URL"; label: string; url: string }
  | { type: "CALL"; label: string; phone: string }
  | { type: "COPY"; label: string; copyCode: string };

export class ZapbotError extends Error {
  constructor(readonly status: number, message: string, readonly body: Json) {
    super(message);
    this.name = "ZapbotError";
  }
}

type Opcoes = {
  baseUrl: string;
  email: string;
  password: string;
  jwt?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  /** Relógio (ms), só pra teste do prazo total. */
  agora?: () => number;
};

/** Prazo total (tentativas + esperas do 429) das rotas chamadas por um clique na tela: a pessoa não fica mais que
 *  ~20 s esperando. Rotas da fila/cron não passam prazo (comportamento de sempre). */
export const PRAZO_TELA_MS = 20_000;
/** Opções por chamada. `prazoTotalMs`: teto da chamada inteira, contando as novas tentativas. */
export type OpcoesChamada = { prazoTotalMs?: number };

export class ZapbotClient {
  private jwt: string | undefined;
  private readonly doFetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly agora: () => number;

  constructor(private readonly opts: Opcoes) {
    this.jwt = opts.jwt || undefined;
    this.doFetch = opts.fetch ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.agora = opts.agora ?? (() => Date.now());
  }

  private async http(method: string, path: string, headers: Record<string, string> = {}, body?: unknown, timeoutMs?: number, prazoTotalMs?: number) {
    const fim = prazoTotalMs ? this.agora() + prazoTotalMs : Infinity;
    for (let tentativa = 0; ; tentativa++) {
      const timeout = timeoutMs ?? this.opts.timeoutMs ?? 30_000;
      const res = await this.doFetch(this.opts.baseUrl + path, {
        method,
        headers: body === undefined ? headers : { ...headers, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        // Com prazo total: cada tentativa só usa o tempo que sobra (mínimo 1 s).
        signal: AbortSignal.timeout(Number.isFinite(fim) ? Math.max(1000, Math.min(timeout, fim - this.agora())) : timeout),
        cache: "no-store",
      });
      const texto = await res.text();
      let json: Json = {};
      let ehJson = true;
      try {
        json = texto ? (JSON.parse(texto) as Json) : {};
      } catch {
        ehJson = false;
        json = { error: `Resposta inesperada do Zapbot (HTTP ${res.status}).` };
      }
      const repetir = res.status === 429 || (!ehJson && (res.status === 502 || res.status === 503 || res.status === 504));
      if (!repetir || tentativa >= 3) return { status: res.status, json };
      const espera = 1000 * 2 ** tentativa;
      // Sem tempo pra esperar e tentar de novo dentro do prazo: devolve a resposta que tem (429 vira erro).
      if (this.agora() + espera + 1000 > fim) return { status: res.status, json };
      await this.sleep(espera);
    }
  }

  private falha(status: number, json: Json) {
    return new ZapbotError(status, typeof json.error === "string" ? json.error : `HTTP ${status}`, json);
  }

  private async login() {
    const r = await this.http("POST", "/auth/login", {}, { email: this.opts.email, password: this.opts.password });
    if (r.status !== 200 || typeof r.json.token !== "string") throw this.falha(r.status, r.json);
    this.jwt = r.json.token;
  }

  private async conta(method: string, path: string, body?: unknown): Promise<Json> {
    if (!this.jwt) await this.login();
    let r = await this.http(method, path, { Authorization: `Bearer ${this.jwt}` }, body);
    if (r.status === 401) {
      await this.login();
      r = await this.http(method, path, { Authorization: `Bearer ${this.jwt}` }, body);
    }
    if (r.status >= 400) throw this.falha(r.status, r.json);
    return r.json;
  }

  private instancia(c: ZapbotConexao, method: string, rota: string, body?: unknown, timeoutMs?: number, prazoTotalMs?: number) {
    return this.http(method, `/instances/${c.id}/token/${c.token}/${rota}`, { "Client-Token": c.clientToken }, body, timeoutMs, prazoTotalMs);
  }

  private async instanciaOk(c: ZapbotConexao, method: string, rota: string, body?: unknown, timeoutMs?: number, prazoTotalMs?: number): Promise<Json> {
    const r = await this.instancia(c, method, rota, body, timeoutMs, prazoTotalMs);
    if (r.status >= 400) throw this.falha(r.status, r.json);
    return r.json;
  }

  // Conta

  async criarConexao(d: { nome: string; webhookUrl: string; clientToken: string }): Promise<{ id: string; token: string }> {
    const json = await this.conta("POST", "/account/instances", { name: d.nome, webhookUrl: d.webhookUrl, clientToken: d.clientToken });
    return { id: String(json.id), token: String(json.token) };
  }

  async apagarConexao(id: string): Promise<void> {
    await this.conta("DELETE", `/account/instances/${id}`);
  }

  // Conexão

  async status(c: ZapbotConexao): Promise<{ connected: boolean; phone: string; error?: string }> {
    const json = await this.instanciaOk(c, "GET", "status");
    const out: { connected: boolean; phone: string; error?: string } = { connected: json.connected === true, phone: String(json.phone ?? "") };
    if (typeof json.error === "string" && json.error) out.error = json.error;
    return out;
  }

  async qrCode(c: ZapbotConexao): Promise<{ estado: "pronto"; imagem: string } | { estado: "aguarde" | "conectado" }> {
    const r = await this.instancia(c, "GET", "qr-code/image");
    if (r.status === 200 && typeof r.json.value === "string") return { estado: "pronto", imagem: r.json.value };
    if (r.status === 202) return { estado: "aguarde" };
    if (r.status === 409) return { estado: "conectado" };
    throw this.falha(r.status, r.json);
  }

  async codigoPareamento(c: ZapbotConexao, telefone: string): Promise<{ estado: "pronto"; codigo: string } | { estado: "aguarde" | "conectado" }> {
    const r = await this.instancia(c, "GET", `phone-code/${telefone.replace(/\D/g, "")}`);
    if (r.status === 200 && typeof r.json.code === "string") return { estado: "pronto", codigo: r.json.code };
    if (r.status === 202) return { estado: "aguarde" };
    if (r.status === 409) return { estado: "conectado" };
    throw this.falha(r.status, r.json);
  }

  async reiniciar(c: ZapbotConexao): Promise<void> {
    await this.instanciaOk(c, "GET", "restart");
  }

  /** `disconnect`: termina a sessão do WhatsApp (a instância continua existindo, mas precisa de QR/código novo
   *  pra parear de novo) — diferente de `reiniciar`, que mantém o pareamento. Usada por "Desconectar" e
   *  "Finalizar Sessão" (Etapa 3G, Tarefa 3; conferida em https://api.zapbot.online/docs em 17/10/2026). */
  async desconectar(c: ZapbotConexao): Promise<void> {
    await this.instanciaOk(c, "GET", "disconnect");
  }

  /** `phone-exists` por esta conexão: o número tem conta no WhatsApp? A resposta real é um array puro; a doc mostra
   *  `{ exists: [...] }` — aceitamos os dois. null quando a resposta não traz o número. */
  async numeroExiste(c: ZapbotConexao, telefone: string): Promise<boolean | null> {
    const numero = telefone.replace(/\D/g, "");
    const json = await this.instanciaOk(c, "POST", "phone-exists", { phones: [numero] }, 15_000);
    const bruto = json as unknown;
    const lista = Array.isArray(bruto) ? (bruto as Json[]) : Array.isArray(json.exists) ? (json.exists as Json[]) : [];
    const item = lista.find((i) => String(i.phone ?? "").replace(/\D/g, "") === numero) ?? (lista.length === 1 ? lista[0] : undefined);
    return typeof item?.exists === "boolean" ? item.exists : null;
  }

  // Grupos

  /** A API devolve um array puro (`[{...}]`); aceitamos também o formato antigo `{ groups: [...] }` por segurança.
   *  Nenhum dos dois traz `participants` — use `obterGrupo` quando precisar deles. */
  async listarGrupos(c: ZapbotConexao, o: OpcoesChamada = {}): Promise<ZapbotGrupo[]> {
    const json = await this.instanciaOk(c, "GET", "groups", undefined, undefined, o.prazoTotalMs);
    const bruto = json as unknown;
    const lista = Array.isArray(bruto) ? (bruto as Json[]) : Array.isArray(json.groups) ? (json.groups as Json[]) : [];
    return lista.map(grupoDaResposta);
  }

  /** GET de um grupo específico: só essa rota devolve `participants`. null quando o grupo não existe mais (404).
   *  Leitura leve (Etapa 3M): `participantes: false` manda `?participants=false` (a resposta traz só a contagem, e
   *  `participants` vem `[]`); `link: false` manda `?inviteLink=false` (pula a consulta extra do link). Sem opções =
   *  a URL de sempre. `prazoTotalMs`: ver `OpcoesChamada` (leituras disparadas por um clique na tela). */
  async obterGrupo(c: ZapbotConexao, groupId: string, o: { participantes?: boolean; link?: boolean } & OpcoesChamada = {}): Promise<ZapbotGrupo | null> {
    const query = [o.participantes === false ? "participants=false" : "", o.link === false ? "inviteLink=false" : ""].filter(Boolean).join("&");
    const r = await this.instancia(c, "GET", `groups/${groupId}${query ? `?${query}` : ""}`, undefined, undefined, o.prazoTotalMs);
    if (r.status === 404) return null;
    if (r.status >= 400) throw this.falha(r.status, r.json);
    return grupoDaResposta(r.json);
  }

  async criarGrupo(c: ZapbotConexao, nome: string, telefones: string[]): Promise<string> {
    const json = await this.instanciaOk(c, "POST", "create-group", { name: nome, phones: telefones });
    const id = json.groupId ?? json.id ?? json.phone;
    if (typeof id !== "string" || !id) throw new ZapbotError(200, "create-group não devolveu o ID do grupo", json);
    return id.includes("@") ? id : `${id}@g.us`;
  }

  async participantes(c: ZapbotConexao, groupId: string, telefones: string[], acao: "add" | "remove" | "promote" | "demote"): Promise<void> {
    await this.instanciaOk(c, "POST", "group-participants", { groupId, phones: telefones, action: acao });
  }

  /** group-participants com `remove`, devolvendo quem SAIU segundo a resposta. A doc diz que a resposta traz o
   *  resultado de cada número, mas não mostra o formato: aceitamos uma lista (na raiz ou em `results`/`participants`/
   *  `phones`) de itens com `phone` e `status`/`success`/`error`. Sem lista reconhecível, devolve `null` (quem chama
   *  assume que todos saíram, como antes). */
  async removerParticipantes(c: ZapbotConexao, groupId: string, telefones: string[]): Promise<string[] | null> {
    const json = await this.instanciaOk(c, "POST", "group-participants", { groupId, phones: telefones, action: "remove" });
    return removidosDaResposta(json);
  }

  /** group-participants (`add`/`promote`/…) devolvendo quem DEU CERTO segundo a resposta, no mesmo formato aceito
   *  por `removerParticipantes` (lista na raiz ou em `results`/`participants`/`phones`, itens com `phone`/`jid` e
   *  `status`/`success`/`error`). Mesma rota e mesmo corpo de `participantes`. Sem lista reconhecível, devolve
   *  `null` (quem chama assume que todos deram certo, como `participantes` sempre assumiu). Etapa 3K. */
  async participantesComResultado(c: ZapbotConexao, groupId: string, telefones: string[], acao: "add" | "remove" | "promote" | "demote"): Promise<string[] | null> {
    const json = await this.instanciaOk(c, "POST", "group-participants", { groupId, phones: telefones, action: acao });
    return participantesOkDaResposta(json);
  }

  async configurarGrupo(c: ZapbotConexao, d: { groupId: string; name?: string; description?: string; announce?: boolean; locked?: boolean }): Promise<void> {
    await this.instanciaOk(c, "PUT", "group-settings", d);
  }

  async linkConvite(c: ZapbotConexao, groupId: string, redefinir = false): Promise<string> {
    const json = await this.instanciaOk(c, "POST", "group-invite-link", redefinir ? { groupId, reset: true } : { groupId });
    if (typeof json.inviteLink !== "string") throw new ZapbotError(200, "group-invite-link sem inviteLink", json);
    return json.inviteLink;
  }

  async criarComunidade(c: ZapbotConexao, nome: string, descricao: string): Promise<string> {
    const json = await this.instanciaOk(c, "POST", "create-community", { name: nome, description: descricao });
    if (typeof json.groupId !== "string") throw new ZapbotError(200, "create-community sem groupId", json);
    return json.groupId;
  }

  async ligarGrupo(c: ZapbotConexao, comunidadeId: string, groupId: string): Promise<void> {
    await this.instanciaOk(c, "POST", "link-group", { communityId: comunidadeId, groupId });
  }

  // Envio

  async enviar(c: ZapbotConexao, rota: string, corpo: Json): Promise<string> {
    const json = await this.instanciaOk(c, "POST", rota, corpo);
    if (typeof json.messageId !== "string") throw new ZapbotError(200, `${rota} sem messageId`, json);
    return json.messageId;
  }

  // Formatos novos (Etapa 3C). Corpos conferidos em https://api.zapbot.online/docs em 17/10/2026.

  /** send-sticker: URL ou base64 (PNG/JPEG viram WebP; GIF vira figurinha animada). */
  async enviarFigurinha(c: ZapbotConexao, groupId: string, url: string): Promise<string> {
    return this.enviar(c, "send-sticker", { phone: groupId, sticker: url });
  }

  /** send-video com `gif: true`: toca em loop e sem som, como GIF. */
  async enviarGif(c: ZapbotConexao, groupId: string, url: string, legenda: string): Promise<string> {
    return this.enviar(c, "send-video", { phone: groupId, video: url, gif: true, ...(legenda ? { caption: legenda } : {}) });
  }

  async enviarContato(c: ZapbotConexao, groupId: string, nome: string, telefone: string): Promise<string> {
    return this.enviar(c, "send-contact", { phone: groupId, contactName: nome, contactPhone: telefone });
  }

  /** send-event: horários em segundos Unix; `name` e `startTime` obrigatórios. `location` da doc pede
   *  latitude/longitude e só temos o nome do local: ele vai no fim da descrição, e `location` não é mandado. */
  async enviarEvento(c: ZapbotConexao, groupId: string, e: { nome: string; descricao: string | null; inicio: number; fim: number | null; local: string | null }): Promise<string> {
    const descricao = [e.descricao?.trim(), e.local?.trim() ? `Local: ${e.local.trim()}` : ""].filter(Boolean).join("\n\n");
    return this.enviar(c, "send-event", {
      phone: groupId,
      name: e.nome,
      startTime: e.inicio,
      ...(e.fim !== null ? { endTime: e.fim } : {}),
      ...(descricao ? { description: descricao } : {}),
    });
  }

  /** send-button-actions: até 3 botões; `type` REPLY (id + label), URL (url), CALL (phone), COPY. */
  async enviarBotoes(c: ZapbotConexao, groupId: string, texto: string, botoes: ZapbotBotao[]): Promise<string> {
    return this.enviar(c, "send-button-actions", { phone: groupId, message: texto, buttons: botoes });
  }

  /** pin-message: fixa uma mensagem que a própria conexão mandou (`fromMe: true`). duration 24h, 7d ou 30d. */
  async fixarMensagem(c: ZapbotConexao, groupId: string, messageId: string, duracao: "24h" | "7d" | "30d"): Promise<void> {
    await this.instanciaOk(c, "POST", "pin-message", { phone: groupId, messageId, fromMe: true, duration: duracao });
  }

  /** chat-disappearing: seconds 0 (desliga), 86400, 604800 ou 7776000. */
  async mensagensTemporarias(c: ZapbotConexao, groupId: string, segundos: 0 | 86400 | 604800 | 7776000): Promise<void> {
    await this.instanciaOk(c, "POST", "chat-disappearing", { phone: groupId, seconds: segundos });
  }

  /** group-mode: `requireApproval` põe quem entra pelo link numa fila de aprovação. */
  async modoEntrada(c: ZapbotConexao, groupId: string, aprovacao: boolean): Promise<void> {
    await this.instanciaOk(c, "PUT", "group-mode", { groupId, requireApproval: aprovacao });
  }

  // Etapa 3M. Corpos das rotas de grupo do Zapbot.

  /** group-picture: troca a foto do grupo. Só URL `https://` (recusada aqui, sem chamar o Zapbot). Rota separada do
   *  `group-settings` de propósito: falha da foto não derruba nome/descrição/fechado. */
  async trocarFoto(c: ZapbotConexao, groupId: string, url: string): Promise<void> {
    if (!url.startsWith("https://")) throw new ZapbotError(400, "A imagem do grupo precisa ser um link https://.", {});
    await this.instanciaOk(c, "PUT", "group-picture", { groupId, image: url });
  }

  /** groups/{id}/avatar: URL da foto (`https://`) ou `null` (sem foto, URL estranha ou grupo não encontrado — 404).
   *  Timeout de 15 s. */
  async fotoDoGrupo(c: ZapbotConexao, groupId: string, o: OpcoesChamada = {}): Promise<string | null> {
    const r = await this.instancia(c, "GET", `groups/${groupId}/avatar`, undefined, 15_000, o.prazoTotalMs);
    if (r.status === 404) return null;
    if (r.status >= 400) throw this.falha(r.status, r.json);
    return urlHttps(r.json.avatarUrl) ?? null;
  }

  /** groups/{id}/pending: pedidos de entrada na fila de aprovação. Aceita a lista na raiz ou em `pending`/`requests`;
   *  `phone` sem o `@…` (menos `@lid`, que fica) e `requestedAt` (ms) em ISO. `null` = grupo não encontrado (404) ou
   *  resposta num formato não reconhecido: leitura incompleta, quem chama não fecha nada. */
  async pedidosPendentes(c: ZapbotConexao, groupId: string, o: OpcoesChamada & { timeoutMs?: number } = {}): Promise<ZapbotPedido[] | null> {
    const r = await this.instancia(c, "GET", `groups/${groupId}/pending`, undefined, o.timeoutMs, o.prazoTotalMs);
    if (r.status === 404) return null;
    if (r.status >= 400) throw this.falha(r.status, r.json);
    return pedidosDaResposta(r.json);
  }

  /** group-review: aprova ou recusa pedidos de entrada (no máximo `MAX_REVISAO` números por chamada; quem chama
   *  fatia). Devolve os números que deram certo segundo a resposta; sem lista reconhecível = `null` (quem chama
   *  considera todos ok, como em `participantesComResultado`). */
  async revisarPedidos(c: ZapbotConexao, groupId: string, telefones: string[], acao: "approve" | "reject", o: OpcoesChamada = {}): Promise<string[] | null> {
    if (telefones.length > MAX_REVISAO) throw new ZapbotError(400, `No máximo ${MAX_REVISAO} pedidos por vez.`, {});
    const json = await this.instanciaOk(c, "POST", "group-review", { groupId, phones: telefones, action: acao }, undefined, o.prazoTotalMs);
    return okDaResposta(json, revisaoOkNaResposta);
  }

  /** leave-group: a conta sai do grupo. */
  async sairDoGrupo(c: ZapbotConexao, groupId: string, o: OpcoesChamada = {}): Promise<void> {
    await this.instanciaOk(c, "POST", "leave-group", { groupId }, undefined, o.prazoTotalMs);
  }

  /** deactivate-community: os grupos ligados continuam existindo, soltos. */
  async desativarComunidade(c: ZapbotConexao, comunidadeId: string): Promise<void> {
    await this.instanciaOk(c, "POST", "deactivate-community", { communityId: comunidadeId });
  }

  // Etapa 3K, Tarefa 3. Corpos conferidos em https://api.zapbot.online/docs em 17/10/2026.

  /** join-group: a conta entra no grupo pelo convite (`inviteLink` = link completo de chat.whatsapp.com). A resposta
   *  não traz o `groupId` do grupo: quem chama não liga o grupo a nenhuma campanha. */
  async entrarNoGrupo(c: ZapbotConexao, link: string): Promise<void> {
    await this.instanciaOk(c, "POST", "join-group", { inviteLink: link });
  }

  /** limit-sharing: liga (`value: true`) ou desliga a privacidade avançada da conversa. `phone` aceita número ou
   *  grupo; em grupo a doc diz "implementado mas ainda não conferido no aparelho" (ver `PROVA.privacidadeEmGrupo`). */
  async privacidadeAvancada(c: ZapbotConexao, groupId: string, valor: boolean): Promise<void> {
    await this.instanciaOk(c, "POST", "limit-sharing", { phone: groupId, value: valor });
  }

  /** `contacts`: agenda da conta no WhatsApp, lida ao vivo (sem tabela de cache — dado pessoal da agenda não
   *  fica no banco, aba "Contatos" do detalhe da conta, Etapa 3K Tarefa 4). A doc não pagina nem diz quem é
   *  "verificado" — os dois `null` da UI (sem total nem selo) são por isso. Timeout de 15s (menor que o padrão de
   *  30s): é lida na hora que a aba abre, nunca deve travar a tela por muito tempo. */
  async contatos(c: ZapbotConexao, o: OpcoesChamada = {}): Promise<ZapbotContato[]> {
    const json = await this.instanciaOk(c, "GET", "contacts", undefined, 15_000, o.prazoTotalMs);
    const bruto = json as unknown;
    const lista = Array.isArray(bruto) ? (bruto as Json[]) : Array.isArray(json.contacts) ? (json.contacts as Json[]) : [];
    return lista
      .filter((p) => typeof p.phone === "string" && p.phone)
      .map((p) => ({ phone: String(p.phone), name: typeof p.name === "string" ? p.name : "", short: typeof p.short === "string" ? p.short : "", notify: typeof p.notify === "string" ? p.notify : "" }));
  }

  // Etapa 3K, Tarefa 6 (anti-spam). Corpos conferidos em https://api.zapbot.online/docs em 17/10/2026.

  /** resolve-lid: número → LID (e LID → número, mandando o LID em `phone`). Resposta `{ phone, lid: "…@lid" }`.
   *  Devolve só os dígitos do LID, ou `null` quando a resposta não traz um LID reconhecível. */
  async resolverLid(c: ZapbotConexao, telefoneOuLid: string, o: OpcoesChamada = {}): Promise<{ telefone: string | null; lid: string } | null> {
    const json = await this.instanciaOk(c, "POST", "resolve-lid", { phone: telefoneOuLid }, 15_000, o.prazoTotalMs);
    const lid = typeof json.lid === "string" ? json.lid.split("@")[0] : "";
    if (!/^[0-9]{6,20}$/.test(lid)) return null;
    const tel = typeof json.phone === "string" ? json.phone.split("@")[0].replace(/\D/g, "") : "";
    return { telefone: tel || null, lid };
  }

  /** block: bloqueia o contato no WhatsApp da conta. Não denuncia (o Zapbot não tem rota de denúncia). */
  async bloquearContato(c: ZapbotConexao, telefone: string): Promise<void> {
    await this.instanciaOk(c, "POST", "block", { phone: telefone });
  }

  /** unblock: mesmo corpo do `block`. */
  async desbloquearContato(c: ZapbotConexao, telefone: string): Promise<void> {
    await this.instanciaOk(c, "POST", "unblock", { phone: telefone });
  }

  // Enquete

  async enviarEnquete(c: ZapbotConexao, groupId: string, pergunta: string, opcoes: string[], maxRespostas: number): Promise<string> {
    return this.enviar(c, "send-poll", { phone: groupId, poll: pergunta, pollOptions: opcoes, maxSelections: maxRespostas });
  }
}

/** Ver `removerParticipantes`. Exportada pra teste. */
export function removerDaRespostaOk(item: Json): boolean {
  if (typeof item.error === "string" && item.error) return false;
  if (item.success === false) return false;
  const st = item.status;
  if (typeof st === "number") return st >= 200 && st < 300;
  if (typeof st === "string") return /^(2\d\d|ok|success|removed|removido)$/i.test(st.trim());
  return item.success === true || st === undefined;
}

export function removidosDaResposta(json: unknown): string[] | null {
  return okDaResposta(json, removerDaRespostaOk);
}

/** Item da resposta de group-participants com `add`/`promote`/`demote` que deu certo (Etapa 3K). Mesmas regras de
 *  `removerDaRespostaOk`, aceitando também "added"/"promoted"/"demoted" no `status` em texto. */
export function participanteOkNaResposta(item: Json): boolean {
  if (typeof item.error === "string" && item.error) return false;
  if (item.success === false) return false;
  const st = item.status;
  if (typeof st === "number") return st >= 200 && st < 300;
  if (typeof st === "string") return /^(2\d\d|ok|success|added|promoted|demoted|removed|adicionado|promovido|rebaixado|removido)$/i.test(st.trim());
  return item.success === true || st === undefined;
}

/** Máximo de números por chamada de `group-review` (Etapa 3M). */
export const MAX_REVISAO = 50;

/** `https://…` ou `null`; `undefined` quando o campo nem veio. */
function urlHttps(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  return typeof v === "string" && v.startsWith("https://") ? v : null;
}

/** Objeto `Group` do Zapbot → `ZapbotGrupo`. Usada por `listarGrupos` e `obterGrupo`. Superadmin conta como admin.
 *  Campos novos (Etapa 3M) só entram quando vieram na resposta. Exportada pra teste. */
export function grupoDaResposta(json: unknown): ZapbotGrupo {
  const g = (json ?? {}) as Json;
  const out: ZapbotGrupo = {
    groupId: String(g.groupId),
    name: String(g.name ?? ""),
    amAdmin: g.amAdmin === true,
    participantCount: typeof g.participantCount === "number" ? g.participantCount : 0,
    participants: (Array.isArray(g.participants) ? (g.participants as Json[]) : []).map((p) => ({
      phone: String(p.phone),
      isAdmin: p.isAdmin === true || p.isSuperAdmin === true,
    })),
  };
  const avatar = urlHttps(g.avatarUrl);
  if (avatar !== undefined) out.avatarUrl = avatar;
  if (typeof g.requireApproval === "boolean") out.requireApproval = g.requireApproval;
  if (typeof g.isCommunity === "boolean") out.isCommunity = g.isCommunity;
  if (typeof g.isAnnouncementGroup === "boolean") out.isAnnouncementGroup = g.isAnnouncementGroup;
  if ("communityId" in g) out.communityId = typeof g.communityId === "string" && g.communityId ? g.communityId : null;
  return out;
}

/** Ver `pedidosPendentes`. Formato não reconhecido (sem lista na raiz nem em `pending`/`requests`) = `null`, nunca
 *  `[]`: uma lista vazia "de mentira" faria quem chama fechar os pedidos já vistos (revisão final A). Exportada pra
 *  teste. */
export function pedidosDaResposta(json: unknown): ZapbotPedido[] | null {
  const j = (json ?? {}) as Json;
  const lista = Array.isArray(json) ? json : [j.pending, j.requests].find((x) => Array.isArray(x));
  if (!Array.isArray(lista)) return null;
  return lista
    .filter((x): x is Json => !!x && typeof x === "object" && typeof (x as Json).phone === "string" && !!(x as Json).phone)
    .map((x) => {
      const ms = typeof x.requestedAt === "number" ? x.requestedAt : typeof x.requestedAt === "string" && /^\d+$/.test(x.requestedAt) ? Number(x.requestedAt) : NaN;
      // `…@lid` continua com o sufixo (Etapa 3M, Tarefa 4): é o único sinal de que o id é um LID e não um telefone
      // (LID nunca é aprovado). Os outros sufixos (`@s.whatsapp.net`, `@c.us`) saem.
      const cru = String(x.phone).trim();
      const telefone = /@lid$/i.test(cru) ? `${cru.split("@")[0]}@lid` : cru.split("@")[0];
      return { telefone, pedidoEm: Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null };
    });
}

/** Item da resposta de group-review que deu certo (Etapa 3M). Mesmas regras de `participanteOkNaResposta`, aceitando
 *  também "approved"/"rejected"/"aprovado"/"recusado" no `status` em texto. */
export function revisaoOkNaResposta(item: Json): boolean {
  if (typeof item.error === "string" && item.error) return false;
  if (item.success === false) return false;
  const st = item.status;
  if (typeof st === "number") return st >= 200 && st < 300;
  if (typeof st === "string") return /^(2\d\d|ok|success|approved|rejected|aprovado|recusado)$/i.test(st.trim());
  return item.success === true || st === undefined;
}

/** Ver `participantesComResultado`. Exportada pra teste. */
export function participantesOkDaResposta(json: unknown): string[] | null {
  return okDaResposta(json, participanteOkNaResposta);
}

function okDaResposta(json: unknown, ok: (item: Json) => boolean): string[] | null {
  const j = (json ?? {}) as Json;
  const lista = Array.isArray(json) ? json : [j.results, j.participants, j.phones].find((x) => Array.isArray(x));
  if (!Array.isArray(lista) || !lista.length) return null;
  const itens = lista.filter((x): x is Json => !!x && typeof x === "object" && (typeof (x as Json).phone === "string" || typeof (x as Json).jid === "string"));
  if (itens.length !== lista.length) return null;
  return itens.filter(ok).map((x) => String(x.phone ?? x.jid).split("@")[0]);
}

let unico: ZapbotClient | undefined;

export function zapbot(): ZapbotClient {
  unico ??= new ZapbotClient({
    baseUrl: process.env.ZAPBOT_API_URL ?? "https://api.zapbot.online",
    email: process.env.ZAPBOT_EMAIL ?? "",
    password: process.env.ZAPBOT_PASSWORD ?? "",
    jwt: process.env.ZAPBOT_JWT,
  });
  return unico;
}
