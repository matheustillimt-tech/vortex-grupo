/** Regras de Equipe e Permissões (Etapa 2K): papel (admin/membro) e permissão por área, três níveis. Puro. */

const AREAS_CHAVES = [
  "campanhas",
  "projetos",
  "contas",
  "metricas",
  "automacoes",
  "leads",
  "antispam",
  "modelos",
  "variaveis",
  "webhooks",
  "historico",
] as const;

export type AreaPermissao = (typeof AREAS_CHAVES)[number];

type DefinicaoArea = { chave: AreaPermissao; rotulo: string; soVer?: true };

export const AREAS_PERMISSAO: readonly DefinicaoArea[] = [
  { chave: "campanhas", rotulo: "Campanhas" },
  { chave: "projetos", rotulo: "Projetos" },
  { chave: "contas", rotulo: "Conexões" },
  { chave: "metricas", rotulo: "Métricas", soVer: true },
  { chave: "automacoes", rotulo: "Automações" },
  { chave: "leads", rotulo: "Leads" },
  { chave: "antispam", rotulo: "Anti-spam" },
  { chave: "modelos", rotulo: "Modelos" },
  { chave: "variaveis", rotulo: "Variáveis" },
  { chave: "webhooks", rotulo: "Webhooks" },
  { chave: "historico", rotulo: "Histórico", soVer: true },
];

const AREAS = AREAS_PERMISSAO.map((a) => a.chave) as AreaPermissao[];
const AREAS_SO_VER = new Set(AREAS_PERMISSAO.filter((a) => a.soVer).map((a) => a.chave));

export const NIVEIS = ["nenhum", "ver", "editar"] as const;
export type Nivel = (typeof NIVEIS)[number];

export const ROTULO_NIVEL: Record<Nivel, string> = {
  nenhum: "Sem acesso",
  ver: "Ver",
  editar: "Editar",
};

export type Papel = "admin" | "membro";

export type Membro = { papel: Papel; permissoes: Record<string, unknown> };

/** Padrão de um Membro novo: tudo "editar", menos as áreas só-Ver ("ver"). */
function padraoMembro(): Record<AreaPermissao, Nivel> {
  const r = {} as Record<AreaPermissao, Nivel>;
  for (const area of AREAS) r[area] = AREAS_SO_VER.has(area) ? "ver" : "editar";
  return r;
}

/** admin = tudo "editar"; membro = padrão sobrescrito pelo salvo (válido); sem linha (null) = tudo "nenhum". */
export function permissoesEfetivas(m: Membro | null): Record<AreaPermissao, Nivel> {
  if (!m) {
    const r = {} as Record<AreaPermissao, Nivel>;
    for (const area of AREAS) r[area] = "nenhum";
    return r;
  }
  if (m.papel === "admin") {
    const r = {} as Record<AreaPermissao, Nivel>;
    for (const area of AREAS) r[area] = "editar";
    return r;
  }
  const r = padraoMembro();
  const salvas = normalizarPermissoes(m.permissoes);
  for (const area of AREAS) {
    const salvo = salvas[area];
    if (salvo) r[area] = salvo;
  }
  return r;
}

/** Só chaves conhecidas, níveis válidos; áreas "soVer" limitadas a "ver" (nunca "editar"). */
export function normalizarPermissoes(entrada: unknown): Partial<Record<AreaPermissao, Nivel>> {
  const r: Partial<Record<AreaPermissao, Nivel>> = {};
  if (!entrada || typeof entrada !== "object" || Array.isArray(entrada)) return r;
  for (const [chave, valor] of Object.entries(entrada as Record<string, unknown>)) {
    if (!AREAS.includes(chave as AreaPermissao)) continue;
    if (!NIVEIS.includes(valor as Nivel)) continue;
    const area = chave as AreaPermissao;
    let nivel = valor as Nivel;
    if (AREAS_SO_VER.has(area) && nivel === "editar") nivel = "ver";
    r[area] = nivel;
  }
  return r;
}

export type AreaOuEquipe = AreaPermissao | "equipe";

/** "equipe" só vale pra admin; as demais áreas seguem permissoesEfetivas. */
export function pode(m: Membro | null, area: AreaOuEquipe, nivel: "ver" | "editar"): boolean {
  if (area === "equipe") return !!m && m.papel === "admin";
  const efetivo = permissoesEfetivas(m)[area];
  if (efetivo === "nenhum") return false;
  if (nivel === "ver") return true;
  return efetivo === "editar";
}

/** Caminho do painel → área (ou "equipe"); `/` e caminhos desconhecidos (ex.: `/login`) → null. */
export function areaDoCaminho(caminho: string): AreaOuEquipe | null {
  const limpo = caminho.split("?")[0].split("#")[0];
  if (limpo === "/" || limpo === "") return null;
  const primeiro = "/" + limpo.split("/").filter(Boolean)[0];

  const mapa: Record<string, AreaOuEquipe> = {
    "/campanhas": "campanhas",
    "/calendario": "campanhas",
    "/acoes": "campanhas",
    "/projetos": "projetos",
    "/numeros": "contas",
    "/metricas": "metricas",
    "/alertas": "metricas",
    "/automacoes": "automacoes",
    "/sequencias": "automacoes",
    "/leads": "leads",
    "/anti-spam": "antispam",
    "/blacklists": "antispam",
    "/modelos": "modelos",
    "/variaveis": "variaveis",
    "/hooks": "webhooks",
    "/webhooks": "webhooks",
    "/integracoes": "webhooks",
    "/api-externa": "webhooks",
    "/mcp": "webhooks",
    "/deeplinks": "campanhas",
    "/historico": "historico",
    "/equipe": "equipe",
  };
  return mapa[primeiro] ?? null;
}

type ErroOuNull = string | null;

/** Nunca fica sem Administrador: não dá pra rebaixar o último; ninguém se rebaixa sendo o último admin. */
export function verificarMudancaPapel(args: { admins: string[]; alvo: string; novoPapel: Papel; eu: string }): ErroOuNull {
  const { admins, alvo, novoPapel } = args;
  if (novoPapel === "admin") return null;
  const eraAdmin = admins.includes(alvo);
  if (!eraAdmin) return null;
  const outrosAdmins = admins.filter((id) => id !== alvo);
  if (outrosAdmins.length === 0) return "Precisa ficar pelo menos um Administrador.";
  return null;
}

/** Ninguém remove o próprio acesso; nunca fica sem Administrador. */
export function verificarRemocao(args: { admins: string[]; alvo: string; eu: string }): ErroOuNull {
  const { admins, alvo, eu } = args;
  if (alvo === eu) return "Você não pode remover o próprio acesso.";
  if (admins.includes(alvo) && admins.filter((id) => id !== alvo).length === 0) {
    return "Precisa ficar pelo menos um Administrador.";
  }
  return null;
}
