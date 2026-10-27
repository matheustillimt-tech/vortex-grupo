import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** `processarTarefas` com o `executarTarefa` de verdade e um Zapbot falso: progresso, retomada, parada por prazo e
 *  os efeitos no banco dos tipos novos. O banco é uma tabela `tarefas` em memória (os updates valem de verdade). */
const hoisted = vi.hoisted(() => ({ dbAtual: undefined as unknown, zAtual: undefined as unknown }));

vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => hoisted.dbAtual }));
vi.mock("@/src/lib/zapbot/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/src/lib/zapbot/client")>();
  return { ...real, zapbot: () => hoisted.zAtual };
});
vi.mock("@/src/lib/conexoes", () => ({ paraZapbot: (c: { id: string }) => ({ id: c.id, token: "t", clientToken: "c" }) }));
vi.mock("@/src/lib/jobs/alertas", () => ({ alertar: vi.fn(async () => undefined) }));
vi.mock("@/src/lib/jobs/monitor", () => ({ campanhasDoNumero: vi.fn(async () => []) }));
vi.mock("@/src/lib/automacoes", () => ({
  telefonesProtegidos: vi.fn(async () => new Set(["5511" + "933334444"])),
  telefonesConectados: vi.fn(async () => new Set(["5511" + "933334444"])),
}));

import { ZapbotError } from "@/src/lib/zapbot/client";
import { processarTarefas } from "@/src/lib/jobs/tarefas";

type Linha = Record<string, unknown> & { id: string };
type Update = { tabela: string; payload: Record<string, unknown>; filtros: [string, string, unknown][] };

function construirDb(o: { tarefas: Linha[]; exec: { tipo: string; conteudo_final: unknown }; falharProgresso?: number; explodir?: string }) {
  const tarefas = new Map(o.tarefas.map((t) => [t.id, { ...t }]));
  const updates: Update[] = [];
  let gravacoesProgresso = 0;
  const from = (tabela: string) => {
    let upd: Update | undefined;
    let single = false;
    const filtros: [string, string, unknown][] = [];
    const q: Record<string, unknown> = {};
    const f = (op: string) => (col: string, v: unknown) => {
      filtros.push([op, col, v]);
      return q;
    };
    for (const op of ["eq", "in", "is", "limit"]) q[op] = f(op);
    q.select = () => q;
    q.single = () => ((single = true), q);
    q.update = (payload: Record<string, unknown>) => {
      upd = { tabela, payload, filtros };
      updates.push(upd);
      return q;
    };
    q.then = (resolve: (v: unknown) => void, rejeitar?: (e: unknown) => void) => {
      if (upd && o.explodir === tabela) return rejeitar?.(new Error("rede caiu"));
      if (upd) {
        if (tabela === "tarefas" && "progresso" in upd.payload) {
          gravacoesProgresso++;
          if (o.falharProgresso && gravacoesProgresso >= o.falharProgresso) return resolve({ data: null, error: { message: "banco fora" } });
        }
        if (tabela === "tarefas") {
          const id = filtros.find((x) => x[0] === "eq" && x[1] === "id")?.[2] as string;
          const t = tarefas.get(id);
          if (t) Object.assign(t, upd.payload);
        }
        return resolve({ data: null, error: null });
      }
      if (tabela === "execucoes") return resolve(single ? { data: { id: "e1", ...o.exec }, error: null } : { data: [], error: null });
      if (tabela === "conexoes") return resolve({ data: { id: "A", nome: "Número A" }, error: null });
      if (tabela === "grupos") return resolve({ data: { group_id: "120@g.us", numero: 1, nome: "Turma 01", campanha_id: "c1" }, error: null });
      resolve({ data: null, error: null });
    };
    return q;
  };
  // pegar_tarefas: devolve as que estão em fila e vencidas, marcando processando e somando a tentativa.
  const rpc = async () => {
    const lote = [...tarefas.values()].filter((t) => t.status === "fila" && new Date(t.enviar_apos as string).getTime() <= Date.now());
    for (const t of lote) Object.assign(t, { status: "processando", tentativas: (t.tentativas as number) + 1 });
    return { data: lote.map((t) => ({ ...t })), error: null };
  };
  return { db: { from, rpc }, tarefas, updates };
}

function zFalso() {
  let n = 0;
  return {
    enviar: vi.fn(async (_c: unknown, _r: string, _corpo: { message?: string }) => `M${++n}`),
    enviarEnquete: vi.fn(),
    configurarGrupo: vi.fn(async () => {}),
    participantes: vi.fn(async () => {}),
    obterGrupo: vi.fn(async () => ({
      groupId: "120@g.us",
      name: "G",
      amAdmin: true,
      participantCount: 3,
      participants: [
        { phone: "5511" + "900000001", isAdmin: false },
        { phone: "5511" + "911112222", isAdmin: true },
        { phone: "5511" + "933334444", isAdmin: false },
      ],
    })),
    linkConvite: vi.fn(async () => "https://chat.whatsapp.com/L"),
    status: vi.fn(async () => ({ connected: true, phone: "x" })),
    enviarFigurinha: vi.fn(),
    enviarGif: vi.fn(),
    enviarContato: vi.fn(),
    enviarEvento: vi.fn(),
    enviarBotoes: vi.fn(),
    fixarMensagem: vi.fn(async () => {}),
    mensagensTemporarias: vi.fn(async () => {}),
    modoEntrada: vi.fn(async () => {}),
    desativarComunidade: vi.fn(async () => {}),
    removerParticipantes: vi.fn(async (): Promise<string[] | null> => null),
    privacidadeAvancada: vi.fn(async () => {}),
  };
}

const passado = () => new Date(Date.now() - 1000).toISOString();
const tarefa = (extra: Record<string, unknown> = {}): Linha => ({
  id: "t1",
  execucao_id: "e1",
  grupo_id: "g1",
  conexao_id: "A",
  tipo: "mensagem",
  prioridade: 1,
  tentativas: 0,
  enviar_apos: passado(),
  status: "fila",
  progresso: 0,
  message_id: null,
  ...extra,
});
const tres = {
  versao: 2,
  mensagens: [
    { formato: "texto", texto: "um" },
    { formato: "texto", texto: "dois" },
    { formato: "texto", texto: "três" },
  ],
  opcoes: { mencionar_todos: false, temporarias: "nao", fixar: "nao", intervalo_grupos: "nao", intervalo_mensagens: false },
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());

describe("processarTarefas — mensagem v2", () => {
  it("cai depois da 2ª de 3 (erro de rede): volta pra fila com progresso 2; a retentativa manda só a 3ª", async () => {
    const z = zFalso();
    z.enviar.mockResolvedValueOnce("M1").mockResolvedValueOnce("M2").mockRejectedValueOnce(new TypeError("fetch failed"));
    hoisted.zAtual = z;
    const b = construirDb({ tarefas: [tarefa()], exec: { tipo: "mensagem", conteudo_final: tres } });
    hoisted.dbAtual = b.db;

    expect(await processarTarefas({ ate: Date.now() + 40_000 })).toBe(0);
    const t = b.tarefas.get("t1")!;
    expect(t).toMatchObject({ status: "fila", progresso: 2, message_id: "M1", tentativas: 1 });
    expect(z.enviar).toHaveBeenCalledTimes(3);

    // retentativa (outro tick): libera o horário e roda de novo
    t.enviar_apos = passado();
    z.enviar.mockClear();
    z.enviar.mockResolvedValueOnce("M3");
    expect(await processarTarefas({ ate: Date.now() + 40_000 })).toBe(1);
    expect(z.enviar).toHaveBeenCalledTimes(1);
    expect(z.enviar.mock.calls[0][2]).toEqual({ phone: "120@g.us", message: "três" });
    expect(b.tarefas.get("t1")).toMatchObject({ status: "enviado", progresso: 3, message_id: "M1", erro: null });
  }, 15_000);

  it("prazo curto: para entre mensagens, progresso salvo, volta pra fila sem gastar tentativa (não é erro)", async () => {
    const z = zFalso();
    hoisted.zAtual = z;
    const b = construirDb({ tarefas: [tarefa({ tentativas: 1 })], exec: { tipo: "mensagem", conteudo_final: tres } });
    hoisted.dbAtual = b.db;
    // 10,5 s de prazo: pega a tarefa (> 10 s), manda a 1ª, mas 1 s de espera + 10 s de folga não cabem
    const antes = Date.now();
    expect(await processarTarefas({ ate: Date.now() + 10_500 })).toBe(0);
    const t = b.tarefas.get("t1")!;
    expect(z.enviar).toHaveBeenCalledTimes(1);
    expect(t).toMatchObject({ status: "fila", progresso: 1, message_id: "M1", tentativas: 1 });
    expect(t.erro).toBeUndefined();
    const volta = new Date(t.enviar_apos as string).getTime();
    expect(volta).toBeGreaterThanOrEqual(antes + 1000);
  });

  it("progresso não grava depois de um envio: erro definitivo (não volta pra fila) e não manda a próxima", async () => {
    const z = zFalso();
    hoisted.zAtual = z;
    const b = construirDb({ tarefas: [tarefa()], exec: { tipo: "mensagem", conteudo_final: tres }, falharProgresso: 2 }); // 1ª gravação ok; a 2ª falha nas 3 tentativas
    hoisted.dbAtual = b.db;
    expect(await processarTarefas({ ate: Date.now() + 40_000 })).toBe(0);
    const t = b.tarefas.get("t1")!;
    expect(z.enviar).toHaveBeenCalledTimes(2);
    expect(t.status).toBe("erro");
    expect(String(t.erro)).toContain("Mensagem 2 de 3 enviada");
    expect(String(t.erro)).toContain("Pode ter sido feita");
    // nenhum update devolveu pra fila
    expect(b.updates.filter((u) => u.tabela === "tarefas" && u.payload.status === "fila")).toEqual([]);
  }, 15_000);

  it("v1 pelo job: mesmo request de sempre e não grava progresso", async () => {
    const z = zFalso();
    hoisted.zAtual = z;
    const b = construirDb({ tarefas: [tarefa()], exec: { tipo: "mensagem", conteudo_final: { formato: "texto", texto: "Oi", midia_url: null, nome_arquivo: null, mencionar_todos: true } } });
    hoisted.dbAtual = b.db;
    expect(await processarTarefas({ ate: Date.now() + 40_000 })).toBe(1);
    expect(z.enviar).toHaveBeenCalledWith({ id: "A", token: "t", clientToken: "c" }, "send-text", { phone: "120@g.us", message: "Oi @all", mentionAll: true });
    expect(b.updates.some((u) => "progresso" in u.payload)).toBe(false);
    expect(b.tarefas.get("t1")).toMatchObject({ status: "enviado", message_id: "M1" });
  });
});

describe("processarTarefas — tipos novos", () => {
  it("remover_participantes: tira só quem pode e marca a saída no banco", async () => {
    const z = zFalso();
    hoisted.zAtual = z;
    const b = construirDb({
      tarefas: [tarefa({ tipo: "remover_participantes", prioridade: 0 })],
      exec: { tipo: "remover_participantes", conteudo_final: { telefones: ["5511" + "900000001", "5511" + "911112222", "5511" + "933334444"] } },
    });
    hoisted.dbAtual = b.db;
    expect(await processarTarefas({ ate: Date.now() + 40_000 })).toBe(1);
    expect(z.removerParticipantes).toHaveBeenCalledWith({ id: "A", token: "t", clientToken: "c" }, "120@g.us", ["5511" + "900000001"]);
    const saida = b.updates.find((u) => u.tabela === "participantes")!;
    expect(saida.payload).toMatchObject({ motivo_saida: "manual" });
    expect(saida.filtros).toContainEqual(["eq", "grupo_id", "g1"]);
    expect(b.tarefas.get("t1")!.status).toBe("enviado");
  });

  it("desativar_comunidade: comunidade da campanha → desativa e solta a campanha", async () => {
    const z = zFalso();
    hoisted.zAtual = z;
    const b = construirDb({ tarefas: [tarefa({ tipo: "desativar_comunidade", prioridade: 0 })], exec: { tipo: "desativar_comunidade", conteudo_final: { comunidade_id: "999@g.us" } } });
    hoisted.dbAtual = b.db;
    await processarTarefas({ ate: Date.now() + 40_000 });
    expect(z.desativarComunidade).toHaveBeenCalledWith(expect.anything(), "999@g.us");
    const camp = b.updates.find((u) => u.tabela === "campanhas")!;
    expect(camp.payload).toEqual({ comunidade_id: null, usar_comunidade: false });
    expect(camp.filtros).toContainEqual(["eq", "comunidade_id", "999@g.us"]);
    expect(b.tarefas.get("t1")!.status).toBe("enviado");
  });

  it("escrita depois de feita que lança (campanhas/participantes) não devolve a tarefa pra fila", async () => {
    const z = zFalso();
    hoisted.zAtual = z;
    const b = construirDb({ tarefas: [tarefa({ tipo: "desativar_comunidade", prioridade: 0 })], exec: { tipo: "desativar_comunidade", conteudo_final: { comunidade_id: "999@g.us" } }, explodir: "campanhas" });
    hoisted.dbAtual = b.db;
    const erroLog = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await processarTarefas({ ate: Date.now() + 40_000 })).toBe(1);
    expect(b.tarefas.get("t1")!.status).toBe("enviado");
    expect(b.updates.filter((u) => u.tabela === "tarefas" && u.payload.status === "fila")).toEqual([]);
    expect(erroLog).toHaveBeenCalled();
    erroLog.mockRestore();
  });

  it("desativar_comunidade sem comunidade no conteúdo → nota, sem Zapbot", async () => {
    const z = zFalso();
    hoisted.zAtual = z;
    const b = construirDb({ tarefas: [tarefa({ tipo: "desativar_comunidade", prioridade: 0 })], exec: { tipo: "desativar_comunidade", conteudo_final: {} } });
    hoisted.dbAtual = b.db;
    await processarTarefas({ ate: Date.now() + 40_000 });
    expect(z.desativarComunidade).not.toHaveBeenCalled();
    expect(b.tarefas.get("t1")).toMatchObject({ status: "enviado", erro: "Campanha sem comunidade." });
  });

  it("atualizar_links: grava o link em grupos.link_convite", async () => {
    const z = zFalso();
    hoisted.zAtual = z;
    const b = construirDb({ tarefas: [tarefa({ tipo: "atualizar_links", prioridade: 0 })], exec: { tipo: "atualizar_links", conteudo_final: {} } });
    hoisted.dbAtual = b.db;
    await processarTarefas({ ate: Date.now() + 40_000 });
    const g = b.updates.find((u) => u.tabela === "grupos")!;
    expect(g.payload).toEqual({ link_convite: "https://chat.whatsapp.com/L" });
    expect(g.filtros).toContainEqual(["eq", "id", "g1"]);
  });

  it("configuracao: 400 do Zapbot vira erro sem repetir", async () => {
    const z = zFalso();
    z.modoEntrada.mockRejectedValueOnce(new ZapbotError(400, "not admin", {}));
    hoisted.zAtual = z;
    const b = construirDb({ tarefas: [tarefa({ tipo: "configuracao", prioridade: 0 })], exec: { tipo: "configuracao", conteudo_final: { aprovacao_entrada: true } } });
    hoisted.dbAtual = b.db;
    await processarTarefas({ ate: Date.now() + 40_000 });
    expect(b.tarefas.get("t1")).toMatchObject({ status: "erro", erro: "not admin" });
  });
});

describe("processarTarefas — conteúdo do grupo (Etapa 3E)", () => {
  const uma = (texto: string) => ({ ...tres, mensagens: [{ formato: "texto", texto }] });

  it("tarefa com conteudo_grupo manda o conteúdo do grupo, não o da execução", async () => {
    const z = zFalso();
    hoisted.zAtual = z;
    const b = construirDb({ tarefas: [tarefa({ conteudo_grupo: uma("Cupom G2VIP") })], exec: { tipo: "mensagem", conteudo_final: uma("Cupom CAMP10") } });
    hoisted.dbAtual = b.db;
    expect(await processarTarefas({ ate: Date.now() + 40_000 })).toBe(1);
    expect(z.enviar.mock.calls[0][2]).toEqual({ phone: "120@g.us", message: "Cupom G2VIP" });
  });

  it("sem conteudo_grupo (null ou ausente): o conteúdo da execução, como antes", async () => {
    const z = zFalso();
    hoisted.zAtual = z;
    const b = construirDb({ tarefas: [tarefa({ conteudo_grupo: null })], exec: { tipo: "mensagem", conteudo_final: uma("Cupom CAMP10") } });
    hoisted.dbAtual = b.db;
    expect(await processarTarefas({ ate: Date.now() + 40_000 })).toBe(1);
    expect(z.enviar.mock.calls[0][2]).toEqual({ phone: "120@g.us", message: "Cupom CAMP10" });
  });
});
