import { describe, expect, it } from "vitest";
import {
  analisarVisitantes,
  cartoesAnaliseVisitantes,
  contagemComportamento,
  contaDesatualizada,
  dataHoraCompleta,
  desdeDoPeriodo,
  deslocamentoDaPagina,
  EVENTOS,
  filtrarVisitantes,
  lerComportamentoVisitante,
  lerEvento,
  lerPeriodoGrafico,
  lerSubAbaClicks,
  LIMITE_PAGINA_EXPORTACAO,
  parametrosUrl,
  PERIODOS_GRAFICO,
  rotuloEvento,
  visitanteCurto,
  conectadosParaDescontar,
  semNumerosConectados,
  totalSemConectados,
} from "@/src/lib/regras/analises";
import { CABECALHO_ATIVIDADES, CABECALHO_CLIQUES, CABECALHO_DIAGNOSTICO, linhaCsvAtividade, linhaCsvClique, linhaCsvDiagnostico } from "@/src/lib/regras/csv";

describe("EVENTOS / lerEvento / rotuloEvento", () => {
  it("Todos/Entraram/Sairam", () => {
    expect(EVENTOS.map((e) => e.rotulo)).toEqual(["Todos", "Entraram", "Sairam"]);
    expect(lerEvento(undefined)).toBeNull();
    expect(lerEvento("entrada")).toBe("entrada");
    expect(lerEvento("saida")).toBe("saida");
    expect(lerEvento("outro")).toBeNull();
    expect(rotuloEvento("entrada")).toBe("Entraram");
    expect(rotuloEvento("saida")).toBe("Sairam");
  });
});

describe("PERIODOS_GRAFICO / lerPeriodoGrafico / desdeDoPeriodo", () => {
  it("7/14/21/28/Todo Período; qualquer outra coisa cai em Todo Período", () => {
    expect(PERIODOS_GRAFICO.map((p) => p.valor)).toEqual([7, 14, 21, 28, "todo"]);
    expect(lerPeriodoGrafico("14")).toBe(14);
    expect(lerPeriodoGrafico("todo")).toBe("todo");
    expect(lerPeriodoGrafico(undefined)).toBe("todo");
    expect(lerPeriodoGrafico("99")).toBe("todo");
  });
  it("desdeDoPeriodo: N dias atrás, ou a época pra Todo Período", () => {
    const agora = new Date("2026-10-17T12:00:00Z");
    expect(desdeDoPeriodo(7, agora).toISOString()).toBe("2026-10-10T12:00:00.000Z");
    expect(desdeDoPeriodo("todo", agora).getTime()).toBe(0);
  });
});

describe("deslocamentoDaPagina", () => {
  it("página 1 → 0; página N → (N-1)×porPagina; nunca negativo", () => {
    expect(deslocamentoDaPagina(1, 10)).toBe(0);
    expect(deslocamentoDaPagina(3, 10)).toBe(20);
    expect(deslocamentoDaPagina(0, 10)).toBe(0);
    expect(deslocamentoDaPagina(-5, 10)).toBe(0);
  });
});

describe("visitanteCurto", () => {
  it("só os 8 primeiros caracteres (não temos IP em claro, só o hash)", () => {
    expect(visitanteCurto("1234567890abcdef")).toBe("12345678");
    expect(visitanteCurto("abc")).toBe("abc");
  });
});

describe("parametrosUrl", () => {
  it("junta as UTMs preenchidas; '—' sem nenhuma", () => {
    expect(parametrosUrl({ utm_source: "instagram", utm_medium: "bio" })).toBe("utm_source=instagram utm_medium=bio");
    expect(parametrosUrl({})).toBe("—");
    expect(parametrosUrl({ utm_source: null, utm_campaign: "lancamento" })).toBe("utm_campaign=lancamento");
  });
});

describe("lerSubAbaClicks", () => {
  it("'analise' ou 'historico' (padrão)", () => {
    expect(lerSubAbaClicks("analise")).toBe("analise");
    expect(lerSubAbaClicks(undefined)).toBe("historico");
    expect(lerSubAbaClicks("x")).toBe("historico");
  });
});

describe("contaDesatualizada", () => {
  it("sem data ou com grupo pendente: sempre desatualizada", () => {
    expect(contaDesatualizada(null, false)).toBe(true);
    expect(contaDesatualizada(new Date().toISOString(), true)).toBe(true);
  });
  it("mais de 30 min desde a conferência mais antiga: desatualizada; senão não", () => {
    const agora = new Date("2026-10-17T12:00:00Z");
    const ha20min = new Date(agora.getTime() - 20 * 60_000).toISOString();
    const ha40min = new Date(agora.getTime() - 40 * 60_000).toISOString();
    expect(contaDesatualizada(ha20min, false, agora)).toBe(false);
    expect(contaDesatualizada(ha40min, false, agora)).toBe(true);
  });
});

describe("CSV: Atividades / Clicks / Diagnósticos", () => {
  it("linhaCsvAtividade: telefone legível, '#N nome', evento e data", () => {
    expect(CABECALHO_ATIVIDADES).toEqual(["Número", "Grupo", "Evento", "Data"]);
    const linha = linhaCsvAtividade({ telefone: "5511" + "988887777", grupo_nome: "Aulão", grupo_numero: 3, evento: "entrada", em: "2026-10-17T12:00:00Z" });
    expect(linha[0]).toBe("55 11 " + "98888-7777");
    expect(linha[1]).toBe("#3 Aulão");
    expect(linha[2]).toBe("Entraram");
  });
  it("linhaCsvClique: visitante curto, grupo opcional, parâmetros da URL", () => {
    expect(CABECALHO_CLIQUES).toEqual(["Visitante", "Grupo", "Data", "Parâmetros da URL"]);
    const comGrupo = linhaCsvClique({
      visitante: "abcdefgh12345", grupo_nome: "Aulão", grupo_numero: 1, criado_em: "2026-10-17T12:00:00Z",
      utm_source: "instagram", utm_medium: null, utm_campaign: null, utm_content: null, utm_term: null,
    });
    expect(comGrupo[0]).toBe("abcdefgh");
    expect(comGrupo[1]).toBe("#1 Aulão");
    expect(comGrupo[3]).toBe("utm_source=instagram");
    const semGrupo = linhaCsvClique({
      visitante: "xyz", grupo_nome: null, grupo_numero: null, criado_em: "2026-10-17T12:00:00Z",
      utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, utm_term: null,
    });
    expect(semGrupo[1]).toBe("");
    expect(semGrupo[3]).toBe("—");
  });
  it("linhaCsvDiagnostico: grupos da conexão, 'Nunca' sem conferência", () => {
    expect(CABECALHO_DIAGNOSTICO).toEqual(["Grupo", "Número", "Participantes", "Admin", "Conferido em"]);
    const linha = linhaCsvDiagnostico({ nome: "Aulão", numero: 3, participantes: 40, admin: true, conferido_em: null });
    expect(linha).toEqual(["Aulão", "3", "40", "Sim", "Nunca"]);
  });
});

describe("LIMITE_PAGINA_EXPORTACAO", () => {
  it("é 1000, idêntico ao teto (p_limite) de atividades_campanha e cliques_campanha (revisão final, Etapa 3G)", () => {
    // As rotas de exportação (app/api/exportar/{atividades,cliques}/route.ts) importam esta mesma constante
    // como tamanho de página — pedir mais que isso não ganha nada, a RPC corta antes (ver migracao.test.ts).
    expect(LIMITE_PAGINA_EXPORTACAO).toBe(1000);
  });
});

describe("dataHoraCompleta", () => {
  it("formata com segundos, em Brasília", () => {
    expect(dataHoraCompleta("2026-10-17T09:12:50Z")).toBe("17/10/2026, 06:12:50");
  });
});

describe("análise de visitantes (Clicks › Análise)", () => {
  const linhas = [
    // visitante "aaa": 3 cliques, todos no grupo 1 → sem sinal (abaixo do limite de repetição)
    { visitante: "aaa", grupo_id: "g1", grupo_numero: 1, grupo_nome: "Aulão 1", criado_em: "2026-10-17T10:00:00Z" },
    { visitante: "aaa", grupo_id: "g1", grupo_numero: 1, grupo_nome: "Aulão 1", criado_em: "2026-10-17T09:00:00Z" },
    { visitante: "aaa", grupo_id: "g1", grupo_numero: 1, grupo_nome: "Aulão 1", criado_em: "2026-10-17T08:00:00Z" },
    // visitante "bbb": 6 cliques, todos no grupo 2 → "Repetição em 1 grupo"
    ...Array.from({ length: 6 }, (_, i) => ({ visitante: "bbb", grupo_id: "g2", grupo_numero: 2, grupo_nome: "Aulão 2", criado_em: `2026-10-17T0${i}:00:00Z` })),
    // visitante "ccc": 5 grupos distintos, 5 cliques → "Varredura de grupos"
    ...Array.from({ length: 5 }, (_, i) => ({ visitante: "ccc", grupo_id: `g${i}`, grupo_numero: i, grupo_nome: `Aulão ${i}`, criado_em: `2026-10-17T1${i}:00:00Z` })),
  ];
  it("agrupa por visitante, do mais recente clique pra trás, com os sinais", () => {
    const agregados = analisarVisitantes(linhas);
    expect(agregados.map((a) => a.visitante)).toEqual(["bbb", "ccc", "aaa"]);
    const bbb = agregados.find((a) => a.visitante === "bbb")!;
    expect(bbb.cliques).toBe(6);
    expect(bbb.grupos).toBe(1);
    expect(bbb.sinais).toEqual(["repeticao_1_grupo"]);
    const ccc = agregados.find((a) => a.visitante === "ccc")!;
    expect(ccc.grupos).toBe(5);
    expect(ccc.sinais).toEqual(["varredura_grupos"]);
    const aaa = agregados.find((a) => a.visitante === "aaa")!;
    expect(aaa.sinais).toEqual([]);
    expect(aaa.ultimoGrupoNumero).toBe(1);
  });
  it("lerComportamentoVisitante: todos/1grupo/varios", () => {
    expect(lerComportamentoVisitante(undefined)).toBe("todos");
    expect(lerComportamentoVisitante("1grupo")).toBe("1grupo");
    expect(lerComportamentoVisitante("varios")).toBe("varios");
    expect(lerComportamentoVisitante("x")).toBe("todos");
  });
  it("filtrarVisitantes e contagemComportamento", () => {
    const agregados = analisarVisitantes(linhas);
    expect(contagemComportamento(agregados)).toEqual({ umGrupo: 2, variosGrupos: 1 });
    expect(filtrarVisitantes(agregados, { comportamento: "1grupo", minimoCliques: 0 }).map((v) => v.visitante).sort()).toEqual(["aaa", "bbb"]);
    expect(filtrarVisitantes(agregados, { comportamento: "varios", minimoCliques: 0 }).map((v) => v.visitante)).toEqual(["ccc"]);
    expect(filtrarVisitantes(agregados, { comportamento: "todos", minimoCliques: 5 }).map((v) => v.visitante)).toEqual(["bbb", "ccc"]);
  });
  it("cartoesAnaliseVisitantes: clicks, visitantes únicos, média e participação do top", () => {
    const agregados = analisarVisitantes(linhas);
    const c = cartoesAnaliseVisitantes(agregados);
    expect(c.clicks).toBe(14);
    expect(c.visitantesUnicos).toBe(3);
    expect(c.mediaCliquesPorVisitante).toBeCloseTo(14 / 3, 5);
    expect(c.participacaoTopVisitante).toBeCloseTo((6 / 14) * 100, 5);
  });
});

describe("Atividades sem os números conectados (teste de 17/10/2026, observação C)", () => {
  // A conta que cria os grupos, nas duas formas do nono dígito (como `telefonesConectados` devolve).
  const conectados = new Set(["5537" + "980001001", "553780001001"]);
  const linhas = [
    { telefone: "553780001001", evento: "entrada" },
    { telefone: "5511" + "977770000", evento: "entrada" },
    { telefone: "5537" + "980001001", evento: "saida" },
  ];

  it("tira da lista as linhas das conexões conectadas (qualquer forma do nono dígito)", () => {
    expect(semNumerosConectados(linhas, conectados)).toEqual([{ telefone: "5511" + "977770000", evento: "entrada" }]);
  });

  it("sem conexões conectadas a lista fica igual (mesmo array)", () => {
    expect(semNumerosConectados(linhas, new Set())).toBe(linhas);
  });

  it("desconta do total só os telefones que batem com a busca", () => {
    expect(conectadosParaDescontar(conectados, null)).toEqual(["553780001001", "5537" + "980001001"]);
    expect(conectadosParaDescontar(conectados, "98000")).toEqual(["5537" + "980001001"]);
    expect(conectadosParaDescontar(conectados, "(37) 8000")).toEqual(["553780001001"]);
    expect(conectadosParaDescontar(conectados, "5511")).toEqual([]);
    expect(conectadosParaDescontar(new Set(["lid:abc", "5511" + "900000000"]), null)).toEqual(["5511" + "900000000"]);
  });

  it("total nunca fica negativo e ignora valores estranhos", () => {
    expect(totalSemConectados(3, [1, 1])).toBe(1);
    expect(totalSemConectados(1, [2])).toBe(0);
    expect(totalSemConectados(5, [Number.NaN, 2])).toBe(3);
  });
});
