import { conteudoInicial, validarConteudo, type TipoExecucao } from "./conteudo";
import { conteudoV2Vazio } from "./conteudo-v2";
import { brasiliaParaIso } from "./horario";
import { lerListaDeTelefones } from "./lista-telefones";
import { ehUuid } from "./uuid";

/** Assistente "Adicionar ação" (`/acoes/nova`). Módulo puro: passos, o que
 *  falta em cada um, a entrada que vai pro servidor e a validação de formato dela (o servidor confere o resto no
 *  banco: campanhas, contas e grupos). */

/** Ações que só existem no assistente do painel (Etapa 3K): os dois relatórios (geram um CSV na hora, não viram
 *  execução) e "Entrar no Grupo" (vira uma linha por conta na fila `acoes`, não uma execução por grupo). */
export const TIPOS_SO_ASSISTENTE = ["relatorio_status", "historico_enviadas", "entrar_grupo"] as const;
export type TipoSoAssistente = (typeof TIPOS_SO_ASSISTENTE)[number];

/** Ações oferecidas na ordem da tela, só as que existem no Vórtex Grupo. */
export const ACOES_ASSISTENTE = [
  { tipo: "mensagem", rotulo: "Enviar mensagem", icone: "send" },
  { tipo: "nome", rotulo: "Trocar nome", icone: "title" },
  { tipo: "descricao", rotulo: "Trocar descrição", icone: "format_align_left" },
  { tipo: "imagem", rotulo: "Trocar imagem", icone: "image" },
  { tipo: "configuracao", rotulo: "Trocar configuração", icone: "settings" },
  { tipo: "fechar", rotulo: "Fechar Grupos", icone: "lock" },
  { tipo: "relatorio_status", rotulo: "Relatório de status de mensagens", icone: "download" },
  { tipo: "historico_enviadas", rotulo: "Histórico de mensagens enviadas", icone: "history" },
  { tipo: "abrir", rotulo: "Abrir Grupos", icone: "key" },
  { tipo: "entrar_grupo", rotulo: "Entrar no Grupo", icone: "group_add" },
  { tipo: "admin_add", rotulo: "Adicionar administradores", icone: "add_moderator" },
  { tipo: "admin_remover", rotulo: "Remover administradores", icone: "remove_moderator" },
  { tipo: "remover_participantes", rotulo: "Remover participantes", icone: "person_remove" },
  { tipo: "desativar_comunidade", rotulo: "Desativar comunidade", icone: "delete" },
  { tipo: "mover_grupos", rotulo: "Mover grupos para outra campanha", icone: "move_to_inbox" },
  { tipo: "atualizar_links", rotulo: "Atualizar links dos grupos", icone: "link" },
  { tipo: "redefinir_link", rotulo: "Redefinir link de convite", icone: "link_off" },
  { tipo: "privacidade_avancada", rotulo: "Privacidade Avançada na Conversa", icone: "privacy_tip" },
] as const satisfies readonly { tipo: TipoExecucao | TipoSoAssistente; rotulo: string; icone: string }[];

export type TipoAcaoAssistente = (typeof ACOES_ASSISTENTE)[number]["tipo"];

/** Ações do assistente que a API v1/MCP não oferecem (Etapa 3K): pra API continuam "Escolha a ação.", como antes.
 *  "Trocar imagem" saiu da lista em 19/10/2026: o MCP sobe a imagem com `preparar_upload` (URL do `midias`). */
export const TIPOS_SO_PAINEL: readonly TipoAcaoAssistente[] = ["relatorio_status", "historico_enviadas", "entrar_grupo", "privacidade_avancada"];

export function ehTipoAssistente(v: unknown): v is TipoAcaoAssistente {
  return typeof v === "string" && ACOES_ASSISTENTE.some((a) => a.tipo === v);
}

/** Ação que vira execução por grupo (o fluxo de sempre, que aceita ações encadeadas). */
export function ehTipoExecucaoAssistente(t: TipoAcaoAssistente | null): t is Exclude<TipoAcaoAssistente, TipoSoAssistente> {
  return !!t && !(TIPOS_SO_ASSISTENTE as readonly string[]).includes(t);
}

export function ehRelatorio(t: TipoAcaoAssistente | null): t is "relatorio_status" | "historico_enviadas" {
  return t === "relatorio_status" || t === "historico_enviadas";
}

export function rotuloAcaoAssistente(tipo: TipoAcaoAssistente): string {
  return ACOES_ASSISTENTE.find((a) => a.tipo === tipo)!.rotulo;
}

export const PASSOS_ACAO = ["categoria", "campanha", "acao", "contas", "grupos", "conteudo", "confirmar"] as const;
export type PassoAcao = (typeof PASSOS_ACAO)[number];

/** Passos de cada ação (Etapa 3K): relatórios = Campanha → Ação → Conteúdo (filtros) → Confirmar; Entrar no Grupo =
 *  Ação → Contas → Conteúdo (link) → Confirmar (o grupo não é de campanha nenhuma); o resto, todos os passos. */
export function passosDoTipo(tipo: TipoAcaoAssistente | null): readonly PassoAcao[] {
  if (ehRelatorio(tipo)) return ["categoria", "campanha", "acao", "conteudo", "confirmar"];
  if (tipo === "entrar_grupo") return ["acao", "contas", "conteudo", "confirmar"];
  return PASSOS_ACAO;
}

/** Link de convite de grupo do WhatsApp aceito por "Entrar no Grupo" (`null` = inválido). */
export const REGEX_LINK_CONVITE = /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]{10,40}$/;

export function validarLinkConvite(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const link = v.trim();
  return REGEX_LINK_CONVITE.test(link) ? link : null;
}

/** Nota fixa do passo Conteúdo de "Entrar no Grupo". */
export const NOTA_ENTRAR_GRUPO =
  "O grupo não entra em nenhuma campanha sozinho. Para usá-lo numa campanha, importe-o em Grupos › IMPORTAR GRUPOS. Convite de comunidade pode não funcionar.";

/** Rodapé do "Relatório de status de mensagens". */
export const NOTA_RELATORIO_STATUS =
  "Status por pessoa só existe para mensagens enviadas depois de 15/10/2026 e quando o WhatsApp devolve o recibo.";

/** Relatórios: até 50 ações marcadas (status), até 50 campanhas (histórico), janela de 90 dias. */
export const MAXIMO_EXECUCOES_RELATORIO = 50;
export const MAXIMO_CAMPANHAS_RELATORIO = 50;
export const DIAS_RELATORIO = 90;

const DIA_MS = 86_400_000;
const DATA_DIA = /^\d{4}-\d{2}-\d{2}$/;

/** "Inicio do intervalo" / "Fim do intervalo" (dias de Brasília, `AAAA-MM-DD`): fim não antes do início e no máximo
 *  90 dias contando os dois. Devolve o começo (inclusive) e o fim (exclusive, meia-noite do dia seguinte) em ISO. */
export function validarIntervalo(inicio: unknown, fim: unknown): { ok: true; desde: string; ate: string } | { ok: false; erro: string } {
  if (typeof inicio !== "string" || !DATA_DIA.test(inicio)) return { ok: false, erro: "Escolha o início do intervalo." };
  if (typeof fim !== "string" || !DATA_DIA.test(fim)) return { ok: false, erro: "Escolha o fim do intervalo." };
  const a = Date.parse(`${inicio}T00:00:00-03:00`);
  const b = Date.parse(`${fim}T00:00:00-03:00`);
  if (Number.isNaN(a) || Number.isNaN(b) || new Date(a + 3 * 3600_000).toISOString().slice(0, 10) !== inicio || new Date(b + 3 * 3600_000).toISOString().slice(0, 10) !== fim) {
    return { ok: false, erro: "Data inválida." };
  }
  if (b < a) return { ok: false, erro: "O fim do intervalo vem antes do início." };
  if ((b - a) / DIA_MS + 1 > DIAS_RELATORIO) return { ok: false, erro: `O intervalo vai até ${DIAS_RELATORIO} dias.` };
  return { ok: true, desde: new Date(a).toISOString(), ate: new Date(b + DIA_MS).toISOString() };
}

/** Lista de ids (uuid) de uma query string `a,b,c`, sem repetidos (`null` = ausente). */
export function lerIdsDaUrl(v: unknown): string[] | null {
  if (typeof v !== "string") return null;
  return [...new Set(v.split(",").map((x) => x.trim()).filter(ehUuid))];
}

/** Link do CSV de um relatório (o "GERAR RELATÓRIO" do Confirmar). `null` = falta escolher algo. */
export function hrefRelatorio(estado: EstadoAcao, campanhas: CampanhaDoAssistente[]): string | null {
  const c = (estado.conteudo ?? {}) as Record<string, unknown>;
  if (estado.tipo === "relatorio_status") {
    const ids = Array.isArray(c.execucoes) ? (c.execucoes as unknown[]).filter(ehUuid) : [];
    return ids.length ? `/api/exportar/status-mensagens?execucoes=${ids.slice(0, MAXIMO_EXECUCOES_RELATORIO).join(",")}` : null;
  }
  if (estado.tipo === "historico_enviadas") {
    const alvo = campanhasDoEstado(estado, campanhas).slice(0, MAXIMO_CAMPANHAS_RELATORIO);
    if (!alvo.length || !validarIntervalo(c.inicio, c.fim).ok) return null;
    const q = new URLSearchParams({ inicio: String(c.inicio), fim: String(c.fim), campanhas: alvo.join(",") });
    return `/api/exportar/mensagens-enviadas?${q.toString().replace(/%2C/g, ",")}`;
  }
  return null;
}

/** Conteúdo das ações do assistente: o das execuções (`validarConteudo`) e o das 3 que só existem aqui. */
export function validarConteudoAcao(tipo: TipoAcaoAssistente, bruto: unknown): { ok: true; valor: unknown } | { ok: false; erro: string } {
  const c = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  switch (tipo) {
    case "entrar_grupo": {
      const link = validarLinkConvite(c.link);
      return link ? { ok: true, valor: { link } } : { ok: false, erro: "Link de convite inválido: use https://chat.whatsapp.com/…" };
    }
    case "relatorio_status": {
      const ids = Array.isArray(c.execucoes) ? [...new Set(c.execucoes as unknown[])] : [];
      if (!ids.length) return { ok: false, erro: "Marque ao menos uma ação." };
      if (!ids.every(ehUuid)) return { ok: false, erro: "Lista de ações inválida." };
      if (ids.length > MAXIMO_EXECUCOES_RELATORIO) return { ok: false, erro: `No máximo ${MAXIMO_EXECUCOES_RELATORIO} ações por relatório.` };
      return { ok: true, valor: { execucoes: ids } };
    }
    case "historico_enviadas": {
      const v = validarIntervalo(c.inicio, c.fim);
      return v.ok ? { ok: true, valor: { inicio: c.inicio, fim: c.fim } } : v;
    }
    default:
      return validarConteudo(tipo, bruto);
  }
}

export const ROTULO_PASSO_ACAO: Record<PassoAcao, { rotulo: string; icone: string }> = {
  categoria: { rotulo: "Categoria", icone: "category" },
  // "Campanha" (singular, Etapa 3N): o rótulo do stepper, mesmo deixando escolher mais de uma.
  campanha: { rotulo: "Campanha", icone: "campaign" },
  acao: { rotulo: "Ação", icone: "format_list_bulleted" },
  contas: { rotulo: "Conexões", icone: "qr_code_2" },
  grupos: { rotulo: "Grupos", icone: "check_box" },
  conteudo: { rotulo: "Conteúdo", icone: "description" },
  confirmar: { rotulo: "Confirmar", icone: "check" },
};

/** Passos exibidos na barra do topo (Etapa 3N): começa com 5 (Categoria, Campanha, Ação, Conteúdo, Confirmar)
 *  e ganha Contas/Grupos depois que a Campanha resolve pelo menos um alvo — "Entrar no Grupo" não segue essa regra
 *  (Contas é o próprio alvo da ação, sem campanha nenhuma). Só visual: a navegação real continua em
 *  `passosDoTipo`/`pendenciaDoPassoAcao`, que não mudam. */
export function passosVisiveis(estado: EstadoAcao, campanhas: CampanhaDoAssistente[]): readonly PassoAcao[] {
  const passos = passosDoTipo(estado.tipo);
  if (estado.tipo === "entrar_grupo") return passos;
  const alvoResolvido = campanhasDoEstado(estado, campanhas).length > 0;
  return passos.filter((p) => (p !== "contas" && p !== "grupos") || alvoResolvido);
}

/** Título do passo "Conteúdo": o nome da ação escolhida ("Enviar mensagem", "Trocar nome"…)
 * ; sem ação ainda escolhida, fica "Conteúdo". */
export function tituloPassoConteudo(tipo: TipoAcaoAssistente | null): string {
  return tipo ? rotuloAcaoAssistente(tipo) : "Conteúdo";
}

/** Teto de campanhas, contas e grupos numa ação (leituras limitadas a 1000). */
export const MAXIMO_ITENS_ACAO = 1000;

/** "Adicionar outra ação": até 4 seguintes = 5 ações por disparo. */
export const MAXIMO_SEGUINTES = 4;

/** Aviso forte de "Desativar comunidade" (texto fixo da tela). */
export const AVISO_DESATIVAR_COMUNIDADE = "A comunidade da campanha será desativada no WhatsApp. Não dá pra desfazer.";

export type CategoriaAcao = "campanha" | "projeto";
export type CampanhaDoAssistente = { id: string; nome: string; descricao: string | null; projeto_id: string | null };

/** O que o assistente guarda enquanto a pessoa preenche. `conteudo` é o do tipo escolhido (v2 em "mensagem");
 *  em "remover participantes" a lista vem de `telefonesTexto` (um por linha). `dataHora` é o datetime-local
 *  (Brasília) do "Agendar". */
export type EstadoAcao = {
  categoria: CategoriaAcao | null;
  campanhas: string[];
  projetoId: string | null;
  tipo: TipoAcaoAssistente | null;
  contasTodas: boolean;
  contas: string[];
  gruposTodos: boolean;
  grupos: string[];
  conteudo: unknown;
  telefonesTexto: string;
  importante: boolean;
  agendar: boolean;
  dataHora: string;
  /** "Adicionar outra ação": ações que saem depois da principal, na ordem, com o mesmo destino e horário. */
  seguintes: AcaoSeguinteEstado[];
};

/** Uma ação extra do assistente ("Ação 2", "Ação 3"…): só o tipo e o conteúdo; o resto é o da principal. */
export type AcaoSeguinteEstado = {
  /** Chave estável do cartão na tela (tirar uma do meio não troca o editor das outras). Não vai pro servidor. */
  chave: string;
  tipo: TipoAcaoAssistente;
  conteudo: unknown;
  telefonesTexto: string;
};

let proximaChave = 0;

export function estadoAcaoInicial(): EstadoAcao {
  return {
    categoria: null,
    campanhas: [],
    projetoId: null,
    tipo: null,
    contasTodas: true,
    contas: [],
    gruposTodos: true,
    grupos: [],
    conteudo: {},
    telefonesTexto: "",
    importante: false,
    agendar: false,
    dataHora: "",
    seguintes: [],
  };
}

/** Ação extra nova, com o conteúdo vazio do tipo. */
export function novaSeguinte(tipo: TipoAcaoAssistente): AcaoSeguinteEstado {
  return { chave: `acao-${++proximaChave}`, tipo, conteudo: conteudoInicialAcao(tipo), telefonesTexto: "" };
}

/** A ação extra `i` vista como um estado do assistente (mesmo destino e horário da principal, sem "importante"):
 *  assim o formulário de conteúdo e as regras de conteúdo valem igual pras duas. */
export function estadoDaSeguinte(estado: EstadoAcao, i: number): EstadoAcao {
  const s = estado.seguintes[i];
  return { ...estado, tipo: s.tipo, conteudo: s.conteudo, telefonesTexto: s.telefonesTexto, importante: false, seguintes: [] };
}

/** Rótulos de todas as ações do disparo, na ordem ("Ação 1: Enviar mensagem · Ação 2: Fechar Grupos"). */
export function listaDeAcoes(estado: EstadoAcao): string {
  const tipos = [estado.tipo, ...estado.seguintes.map((s) => s.tipo)].filter((t): t is TipoAcaoAssistente => !!t);
  return tipos.map((t, i) => `Ação ${i + 1}: ${rotuloAcaoAssistente(t)}`).join(" · ");
}

/** Conteúdo vazio de cada tipo: v2 sem mensagem em "mensagem"; nada marcado em "configuração". */
export function conteudoInicialAcao(tipo: TipoAcaoAssistente): unknown {
  if (tipo === "mensagem") return conteudoV2Vazio();
  if (tipo === "configuracao") return {};
  if (tipo === "relatorio_status") return { execucoes: [] };
  if (tipo === "historico_enviadas") return { inicio: "", fim: "" };
  if (tipo === "entrar_grupo") return { link: "" };
  return conteudoInicial(tipo);
}

/** Presets da URL (`?campanha=<id>&acao=<tipo>`), já conferidos pelo servidor contra as campanhas ativas.
 *  Campanha válida + ação válida → começa em "Contas"; só a campanha → começa em "Ação". */
export function estadoComPreset(campanhaId: string | null, acao: TipoAcaoAssistente | null): { estado: EstadoAcao; passo: PassoAcao } {
  const estado = estadoAcaoInicial();
  if (!campanhaId) return { estado, passo: "categoria" };
  estado.categoria = "campanha";
  estado.campanhas = [campanhaId];
  if (!acao) return { estado, passo: "acao" };
  estado.tipo = acao;
  estado.conteudo = conteudoInicialAcao(acao);
  const passos = passosDoTipo(acao);
  return { estado, passo: passos[passos.indexOf("acao") + 1] };
}

/** Lê os presets crus da URL: só uuid em `campanha` e só ação da lista em `acao` (o servidor ainda confere se a
 *  campanha existe e não está arquivada). */
export function lerPresetAcao(sp: { campanha?: unknown; acao?: unknown }): { campanha: string | null; acao: TipoAcaoAssistente | null } {
  return { campanha: ehUuid(sp.campanha) ? sp.campanha : null, acao: ehTipoAssistente(sp.acao) ? sp.acao : null };
}

/** Campanhas que a ação vai atingir: as escolhidas, ou as ativas do projeto (`campanhas` = lista do assistente,
 *  que só tem campanhas não arquivadas). */
export function campanhasDoEstado(estado: EstadoAcao, campanhas: CampanhaDoAssistente[]): string[] {
  if (estado.categoria === "projeto") return estado.projetoId ? campanhas.filter((c) => c.projeto_id === estado.projetoId).map((c) => c.id) : [];
  if (estado.categoria === "campanha") return estado.campanhas;
  return [];
}

/** Contas e grupos específicos só fazem sentido com UMA campanha: com mais, valem "Todas" / "Todos". */
export function escolheContasEGrupos(qtdCampanhas: number): boolean {
  return qtdCampanhas === 1;
}

/** Telefones de "remover participantes" (um por linha, regras da lista de telefones). */
export function telefonesDoTexto(texto: string): { telefones: string[]; invalidos: string[] } {
  const { validos, invalidos } = lerListaDeTelefones(texto);
  return { telefones: validos.map((v) => v.telefone), invalidos };
}

/** Conteúdo que vai pro servidor (em "remover participantes", montado do texto). */
export function conteudoDoEstado(estado: EstadoAcao): unknown {
  if (estado.tipo === "remover_participantes") return { telefones: telefonesDoTexto(estado.telefonesTexto).telefones };
  return estado.conteudo;
}

/** `"agora"` ou o datetime-local de Brasília → ISO. Agendado tem que ser no futuro. */
export function quandoParaIso(quando: string, agora: Date = new Date()): { ok: true; iso: string } | { ok: false; erro: string } {
  if (quando === "agora") return { ok: true, iso: agora.toISOString() };
  let iso: string;
  try {
    iso = brasiliaParaIso(quando);
  } catch {
    return { ok: false, erro: "Data e hora inválidas." };
  }
  if (new Date(iso).getTime() <= agora.getTime()) return { ok: false, erro: "Esse horário já passou." };
  return { ok: true, iso };
}

/** O que falta pra sair do passo (`null` = pode seguir). `campanhas` = lista do assistente. */
export function pendenciaDoPassoAcao(passo: PassoAcao, estado: EstadoAcao, campanhas: CampanhaDoAssistente[], agora: Date = new Date()): string | null {
  const alvo = campanhasDoEstado(estado, campanhas);
  // Passo que a ação escolhida não usa (ex.: Campanha em "Entrar no Grupo") não segura nada.
  if (estado.tipo && !passosDoTipo(estado.tipo).includes(passo)) return null;
  if (estado.tipo === "entrar_grupo") {
    if (passo === "contas") return estado.contas.length ? null : "Escolha ao menos uma conexão.";
    if (passo === "confirmar") return null;
  }
  if (ehRelatorio(estado.tipo) && passo === "confirmar") return null;
  switch (passo) {
    case "categoria":
      return estado.categoria ? null : "Escolha a categoria.";
    case "campanha":
      if (estado.categoria === "projeto") {
        if (!estado.projetoId) return "Escolha o projeto.";
        return alvo.length ? null : "Esse projeto não tem campanhas ativas.";
      }
      return alvo.length ? null : "Escolha ao menos uma campanha.";
    case "acao":
      return estado.tipo ? null : "Escolha a ação.";
    case "contas":
      return escolheContasEGrupos(alvo.length) && !estado.contasTodas && estado.contas.length === 0 ? "Escolha ao menos uma conexão." : null;
    case "grupos":
      return escolheContasEGrupos(alvo.length) && !estado.gruposTodos && estado.grupos.length === 0 ? "Escolha ao menos um grupo." : null;
    case "conteudo": {
      const principal = pendenciaDoConteudo(estado, alvo);
      if (principal) return principal;
      if (estado.seguintes.length > MAXIMO_SEGUINTES) return `No máximo ${MAXIMO_SEGUINTES + 1} ações por disparo.`;
      for (let i = 0; i < estado.seguintes.length; i++) {
        const falta = pendenciaDoConteudo(estadoDaSeguinte(estado, i), alvo);
        if (falta) return `Ação ${i + 2}: ${falta}`;
      }
      return null;
    }
    case "confirmar": {
      if (!estado.agendar) return null;
      if (!estado.dataHora) return "Escolha a data e a hora.";
      const q = quandoParaIso(estado.dataHora, agora);
      return q.ok ? null : q.erro;
    }
  }
}

/** O que falta no conteúdo de UMA ação (a principal ou uma extra vista por `estadoDaSeguinte`). */
function pendenciaDoConteudo(estado: EstadoAcao, alvo: string[]): string | null {
  if (!estado.tipo) return "Escolha a ação.";
  if (estado.tipo === "historico_enviadas" && alvo.length > MAXIMO_CAMPANHAS_RELATORIO) return `No máximo ${MAXIMO_CAMPANHAS_RELATORIO} campanhas no histórico.`;
  if (estado.tipo === "remover_participantes") {
    const { invalidos } = telefonesDoTexto(estado.telefonesTexto);
    if (invalidos.length) return `Telefone inválido: ${invalidos[0]}.`;
  }
  const v = validarConteudoAcao(estado.tipo, conteudoDoEstado(estado));
  if (!v.ok) return v.erro;
  if (estado.tipo === "mover_grupos" && alvo.includes((v.valor as { campanha_destino: string }).campanha_destino)) {
    return "A campanha de destino não pode ser uma das campanhas da ação.";
  }
  return null;
}

/** Dá pra pular direto pro passo `i` (barra de passos): já visitado e nenhum anterior pendente. */
export function podeIrParaAcao(i: number, visitados: Set<PassoAcao>, estado: EstadoAcao, campanhas: CampanhaDoAssistente[]): boolean {
  const passos = passosDoTipo(estado.tipo);
  const alvo = passos[i];
  if (!alvo || !visitados.has(alvo)) return false;
  return passos.slice(0, i).every((p) => pendenciaDoPassoAcao(p, estado, campanhas) === null);
}

/** Ação extra da entrada: sai depois da anterior terminar, com o mesmo destino e horário da principal. */
export type SeguinteEntrada = { tipo: TipoAcaoAssistente; conteudo: unknown; importante: boolean };

/** O que `criarAcao` recebe. `contas`/`grupos` `null` = todas/todos. `quando` = `"agora"` ou datetime-local
 *  de Brasília. `seguintes` = "Adicionar outra ação" (só o assistente do painel; a API v1/MCP não manda). */
export type EntradaAcao = {
  categoria: CategoriaAcao;
  campanhas: string[];
  projetoId: string | null;
  tipo: TipoAcaoAssistente;
  contas: string[] | null;
  grupos: string[] | null;
  conteudo: unknown;
  importante: boolean;
  quando: string;
  seguintes?: SeguinteEntrada[];
};

export function montarEntradaAcao(estado: EstadoAcao, campanhas: CampanhaDoAssistente[]): EntradaAcao | null {
  // Relatório não vira ação: o Confirmar só abre o CSV.
  if (ehRelatorio(estado.tipo)) return null;
  // "Entrar no Grupo": só as contas escolhidas e o link (sem campanha, grupo nem horário: roda no próximo minuto).
  if (estado.tipo === "entrar_grupo") {
    return { categoria: "campanha", campanhas: [], projetoId: null, tipo: "entrar_grupo", contas: estado.contas, grupos: null, conteudo: estado.conteudo, importante: false, quando: "agora" };
  }
  if (!estado.categoria || !estado.tipo) return null;
  const uma = escolheContasEGrupos(campanhasDoEstado(estado, campanhas).length);
  return {
    categoria: estado.categoria,
    campanhas: estado.categoria === "campanha" ? estado.campanhas : [],
    projetoId: estado.categoria === "projeto" ? estado.projetoId : null,
    tipo: estado.tipo,
    contas: uma && !estado.contasTodas ? estado.contas : null,
    grupos: uma && !estado.gruposTodos ? estado.grupos : null,
    conteudo: conteudoDoEstado(estado),
    importante: estado.tipo === "mensagem" && estado.importante,
    quando: estado.agendar ? estado.dataHora : "agora",
    // Sem ação extra, a entrada fica exatamente como antes (sem o campo).
    ...(estado.seguintes.length
      ? { seguintes: estado.seguintes.map((_, i) => ({ tipo: estado.seguintes[i].tipo, conteudo: conteudoDoEstado(estadoDaSeguinte(estado, i)), importante: false })) }
      : {}),
  };
}

export type EntradaAcaoValida = {
  categoria: CategoriaAcao;
  campanhas: string[];
  projetoId: string | null;
  tipo: TipoAcaoAssistente;
  contas: string[] | null;
  grupos: string[] | null;
  conteudo: unknown;
  importante: boolean;
  agendadaPara: string;
  agora: boolean;
  /** Ações extras já validadas, na ordem (`[]` = só a principal). */
  seguintes: { tipo: TipoAcaoAssistente; conteudo: unknown; importante: boolean }[];
};

function listaDeIds(v: unknown, nome: string): { ok: true; ids: string[] | null } | { ok: false; erro: string } {
  if (v === null || v === undefined) return { ok: true, ids: null };
  if (!Array.isArray(v) || !v.every(ehUuid)) return { ok: false, erro: `Lista de ${nome} inválida.` };
  const ids = [...new Set(v as string[])];
  if (ids.length === 0) return { ok: false, erro: `Escolha ao menos um item em ${nome}.` };
  if (ids.length > MAXIMO_ITENS_ACAO) return { ok: false, erro: `No máximo ${MAXIMO_ITENS_ACAO} ${nome}.` };
  return { ok: true, ids };
}

/** Confere o formato da entrada (sem banco): categoria, ids, tipo, conteúdo e horário. O servidor confere depois
 *  se as campanhas existem e não estão arquivadas, e se contas e grupos são da campanha. */
export function validarEntradaAcao(bruto: unknown, agora: Date = new Date()): { ok: true; valor: EntradaAcaoValida } | { ok: false; erro: string } {
  const e = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  if (ehRelatorio(e.tipo as TipoAcaoAssistente)) return { ok: false, erro: "Relatório não vira ação: use GERAR RELATÓRIO." };
  if (e.tipo === "entrar_grupo") return validarEntrarNoGrupo(e, agora);
  if (e.categoria !== "campanha" && e.categoria !== "projeto") return { ok: false, erro: "Escolha a categoria." };
  let campanhas: string[] = [];
  let projetoId: string | null = null;
  if (e.categoria === "campanha") {
    const l = listaDeIds(e.campanhas, "campanhas");
    if (!l.ok) return l;
    if (!l.ids) return { ok: false, erro: "Escolha ao menos uma campanha." };
    campanhas = l.ids;
  } else {
    if (!ehUuid(e.projetoId)) return { ok: false, erro: "Escolha o projeto." };
    projetoId = e.projetoId;
  }
  if (!ehTipoAssistente(e.tipo)) return { ok: false, erro: "Escolha a ação." };
  const contas = listaDeIds(e.contas, "conexões");
  if (!contas.ok) return contas;
  const grupos = listaDeIds(e.grupos, "grupos");
  if (!grupos.ok) return grupos;
  if ((contas.ids || grupos.ids) && e.categoria === "campanha" && campanhas.length !== 1) {
    return { ok: false, erro: "Conexões e grupos específicos só valem com uma campanha." };
  }
  const v = validarConteudoAcao(e.tipo, e.conteudo);
  if (!v.ok) return { ok: false, erro: v.erro };
  if (e.tipo === "mover_grupos" && campanhas.includes((v.valor as { campanha_destino: string }).campanha_destino)) {
    return { ok: false, erro: "A campanha de destino não pode ser uma das campanhas da ação." };
  }
  if (typeof e.quando !== "string") return { ok: false, erro: "Data e hora inválidas." };
  const q = quandoParaIso(e.quando, agora);
  if (!q.ok) return q;
  const seguintes: EntradaAcaoValida["seguintes"] = [];
  if (e.seguintes !== undefined && e.seguintes !== null) {
    if (!Array.isArray(e.seguintes)) return { ok: false, erro: "Lista de ações inválida." };
    if (e.seguintes.length > MAXIMO_SEGUINTES) return { ok: false, erro: `No máximo ${MAXIMO_SEGUINTES + 1} ações por disparo.` };
    for (const [i, bruta] of e.seguintes.entries()) {
      const s = (bruta && typeof bruta === "object" ? bruta : {}) as Record<string, unknown>;
      if (!ehTipoAssistente(s.tipo)) return { ok: false, erro: `Ação ${i + 2}: Escolha a ação.` };
      if (!ehTipoExecucaoAssistente(s.tipo)) return { ok: false, erro: `Ação ${i + 2}: essa ação não pode ser encadeada.` };
      const vs = validarConteudo(s.tipo, s.conteudo);
      if (!vs.ok) return { ok: false, erro: `Ação ${i + 2}: ${vs.erro}` };
      if (s.tipo === "mover_grupos" && campanhas.includes((vs.valor as { campanha_destino: string }).campanha_destino)) {
        return { ok: false, erro: `Ação ${i + 2}: A campanha de destino não pode ser uma das campanhas da ação.` };
      }
      // Sempre falsa: "importante" é reenviada pra todo grupo novo da campanha, e uma ação seguinte (que só sai
      // depois da anterior terminar) nunca deveria valer pra isso — nem o assistente oferece a opção nela.
      seguintes.push({ tipo: s.tipo, conteudo: vs.valor, importante: false });
    }
  }
  return {
    ok: true,
    valor: {
      categoria: e.categoria,
      campanhas,
      projetoId,
      tipo: e.tipo,
      contas: contas.ids,
      grupos: grupos.ids,
      conteudo: v.valor,
      importante: e.tipo === "mensagem" && e.importante === true,
      agendadaPara: q.iso,
      agora: e.quando === "agora",
      seguintes,
    },
  };
}

/** "Entrar no Grupo": contas (1 a 1000, obrigatórias), link de convite válido, sem horário nem ações encadeadas. */
function validarEntrarNoGrupo(e: Record<string, unknown>, agora: Date): { ok: true; valor: EntradaAcaoValida } | { ok: false; erro: string } {
  const contas = listaDeIds(e.contas, "conexões");
  if (!contas.ok) return contas;
  if (!contas.ids) return { ok: false, erro: "Escolha ao menos uma conexão." };
  const v = validarConteudoAcao("entrar_grupo", e.conteudo);
  if (!v.ok) return v;
  if (e.quando !== "agora") return { ok: false, erro: "Entrar no Grupo não é agendado: roda no próximo minuto." };
  if (Array.isArray(e.seguintes) && e.seguintes.length) return { ok: false, erro: "Entrar no Grupo não aceita ações encadeadas." };
  return {
    ok: true,
    valor: {
      categoria: "campanha", campanhas: [], projetoId: null, tipo: "entrar_grupo", contas: contas.ids, grupos: null, conteudo: v.valor,
      importante: false, agendadaPara: agora.toISOString(), agora: true, seguintes: [],
    },
  };
}

/** Pra onde o assistente volta depois de criar: a aba Ações da campanha de onde veio (se ela continua entre as
 *  escolhidas), senão `/acoes`. `criada` = quantas execuções foram criadas (aviso de sucesso). */
export function destinoDepoisDeCriar(campanhaDeOrigem: string | null, campanhasDaAcao: string[], criadas: number): string {
  const base = campanhaDeOrigem && campanhasDaAcao.includes(campanhaDeOrigem) ? `/campanhas/${campanhaDeOrigem}/acoes` : "/acoes";
  return `${base}?criada=${criadas}`;
}

/** Aviso de sucesso a partir de `?criada=N` (nada se não for um número positivo). */
export function avisoCriada(v: unknown): string | null {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > MAXIMO_ITENS_ACAO) return null;
  return n === 1 ? "Ação criada." : `${n} ações criadas (uma por campanha).`;
}
