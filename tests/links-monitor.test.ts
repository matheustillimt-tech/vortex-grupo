import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, type Chamada, type Resposta } from "./apoio/db-falso";

const hoisted = vi.hoisted(() => ({
  dbAtual: undefined as unknown,
  alertarMock: vi.fn(async (_a: unknown, _db?: unknown) => undefined),
  statusMock: vi.fn(async (..._a: unknown[]) => ({ connected: false, phone: "" }) as { connected: boolean; phone: string; error?: string }),
  trocarMock: vi.fn(async (..._a: unknown[]) => ({ completo: true, movidos: 0 })),
}));

vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => hoisted.dbAtual }));
vi.mock("@/src/lib/jobs/alertas", () => ({ alertar: hoisted.alertarMock }));
vi.mock("@/src/lib/conexoes", () => ({ paraZapbot: (c: { id: string }) => ({ id: c.id, token: "t", clientToken: "c" }) }));
vi.mock("@/src/lib/zapbot/client", () => ({ zapbot: () => ({ status: hoisted.statusMock, reiniciar: vi.fn(async () => undefined) }) }));
vi.mock("@/src/lib/jobs/links", async (original) => ({ ...(await original<typeof import("@/src/lib/jobs/links")>()), trocarDonoECorrigirLinks: hoisted.trocarMock }));

import { monitorarConexoes } from "@/src/lib/jobs/monitor";

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.statusMock.mockResolvedValue({ connected: false, phone: "" });
  hoisted.trocarMock.mockResolvedValue({ completo: true, movidos: 0 });
});

const prazo = () => ({ ate: Date.now() + 60_000 });
const minAtras = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

function montar(conexao: Record<string, unknown>) {
  const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
    if (c.tabela === "conexoes" && c.op === "select") return { data: [{ id: "con1", nome: "Conexão A", proximo_status_em: "2026-10-17T00:00:00.000Z", ...conexao }] };
    if (c.tabela === "conexoes" && c.op === "update") return { data: [{ id: "con1" }] };
    return { data: [] };
  });
  hoisted.dbAtual = db;
  return chamadas;
}
const updates = (cs: Chamada[]) => cs.filter((c) => c.tabela === "conexoes" && c.op === "update").map((c) => c.dados as Record<string, unknown>);

describe("monitor × Atualização de links", () => {
  it("conectada que cai agora: grava caiu_em, alerta numero_caiu e NÃO troca dono (pode ser só oscilação)", async () => {
    const chamadas = montar({ status: "conectado" });
    await monitorarConexoes(prazo());
    const queda = updates(chamadas).find((u) => u.status === "desconectado")!;
    expect(typeof queda.caiu_em).toBe("string");
    expect(hoisted.alertarMock.mock.calls.map((c) => (c[0] as { tipo: string }).tipo)).toEqual(["numero_caiu"]);
    expect(hoisted.trocarMock).not.toHaveBeenCalled();
  });

  it("caída há 5 min: ainda não troca", async () => {
    montar({ status: "desconectado", caiu_em: minAtras(5) });
    await monitorarConexoes(prazo());
    expect(hoisted.trocarMock).not.toHaveBeenCalled();
  });

  it("caída há 11 min e ainda caída no Zapbot: troca e marca grupos_trocados_em; a queda não é regravada", async () => {
    const chamadas = montar({ status: "desconectado", caiu_em: minAtras(11) });
    await monitorarConexoes(prazo());
    expect(hoisted.trocarMock).toHaveBeenCalledTimes(1);
    expect(hoisted.trocarMock.mock.calls[0][0]).toBe("con1");
    expect(updates(chamadas).some((u) => typeof u.grupos_trocados_em === "string")).toBe(true);
    expect(updates(chamadas).some((u) => "caiu_em" in u)).toBe(false);
  });

  it("troca incompleta (tick acabou): não marca, a próxima volta continua", async () => {
    hoisted.trocarMock.mockResolvedValue({ completo: false, movidos: 2 });
    const chamadas = montar({ status: "desconectado", caiu_em: minAtras(11) });
    await monitorarConexoes(prazo());
    expect(updates(chamadas).some((u) => "grupos_trocados_em" in u)).toBe(false);
  });

  it("já tentada nesta queda há menos de 10 min: não chama de novo", async () => {
    montar({ status: "desconectado", caiu_em: minAtras(30), grupos_trocados_em: minAtras(5) });
    await monitorarConexoes(prazo());
    expect(hoisted.trocarMock).not.toHaveBeenCalled();
  });

  it("continua caída 10 min depois da última tentativa: tenta de novo e marca a nova tentativa", async () => {
    const chamadas = montar({ status: "desconectado", caiu_em: minAtras(30), grupos_trocados_em: minAtras(15) });
    await monitorarConexoes(prazo());
    expect(hoisted.trocarMock).toHaveBeenCalledTimes(1);
    expect(updates(chamadas).some((u) => typeof u.grupos_trocados_em === "string")).toBe(true);
  });

  it("regressão: conexão desconectada sem caiu_em (antes desta etapa ou desconectada à mão) nunca troca", async () => {
    montar({ status: "desconectado", caiu_em: null });
    await monitorarConexoes(prazo());
    expect(hoisted.trocarMock).not.toHaveBeenCalled();
  });

  it("voltou a conectar: apaga caiu_em", async () => {
    hoisted.statusMock.mockResolvedValue({ connected: true, phone: "5511" + "999990001" });
    const chamadas = montar({ status: "desconectado", caiu_em: minAtras(3) });
    await monitorarConexoes(prazo());
    expect(updates(chamadas).find((u) => u.status === "conectado")).toMatchObject({ caiu_em: null, ultimo_erro: null });
    expect(hoisted.trocarMock).not.toHaveBeenCalled();
  });

  it("regressão: conectada que continua conectada não ganha campo novo no update", async () => {
    hoisted.statusMock.mockResolvedValue({ connected: true, phone: "5511" + "999990001" });
    const chamadas = montar({ status: "conectado", telefone: "5511" + "999990001" });
    await monitorarConexoes(prazo());
    expect(updates(chamadas).find((u) => u.status === "conectado")).toEqual({ status: "conectado", telefone: "5511" + "999990001" });
  });

  it("troca que lança nunca derruba o monitor", async () => {
    hoisted.trocarMock.mockRejectedValue(new Error("explodiu"));
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const chamadas = montar({ status: "desconectado", caiu_em: minAtras(11) });
    await expect(monitorarConexoes(prazo())).resolves.toBe(1);
    erro.mockRestore();
    // Isolada: o erro não vira "ultimo_erro" da conta (o status foi conferido e gravado normalmente).
    expect(updates(chamadas).some((u) => String(u.ultimo_erro ?? "").startsWith("Monitor:"))).toBe(false);
    expect(updates(chamadas).some((u) => u.status === "desconectado")).toBe(true);
  });

  it("a troca tem orçamento próprio de 15 s (nunca o prazo inteiro do tick)", async () => {
    montar({ status: "desconectado", caiu_em: minAtras(11) });
    const antes = Date.now();
    await monitorarConexoes({ ate: Date.now() + 55_000 });
    const orcamento = hoisted.trocarMock.mock.calls[0][1] as { ate: number };
    expect(orcamento.ate).toBeLessThanOrEqual(Date.now() + 15_000);
    expect(orcamento.ate).toBeGreaterThanOrEqual(antes + 14_000);
  });

  it("com pouco tick sobrando, o orçamento não passa dos 20 s finais", async () => {
    montar({ status: "desconectado", caiu_em: minAtras(11) });
    const fim = Date.now() + 25_000;
    await monitorarConexoes({ ate: fim });
    expect((hoisted.trocarMock.mock.calls[0][1] as { ate: number }).ate).toBe(fim - 20_000);
  });
});
