import "server-only";
import type { ChaveAutenticada } from "../api/auth";
import { cancelarAcaoApi, criarAcaoApi, editarAcaoApi, listarAcoesApi, listarCampanhasApi, listarContasApi, listarGruposApi, verCampanhaApi, type ResultadoApi } from "../api/consultas";
import { arquivarCampanhaApi, criarCampanhaApi, excluirCampanhaApi } from "../api/campanhas";
import { criarModeloApi, listarModelosApi, metricasPeriodoApi } from "../api/metricas-modelos";
import { lerPagina } from "../api/respostas";
import { env } from "../env";
import { ABAS_MENSAGENS } from "../regras/abas-mensagens";
import { OPCOES_ENVIO_PADRAO, paraV2, type ConteudoV2 } from "../regras/conteudo-v2";
import { prefixoMidias } from "../regras/imagem-grupo";
import { dbAdmin } from "../supabase/admin";

/** Ferramentas do servidor MCP do Vórtex Grupo (Etapa 3H2). Cada uma chama as MESMAS funções da API v1
 *  (`src/lib/api/consultas.ts`) — nenhuma consulta nem validação própria. As de envio exigem chave `envio`. */

export type ResultadoFerramenta = { content: { type: "text"; text: string }[]; isError?: boolean };

export type Ferramenta = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: Record<string, unknown>;
  envio: boolean;
  executar: (chave: ChaveAutenticada, args: Record<string, unknown>) => Promise<ResultadoFerramenta>;
};

export const SEM_PERMISSAO_ENVIO = "Esta chave só tem permissão de leitura.";

const UUID = { type: "string", format: "uuid" } as const;
const PAGINA = { type: "integer", minimum: 1, description: "Página (50 itens por página). Padrão 1." } as const;
const AGENDAR_PARA = {
  type: "string",
  description:
    "Opcional. Data e hora em ISO 8601 (ex.: 2026-10-20T21:00:00-03:00). Sem fuso horário, vale o horário de Brasília (America/Sao_Paulo). Sem este campo, a ação roda agora.",
} as const;

const texto = (dados: unknown): ResultadoFerramenta => ({ content: [{ type: "text", text: JSON.stringify(dados, null, 2) }] });
const erro = (mensagem: string): ResultadoFerramenta => ({ content: [{ type: "text", text: mensagem }], isError: true });
const doResultado = <T>(r: ResultadoApi<T>, extra?: (dados: T) => unknown): ResultadoFerramenta => (r.ok ? texto(extra ? extra(r.dados) : r.dados) : erro(r.erro));

const textoOuNull = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const pagina = (v: unknown): number => lerPagina(v === undefined || v === null ? null : String(v));
const linkAcoes = () => `${env("NEXT_PUBLIC_SITE_URL")}/acoes`;

/** Ação criada → ids + link de Ações do painel. */
const acaoCriada = (dados: { ids: string[] }) => ({
  ids: dados.ids,
  link: linkAcoes(),
  mensagem: dados.ids.length === 1 ? "Ação criada." : `${dados.ids.length} ações criadas (uma por campanha).`,
});

/** Tipos simples de `criar_acao` → conteúdo do assistente. "imagem" troca a foto dos grupos (URL de `preparar_upload`). */
const TIPOS_SIMPLES = ["nome", "descricao", "abrir", "fechar", "imagem"] as const;
type TipoSimples = (typeof TIPOS_SIMPLES)[number];

function conteudoSimples(tipo: TipoSimples, args: Record<string, unknown>): unknown {
  if (tipo === "nome") return { padrao: typeof args.nome === "string" ? args.nome : "" };
  if (tipo === "descricao") return { texto: typeof args.descricao === "string" ? args.descricao : "" };
  if (tipo === "imagem") return { url: typeof args.imagem_url === "string" ? args.imagem_url : "", nome_arquivo: textoOuNull(args.nome_arquivo) };
  return {};
}

/** Conteúdo novo de `editar_acao`, montado sobre o atual: mensagem (texto OU mensagens e/ou mencionar_todos) ou
 *  os tipos simples com campo (nome, descricao, imagem). `undefined` = nenhum campo de conteúdo veio (só horário). */
const CAMPOS_CONTEUDO = ["texto", "mensagens", "mencionar_todos", "nome", "descricao", "imagem_url", "nome_arquivo"] as const;
function edicaoDeConteudo(a: Record<string, unknown>): ((atual: { tipo: string; conteudo: unknown }) => unknown) | undefined {
  if (!CAMPOS_CONTEUDO.some((k) => a[k] !== undefined)) return undefined;
  return ({ tipo, conteudo }) => {
    if (tipo === "mensagem") {
      if (a.nome !== undefined || a.descricao !== undefined || a.imagem_url !== undefined) return { erro: "Essa ação é uma mensagem: use texto, mensagens ou mencionar_todos." };
      if (Array.isArray(a.mensagens) && a.texto !== undefined) return { erro: "Use texto OU mensagens, não os dois." };
      const v2 = paraV2(conteudo);
      const mensagens = Array.isArray(a.mensagens)
        ? (a.mensagens as unknown[]).map(mensagemDoMcp)
        : a.texto !== undefined
          ? [{ formato: "texto", texto: typeof a.texto === "string" ? a.texto : "" }]
          : v2.mensagens;
      const mencionar = typeof a.mencionar_todos === "boolean" ? a.mencionar_todos : v2.opcoes.mencionar_todos;
      return { versao: 2, mensagens, opcoes: { ...v2.opcoes, mencionar_todos: mencionar } };
    }
    if (tipo === "nome" || tipo === "descricao" || tipo === "imagem") {
      const campo = tipo === "nome" ? "nome" : tipo === "descricao" ? "descricao" : "imagem_url";
      if (a[campo] === undefined) return { erro: `Essa ação é do tipo ${tipo}: use ${campo}.` };
      return conteudoSimples(tipo, a);
    }
    return { erro: `Pelo MCP dá pra mudar o conteúdo de mensagem, nome, descrição e imagem. Desta ação (${tipo}) só o horário.` };
  };
}

/** Formatos de `enviar_mensagem.mensagens` (os mesmos do editor do painel, sem os interativos; enquete desde 21/10/2026). */
const FORMATOS_MCP = ["texto", "imagem", "video", "audio", "documento", "enquete"] as const;

/** Item de `mensagens` → mensagem v2 (a validação de verdade é a do assistente, em `criarAcaoApi`). */
function mensagemDoMcp(bruto: unknown): unknown {
  const m = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  if (m.formato === "texto") return { formato: "texto", texto: typeof m.texto === "string" ? m.texto : "" };
  if (m.formato === "enquete") return { formato: "enquete", enquete: { pergunta: m.pergunta ?? "", opcoes: m.opcoes ?? [], max_respostas: m.max_respostas ?? 1 } };
  return {
    formato: m.formato,
    midia_url: typeof m.midia_url === "string" ? m.midia_url : "",
    nome_arquivo: textoOuNull(m.nome_arquivo),
    legenda: typeof m.legenda === "string" ? m.legenda : "",
  };
}

/** Upload pelo MCP: pasta própria dentro do `midias`, nome limpo (mesmo esquema do painel). */
const MAXIMO_NOME_UPLOAD = 120;
function caminhoUpload(nome: string): string {
  const limpo = nome.trim().slice(-MAXIMO_NOME_UPLOAD).replace(/[^\w.-]/g, "_") || "arquivo";
  return `mcp/${Date.now()}-${limpo}`;
}

export const FERRAMENTAS: Ferramenta[] = [
  {
    name: "listar_campanhas",
    title: "Listar campanhas",
    description: "Lista as campanhas ativas (não arquivadas) do Vórtex Grupo com id, nome, link de entrada, tipo, quantidade de grupos e de participantes.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    envio: false,
    executar: async () => doResultado(await listarCampanhasApi(dbAdmin())),
  },
  {
    name: "ver_campanha",
    title: "Ver campanha",
    description: "Mostra uma campanha (inclusive arquivada) com grupos, participantes e as métricas dos últimos 7 dias: cliques no link, quem entrou e quem saiu (totais e por dia, no horário de Brasília).",
    inputSchema: { type: "object", properties: { campanha: { ...UUID, description: "Id da campanha (veja listar_campanhas)." } }, required: ["campanha"], additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    envio: false,
    executar: async (_c, a) => doResultado(await verCampanhaApi(dbAdmin(), String(a.campanha ?? ""))),
  },
  {
    name: "listar_grupos",
    title: "Listar grupos da campanha",
    description: "Lista os grupos de WhatsApp ativos de uma campanha, na ordem do número, com link de convite, participantes, administradores, cliques e se está cheio. 50 por página.",
    inputSchema: {
      type: "object",
      properties: { campanha: { ...UUID, description: "Id da campanha (veja listar_campanhas)." }, pagina: PAGINA },
      required: ["campanha"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    envio: false,
    executar: async (_c, a) => doResultado(await listarGruposApi(dbAdmin(), String(a.campanha ?? ""), pagina(a.pagina))),
  },
  {
    name: "listar_acoes",
    title: "Listar ações",
    description: "Lista as ações (mensagens, troca de nome, abrir/fechar grupos etc.) com a situação de cada uma: na fila, agendada, processando, sucesso ou falha. Filtra por campanha e por aba. 50 por página.",
    inputSchema: {
      type: "object",
      properties: {
        campanha: { ...UUID, description: "Opcional. Só as ações desta campanha." },
        aba: { type: "string", enum: ABAS_MENSAGENS.map((x) => x.valor), description: "Opcional. Padrão: todas." },
        pagina: PAGINA,
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    envio: false,
    executar: async (_c, a) => doResultado(await listarAcoesApi(dbAdmin(), { campanha: textoOuNull(a.campanha), aba: textoOuNull(a.aba), pagina: pagina(a.pagina) })),
  },
  {
    name: "listar_contas",
    title: "Listar conexões",
    description: "Lista as conexões (chips/números de WhatsApp) do Vórtex Grupo, com o telefone mascarado e se cada uma está conectada agora (conectado: true/false). Use para conferir se o chip caiu antes de agendar envios.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    envio: false,
    executar: async () => doResultado(await listarContasApi(dbAdmin())),
  },
  {
    name: "metricas_campanha",
    title: "Métricas da campanha por período",
    description:
      "Cliques no link de entrada, quem entrou e quem saiu dos grupos de uma campanha, por dia e no total, entre duas datas (dias de Brasília, as duas inclusas). Entradas não contam participante importado nem administrador. Bom para preencher relatórios de aula ou de lançamento.",
    inputSchema: {
      type: "object",
      properties: {
        campanha: { ...UUID, description: "Id da campanha (veja listar_campanhas)." },
        de: { type: "string", description: "Opcional. Primeiro dia, AAAA-MM-DD. Padrão: 7 dias antes de ate." },
        ate: { type: "string", description: "Opcional. Último dia, AAAA-MM-DD. Padrão: hoje." },
      },
      required: ["campanha"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    envio: false,
    executar: async (_c, a) => doResultado(await metricasPeriodoApi(String(a.campanha ?? ""), a.de, a.ate)),
  },
  {
    name: "listar_modelos",
    title: "Listar modelos de mensagem",
    description: "Lista os modelos salvos no Vórtex Grupo (mensagens, enquetes, nomes e descrições de grupo), com pasta e conteúdo. Filtra por pasta.",
    inputSchema: { type: "object", properties: { pasta: { type: "string", description: "Opcional. Só os modelos desta pasta." } }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    envio: false,
    executar: async (_c, a) => doResultado(await listarModelosApi(a.pasta)),
  },
  {
    name: "enviar_mensagem",
    title: "Enviar mensagem nos grupos",
    description:
      "ATENÇÃO: envia de verdade. Cria a ação \"Enviar mensagem\" para TODOS os grupos de WhatsApp reais das campanhas escolhidas — as pessoas desses grupos recebem a mensagem. Use `texto` para uma mensagem só de texto, ou `mensagens` para uma sequência (texto, imagem, vídeo, áudio, documento, enquete), enviadas na ordem. Enquete: formato \"enquete\" com pergunta, opcoes (2 a 12) e max_respostas (o Zapbot não devolve os votos de grupo: o resultado se vê no WhatsApp). Arquivos: suba antes com preparar_upload e use a midia_url devolvida. Confirme o conteúdo, as campanhas e o horário com o usuário antes de chamar. Sem agendar_para, o envio começa agora. Precisa de chave com permissão de envio. Devolve os ids das ações criadas e o link da tela de Ações.",
    inputSchema: {
      type: "object",
      properties: {
        campanhas: { type: "array", items: UUID, minItems: 1, description: "Ids das campanhas (veja listar_campanhas). Uma ação por campanha." },
        texto: { type: "string", minLength: 1, description: "Texto da mensagem, como vai aparecer no WhatsApp. Use este OU mensagens." },
        mensagens: {
          type: "array",
          minItems: 1,
          maxItems: 10,
          description: "Sequência de mensagens, enviadas na ordem. Use este OU texto.",
          items: {
            type: "object",
            properties: {
              formato: { type: "string", enum: [...FORMATOS_MCP] },
              texto: { type: "string", description: "Só para formato \"texto\"." },
              midia_url: { type: "string", description: "Mídia: URL https do arquivo (a midia_url de preparar_upload). Áudio em .ogg/.mp3 vai como áudio do WhatsApp." },
              legenda: { type: "string", description: "Opcional. Legenda da imagem, vídeo ou documento." },
              nome_arquivo: { type: "string", description: "Opcional. Nome do arquivo (aparece no documento)." },
              pergunta: { type: "string", description: "Só para formato \"enquete\": a pergunta." },
              opcoes: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 12, description: "Só para formato \"enquete\": as opções (2 a 12, sem repetir)." },
              max_respostas: { type: "integer", minimum: 1, description: "Opcional, só para formato \"enquete\": quantas opções cada pessoa marca. Padrão 1." },
            },
            required: ["formato"],
            additionalProperties: false,
          },
        },
        mencionar_todos: { type: "boolean", description: "Opcional. Marca todo mundo do grupo (@todos). Padrão false." },
        agendar_para: AGENDAR_PARA,
      },
      required: ["campanhas"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    envio: true,
    executar: async (chave, a) => {
      const temLista = Array.isArray(a.mensagens);
      if (temLista && a.texto !== undefined) return erro("Use texto OU mensagens, não os dois.");
      if (temLista && !(a.mensagens as unknown[]).length) return erro("Informe ao menos uma mensagem.");
      if (temLista && (a.mensagens as unknown[]).length > 10) return erro("Até 10 mensagens por ação.");
      const mensagens = temLista
        ? (a.mensagens as unknown[]).map(mensagemDoMcp)
        : [{ formato: "texto", texto: typeof a.texto === "string" ? a.texto : "" }];
      const conteudo = {
        versao: 2,
        mensagens,
        opcoes: { ...OPCOES_ENVIO_PADRAO, mencionar_todos: a.mencionar_todos === true },
      } as ConteudoV2;
      return doResultado(await criarAcaoApi(chave, { campanhas: a.campanhas, tipo: "mensagem", conteudo, agendar_para: a.agendar_para }), acaoCriada);
    },
  },
  {
    name: "criar_acao",
    title: "Criar ação nos grupos",
    description:
      "ATENÇÃO: altera grupos de WhatsApp reais. Cria uma ação para todos os grupos das campanhas escolhidas: \"nome\" (troca o nome dos grupos; use {n} para o número do grupo), \"descricao\" (troca a descrição), \"abrir\" (todos podem mandar mensagem), \"fechar\" (só administradores mandam) ou \"imagem\" (troca a foto dos grupos: suba antes com preparar_upload uma imagem JPG quadrada, de 192 a 640 px, e passe a midia_url em imagem_url). Confirme com o usuário antes de chamar. Sem agendar_para, roda agora. Precisa de chave com permissão de envio. Devolve os ids das ações criadas e o link da tela de Ações.",
    inputSchema: {
      type: "object",
      properties: {
        campanhas: { type: "array", items: UUID, minItems: 1, description: "Ids das campanhas (veja listar_campanhas). Uma ação por campanha." },
        tipo: { type: "string", enum: [...TIPOS_SIMPLES], description: "nome, descricao, abrir, fechar ou imagem." },
        nome: { type: "string", description: "Só para tipo \"nome\": o novo nome (ex.: \"Aulão {n}\")." },
        descricao: { type: "string", description: "Só para tipo \"descricao\": a nova descrição (até 2048 caracteres)." },
        imagem_url: { type: "string", description: "Só para tipo \"imagem\": a midia_url devolvida por preparar_upload." },
        nome_arquivo: { type: "string", description: "Opcional, só para tipo \"imagem\": nome da imagem, pra mostrar no painel." },
        agendar_para: AGENDAR_PARA,
      },
      required: ["campanhas", "tipo"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    envio: true,
    executar: async (chave, a) => {
      const tipo = a.tipo;
      if (!TIPOS_SIMPLES.includes(tipo as TipoSimples)) return erro("Tipo inválido: use nome, descricao, abrir, fechar ou imagem.");
      const conteudo = conteudoSimples(tipo as TipoSimples, a);
      return doResultado(await criarAcaoApi(chave, { campanhas: a.campanhas, tipo, conteudo, agendar_para: a.agendar_para }), acaoCriada);
    },
  },
  {
    name: "cancelar_acao",
    title: "Cancelar ação agendada",
    description:
      "Cancela uma ação que ainda está agendada (mensagem, troca de nome, foto etc.) — idêntico ao \"Cancelar\" do painel; as ações encadeadas depois dela também são canceladas. Não dá pra cancelar o que já começou. Pegue o id em listar_acoes (aba agendado). Confirme com o usuário antes de chamar. Precisa de chave com permissão de envio.",
    inputSchema: { type: "object", properties: { acao: { ...UUID, description: "Id da ação (veja listar_acoes, aba agendado)." } }, required: ["acao"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    envio: true,
    executar: async (chave, a) => doResultado(await cancelarAcaoApi(chave, a.acao), (d) => ({ ...d, link: linkAcoes(), mensagem: "Ação cancelada." })),
  },
  {
    name: "editar_acao",
    title: "Editar ação agendada",
    description:
      "ATENÇÃO: muda o que vai sair nos grupos de WhatsApp reais. Edita uma ação que ainda está agendada: o horário (agendar_para) e/ou o conteúdo, nos mesmos campos da criação — mensagem: texto OU mensagens (mesmo formato de enviar_mensagem, inclusive enquete) e/ou mencionar_todos (o que não vier fica como estava); nome: nome (use {n}); descricao: descricao; imagem: imagem_url de preparar_upload. Tipo, campanha e grupos não mudam (pra isso, cancele e crie outra). Mesmas regras da criação (horário no futuro; nome com mais de 25 caracteres só falha na hora de rodar, como na criação). Confirme com o usuário antes de chamar. Precisa de chave com permissão de envio.",
    inputSchema: {
      type: "object",
      properties: {
        acao: { ...UUID, description: "Id da ação (veja listar_acoes, aba agendado)." },
        agendar_para: { ...AGENDAR_PARA, description: "Opcional. Novo horário, ISO 8601 (sem fuso = Brasília). Sem este campo, mantém o horário." },
        texto: { type: "string", minLength: 1, description: "Mensagem: troca tudo por uma mensagem só de texto. Use este OU mensagens." },
        mensagens: {
          type: "array",
          minItems: 1,
          maxItems: 10,
          description: "Mensagem: a nova sequência inteira, no formato de enviar_mensagem.mensagens. Use este OU texto.",
          items: { type: "object" },
        },
        mencionar_todos: { type: "boolean", description: "Mensagem: marca (ou deixa de marcar) todo mundo." },
        nome: { type: "string", description: "Trocar nome: o novo nome (use {n})." },
        descricao: { type: "string", description: "Trocar descrição: a nova descrição." },
        imagem_url: { type: "string", description: "Trocar imagem: a midia_url de preparar_upload." },
        nome_arquivo: { type: "string", description: "Opcional, com imagem_url: nome da imagem pro painel." },
      },
      required: ["acao"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    envio: true,
    executar: async (chave, a) =>
      doResultado(await editarAcaoApi(chave, a.acao, edicaoDeConteudo(a), a.agendar_para), (d) => ({ ...d, link: linkAcoes(), mensagem: "Ação editada." })),
  },
  {
    name: "criar_campanha",
    title: "Criar campanha",
    description:
      "ATENÇÃO: cria uma campanha de verdade no Vórtex Grupo. Ela nasce sem grupo: o primeiro é importado ou criado à mão na aba Grupos; só depois a criação automática mantém a folga. Com copiar_de, copia as configurações, as conexões, as variáveis e as regras de compra de outra campanha (como o \"Duplicar\" do painel; grupos e mensagens não são copiados). Sem copiar_de, nasce com os padrões do painel e o Padrão de criação. Confirme o nome com o usuário antes de chamar. Precisa de chave com permissão de envio. Devolve id, link de entrada e link do painel.",
    inputSchema: {
      type: "object",
      properties: {
        nome: { type: "string", minLength: 1, maxLength: 80, description: "Nome da campanha (o link de entrada é gerado dele)." },
        copiar_de: { ...UUID, description: "Opcional. Id da campanha para copiar as configurações (veja listar_campanhas)." },
        tipo: { type: "string", enum: ["campanha", "lista", "viral", "aleatorio"], description: "Opcional, só sem copiar_de. Padrão campanha." },
        projeto: { ...UUID, description: "Opcional, só sem copiar_de. Id do projeto." },
      },
      required: ["nome"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    envio: true,
    executar: async (chave, a) => doResultado(await criarCampanhaApi(chave, a)),
  },
  {
    name: "arquivar_campanha",
    title: "Arquivar campanha",
    description:
      "Arquiva uma campanha (sai da lista de campanhas e de listar_campanhas; grupos, mensagens e dados continuam e dá pra desarquivar). Com arquivada: false, desarquiva. Não mexe nos grupos do WhatsApp. Confirme a campanha com o usuário antes de chamar. Precisa de chave com permissão de envio.",
    inputSchema: {
      type: "object",
      properties: {
        campanha: { ...UUID, description: "Id da campanha (veja listar_campanhas)." },
        arquivada: { type: "boolean", description: "Opcional. false desarquiva. Padrão true." },
      },
      required: ["campanha"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    envio: true,
    executar: async (chave, a) => doResultado(await arquivarCampanhaApi(chave, a)),
  },
  {
    name: "excluir_campanha",
    title: "Excluir campanha",
    description:
      "ATENÇÃO: apaga de vez, sem volta. Exclui a campanha do Vórtex Grupo com tudo dela (grupos cadastrados, cliques, ações, mensagens agendadas, automações, variáveis, alertas e tags) — idêntico ao \"Excluir\" do painel. Os grupos continuam existindo no WhatsApp, só saem do Vórtex Grupo. Exige confirmar_nome idêntico ao nome exato da campanha e falha se houver envio em andamento. Para só tirar da lista, use arquivar_campanha. Confirme com o usuário antes de chamar. Precisa de chave com permissão de envio.",
    inputSchema: {
      type: "object",
      properties: {
        campanha: { ...UUID, description: "Id da campanha (veja listar_campanhas)." },
        confirmar_nome: { type: "string", minLength: 1, description: "O nome exato da campanha, como confirmação." },
      },
      required: ["campanha", "confirmar_nome"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    envio: true,
    executar: async (chave, a) => doResultado(await excluirCampanhaApi(chave, a)),
  },
  {
    name: "criar_modelo",
    title: "Criar modelo de mensagem",
    description:
      "Salva um modelo no Vórtex Grupo (aparece em Modelos no painel; não envia nada). tipo \"mensagem\": use texto OU mensagens (mesmo formato de enviar_mensagem, com mídia de preparar_upload) e, se quiser, mencionar_todos. tipo \"nome\": use nome. tipo \"descricao\": use descricao. tipo \"enquete\": use pergunta e opcoes. Precisa de chave com permissão de envio.",
    inputSchema: {
      type: "object",
      properties: {
        nome: { type: "string", minLength: 1, maxLength: 60, description: "Nome do modelo." },
        tipo: { type: "string", enum: ["mensagem", "enquete", "nome", "descricao"] },
        pasta: { type: "string", maxLength: 40, description: "Opcional. Pasta do modelo (ex.: Webinar 26-10)." },
        texto: { type: "string", description: "tipo mensagem: uma mensagem só de texto." },
        mensagens: { type: "array", minItems: 1, maxItems: 10, description: "tipo mensagem: sequência, no formato de enviar_mensagem.mensagens.", items: { type: "object" } },
        mencionar_todos: { type: "boolean", description: "tipo mensagem: marca todo mundo. Padrão false." },
        nome_grupo: { type: "string", description: "tipo nome: o nome dos grupos (use {n} para o número)." },
        descricao: { type: "string", description: "tipo descricao: a descrição dos grupos." },
        pergunta: { type: "string", description: "tipo enquete: a pergunta." },
        opcoes: { type: "array", items: { type: "string" }, description: "tipo enquete: as opções (2 a 12)." },
        max_respostas: { type: "integer", minimum: 1, description: "tipo enquete: quantas opções cada pessoa marca. Padrão 1." },
      },
      required: ["nome", "tipo"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    envio: true,
    executar: async (chave, a) => {
      let conteudo: unknown = {};
      if (a.tipo === "mensagem") {
        const temLista = Array.isArray(a.mensagens);
        if (temLista && a.texto !== undefined) return erro("Use texto OU mensagens, não os dois.");
        const mensagens = temLista ? (a.mensagens as unknown[]).map(mensagemDoMcp) : [{ formato: "texto", texto: typeof a.texto === "string" ? a.texto : "" }];
        conteudo = { versao: 2, mensagens, opcoes: { ...OPCOES_ENVIO_PADRAO, mencionar_todos: a.mencionar_todos === true } };
      } else if (a.tipo === "nome") conteudo = { padrao: typeof a.nome_grupo === "string" ? a.nome_grupo : "" };
      else if (a.tipo === "descricao") conteudo = { texto: typeof a.descricao === "string" ? a.descricao : "" };
      else if (a.tipo === "enquete") conteudo = { pergunta: a.pergunta ?? "", opcoes: a.opcoes ?? [], max_respostas: a.max_respostas ?? 1 };
      return doResultado(await criarModeloApi(chave, { nome: a.nome, tipo: a.tipo, pasta: a.pasta, conteudo }));
    },
  },
  {
    name: "preparar_upload",
    title: "Preparar upload de arquivo",
    description:
      "Gera um link para subir um arquivo (áudio, vídeo, imagem, documento) para o armazenamento do Vórtex Grupo, válido por 2 horas. Suba o arquivo com HTTP PUT no upload_url (o campo `exemplo` traz o comando curl pronto) e depois use a midia_url em enviar_mensagem (mensagens[].midia_url) ou em criar_acao tipo \"imagem\" (imagem_url). Não envia nada para os grupos. Precisa de chave com permissão de envio.",
    inputSchema: {
      type: "object",
      properties: {
        nome_arquivo: { type: "string", minLength: 1, description: "Nome do arquivo com extensão (ex.: audio-aquecimento.ogg, capa.jpg)." },
      },
      required: ["nome_arquivo"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    envio: true,
    executar: async (_c, a) => {
      const nome = typeof a.nome_arquivo === "string" ? a.nome_arquivo : "";
      if (!nome.trim()) return erro("Informe o nome do arquivo.");
      const prefixo = prefixoMidias();
      if (!prefixo) return erro("Armazenamento não configurado.");
      const caminho = caminhoUpload(nome);
      const { data, error } = await dbAdmin().storage.from("midias").createSignedUploadUrl(caminho);
      if (error || !data) return erro("Não foi possível preparar o upload.");
      return texto({
        upload_url: data.signedUrl,
        metodo: "PUT",
        midia_url: `${prefixo}${caminho}`,
        exemplo: `curl -X PUT -H "Content-Type: <tipo do arquivo>" --data-binary @"<caminho do arquivo>" "${data.signedUrl}"`,
      });
    },
  },
];

/** Lista pública de `tools/list` (sem os campos internos). */
export function listaDeFerramentas() {
  return FERRAMENTAS.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations }));
}

export function acharFerramenta(nome: string): Ferramenta | undefined {
  return FERRAMENTAS.find((f) => f.name === nome);
}

/** Roda a ferramenta conferindo o escopo: sem `envio`, as de envio voltam `isError` (não erro HTTP). */
export async function chamarFerramenta(f: Ferramenta, chave: ChaveAutenticada, args: Record<string, unknown>): Promise<ResultadoFerramenta> {
  if (f.envio && chave.escopo !== "envio") return erro(SEM_PERMISSAO_ENVIO);
  return f.executar(chave, args);
}
