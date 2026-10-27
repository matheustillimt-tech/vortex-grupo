import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, filtro, type Chamada, type Resposta } from "./apoio/db-falso";

const hoisted = vi.hoisted(() => ({ dbAtual: undefined as unknown, alertarMock: vi.fn(async (_a: unknown, _db?: unknown) => undefined) }));
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => hoisted.dbAtual }));
vi.mock("@/src/lib/jobs/alertas", () => ({ alertar: hoisted.alertarMock }));

import { iniciarExecucoesVencidas } from "@/src/lib/jobs/execucoes";

beforeAll(() => {
  process.env.NEXT_PUBLIC_SITE_URL ??= "https://grupos.exemplo";
});
beforeEach(() => {
  vi.clearAllMocks();
});

const agora = new Date("2026-10-17T12:00:00.000Z");
const GRUPOS = [
  { id: "g1", conexao_id: "A", numero: 1 },
  { id: "g2", conexao_id: "B", numero: 2 },
];

function montar(o: { vencidas: Record<string, unknown>[]; campanha?: { chave: string; valor: string }[]; doGrupo?: { grupo_id: string; chave: string; valor: string }[]; erroGrupo?: boolean }) {
  return dbFalso((c: Chamada): Resposta => {
    if (c.tabela === "execucoes" && c.op === "update" && (c.dados as { status?: string }).status === "enviando") return { data: o.vencidas };
    if (c.tabela === "campanhas" && c.op === "select") return { data: { nome: "Camp", slug: "camp", data_aula: null, link_aula: null, comunidade_id: null } };
    if (c.tabela === "campanha_variaveis") return { data: o.campanha ?? [{ chave: "cupom", valor: "CAMP10" }] };
    if (c.tabela === "grupo_variaveis") {
      if (o.erroGrupo) return { error: { message: "fora do ar" } };
      expect(filtro(c, "eq", "grupos.campanha_id")).toBe("c1");
      return { data: o.doGrupo ?? [] };
    }
    if (c.tabela === "grupos" && c.op === "select") return { data: GRUPOS };
    return {};
  });
}
const mensagem = (texto: string, extra: Record<string, unknown> = {}) => ({
  id: "e1",
  campanha_id: "c1",
  tipo: "mensagem",
  origem: "avulsa",
  gatilho_chave: null,
  conteudo: { formato: "texto", texto, midia_url: null, nome_arquivo: null, mencionar_todos: false },
  alvo_grupos: null,
  alvo_contas: null,
  agendada_para: agora.toISOString(),
  ...extra,
});
const tarefas = (cs: Chamada[]) => cs.filter((c) => c.tabela === "tarefas" && c.op === "upsert").flatMap((c) => c.dados as Record<string, unknown>[]);
const updatesExec = (cs: Chamada[]) => cs.filter((c) => c.tabela === "execucoes" && c.op === "update").map((c) => c.dados as Record<string, unknown>);

describe("iniciarExecucoesVencidas — variáveis por grupo (Etapa 3E)", () => {
  it("sem valores nos grupos: igual a antes (conteúdo da campanha, tarefas sem conteudo_grupo)", async () => {
    const { db, chamadas } = montar({ vencidas: [mensagem("Cupom {cupom}")] });
    hoisted.dbAtual = db;
    await iniciarExecucoesVencidas(agora);
    expect(updatesExec(chamadas).at(-1)).toMatchObject({ conteudo_final: { texto: "Cupom CAMP10" } });
    const ts = tarefas(chamadas);
    expect(ts.map((t) => t.grupo_id).sort()).toEqual(["g1", "g2"]);
    expect(ts.every((t) => !("conteudo_grupo" in t))).toBe(true);
  });

  it("valor do grupo sobrepõe o da campanha só naquele grupo", async () => {
    const { db, chamadas } = montar({ vencidas: [mensagem("Cupom {cupom}")], doGrupo: [{ grupo_id: "g2", chave: "cupom", valor: "G2VIP" }] });
    hoisted.dbAtual = db;
    await iniciarExecucoesVencidas(agora);
    expect(updatesExec(chamadas).at(-1)).toMatchObject({ conteudo_final: { texto: "Cupom CAMP10" } });
    const ts = tarefas(chamadas);
    expect(ts.find((t) => t.grupo_id === "g1")).not.toHaveProperty("conteudo_grupo");
    expect(ts.find((t) => t.grupo_id === "g2")?.conteudo_grupo).toMatchObject({ texto: "Cupom G2VIP" });
  });

  it("valor do grupo de uma variável que o conteúdo não usa: nada muda", async () => {
    const { db, chamadas } = montar({ vencidas: [mensagem("Cupom {cupom}")], doGrupo: [{ grupo_id: "g2", chave: "outra", valor: "x" }] });
    hoisted.dbAtual = db;
    await iniciarExecucoesVencidas(agora);
    expect(tarefas(chamadas).every((t) => !("conteudo_grupo" in t))).toBe(true);
  });

  it("vazia na campanha mas preenchida em todos os grupos-alvo: não bloqueia", async () => {
    const { db, chamadas } = montar({
      vencidas: [mensagem("Bônus {bonus}")],
      campanha: [],
      doGrupo: [{ grupo_id: "g1", chave: "bonus", valor: "B1" }, { grupo_id: "g2", chave: "bonus", valor: "B2" }],
    });
    hoisted.dbAtual = db;
    await iniciarExecucoesVencidas(agora);
    expect(updatesExec(chamadas).some((u) => u.status === "bloqueada")).toBe(false);
    const ts = tarefas(chamadas);
    expect(ts.find((t) => t.grupo_id === "g1")?.conteudo_grupo).toMatchObject({ texto: "Bônus B1" });
    expect(ts.find((t) => t.grupo_id === "g2")?.conteudo_grupo).toMatchObject({ texto: "Bônus B2" });
  });

  it("vazia na campanha e preenchida só em um grupo: bloqueia como antes (o outro grupo ficaria sem valor)", async () => {
    const { db, chamadas } = montar({ vencidas: [mensagem("Bônus {bonus}")], campanha: [], doGrupo: [{ grupo_id: "g1", chave: "bonus", valor: "B1" }] });
    hoisted.dbAtual = db;
    await iniciarExecucoesVencidas(agora);
    expect(updatesExec(chamadas).find((u) => u.status === "bloqueada")).toMatchObject({ motivo: "Variável {bonus} vazia na campanha Camp" });
    expect(tarefas(chamadas)).toHaveLength(0);
  });

  it("alvo só no grupo com valor: não bloqueia mesmo vazia na campanha", async () => {
    const { db, chamadas } = montar({ vencidas: [mensagem("Bônus {bonus}", { alvo_grupos: ["g1"] })], campanha: [], doGrupo: [{ grupo_id: "g1", chave: "bonus", valor: "B1" }] });
    hoisted.dbAtual = db;
    await iniciarExecucoesVencidas(agora);
    expect(tarefas(chamadas).map((t) => [t.grupo_id, (t.conteudo_grupo as { texto: string }).texto])).toEqual([["g1", "Bônus B1"]]);
  });

  it("trocar nome: confere o nome longo com o padrão de cada grupo", async () => {
    const nome = { ...mensagem(""), tipo: "nome", conteudo: { padrao: "{marca} {n}" } };
    const { db, chamadas } = montar({ vencidas: [nome], campanha: [{ chave: "marca", valor: "Curta" }], doGrupo: [{ grupo_id: "g2", chave: "marca", valor: "Um nome comprido demais pra caber" }] });
    hoisted.dbAtual = db;
    await iniciarExecucoesVencidas(agora);
    expect(updatesExec(chamadas).find((u) => u.status === "bloqueada")?.motivo).toMatch(/passa de 25 caracteres/);
  });

  it("falha ao ler as variáveis dos grupos: a execução volta pra agendada (não sai sem o valor do grupo)", async () => {
    const { db, chamadas } = montar({ vencidas: [mensagem("Cupom {cupom}")], erroGrupo: true });
    hoisted.dbAtual = db;
    await expect(iniciarExecucoesVencidas(agora)).rejects.toThrow(/não foi possível carregar/);
    expect(updatesExec(chamadas).at(-1)).toEqual({ status: "agendada" });
    expect(tarefas(chamadas)).toHaveLength(0);
  });
});

describe("iniciarExecucoesVencidas — numeração da campanha (Etapa 3E, revisão)", () => {
  function montarCom(o: { vencidas: Record<string, unknown>[]; camp?: Record<string, unknown>; extra?: (c: Chamada) => Resposta | undefined }) {
    return dbFalso((c: Chamada): Resposta => {
      const r = o.extra?.(c);
      if (r) return r;
      if (c.tabela === "execucoes" && c.op === "update" && (c.dados as { status?: string }).status === "enviando") return { data: o.vencidas };
      if (c.tabela === "campanhas" && c.op === "select") return { data: { nome: "Camp", slug: "camp", data_aula: null, link_aula: null, comunidade_id: null, ...o.camp } };
      if (c.tabela === "grupos" && c.op === "select") return { data: GRUPOS };
      return {};
    });
  }
  const nome = (padrao: string) => ({ ...mensagem(""), tipo: "nome", conteudo: { padrao } });

  it("trocar nome com caractere '' (padrão): conteudo_final igual a antes, sem chave nova", async () => {
    const { db, chamadas } = montarCom({ vencidas: [nome("Turma #{n}")], camp: { caractere_numeracao: "" } });
    hoisted.dbAtual = db;
    await iniciarExecucoesVencidas(agora);
    expect(updatesExec(chamadas).at(-1)?.conteudo_final).toEqual({ padrao: "Turma #{n}" });
  });

  it("trocar nome com caractere '!': vai no conteudo_final e conexão no limite de 25", async () => {
    const { db, chamadas } = montarCom({ vencidas: [nome("Turma {n}")], camp: { caractere_numeracao: "!" } });
    hoisted.dbAtual = db;
    await iniciarExecucoesVencidas(agora);
    expect(updatesExec(chamadas).at(-1)?.conteudo_final).toEqual({ padrao: "Turma {n}", caractere: "!" });
    const longo = montarCom({ vencidas: [nome("1234567890123456789012 {n}")], camp: { caractere_numeracao: "###" } });
    hoisted.dbAtual = longo.db;
    await iniciarExecucoesVencidas(agora);
    expect(updatesExec(longo.chamadas).find((u) => u.status === "bloqueada")?.motivo).toMatch(/1234567890123456789012 ###01/);
  });

  const DEST = "11111111-1111-4111-8111-111111111111";
  const mover = { ...mensagem(""), tipo: "mover_grupos", conteudo: { campanha_destino: DEST }, alvo_grupos: null };
  const moverCom = (destino: Record<string, unknown>, ultimo: number | null) =>
    montarCom({
      vencidas: [mover],
      extra: (c) => {
        if (c.tabela === "campanhas" && filtro(c, "eq", "id") === DEST) return { data: { id: DEST, arquivada: false, ...destino } };
        if (c.tabela === "grupos" && c.op === "select" && filtro(c, "eq", "campanha_id") === DEST) return { data: ultimo === null ? null : { numero: ultimo } };
        return undefined;
      },
    });
  const numeros = (cs: Chamada[]) => cs.filter((c) => c.tabela === "grupos" && c.op === "update").map((c) => (c.dados as { numero: number }).numero);

  it("mover grupos com inicio_contagem 1 (padrão) ou sem a coluna: o maior + 1, como antes", async () => {
    for (const destino of [{ inicio_contagem: 1 }, {}]) {
      const a = moverCom(destino, 7);
      hoisted.dbAtual = a.db;
      await iniciarExecucoesVencidas(agora);
      expect(numeros(a.chamadas)).toEqual([8, 9]);
      const b = moverCom(destino, null);
      hoisted.dbAtual = b.db;
      await iniciarExecucoesVencidas(agora);
      expect(numeros(b.chamadas)).toEqual([1, 2]);
    }
  });

  it("mover grupos respeita o inicio_contagem do destino", async () => {
    const a = moverCom({ inicio_contagem: 50 }, 7);
    hoisted.dbAtual = a.db;
    await iniciarExecucoesVencidas(agora);
    expect(numeros(a.chamadas)).toEqual([50, 51]);
  });

  it("fechar em 24 h: grupo movido pra outra campanha continua sendo fechado (busca pelo id)", async () => {
    const fechar = { ...mensagem(""), tipo: "fechar", origem: "grupo_novo", conteudo: {}, alvo_grupos: ["g9"] };
    const { db, chamadas } = montarCom({
      vencidas: [fechar],
      extra: (c) => (c.tabela === "grupos" && c.op === "select" && filtro(c, "in", "id") ? { data: [{ id: "g9", conexao_id: "B", numero: 4 }] } : undefined),
    });
    hoisted.dbAtual = db;
    await iniciarExecucoesVencidas(agora);
    const busca = chamadas.find((c) => c.tabela === "grupos" && filtro(c, "in", "id"));
    expect(filtro(busca!, "eq", "ativo")).toBe(true);
    expect(tarefas(chamadas).map((t) => [t.grupo_id, t.conexao_id, t.tipo])).toEqual([["g9", "B", "fechar"]]);
  });

  it("fechar em 24 h com o grupo ainda na campanha: não busca por fora", async () => {
    const fechar = { ...mensagem(""), tipo: "fechar", origem: "grupo_novo", conteudo: {}, alvo_grupos: ["g1"] };
    const { db, chamadas } = montarCom({ vencidas: [fechar] });
    hoisted.dbAtual = db;
    await iniciarExecucoesVencidas(agora);
    expect(chamadas.some((c) => c.tabela === "grupos" && filtro(c, "in", "id"))).toBe(false);
    expect(tarefas(chamadas).map((t) => t.grupo_id)).toEqual(["g1"]);
  });
});
