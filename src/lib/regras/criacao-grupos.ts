import { OPCOES_TEMPORARIAS, type OpcaoTemporarias } from "./conteudo-v2";
import { ehUrlImagemGrupo, ERRO_IMAGEM_GRUPO_URL, lerImagemGrupoUrl } from "./imagem-grupo";

/** Opções de criação de grupos da campanha (Etapa 3E). Os padrões (`PADRAO_CRIACAO`) reproduzem o comportamento de
 *  antes da Etapa 3E: mesmo nome, mesma numeração, sem chamadas extras ao Zapbot. */
export type OpcoesCriacao = {
  caractere_numeracao: string;
  inicio_contagem: number;
  numero_no_inicio: boolean;
  nao_criar_grupos: boolean;
  limite_cliques_sem_criar: number | null;
  criar_aberto_fechar_24h: boolean;
  mensagens_temporarias: OpcaoTemporarias;
  aprovacao_entrada: boolean;
  modo_criacao: "normal" | "seguro";
  /** "Imagem do grupo" (Etapa 3M): posta em cada grupo novo depois de criado (passo `foto`). Nula = sem foto (hoje). */
  imagem_grupo_url: string | null;
  /** "Recusar automaticamente números bloqueados (antispam, antispam global e blacklist)" (Etapa 3M, Tarefa 4): a
   *  conferência recusa o pedido de entrada de número bloqueado. False = nenhum pedido lido nem respondido (hoje). */
  recusar_bloqueados: boolean;
};

export const PADRAO_CRIACAO: OpcoesCriacao = {
  caractere_numeracao: "",
  inicio_contagem: 1,
  numero_no_inicio: false,
  nao_criar_grupos: false,
  limite_cliques_sem_criar: null,
  criar_aberto_fechar_24h: false,
  mensagens_temporarias: "nao",
  aprovacao_entrada: false,
  modo_criacao: "normal",
  imagem_grupo_url: null,
  recusar_bloqueados: false,
};

/** Lê as opções de uma linha de `campanhas`; coluna ausente (linha antiga, select parcial) = padrão. */
export function opcoesCriacao(c: Partial<Record<keyof OpcoesCriacao, unknown>> | null | undefined): OpcoesCriacao {
  const o = c ?? {};
  const temporarias = o.mensagens_temporarias;
  return {
    caractere_numeracao: typeof o.caractere_numeracao === "string" ? o.caractere_numeracao : PADRAO_CRIACAO.caractere_numeracao,
    inicio_contagem: typeof o.inicio_contagem === "number" && o.inicio_contagem >= 0 ? o.inicio_contagem : PADRAO_CRIACAO.inicio_contagem,
    numero_no_inicio: o.numero_no_inicio === true,
    nao_criar_grupos: o.nao_criar_grupos === true,
    limite_cliques_sem_criar: typeof o.limite_cliques_sem_criar === "number" && o.limite_cliques_sem_criar >= 1 ? o.limite_cliques_sem_criar : null,
    criar_aberto_fechar_24h: o.criar_aberto_fechar_24h === true,
    mensagens_temporarias: temporarias === "24h" || temporarias === "7d" || temporarias === "90d" ? temporarias : "nao",
    aprovacao_entrada: o.aprovacao_entrada === true,
    modo_criacao: o.modo_criacao === "seguro" ? "seguro" : "normal",
    // Só `https://` de host público; qualquer outra coisa = sem imagem (nunca chama o Zapbot com URL estranha).
    imagem_grupo_url: ehUrlImagemGrupo(o.imagem_grupo_url) ? o.imagem_grupo_url : null,
    recusar_bloqueados: o.recusar_bloqueados === true,
  };
}

/** Entrada bruta do diálogo "Criação de grupos" (aba Informações, Etapa 3E Tarefa 3): mesmo formato de
 *  `OpcoesCriacao`, mas ainda não validado — campos podem vir com o tipo errado (a validação do TypeScript não
 *  vale no limite de uma server action: outra coisa pode chamar com qualquer JSON). */
export type OpcoesCriacaoEntrada = Record<keyof OpcoesCriacao, unknown>;

function ehBooleano(v: unknown): v is boolean {
  return typeof v === "boolean";
}

/** Confere as opções de "Criação de grupos" com as mesmas faixas das checagens do banco (migração
 *  `grupos_extras`), pra dar o erro certo antes de salvar em vez de deixar o Postgres recusar — e confere que
 *  cada campo é mesmo do tipo esperado (revisão final da Etapa 3E: nunca confiar só no tipo do TypeScript numa
 *  server action). */
export function validarOpcoesCriacao(e: OpcoesCriacaoEntrada): { ok: true; valor: OpcoesCriacao } | { ok: false; erro: string } {
  if (typeof e.caractere_numeracao !== "string" || e.caractere_numeracao.length > 3) return { ok: false, erro: "O caractere da numeração vai até 3 caracteres." };
  if (typeof e.inicio_contagem !== "number" || !Number.isInteger(e.inicio_contagem) || e.inicio_contagem < 0) {
    return { ok: false, erro: "O início da contagem não pode ser negativo." };
  }
  if (e.limite_cliques_sem_criar !== null && (typeof e.limite_cliques_sem_criar !== "number" || !Number.isInteger(e.limite_cliques_sem_criar) || e.limite_cliques_sem_criar < 1)) {
    return { ok: false, erro: "O limite de cliques sem criar grupo precisa ser pelo menos 1." };
  }
  if (!OPCOES_TEMPORARIAS.includes(e.mensagens_temporarias as OpcaoTemporarias)) return { ok: false, erro: "Opção de mensagens temporárias inválida." };
  if (e.modo_criacao !== "normal" && e.modo_criacao !== "seguro") return { ok: false, erro: "Modo de criação inválido." };
  if (!ehBooleano(e.numero_no_inicio)) return { ok: false, erro: "Valor inválido para \"número no início\"." };
  if (!ehBooleano(e.nao_criar_grupos)) return { ok: false, erro: "Valor inválido para \"não criar grupos\"." };
  if (!ehBooleano(e.criar_aberto_fechar_24h)) return { ok: false, erro: "Valor inválido para \"criar grupo aberto\"." };
  if (!ehBooleano(e.aprovacao_entrada)) return { ok: false, erro: "Valor inválido para \"aprovação de entrada\"." };
  // Ausente (chamada de antes da Etapa 3M) = false aqui; quem grava só mexe na coluna quando o campo veio.
  if (e.recusar_bloqueados !== undefined && !ehBooleano(e.recusar_bloqueados)) return { ok: false, erro: "Valor inválido para \"recusar bloqueados\"." };
  // Vazio = sem imagem (null); senão, só https:// de host público.
  const imagem = lerImagemGrupoUrl(e.imagem_grupo_url);
  if (imagem === undefined) return { ok: false, erro: ERRO_IMAGEM_GRUPO_URL };
  return {
    ok: true,
    valor: {
      caractere_numeracao: e.caractere_numeracao,
      inicio_contagem: e.inicio_contagem,
      numero_no_inicio: e.numero_no_inicio,
      nao_criar_grupos: e.nao_criar_grupos,
      limite_cliques_sem_criar: e.limite_cliques_sem_criar,
      criar_aberto_fechar_24h: e.criar_aberto_fechar_24h,
      mensagens_temporarias: e.mensagens_temporarias as OpcaoTemporarias,
      aprovacao_entrada: e.aprovacao_entrada,
      modo_criacao: e.modo_criacao,
      imagem_grupo_url: imagem,
      recusar_bloqueados: e.recusar_bloqueados === true,
    },
  };
}

/** Número do próximo grupo: o maior da campanha + 1, nunca abaixo do início da contagem. Sem grupo nenhum, começa
 *  no início da contagem (padrão 1, como antes). */
export function proximoNumero(ultimo: number | null | undefined, inicio: number): number {
  if (ultimo === null || ultimo === undefined) return inicio;
  return Math.max(ultimo + 1, inicio);
}

/** Origens de criação automática (folga e link sem vaga). "manual" é o botão "Criar grupo": a pessoa pediu na hora,
 *  então as travas automáticas não valem pra ela. */
export function criacaoAutomatica(origem: string | null | undefined): boolean {
  return origem !== "manual";
}

/** Por que a criação automática não deve acontecer agora, ou null se pode. */
export function motivoNaoCriar(o: Pick<OpcoesCriacao, "nao_criar_grupos" | "limite_cliques_sem_criar">, cliquesUltimaHora: number): string | null {
  if (o.nao_criar_grupos) return "Campanha com \"Não criar grupos\" ligado: grupo não criado.";
  if (o.limite_cliques_sem_criar !== null && cliquesUltimaHora >= o.limite_cliques_sem_criar) {
    return `Cliques altos (${cliquesUltimaHora} na última hora, limite ${o.limite_cliques_sem_criar}): grupo não criado.`;
  }
  return null;
}

/** Modo seguro: no mínimo 10 min entre criações de grupo da mesma conta. */
export const ESPERA_MODO_SEGURO_MS = 10 * 60_000;

/** Até quando a criação deve esperar (null = pode criar agora). Modo normal nunca espera. */
export function esperarModoSeguro(modo: OpcoesCriacao["modo_criacao"], ultimaCriacao: Date | null, agora: Date): Date | null {
  if (modo !== "seguro" || !ultimaCriacao) return null;
  const libera = ultimaCriacao.getTime() + ESPERA_MODO_SEGURO_MS;
  return libera > agora.getTime() ? new Date(libera) : null;
}

/** Segundos do `chat-disappearing` (null = não chamar: "nao" é o padrão do WhatsApp num grupo novo). */
export function segundosTemporarias(op: OpcaoTemporarias): 86400 | 604800 | 7776000 | null {
  if (op === "24h") return 86400;
  if (op === "7d") return 604800;
  if (op === "90d") return 7776000;
  return null;
}

export const FECHAR_DEPOIS_MS = 24 * 3600_000;

/** Execução "fechar" (só admins enviam) do grupo criado aberto, 24 h depois. Origem `grupo_novo`, alvo só ele. */
export function execucaoFecharGrupo(campanhaId: string, grupoId: string, criadoEm: Date) {
  return {
    campanha_id: campanhaId,
    origem: "grupo_novo" as const,
    tipo: "fechar" as const,
    conteudo: {},
    alvo_grupos: [grupoId],
    agendada_para: new Date(criadoEm.getTime() + FECHAR_DEPOIS_MS).toISOString(),
    importante: false,
  };
}
