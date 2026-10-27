import { estaAtivo } from "./navegacao";
import { areaDoCaminho, type AreaOuEquipe } from "./permissoes";

export type ItemMenu = { href: string; rotulo: string; icone: string; tambem?: string[]; selo?: string };

/** Grupo em acordeão: `grupo` é a chave estável (id do `<button>`/aria-controls), `itens` nunca vazio. */
export type GrupoMenu = { grupo: string; rotulo: string; icone: string; itens: ItemMenu[] };

export type NoMenu = ItemMenu | GrupoMenu;

export function ehGrupoMenu(no: NoMenu): no is GrupoMenu {
  return "itens" in no;
}

/** Menu na ordem definida (19/10/2026): o grupo "Visão geral" saiu e os itens ficaram soltos. */
export const ITENS_MENU: NoMenu[] = [
  { href: "/", rotulo: "Início", icone: "home" },
  { href: "/numeros", rotulo: "Conexões", icone: "qr_code" },
  // Projetos mora dentro de Campanhas (botão no topo da lista, 19/10/2026): sai do menu, mas acende Campanhas.
  { href: "/campanhas", rotulo: "Campanhas", icone: "campaign", tambem: ["/projetos"] },
  // Histórico mora dentro de Ações (aba depois de Falhas, 19/10/2026): sai do menu, mas acende Ações.
  { href: "/acoes", rotulo: "Ações", icone: "offline_bolt", tambem: ["/historico"] },
  { href: "/calendario", rotulo: "Calendário", icone: "calendar_month" },
  { href: "/metricas", rotulo: "Métricas", icone: "analytics" },
  { href: "/automacoes", rotulo: "Automações", icone: "account_tree", tambem: ["/sequencias"] },
  { href: "/leads", rotulo: "Leads", icone: "groups" },
  // Integrações é um item só (19/10/2026): Hooks/Webhooks/API/MCP/Deep link viram abas no topo (`ABAS_INTEGRACOES`).
  { href: "/integracoes", rotulo: "Integrações", icone: "hub", tambem: ["/hooks", "/webhooks", "/api-externa", "/mcp", "/deeplinks"] },
  // Modelos é um item só (19/10/2026): Variáveis virou aba no topo (`ABAS_MODELOS`).
  { href: "/modelos", rotulo: "Modelos", icone: "speaker_notes", tambem: ["/variaveis"] },
  { href: "/alertas", rotulo: "Alertas", icone: "gpp_bad" },
  // Segurança é um item só (19/10/2026): Blacklists virou aba no topo do Anti-spam (`ABAS_ANTISPAM`).
  { href: "/anti-spam", rotulo: "Segurança", icone: "security", tambem: ["/blacklists"] },
  { href: "/equipe", rotulo: "Equipe", icone: "people" },
];

/** Lista plana de todos os itens (sem os cabeçalhos de grupo), na mesma ordem — pra código que só precisa
 *  achar um item pelo endereço (migalha, título da barra do topo, testes). */
export function itensDoMenu(): ItemMenu[] {
  return ITENS_MENU.flatMap((no) => (ehGrupoMenu(no) ? no.itens : [no]));
}

/** Itens do menu que a pessoa vê, em lista plana: Início sempre; os demais só com "ver" na área (Equipe só pra
 *  Administrador, que é quem recebe "equipe" em `areas`). */
export function itensMenuVisiveis(areas: readonly AreaOuEquipe[]): ItemMenu[] {
  const vistas = new Set(areas);
  return itensDoMenu().filter((i) => {
    const area = areaDoCaminho(i.href);
    return area === null || vistas.has(area);
  });
}

/** Árvore do menu (grupos + itens soltos) filtrada pelas áreas visíveis: some o subitem sem "ver", some o
 *  grupo quando nenhum subitem dele sobra. É o que a `Menu` usa pra desenhar o acordeão. */
export function arvoreMenuVisivel(areas: readonly AreaOuEquipe[]): NoMenu[] {
  const vistas = new Set(areas);
  const visivel = (i: ItemMenu) => {
    const area = areaDoCaminho(i.href);
    return area === null || vistas.has(area);
  };
  return ITENS_MENU.flatMap((no): NoMenu[] => {
    if (!ehGrupoMenu(no)) return visivel(no) ? [no] : [];
    const itens = no.itens.filter(visivel);
    return itens.length ? [{ ...no, itens }] : [];
  });
}

/** Item do menu aceso no caminho atual (o próprio endereço, as subpáginas e os endereços de `tambem`). */
export function menuAtivo(item: ItemMenu, caminho: string): boolean {
  return [item.href, ...(item.tambem ?? [])].some((h) => estaAtivo(h, caminho));
}

/** Chave do grupo que contém a página atual (pra abrir o acordeão sozinho); `null` fora de qualquer grupo. */
export function grupoAtivo(caminho: string): string | null {
  for (const no of ITENS_MENU) {
    if (ehGrupoMenu(no) && no.itens.some((i) => menuAtivo(i, caminho))) return no.grupo;
  }
  return null;
}

/** Texto da barra do topo. A home se chama "Visão geral". */
export function tituloDoCaminho(caminho: string): string {
  if (caminho === "/") return "Visão geral";
  return itensDoMenu().find((i) => i.href !== "/" && menuAtivo(i, caminho))?.rotulo ?? "Vórtex Grupo";
}

/** Abas do topo das telas de Integrações, na ordem do antigo submenu do menu lateral; Deep link entrou no fim (19/10/2026). */
export const ABAS_INTEGRACOES: { href: string; rotulo: string }[] = [
  { href: "/hooks", rotulo: "Webhooks de saída" },
  { href: "/webhooks", rotulo: "Webhooks de checkout" },
  { href: "/api-externa", rotulo: "API" },
  { href: "/mcp", rotulo: "MCP" },
  { href: "/deeplinks", rotulo: "Deep link" },
];

/** Abas do topo das telas de Modelos (o antigo grupo "Personalização" do menu lateral). */
export const ABAS_MODELOS: { href: string; rotulo: string }[] = [
  { href: "/modelos", rotulo: "Modelos" },
  { href: "/variaveis", rotulo: "Variáveis" },
];

/** Abas da campanha na ordem da tela, só as que já existem (Configurações não entra:
 *  vive fora das abas). Ordem final fixada na Etapa 3G (Tarefa 2). */
export const ABAS_CAMPANHA: { seg: string; rotulo: string }[] = [
  { seg: "", rotulo: "Visão geral" },
  { seg: "/contas", rotulo: "Conexões associadas" },
  { seg: "/diagnosticos", rotulo: "Diagnósticos" },
  { seg: "/grupos", rotulo: "Grupos" },
  { seg: "/solicitacoes", rotulo: "Solicitações de entrada" },
  { seg: "/atividades", rotulo: "Atividades" },
  { seg: "/cliques", rotulo: "Clicks" },
  { seg: "/leadscoring", rotulo: "Leadscoring" },
  { seg: "/desempenho", rotulo: "Desempenho por grupo" },
  { seg: "/mensagens", rotulo: "Mensagens" },
  { seg: "/calendario", rotulo: "Calendário" },
  { seg: "/automacoes", rotulo: "Automações" },
  { seg: "/acoes", rotulo: "Ações" },
];

/** Rótulo da aba atual da campanha, pra mostrar na migalha da barra do topo. */
export function abaDaCampanha(caminho: string, id: string): string {
  const resto = caminho.slice(`/campanhas/${id}`.length);
  if (resto.startsWith("/configuracoes")) return "Configurações";
  // "Importar grupos" não é a aba Grupos: sem a faixa de abas, a migalha termina em "Importar".
  if (resto.startsWith("/grupos/importar")) return "Importar";
  return ABAS_CAMPANHA.find((a) => a.seg && (resto === a.seg || resto.startsWith(`${a.seg}/`)))?.rotulo ?? "Visão geral";
}

/** `avatar`: mostra o avatar de 20 px (foto ou letra) antes do rótulo (nome da campanha, Etapa 3M); `foto` é a URL
 *  da foto (só dado, nunca função), ausente/null = letra. */
export type ItemTrilha = { rotulo: string; href?: string; avatar?: boolean; foto?: string | null };

/** A migalha calculada (`trilhaCampanha`, sem efeito) não sabe a foto: copia a `foto` do item de mesmo `href` que a
 *  página montou (`DefinirTrilha`, que lê a foto no servidor). Sem contexto (ou sem foto lá) = a base como está. */
export function fotoNaTrilha(base: ItemTrilha[], contexto: ItemTrilha[] | null): ItemTrilha[] {
  if (!contexto) return base;
  return base.map((i) => {
    if (!i.avatar) return i;
    const foto = contexto.find((c) => c.avatar && c.href === i.href)?.foto;
    return foto ? { ...i, foto } : i;
  });
}

/** Migalha "Campanhas › nome › aba" calculada só com o caminho e a lista de campanhas que a barra já tem em
 *  mãos (função pura, sem efeito) — pra renderizar igual no servidor e no cliente, sem o "flash" do título
 *  genérico antes de um efeito rodar. Devolve `null` quando o caminho não é de campanha ou a campanha não está
 *  na lista (ex.: arquivada, que não entra na lista do menu); nesses casos quem chama cai no `DefinirTrilha`. */
export function trilhaCampanha(caminho: string, campanhas: { id: string; nome: string }[]): ItemTrilha[] | null {
  const m = caminho.match(/^\/campanhas\/([^/]+)/);
  if (!m) return null;
  const id = m[1];
  const campanha = campanhas.find((c) => c.id === id);
  if (!campanha) return null;
  return [
    { rotulo: "Campanhas", href: "/campanhas" },
    { rotulo: campanha.nome, href: `/campanhas/${id}`, avatar: true },
    { rotulo: abaDaCampanha(caminho, id) },
  ];
}

/** Migalha "Contas › nome" calculada só com o caminho e a lista de contas que a barra já tem em mãos (igual
 *  `trilhaCampanha`). Sem a aba: a `Topo` só vê o pathname (`usePathname`), e a aba da conta vem de `?aba=` —
 *  quem precisa da aba usa `DefinirTrilha` na própria página. Devolve `null` fora de `/numeros/{id}` ou quando
 *  a conta não está na lista; nesses casos quem chama cai no `DefinirTrilha`. */
export function trilhaConta(caminho: string, contas: { id: string; nome: string }[]): ItemTrilha[] | null {
  const m = caminho.match(/^\/numeros\/([^/?]+)/);
  if (!m) return null;
  const id = m[1];
  const conta = contas.find((c) => c.id === id);
  if (!conta) return null;
  return [
    { rotulo: "Conexões", href: "/numeros" },
    { rotulo: conta.nome },
  ];
}
