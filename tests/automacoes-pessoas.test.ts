import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, type Chamada, type Resposta } from "./apoio/db-falso";

const hoisted = vi.hoisted(() => ({
  dbAtual: undefined as unknown,
  dispararAutomacoesMock: vi.fn(async (..._a: unknown[]) => 0),
  dispararPorPessoasMock: vi.fn(async (..._a: unknown[]) => 0),
  dispararCheckoutMock: vi.fn(async (..._a: unknown[]) => 0),
  alertarMock: vi.fn(async (_a: unknown, _db?: unknown) => undefined),
  obterGrupoMock: vi.fn(async (..._a: unknown[]) => null as unknown),
}));

vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => hoisted.dbAtual }));
vi.mock("@/src/lib/automacoes", () => ({
  dispararAutomacoes: hoisted.dispararAutomacoesMock,
  dispararPorPessoas: hoisted.dispararPorPessoasMock,
  dispararCheckout: hoisted.dispararCheckoutMock,
  telefonesProtegidos: async () => new Set<string>(),
}));
vi.mock("@/src/lib/jobs/alertas", () => ({ alertar: hoisted.alertarMock }));
vi.mock("@/src/lib/conexoes", () => ({ paraZapbot: (c: { id: string }) => ({ id: c.id, token: "t", clientToken: "c" }) }));
vi.mock("@/src/lib/zapbot/client", () => ({ zapbot: () => ({ obterGrupo: hoisted.obterGrupoMock }) }));

import { conferirGrupos } from "@/src/lib/jobs/conferir-grupos";
import { processarVendas } from "@/src/lib/jobs/vendas";

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.dispararPorPessoasMock.mockResolvedValue(0);
  hoisted.dispararCheckoutMock.mockResolvedValue(0);
});

describe("conferirGrupos: gatilhos de entrou/saiu", () => {
  function montar(abertos: { telefone: string; admin: boolean }[], membros: { phone: string; isAdmin: boolean }[], telefoneConexao: string | null = null, leituraSuspeitaDesde: string | null = null) {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "conexoes" && c.op === "select") return { data: [{ id: "con1", status: "conectado", telefone: telefoneConexao, proxima_conferencia_em: "2026-10-16T00:00:00.000Z" }] };
      if (c.tabela === "conexoes" && c.op === "update") return { data: [{ id: "con1" }] };
      if (c.tabela === "grupos" && c.op === "select") {
        return { data: [{ id: "g1", campanha_id: "c1", group_id: "120@g.us", nome: "Turma 01", cheio: false, conferido_em: "2026-10-16T00:00:00.000Z", leitura_suspeita_desde: leituraSuspeitaDesde, campanhas: { nome: "Camp", limite_por_grupo: 100, crm_webhook_url: null, slug: "aulao" } }] };
      }
      // Participações abertas na campanha (duplicados, Etapa 2G): ninguém em outro grupo.
      if (c.tabela === "participantes" && c.op === "select" && c.filtros.some((f) => f[1] === "grupos.campanha_id")) return { data: [] };
      if (c.tabela === "participantes" && c.op === "select") return { data: abertos };
      if (c.tabela === "tags") return { data: { id: "tag-saiu" } };
      return {};
    });
    hoisted.dbAtual = db;
    hoisted.obterGrupoMock.mockResolvedValue({ name: "Turma 01", participants: membros });
    return chamadas;
  }
  const prazo = () => ({ ate: Date.now() + 60_000 });

  it("dispara entrou só com quem não é admin e saiu só com quem não era admin", async () => {
    montar(
      [{ telefone: "5511" + "900000009", admin: false }, { telefone: "5511" + "900000008", admin: true }],
      [{ phone: "5511" + "900000001", isAdmin: false }, { phone: "5511" + "900000002", isAdmin: true }],
    );
    expect(await conferirGrupos(prazo())).toBe(1);
    const chamadas = hoisted.dispararPorPessoasMock.mock.calls.map((c) => c[0]);
    expect(chamadas).toEqual([
      { campanhaId: "c1", gatilho: "entrou", grupoId: "g1", telefones: ["5511" + "900000001"] },
      { campanhaId: "c1", gatilho: "saiu", grupoId: "g1", telefones: ["5511" + "900000009"] },
    ]);
  });

  it("passa como instante o mesmo `entrou_em`/`saiu_em` gravado (vai na chave do disparo)", async () => {
    const chamadas = montar([{ telefone: "5511" + "900000009", admin: false }], [{ phone: "5511" + "900000001", isAdmin: false }]);
    await conferirGrupos(prazo());
    const entrou = chamadas.find((c) => c.tabela === "participantes" && c.op === "insert")!.dados as { entrou_em: string }[];
    const saiu = chamadas.find((c) => c.tabela === "participantes" && c.op === "update")!.dados as { saiu_em: string };
    const instantes = hoisted.dispararPorPessoasMock.mock.calls.map((c) => (c[1] as Date).toISOString());
    expect(instantes).toEqual([entrou[0].entrou_em, saiu.saiu_em]);
  });

  const NOSSO = "5511" + "999990000";
  const varios = (prefixo: string, n: number) => Array.from({ length: n }, (_, i) => `${prefixo}${String(i).padStart(4, "0")}`);

  it("com o número da conexão na lista: rodada normal dispara", async () => {
    montar([{ telefone: NOSSO, admin: true }], [{ phone: NOSSO, isAdmin: true }, { phone: "5511" + "900000001", isAdmin: false }], NOSSO);
    await conferirGrupos(prazo());
    expect(hoisted.dispararPorPessoasMock).toHaveBeenCalledTimes(1);
    expect(hoisted.alertarMock).not.toHaveBeenCalled();
  });

  /** Escritas de dados do grupo (participantes, CRM, lotação), sem contar a marca de leitura estranha. */
  const escritasDoGrupo = (chamadas: Chamada[]) =>
    chamadas.filter(
      (c) =>
        (c.tabela === "participantes" || c.tabela === "eventos_saida" || c.tabela === "grupos") &&
        c.op !== "select" &&
        !(c.tabela === "grupos" && c.op === "update" && Object.keys(c.dados as object).join() === "leitura_suspeita_desde"),
    );
  const marcas = (chamadas: Chamada[]) =>
    chamadas.filter((c) => c.tabela === "grupos" && c.op === "update").map((c) => (c.dados as { leitura_suspeita_desde?: string | null }).leitura_suspeita_desde);

  it("primeira leitura estranha: pula a rodada e marca leitura_suspeita_desde", async () => {
    const chamadas = montar([{ telefone: "5511" + "900000009", admin: false }], [], NOSSO);
    await conferirGrupos(prazo());
    expect(escritasDoGrupo(chamadas)).toEqual([]);
    const m = marcas(chamadas);
    expect(m).toHaveLength(1);
    expect(typeof m[0]).toBe("string");
    expect(hoisted.dispararPorPessoasMock).not.toHaveBeenCalled();
  });

  it("leitura estranha há menos de 10 min: continua pulando, sem remarcar", async () => {
    const chamadas = montar([{ telefone: "5511" + "900000009", admin: false }], [], NOSSO, new Date(Date.now() - 5 * 60_000).toISOString());
    await conferirGrupos(prazo());
    expect(escritasDoGrupo(chamadas)).toEqual([]);
    expect(marcas(chamadas)).toEqual([]);
  });

  it("leitura estranha mantida por 10+ min: grava como sempre, sem automações de pessoas, limpa a marca e alerta", async () => {
    const conhecidos = [{ telefone: NOSSO, admin: true }, ...varios("55119000", 19).map((telefone) => ({ telefone, admin: false }))];
    const ficaram = conhecidos.slice(0, 5).map((m) => ({ phone: m.telefone, isAdmin: m.admin }));
    const chamadas = montar(conhecidos, ficaram, NOSSO, new Date(Date.now() - 11 * 60_000).toISOString());
    await conferirGrupos(prazo());
    const saida = chamadas.find((c) => c.tabela === "participantes" && c.op === "update")!;
    expect((saida.filtros.find((f) => f[0] === "in")![2] as string[]).length).toBe(15);
    expect(hoisted.dispararPorPessoasMock).not.toHaveBeenCalled();
    const grupo = chamadas.find((c) => c.tabela === "grupos" && c.op === "update")!.dados as Record<string, unknown>;
    expect(grupo).toMatchObject({ participantes: 5, leitura_suspeita_desde: null });
    expect(hoisted.alertarMock.mock.calls.map((c) => c[0])).toEqual([
      { tipo: "criacao_erro", campanhaId: "c1", texto: "Grupo Turma 01: a leitura estranha se manteve por 10 minutos e foi aceita (sem automações de pessoas)", conexaoId: "con1" },
    ]);
  });

  it("rodada normal limpa a marca de leitura estranha", async () => {
    const chamadas = montar([{ telefone: NOSSO, admin: true }], [{ phone: NOSSO, isAdmin: true }, { phone: "5511" + "900000001", isAdmin: false }], NOSSO, new Date(Date.now() - 3 * 60_000).toISOString());
    await conferirGrupos(prazo());
    expect(marcas(chamadas)).toEqual([null]);
    expect(hoisted.dispararPorPessoasMock).toHaveBeenCalledTimes(1);
  });

  it("lista do WhatsApp vazia: não grava nada do grupo, não dispara e alerta uma vez", async () => {
    const chamadas = montar([{ telefone: "5511" + "900000009", admin: false }], [], NOSSO);
    expect(await conferirGrupos(prazo())).toBe(1);
    expect(escritasDoGrupo(chamadas)).toEqual([]);
    expect(hoisted.dispararPorPessoasMock).not.toHaveBeenCalled();
    expect(hoisted.dispararAutomacoesMock).not.toHaveBeenCalled();
    expect(hoisted.alertarMock.mock.calls.map((c) => c[0])).toEqual([
      { tipo: "criacao_erro", campanhaId: "c1", texto: "Grupo Turma 01: A leitura do grupo veio sem nenhum participante: nada foi gravado nesta rodada (participantes, automações e lotação ficam como estavam).", conexaoId: "con1" },
    ]);
  });

  it("número da conexão fora da lista: não grava nada do grupo, não dispara e alerta uma vez", async () => {
    const chamadas = montar([{ telefone: "5511" + "900000009", admin: false }], [{ phone: "5511" + "900000001", isAdmin: false }], NOSSO);
    await conferirGrupos(prazo());
    expect(escritasDoGrupo(chamadas)).toEqual([]);
    expect(hoisted.dispararPorPessoasMock).not.toHaveBeenCalled();
    expect(hoisted.alertarMock.mock.calls.map((c) => c[0])).toEqual([
      { tipo: "criacao_erro", campanhaId: "c1", texto: "Grupo Turma 01: A leitura do grupo veio sem o número desta conexão: nada foi gravado nesta rodada (participantes, automações e lotação ficam como estavam).", conexaoId: "con1" },
    ]);
  });

  it("leitura não confiável já alertada na última hora: não alerta de novo", async () => {
    const { db } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "conexoes" && c.op === "select") return { data: [{ id: "con1", status: "conectado", telefone: NOSSO, proxima_conferencia_em: "2026-10-16T00:00:00.000Z" }] };
      if (c.tabela === "conexoes" && c.op === "update") return { data: [{ id: "con1" }] };
      if (c.tabela === "grupos" && c.op === "select") {
        return { data: [{ id: "g1", campanha_id: "c1", group_id: "120@g.us", nome: "Turma 01", cheio: false, conferido_em: "2026-10-16T00:00:00.000Z", campanhas: { nome: "Camp", limite_por_grupo: 100, crm_webhook_url: null, slug: "aulao" } }] };
      }
      if (c.tabela === "alertas") return { data: [{ id: "al1" }] };
      if (c.tabela === "participantes" && c.op === "select") return { data: [{ telefone: "5511" + "900000009", admin: false }] };
      return {};
    });
    hoisted.dbAtual = db;
    hoisted.obterGrupoMock.mockResolvedValue({ name: "Turma 01", participants: [] });
    await conferirGrupos(prazo());
    expect(hoisted.alertarMock).not.toHaveBeenCalled();
  });

  it("número da conexão na lista só pela variante do nono dígito: rodada normal", async () => {
    montar([], [{ phone: "551199990000", isAdmin: true }, { phone: "5511" + "900000001", isAdmin: false }], NOSSO);
    await conferirGrupos(prazo());
    expect(hoisted.dispararPorPessoasMock).toHaveBeenCalledTimes(1);
    expect(hoisted.alertarMock).not.toHaveBeenCalled();
  });

  it("lista parcial (6 de 400 vistos): não grava nada do grupo, não dispara e alerta; a rodada cheia seguinte é normal", async () => {
    const conhecidos = [{ telefone: NOSSO, admin: true }, ...varios("55119000", 399).map((telefone) => ({ telefone, admin: false }))];
    const parcial = conhecidos.slice(0, 6).map((m) => ({ phone: m.telefone, isAdmin: m.admin }));
    const chamadas = montar(conhecidos, parcial, NOSSO);
    await conferirGrupos(prazo());
    expect(escritasDoGrupo(chamadas)).toEqual([]);
    expect(hoisted.dispararPorPessoasMock).not.toHaveBeenCalled();
    expect(hoisted.alertarMock.mock.calls.map((c) => c[0])).toEqual([
      { tipo: "criacao_erro", campanhaId: "c1", texto: "Grupo Turma 01: Mais da metade do grupo sumiu da leitura de uma vez: nada foi gravado nesta rodada (participantes, automações e lotação ficam como estavam).", conexaoId: "con1" },
    ]);

    // Nada foi gravado: na rodada seguinte, com a lista inteira (e 1 pessoa nova), o banco ainda tem os 400.
    vi.clearAllMocks();
    hoisted.dispararPorPessoasMock.mockResolvedValue(0);
    const cheia = [...conhecidos.map((m) => ({ phone: m.telefone, isAdmin: m.admin })), { phone: "5511888880000", isAdmin: false }];
    const seguinte = montar(conhecidos, cheia, NOSSO);
    await conferirGrupos(prazo());
    // (O limite do grupo de teste é 100: o único alerta é o de grupo cheio, nenhum de leitura suspeita.)
    expect(hoisted.alertarMock.mock.calls.map((c) => (c[0] as { tipo: string }).tipo)).toEqual(["grupo_cheio"]);
    expect(hoisted.dispararPorPessoasMock.mock.calls.map((c) => c[0])).toEqual([{ campanhaId: "c1", gatilho: "entrou", grupoId: "g1", telefones: ["5511888880000"] }]);
    expect(seguinte.some((c) => c.tabela === "participantes" && c.op === "update")).toBe(false);
    expect(seguinte.some((c) => c.tabela === "grupos" && c.op === "update")).toBe(true);
  });

  it("grupo grande: mais da metade da lista nova entrou de uma vez (10+): não dispara e alerta", async () => {
    const conhecidos = varios("55117000", 12).map((telefone) => ({ telefone, admin: false }));
    const novos = varios("55118000", 14).map((phone) => ({ phone, isAdmin: false }));
    montar([{ telefone: NOSSO, admin: true }, ...conhecidos], [{ phone: NOSSO, isAdmin: true }, ...conhecidos.map((m) => ({ phone: m.telefone, isAdmin: false })), ...novos], NOSSO);
    await conferirGrupos(prazo());
    expect(hoisted.dispararPorPessoasMock).not.toHaveBeenCalled();
    expect(hoisted.alertarMock).toHaveBeenCalledTimes(1);
  });

  it("rodada suspeita (entrada em massa): nenhuma ação de pessoa das automações (tag, blacklist) — Etapa 3J", async () => {
    const conhecidos = varios("55117000", 12).map((telefone) => ({ telefone, admin: false }));
    const novos = varios("55118000", 14).map((phone) => ({ phone, isAdmin: false }));
    const chamadas = montar([{ telefone: NOSSO, admin: true }, ...conhecidos], [{ phone: NOSSO, isAdmin: true }, ...conhecidos.map((m) => ({ phone: m.telefone, isAdmin: false })), ...novos], NOSSO);
    await conferirGrupos(prazo());
    // As ações de pessoa só rodam dentro de `dispararPorPessoas` (não chamado) — nada escreve em blacklist aqui.
    expect(hoisted.dispararPorPessoasMock).not.toHaveBeenCalled();
    expect(chamadas.some((c) => c.tabela === "blacklist_numeros")).toBe(false);
  });

  it("grupo novo (4 conhecidos) recebe 12 de uma vez: dispara normalmente, sem alerta", async () => {
    const conhecidos = varios("55117000", 3).map((telefone) => ({ telefone, admin: false }));
    const novos = varios("55118000", 12).map((phone) => ({ phone, isAdmin: false }));
    montar([{ telefone: NOSSO, admin: true }, ...conhecidos], [{ phone: NOSSO, isAdmin: true }, ...conhecidos.map((m) => ({ phone: m.telefone, isAdmin: false })), ...novos], NOSSO);
    await conferirGrupos(prazo());
    expect(hoisted.dispararPorPessoasMock).toHaveBeenCalledTimes(1);
    expect(hoisted.dispararPorPessoasMock.mock.calls[0][0]).toMatchObject({ gatilho: "entrou" });
    expect(hoisted.alertarMock).not.toHaveBeenCalled();
  });

  it("ninguém entrou nem saiu: não dispara", async () => {
    montar([{ telefone: "5511" + "900000001", admin: false }], [{ phone: "5511" + "900000001", isAdmin: false }]);
    await conferirGrupos(prazo());
    expect(hoisted.dispararPorPessoasMock).not.toHaveBeenCalled();
  });

  it("falha nas automações: alerta criacao_erro e a conferência segue", async () => {
    const chamadas = montar([{ telefone: "5511" + "900000009", admin: false }], [{ phone: "5511" + "900000001", isAdmin: false }]);
    hoisted.dispararPorPessoasMock.mockRejectedValue(new Error("fora do ar"));
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await conferirGrupos(prazo())).toBe(1);
    erro.mockRestore();
    expect(hoisted.alertarMock.mock.calls.map((c) => c[0])).toEqual([
      { tipo: "criacao_erro", campanhaId: "c1", texto: "Pessoas entraram no grupo Turma 01, mas as automações não foram agendadas: fora do ar", conexaoId: "con1" },
      { tipo: "criacao_erro", campanhaId: "c1", texto: "Pessoas saíram do grupo Turma 01, mas as automações não foram agendadas: fora do ar", conexaoId: "con1" },
    ]);
    expect(chamadas.some((c) => c.tabela === "grupos" && c.op === "update")).toBe(true);
  });
});

describe("processarVendas: gatilho de checkout", () => {
  function montar(venda: Record<string, unknown>) {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "vendas" && c.op === "select") return { data: [venda] };
      if (c.tabela === "tags") return { data: { id: "tag-comp" } };
      return {};
    });
    hoisted.dbAtual = db;
    return chamadas;
  }
  const VENDA = { id: "v1", provedor: "hotmart", aprovada: true, telefone: "5511" + "900000001", produtos: ["Curso IA"] };
  const marcou = (chamadas: Chamada[]) => chamadas.some((c) => c.tabela === "vendas" && c.op === "update");

  it("venda aprovada com telefone: dispara o checkout e marca como processada", async () => {
    const chamadas = montar(VENDA);
    hoisted.dispararCheckoutMock.mockResolvedValue(2);
    await processarVendas();
    expect(hoisted.dispararCheckoutMock.mock.calls[0][0]).toEqual({ vendaId: "v1", provedor: "hotmart", produtos: ["Curso IA"], telefone: "5511" + "900000001" });
    expect(marcou(chamadas)).toBe(true);
    // As remoções das automações continuam no resultado; "Remover compradores" (removido em 19/10/2026) não lê nada.
    expect(chamadas.find((c) => c.tabela === "vendas" && c.op === "update")!.dados).toMatchObject({ resultado: "tag Comprador adicionada · 2 remoção(ões) por automação" });
    expect(chamadas.some((c) => c.tabela === "regras_compra")).toBe(false);
  });

  it("falha no disparo: não marca como processada (tenta de novo na próxima rodada)", async () => {
    const chamadas = montar(VENDA);
    hoisted.dispararCheckoutMock.mockRejectedValue(new Error("fora do ar"));
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await processarVendas();
    erro.mockRestore();
    expect(marcou(chamadas)).toBe(false);
  });

  it("marca como processada só se `aprovada` não mudou no meio (registrar_venda pode ter aprovado)", async () => {
    for (const aprovada of [true, false]) {
      const chamadas = montar({ ...VENDA, aprovada });
      await processarVendas();
      const up = chamadas.find((c) => c.tabela === "vendas" && c.op === "update")!;
      expect(up.filtros).toContainEqual(["eq", "aprovada", aprovada]);
    }
  });

  it("venda não aprovada ou sem telefone: não dispara", async () => {
    montar({ ...VENDA, aprovada: false });
    await processarVendas();
    montar({ ...VENDA, telefone: null });
    await processarVendas();
    expect(hoisted.dispararCheckoutMock).not.toHaveBeenCalled();
  });
});
