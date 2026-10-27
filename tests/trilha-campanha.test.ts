import { describe, expect, it } from "vitest";
import { ABAS_CAMPANHA, abaDaCampanha, fotoNaTrilha, trilhaCampanha, trilhaConta } from "@/src/lib/regras/topo";

describe("ABAS_CAMPANHA", () => {
  it("só as abas que já existem, na ordem final", () => {
    expect(ABAS_CAMPANHA.map((a) => a.rotulo)).toEqual([
      "Visão geral",
      "Conexões associadas",
      "Diagnósticos",
      "Grupos",
      "Solicitações de entrada",
      "Atividades",
      "Clicks",
      "Leadscoring",
      "Desempenho por grupo",
      "Mensagens",
      "Calendário",
      "Automações",
      "Ações",
    ]);
  });
});

describe("abaDaCampanha", () => {
  it.each([
    ["/campanhas/abc", "Visão geral"],
    ["/campanhas/abc/contas", "Conexões associadas"],
    ["/campanhas/abc/diagnosticos", "Diagnósticos"],
    ["/campanhas/abc/grupos", "Grupos"],
    ["/campanhas/abc/grupos/importar", "Importar"],
    ["/campanhas/abc/solicitacoes", "Solicitações de entrada"],
    ["/campanhas/abc/solicitacoes/processadas", "Solicitações de entrada"],
    ["/campanhas/abc/solicitacoes/configuracoes", "Solicitações de entrada"],
    ["/campanhas/abc/atividades", "Atividades"],
    ["/campanhas/abc/cliques", "Clicks"],
    ["/campanhas/abc/mensagens/xyz", "Mensagens"],
    ["/campanhas/abc/calendario", "Calendário"],
    ["/campanhas/abc/configuracoes", "Configurações"],
    ["/campanhas/abc/leadscoring", "Leadscoring"],
    ["/campanhas/abc/desempenho", "Desempenho por grupo"],
    ["/campanhas/abc/qualquer", "Visão geral"],
  ])("%s → %s", (caminho, aba) => {
    expect(abaDaCampanha(caminho, "abc")).toBe(aba);
  });
});

describe("trilhaCampanha", () => {
  const campanhas = [{ id: "abc", nome: "Aulão" }];

  it("monta Campanhas › nome › aba quando a campanha está na lista", () => {
    expect(trilhaCampanha("/campanhas/abc/grupos", campanhas)).toEqual([
      { rotulo: "Campanhas", href: "/campanhas" },
      { rotulo: "Aulão", href: "/campanhas/abc", avatar: true },
      { rotulo: "Grupos" },
    ]);
  });

  it("fotoNaTrilha: copia a foto do item de mesmo href que a página definiu (Etapa 3M)", () => {
    const base = trilhaCampanha("/campanhas/abc/grupos", campanhas)!;
    const foto = "https://pps.whatsapp.net/x.jpg";
    expect(fotoNaTrilha(base, null)).toBe(base);
    expect(fotoNaTrilha(base, [{ rotulo: "Aulão", href: "/campanhas/abc", avatar: true, foto }])[1]).toEqual({ rotulo: "Aulão", href: "/campanhas/abc", avatar: true, foto });
    expect(fotoNaTrilha(base, [{ rotulo: "Outra", href: "/campanhas/outra", avatar: true, foto }])).toEqual(base);
    expect(fotoNaTrilha(base, [{ rotulo: "Aulão", href: "/campanhas/abc", avatar: true, foto: null }])).toEqual(base);
  });

  it("devolve null fora de /campanhas/{id} (sem flash falso em outras telas)", () => {
    expect(trilhaCampanha("/calendario", campanhas)).toBeNull();
    expect(trilhaCampanha("/campanhas", campanhas)).toBeNull();
  });

  it("devolve null quando a campanha não está na lista (ex.: arquivada) — quem chama cai no contexto", () => {
    expect(trilhaCampanha("/campanhas/outra-id", campanhas)).toBeNull();
  });
});

describe("trilhaConta", () => {
  const contas = [{ id: "abc", nome: "Captação 01" }];

  it("monta Conexões › nome quando a conexão está na lista (sem aba: o Topo só vê o pathname)", () => {
    expect(trilhaConta("/numeros/abc", contas)).toEqual([
      { rotulo: "Conexões", href: "/numeros" },
      { rotulo: "Captação 01" },
    ]);
  });

  it("monta igual com querystring no caminho (pathname do Next não traz ?aba=, mas não deve quebrar)", () => {
    expect(trilhaConta("/numeros/abc?aba=campanhas", contas)).toEqual([
      { rotulo: "Conexões", href: "/numeros" },
      { rotulo: "Captação 01" },
    ]);
  });

  it("devolve null fora de /numeros/{id}", () => {
    expect(trilhaConta("/numeros", contas)).toBeNull();
    expect(trilhaConta("/calendario", contas)).toBeNull();
  });

  it("devolve null quando a conexão não está na lista — quem chama cai no contexto (DefinirTrilha)", () => {
    expect(trilhaConta("/numeros/outra-id", contas)).toBeNull();
  });
});
