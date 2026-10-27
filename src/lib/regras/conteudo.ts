import { normalizarTelefone } from "../telefone";
import type { TipoMensagem } from "./espacamento";
import { ehUuid } from "./uuid";
import { ehUrlImagemGrupo, MAXIMO_NOME_ARQUIVO_IMAGEM } from "./imagem-grupo";
import { OPCOES_TEMPORARIAS, paraV2, resumoMensagemV2, validarConteudoV2, type ConteudoV2, type OpcaoTemporarias } from "./conteudo-v2";

export const TIPOS_EXECUCAO = [
  "mensagem", "enquete", "nome", "descricao", "abrir", "fechar", "admin_add", "admin_remover", "redefinir_link",
  "configuracao", "remover_participantes", "desativar_comunidade", "atualizar_links", "mover_grupos",
  "privacidade_avancada", "imagem",
] as const;
export type TipoExecucao = (typeof TIPOS_EXECUCAO)[number];

/** O que um passo de sequência pode fazer. */
export const TIPOS_PASSO = ["mensagem", "enquete", "nome", "descricao", "abrir", "fechar"] as const;
export type TipoPasso = (typeof TIPOS_PASSO)[number];

/** O que uma ação em massa pode fazer pela fila ("mover para outra campanha" é só banco e não passa por aqui). */
export const TIPOS_MASSA = ["nome", "descricao", "abrir", "fechar", "admin_add", "admin_remover", "redefinir_link", "imagem"] as const;
export type TipoMassa = (typeof TIPOS_MASSA)[number];

export const TIPOS_MODELO = ["mensagem", "enquete", "nome", "descricao"] as const;
export type TipoModelo = (typeof TIPOS_MODELO)[number];

/** Formato antigo (Fase 1/2) de "mensagem": uma mensagem só, sem opções de envio. Continua existindo — muitos
 *  lugares usam esse formato — mas `validarConteudo("mensagem", ...)` agora também aceita o v2 (`ConteudoV2`,
 *  várias mensagens + opções). */
export type ConteudoMensagem = { formato: TipoMensagem; texto: string; midia_url: string | null; nome_arquivo: string | null; mencionar_todos: boolean };
export type ConteudoEnquete = { pergunta: string; opcoes: string[]; max_respostas: number };
/** `caractere`: caractere da numeração da campanha, gravado no `conteudo_final` ao iniciar a execução só quando não
 *  é vazio (Etapa 3E); ausente = como antes. */
export type ConteudoNome = { padrao: string; caractere?: string };
export type ConteudoDescricao = { texto: string };
export type ConteudoAdmin = { telefone: string };
/** `temporarias` (Etapa 3E, Tarefa 3): "Alterar grupos em lote" aplica `chat-disappearing` nos grupos já
 *  existentes — diferente da opção `temporarias` de uma mensagem v2 (que só liga, nunca desliga). Aqui qualquer
 *  valor, incluindo "nao", é uma troca explícita (desliga as temporárias do grupo). */
export type ConteudoConfiguracao = { so_admins_enviam?: boolean; so_admins_editam?: boolean; aprovacao_entrada?: boolean; temporarias?: OpcaoTemporarias };
export type ConteudoRemoverParticipantes = { telefones: string[] };
export type ConteudoMoverGrupos = { campanha_destino: string };
/** "Privacidade Avançada na Conversa" (Etapa 3K): `valor` true = ATIVAR, false = DESATIVAR (`limit-sharing`). */
export type ConteudoPrivacidade = { valor: boolean };
/** "Trocar imagem" (Etapa 3M): `url` https da imagem (`PUT group-picture`); `nome_arquivo` só pra mostrar. */
export type ConteudoImagem = { url: string; nome_arquivo?: string | null };
export type ConteudoVazio = Record<string, never>;
export type Conteudo =
  | ConteudoMensagem
  | ConteudoV2
  | ConteudoEnquete
  | ConteudoNome
  | ConteudoDescricao
  | ConteudoAdmin
  | ConteudoConfiguracao
  | ConteudoRemoverParticipantes
  | ConteudoMoverGrupos
  | ConteudoPrivacidade
  | ConteudoImagem
  | ConteudoVazio;

export const ROTULO_TIPO: Record<TipoExecucao, string> = {
  mensagem: "Mensagem",
  enquete: "Enquete",
  nome: "Trocar nome",
  descricao: "Trocar descrição",
  abrir: "Abrir grupo",
  fechar: "Fechar grupo",
  admin_add: "Adicionar admin",
  admin_remover: "Remover admin",
  redefinir_link: "Redefinir link",
  configuracao: "Trocar configuração",
  remover_participantes: "Remover participantes",
  desativar_comunidade: "Desativar comunidade",
  atualizar_links: "Atualizar links dos grupos",
  mover_grupos: "Mover grupos para outra campanha",
  privacidade_avancada: "Privacidade Avançada na Conversa",
  imagem: "Trocar imagem",
};

/** O que é enviado dentro do grupo (mensagens e enquetes, 0) sai antes das ações no grupo (nome, imagem,
 *  descrição, links…, 1). Pedido do dono em 20/10/2026: no lançamento de 19/10 a troca de nome/imagem das 20h
 *  passou na frente e a mensagem das 20h só começou 20h03. */
export function prioridadeDe(tipo: TipoExecucao): 0 | 1 {
  return tipo === "mensagem" || tipo === "enquete" ? 0 : 1;
}

/** Só mensagem e enquete podem ser "importantes" (reenviadas ao grupo novo). */
export function podeSerImportante(tipo: TipoExecucao): boolean {
  return tipo === "mensagem" || tipo === "enquete";
}

export function conteudoInicial(tipo: TipoExecucao): Conteudo {
  switch (tipo) {
    case "mensagem":
      return { formato: "texto", texto: "", midia_url: null, nome_arquivo: null, mencionar_todos: false };
    case "enquete":
      return { pergunta: "", opcoes: ["", ""], max_respostas: 1 };
    case "nome":
      return { padrao: "" };
    case "descricao":
      return { texto: "" };
    case "admin_add":
    case "admin_remover":
      return { telefone: "" };
    case "remover_participantes":
      return { telefones: [] };
    case "mover_grupos":
      return { campanha_destino: "" };
    case "imagem":
      return { url: "" };
    default:
      return {};
  }
}

const FORMATOS: TipoMensagem[] = ["texto", "imagem", "video", "audio", "documento"];

export type ValidacaoConteudo = { ok: true; valor: Conteudo } | { ok: false; erro: string };

/** Confere e limpa o conteúdo de um tipo. Não resolve variáveis nem confere os 25 caracteres do nome
 *  (isso depende da campanha e do número de cada grupo e é feito ao iniciar a execução).
 *  Campos ausentes e `null` (caso de conteúdo migrado da Fase 1) são tratados igual. */
export function validarConteudo(tipo: TipoExecucao, bruto: unknown): ValidacaoConteudo {
  const c = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  const txt = (k: string) => (typeof c[k] === "string" ? (c[k] as string) : "");
  switch (tipo) {
    case "mensagem": {
      if (c.versao === 2) {
        const r = validarConteudoV2(c);
        return r.ok ? { ok: true, valor: r.valor } : { ok: false, erro: r.erro };
      }
      const formato = c.formato as TipoMensagem;
      if (!FORMATOS.includes(formato)) return { ok: false, erro: "Escolha o tipo da mensagem." };
      const midia = txt("midia_url") || null;
      if (formato === "texto" && !txt("texto").trim()) return { ok: false, erro: "Escreva a mensagem." };
      if (formato !== "texto" && !midia) return { ok: false, erro: "Envie o arquivo." };
      return {
        ok: true,
        valor: {
          formato,
          texto: formato === "audio" ? "" : txt("texto"),
          midia_url: formato === "texto" ? null : midia,
          nome_arquivo: formato === "texto" ? null : txt("nome_arquivo") || null,
          mencionar_todos: formato === "texto" && c.mencionar_todos === true,
        },
      };
    }
    case "enquete": {
      const pergunta = txt("pergunta").trim();
      const opcoes = (Array.isArray(c.opcoes) ? c.opcoes : []).map((o) => String(o).trim()).filter(Boolean);
      const max = Number(c.max_respostas);
      if (!pergunta) return { ok: false, erro: "Escreva a pergunta da enquete." };
      if (opcoes.length < 2 || opcoes.length > 12) return { ok: false, erro: "A enquete precisa de 2 a 12 opções." };
      if (new Set(opcoes).size !== opcoes.length) return { ok: false, erro: "As opções da enquete não podem se repetir." };
      if (!Number.isInteger(max) || max < 1 || max > opcoes.length) return { ok: false, erro: `O máximo de respostas vai de 1 a ${opcoes.length}.` };
      return { ok: true, valor: { pergunta, opcoes, max_respostas: max } };
    }
    case "nome": {
      const padrao = txt("padrao").trim();
      if (!padrao) return { ok: false, erro: "Escreva o novo nome." };
      return { ok: true, valor: { padrao } };
    }
    case "descricao": {
      const texto = txt("texto");
      if (Array.from(texto).length > 2048) return { ok: false, erro: "A descrição vai até 2048 caracteres." };
      return { ok: true, valor: { texto } };
    }
    case "admin_add":
    case "admin_remover": {
      const telefone = normalizarTelefone(txt("telefone"));
      if (!telefone) return { ok: false, erro: "Telefone inválido: use DDD + número." };
      return { ok: true, valor: { telefone } };
    }
    case "abrir":
    case "fechar":
    case "redefinir_link":
    case "desativar_comunidade":
    case "atualizar_links":
      return { ok: true, valor: {} };
    case "configuracao": {
      const bool = (k: string) => (typeof c[k] === "boolean" ? (c[k] as boolean) : undefined);
      const temporarias = OPCOES_TEMPORARIAS.includes(c.temporarias as OpcaoTemporarias) ? (c.temporarias as OpcaoTemporarias) : undefined;
      const valor: ConteudoConfiguracao = { so_admins_enviam: bool("so_admins_enviam"), so_admins_editam: bool("so_admins_editam"), aprovacao_entrada: bool("aprovacao_entrada"), temporarias };
      if (valor.so_admins_enviam === undefined && valor.so_admins_editam === undefined && valor.aprovacao_entrada === undefined && valor.temporarias === undefined) {
        return { ok: false, erro: "Escolha ao menos uma configuração pra trocar." };
      }
      return { ok: true, valor };
    }
    case "remover_participantes": {
      const brutos = Array.isArray(c.telefones) ? c.telefones : [];
      if (brutos.length === 0) return { ok: false, erro: "Informe ao menos um telefone." };
      const telefones = brutos.map((t) => normalizarTelefone(String(t))).filter((t): t is string => t !== null);
      if (telefones.length !== brutos.length) return { ok: false, erro: "Telefone inválido na lista." };
      if (telefones.length > 500) return { ok: false, erro: "No máximo 500 telefones." };
      return { ok: true, valor: { telefones } };
    }
    case "privacidade_avancada": {
      if (typeof c.valor !== "boolean") return { ok: false, erro: "Escolha ATIVAR ou DESATIVAR." };
      return { ok: true, valor: { valor: c.valor } };
    }
    case "imagem": {
      const url = txt("url").trim();
      if (!url) return { ok: false, erro: "Escolha a imagem do grupo." };
      if (!ehUrlImagemGrupo(url)) return { ok: false, erro: "A imagem do grupo precisa ser enviada pelo Vórtex Grupo." };
      const nome = txt("nome_arquivo").trim();
      if (Array.from(nome).length > MAXIMO_NOME_ARQUIVO_IMAGEM) return { ok: false, erro: `O nome do arquivo vai até ${MAXIMO_NOME_ARQUIVO_IMAGEM} caracteres.` };
      return { ok: true, valor: { url, nome_arquivo: nome || null } };
    }
    case "mover_grupos": {
      const destino = txt("campanha_destino");
      if (!ehUuid(destino)) return { ok: false, erro: "Escolha a campanha de destino." };
      return { ok: true, valor: { campanha_destino: destino } };
    }
  }
}

/** Uma linha curta pra listas e calendário. */
export function resumoConteudo(tipo: TipoExecucao, conteudo: unknown): string {
  const c = (conteudo ?? {}) as Record<string, unknown>;
  const s = (k: string) => (typeof c[k] === "string" ? (c[k] as string) : "");
  switch (tipo) {
    case "mensagem": {
      const v2 = paraV2(conteudo);
      const primeiro = v2.mensagens[0] ? resumoMensagemV2(v2.mensagens[0]) : "";
      return v2.mensagens.length > 1 ? `${primeiro} (+${v2.mensagens.length - 1})` : primeiro;
    }
    case "enquete":
      return s("pergunta");
    case "nome":
      return s("padrao");
    case "descricao":
      return s("texto").slice(0, 80);
    case "admin_add":
    case "admin_remover":
      return s("telefone");
    case "privacidade_avancada":
      return typeof c.valor === "boolean" ? (c.valor ? "Ativar" : "Desativar") : "";
    case "imagem":
      return `Imagem: ${s("nome_arquivo") || "imagem"}`;
    default:
      return "";
  }
}
