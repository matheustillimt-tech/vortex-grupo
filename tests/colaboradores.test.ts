import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, type Chamada, type Resposta } from "./apoio/db-falso";

const hoisted = vi.hoisted(() => ({ dbAtual: undefined as unknown, ip: "1.1.1.1" }));
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => hoisted.dbAtual }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": `${hoisted.ip}, 10.0.0.1` }) }));

import {
  RESPOSTA_DA_EQUIPE,
  RESPOSTA_FORA_DA_EQUIPE,
  RESPOSTA_MUITAS_CONSULTAS,
  criarLimiteConsultas,
  numeroDaEquipe,
} from "@/src/lib/regras/colaboradores";

const CAMP = { id: "c1", arquivada: false, verificacao_colaboradores: true, conexao_criadora_id: "con-criadora" };

function usar(camp: Record<string, unknown> | null, telefones: (string | null)[] = ["5511" + "988887777", "551133334444"]) {
  const f = dbFalso((c: Chamada): Resposta => {
    if (c.tabela === "campanhas") return { data: camp };
    if (c.tabela === "campanha_conexoes") return { data: [{ conexao_id: "con-1" }] };
    if (c.tabela === "conexoes") return { data: telefones.map((telefone) => ({ telefone })) };
    return {};
  });
  hoisted.dbAtual = f.db;
  return f.chamadas;
}

let ipSeq = 0;
async function pagina() {
  (globalThis as { React?: unknown }).React = await import("react");
  const { default: Colaboradores } = await import("@/app/l/[slug]/colaboradores/page");
  const { renderToStaticMarkup } = await import("react-dom/server");
  return renderToStaticMarkup(await Colaboradores({ params: Promise.resolve({ slug: "aulao" }) }));
}
async function verificar(numero: string) {
  const { verificarColaborador } = await import("@/app/l/[slug]/colaboradores/actions");
  const form = new FormData();
  form.set("numero", numero);
  return verificarColaborador("aulao", null, form);
}

beforeEach(() => {
  // IP novo a cada teste: o limite de consultas é por IP e mora no módulo da página.
  hoisted.ip = `10.1.0.${++ipSeq}`;
});

describe("numeroDaEquipe", () => {
  it("compara com e sem 55, com e sem o nono dígito, com máscara", () => {
    const equipe = ["5511" + "988887777", null, "11 3333-4444"];
    expect(numeroDaEquipe("(11) " + "98888-7777", equipe)).toBe(true);
    expect(numeroDaEquipe("1188887777", equipe)).toBe(true);
    expect(numeroDaEquipe("+55 11 3333-4444", equipe)).toBe(true);
    expect(numeroDaEquipe("11 " + "97777-0000", equipe)).toBe(false);
    expect(numeroDaEquipe("123", equipe)).toBeNull();
    expect(numeroDaEquipe("", equipe)).toBeNull();
  });
});

describe("criarLimiteConsultas", () => {
  it("bloqueia depois do máximo na janela e libera quando ela passa", () => {
    const permitir = criarLimiteConsultas({ maximo: 2, janelaMs: 1000 });
    expect([permitir("a", 0), permitir("a", 10), permitir("a", 20), permitir("b", 20)]).toEqual([true, true, false, true]);
    expect(permitir("a", 1000)).toBe(true);
  });
});

describe("/l/[slug]/colaboradores", () => {
  it("campanha inexistente, arquivada ou com a seção desligada: página e consulta dizem Link indisponível, sem ler as conexões", async () => {
    for (const camp of [null, { ...CAMP, arquivada: true }, { ...CAMP, verificacao_colaboradores: false }, { ...CAMP, verificacao_colaboradores: undefined }]) {
      const chamadas = usar(camp);
      const html = await pagina();
      expect(html).toContain("Link indisponível.");
      expect(html).not.toContain("Verificar");
      expect(html).toContain('<meta name="robots" content="noindex"/>');
      expect(await verificar("11" + "988887777")).toEqual({ texto: "Link indisponível.", tom: "neutro" });
      expect(chamadas.some((c) => c.tabela === "conexoes" || c.tabela === "campanha_conexoes")).toBe(false);
    }
  });

  it("seção ligada: formulário (Número com DDD + Verificar) sem GET (o número não vai pra URL), noindex, sem ler conexões", async () => {
    const chamadas = usar(CAMP);
    const html = await pagina();
    expect(html).toContain("Número com DDD");
    expect(html).toContain("Verificar");
    expect(html).not.toMatch(/method="get"/i);
    expect(html).toContain('<meta name="robots" content="noindex"/>');
    expect(chamadas.some((c) => c.tabela === "conexoes")).toBe(false);
    const fonte = readFileSync(path.resolve(__dirname, "../app/l/[slug]/colaboradores/verificador.tsx"), "utf8");
    expect(fonte).toMatch(/useActionState/);
    expect(fonte).toMatch(/<form action=\{acao\}/);
  });

  it("número da equipe (conexões associadas + criadora): só 'faz parte', sem nome nem lista", async () => {
    const chamadas = usar(CAMP);
    expect(await verificar("(11) 8888-7777")).toEqual({ texto: RESPOSTA_DA_EQUIPE, tom: "ok" });
    const contas = chamadas.find((c) => c.tabela === "conexoes")!;
    expect(contas.filtros).toContainEqual(["in", "id", ["con-1", "con-criadora"]]);
  });

  it("número de fora: só 'não faz parte'", async () => {
    usar(CAMP);
    expect(await verificar("11 " + "97777-0000")).toEqual({ texto: RESPOSTA_FORA_DA_EQUIPE, tom: "erro" });
  });

  it("número inválido: pede o DDD sem ler as conexões", async () => {
    const chamadas = usar(CAMP);
    expect((await verificar("123"))?.texto).toBe("Digite o número com DDD.");
    expect(chamadas.some((c) => c.tabela === "conexoes")).toBe(false);
  });

  it("muitas consultas do mesmo IP: para de responder sim/não", async () => {
    usar(CAMP);
    for (let i = 0; i < 20; i++) expect((await verificar("11 " + "97777-0000"))?.texto).toBe(RESPOSTA_FORA_DA_EQUIPE);
    expect((await verificar("11" + "988887777"))?.texto).toBe(RESPOSTA_MUITAS_CONSULTAS);
  });
});
