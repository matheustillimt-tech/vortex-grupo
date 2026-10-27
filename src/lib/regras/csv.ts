import { telefoneLegivel } from "../telefone";
import { parametrosUrl, visitanteCurto } from "./analises";
import { percentual } from "./campanhas";
import { paraV2, resumoMensagemV2 } from "./conteudo-v2";
import { camposParaTexto, type LeadLinha } from "./leads";
import { ROTULO_MOTIVO, type PessoaLinha } from "./pessoas";

export const CABECALHO_PESSOAS = ["Telefone", "Campanha", "Grupo", "Entrou em", "Saiu em", "Motivo da saída", "Situação", "Tags"];

function celula(valor: string): string {
  // Planilha aberta no Excel executa célula que começa com = + - @: vira texto com ' na frente.
  const v = /^[=+\-@\t\r]/.test(valor) ? `'${valor}` : valor;
  return /[;"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** `;` (Excel em português), UTF-8 com BOM (acentos certos no Excel), CRLF. */
export function montarCsv(cabecalho: string[], linhas: string[][]): string {
  return "﻿" + [cabecalho, ...linhas].map((l) => l.map(celula).join(";")).join("\r\n") + "\r\n";
}

/** Brasília é UTC−3 fixo (sem horário de verão desde 2019), como em `regras/horario.ts`. */
function emBrasilia(d: Date): string {
  return new Date(d.getTime() - 3 * 3600_000).toISOString();
}

export function dataCsv(iso: string | null): string {
  if (!iso) return "";
  const s = emBrasilia(new Date(iso));
  return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)} ${s.slice(11, 16)}`;
}

export function dataDoArquivo(agora: Date = new Date()): string {
  return emBrasilia(agora).slice(0, 10);
}

export function linhaCsvPessoa(p: PessoaLinha): string[] {
  return [
    telefoneLegivel(p.telefone),
    p.campanha,
    p.grupo,
    dataCsv(p.entrou_em),
    dataCsv(p.saiu_em),
    p.motivo_saida ? ROTULO_MOTIVO[p.motivo_saida] : "",
    p.saiu_em ? "Saiu" : "No grupo",
    p.tags.join(", "),
  ];
}

/** Exportação "Leads" (aba Visão geral, cadastro): Nome, Número, Campos personalizados e Tags. Diferente da
 *  exportação "Participações" (`CABECALHO_PESSOAS`/`linhaCsvPessoa`), que continua uma linha por participação. */
export const CABECALHO_LEADS = ["Nome", "Número", "Campos", "Tags"];

export function linhaCsvLead(l: LeadLinha): string[] {
  return [l.nome ?? "", telefoneLegivel(l.telefone), camposParaTexto(l.campos), l.tags.join(", ")];
}

export const CABECALHO_GRUPOS = ["Número", "Nome", "Link", "Participantes", "Cheio", "Conexão", "Criado em"];

export type GrupoCsvLinha = { numero: number; nome: string; link_convite: string | null; participantes: number; cheio: boolean; conexao: string; created_at: string };

export function linhaCsvGrupo(g: GrupoCsvLinha): string[] {
  return [String(g.numero), g.nome, g.link_convite ?? "", String(g.participantes), g.cheio ? "Sim" : "Não", g.conexao, dataCsv(g.created_at)];
}

export const CABECALHO_NUMEROS_AUTOMACAO = ["Telefone"];
export const CABECALHO_NUMEROS_AUTOMACAO_STATUS = ["Telefone", "Situação"];

const ROTULO_STATUS_REMOCAO: Record<string, string> = { fila: "Fila", processando: "Processando", ok: "Sucesso", erro: "Falha" };

export function linhaNumeroAutomacao(telefone: string): string[] {
  return [telefoneLegivel(telefone)];
}

export function linhaNumeroAutomacaoStatus(n: { telefone: string; status: string }): string[] {
  return [telefoneLegivel(n.telefone), ROTULO_STATUS_REMOCAO[n.status] ?? n.status];
}

export const CABECALHO_BLOQUEADOS = ["Telefone", "Motivo", "Origem", "Criado em"];

const ROTULO_ORIGEM_BLOQUEIO: Record<string, string> = { botao: "Botão", manual: "À mão", csv: "Planilha" };

export type BloqueadoLinha = { telefone: string; motivo: string | null; origem: string; created_at: string };

export function linhaCsvBloqueado(b: BloqueadoLinha): string[] {
  return [telefoneLegivel(b.telefone), b.motivo ?? "", ROTULO_ORIGEM_BLOQUEIO[b.origem] ?? b.origem, dataCsv(b.created_at)];
}

export const CABECALHO_LEADSCORE = ["Posição", "Telefone", "Pontos", "Recebeu", "Visualizou", "Reproduziu"];

export type LeadscoreLinha = { telefone: string; pontos: number; recebeu: number; visualizou: number; reproduziu: number };

export function linhaCsvLeadscore(posicao: number, l: LeadscoreLinha): string[] {
  return [String(posicao), telefoneLegivel(l.telefone), String(l.pontos), String(l.recebeu), String(l.visualizou), String(l.reproduziu)];
}

export const CABECALHO_DESEMPENHO = ["Posição", "Número", "Grupo", "Participantes", "Recebeu", "Visualizou", "Reproduziu", "Pontos", "Pontuação ponderada"];

export type DesempenhoLinha = { numero: number; nome: string; participantes: number; recebeu: number; visualizou: number; reproduziu: number; pontos: number; pontuacao: number };

/** Pontuação com vírgula (Excel em português). */
export function linhaCsvDesempenho(posicao: number, g: DesempenhoLinha): string[] {
  return [
    String(posicao), String(g.numero), g.nome, String(g.participantes), String(g.recebeu), String(g.visualizou), String(g.reproduziu), String(g.pontos),
    g.pontuacao.toFixed(2).replace(".", ","),
  ];
}

export const CABECALHO_ATIVIDADES = ["Número", "Grupo", "Evento", "Data"];

export type AtividadeLinha = { telefone: string; grupo_nome: string; grupo_numero: number; evento: string; em: string };

export function linhaCsvAtividade(a: AtividadeLinha): string[] {
  return [telefoneLegivel(a.telefone), `#${a.grupo_numero} ${a.grupo_nome}`, a.evento === "entrada" ? "Entraram" : "Sairam", dataCsv(a.em)];
}

export const CABECALHO_CLIQUES = ["Visitante", "Grupo", "Data", "Parâmetros da URL"];

export type CliqueLinha = {
  visitante: string;
  grupo_nome: string | null;
  grupo_numero: number | null;
  criado_em: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
};

export function linhaCsvClique(c: CliqueLinha): string[] {
  return [visitanteCurto(c.visitante), c.grupo_nome ? `#${c.grupo_numero} ${c.grupo_nome}` : "", dataCsv(c.criado_em), parametrosUrl(c)];
}

/** "Exportar CSV" por conta, na aba Diagnósticos: os grupos ativos daquela conta, com o status de admin. */
export const CABECALHO_DIAGNOSTICO = ["Grupo", "Número", "Participantes", "Admin", "Conferido em"];

export type DiagnosticoGrupoLinha = { nome: string; numero: number; participantes: number; admin: boolean; conferido_em: string | null };

export function linhaCsvDiagnostico(g: DiagnosticoGrupoLinha): string[] {
  return [g.nome, String(g.numero), String(g.participantes), g.admin ? "Sim" : "Não", g.conferido_em ? dataCsv(g.conferido_em) : "Nunca"];
}

/** "Exportar CSV" do Funil de campanhas em Métricas: uma linha por campanha ativa (do período e, quando
 *  escolhido, do projeto selecionados). */
export const CABECALHO_FUNIL = [
  "Campanha", "Cliques", "Entradas", "Percentual de entrada", "Saídas", "Participantes", "Administradores", "Leads", "Grupos", "Grupos cheios",
];

export type FunilLinhaCsv = { nome: string; cliques: number; entradas: number; saidas: number; participantes: number; admins: number; grupos: number; gruposCheios: number };

export function linhaCsvFunil(l: FunilLinhaCsv): string[] {
  return [
    l.nome, String(l.cliques), String(l.entradas), percentual(l.entradas, l.cliques), String(l.saidas), String(l.participantes), String(l.admins),
    String(l.participantes - l.admins), String(l.grupos), String(l.gruposCheios),
  ];
}

/** Status de uma tarefa (envio num grupo), como a tela de Ações mostra. */
export const ROTULO_STATUS_TAREFA: Record<string, string> = { fila: "Na fila", processando: "Processando", enviado: "Enviado", erro: "Falha" };

/** "Relatório de status de mensagens" (assistente de ação, Etapa 3K): uma linha por envio × pessoa com recibo
 *  (envio sem recibo = uma linha com Telefone vazio). Só existe pra mensagens enviadas depois de 15/10/2026. */
export const CABECALHO_STATUS_MENSAGENS = [
  "Ação", "Data de envio", "Campanha", "Grupo", "Conexão", "Status do envio", "Telefone", "Recebeu em", "Visualizou em", "Reproduziu em",
];

/** Linha de `relatorio_status_mensagens`. */
export type StatusMensagemLinha = {
  execucao_id: string;
  tipo: string;
  campanha: string;
  grupo: string;
  conta: string;
  status: string;
  enviado_em: string | null;
  telefone: string;
  recebeu_em: string | null;
  visualizou_em: string | null;
  reproduziu_em: string | null;
};

export function linhaCsvStatusMensagem(l: StatusMensagemLinha, acao: string): string[] {
  return [
    acao, dataCsv(l.enviado_em), l.campanha, l.grupo, l.conta, ROTULO_STATUS_TAREFA[l.status] ?? l.status,
    l.telefone ? telefoneLegivel(l.telefone) : "", dataCsv(l.recebeu_em), dataCsv(l.visualizou_em), dataCsv(l.reproduziu_em),
  ];
}

/** "Histórico de mensagens enviadas": uma linha por envio (tarefa) de mensagem ou enquete, sem telefone. */
export const CABECALHO_MENSAGENS_ENVIADAS = ["Data", "Campanha", "Grupo", "Conexão", "Tipo", "Mensagem", "Status", "ID da mensagem", "Entregues", "Lidos", "Origem"];

export const ROTULO_ORIGEM_EXECUCAO: Record<string, string> = {
  avulsa: "Avulsa", sequencia: "Sequência", massa: "Em massa", grupo_novo: "Grupo novo", automacao: "Automação", campanha: "Campanha",
};

/** Limite da coluna "Mensagem" do histórico. */
export const LIMITE_TEXTO_MENSAGEM = 500;

/** Texto de uma mensagem/enquete pro histórico: as mensagens v2 juntas (" | "), a pergunta da enquete, até 500
 *  caracteres. */
export function textoDaMensagem(tipo: string, conteudo: unknown): string {
  const c = (conteudo ?? {}) as Record<string, unknown>;
  const texto = tipo === "enquete" && typeof c.pergunta === "string" ? c.pergunta : paraV2(conteudo).mensagens.map(resumoMensagemV2).filter(Boolean).join(" | ");
  return Array.from(texto).slice(0, LIMITE_TEXTO_MENSAGEM).join("");
}

export type MensagemEnviadaLinha = {
  data: string | null;
  campanha: string;
  grupo: string;
  conta: string;
  tipo: string;
  conteudo: unknown;
  status: string;
  message_id: string | null;
  entregues: number;
  lidos: number;
  origem: string;
};

export function linhaCsvMensagemEnviada(l: MensagemEnviadaLinha): string[] {
  return [
    dataCsv(l.data), l.campanha, l.grupo, l.conta, l.tipo === "enquete" ? "Enquete" : "Mensagem", textoDaMensagem(l.tipo, l.conteudo),
    ROTULO_STATUS_TAREFA[l.status] ?? l.status, l.message_id ?? "", String(l.entregues ?? 0), String(l.lidos ?? 0), ROTULO_ORIGEM_EXECUCAO[l.origem] ?? l.origem,
  ];
}
