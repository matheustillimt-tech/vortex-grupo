import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, type Chamada, type Resposta } from "./apoio/db-falso";

const hoisted = vi.hoisted(() => ({
  alertarMock: vi.fn(async (_a: unknown, _db?: unknown) => undefined),
}));
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => undefined }));
vi.mock("@/src/lib/jobs/alertas", () => ({ alertar: hoisted.alertarMock }));

import { conferirEntregas, LIMITE_CONFERIR_ENTREGAS } from "@/src/lib/jobs/entregas";
import { INFO_ALERTA, TIPOS_ALERTA } from "@/src/lib/regras/alertas";
import { situacaoEntrega, textoAlertaEntrega, textoEntrega } from "@/src/lib/regras/entregas";

beforeEach(() => vi.clearAllMocks());

describe("situacaoEntrega (mesma regra de conferir_entregas)", () => {
  const OBS = ["5511" + "999990002", "5511" + "999990003"];
  it("nenhum observador no grupo: sem_observador (mesmo com recibo)", () => {
    expect(situacaoEntrega({ observadores: OBS, observadoresNoGrupo: [], recibos: [{ telefone: "5511" + "999990002", tipo: "recebeu" }] })).toBe("sem_observador");
    expect(situacaoEntrega({ observadores: [], observadoresNoGrupo: ["5511" + "999990002"], recibos: [] })).toBe("sem_observador");
  });
  it("observador no grupo e recibo dele (recebeu ou visualizou): confirmada", () => {
    expect(situacaoEntrega({ observadores: OBS, observadoresNoGrupo: ["5511" + "999990002"], recibos: [{ telefone: "5511" + "999990002", tipo: "recebeu" }] })).toBe("confirmada");
    expect(situacaoEntrega({ observadores: OBS, observadoresNoGrupo: ["5511" + "999990002"], recibos: [{ telefone: "5511" + "999990003", tipo: "visualizou" }] })).toBe("confirmada");
  });
  it("observador no grupo sem recibo dele: nao_confirmada (recibo de lead ou 'reproduziu' não conexão)", () => {
    expect(situacaoEntrega({ observadores: OBS, observadoresNoGrupo: ["5511" + "999990002"], recibos: [] })).toBe("nao_confirmada");
    expect(situacaoEntrega({ observadores: OBS, observadoresNoGrupo: ["5511" + "999990002"], recibos: [{ telefone: "5511" + "988887777", tipo: "recebeu" }] })).toBe("nao_confirmada");
    expect(situacaoEntrega({ observadores: OBS, observadoresNoGrupo: ["5511" + "999990002"], recibos: [{ telefone: "5511" + "999990002", tipo: "reproduziu" }] })).toBe("nao_confirmada");
  });
  it("compara com e sem o nono dígito", () => {
    expect(situacaoEntrega({ observadores: ["5511" + "999990002"], observadoresNoGrupo: ["551199990002"], recibos: [{ telefone: "551199990002", tipo: "recebeu" }] })).toBe("confirmada");
  });
});

describe("textos", () => {
  it("cartão: N/M grupos com observador, + K sem observador; nada conferido explica quando sai", () => {
    expect(textoEntrega({ confirmadas: 3, nao_confirmadas: 1, sem_observador: 0, total: 4 })).toBe("Entrega confirmada: 3/4 grupos");
    expect(textoEntrega({ confirmadas: 3, nao_confirmadas: 1, sem_observador: 2, total: 6 })).toBe("Entrega confirmada: 3/4 grupos · 2 sem observador");
    expect(textoEntrega(undefined)).toBe("Entrega: conferida 30 min depois do envio");
    expect(textoEntrega({ confirmadas: 0, nao_confirmadas: 0, sem_observador: 0, total: 0 })).toBe("Entrega: conferida 30 min depois do envio");
  });
  it("alerta", () => {
    expect(textoAlertaEntrega(2, "17/10 14:30", "Lançamento")).toBe("2 grupo(s) sem confirmação de entrega na mensagem de 17/10 14:30 (campanha Lançamento)");
  });
  it("tipo novo de alerta com rótulo e ícone (filtro de Alertas)", () => {
    expect(TIPOS_ALERTA).toContain("entrega_nao_confirmada");
    expect(INFO_ALERTA.entrega_nao_confirmada).toEqual({ rotulo: "Confirmação de entrega", icone: "mark_chat_unread" });
  });
});

describe("conferirEntregas (passo entregas do tick)", () => {
  const prazo = (ms = 60_000) => ({ ate: Date.now() + ms });
  function montar(rpc: Resposta) {
    return dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "rpc:conferir_entregas") return rpc;
      if (c.tabela === "execucoes") return { data: [{ id: "e1", agendada_para: "2026-10-17T17:30:00.000Z" }] };
      if (c.tabela === "campanhas") return { data: [{ id: "c1", nome: "Lançamento" }] };
      return {};
    });
  }

  it("chama a RPC com o limite e cria UM alerta por execução devolvida", async () => {
    const { db, chamadas } = montar({ data: [{ execucao_id: "e1", campanha_id: "c1", nao_confirmadas: 2 }] });
    expect(await conferirEntregas(prazo(), db)).toBe(1);
    expect(chamadas.find((c) => c.tabela === "rpc:conferir_entregas")?.dados).toEqual({ p_limite: LIMITE_CONFERIR_ENTREGAS });
    expect(LIMITE_CONFERIR_ENTREGAS).toBe(500);
    expect(hoisted.alertarMock.mock.calls.map((c) => c[0])).toEqual([
      { tipo: "entrega_nao_confirmada", texto: "2 grupo(s) sem confirmação de entrega na mensagem de 17/10 14:30 (campanha Lançamento)", campanhaId: "c1" },
    ]);
  });

  it("regressão: nada devolvido (nenhuma campanha com a seção ligada) → nenhum alerta nem leitura extra", async () => {
    const { db, chamadas } = montar({ data: [] });
    expect(await conferirEntregas(prazo(), db)).toBe(0);
    expect(hoisted.alertarMock).not.toHaveBeenCalled();
    expect(chamadas.map((c) => c.tabela)).toEqual(["rpc:conferir_entregas"]);
  });

  it("erro da RPC lança (o tick registra e segue); sem tempo, nem chama", async () => {
    const ruim = montar({ error: { message: "fora do ar" } });
    await expect(conferirEntregas(prazo(), ruim.db)).rejects.toThrow("Não foi possível conferir as entregas: fora do ar");
    const semTempo = montar({ data: [] });
    expect(await conferirEntregas(prazo(1_000), semTempo.db)).toBe(0);
    expect(semTempo.chamadas).toEqual([]);
  });

  it("falha ao ler nomes: o alerta sai mesmo assim", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { db } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "rpc:conferir_entregas") return { data: [{ execucao_id: "e1", campanha_id: "c1", nao_confirmadas: 1 }] };
      return { error: { message: "fora do ar" } };
    });
    await conferirEntregas(prazo(), db);
    erro.mockRestore();
    expect((hoisted.alertarMock.mock.calls[0][0] as { texto: string }).texto).toBe("1 grupo(s) sem confirmação de entrega na mensagem de data desconhecida (campanha sem nome)");
  });
});
