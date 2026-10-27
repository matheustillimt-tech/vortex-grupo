import { describe, expect, it } from "vitest";
import { cartoesDoResumo, filtrarCampanhas, inicioDoPeriodo, lerOrdemCampanha, lerPeriodo, paginar, percentual, resumoDaLinha, somarResumos, tempoDesde, type CampanhaLista } from "@/src/lib/regras/campanhas";

describe("lerPeriodo", () => {
  it("aceita só as opções; padrão 90", () => {
    expect(lerPeriodo("14")).toBe(14);
    expect(lerPeriodo("15")).toBe(90);
    expect(lerPeriodo(undefined)).toBe(90);
    expect(lerPeriodo("90", [7, 14, 21, 28], 7)).toBe(7);
  });
});

describe("percentual", () => {
  it("duas casas com vírgula", () => {
    expect(percentual(10807, 18048)).toBe("59,88");
    expect(percentual(1, 0)).toBe("0,00");
  });
});

describe("resumos", () => {
  const linha = { campanha_id: "c1", cliques: "10", entradas: "6", saidas: "2", participantes: "8", admins: "2", grupos: "3", grupos_cheios: "1" };
  it("converte bigint em número", () => {
    expect(resumoDaLinha(linha)).toEqual({ campanhaId: "c1", cliques: 10, entradas: 6, saidas: 2, participantes: 8, admins: 2, grupos: 3, gruposCheios: 1 });
  });
  it("soma", () => {
    const r = resumoDaLinha(linha);
    expect(somarResumos([r, r])).toEqual({ cliques: 20, entradas: 12, saidas: 4, participantes: 16, admins: 4, grupos: 6, gruposCheios: 2 });
    expect(somarResumos([])).toEqual({ cliques: 0, entradas: 0, saidas: 0, participantes: 0, admins: 0, grupos: 0, gruposCheios: 0 });
  });
  it("8 cartões na ordem da tela", () => {
    const c = cartoesDoResumo({ cliques: 18048, entradas: 10807, saidas: 3629, participantes: 8307, admins: 80, grupos: 30, gruposCheios: 14 });
    expect(c.map((x) => x.rotulo)).toEqual(["Clicks", "Entraram", "Percentual de entrada", "Sairam", "Participantes (total)", "Grupos (total)", "Grupos cheios", "Grupos disponíveis"]);
    expect(c.map((x) => x.icone)).toEqual(["ads_click", "login", "percent", "logout", "people", "groups", "check_box", "check_box_outline_blank"]);
    expect(c.map((x) => x.valor)).toEqual(["18.048", "10.807", "59,88", "3.629", "8.307", "30", "14", "16"]);
    expect(c[4].detalhe).toBe("80 Administradores · 8.227 Leads");
    expect(c[5].detalhe).toBeUndefined();
  });
  it("com distintos: acrescenta grupos distintos de WhatsApp nos dois cartões", () => {
    const c = cartoesDoResumo(
      { cliques: 18048, entradas: 10807, saidas: 3629, participantes: 8307, admins: 80, grupos: 30, gruposCheios: 14 },
      { grupos: 25, participantes: 7900 },
    );
    expect(c[4].detalhe).toBe("80 Administradores · 8.227 Leads · 7.900 em grupos distintos de WhatsApp");
    expect(c[5].detalhe).toBe("25 grupos distintos de WhatsApp");
  });
});

describe("lerOrdemCampanha", () => {
  it("aceita só criacao/atualizacao/posicao; padrão criacao", () => {
    expect(lerOrdemCampanha("atualizacao")).toBe("atualizacao");
    expect(lerOrdemCampanha("posicao")).toBe("posicao");
    expect(lerOrdemCampanha("nome")).toBe("criacao");
    expect(lerOrdemCampanha(undefined)).toBe("criacao");
  });
});

describe("filtrarCampanhas e paginar", () => {
  const l: CampanhaLista[] = [
    { id: "1", nome: "Bravo", descricao: "", arquivada: false, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-05T00:00:00Z", posicao: 2 },
    { id: "2", nome: "Alfa Ávila", descricao: "", arquivada: true, created_at: "2026-10-03T00:00:00Z", updated_at: "2026-10-03T00:00:00Z", posicao: 1 },
    { id: "3", nome: "Charlie", descricao: "", arquivada: false, created_at: "2026-10-02T00:00:00Z", updated_at: "2026-10-10T00:00:00Z", posicao: 0 },
  ];
  it("abas, busca sem acento e ordem por data de criação", () => {
    expect(filtrarCampanhas(l, { aba: "todas", busca: "", ordem: "criacao" }).map((c) => c.id)).toEqual(["2", "3", "1"]);
    expect(filtrarCampanhas(l, { aba: "ativas", busca: "", ordem: "criacao" }).map((c) => c.id)).toEqual(["3", "1"]);
    expect(filtrarCampanhas(l, { aba: "arquivadas", busca: "", ordem: "criacao" }).map((c) => c.id)).toEqual(["2"]);
    expect(filtrarCampanhas(l, { aba: "todas", busca: "avila", ordem: "criacao" }).map((c) => c.id)).toEqual(["2"]);
  });
  it("ordem por data de atualização", () => {
    expect(filtrarCampanhas(l, { aba: "todas", busca: "", ordem: "atualizacao" }).map((c) => c.id)).toEqual(["3", "1", "2"]);
  });
  it("ordem por posição (crescente; empate pela data de criação)", () => {
    expect(filtrarCampanhas(l, { aba: "todas", busca: "", ordem: "posicao" }).map((c) => c.id)).toEqual(["3", "2", "1"]);
  });
  it("fixadas sempre no topo, em qualquer ordenação", () => {
    const comFixada = l.map((c) => (c.id === "1" ? { ...c, fixada: true } : c));
    expect(filtrarCampanhas(comFixada, { aba: "todas", busca: "", ordem: "criacao" }).map((c) => c.id)).toEqual(["1", "2", "3"]);
    expect(filtrarCampanhas(comFixada, { aba: "todas", busca: "", ordem: "posicao" }).map((c) => c.id)).toEqual(["1", "3", "2"]);
  });
  it("paginar", () => {
    const p = paginar(Array.from({ length: 30 }, (_, i) => i), 3, 12);
    expect(p).toEqual({ itens: [24, 25, 26, 27, 28, 29], de: 25, ate: 30, total: 30, pagina: 3, paginas: 3 });
    expect(paginar([], 1, 12)).toEqual({ itens: [], de: 0, ate: 0, total: 0, pagina: 1, paginas: 1 });
    expect(paginar([1, 2], 9, 12).pagina).toBe(1);
  });
});

describe("inicioDoPeriodo", () => {
  const agora = new Date("2026-10-16T12:00:00Z"); // 09:00 em Brasília, ainda dia 16
  it("meia-noite de Brasília do primeiro dia da janela (dias de calendário, não 24h corridas)", () => {
    expect(inicioDoPeriodo(1, agora)).toBe("2026-10-16T03:00:00.000Z");
    expect(inicioDoPeriodo(7, agora)).toBe("2026-10-10T03:00:00.000Z");
    expect(inicioDoPeriodo(90, agora)).toBe("2026-07-19T03:00:00.000Z");
  });
});

describe("tempoDesde", () => {
  const agora = new Date("2026-10-16T12:00:00Z");
  it.each([
    ["2026-10-16T11:59:30Z", "agora mesmo"],
    ["2026-10-16T10:00:00Z", "há 2 horas"],
    ["2026-10-15T12:00:00Z", "há 1 dia"],
    ["2026-10-01T12:00:00Z", "há 15 dias"],
    ["2026-09-10T12:00:00Z", "há cerca de 1 mês"],
    ["2026-06-10T12:00:00Z", "há cerca de 4 meses"],
    ["2025-09-10T12:00:00Z", "há cerca de 1 ano"],
  ])("%s → %s", (iso, texto) => {
    expect(tempoDesde(iso, agora)).toBe(texto);
  });
});
