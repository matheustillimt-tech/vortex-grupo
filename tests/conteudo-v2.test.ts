import { describe, expect, it } from "vitest";
import { OPCOES_ENVIO_PADRAO, paraV2, segundosEntreGrupos, textoComMencao, validarConteudoV2 } from "@/src/lib/regras/conteudo-v2";

describe("paraV2", () => {
  it("mensagem de texto antiga vira v2 com mencionar_todos nas opções", () => {
    const antigo = { formato: "texto", texto: "Oi gente", midia_url: null, nome_arquivo: null, mencionar_todos: true };
    expect(paraV2(antigo)).toEqual({
      versao: 2,
      mensagens: [{ formato: "texto", texto: "Oi gente" }],
      opcoes: { ...OPCOES_ENVIO_PADRAO, mencionar_todos: true },
    });
  });

  it("mensagem de mídia antiga vira v2 com legenda", () => {
    const antigo = { formato: "imagem", texto: "legenda aqui", midia_url: "https://x/a.jpg", nome_arquivo: "a.jpg", mencionar_todos: false };
    expect(paraV2(antigo)).toEqual({
      versao: 2,
      mensagens: [{ formato: "imagem", midia_url: "https://x/a.jpg", nome_arquivo: "a.jpg", legenda: "legenda aqui" }],
      opcoes: OPCOES_ENVIO_PADRAO,
    });
  });

  it("enquete antiga vira v2 com uma mensagem formato enquete", () => {
    const antiga = { pergunta: "Vem?", opcoes: ["Sim", "Não"], max_respostas: 1 };
    expect(paraV2(antiga)).toEqual({
      versao: 2,
      mensagens: [{ formato: "enquete", enquete: { pergunta: "Vem?", opcoes: ["Sim", "Não"], max_respostas: 1 } }],
      opcoes: OPCOES_ENVIO_PADRAO,
    });
  });

  it("conteúdo já v2 passa direto, sem revalidar", () => {
    const v2 = { versao: 2, mensagens: [{ formato: "texto", texto: "x" }], opcoes: OPCOES_ENVIO_PADRAO };
    expect(paraV2(v2)).toBe(v2);
  });
});

describe("validarConteudoV2", () => {
  const base = { opcoes: {} };

  it("exige de 1 a 10 mensagens", () => {
    expect(validarConteudoV2({ mensagens: [], ...base })).toEqual({ ok: false, erro: "De 1 a 10 mensagens por ação." });
    const onze = Array.from({ length: 11 }, () => ({ formato: "texto", texto: "x" }));
    expect(validarConteudoV2({ mensagens: onze, ...base })).toMatchObject({ ok: false });
  });

  it("texto: exige texto não vazio, até 4096 caracteres", () => {
    expect(validarConteudoV2({ mensagens: [{ formato: "texto", texto: "  " }], ...base })).toEqual({ ok: false, erro: "Mensagem 1: escreva o texto." });
    expect(validarConteudoV2({ mensagens: [{ formato: "texto", texto: "x".repeat(4097) }], ...base })).toMatchObject({ ok: false });
    const r = validarConteudoV2({ mensagens: [{ formato: "texto", texto: "Oi" }], ...base });
    expect(r).toMatchObject({ ok: true, valor: { mensagens: [{ formato: "texto", texto: "Oi" }] } });
  });

  it("mídia: exige URL https e legenda até 1024", () => {
    expect(validarConteudoV2({ mensagens: [{ formato: "imagem", midia_url: "http://x/a.jpg" }], ...base })).toEqual({
      ok: false,
      erro: "Mensagem 1: envie o arquivo (URL https).",
    });
    expect(validarConteudoV2({ mensagens: [{ formato: "video", midia_url: "https://x/a.mp4", legenda: "x".repeat(1025) }], ...base })).toMatchObject({ ok: false });
    const r = validarConteudoV2({ mensagens: [{ formato: "gif", midia_url: "https://x/a.gif" }], ...base });
    expect(r).toEqual({ ok: true, valor: { versao: 2, mensagens: [{ formato: "gif", midia_url: "https://x/a.gif", nome_arquivo: null, legenda: "" }], opcoes: OPCOES_ENVIO_PADRAO } });
  });

  it("contato: nome e telefone válido via normalizarTelefone", () => {
    expect(validarConteudoV2({ mensagens: [{ formato: "contato", contato: { nome: "", telefone: "123" } }], ...base })).toEqual({
      ok: false,
      erro: "Mensagem 1: escreva o nome do contato.",
    });
    expect(validarConteudoV2({ mensagens: [{ formato: "contato", contato: { nome: "Zé", telefone: "123" } }], ...base })).toEqual({
      ok: false,
      erro: "Mensagem 1: telefone do contato inválido.",
    });
    const r = validarConteudoV2({ mensagens: [{ formato: "contato", contato: { nome: "Zé", telefone: "(37) " + "98000-1001" } }], ...base });
    expect(r).toMatchObject({ ok: true, valor: { mensagens: [{ formato: "contato", contato: { nome: "Zé", telefone: "5537" + "980001001" } }] } });
  });

  it("evento: nome e data de início ISO; fim opcional", () => {
    expect(validarConteudoV2({ mensagens: [{ formato: "evento", evento: { nome: "", inicio: "2026-10-20T20:00:00Z" } }], ...base })).toEqual({
      ok: false,
      erro: "Mensagem 1: escreva o nome do evento.",
    });
    expect(validarConteudoV2({ mensagens: [{ formato: "evento", evento: { nome: "Live", inicio: "não é data" } }], ...base })).toEqual({
      ok: false,
      erro: "Mensagem 1: data de início do evento inválida.",
    });
    expect(validarConteudoV2({ mensagens: [{ formato: "evento", evento: { nome: "Live", inicio: "2026-10-20T20:00:00Z", fim: "lixo" } }], ...base })).toEqual({
      ok: false,
      erro: "Mensagem 1: data de fim do evento inválida.",
    });
    const r = validarConteudoV2({ mensagens: [{ formato: "evento", evento: { nome: "Live", inicio: "2026-10-20T20:00:00Z" } }], ...base });
    expect(r).toMatchObject({ ok: true, valor: { mensagens: [{ formato: "evento", evento: { nome: "Live", descricao: null, inicio: "2026-10-20T20:00:00Z", fim: null, local: null } }] } });
  });

  it("botões: até 3, tipo válido, rótulo e valor; link exige https", () => {
    expect(validarConteudoV2({ mensagens: [{ formato: "botoes", texto: "Escolha", botoes: [] }], ...base })).toEqual({
      ok: false,
      erro: "Mensagem 1: de 1 a 3 botões.",
    });
    const quatro = Array.from({ length: 4 }, () => ({ tipo: "resposta", rotulo: "a", valor: "b" }));
    expect(validarConteudoV2({ mensagens: [{ formato: "botoes", texto: "Escolha", botoes: quatro }], ...base })).toMatchObject({ ok: false });
    expect(
      validarConteudoV2({ mensagens: [{ formato: "botoes", texto: "Veja", botoes: [{ tipo: "link", rotulo: "Site", valor: "http://x" }] }], ...base }),
    ).toEqual({ ok: false, erro: "Mensagem 1: o link do botão precisa ser https." });
    const r = validarConteudoV2({ mensagens: [{ formato: "botoes", texto: "Veja", botoes: [{ tipo: "link", rotulo: "Site", valor: "https://x" }] }], ...base });
    expect(r).toMatchObject({ ok: true, valor: { mensagens: [{ formato: "botoes", texto: "Veja", botoes: [{ tipo: "link", rotulo: "Site", valor: "https://x" }] }] } });
  });

  it("enquete: pergunta, 2 a 12 opções sem repetir, máximo de respostas", () => {
    expect(validarConteudoV2({ mensagens: [{ formato: "enquete", enquete: { pergunta: "", opcoes: ["a", "b"], max_respostas: 1 } }], ...base })).toEqual({
      ok: false,
      erro: "Mensagem 1: escreva a pergunta da enquete.",
    });
    expect(
      validarConteudoV2({ mensagens: [{ formato: "enquete", enquete: { pergunta: "Vem?", opcoes: ["Sim", "Sim"], max_respostas: 1 } }], ...base }),
    ).toEqual({ ok: false, erro: "Mensagem 1: as opções da enquete não podem se repetir." });
    const r = validarConteudoV2({ mensagens: [{ formato: "enquete", enquete: { pergunta: "Vem?", opcoes: ["Sim", "Não"], max_respostas: 1 } }], ...base });
    expect(r).toMatchObject({ ok: true });
  });

  it("várias mensagens na mesma ação (1 a 10)", () => {
    const mensagens = [{ formato: "texto", texto: "Oi" }, { formato: "texto", texto: "Tudo bem?" }];
    const r = validarConteudoV2({ mensagens, ...base });
    expect(r).toMatchObject({ ok: true, valor: { mensagens } });
  });

  it("opções de envio: valores padrão e validação de cada campo", () => {
    expect(validarConteudoV2({ mensagens: [{ formato: "texto", texto: "x" }], opcoes: { temporarias: "lixo" } })).toEqual({
      ok: false,
      erro: "Opção de mensagens temporárias inválida.",
    });
    expect(validarConteudoV2({ mensagens: [{ formato: "texto", texto: "x" }], opcoes: { fixar: "lixo" } })).toEqual({
      ok: false,
      erro: "Opção de fixar mensagem inválida.",
    });
    expect(validarConteudoV2({ mensagens: [{ formato: "texto", texto: "x" }], opcoes: { intervalo_grupos: "lixo" } })).toEqual({
      ok: false,
      erro: "Intervalo de envio entre grupos inválido.",
    });
    expect(validarConteudoV2({ mensagens: [{ formato: "texto", texto: "x" }], opcoes: { intervalo_grupos: { segundos: 9999 } } })).toEqual({
      ok: false,
      erro: "O intervalo customizado vai de 1 a 600 segundos.",
    });
    const r = validarConteudoV2({
      mensagens: [{ formato: "texto", texto: "x" }],
      opcoes: { mencionar_todos: true, temporarias: "24h", fixar: "7d", intervalo_grupos: "normal", intervalo_mensagens: true },
    });
    expect(r).toEqual({
      ok: true,
      valor: {
        versao: 2,
        mensagens: [{ formato: "texto", texto: "x" }],
        opcoes: { mencionar_todos: true, temporarias: "24h", fixar: "7d", intervalo_grupos: "normal", intervalo_mensagens: true },
      },
    });
  });

  it("sem opções, usa os padrões (nenhuma marcada)", () => {
    const r = validarConteudoV2({ mensagens: [{ formato: "texto", texto: "x" }] });
    expect(r).toEqual({ ok: true, valor: { versao: 2, mensagens: [{ formato: "texto", texto: "x" }], opcoes: OPCOES_ENVIO_PADRAO } });
  });
});

describe("segundosEntreGrupos", () => {
  it("'nao' é null (espaçamento atual do sistema)", () => {
    expect(segundosEntreGrupos("nao")).toBeNull();
  });

  it("rápida 2-4s, normal 5-10s, lenta 15-30s", () => {
    expect(segundosEntreGrupos("rapida")).toEqual({ min: 3, max: 8 });
    expect(segundosEntreGrupos("normal")).toEqual({ min: 5, max: 10 });
    expect(segundosEntreGrupos("lenta")).toEqual({ min: 15, max: 30 });
  });

  it("custom é fixo, travado entre 1 e 600s", () => {
    expect(segundosEntreGrupos({ segundos: 42 })).toEqual({ min: 42, max: 42 });
    expect(segundosEntreGrupos({ segundos: 0 })).toEqual({ min: 1, max: 1 });
    expect(segundosEntreGrupos({ segundos: 9999 })).toEqual({ min: 600, max: 600 });
  });
});

describe("textoComMencao", () => {
  it("acrescenta @all quando marca todos", () => {
    expect(textoComMencao("Oi gente", true)).toBe("Oi gente @all");
    expect(textoComMencao("Oi gente", false)).toBe("Oi gente");
  });
});

describe("botão de copiar (Etapa 3C, correção)", () => {
  it("fica bloqueado até ser testado no Zapbot", async () => {
    const { validarConteudoV2, TIPOS_BOTAO_DISPONIVEIS } = await import("@/src/lib/regras/conteudo-v2");
    const r = validarConteudoV2({ versao: 2, mensagens: [{ formato: "botoes", texto: "Oi", botoes: [{ tipo: "copiar", rotulo: "Cupom", valor: "X" }] }], opcoes: {} });
    expect(r).toEqual({ ok: false, erro: "Botão de copiar ainda não está disponível." });
    expect(TIPOS_BOTAO_DISPONIVEIS).not.toContain("copiar");
  });
});
