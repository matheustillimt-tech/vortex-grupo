import { describe, expect, it } from "vitest";
import { conteudoInicial, prioridadeDe, resumoConteudo, validarConteudo } from "@/src/lib/regras/conteudo";
import { nomeDoGrupo, nomeLongo, trocarN } from "@/src/lib/regras/nome-grupo";

describe("prioridadeDe", () => {
  it("mensagem e enquete antes (0), ações no grupo depois (1)", () => {
    expect(["nome", "descricao", "imagem", "abrir", "fechar", "admin_add", "admin_remover", "redefinir_link"].map((t) => prioridadeDe(t as never))).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    expect(prioridadeDe("mensagem")).toBe(0);
    expect(prioridadeDe("enquete")).toBe(0);
  });
});

describe("validarConteudo", () => {
  it("mensagem de texto exige texto e só texto menciona todos", () => {
    expect(validarConteudo("mensagem", { formato: "texto", texto: "  " })).toEqual({ ok: false, erro: "Escreva a mensagem." });
    expect(validarConteudo("mensagem", { formato: "texto", texto: "Oi", mencionar_todos: true })).toEqual({
      ok: true,
      valor: { formato: "texto", texto: "Oi", midia_url: null, nome_arquivo: null, mencionar_todos: true },
    });
    expect(validarConteudo("mensagem", { formato: "imagem", texto: "olha", midia_url: "https://x/i.jpg", mencionar_todos: true })).toEqual({
      ok: true,
      valor: { formato: "imagem", texto: "olha", midia_url: "https://x/i.jpg", nome_arquivo: null, mencionar_todos: false },
    });
  });

  it("mídia exige arquivo; áudio não tem legenda", () => {
    expect(validarConteudo("mensagem", { formato: "video", texto: "x" })).toEqual({ ok: false, erro: "Envie o arquivo." });
    expect(validarConteudo("mensagem", { formato: "audio", texto: "ignorado", midia_url: "https://x/a.ogg" })).toMatchObject({ ok: true, valor: { texto: "" } });
  });

  it("enquete: pergunta, 2 a 12 opções sem repetir, máximo de respostas", () => {
    expect(validarConteudo("enquete", { pergunta: "", opcoes: ["a", "b"], max_respostas: 1 })).toMatchObject({ ok: false });
    expect(validarConteudo("enquete", { pergunta: "Vem?", opcoes: ["Sim", " "], max_respostas: 1 })).toEqual({ ok: false, erro: "A enquete precisa de 2 a 12 opções." });
    expect(validarConteudo("enquete", { pergunta: "Vem?", opcoes: Array.from({ length: 13 }, (_, i) => `o${i}`), max_respostas: 1 })).toMatchObject({ ok: false });
    expect(validarConteudo("enquete", { pergunta: "Vem?", opcoes: ["Sim", "Sim"], max_respostas: 1 })).toEqual({ ok: false, erro: "As opções da enquete não podem se repetir." });
    expect(validarConteudo("enquete", { pergunta: "Vem?", opcoes: ["Sim", "Não"], max_respostas: 3 })).toEqual({ ok: false, erro: "O máximo de respostas vai de 1 a 2." });
    expect(validarConteudo("enquete", { pergunta: " Vem? ", opcoes: [" Sim", "Não "], max_respostas: 1 })).toEqual({
      ok: true,
      valor: { pergunta: "Vem?", opcoes: ["Sim", "Não"], max_respostas: 1 },
    });
  });

  it("nome, descrição e admin", () => {
    expect(validarConteudo("nome", { padrao: "  " })).toEqual({ ok: false, erro: "Escreva o novo nome." });
    expect(validarConteudo("descricao", { texto: "x".repeat(2049) })).toMatchObject({ ok: false });
    expect(validarConteudo("admin_add", { telefone: "(37) " + "98000-1001" })).toEqual({ ok: true, valor: { telefone: "5537" + "980001001" } });
    expect(validarConteudo("admin_remover", { telefone: "123" })).toMatchObject({ ok: false });
    expect(validarConteudo("abrir", { qualquer: 1 })).toEqual({ ok: true, valor: {} });
  });

  it("conteúdo inicial de cada tipo e resumo", () => {
    expect(conteudoInicial("enquete")).toEqual({ pergunta: "", opcoes: ["", ""], max_respostas: 1 });
    expect(resumoConteudo("mensagem", { formato: "imagem", texto: "" })).toBe("(imagem)");
    expect(resumoConteudo("nome", { padrao: "AO VIVO #{n}" })).toBe("AO VIVO #{n}");
    expect(resumoConteudo("fechar", {})).toBe("");
  });

  it("aceita o conteúdo migrado da Fase 1 (campos ausentes vieram como null, não como chave faltando)", () => {
    // Formato da migração 20261016120000_fase2a.sql: midia_url e nome_arquivo nulos quando não havia mídia.
    const migradoTexto = { formato: "texto", texto: "amanhã", midia_url: null, nome_arquivo: null, mencionar_todos: true };
    expect(validarConteudo("mensagem", migradoTexto)).toEqual({
      ok: true,
      valor: { formato: "texto", texto: "amanhã", midia_url: null, nome_arquivo: null, mencionar_todos: true },
    });

    const migradoDocumento = { formato: "documento", texto: "guia", midia_url: "https://x/a.pdf", nome_arquivo: "a.pdf", mencionar_todos: false };
    expect(validarConteudo("mensagem", migradoDocumento)).toEqual({ ok: true, valor: migradoDocumento });
  });

  it("mensagem v2 (versao: 2) é validada por validarConteudoV2", () => {
    const v2ok = { versao: 2, mensagens: [{ formato: "texto", texto: "Oi" }], opcoes: {} };
    expect(validarConteudo("mensagem", v2ok)).toMatchObject({ ok: true, valor: { versao: 2 } });

    const v2ruim = { versao: 2, mensagens: [], opcoes: {} };
    expect(validarConteudo("mensagem", v2ruim)).toEqual({ ok: false, erro: "De 1 a 10 mensagens por ação." });
  });

  it("configuracao: pelo menos um campo definido", () => {
    expect(validarConteudo("configuracao", {})).toEqual({ ok: false, erro: "Escolha ao menos uma configuração pra trocar." });
    expect(validarConteudo("configuracao", { so_admins_enviam: true })).toEqual({
      ok: true,
      valor: { so_admins_enviam: true, so_admins_editam: undefined, aprovacao_entrada: undefined, temporarias: undefined },
    });
  });

  it("configuracao: temporarias (Alterar grupos em lote, Etapa 3E) é uma troca explícita, até 'nao'", () => {
    expect(validarConteudo("configuracao", { temporarias: "24h" })).toEqual({
      ok: true,
      valor: { so_admins_enviam: undefined, so_admins_editam: undefined, aprovacao_entrada: undefined, temporarias: "24h" },
    });
    expect(validarConteudo("configuracao", { temporarias: "nao" })).toEqual({
      ok: true,
      valor: { so_admins_enviam: undefined, so_admins_editam: undefined, aprovacao_entrada: undefined, temporarias: "nao" },
    });
    expect(validarConteudo("configuracao", { temporarias: "99d" })).toEqual({ ok: false, erro: "Escolha ao menos uma configuração pra trocar." });
  });

  it("remover_participantes: 1 a 500 telefones válidos", () => {
    expect(validarConteudo("remover_participantes", { telefones: [] })).toEqual({ ok: false, erro: "Informe ao menos um telefone." });
    expect(validarConteudo("remover_participantes", { telefones: ["123"] })).toEqual({ ok: false, erro: "Telefone inválido na lista." });
    expect(validarConteudo("remover_participantes", { telefones: ["(37) " + "98000-1001"] })).toEqual({ ok: true, valor: { telefones: ["5537" + "980001001"] } });
  });

  it("mover_grupos: exige uuid da campanha destino", () => {
    expect(validarConteudo("mover_grupos", { campanha_destino: "não-é-uuid" })).toEqual({ ok: false, erro: "Escolha a campanha de destino." });
    const uuid = "11111111-1111-1111-1111-111111111111";
    expect(validarConteudo("mover_grupos", { campanha_destino: uuid })).toEqual({ ok: true, valor: { campanha_destino: uuid } });
  });

  it("desativar_comunidade e atualizar_links: sem conteúdo", () => {
    expect(validarConteudo("desativar_comunidade", {})).toEqual({ ok: true, valor: {} });
    expect(validarConteudo("atualizar_links", {})).toEqual({ ok: true, valor: {} });
  });

  it("conteudoInicial dos tipos novos", () => {
    expect(conteudoInicial("remover_participantes")).toEqual({ telefones: [] });
    expect(conteudoInicial("mover_grupos")).toEqual({ campanha_destino: "" });
    expect(conteudoInicial("configuracao")).toEqual({});
    expect(conteudoInicial("desativar_comunidade")).toEqual({});
    expect(conteudoInicial("atualizar_links")).toEqual({});
  });
});

describe("nome com {n}", () => {
  it("trocarN não acrescenta número quando o padrão não tem {n}", () => {
    expect(trocarN("AO VIVO #{n}", 3)).toBe("AO VIVO #03");
    expect(trocarN("Começa às 20h", 3)).toBe("Começa às 20h");
  });
  it("nomeDoGrupo continua igual à Fase 1", () => {
    expect(nomeDoGrupo("Aulão", 3)).toBe("Aulão 03");
    expect(nomeDoGrupo("COMO FAÇO 100 MIL MENSAL #{n}", 7)).toHaveLength(25);
  });
  it("nomeLongo acha o primeiro nome acima de 25 caracteres depois de preencher", () => {
    expect(nomeLongo("🔴 AO VIVO #{n}", [1, 2, 120])).toBeNull();
    expect(nomeLongo("AULA AO VIVO AGORA GRUPO {n}", [1, 2])).toBe("AULA AO VIVO AGORA GRUPO 01");
    expect(nomeLongo("1234567890123456789012 {n}", [9, 100])).toBe("1234567890123456789012 100");
  });
});
