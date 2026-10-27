import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** Teste de 17/10/2026, observação F: no celular (~334 px) a etapa Conteúdo do assistente de Ações rolava pro lado.
 *  Causa (medida no navegador): a grade do editor de mensagens sem colunas no celular cria uma coluna `auto`, que
 *  cresce até o conteúdo mais largo (os botões segmentados das opções de envio, que não encolhiam). */
const ler = (f: string) => readFileSync(path.resolve(__dirname, "..", f), "utf8");

describe("layout no celular: etapa Conteúdo de Ações sem rolagem horizontal", () => {
  it("a grade do editor de mensagens tem 1 coluna que encolhe (grid-cols-1) abaixo de lg", () => {
    const src = ler("app/(painel)/_componentes/editor-mensagens/editor-mensagens.tsx");
    expect(src).toMatch(/className="grid grid-cols-1 gap-4 lg:grid-cols-\[minmax\(0,260px\)_minmax\(0,1fr\)_minmax\(0,220px\)\]"/);
  });

  it("os botões segmentados de largura total podem encolher (min-w-0) e o grupo não passa da largura", () => {
    const src = ler("app/(painel)/_componentes/editor-mensagens/segmento-radio.tsx");
    expect(src).toContain('"min-w-0 flex-1 px-1.5 sm:px-3"');
    expect(src).toContain("inline-flex max-w-full");
  });
});
