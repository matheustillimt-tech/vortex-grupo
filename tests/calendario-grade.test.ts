import { describe, expect, it } from "vitest";
import {
  agruparPorDiaChave,
  diaDaSemana,
  diaMaisDias,
  janelaDaGrade,
  janelaDoDiaUnico,
  matrizDoMes,
  navegarAncora,
  rotuloEvento,
  rotuloMes,
  semanaDoDia,
  validarDataAncora,
  validarVisao,
} from "@/src/lib/regras/calendario-grade";

describe("validarVisao", () => {
  it("aceita mes/semana/agenda e cai em mes por padrão", () => {
    expect(validarVisao("semana")).toBe("semana");
    expect(validarVisao("agenda")).toBe("agenda");
    expect(validarVisao(undefined)).toBe("mes");
    expect(validarVisao("lixo")).toBe("mes");
  });
});

describe("validarDataAncora", () => {
  it("aceita AAAA-MM-DD válido e cai no hoje de Brasília", () => {
    const agora = new Date("2026-10-17T10:00:00Z"); // 07h em Brasília, ainda dia 17
    expect(validarDataAncora("2026-10-05", agora)).toBe("2026-10-05");
    expect(validarDataAncora(undefined, agora)).toBe("2026-10-17");
    expect(validarDataAncora("não é data", agora)).toBe("2026-10-17");
    expect(validarDataAncora("2026-13-40", agora)).toBe("2026-10-17");
  });

  it("vira o dia de Brasília antes da meia-noite UTC (sem horário de verão)", () => {
    // 02h UTC de 18/10 = 23h de Brasília em 17/10.
    const agora = new Date("2026-10-18T02:00:00Z");
    expect(validarDataAncora(undefined, agora)).toBe("2026-10-17");
  });
});

describe("diaMaisDias / diaDaSemana", () => {
  it("soma e subtrai dias de calendário, cruzando mês e ano", () => {
    expect(diaMaisDias("2026-10-31", 1)).toBe("2026-11-01");
    expect(diaMaisDias("2026-12-31", 1)).toBe("2027-01-01");
    expect(diaMaisDias("2026-10-01", -1)).toBe("2026-09-30");
  });

  it("dia da semana (0 = domingo)", () => {
    expect(diaDaSemana("2026-10-17")).toBe(6); // sábado
    expect(diaDaSemana("2026-10-18")).toBe(0); // domingo
  });
});

describe("matrizDoMes", () => {
  it("outubro de 2026 (1º é quinta) começa no domingo anterior e fecha completando a última semana", () => {
    const m = matrizDoMes("2026-10-05");
    expect(m[0][0]).toBe("2026-09-27"); // domingo antes do 1º (quinta)
    const ultimaSemana = m[m.length - 1];
    expect(ultimaSemana[ultimaSemana.length - 1]).toBe("2026-10-31"); // 31/10 já é sábado
    for (const semana of m) expect(semana).toHaveLength(7);
  });

  it("fevereiro de 2026 (28 dias, começa num domingo) não sobra nenhum dia do mês seguinte fora da última semana", () => {
    const m = matrizDoMes("2026-02-10");
    expect(m[0][0]).toBe("2026-02-01");
    const ultimaSemana = m[m.length - 1];
    expect(ultimaSemana[0]).toBe("2026-02-22");
    expect(ultimaSemana[6]).toBe("2026-02-28");
  });

  it("todo dia aparece uma única vez, em ordem", () => {
    const dias = matrizDoMes("2026-10-05").flat();
    expect(new Set(dias).size).toBe(dias.length);
    expect(dias).toEqual([...dias].sort());
  });
});

describe("semanaDoDia", () => {
  it("7 dias dom.–sáb. contendo a âncora, mesmo em virada de mês", () => {
    const s = semanaDoDia("2026-10-31"); // sábado
    expect(s).toEqual(["2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"]);
  });
});

describe("janelaDaGrade", () => {
  it("mês: de 00h do primeiro dia da grade a 24h do último, fixo em UTC-3", () => {
    const j = janelaDaGrade("mes", "2026-10-05");
    expect(j.de.toISOString()).toBe("2026-09-27T03:00:00.000Z");
    expect(j.ate.toISOString()).toBe("2026-11-01T03:00:00.000Z");
  });

  it("semana: de domingo 00h a sábado 24h em Brasília", () => {
    const j = janelaDaGrade("semana", "2026-10-31");
    expect(j.de.toISOString()).toBe("2026-10-25T03:00:00.000Z");
    expect(j.ate.toISOString()).toBe("2026-11-01T03:00:00.000Z");
  });
});

describe("janelaDoDiaUnico (revisão final: agenda com ?dia= mostra só aquele dia, separado de ?data=)", () => {
  it("de 00h a 24h do dia pedido, fixo em UTC-3", () => {
    const j = janelaDoDiaUnico("2026-10-21");
    expect(j?.de.toISOString()).toBe("2026-10-21T03:00:00.000Z");
    expect(j?.ate.toISOString()).toBe("2026-10-22T03:00:00.000Z");
  });

  it("null sem data ou com data inválida (cai no período normal)", () => {
    expect(janelaDoDiaUnico(undefined)).toBeNull();
    expect(janelaDoDiaUnico("21/10/2026")).toBeNull();
    expect(janelaDoDiaUnico("não é data")).toBeNull();
  });
});

describe("rotuloMes", () => {
  it("'outubro de 2026'", () => {
    expect(rotuloMes("2026-10-17")).toBe("outubro de 2026");
    expect(rotuloMes("2026-01-01")).toBe("janeiro de 2026");
  });
});

describe("navegarAncora", () => {
  it("mês: vai pro dia 1 do mês anterior/seguinte, cruzando ano", () => {
    expect(navegarAncora("mes", "2026-10-17", 1)).toBe("2026-11-01");
    expect(navegarAncora("mes", "2026-12-17", 1)).toBe("2027-01-01");
    expect(navegarAncora("mes", "2026-01-17", -1)).toBe("2025-12-01");
  });

  it("semana: anda 7 dias", () => {
    expect(navegarAncora("semana", "2026-10-31", 1)).toBe("2026-11-07");
    expect(navegarAncora("semana", "2026-10-31", -1)).toBe("2026-10-24");
  });
});

describe("agruparPorDiaChave", () => {
  it("agrupa pelo dia de Brasília e ordena por horário dentro do dia", () => {
    const itens = [
      { quando: "2026-10-22T01:00:00Z", chave: "b" }, // 21/10 22h em Brasília
      { quando: "2026-10-21T13:00:00Z", chave: "a" },
      { quando: "2026-10-22T12:00:00Z", chave: "c" },
    ];
    const m = agruparPorDiaChave(itens);
    expect([...m.keys()].sort()).toEqual(["2026-10-21", "2026-10-22"]);
    expect(m.get("2026-10-21")!.map((i) => i.chave)).toEqual(["a", "b"]);
    expect(m.get("2026-10-22")!.map((i) => i.chave)).toEqual(["c"]);
  });
});

describe("rotuloEvento", () => {
  it("mensagem/enquete avulsa não leva prefixo de ação", () => {
    expect(rotuloEvento("mensagem", "avulsa", "20:00")).toBe("Mensagem 20:00");
    expect(rotuloEvento("enquete", "massa", "09:30")).toBe("Enquete 09:30");
  });

  it("ação de grupo leva 'Ação:'", () => {
    expect(rotuloEvento("nome", "avulsa", "08:00")).toBe("Ação: Trocar nome 08:00");
  });

  it("origem automação/sequência prefixa por cima", () => {
    expect(rotuloEvento("mensagem", "automacao", "20:00")).toBe("Automação: Mensagem 20:00");
    expect(rotuloEvento("mensagem", "sequencia", "19:50")).toBe("Sequência: Mensagem 19:50");
  });

  it("origem automação com o nome já lido na consulta: 'Automação: {nome} hh:mm'", () => {
    expect(rotuloEvento("mensagem", "automacao", "20:00", "Boas-vindas")).toBe("Automação: Boas-vindas 20:00");
  });

  it("origem automação sem nome (automação apagada, ou de fora da leitura): continua pelo tipo da ação", () => {
    expect(rotuloEvento("mensagem", "automacao", "20:00", null)).toBe("Automação: Mensagem 20:00");
    expect(rotuloEvento("mensagem", "automacao", "20:00", undefined)).toBe("Automação: Mensagem 20:00");
  });
});

describe("GradeMensal/GradeSemanal", () => {
  it("cabeçalho dos dias em 'dom.', 'seg.' … sem uppercase; todos os eventos do dia, sem '+N'", async () => {
    (globalThis as { React?: unknown }).React = await import("react");
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { GradeMensal } = await import("@/app/(painel)/_componentes/calendario-grade");
    const muitos = Array.from({ length: 5 }, (_, i) => ({
      chave: `e-${i}`,
      campanhaId: "c1",
      execucaoId: `e${i}`,
      passoId: null,
      quando: `2026-10-05T${10 + i}:00:00Z`,
      tipo: "mensagem" as const,
      origem: "avulsa",
      resumo: "",
      situacao: "feito" as const,
      detalhe: null,
    }));
    const porDia = new Map([["2026-10-05", muitos]]);
    const html = renderToStaticMarkup(
      createElement(GradeMensal, { semanas: [["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"]], hoje: "2026-10-05", porDia, baseHref: "/calendario" }),
    );
    expect(html).toContain(">dom.<");
    expect(html).toContain(">seg.<");
    expect(html).toContain(">sáb.<");
    expect(html).not.toMatch(/>DOM</);
    expect(html).not.toMatch(/\+\d/);
    // Os 5 eventos aparecem todos na célula (sem corte em 3, sem "+N" pro resto) — um link por execução.
    expect(html.match(/\/campanhas\/c1\/mensagens\/e\d/g)?.length).toBe(5);
  });

  it("dia com 10 eventos mostra todos, sem '+N' (Etapa 3N: rolagem interna em vez de cortar)", async () => {
    (globalThis as { React?: unknown }).React = await import("react");
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { GradeMensal } = await import("@/app/(painel)/_componentes/calendario-grade");
    const muitos = Array.from({ length: 10 }, (_, i) => ({
      chave: `e-${i}`,
      campanhaId: "c1",
      execucaoId: `e${i}`,
      passoId: null,
      quando: `2026-10-05T${10 + i}:00:00Z`,
      tipo: "mensagem" as const,
      origem: "avulsa",
      resumo: "",
      situacao: "feito" as const,
      detalhe: null,
    }));
    const porDia = new Map([["2026-10-05", muitos]]);
    const html = renderToStaticMarkup(
      createElement(GradeMensal, { semanas: [["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"]], hoje: "2026-10-05", porDia, baseHref: "/calendario" }),
    );
    // Os 10 eventos aparecem todos na célula (sem corte, sem link "+N" pro resto — a bolinha do mobile, que
    // resume em pontos sem link nenhum, é outra coisa e continua cortando em 6).
    expect(html.match(/\/campanhas\/c1\/mensagens\/e\d/g)?.length).toBe(10);
    expect(html).not.toContain('dia=2026-10-05">+');
  });
});
