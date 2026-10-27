import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, type Chamada, type Resposta } from "./apoio/db-falso";
import { liberarTudo, SEM_PERMISSAO, usarMembro } from "./apoio/permissoes";

const h = vi.hoisted(() => ({ db: undefined as unknown, historico: vi.fn() }));
vi.mock("@/src/lib/permissoes", async () => (await import("./apoio/permissoes")).permissoesFalsas());
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => h.db }));
vi.mock("@/src/lib/supabase/usuario", () => ({ exigirUsuario: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/automacoes", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/src/lib/historico", () => ({ registrarHistorico: h.historico }));
vi.mock("@/src/lib/automacoes", () => ({ sincronizarCronograma: vi.fn(async () => undefined), removerPendentes: vi.fn(async () => undefined) }));

import { duplicarAutomacoes } from "@/app/(painel)/automacoes/actions";

beforeEach(() => {
  vi.clearAllMocks();
  liberarTudo();
});

function bancoAutomacoes() {
  let n = 0;
  return dbFalso((c: Chamada): Resposta => {
    if (c.tabela === "automacoes" && c.op === "select") {
      const id = c.filtros.find((f) => f[0] === "eq" && f[1] === "id")?.[2] as string;
      return { data: { nome: `Auto ${id}`, campanha_id: "c1", gatilho: "entrada", quando: null, alvo_grupos: null, alvo_contas: null, pasta: null, provedor: null, produto: null, checkout_evento: null, automacao_acoes: [] } };
    }
    if (c.tabela === "automacoes" && c.op === "insert") return { data: { id: `copia-${++n}` } };
    return {};
  });
}

describe("duplicarAutomacoes em massa (reaproveita a duplicação por linha)", () => {
  it("N marcadas → N cópias 'Cópia de …', todas desativadas, uma entrada no histórico", async () => {
    const { db, chamadas } = bancoAutomacoes();
    h.db = db;
    const r = await duplicarAutomacoes(["a1", "a2", "a3"]);
    expect(r).toEqual({ feitas: 3, erros: [] });
    const copias = chamadas.filter((c) => c.tabela === "automacoes" && c.op === "insert").map((c) => c.dados as { nome: string; ativo: boolean });
    expect(copias.map((c) => c.nome)).toEqual(["Cópia de Auto a1", "Cópia de Auto a2", "Cópia de Auto a3"]);
    expect(copias.every((c) => c.ativo === false)).toBe(true);
    expect(h.historico).toHaveBeenCalledTimes(1);
    expect(h.historico.mock.calls[0][1]).toMatchObject({ resumo: "3 automação(ões) duplicada(s)" });
  });

  it("mais de 50: não duplica nenhuma", async () => {
    const { db, chamadas } = bancoAutomacoes();
    h.db = db;
    const ids = Array.from({ length: 51 }, (_, i) => `a${i}`);
    expect(await duplicarAutomacoes(ids)).toEqual({ feitas: 0, erros: ["Duplique no máximo 50 automações por vez."] });
    expect(chamadas).toHaveLength(0);
    expect((await duplicarAutomacoes(ids.slice(0, 50))).feitas).toBe(50);
  });

  it("sem Automações/editar: recusa", async () => {
    usarMembro({ papel: "membro", permissoes: { automacoes: "ver" } });
    h.db = bancoAutomacoes().db;
    expect(await duplicarAutomacoes(["a1"])).toEqual({ feitas: 0, erros: [SEM_PERMISSAO] });
  });
});

describe("barra da lista: Desativar, Ativar, Duplicar, Excluir (+ Mover para pasta) nas duas listas", () => {
  it("ListaAutomacoes mostra os botões nessa ordem", async () => {
    (globalThis as { React?: unknown }).React = await import("react");
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { ListaAutomacoes, SelecaoAutomacoes } = await import("@/app/(painel)/automacoes/lista");
    const html = renderToStaticMarkup(createElement(SelecaoAutomacoes, { ids: [], children: createElement(ListaAutomacoes, { automacoes: [] }) }));
    const texto = html.replace(/<[^>]+>/g, " ");
    const pos = ["Desativar", "Ativar", "Duplicar", "Excluir", "Mover para pasta"].map((r) => texto.indexOf(` ${r}`));
    expect(pos.every((p) => p >= 0)).toBe(true);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
    expect(html).toContain("content_copy");
  });

  it("a lista global e a aba da campanha usam a mesma ListaAutomacoes/SelecaoAutomacoes", () => {
    for (const f of ["app/(painel)/automacoes/page.tsx", "app/(painel)/campanhas/[id]/automacoes/page.tsx"]) {
      const texto = readFileSync(path.resolve(__dirname, "..", f), "utf8");
      expect(texto).toMatch(/<SelecaoAutomacoes /);
      expect(texto).toMatch(/<ListaAutomacoes /);
    }
    // PASTA só na lista global: a aba Automações da campanha não mostra o botão.
    expect(readFileSync(path.resolve(__dirname, "..", "app/(painel)/automacoes/page.tsx"), "utf8")).toMatch(/<BotaoPasta /);
    expect(readFileSync(path.resolve(__dirname, "..", "app/(painel)/campanhas/[id]/automacoes/page.tsx"), "utf8")).not.toMatch(/<BotaoPasta /);
  });
});
