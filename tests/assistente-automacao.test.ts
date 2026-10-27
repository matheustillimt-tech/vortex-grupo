import { describe, expect, it } from "vitest";
import {
  acoesValidasParaGatilho,
  gruposValidos,
  montarEntrada,
  passosDoAssistente,
  passosVisiveisAutomacao,
  proximoPassoVisivel,
  pendenciaDoPasso,
  podeIrPara,
  quandoIso,
  type EstadoAssistente,
} from "@/src/lib/regras/assistente-automacao";

const agora = new Date("2026-10-16T12:00:00Z"); // 09:00 em Brasília
const ctx = { ativosDaCampanha: ["g1", "g2"], agora };

const base: EstadoAssistente = {
  categoria: "campanha",
  campanhaId: "c1",
  gatilho: "cronograma",
  quando: "2026-10-16T10:00",
  todosGrupos: true,
  grupos: [],
  todasContas: true,
  contas: [],
  provedor: null,
  produto: "",
  acoes: [{ chave: "a", tipo: "abrir", conteudo: {}, atraso_min: 0 }],
  nome: "Abrir grupos",
  pasta: "",
};

describe("passosDoAssistente", () => {
  it("são sempre os mesmos 7 passos (Ruling 1: Grupo e Conexão sempre aparecem)", () => {
    expect(passosDoAssistente()).toEqual(["categoria", "campanha", "grupos", "gatilho", "contas", "acao", "confirmar"]);
  });
});

describe("passosVisiveisAutomacao (barra do topo, Etapa 3N)", () => {
  it("começa com Categoria, Grupos, Gatilho, Ação, Confirmar — sem nada escolhido (Grupos aparece enquanto o gatilho está em aberto, revisão final B item 5)", () => {
    expect(passosVisiveisAutomacao({ ...base, categoria: null, campanhaId: null, gatilho: null })).toEqual(["categoria", "grupos", "gatilho", "acao", "confirmar"]);
  });
  it("ganha Campanha depois da categoria 'campanha'", () => {
    expect(passosVisiveisAutomacao({ ...base, campanhaId: null, gatilho: null })).toEqual(["categoria", "campanha", "grupos", "gatilho", "acao", "confirmar"]);
  });
  it("ganha Conexões depois da campanha escolhida (Grupos continua, gatilho ainda não escolhido)", () => {
    expect(passosVisiveisAutomacao({ ...base, gatilho: null })).toEqual(passosDoAssistente());
  });
  it("Grupos continua visível com o gatilho 'cronograma' (os 7 completos) e some com outro gatilho escolhido", () => {
    expect(passosVisiveisAutomacao(base)).toEqual(passosDoAssistente());
    expect(passosVisiveisAutomacao({ ...base, gatilho: "entrou" })).toEqual(["categoria", "campanha", "gatilho", "contas", "acao", "confirmar"]);
  });

  it("?campanha= entra em 'grupos' com o gatilho ainda não escolhido: o passo aparece na barra, índice nunca -1 (revisão final B, item 5)", () => {
    const eCampanhaPreSelecionada: EstadoAssistente = { ...base, categoria: "campanha", campanhaId: "c1", gatilho: null };
    const exibidos = passosVisiveisAutomacao(eCampanhaPreSelecionada);
    expect(exibidos.indexOf("grupos")).toBeGreaterThanOrEqual(0);
  });
});

describe("quandoIso", () => {
  it("campo em Brasília vira ISO; vazio/inválido vira null", () => {
    expect(quandoIso("2026-10-16T10:00")).toBe("2026-10-16T13:00:00.000Z");
    expect(quandoIso("")).toBeNull();
    expect(quandoIso("16/10/2026")).toBeNull();
  });
});

describe("pendenciaDoPasso", () => {
  it("estado completo: nenhum passo pendente", () => {
    for (const p of passosDoAssistente()) expect(pendenciaDoPasso(p, base, ctx)).toBeNull();
  });
  it("categoria e campanha", () => {
    expect(pendenciaDoPasso("categoria", { ...base, categoria: null }, ctx)).toBe("Escolha a categoria.");
    expect(pendenciaDoPasso("campanha", { ...base, campanhaId: null }, ctx)).toBe("Escolha a campanha.");
  });
  it("gatilho: obrigatório; cronograma pede data futura", () => {
    expect(pendenciaDoPasso("gatilho", { ...base, gatilho: null }, ctx)).toBe("Escolha o gatilho.");
    expect(pendenciaDoPasso("gatilho", { ...base, quando: "" }, ctx)).toBe("Escolha a data e a hora do disparo.");
    expect(pendenciaDoPasso("gatilho", { ...base, quando: "2026-10-16T09:00" }, ctx)).toBe("Escolha uma data futura.");
    expect(pendenciaDoPasso("gatilho", { ...base, gatilho: "grupo_criado", quando: "" }, ctx)).toBeNull();
  });
  it("gatilho checkout: provedor null vale (qualquer plataforma); pede nome do produto", () => {
    expect(pendenciaDoPasso("gatilho", { ...base, gatilho: "checkout", provedor: null, produto: "" }, ctx)).toBe("Escreva o nome do produto.");
    expect(pendenciaDoPasso("gatilho", { ...base, gatilho: "checkout", provedor: null, produto: "Curso X" }, ctx)).toBeNull();
    expect(pendenciaDoPasso("gatilho", { ...base, gatilho: "checkout", provedor: "hotmart", produto: "  " }, ctx)).toBe("Escreva o nome do produto.");
    expect(pendenciaDoPasso("gatilho", { ...base, gatilho: "checkout", provedor: "hotmart", produto: "x".repeat(121) }, ctx)).toBe("Produto com até 120 caracteres.");
    expect(pendenciaDoPasso("gatilho", { ...base, gatilho: "checkout", provedor: "hotmart", produto: "Curso X" }, ctx)).toBeNull();
  });
  it("grupos: específicos precisam de pelo menos um ativo da campanha (cronograma)", () => {
    expect(pendenciaDoPasso("grupos", { ...base, todosGrupos: false, grupos: [] }, ctx)).toBe("Marque pelo menos um grupo.");
    expect(pendenciaDoPasso("grupos", { ...base, todosGrupos: false, grupos: ["outro"] }, ctx)).toBe("Marque pelo menos um grupo.");
    expect(pendenciaDoPasso("grupos", { ...base, todosGrupos: false, grupos: ["g2"] }, ctx)).toBeNull();
  });
  it("grupos: sem gatilho ainda escolhido, a escolha livre continua valendo", () => {
    expect(pendenciaDoPasso("grupos", { ...base, gatilho: null, todosGrupos: false, grupos: [] }, ctx)).toBe("Marque pelo menos um grupo.");
    expect(pendenciaDoPasso("grupos", { ...base, gatilho: null, todosGrupos: true }, ctx)).toBeNull();
  });
  it("grupos: fora do cronograma o passo nunca pende (o motor sempre usa 'todos')", () => {
    expect(pendenciaDoPasso("grupos", { ...base, gatilho: "grupo_cheio", todosGrupos: false, grupos: [] }, ctx)).toBeNull();
    expect(pendenciaDoPasso("grupos", { ...base, gatilho: "entrou", todosGrupos: false, grupos: [] }, ctx)).toBeNull();
  });
  it("conexões: específicas precisam de pelo menos uma marcada; vale em qualquer gatilho", () => {
    expect(pendenciaDoPasso("contas", { ...base, todasContas: false, contas: [] }, ctx)).toBe("Marque pelo menos uma conexão.");
    expect(pendenciaDoPasso("contas", { ...base, todasContas: false, contas: ["k1"] }, ctx)).toBeNull();
    expect(pendenciaDoPasso("contas", { ...base, todasContas: true, contas: [] }, ctx)).toBeNull();
    expect(pendenciaDoPasso("contas", { ...base, gatilho: "entrou", todasContas: false, contas: [] }, ctx)).toBe("Marque pelo menos uma conexão.");
  });
  it("ação: pelo menos uma, conteúdo válido e atraso de 0 a 1440", () => {
    expect(pendenciaDoPasso("acao", { ...base, acoes: [] }, ctx)).toBe("Adicione pelo menos uma ação.");
    expect(pendenciaDoPasso("acao", { ...base, acoes: [{ chave: "m", tipo: "mensagem", conteudo: { formato: "texto", texto: " " }, atraso_min: 0 }] }, ctx)).toBe("Ação 1: Escreva a mensagem.");
    expect(pendenciaDoPasso("acao", { ...base, acoes: [{ chave: "a", tipo: "abrir", conteudo: {}, atraso_min: 1441 }] }, ctx)).toBe("Ação 1: atraso entre 0 e 1440 minutos.");
    expect(pendenciaDoPasso("acao", { ...base, acoes: [{ chave: "a", tipo: "abrir", conteudo: {}, atraso_min: 1.5 }] }, ctx)).toBe("Ação 1: atraso entre 0 e 1440 minutos.");
  });
  it("ação remover_participante não tem conteúdo pra validar (só o atraso)", () => {
    expect(pendenciaDoPasso("acao", { ...base, acoes: [{ chave: "r", tipo: "remover_participante", conteudo: {}, atraso_min: 0 }] }, ctx)).toBeNull();
    expect(pendenciaDoPasso("acao", { ...base, acoes: [{ chave: "r", tipo: "remover_participante", conteudo: {}, atraso_min: 1441 }] }, ctx)).toBe("Ação 1: atraso entre 0 e 1440 minutos.");
  });
  it("ação tag_condicional: exige tag e tem/não tem", () => {
    expect(pendenciaDoPasso("acao", { ...base, gatilho: "entrou", acoes: [{ chave: "t", tipo: "tag_condicional", conteudo: {}, atraso_min: 0 }, { chave: "r", tipo: "remover_participante", conteudo: {}, atraso_min: 0 }] }, ctx)).toBe("Ação 1: Escolha a tag.");
    expect(
      pendenciaDoPasso(
        "acao",
        { ...base, gatilho: "entrou", acoes: [{ chave: "t", tipo: "tag_condicional", conteudo: { tag_id: "11111111-1111-1111-1111-111111111111", tem: true }, atraso_min: 0 }, { chave: "r", tipo: "remover_participante", conteudo: {}, atraso_min: 0 }] },
        ctx,
      ),
    ).toBeNull();
  });
  it("confirmar: nome de 1 a 80, pasta até 40", () => {
    expect(pendenciaDoPasso("confirmar", { ...base, nome: "  " }, ctx)).toBe("Dê um nome à automação.");
    expect(pendenciaDoPasso("confirmar", { ...base, nome: "x".repeat(81) }, ctx)).toBe("Nome com até 80 caracteres.");
    expect(pendenciaDoPasso("confirmar", { ...base, pasta: "p".repeat(41) }, ctx)).toBe("Pasta com até 40 caracteres.");
  });
});

describe("podeIrPara", () => {
  const passos = passosDoAssistente();
  it("só passo visitado com todos os anteriores completos", () => {
    const visitados = new Set(passos);
    expect(podeIrPara(6, passos, visitados, base, ctx)).toBe(true);
    expect(podeIrPara(6, passos, new Set(["categoria", "campanha"] as const), base, ctx)).toBe(false);
    expect(podeIrPara(6, passos, visitados, { ...base, todosGrupos: false }, ctx)).toBe(false);
    expect(podeIrPara(2, passos, visitados, { ...base, todosGrupos: false }, ctx)).toBe(true);
    expect(podeIrPara(3, passos, visitados, { ...base, todosGrupos: false }, ctx)).toBe(false);
    expect(podeIrPara(9, passos, visitados, base, ctx)).toBe(false);
  });
});

describe("acoesValidasParaGatilho", () => {
  it("tira as ações que não valem mais pro gatilho novo", () => {
    const acoes = [
      { chave: "a", tipo: "abrir" as const, conteudo: {}, atraso_min: 0 },
      { chave: "b", tipo: "mensagem" as const, conteudo: {}, atraso_min: 0 },
    ];
    expect(acoesValidasParaGatilho(acoes, "entrou")).toEqual([acoes[1]]);
    expect(acoesValidasParaGatilho(acoes, "saiu")).toEqual([]);
    expect(acoesValidasParaGatilho(acoes, "cronograma")).toEqual(acoes);
  });
});

describe("gruposValidos e montarEntrada", () => {
  it("tira grupos de fora da campanha ou desativados", () => {
    expect(gruposValidos({ ...base, grupos: ["g1", "x", "g2"] }, ["g1", "g2"])).toEqual(["g1", "g2"]);
  });
  it("cronograma com grupos e conexões específicos", () => {
    expect(montarEntrada({ ...base, todosGrupos: false, grupos: ["g1", "x"], todasContas: false, contas: ["k1", "k2"], pasta: "  Março " }, ["g1", "g2"])).toEqual({
      nome: "Abrir grupos",
      campanha_id: "c1",
      gatilho: "cronograma",
      quando: "2026-10-16T13:00:00.000Z",
      alvo_grupos: ["g1"],
      alvo_contas: ["k1", "k2"],
      pasta: "Março",
      provedor: null,
      produto: null,
      acoes: [{ tipo: "abrir", conteudo: {}, atraso_min: 0 }],
    });
  });
  it("cronograma pra todos: alvo nulo; evento de grupo: sem data nem alvo de grupos (mas alvo_contas vale)", () => {
    expect(montarEntrada(base, []).alvo_grupos).toBeNull();
    expect(montarEntrada(base, []).alvo_contas).toBeNull();
    const e = montarEntrada({ ...base, gatilho: "grupo_cheio", todosGrupos: false, grupos: ["g1"], todasContas: false, contas: ["k1"] }, ["g1"]);
    expect(e.quando).toBeNull();
    expect(e.alvo_grupos).toBeNull();
    expect(e.alvo_contas).toEqual(["k1"]);
    expect(e.pasta).toBeNull();
  });
  it("checkout: provedor e produto (aparados); outros gatilhos ficam nulos", () => {
    const e = montarEntrada(
      { ...base, gatilho: "checkout", provedor: "hotmart", produto: "  Curso X  ", acoes: [{ chave: "r", tipo: "remover_participante", conteudo: {}, atraso_min: 0 }] },
      [],
    );
    expect(e.provedor).toBe("hotmart");
    expect(e.produto).toBe("Curso X");
    expect(e.quando).toBeNull();
    expect(e.alvo_grupos).toBeNull();
    expect(montarEntrada(base, []).provedor).toBeNull();
    expect(montarEntrada(base, []).produto).toBeNull();
  });
});

describe("proximoPassoVisivel (PRÓXIMA segue a barra do topo, revisão final)", () => {
  it("gatilho fora do cronograma: de Campanha pula Grupos (escondido) e não para em passo sem destaque", () => {
    const e = { ...base, categoria: "campanha" as const, campanhaId: "c1", gatilho: "entrou" as const };
    const visiveis = passosVisiveisAutomacao(e);
    expect(visiveis).not.toContain("grupos");
    let p: ReturnType<typeof proximoPassoVisivel> = "categoria";
    const caminho: string[] = [];
    while ((p = proximoPassoVisivel(e, p!))) caminho.push(p);
    expect(caminho.every((x) => visiveis.includes(x as never))).toBe(true);
    expect(caminho.at(-1)).toBe("confirmar");
  });
  it("cronograma: Grupos continua no caminho", () => {
    const e = { ...base, categoria: "campanha" as const, campanhaId: "c1", gatilho: "cronograma" as const };
    expect(proximoPassoVisivel(e, "campanha")).toBe("grupos");
  });
  it("Confirmar é o último", () => {
    expect(proximoPassoVisivel(base, "confirmar")).toBeNull();
  });
});
