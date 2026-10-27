import { validarCriacaoGrupos, type CampanhaEntrada } from "./campanha";
import { ehUuid } from "./uuid";
import { OPCOES_TEMPORARIAS, type OpcaoTemporarias } from "./conteudo-v2";
import { normalizarAdminsNumeros } from "./admins-numeros";
import { ERRO_IMAGEM_GRUPO_URL, lerImagemGrupoUrl } from "./imagem-grupo";

/**
 * Padrão de criação de campanhas (Etapa 3D, Tarefa 3; completo na Etapa 3K, Tarefa 2 — diálogo "tune" na lista).
 * Guardado em `configuracoes` (chave `padrao_campanha`, valor jsonb). Os campos originais
 * ("Apenas admins podem enviar mensagem", "Limite de pessoas", "Quantidade de grupos sempre disponíveis",
 * "Nome dos grupos", "Criar comunidades ao invés de grupos normais" e os admins de conta) continuam obrigatórios.
 * Os campos novos de "Configurações" e "Criação de grupos" (Etapa 3K) são todos opcionais: ausentes = padrão do
 * sistema = default da coluna de `campanhas` (nenhuma mudança pra quem nunca abriu essa parte do diálogo). O que o
 * sistema não implementa fica fora da tela e nunca entra neste tipo.
 */
export type PadraoCampanhaEntrada = {
  ativo: boolean;
  fechado: boolean;
  limite_por_grupo: number;
  folga: number;
  padrao_nome: string;
  usar_comunidade: boolean;
  admins: string[];
  /** Administradores por número (Etapa 3K, Tarefa 1 — mesma validação), opcional: ausente = nenhum número. */
  admins_numeros?: string[];
  // Configurações (Etapa 3K, Tarefa 2) — todos opcionais, ausente = default da coluna em `campanhas`.
  cookie_redirecionamento?: boolean;
  checar_duplicados?: boolean;
  deep_linking?: boolean;
  verificacao_colaboradores?: boolean;
  atualizar_links_banimento?: boolean;
  links_periodicos?: boolean;
  links_por_dia?: number;
  redefinir_link_cheio?: boolean;
  // Criação de grupos (Etapa 3K, Tarefa 2) — idem.
  aprovacao_entrada?: boolean;
  mensagens_temporarias?: OpcaoTemporarias;
  inicio_contagem?: number;
  caractere_numeracao?: string;
  numero_no_inicio?: boolean;
  nao_criar_grupos?: boolean;
  limite_cliques_sem_criar?: number | null;
  modo_criacao?: "normal" | "seguro";
  criar_aberto_fechar_24h?: boolean;
  /** "Imagem do grupo" (Etapa 3M): vale na criação da campanha (`aplicarPadraoNaCriacao`); "Aplicar em campanhas
   *  existentes" NÃO mexe nela. Ausente = sem imagem (hoje); `null` = sem imagem. Só https:// de host público. */
  imagem_grupo_url?: string | null;
  /** "Recusar automaticamente números bloqueados" (Etapa 3M, Tarefa 4): ausente = false (hoje). Vale na criação e em
   *  "Aplicar em campanhas existentes". */
  recusar_bloqueados?: boolean;
};

export type PadraoCampanha = PadraoCampanhaEntrada;

export const PADRAO_CAMPANHA_VAZIO: PadraoCampanha = {
  ativo: false,
  fechado: true,
  limite_por_grupo: 350,
  folga: 1,
  padrao_nome: "GRUPO #{n}",
  usar_comunidade: false,
  admins: [],
  admins_numeros: [],
};

/** Chaves booleanas opcionais de "Configurações"/"Criação de grupos" (Etapa 3K, Tarefa 2): cada uma, quando
 *  presente, precisa ser um booleano de verdade (nunca confiar só no tipo do TypeScript numa server action). */
const CHAVES_BOOLEANAS_OPCIONAIS = [
  "cookie_redirecionamento",
  "checar_duplicados",
  "deep_linking",
  "verificacao_colaboradores",
  "atualizar_links_banimento",
  "links_periodicos",
  "redefinir_link_cheio",
  "aprovacao_entrada",
  "numero_no_inicio",
  "nao_criar_grupos",
  "criar_aberto_fechar_24h",
  "recusar_bloqueados",
] as const satisfies readonly (keyof PadraoCampanhaEntrada)[];

/** Confere os campos novos de "Configurações" e "Criação de grupos" só quando presentes (mesmas faixas das
 *  checagens do banco, reaproveitadas de `validarOpcoesCriacao` em `criacao-grupos.ts`). */
function validarCamposOpcionais(e: PadraoCampanhaEntrada): string | null {
  for (const chave of CHAVES_BOOLEANAS_OPCIONAIS) {
    const v = e[chave];
    if (v !== undefined && typeof v !== "boolean") return `Valor inválido para "${chave}".`;
  }
  if (e.links_por_dia !== undefined && !(Number.isInteger(e.links_por_dia) && e.links_por_dia >= 1 && e.links_por_dia <= 24)) {
    return "A quantidade de atualizações por dia vai de 1 a 24.";
  }
  if (e.mensagens_temporarias !== undefined && !OPCOES_TEMPORARIAS.includes(e.mensagens_temporarias)) {
    return "Opção de mensagens temporárias inválida.";
  }
  if (e.inicio_contagem !== undefined && !(Number.isInteger(e.inicio_contagem) && e.inicio_contagem >= 0)) {
    return "O início da contagem não pode ser negativo.";
  }
  if (e.caractere_numeracao !== undefined && (typeof e.caractere_numeracao !== "string" || e.caractere_numeracao.length > 3)) {
    return "O caractere da numeração vai até 3 caracteres.";
  }
  if (
    e.limite_cliques_sem_criar !== undefined &&
    e.limite_cliques_sem_criar !== null &&
    !(Number.isInteger(e.limite_cliques_sem_criar) && e.limite_cliques_sem_criar >= 1)
  ) {
    return "O limite de cliques sem criar grupo precisa ser pelo menos 1.";
  }
  if (e.modo_criacao !== undefined && e.modo_criacao !== "normal" && e.modo_criacao !== "seguro") {
    return "Modo de criação inválido.";
  }
  if (e.imagem_grupo_url !== undefined && lerImagemGrupoUrl(e.imagem_grupo_url) === undefined) return ERRO_IMAGEM_GRUPO_URL;
  return null;
}

/** Mesmas regras de "Criação de grupos" da campanha (`validarCriacaoGrupos`, em `campanha.ts`): nome, limite e
 *  folga. `ativo`, `fechado`, `usar_comunidade` são booleanos (nada a validar); `admins` precisa ser lista de
 *  uuids (ids de `conexoes`) e é deduplicada; `admins_numeros`, quando presente, segue a mesma validação da
 *  Tarefa 1 (`normalizarAdminsNumeros`), sem conferir contas (o padrão não pertence a uma campanha; o conflito
 *  com as contas de cada campanha é resolvido em quem aplica o padrão). Os campos novos de "Configurações" e
 *  "Criação de grupos" são opcionais e validados por `validarCamposOpcionais`. Que as contas existam de verdade
 *  é conferido no banco por quem usa. */
export function validarPadraoCampanha(e: PadraoCampanhaEntrada): { ok: true; valor: PadraoCampanha } | { ok: false; erro: string } {
  const r = validarCriacaoGrupos(e);
  if (!r.ok) return r;
  if (!Array.isArray(e.admins) || !e.admins.every(ehUuid)) return { ok: false, erro: "Conexão de administrador inválida." };
  const erroOpcionais = validarCamposOpcionais(e);
  if (erroOpcionais) return { ok: false, erro: erroOpcionais };
  let adminsNumeros: string[] | undefined;
  if (e.admins_numeros !== undefined) {
    const n = normalizarAdminsNumeros(e.admins_numeros);
    if (!n.ok) return { ok: false, erro: n.erro };
    adminsNumeros = n.valor;
  }
  return {
    ok: true,
    valor: {
      ...e,
      padrao_nome: e.padrao_nome.trim(),
      admins: [...new Set(e.admins)],
      ...(adminsNumeros !== undefined ? { admins_numeros: adminsNumeros } : {}),
      // Vazio vira null; ausente continua ausente (padrão salvo antes da Etapa 3M fica igual).
      ...(e.imagem_grupo_url !== undefined ? { imagem_grupo_url: lerImagemGrupoUrl(e.imagem_grupo_url) ?? null } : {}),
    },
  };
}

/** Lê `configuracoes.valor` (jsonb, formato desconhecido em tempo de compilação) como `PadraoCampanha`. Devolve
 *  `null` quando a linha não existe, não é um objeto, ou não passa pela validação (configuração corrompida não
 *  derruba `aplicarPadraoNaCriacao` nem a tela — trata como "sem padrão salvo"). Admins que não são uuid são
 *  descartados (um id estragado não invalida o padrão inteiro). Chave nova ausente no JSON (padrão salvo antes da
 *  Etapa 3K) vira `undefined` — nunca um valor que mudaria o comportamento de hoje. */
export function lerPadraoCampanha(valor: unknown): PadraoCampanha | null {
  if (!valor || typeof valor !== "object") return null;
  const v = valor as Record<string, unknown>;
  const bool = (x: unknown): boolean | undefined => (typeof x === "boolean" ? x : undefined);
  const entrada: PadraoCampanhaEntrada = {
    ativo: v.ativo === true,
    fechado: v.fechado !== false,
    limite_por_grupo: Number(v.limite_por_grupo),
    folga: Number(v.folga),
    padrao_nome: typeof v.padrao_nome === "string" ? v.padrao_nome : "",
    usar_comunidade: v.usar_comunidade === true,
    admins: Array.isArray(v.admins) ? v.admins.filter(ehUuid) : [],
    admins_numeros: Array.isArray(v.admins_numeros) ? v.admins_numeros.filter((x): x is string => typeof x === "string") : undefined,
    cookie_redirecionamento: bool(v.cookie_redirecionamento),
    checar_duplicados: bool(v.checar_duplicados),
    deep_linking: bool(v.deep_linking),
    verificacao_colaboradores: bool(v.verificacao_colaboradores),
    atualizar_links_banimento: bool(v.atualizar_links_banimento),
    links_periodicos: bool(v.links_periodicos),
    links_por_dia: typeof v.links_por_dia === "number" ? v.links_por_dia : undefined,
    redefinir_link_cheio: bool(v.redefinir_link_cheio),
    aprovacao_entrada: bool(v.aprovacao_entrada),
    mensagens_temporarias: typeof v.mensagens_temporarias === "string" ? (v.mensagens_temporarias as OpcaoTemporarias) : undefined,
    inicio_contagem: typeof v.inicio_contagem === "number" ? v.inicio_contagem : undefined,
    caractere_numeracao: typeof v.caractere_numeracao === "string" ? v.caractere_numeracao : undefined,
    numero_no_inicio: bool(v.numero_no_inicio),
    nao_criar_grupos: bool(v.nao_criar_grupos),
    limite_cliques_sem_criar:
      typeof v.limite_cliques_sem_criar === "number" ? v.limite_cliques_sem_criar : v.limite_cliques_sem_criar === null ? null : undefined,
    modo_criacao: v.modo_criacao === "normal" || v.modo_criacao === "seguro" ? v.modo_criacao : undefined,
    criar_aberto_fechar_24h: bool(v.criar_aberto_fechar_24h),
    recusar_bloqueados: bool(v.recusar_bloqueados),
    // Imagem estragada não invalida o padrão inteiro: vira "ausente" (sem imagem), como os admins que não são uuid.
    imagem_grupo_url: "imagem_grupo_url" in v ? lerImagemGrupoUrl(v.imagem_grupo_url) : undefined,
  };
  const r = validarPadraoCampanha(entrada);
  return r.ok ? r.valor : null;
}

/** Aplica o padrão (quando `ativo`) numa `CampanhaEntrada` nova: troca os campos de "Criação de grupos" e os
 *  admins pelos do padrão (as colunas novas de "Configurações"/"Criação de grupos", quando presentes no padrão,
 *  entram em `CampanhaEntrada` via índice — `criarCampanha` manda o resultado pra `salvarCampanha`, que grava a
 *  linha inteira). Nunca toca nome, slug, descrição, projeto, conexão criadora, tipo nem o restante — só o que a
 *  Tarefa 2 define. Quando `ativo` é falso, devolve a entrada sem mudar nada. Números administradores
 *  (`admins_numeros`) não fazem parte de `CampanhaEntrada` (tabela própria, por `campanhaId`) — ver
 *  `aplicarPadraoNaCriacao`, em `src/lib/padrao-campanha.ts`, que devolve os dois. */
export function aplicarPadraoEmEntrada(entrada: CampanhaEntrada, padrao: PadraoCampanha): CampanhaEntrada {
  if (!padrao.ativo) return entrada;
  const { ativo: _ativo, admins_numeros: _admins_numeros, admins, ...resto } = padrao;
  const camposPresentes: Record<string, unknown> = {};
  for (const [chave, v] of Object.entries(resto)) if (v !== undefined) camposPresentes[chave] = v;
  return {
    ...entrada,
    ...camposPresentes,
    admins: [...admins],
  } as CampanhaEntrada;
}

/** Campos do padrão que "Aplicar em campanhas existentes" grava em `campanhas` — nunca nome, imagem
 *  (`imagem_grupo_url` fica de fora da lista abaixo de propósito) nem descrição dos grupos (regra explícita do
 *  diálogo). Os campos obrigatórios sempre entram; os novos
 *  (Etapa 3K) só entram quando presentes no padrão (lista branca dinâmica — ausente no padrão = não muda o que a
 *  campanha já tem). Liga "Atualização periódica de links" junto zera `links_atualizados_em` (primeira
 *  atualização sai no próximo tick, idêntico ao interruptor da campanha em `secoes-campanha.ts`). */
export type CamposAplicaveis = Record<string, unknown>;

const CHAVES_OPCIONAIS_APLICAVEIS = [
  "cookie_redirecionamento",
  "checar_duplicados",
  "deep_linking",
  "verificacao_colaboradores",
  "atualizar_links_banimento",
  "links_periodicos",
  "links_por_dia",
  "redefinir_link_cheio",
  "aprovacao_entrada",
  "mensagens_temporarias",
  "inicio_contagem",
  "caractere_numeracao",
  "numero_no_inicio",
  "nao_criar_grupos",
  "limite_cliques_sem_criar",
  "modo_criacao",
  "criar_aberto_fechar_24h",
  "recusar_bloqueados",
] as const satisfies readonly (keyof PadraoCampanha)[];

export function camposAplicaveis(p: PadraoCampanha): CamposAplicaveis {
  const base: CamposAplicaveis = { fechado: p.fechado, limite_por_grupo: p.limite_por_grupo, folga: p.folga, padrao_nome: p.padrao_nome, usar_comunidade: p.usar_comunidade };
  for (const chave of CHAVES_OPCIONAIS_APLICAVEIS) {
    const v = p[chave];
    if (v !== undefined) base[chave] = v;
  }
  if (p.links_periodicos === true) base.links_atualizados_em = null;
  return base;
}

/** O padrão sem `ativo`: o que "Copiar de campanha existente" devolve (preenche o formulário, mantendo o
 *  interruptor "Usar padrão ao criar novas campanhas" como já estava) e o que "Aplicar em campanhas existentes"
 *  recebe (inclui `admins` e `admins_numeros`, que esse botão também grava). */
export type PadraoCampanhaCampos = Omit<PadraoCampanha, "ativo">;

/** Limite de campanhas por execução de "Aplicar em campanhas existentes". */
export const MAXIMO_CAMPANHAS_PADRAO = 200;
