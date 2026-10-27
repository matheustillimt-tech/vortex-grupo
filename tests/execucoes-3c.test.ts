import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, filtro, type Chamada, type Resposta } from "./apoio/db-falso";

const hoisted = vi.hoisted(() => ({ dbAtual: undefined as unknown, alertarMock: vi.fn(async (_a: unknown, _db?: unknown) => undefined) }));
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => hoisted.dbAtual }));
vi.mock("@/src/lib/jobs/alertas", () => ({ alertar: hoisted.alertarMock }));

import { iniciarExecucoesVencidas } from "@/src/lib/jobs/execucoes";
import { espacarEnvios } from "@/src/lib/regras/espacamento";
import { planejarTarefas } from "@/src/lib/regras/tarefas";
import { resolverConteudo } from "@/src/lib/regras/variaveis";

beforeAll(() => {
  process.env.NEXT_PUBLIC_SITE_URL ??= "https://grupos.exemplo";
});
beforeEach(() => {
  vi.clearAllMocks();
  comunidade = null;
});

const agora = new Date("2026-10-17T12:00:00.000Z");
const GRUPOS = [
  { id: "g1", conexao_id: "A", numero: 1 },
  { id: "g2", conexao_id: "B", numero: 2 },
  { id: "g3", conexao_id: "A", numero: 3 },
];
const DESTINO = "11111111-1111-4111-8111-111111111111";

type Vencida = Record<string, unknown>;
let comunidade: string | null = null;
function montar(vencidas: Vencida[], extra: (c: Chamada) => Resposta | undefined = () => undefined) {
  return dbFalso((c: Chamada): Resposta => {
    const r = extra(c);
    if (r) return r;
    if (c.tabela === "execucoes" && c.op === "update" && (c.dados as { status?: string }).status === "enviando") return { data: vencidas };
    if (c.tabela === "campanhas" && c.op === "select" && filtro(c, "eq", "id") === "c1") return { data: { nome: "Camp", slug: "camp", data_aula: null, link_aula: null, comunidade_id: comunidade } };
    if (c.tabela === "campanha_variaveis") return { data: [{ chave: "cupom", valor: "VORTEX10" }] };
    if (c.tabela === "grupos" && c.op === "select" && filtro(c, "eq", "campanha_id") === "c1") {
      const ids = filtro(c, "in", "id") as string[] | undefined;
      // ativos (contexto) ou os escolhidos de qualquer estado (mover); g4 é inativo
      return { data: ids ? [...GRUPOS, { id: "g4", conexao_id: "B", numero: 4 }].filter((g) => ids.includes(g.id)) : GRUPOS };
    }
    return {};
  });
}
const vencida = (extra: Vencida): Vencida => ({
  id: "e1",
  campanha_id: "c1",
  tipo: "abrir",
  origem: "avulsa",
  gatilho_chave: null,
  conteudo: {},
  alvo_grupos: null,
  alvo_contas: null,
  agendada_para: agora.toISOString(),
  ...extra,
});
const tarefasInseridas = (chamadas: Chamada[]) => chamadas.filter((c) => c.tabela === "tarefas" && c.op === "upsert").flatMap((c) => c.dados as Record<string, unknown>[]);

describe("iniciarExecucoesVencidas — Etapa 3C", () => {
  it("alvo_contas: só grupos das conexões escolhidas viram tarefa", async () => {
    const { db, chamadas } = montar([vencida({ alvo_contas: ["B"] })]);
    hoisted.dbAtual = db;
    await iniciarExecucoesVencidas(agora);
    expect(tarefasInseridas(chamadas).map((t) => t.grupo_id)).toEqual(["g2"]);
  });

  it("alvo_contas null (ou ausente): todos os grupos, como antes", async () => {
    const { db, chamadas } = montar([vencida({ alvo_contas: undefined })]);
    hoisted.dbAtual = db;
    await iniciarExecucoesVencidas(agora);
    expect(tarefasInseridas(chamadas).map((t) => t.grupo_id).sort()).toEqual(["g1", "g2", "g3"]);
  });

  it("alvo_contas vazio ([]): todas as conexões", async () => {
    const { db, chamadas } = montar([vencida({ alvo_contas: [] })]);
    hoisted.dbAtual = db;
    await iniciarExecucoesVencidas(agora);
    expect(tarefasInseridas(chamadas).map((t) => t.grupo_id).sort()).toEqual(["g1", "g2", "g3"]);
  });

  it("desativar_comunidade: UMA tarefa, no grupo-alvo de menor número, com a comunidade da campanha", async () => {
    comunidade = "999@g.us";
    const { db, chamadas } = montar([vencida({ tipo: "desativar_comunidade", alvo_grupos: ["g3", "g2"] })]);
    hoisted.dbAtual = db;
    await iniciarExecucoesVencidas(agora);
    const ts = tarefasInseridas(chamadas);
    expect(ts).toHaveLength(1);
    expect(ts[0]).toMatchObject({ grupo_id: "g2", conexao_id: "B", tipo: "desativar_comunidade" });
    const final = chamadas.find((c) => c.tabela === "execucoes" && c.op === "update" && (c.dados as Record<string, unknown>).conteudo_final)!;
    expect(final.dados).toEqual({ conteudo_final: { comunidade_id: "999@g.us" } });
  });

  it("desativar_comunidade sem comunidade na campanha: concluída com motivo, sem tarefa", async () => {
    const { db, chamadas } = montar([vencida({ tipo: "desativar_comunidade" })]);
    hoisted.dbAtual = db;
    await iniciarExecucoesVencidas(agora);
    expect(tarefasInseridas(chamadas)).toEqual([]);
    const fim = chamadas.find((c) => c.tabela === "execucoes" && (c.dados as { status?: string })?.status === "concluida")!;
    expect(fim.dados).toMatchObject({ status: "concluida", motivo: "Campanha sem comunidade" });
  });

  it("alvo_contas sem nenhum grupo: execução concluída sem tarefas", async () => {
    const { db, chamadas } = montar([vencida({ alvo_contas: ["Z"] })]);
    hoisted.dbAtual = db;
    await iniciarExecucoesVencidas(agora);
    expect(tarefasInseridas(chamadas)).toEqual([]);
    expect(chamadas.some((c) => c.tabela === "execucoes" && c.op === "update" && (c.dados as { status?: string }).status === "concluida")).toBe(true);
  });

  it("mensagem v2: resolve variáveis em cada mensagem e espaça os grupos pelo intervalo escolhido", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const conteudo = {
      versao: 2,
      mensagens: [
        { formato: "texto", texto: "Cupom {cupom}" },
        { formato: "imagem", midia_url: "https://x/a.jpg", nome_arquivo: null, legenda: "Use {cupom}" },
      ],
      opcoes: { mencionar_todos: false, temporarias: "nao", fixar: "nao", intervalo_grupos: "lenta", intervalo_mensagens: false },
    };
    const { db, chamadas } = montar([vencida({ tipo: "mensagem", conteudo })]);
    hoisted.dbAtual = db;
    await iniciarExecucoesVencidas(agora);
    const final = chamadas.find((c) => c.tabela === "execucoes" && c.op === "update" && (c.dados as Record<string, unknown>).conteudo_final)!;
    const msgs = ((final.dados as { conteudo_final: { mensagens: Record<string, unknown>[] } }).conteudo_final).mensagens;
    expect(msgs[0].texto).toBe("Cupom VORTEX10");
    expect(msgs[1].legenda).toBe("Use VORTEX10");
    const ts = tarefasInseridas(chamadas).filter((t) => t.conexao_id === "A").map((t) => new Date(t.enviar_apos as string).getTime());
    expect(ts[1] - ts[0]).toBe(15_000); // "lenta" = 15–30 s, sorteio 0
    vi.restoreAllMocks();
  });

  it("mensagem v2 com variável vazia: bloqueia", async () => {
    const conteudo = { versao: 2, mensagens: [{ formato: "texto", texto: "Oi {sumida}" }], opcoes: { mencionar_todos: false, temporarias: "nao", fixar: "nao", intervalo_grupos: "nao", intervalo_mensagens: false } };
    const { db, chamadas } = montar([vencida({ tipo: "mensagem", conteudo })]);
    hoisted.dbAtual = db;
    await iniciarExecucoesVencidas(agora);
    expect(chamadas.some((c) => c.tabela === "execucoes" && (c.dados as { status?: string })?.status === "bloqueada")).toBe(true);
    expect(tarefasInseridas(chamadas)).toEqual([]);
  });

  it("mover_grupos: só banco — troca a campanha (com os próximos números do destino), sem tarefas", async () => {
    const { db, chamadas } = montar([vencida({ tipo: "mover_grupos", conteudo: { campanha_destino: DESTINO }, alvo_grupos: ["g1", "g4"] })], (c) => {
      if (c.tabela === "campanhas" && filtro(c, "eq", "id") === DESTINO) return { data: { id: DESTINO, arquivada: false } };
      if (c.tabela === "grupos" && c.op === "select" && filtro(c, "eq", "campanha_id") === DESTINO) return { data: { numero: 7 } };
      return undefined;
    });
    hoisted.dbAtual = db;
    await iniciarExecucoesVencidas(agora);
    const movidos = chamadas.filter((c) => c.tabela === "grupos" && c.op === "update");
    expect(movidos.map((c) => [filtro(c, "eq", "id"), c.dados])).toEqual([
      ["g1", { campanha_id: DESTINO, numero: 8 }],
      ["g4", { campanha_id: DESTINO, numero: 9 }], // inativo, escolhido explicitamente: move também
    ]);
    expect(movidos.every((c) => filtro(c, "eq", "campanha_id") === "c1")).toBe(true);
    expect(tarefasInseridas(chamadas)).toEqual([]);
    expect(chamadas.some((c) => c.tabela === "tarefas")).toBe(false);
    expect(chamadas.some((c) => c.tabela === "execucoes" && (c.dados as { status?: string })?.status === "concluida")).toBe(true);
  });

  it("mover_grupos para campanha arquivada (ou inexistente): bloqueia e avisa, não move", async () => {
    for (const destino of [{ id: DESTINO, arquivada: true }, null]) {
      vi.clearAllMocks();
      const { db, chamadas } = montar([vencida({ tipo: "mover_grupos", conteudo: { campanha_destino: DESTINO } })], (c) =>
        c.tabela === "campanhas" && filtro(c, "eq", "id") === DESTINO ? { data: destino } : undefined,
      );
      hoisted.dbAtual = db;
      await iniciarExecucoesVencidas(agora);
      expect(chamadas.some((c) => c.tabela === "grupos" && c.op === "update")).toBe(false);
      const bloqueio = chamadas.find((c) => c.tabela === "execucoes" && (c.dados as { status?: string })?.status === "bloqueada")!;
      expect((bloqueio.dados as { motivo: string }).motivo).toMatch(destino ? /arquivada/ : /não existe/);
      expect(hoisted.alertarMock).toHaveBeenCalledTimes(1);
    }
  });

  it("mover_grupos: falha no meio volta pra agendada (a próxima move só o resto)", async () => {
    const { db, chamadas } = montar([vencida({ tipo: "mover_grupos", conteudo: { campanha_destino: DESTINO } })], (c) => {
      if (c.tabela === "campanhas" && filtro(c, "eq", "id") === DESTINO) return { data: { id: DESTINO, arquivada: false } };
      if (c.tabela === "grupos" && c.op === "update" && filtro(c, "eq", "id") === "g2") return { error: { message: "conflito" } };
      return undefined;
    });
    hoisted.dbAtual = db;
    await expect(iniciarExecucoesVencidas(agora)).rejects.toThrow(/1 grupo\(s\) movido\(s\); falhou ao mover o grupo g2/);
    expect(chamadas.some((c) => c.tabela === "execucoes" && (c.dados as { status?: string })?.status === "agendada")).toBe(true);
  });
});

it("mover_grupos sem alvo_grupos: move os ativos (respeitando alvo_contas)", async () => {
  const { db, chamadas } = montar([vencida({ tipo: "mover_grupos", conteudo: { campanha_destino: DESTINO }, alvo_contas: ["A"] })], (c) =>
    c.tabela === "campanhas" && filtro(c, "eq", "id") === DESTINO ? { data: { id: DESTINO, arquivada: false } } : undefined,
  );
  hoisted.dbAtual = db;
  await iniciarExecucoesVencidas(agora);
  expect(chamadas.filter((c) => c.tabela === "grupos" && c.op === "update").map((c) => filtro(c, "eq", "id"))).toEqual(["g1", "g3"]);
});

describe("espaçamento entre grupos", () => {
  it("sem faixa: 3–8 s como antes; com faixa: a da ação", () => {
    const inicio = new Date(0);
    const padrao = espacarEnvios([{ grupoId: "1", conexaoId: "A" }, { grupoId: "2", conexaoId: "A" }], inicio, () => 1);
    expect(padrao[1].enviarApos.getTime()).toBe(8000);
    const custom = espacarEnvios([{ grupoId: "1", conexaoId: "A" }, { grupoId: "2", conexaoId: "A", intervaloSeg: { min: 60, max: 60 } }], inicio, () => 0.3);
    expect(custom[1].enviarApos.getTime()).toBe(60_000);
  });

  it("planejarTarefas leva a faixa da execução", () => {
    const t = planejarTarefas(
      [{ execucaoId: "e", tipo: "mensagem", agendadaPara: "2026-10-17T12:00:00Z", grupos: [{ grupoId: "a", conexaoId: "A", numero: 1 }, { grupoId: "b", conexaoId: "A", numero: 2 }], intervaloSeg: { min: 2, max: 4 } }],
      new Date(0),
      () => 0.5,
    );
    expect(t.map((x) => x.enviarApos.getTime())).toEqual([0, 3000]);
  });
});

describe("resolverConteudo — v2", () => {
  it("troca em texto, legenda, botões, contato, evento e enquete; não mexe no v1", () => {
    const vars = { cupom: "X" };
    const v2 = {
      versao: 2,
      mensagens: [
        { formato: "botoes", texto: "{cupom}", botoes: [{ tipo: "link", rotulo: "{cupom}", valor: "https://a/{cupom}" }] },
        { formato: "contato", contato: { nome: "{cupom}", telefone: "5511" + "999999999" } },
        { formato: "evento", evento: { nome: "{cupom}", descricao: "{cupom}", inicio: "2026-10-20T23:00:00Z", fim: null, local: null } },
        { formato: "enquete", enquete: { pergunta: "{cupom}?", opcoes: ["{cupom}", "b"], max_respostas: 1 } },
      ],
      opcoes: {},
    };
    const r = resolverConteudo("mensagem", v2, vars);
    expect(r.faltando).toEqual([]);
    expect(r.conteudo).toEqual({
      versao: 2,
      mensagens: [
        { formato: "botoes", texto: "X", botoes: [{ tipo: "link", rotulo: "X", valor: "https://a/X" }] },
        { formato: "contato", contato: { nome: "X", telefone: "5511" + "999999999" } },
        { formato: "evento", evento: { nome: "X", descricao: "X", inicio: "2026-10-20T23:00:00Z", fim: null, local: null } },
        { formato: "enquete", enquete: { pergunta: "X?", opcoes: ["X", "b"], max_respostas: 1 } },
      ],
      opcoes: {},
    });
    const v1 = { formato: "texto", texto: "{cupom}", midia_url: null, nome_arquivo: null, mencionar_todos: false };
    expect(resolverConteudo("mensagem", v1, vars).conteudo).toEqual({ ...v1, texto: "X" });
  });
});

describe("iniciarExecucoesVencidas — prioridade das atualizações periódicas de link (Etapa 3J)", () => {
  it("atualizar_links (periódica ou não) vira tarefa de prioridade 1, atrás das mensagens", async () => {
    const periodica = montar([vencida({ tipo: "atualizar_links", origem: "campanha", gatilho_chave: "periodico:2026-10-17T12:00:00.000Z" })]);
    hoisted.dbAtual = periodica.db;
    await iniciarExecucoesVencidas(agora);
    expect(new Set(tarefasInseridas(periodica.chamadas).map((t) => t.prioridade))).toEqual(new Set([1]));
    const botao = montar([vencida({ tipo: "atualizar_links" })]);
    hoisted.dbAtual = botao.db;
    await iniciarExecucoesVencidas(agora);
    expect(new Set(tarefasInseridas(botao.chamadas).map((t) => t.prioridade))).toEqual(new Set([1]));
  });
});
