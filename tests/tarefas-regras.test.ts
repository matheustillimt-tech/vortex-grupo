import { describe, expect, it } from "vitest";
import { compararTarefas, decidirExecucaoVazia, planejarTarefas, prioridadeDaExecucao } from "@/src/lib/regras/tarefas";

const inicio = new Date("2026-10-21T22:50:00Z");
const grupos = [
  { grupoId: "g1", conexaoId: "A", numero: 1 },
  { grupoId: "g2", conexaoId: "A", numero: 2 },
];

describe("planejarTarefas", () => {
  it("no mesmo horário, a mensagem sai antes de nome e abrir, 3–8 s entre tarefas do mesmo número", () => {
    const r = planejarTarefas(
      [
        { execucaoId: "msg", tipo: "mensagem", agendadaPara: "2026-10-21T22:50:00Z", grupos },
        { execucaoId: "abrir", tipo: "abrir", agendadaPara: "2026-10-21T22:50:00Z", grupos },
        { execucaoId: "nome", tipo: "nome", agendadaPara: "2026-10-21T22:49:00Z", grupos },
      ],
      inicio,
      () => 0.5,
    );
    expect(r.map((t) => `${t.execucaoId}:${t.grupoId}:${t.enviarApos.getTime() - inicio.getTime()}`)).toEqual([
      "msg:g1:0",
      "msg:g2:5500",
      "nome:g1:11000",
      "nome:g2:16500",
      "abrir:g1:22000",
      "abrir:g2:27500",
    ]);
    expect(r.map((t) => t.prioridade)).toEqual([0, 0, 1, 1, 1, 1]);
  });

  it("números diferentes andam em paralelo", () => {
    const r = planejarTarefas(
      [{ execucaoId: "m", tipo: "mensagem", agendadaPara: "2026-10-21T22:50:00Z", grupos: [{ grupoId: "g1", conexaoId: "A", numero: 1 }, { grupoId: "g2", conexaoId: "B", numero: 2 }] }],
      inicio,
      () => 0,
    );
    expect(r.map((t) => t.enviarApos.getTime() - inicio.getTime())).toEqual([0, 0]);
  });
});

describe("compararTarefas", () => {
  it("mensagem antes de ação mesmo se a ação entrou antes; empatado, por horário", () => {
    const lote = [
      { id: "m", enviar_apos: "2026-10-21T22:50:00Z", prioridade: 0 },
      { id: "n", enviar_apos: "2026-10-21T22:50:00.000Z", prioridade: 1 },
      { id: "acao-cedo", enviar_apos: "2026-10-21T22:49:00Z", prioridade: 1 },
      { id: "m-cedo", enviar_apos: "2026-10-21T22:49:30Z", prioridade: 0 },
    ];
    expect([...lote].sort(compararTarefas).map((t) => t.id)).toEqual(["m-cedo", "m", "acao-cedo", "n"]);
  });
});

describe("decidirExecucaoVazia (execução em 'enviando' sem nenhuma tarefa)", () => {
  const agora = new Date("2026-10-21T23:00:00Z");
  const min = (m: number) => new Date(agora.getTime() - m * 60_000).toISOString();

  it("começou há até 5 min: espera (o `iniciar` pode estar no meio, em outro tick)", () => {
    expect(decidirExecucaoVazia({ iniciadaEm: min(1), origem: "avulsa", agendadaPara: min(1) }, agora)).toBe("esperar");
    expect(decidirExecucaoVazia({ iniciadaEm: min(5), origem: "sequencia", agendadaPara: min(30) }, agora)).toBe("esperar");
  });

  it("parada há mais de 5 min: volta pra agendada", () => {
    expect(decidirExecucaoVazia({ iniciadaEm: min(6), origem: "avulsa", agendadaPara: min(60) }, agora)).toBe("reagendar");
    expect(decidirExecucaoVazia({ iniciadaEm: min(6), origem: "sequencia", agendadaPara: min(10) }, agora)).toBe("reagendar");
  });

  it("passo de sequência parado e mais de 15 min atrasado: pulada (não dispara atrasado)", () => {
    expect(decidirExecucaoVazia({ iniciadaEm: min(6), origem: "sequencia", agendadaPara: min(16) }, agora)).toBe("pular");
  });

  it("ação de cronograma de automação parada e mais de 15 min atrasada: pulada; de evento (grupo) não", () => {
    expect(decidirExecucaoVazia({ iniciadaEm: min(6), origem: "automacao", gatilhoChave: "cronograma", agendadaPara: min(16) }, agora)).toBe("pular");
    expect(decidirExecucaoVazia({ iniciadaEm: min(6), origem: "automacao", gatilhoChave: "cronograma", agendadaPara: min(10) }, agora)).toBe("reagendar");
    expect(decidirExecucaoVazia({ iniciadaEm: min(6), origem: "automacao", gatilhoChave: "g9", agendadaPara: min(60) }, agora)).toBe("reagendar");
  });

  it("sem iniciada_em (linha antiga) conexão como parada", () => {
    expect(decidirExecucaoVazia({ iniciadaEm: null, origem: "massa", agendadaPara: min(2) }, agora)).toBe("reagendar");
  });
});

describe("prioridadeDaExecucao (atualização periódica de links não passa na frente de mensagem)", () => {
  it("periódica da seção da campanha: prioridade de ação (1)", () => {
    expect(prioridadeDaExecucao({ tipo: "atualizar_links", origem: "campanha", gatilhoChave: "periodico:2026-10-17T12:00:00.000Z" })).toBe(1);
  });
  it("o resto segue o tipo (ações 1; mensagem 0)", () => {
    expect(prioridadeDaExecucao({ tipo: "atualizar_links", origem: "campanha", gatilhoChave: "banimento:x:2026-10-17T12:00:00.000Z" })).toBe(1);
    expect(prioridadeDaExecucao({ tipo: "atualizar_links", origem: "avulsa", gatilhoChave: null })).toBe(1);
    expect(prioridadeDaExecucao({ tipo: "redefinir_link", origem: "campanha", gatilhoChave: "cheio:g:nunca" })).toBe(1);
    expect(prioridadeDaExecucao({ tipo: "mensagem", origem: "avulsa" })).toBe(0);
  });
  it("planejarTarefas usa a prioridade da execução: a periódica vai depois da mensagem do mesmo tick", () => {
    const g = (id: string) => [{ grupoId: id, conexaoId: "A", numero: 1 }];
    const t = planejarTarefas([
      { execucaoId: "links", tipo: "atualizar_links", prioridade: 1, agendadaPara: "2026-10-17T12:00:30.000Z", grupos: g("g1") },
      { execucaoId: "msg", tipo: "mensagem", agendadaPara: "2026-10-17T12:00:00.000Z", grupos: g("g2") },
    ], new Date("2026-10-17T12:01:00.000Z"), () => 0);
    expect(t.map((x) => [x.execucaoId, x.prioridade])).toEqual([["msg", 0], ["links", 1]]);
    const semPrioridade = planejarTarefas([
      { execucaoId: "links", tipo: "atualizar_links", agendadaPara: "2026-10-17T12:00:30.000Z", grupos: g("g1") },
      { execucaoId: "msg", tipo: "mensagem", agendadaPara: "2026-10-17T12:00:00.000Z", grupos: g("g2") },
    ], new Date("2026-10-17T12:01:00.000Z"), () => 0);
    expect(semPrioridade.map((x) => x.execucaoId)).toEqual(["msg", "links"]); // sem prioridade explícita: a do tipo, mensagem na frente
  });
});
