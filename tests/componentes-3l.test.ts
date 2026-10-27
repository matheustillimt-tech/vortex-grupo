import { describe, expect, it, vi } from "vitest";

/** Componentes compartilhados da Etapa 3L (acabamento): sem as props novas, o HTML continua o de hoje; com
 *  elas, só o que foi pedido muda. Os componentes "use client" (`SeletorLinhas`, `MenuGrafico`) usam
 *  `next/navigation` — mocado como nos outros testes de componente cliente (`automacoes-duplicar-lote.test.ts`). */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/teste",
  useSearchParams: () => new URLSearchParams(),
}));

// O vitest compila o TSX no modo clássico (React.createElement): o React precisa estar no escopo global
// (mesmo padrão de tests/secoes-campanha.test.ts) pra renderizar os componentes dos arquivos .tsx.
async function html<P extends object>(Componente: (props: P) => unknown, props: P): Promise<string> {
  const React = await import("react");
  (globalThis as { React?: unknown }).React = React;
  const { renderToStaticMarkup } = await import("react-dom/server");
  return renderToStaticMarkup(React.createElement(Componente as never, props as never));
}

describe("Paginacao sem props novas", () => {
  it("texto fixo 'Linhas por página', pontas e alinhamento de hoje", async () => {
    const { Paginacao } = await import("@/app/(painel)/_componentes/paginacao");
    const saida = await html(Paginacao, { de: 1, ate: 6, total: 6, anterior: "/a", proxima: "/b", primeira: "/c", ultima: "/d" });
    expect(saida).toContain("Linhas por página");
    expect(saida).toContain("12"); // porPagina padrão
    expect(saida).toContain("1-6 de 6");
    expect(saida).toContain("Primeira página");
    expect(saida).toContain("Última página");
    expect(saida).toContain("justify-end");
    expect(saida).not.toContain("<select");
  });

  it("opcoesPorPagina + parametroPorPagina troca o texto fixo por um select", async () => {
    const { Paginacao } = await import("@/app/(painel)/_componentes/paginacao");
    const saida = await html(Paginacao, { de: 1, ate: 10, total: 42, porPagina: 10, opcoesPorPagina: [10, 25, 50], parametroPorPagina: "por" });
    expect(saida).toContain("<select");
    expect(saida).toContain("Linhas por página");
  });

  it("pontas=false esconde primeira/última; alinhar=esquerda troca o justify", async () => {
    const { Paginacao } = await import("@/app/(painel)/_componentes/paginacao");
    const saida = await html(Paginacao, { de: 1, ate: 6, total: 6, pontas: false, alinhar: "esquerda" as const });
    expect(saida).not.toContain("Primeira página");
    expect(saida).not.toContain("Última página");
    expect(saida).toContain("justify-start");
  });
});

describe("Tabela sem props novas", () => {
  it("mostra o cabeçalho mesmo vazia e não tem a 2ª linha do vazio", async () => {
    const { Tabela } = await import("@/app/(painel)/_componentes/ui");
    const saida = await html(Tabela, { colunas: ["Nome", "Telefone"], vazio: "Nenhum número conectado." });
    expect(saida).toContain("<thead");
    expect(saida).toContain("Nenhum número conectado.");
  });

  it("semCabecalhoQuandoVazio + vazioDetalhe escondem o cabeçalho e mostram a 2ª linha", async () => {
    const { Tabela } = await import("@/app/(painel)/_componentes/ui");
    const saida = await html(Tabela, {
      colunas: ["Nome"],
      vazio: "Nenhuma conexão ainda",
      vazioDetalhe: "Conecte o ChatGPT, Claude ou outro assistente compatível.",
      semCabecalhoQuandoVazio: true,
    });
    expect(saida).not.toContain("<thead");
    expect(saida).toContain("Nenhuma conexão ainda");
    expect(saida).toContain("Conecte o ChatGPT");
  });
});

describe("Janela sem props novas", () => {
  it("sem icone/acaoTopo/semFechar: título simples e botão Fechar", async () => {
    const { Janela } = await import("@/app/(painel)/_componentes/janela");
    const saida = await html(Janela, { aberta: true, aoFechar: () => {}, titulo: "Editar grupo", children: "conteúdo" });
    expect(saida).toContain("Editar grupo");
    expect(saida).toContain("Fechar");
    expect(saida).toMatch(/<h2[^>]*class="text-\[17px\] font-medium"[^>]*>Editar grupo<\/h2>/); // sem o gap/ícone extra no título
  });

  it("icone, acaoTopo e semFechar: ícone antes do título, ação antes do close, sem o close", async () => {
    const { Janela } = await import("@/app/(painel)/_componentes/janela");
    const React = await import("react");
    const saida = await html(Janela, {
      aberta: true,
      aoFechar: () => {},
      titulo: "Editar",
      icone: "campaign",
      semFechar: true,
      acaoTopo: React.createElement("button", { "aria-label": "Excluir" }, "Excluir"),
      children: "conteúdo",
    });
    expect(saida).toContain("campaign");
    expect(saida).toContain("Excluir");
    expect(saida).not.toContain('aria-label="Fechar"');
  });
});

describe("GraficoMetrica", () => {
  const serie = [
    { data: "2026-10-10", valor: 5 },
    { data: "2026-10-11", valor: 8 },
  ];

  it("sem totalGeral/series: 1 caminho de linha + 1 de área, sem a linha 'Total' extra", async () => {
    const { GraficoMetrica } = await import("@/app/(painel)/_componentes/grafico-metrica");
    const saida = await html(GraficoMetrica, { titulo: "Clicks", total: "13", serie, idGradiente: "g1" });
    expect(saida).toContain("Clicks");
    expect(saida).toContain("nos ultimos 2 Dias");
    expect(saida).not.toContain(">Total<"); // sem totalGeral, sem a linha "{totalGeral} Total"
    expect((saida.match(/<path/g) ?? []).length).toBe(2); // área + linha, modo de 1 série
  });

  it("totalGeral mostra a linha '{totalGeral} Total' acima da linha de hoje", async () => {
    const { GraficoMetrica } = await import("@/app/(painel)/_componentes/grafico-metrica");
    const saida = await html(GraficoMetrica, { titulo: "Clicks", total: "13", totalGeral: "18.181", serie, idGradiente: "g2" });
    expect(saida).toContain("18.181");
    expect(saida).toContain("Total");
  });

  it("atualizar=false esconde o chip ATUALIZAR", async () => {
    const { GraficoMetrica } = await import("@/app/(painel)/_componentes/grafico-metrica");
    const comChip = await html(GraficoMetrica, { titulo: "Clicks", total: "13", serie, idGradiente: "g3" });
    const semChip = await html(GraficoMetrica, { titulo: "Clicks", total: "13", atualizar: false, serie, idGradiente: "g3b" });
    expect(comChip).toContain("ATUALIZAR");
    expect(semChip).not.toContain("ATUALIZAR");
  });

  it("menu=false esconde o fullscreen/menu de download", async () => {
    const { GraficoMetrica } = await import("@/app/(painel)/_componentes/grafico-metrica");
    const semMenu = await html(GraficoMetrica, { titulo: "Clicks", total: "13", menu: false, serie, idGradiente: "g4" });
    expect(semMenu).not.toContain("Menu do gráfico");
    expect(semMenu).not.toContain("fullscreen");
  });

  it("id troca o id do <section> (padrão idGradiente)", async () => {
    const { GraficoMetrica } = await import("@/app/(painel)/_componentes/grafico-metrica");
    const padrao = await html(GraficoMetrica, { titulo: "Clicks", total: "13", serie, idGradiente: "g5" });
    const comId = await html(GraficoMetrica, { titulo: "Clicks", total: "13", serie, idGradiente: "g6", id: "secao-clicks" });
    expect(padrao).toContain('<section id="g5"');
    expect(comId).toContain('<section id="secao-clicks"');
    expect(comId).not.toContain("<section id=\"g6\"");
  });

  it("<text> do SVG leva font-size inline (sobrevive à exportação sem a folha de estilo da página)", async () => {
    const { GraficoMetrica } = await import("@/app/(painel)/_componentes/grafico-metrica");
    const saida = await html(GraficoMetrica, { titulo: "Clicks", total: "13", serie, idGradiente: "g-font" });
    const textos = saida.match(/<text[^>]*>/g) ?? [];
    expect(textos.length).toBeGreaterThan(0);
    for (const t of textos) expect(t).toMatch(/font-size="11"/);
  });

  it("series desenha 2 caminhos e 2 linhas de total (uma por série)", async () => {
    const { GraficoMetrica } = await import("@/app/(painel)/_componentes/grafico-metrica");
    const saida = await html(GraficoMetrica, {
      titulo: "Atividade Diária",
      series: [
        { nome: "Entraram", valores: [10, 20, 30], cor: "destaque" as const },
        { nome: "Sairam", valores: [2, 3, 4], cor: "neutro" as const },
      ],
      idGradiente: "g7",
    });
    // Modo de 2 séries: a "destaque" desenha área + linha (2 <path>), a "neutro" só a linha (1 <path>) = 3.
    expect((saida.match(/<path/g) ?? []).length).toBe(3);
    expect(saida).toContain("Entraram: 60 nos ultimos 3 Dias");
    expect(saida).toContain("Sairam: 9 nos ultimos 3 Dias");
  });
});

describe("Janela: clique no fundo nunca fecha (nem com semFechar)", () => {
  it("o fundo não tem onClick nenhum — só Esc e o botão 'close' fecham, mesmo sem ele (semFechar)", async () => {
    const { readFileSync } = await import("node:fs");
    const texto = readFileSync("app/(painel)/_componentes/janela.tsx", "utf8");
    const linhaFundo = texto.split("\n").find((l) => l.includes('aria-hidden className="fixed inset-0 bg-black/60'));
    expect(linhaFundo).toBeDefined();
    expect(linhaFundo).not.toContain("onClick");
  });
});

describe("fronteira servidor × cliente dos componentes novos", () => {
  it("SeletorLinhas, SeletorIntervalo e MenuGrafico são 'use client' e recebem só dados", async () => {
    const { readFileSync } = await import("node:fs");
    for (const arq of ["seletor-linhas.tsx", "seletor-intervalo.tsx", "menu-grafico.tsx"]) {
      const texto = readFileSync(`app/(painel)/_componentes/${arq}`, "utf8");
      expect(texto.trimStart().startsWith('"use client"')).toBe(true);
    }
  });
});
