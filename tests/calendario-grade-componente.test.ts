import { describe, expect, it } from "vitest";

// O vitest compila o TSX no modo clássico (React.createElement): o React precisa estar no escopo global
// (mesmo padrão de tests/componentes-3l.test.ts e tests/secoes-campanha.test.ts) pra renderizar os componentes
// dos arquivos .tsx. `AlternanciaCalendario` é só `<Link>` (sem "use client", sem hooks de navegação), então
// não precisa mockar `next/navigation` como os outros testes de componente.
async function html<P extends object>(Componente: (props: P) => unknown, props: P): Promise<string> {
  const React = await import("react");
  (globalThis as { React?: unknown }).React = React;
  const { renderToStaticMarkup } = await import("react-dom/server");
  return renderToStaticMarkup(React.createElement(Componente as never, props as never));
}

describe("AlternanciaCalendario (revisão final B, item m9)", () => {
  it("não repete o título 'Calendário' — as páginas que a usam já abrem com <Pagina titulo=\"Calendário\">", async () => {
    const { AlternanciaCalendario } = await import("@/app/(painel)/_componentes/calendario-grade");
    const saida = await html(AlternanciaCalendario, { visao: "mes" as const, data: "2026-10-16", baseHref: "/calendario" });
    expect(saida).not.toContain("Calendário");
  });

  it("continua com os botões de navegação (Hoje, Mês/Semana/Agenda)", async () => {
    const { AlternanciaCalendario } = await import("@/app/(painel)/_componentes/calendario-grade");
    const saida = await html(AlternanciaCalendario, { visao: "mes" as const, data: "2026-10-16", baseHref: "/calendario" });
    expect(saida).toContain("Ir para hoje");
    expect(saida).toContain("Visão em mês");
    expect(saida).toContain("Visão em semana");
    expect(saida).toContain("Visão em agenda");
  });
});
