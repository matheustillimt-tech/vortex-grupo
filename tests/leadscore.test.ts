import { describe, expect, it } from "vitest";
import {
  alternarTipo,
  CHIPS_RECIBO,
  CRITERIOS,
  deslocamentoDaPagina,
  janelaDoVolume,
  larguraBarra,
  lerAgrupamento,
  lerCriterio,
  lerTipos,
  paramsFiltroAcao,
  PONTOS_RECIBO,
  porHoraDoDia,
  rotuloPeriodo,
  serieDoVolume,
  tiposParaParametro,
  tituloTopGrupos,
} from "@/src/lib/regras/leadscore";
import { CABECALHO_DESEMPENHO, CABECALHO_LEADSCORE, linhaCsvDesempenho, linhaCsvLeadscore } from "@/src/lib/regras/csv";

describe("pontos e chips", () => {
  it("recebeu 10, visualizou 20, reproduziu 40, com os rótulos da tela", () => {
    expect(PONTOS_RECIBO).toEqual({ recebeu: 10, visualizou: 20, reproduziu: 40 });
    expect(CHIPS_RECIBO.map((c) => [c.icone, c.rotulo])).toEqual([
      ["mark_email_read", "Recebeu (10 pts)"],
      ["visibility", "Visualizou (20 pts)"],
      ["play_circle", "Reproduziu (40 pts)"],
    ]);
  });
});

describe("lerTipos / alternarTipo / tiposParaParametro", () => {
  it("ausente, vazio ou inválido: todos; senão os válidos na ordem dos chips", () => {
    expect(lerTipos(undefined)).toEqual(["recebeu", "visualizou", "reproduziu"]);
    expect(lerTipos("")).toEqual(["recebeu", "visualizou", "reproduziu"]);
    expect(lerTipos("reagiu")).toEqual(["recebeu", "visualizou", "reproduziu"]);
    expect(lerTipos("reproduziu,recebeu,xx")).toEqual(["recebeu", "reproduziu"]);
  });
  it("liga e desliga; nunca deixa sem nenhum", () => {
    expect(alternarTipo(["recebeu", "visualizou", "reproduziu"], "visualizou")).toEqual(["recebeu", "reproduziu"]);
    expect(alternarTipo(["recebeu"], "reproduziu")).toEqual(["recebeu", "reproduziu"]);
    expect(alternarTipo(["recebeu"], "recebeu")).toEqual(["recebeu"]);
  });
  it("todos → null (URL limpa); senão a lista", () => {
    expect(tiposParaParametro(["recebeu", "visualizou", "reproduziu"])).toBeNull();
    expect(tiposParaParametro(["visualizou"])).toBe("visualizou");
  });
});

describe("gráfico de volume", () => {
  const agora = new Date("2026-10-17T12:00:00Z");
  it("lerAgrupamento cai em hora", () => {
    expect(lerAgrupamento("semana")).toBe("semana");
    expect(lerAgrupamento("ano")).toBe("hora");
    expect(lerAgrupamento(undefined)).toBe("hora");
  });
  it("janelas: por hora 'Volume por hora' / 'Últimos 7 dias'", () => {
    expect(janelaDoVolume("hora", agora)).toEqual({ titulo: "Volume por hora", subtitulo: "Últimos 7 dias", inicio: new Date("2026-10-10T12:00:00Z") });
    expect(janelaDoVolume("dia", agora).subtitulo).toBe("Últimos 30 dias");
    expect(janelaDoVolume("semana", agora).titulo).toBe("Volume por semana");
    expect(janelaDoVolume("mes", agora).subtitulo).toBe("Últimos 12 meses");
  });
  it("rótulos por período", () => {
    expect(rotuloPeriodo("hora", "2026-10-16 14:00")).toBe("16/10 14h");
    expect(rotuloPeriodo("dia", "2026-10-16 00:00")).toBe("16/10/2026");
    expect(rotuloPeriodo("semana", "2026-10-12 00:00")).toBe("12/10/2026");
    expect(rotuloPeriodo("mes", "2026-10-01 00:00")).toBe("10/2026");
  });
  it("série soma só os tipos ligados", () => {
    const linhas = [{ periodo: "2026-10-16 14:00", recebeu: 3, visualizou: 2, reproduziu: 1 }];
    expect(serieDoVolume(linhas, "hora", ["recebeu", "visualizou", "reproduziu"])).toEqual([{ data: "2026-10-16 14:00", valor: 6, rotulo: "16/10 14h" }]);
    expect(serieDoVolume(linhas, "hora", ["reproduziu"])[0].valor).toBe(1);
  });
  it("porHoraDoDia: soma os baldes por hora do dia, eixo 00h…23h", () => {
    const serie = [
      { data: "2026-10-16 14:00", valor: 3, rotulo: "16/10 14h" },
      { data: "2026-10-17 14:00", valor: 2, rotulo: "17/10 14h" },
      { data: "2026-10-17 09:00", valor: 5, rotulo: "17/10 09h" },
    ];
    const porHora = porHoraDoDia(serie);
    expect(porHora).toHaveLength(24);
    expect(porHora[0]).toEqual({ data: "00", valor: 0, rotulo: "00h" });
    expect(porHora[9]).toEqual({ data: "09", valor: 5, rotulo: "09h" });
    expect(porHora[14]).toEqual({ data: "14", valor: 5, rotulo: "14h" });
    expect(porHora.reduce((s, p) => s + p.valor, 0)).toBe(10);
  });
});

describe("desempenho por grupo", () => {
  it("critérios e título", () => {
    expect(CRITERIOS.map((c) => c.rotulo)).toEqual(["GERAL", "VISUALIZAÇÃO", "REPRODUÇÃO", "RECEBIMENTO"]);
    expect(lerCriterio("reproducao")).toBe("reproducao");
    expect(lerCriterio("interacao")).toBe("geral");
    expect(tituloTopGrupos("geral")).toBe("Top 20 grupos por geral");
    expect(tituloTopGrupos("visualizacao")).toBe("Top 20 grupos por visualização");
  });
  it("larguraBarra relativa à maior, 0 sem pontos", () => {
    expect(larguraBarra(5, 10)).toBe(50);
    expect(larguraBarra(10, 10)).toBe(100);
    expect(larguraBarra(0, 10)).toBe(0);
    expect(larguraBarra(3, 0)).toBe(0);
    expect(larguraBarra(0.001, 10)).toBe(1);
  });
  it("deslocamento da página", () => {
    expect(deslocamentoDaPagina(1)).toBe(0);
    expect(deslocamentoDaPagina(3)).toBe(50);
    expect(deslocamentoDaPagina(-2)).toBe(0);
    expect(deslocamentoDaPagina(Number.NaN)).toBe(0);
  });

  it("paramsFiltroAcao: seta/apaga 'execucao' e sempre apaga 'pagina' (revisão final B, item m6)", () => {
    const atuais = new URLSearchParams({ q: "oi", pagina: "3" });
    expect(paramsFiltroAcao(atuais, "exec-1").toString()).toBe(new URLSearchParams({ q: "oi", execucao: "exec-1" }).toString());
    expect(paramsFiltroAcao(atuais, "").toString()).toBe(new URLSearchParams({ q: "oi" }).toString());
    // Não toca no URLSearchParams recebido.
    expect(atuais.toString()).toBe(new URLSearchParams({ q: "oi", pagina: "3" }).toString());
  });
});

describe("CSV", () => {
  it("leadscore", () => {
    expect(CABECALHO_LEADSCORE).toEqual(["Posição", "Telefone", "Pontos", "Recebeu", "Visualizou", "Reproduziu"]);
    expect(linhaCsvLeadscore(1, { telefone: "5511" + "911111111", pontos: 70, recebeu: 1, visualizou: 1, reproduziu: 1 })).toEqual(["1", "55 11 " + "91111-1111", "70", "1", "1", "1"]);
  });
  it("desempenho com vírgula decimal", () => {
    expect(CABECALHO_DESEMPENHO).toHaveLength(9);
    expect(linhaCsvDesempenho(2, { numero: 3, nome: "Grupo 3", participantes: 10, recebeu: 4, visualizou: 2, reproduziu: 0, pontos: 80, pontuacao: 8 })).toEqual([
      "2", "3", "Grupo 3", "10", "4", "2", "0", "80", "8,00",
    ]);
  });
});
