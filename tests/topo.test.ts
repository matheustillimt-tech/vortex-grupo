import { describe, expect, it } from "vitest";
import { ABAS_INTEGRACOES, ABAS_MODELOS, arvoreMenuVisivel, ITENS_MENU, ehGrupoMenu, grupoAtivo, itensDoMenu, menuAtivo, tituloDoCaminho } from "@/src/lib/regras/topo";

describe("itensDoMenu", () => {
  it("segue a ordem definida (grupos flatten)", () => {
    expect(itensDoMenu().map((i) => i.rotulo)).toEqual([
      "Início",
      "Conexões",
      "Campanhas",
      "Ações",
      "Calendário",
      "Métricas",
      "Automações",
      "Leads",
      "Integrações",
      "Modelos",
      "Alertas",
      "Segurança",
      "Equipe",
    ]);
    expect(itensDoMenu().map((i) => i.href)).toEqual([
      "/",
      "/numeros",
      "/campanhas",
      "/acoes",
      "/calendario",
      "/metricas",
      "/automacoes",
      "/leads",
      "/integracoes",
      "/modelos",
      "/alertas",
      "/anti-spam",
      "/equipe",
    ]);
  });
});

describe("ITENS_MENU (grupos)", () => {
  it("não sobrou nenhum acordeão: Visão geral saiu e Segurança virou item único", () => {
    expect(ITENS_MENU.filter(ehGrupoMenu).map((g) => g.grupo)).toEqual([]);
  });

  it("some o grupo quando nenhum subitem sobra, e some o subitem sem 'ver'", () => {
    const arvore = arvoreMenuVisivel(["leads"]);
    expect(arvore.some((no) => ehGrupoMenu(no))).toBe(false);
    expect(arvore.map((no) => no.rotulo)).toEqual(["Início", "Leads"]);
  });

  it("só Conexões aparece (solta) quando só a área conexões está liberada", () => {
    expect(arvoreMenuVisivel(["contas"]).map((no) => no.rotulo)).toEqual(["Início", "Conexões"]);
  });
});

describe("grupoAtivo", () => {
  it.each([
    ["/campanhas", null],
    ["/numeros", null],
    ["/alertas", null],
    ["/metricas", null],
    ["/calendario", null],
    ["/modelos", null],
    ["/variaveis", null],
    ["/hooks", null],
    ["/hooks/historico", null],
    ["/webhooks", null],
    ["/api-externa", null],
    ["/mcp", null],
    ["/anti-spam", null],
    ["/blacklists", null],
    ["/blacklists/11111111-2222-3333-4444-555555555555", null],
    ["/", null],
    ["/acoes", null],
    ["/automacoes", null],
    ["/projetos", null],
    ["/leads", null],
    ["/deeplinks", null],
    ["/historico", null],
    ["/equipe", null],
  ])("%s → %s", (caminho, grupo) => {
    expect(grupoAtivo(caminho)).toBe(grupo);
  });
});

describe("tituloDoCaminho", () => {
  it.each([
    ["/", "Visão geral"],
    ["/campanhas", "Campanhas"],
    ["/campanhas/nova", "Campanhas"],
    ["/campanhas/abc/grupos", "Campanhas"],
    ["/projetos", "Campanhas"],
    ["/projetos/abc", "Campanhas"],
    ["/numeros", "Conexões"],
    ["/alertas", "Alertas"],
    ["/metricas", "Métricas"],
    ["/acoes", "Ações"],
    ["/acoes/abc", "Ações"],
    ["/automacoes", "Automações"],
    ["/automacoes/nova", "Automações"],
    ["/automacoes/abc", "Automações"],
    ["/sequencias", "Automações"],
    ["/sequencias/xyz", "Automações"],
    ["/leads", "Leads"],
    ["/leads/tags", "Leads"],
    ["/leads/5537" + "980001001", "Leads"],
    ["/anti-spam", "Segurança"],
    ["/anti-spam/eventos", "Segurança"],
    ["/anti-spam/contas", "Segurança"],
    ["/blacklists", "Segurança"],
    ["/blacklists/11111111-2222-3333-4444-555555555555", "Segurança"],
    ["/modelos", "Modelos"],
    ["/variaveis", "Modelos"],
    ["/hooks", "Integrações"],
    ["/hooks/historico", "Integrações"],
    ["/hooks/arquivadas", "Integrações"],
    ["/webhooks", "Integrações"],
    ["/webhooks/11111111-2222-3333-4444-555555555555", "Integrações"],
    ["/api-externa", "Integrações"],
    ["/api-externa/chaves", "Integrações"],
    ["/mcp", "Integrações"],
    ["/deeplinks", "Integrações"],
    ["/historico", "Ações"],
    ["/equipe", "Equipe"],
    ["/qualquer", "Vórtex Grupo"],
  ])("%s → %s", (caminho, titulo) => {
    expect(tituloDoCaminho(caminho)).toBe(titulo);
  });
});

describe("menuAtivo", () => {
  const todosItens = itensDoMenu();
  const automacoes = todosItens.find((i) => i.href === "/automacoes")!;
  const campanhas = todosItens.find((i) => i.href === "/campanhas")!;
  it.each([
    ["/automacoes", true],
    ["/automacoes/nova", true],
    ["/sequencias", true],
    ["/sequencias/abc", true],
    ["/sequenciasx", false],
    ["/campanhas", false],
  ])("Automações em %s → %s", (caminho, esperado) => {
    expect(menuAtivo(automacoes, caminho)).toBe(esperado);
  });
  it("Leads acende em /leads e subpáginas, não em /leadsx", () => {
    const leads = todosItens.find((i) => i.href === "/leads")!;
    expect(leads.icone).toBe("groups");
    expect(menuAtivo(leads, "/leads/tags")).toBe(true);
    expect(menuAtivo(leads, "/leads/5537" + "980001001")).toBe(true);
    expect(menuAtivo(leads, "/leadsx")).toBe(false);
    const seguranca = todosItens.find((i) => i.href === "/anti-spam")!;
    expect(seguranca.icone).toBe("security");
    expect(todosItens.some((i) => i.href === "/blacklists")).toBe(false);
    expect(menuAtivo(seguranca, "/blacklists")).toBe(true);
    expect(menuAtivo(seguranca, "/blacklists/abc")).toBe(true);
  });
  it("Projetos não fica no menu: mora dentro de Campanhas, que acende em /projetos", () => {
    expect(todosItens.some((i) => i.href === "/projetos")).toBe(false);
    expect(menuAtivo(campanhas, "/projetos")).toBe(true);
    expect(menuAtivo(campanhas, "/projetos/abc")).toBe(true);
  });
  it("os outros itens seguem só o próprio endereço", () => {
    expect(menuAtivo(campanhas, "/campanhas/abc")).toBe(true);
    expect(menuAtivo(campanhas, "/sequencias")).toBe(false);
  });
  it("Integrações é um item só e acende em Webhooks de saída, Webhooks de checkout, API e MCP (abas do topo)", () => {
    const integracoes = todosItens.find((i) => i.href === "/integracoes")!;
    expect(integracoes.icone).toBe("hub");
    for (const h of ["/hooks", "/hooks/historico", "/webhooks/abc", "/api-externa", "/mcp"]) expect(menuAtivo(integracoes, h)).toBe(true);
    expect(menuAtivo(integracoes, "/webhooksx")).toBe(false);
    for (const h of ["/hooks", "/webhooks", "/api-externa", "/mcp", "/deeplinks"]) expect(todosItens.some((i) => i.href === h)).toBe(false);
    expect(ABAS_INTEGRACOES.map((a) => a.rotulo)).toEqual(["Webhooks de saída", "Webhooks de checkout", "API", "MCP", "Deep link"]);
  });
  it("Modelos é um item só e acende em Variáveis (aba do topo)", () => {
    const modelos = todosItens.find((i) => i.href === "/modelos")!;
    expect(ITENS_MENU.some((no) => ehGrupoMenu(no) && no.grupo === "personalizacao")).toBe(false);
    for (const h of ["/modelos", "/modelos/novo", "/variaveis"]) expect(menuAtivo(modelos, h)).toBe(true);
    expect(todosItens.some((i) => i.href === "/variaveis")).toBe(false);
    expect(ABAS_MODELOS.map((a) => a.rotulo)).toEqual(["Modelos", "Variáveis"]);
  });
  it("Histórico não fica no menu: mora dentro de Ações, que acende em /historico", () => {
    expect(todosItens.some((i) => i.href === "/historico")).toBe(false);
    const acoes = todosItens.find((i) => i.href === "/acoes")!;
    expect(menuAtivo(acoes, "/historico")).toBe(true);
  });
  it("Deep link não fica no menu: é aba de Integrações, que acende em /deeplinks", () => {
    const integracoes = todosItens.find((i) => i.href === "/integracoes")!;
    expect(menuAtivo(integracoes, "/deeplinks")).toBe(true);
    expect(menuAtivo(integracoes, "/deeplinksx")).toBe(false);
  });

});
