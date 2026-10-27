import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Arquivo de servidor (sem "use client") só pode usar de um arquivo "use client" COMPONENTES (nome com maiúscula) ou
 * tipos. Função comum importada de um arquivo cliente vira "client reference" e quebra a página em produção
 * ("Attempted to call X() from the server") — o build não pega.
 */
const raiz = resolve(__dirname, "..");

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (n === "node_modules" || n.startsWith(".")) return [];
    return statSync(p).isDirectory() ? arquivos(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

function resolver(de: string, mod: string): string | null {
  let base: string;
  if (mod.startsWith("@/")) base = join(raiz, mod.slice(2));
  else if (mod.startsWith(".")) base = resolve(dirname(de), mod);
  else return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

const ehCliente = (p: string) => /^\s*["']use client["']/.test(readFileSync(p, "utf8"));

describe("fronteira servidor × cliente", () => {
  it("arquivo de servidor não importa função comum de arquivo 'use client'", () => {
    const problemas: string[] = [];
    for (const f of [...arquivos(join(raiz, "app")), ...arquivos(join(raiz, "src"))]) {
      const texto = readFileSync(f, "utf8");
      if (/^\s*["']use (client|server)["']/.test(texto)) continue;
      for (const m of texto.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g)) {
        if (m[1]) continue;
        const alvo = resolver(f, m[3]);
        if (!alvo || !ehCliente(alvo)) continue;
        for (const nome of m[2].split(",").map((s) => s.trim()).filter(Boolean)) {
          if (nome.startsWith("type ")) continue;
          const local = nome.split(/\s+as\s+/)[0];
          if (!/^[A-Z]/.test(local)) problemas.push(`${f.slice(raiz.length + 1)} importa ${local} de ${alvo.slice(raiz.length + 1)}`);
        }
      }
    }
    expect(problemas).toEqual([]);
  });
});

describe("props de função pra componente cliente", () => {
  it("página/componente de servidor não passa função (prop tipada com =>) pra componente 'use client'", () => {
    const todos = arquivos(join(raiz, "app")).filter((f) => f.endsWith(".tsx"));
    // Componentes cliente exportados e os nomes das props que são funções.
    const cliente = new Map<string, string[]>();
    for (const f of todos) {
      const texto = readFileSync(f, "utf8");
      if (!/^\s*["']use client["']/.test(texto)) continue;
      for (const m of texto.matchAll(/export function (\w+)\(\{[^)]*?\}:\s*\{(.*?)\}\)\s*(?::[^{]*)?\{/gs)) {
        const props = m[2].split(";").filter((p) => p.includes("=>")).map((p) => p.split(":")[0].trim().replace(/\?$/, ""));
        if (props.length) cliente.set(m[1], props);
      }
    }
    const problemas: string[] = [];
    for (const f of todos) {
      const texto = readFileSync(f, "utf8");
      if (/^\s*["']use (client|server)["']/.test(texto)) continue;
      for (const [comp, props] of cliente) {
        for (const m of texto.matchAll(new RegExp(`<${comp}\\b([^>]*)`, "gs"))) {
          for (const p of props) if (new RegExp(`\\b${p}=\\{`).test(m[1])) problemas.push(`${f.slice(raiz.length + 1)}: <${comp} ${p}=...>`);
        }
      }
    }
    expect(problemas).toEqual([]);
  });
});
