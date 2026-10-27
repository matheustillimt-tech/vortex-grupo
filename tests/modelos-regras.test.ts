import { describe, expect, it } from "vitest";
import { filtrarModelos, nomeDaCopia, pastasDe, urlsDeMidia, validarPasta, type ModeloLista } from "@/src/lib/regras/modelos";

function modelo(p: Partial<ModeloLista> & { id: string }): ModeloLista {
  return {
    nome: "m",
    tipo: "mensagem",
    conteudo: {},
    pasta: null,
    arquivado: false,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    ...p,
  };
}

describe("pastasDe", () => {
  it("só conexão modelos não arquivados, ordem alfabética pt-BR", () => {
    const lista: ModeloLista[] = [
      modelo({ id: "1", pasta: "Zebra" }),
      modelo({ id: "2", pasta: "Ávila" }),
      modelo({ id: "3", pasta: "Ávila" }),
      modelo({ id: "4", pasta: "Zebra", arquivado: true }),
      modelo({ id: "5", pasta: null }),
      modelo({ id: "6", pasta: "Ágape", arquivado: true }),
    ];
    expect(pastasDe(lista)).toEqual([
      { nome: "Ávila", total: 2 },
      { nome: "Zebra", total: 1 },
    ]);
  });

  it("lista vazia dá pastas vazias", () => {
    expect(pastasDe([])).toEqual([]);
  });
});

describe("filtrarModelos", () => {
  const lista: ModeloLista[] = [
    modelo({ id: "1", nome: "Cupom VIP", pasta: "Promoções", updated_at: "2026-10-10T00:00:00Z" }),
    modelo({ id: "2", nome: "Lembrete", pasta: "Promoções", updated_at: "2026-10-12T00:00:00Z" }),
    modelo({ id: "3", nome: "Alô mundo", pasta: null, updated_at: "2026-10-11T00:00:00Z" }),
    modelo({ id: "4", nome: "Arquivado", pasta: "Promoções", arquivado: true, updated_at: "2026-10-15T00:00:00Z" }),
  ];

  it("sem filtro: só os não arquivados", () => {
    expect(filtrarModelos(lista, { busca: "", pasta: null, ordem: "nome", arquivados: false }).map((m) => m.id)).toEqual(["3", "1", "2"]);
  });

  it("arquivados: true mostra só os arquivados", () => {
    expect(filtrarModelos(lista, { busca: "", pasta: null, ordem: "nome", arquivados: true }).map((m) => m.id)).toEqual(["4"]);
  });

  it("filtra por pasta", () => {
    expect(filtrarModelos(lista, { busca: "", pasta: "Promoções", ordem: "nome", arquivados: false }).map((m) => m.id)).toEqual(["1", "2"]);
  });

  it("busca sem acento no nome", () => {
    expect(filtrarModelos(lista, { busca: "alo", pasta: null, ordem: "nome", arquivados: false }).map((m) => m.id)).toEqual(["3"]);
  });

  it("ordena por atualização (mais recente primeiro)", () => {
    expect(filtrarModelos(lista, { busca: "", pasta: null, ordem: "atualizacao", arquivados: false }).map((m) => m.id)).toEqual(["2", "3", "1"]);
  });

  it("ordena por criação (mais recente primeiro) — 'Posição' é por nome, já testado acima", () => {
    const comCriacao: ModeloLista[] = [
      modelo({ id: "a", nome: "A", created_at: "2026-10-05T00:00:00Z" }),
      modelo({ id: "b", nome: "B", created_at: "2026-10-07T00:00:00Z" }),
      modelo({ id: "c", nome: "C", created_at: "2026-10-01T00:00:00Z" }),
    ];
    expect(filtrarModelos(comCriacao, { busca: "", pasta: null, ordem: "criacao", arquivados: false }).map((m) => m.id)).toEqual(["b", "a", "c"]);
  });

  it("arquivados ficam fora de qualquer pasta quando arquivados: false", () => {
    expect(filtrarModelos(lista, { busca: "", pasta: "Promoções", ordem: "nome", arquivados: false }).some((m) => m.arquivado)).toBe(false);
  });
});

describe("urlsDeMidia", () => {
  it("extrai o midia_url de cada mensagem (v2) com mídia, sem repetir", () => {
    const conteudo = {
      versao: 2,
      mensagens: [
        { formato: "texto", texto: "Oi" },
        { formato: "imagem", midia_url: "https://a.com/1.png", nome_arquivo: null, legenda: "" },
        { formato: "video", midia_url: "https://a.com/1.png", nome_arquivo: null, legenda: "" },
        { formato: "documento", midia_url: "https://a.com/2.pdf", nome_arquivo: null, legenda: "" },
        { formato: "contato", contato: { nome: "x", telefone: "y" } },
      ],
      opcoes: {},
    };
    expect(urlsDeMidia(conteudo)).toEqual(["https://a.com/1.png", "https://a.com/2.pdf"]);
  });

  it("conteúdo v1 (antigo) de mídia também entra, convertido por paraV2", () => {
    expect(urlsDeMidia({ formato: "imagem", midia_url: "https://a.com/x.png", nome_arquivo: null, texto: "" })).toEqual(["https://a.com/x.png"]);
  });

  it("sem mídia (texto, enquete, formato desconhecido) dá lista vazia", () => {
    expect(urlsDeMidia({ versao: 2, mensagens: [{ formato: "texto", texto: "Oi" }], opcoes: {} })).toEqual([]);
    expect(urlsDeMidia(null)).toEqual([]);
  });
});

describe("validarPasta", () => {
  it("recusa vazia (após trim)", () => {
    expect(validarPasta("   ")).toEqual({ ok: false, erro: "Nome da pasta com 1 a 40 caracteres." });
  });

  it("recusa maior que 40", () => {
    expect(validarPasta("a".repeat(41))).toEqual({ ok: false, erro: "Nome da pasta com 1 a 40 caracteres." });
  });

  it("aceita 1 a 40 e aplica trim", () => {
    expect(validarPasta("  Promoções  ")).toEqual({ ok: true, nome: "Promoções" });
    expect(validarPasta("a".repeat(40))).toEqual({ ok: true, nome: "a".repeat(40) });
  });
});

describe("nomeDaCopia", () => {
  it("acrescenta (cópia)", () => {
    expect(nomeDaCopia("Cupom VIP")).toBe("Cupom VIP (cópia)");
  });

  it("corta o nome original pra caber em 60 com o sufixo", () => {
    const nome = "x".repeat(60);
    const copia = nomeDaCopia(nome);
    expect(copia.length).toBe(60);
    expect(copia.endsWith(" (cópia)")).toBe(true);
  });

  it("não parte emoji no corte (conexão por letra, não por unidade UTF-16)", () => {
    const nome = `${"x".repeat(51)}😀resto`;
    const copia = nomeDaCopia(nome);
    expect(copia).toBe(`${"x".repeat(51)}😀 (cópia)`);
    expect(Array.from(copia)).toHaveLength(60);
    expect(copia).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
});
