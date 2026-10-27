import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { areaDoCaminho } from "@/src/lib/regras/permissoes";
import { itensDoMenu, itensMenuVisiveis } from "@/src/lib/regras/topo";

/** Testes de estrutura (Etapa 2K): página nova ou ação nova não pode esquecer a permissão. */

const PAINEL = path.resolve(__dirname, "..", "app", "(painel)");

function arquivos(filtro: (rel: string) => boolean): string[] {
  return (readdirSync(PAINEL, { recursive: true }) as string[]).map((r) => r.split(path.sep).join("/")).filter(filtro).sort();
}

/** `campanhas/[id]/grupos/page.tsx` → `/campanhas/[id]/grupos` (grupos de rota entre parênteses somem). */
function rotaDaPagina(rel: string): string {
  const partes = rel.split("/").slice(0, -1).filter((p) => !/^\(.*\)$/.test(p));
  return "/" + partes.join("/");
}

describe("toda página com área chama bloqueio()", () => {
  const paginas = arquivos((r) => r.endsWith("/page.tsx") || r === "page.tsx");

  it("acha as páginas do painel", () => {
    expect(paginas.length).toBeGreaterThan(30);
  });

  it("só a home (page.tsx da raiz) fica sem área: página nova precisa entrar no mapa de areaDoCaminho", () => {
    expect(paginas.filter((rel) => areaDoCaminho(rotaDaPagina(rel)) === null)).toEqual(["page.tsx"]);
  });

  it.each(paginas)("%s", (rel) => {
    const area = areaDoCaminho(rotaDaPagina(rel));
    const codigo = readFileSync(path.join(PAINEL, rel), "utf8");
    if (area === null) return; // só a home (`/`): mostra os blocos pelas áreas visíveis
    // Código de verdade (não comentário): `await bloqueio("<área>")` no começo de uma instrução.
    const chamada = new RegExp(`^\\s*const \\w+ = await bloqueio\\("${area}"\\);`, "m");
    expect(chamada.test(codigo), `${rel} (área ${area}) precisa de \`const b = await bloqueio("${area}"); if (b) return b;\``).toBe(true);
    // A guarda vem antes de qualquer consulta: nada de banco antes dela no corpo da página.
    const corpo = codigo.slice(codigo.indexOf("export default"));
    const guarda = corpo.search(chamada);
    expect(guarda, `${rel}: bloqueio() fora do corpo da página`).toBeGreaterThan(0);
    for (const consulta of ["dbUsuario(", "dbAdmin(", "exigirUsuario("]) {
      const pos = corpo.indexOf(consulta);
      if (pos >= 0) expect(pos, `${rel}: ${consulta} antes do bloqueio()`).toBeGreaterThan(guarda);
    }
  });
});

describe("toda server action exportada checa permissão", () => {
  /** Alertas (sino): qualquer pessoa logada marca como visto. */
  const SO_LOGADO = new Set(["actions.ts"]);
  const servidor = arquivos((r) => /\.tsx?$/.test(r) && /^\s*["']use server["']/.test(readFileSync(path.join(PAINEL, r), "utf8")));

  it("acha os arquivos de server action (inclusive a lista de exceções)", () => {
    expect(servidor.length).toBeGreaterThanOrEqual(15);
    for (const r of SO_LOGADO) expect(servidor).toContain(r);
  });

  it.each(servidor)("%s", (rel) => {
    const codigo = readFileSync(path.join(PAINEL, rel), "utf8");
    const nomes = [...codigo.matchAll(/^export async function (\w+)/gm)].map((m) => m[1]);
    expect(nomes.length, `${rel} sem ações exportadas?`).toBeGreaterThan(0);
    for (const nome of nomes) {
      const inicio = codigo.indexOf(`export async function ${nome}(`);
      const resto = codigo.slice(inicio + 1);
      const fim = resto.search(/\n(export |async function |function |const |type )/);
      const corpo = fim >= 0 ? resto.slice(0, fim) : resto;
      if (SO_LOGADO.has(rel)) {
        expect(corpo, `${rel} → ${nome}`).toContain("exigirUsuario(");
      } else {
        expect(/^\s*(const [^=]+= )?await (checarPermissao|exigirPermissao)\(/m.test(corpo), `${rel} → ${nome} sem checarPermissao/exigirPermissao`).toBe(true);
      }
    }
  });
});

describe("menu lateral pelas áreas visíveis", () => {
  const rotulos = (areas: Parameters<typeof itensMenuVisiveis>[0]) => itensMenuVisiveis(areas).map((i) => i.rotulo);

  it("Administrador vê tudo, inclusive Equipe", () => {
    const tudo = ["campanhas", "projetos", "contas", "metricas", "automacoes", "leads", "antispam", "modelos", "variaveis", "webhooks", "historico", "equipe"] as const;
    expect(itensMenuVisiveis(tudo)).toEqual(itensDoMenu());
  });

  it("sem área nenhuma: só Início", () => {
    expect(rotulos([])).toEqual(["Início"]);
  });

  it("Campanhas também acende Ações e o Calendário (Deep link mora em Integrações); Equipe some pra quem não é Administrador", () => {
    expect(rotulos(["campanhas", "leads"])).toEqual(["Início", "Campanhas", "Ações", "Calendário", "Leads"]);
  });

  it("Conexões é o item /numeros e Automações cobre Sequências", () => {
    expect(rotulos(["contas", "automacoes"])).toEqual(["Início", "Conexões", "Automações"]);
  });
});
