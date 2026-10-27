import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** Estrutura (revisão final da Etapa 3B): cliente não puxa módulo de servidor, ADICIONAR só pra quem edita. */

const RAIZ = path.resolve(__dirname, "..");
const PAINEL = path.join(RAIZ, "app", "(painel)");

function ler(rel: string) {
  return readFileSync(path.join(RAIZ, rel), "utf8");
}

function resolver(de: string, especificador: string): string | null {
  const base = especificador.startsWith("@/") ? path.join(RAIZ, especificador.slice(2)) : especificador.startsWith(".") ? path.resolve(path.dirname(de), especificador) : null;
  if (!base) return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}

describe("componente cliente nunca importa módulo server-only", () => {
  const clientes = (readdirSync(PAINEL, { recursive: true }) as string[])
    .map((r) => path.join(PAINEL, r))
    .filter((f) => /\.tsx?$/.test(f) && /^\s*["']use client["']/.test(readFileSync(f, "utf8")));

  it("acha os componentes cliente", () => {
    expect(clientes.length).toBeGreaterThan(20);
  });

  it.each(clientes.map((f) => path.relative(RAIZ, f)))("%s", (rel) => {
    const arquivo = path.join(RAIZ, rel);
    const codigo = readFileSync(arquivo, "utf8");
    // Só imports de valor: `import type` some na compilação.
    for (const m of codigo.matchAll(/^import\s+(?!type\s)[^;]*?from\s+["']([^"']+)["']/gm)) {
      const alvo = resolver(arquivo, m[1]);
      if (!alvo) continue;
      expect(/^import ["']server-only["']/m.test(readFileSync(alvo, "utf8")), `${rel} importa ${m[1]}, que é server-only`).toBe(false);
    }
  });

  it("filtros.tsx pega as constantes de tipos.ts, não do carregador comum.ts", () => {
    const filtros = ler("app/(painel)/_acoes/filtros.tsx");
    expect(filtros).not.toMatch(/from ["']\.\/comum["']/);
    expect(filtros).toMatch(/POR_PAGINA_ACOES[^}]*} from ["']\.\/tipos["']/);
    expect(ler("app/(painel)/_acoes/comum.ts")).toMatch(/^import "server-only";/m);
  });
});

describe("ADICIONAR e ENVIAR MENSAGEM abrem o assistente, só com campanhas/editar", () => {
  it("/acoes", () => {
    expect(ler("app/(painel)/acoes/page.tsx")).toMatch(/acoes=\{podeEditar \? <BotaoLink href="\/acoes\/nova"/);
  });
  it("/campanhas/[id]/acoes", () => {
    expect(ler("app/(painel)/campanhas/[id]/acoes/page.tsx")).toMatch(/acoes=\{podeEditar \? <BotaoLink href=\{`\/acoes\/nova\?campanha=\$\{id\}`\}/);
  });
  it("/campanhas/[id]/mensagens", () => {
    expect(ler("app/(painel)/campanhas/[id]/mensagens/page.tsx")).toMatch(/\{podeEditar && \(\s*<BotaoLink href=\{`\/acoes\/nova\?campanha=\$\{id\}&acao=mensagem`\}/);
  });
  it("o diálogo antigo saiu", () => {
    expect(existsSync(path.join(PAINEL, "campanhas", "[id]", "mensagens", "nova.tsx"))).toBe(false);
    expect(existsSync(path.join(PAINEL, "_acoes", "botao-adicionar.tsx"))).toBe(false);
  });
  it("/acoes/nova pede editar além do bloqueio", () => {
    const codigo = ler("app/(painel)/acoes/nova/page.tsx");
    expect(codigo).toMatch(/const b = await bloqueio\("campanhas"\);\s*if \(b\) return b;\s*if \(!\(await permitido\("campanhas", "editar"\)\)\) return <SemAcesso \/>;/);
  });
});

describe("faixa de abas: menu só na campanha", () => {
  it("Abas tem `menu` desligado por padrão e só o cabeçalho da campanha liga", () => {
    expect(ler("app/(painel)/_componentes/abas.tsx")).toMatch(/menu = false/);
    const comMenu = (readdirSync(PAINEL, { recursive: true }) as string[])
      .filter((r) => /\.tsx$/.test(r))
      .filter((r) => /<Abas\s+menu\b/.test(readFileSync(path.join(PAINEL, r), "utf8")))
      .map((r) => r.split(path.sep).join("/"));
    expect(comMenu).toEqual(["campanhas/[id]/cabecalho.tsx"]);
  });
});
