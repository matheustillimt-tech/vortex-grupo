import { describe, expect, it } from "vitest";
import {
  acoesPermitidas,
  bucket10min,
  linhasCheckout,
  linhasEntrou,
  linhasSaiu,
  rodadaSuspeita,
  validarAutomacao,
  type EntradaAutomacao,
} from "@/src/lib/regras/automacoes";

const agora = new Date("2026-10-16T12:07:30Z");
const CAMP = "11111111-1111-4111-8111-111111111111";
const base: EntradaAutomacao = {
  nome: "Boas-vindas",
  campanha_id: CAMP,
  gatilho: "entrou",
  quando: null,
  alvo_grupos: null,
  pasta: null,
  provedor: null,
  produto: null,
  acoes: [{ tipo: "remover_participante", conteudo: {}, atraso_min: 0 }],
};

describe("acoesPermitidas", () => {
  it("cronograma: as 9 ações de grupo + as 4 da Etapa 3C; grupo cheio sem desativar comunidade; grupo criado sem ela e sem mover grupos", () => {
    const nove = ["mensagem", "enquete", "nome", "descricao", "abrir", "fechar", "admin_add", "admin_remover", "redefinir_link"];
    // "Atualizar foto do grupo" (Etapa 3M) é ação de grupo: entra nos três.
    expect(acoesPermitidas("cronograma")).toEqual([...nove, "configuracao", "atualizar_links", "desativar_comunidade", "mover_grupos", "imagem"]);
    expect(acoesPermitidas("grupo_cheio")).toEqual([...nove, "configuracao", "atualizar_links", "mover_grupos", "imagem"]);
    expect(acoesPermitidas("grupo_criado")).toEqual([...nove, "configuracao", "atualizar_links", "imagem"]);
  });
  it("entrou: mensagem, Tag Condicional, Remover Lead e as ações de pessoa (Etapa 3J)", () => {
    expect(acoesPermitidas("entrou")).toEqual(["mensagem", "tag_condicional", "remover_participante", "adicionar_tag", "remover_tag", "adicionar_blacklist", "remover_blacklist"]);
  });
  it("saiu e checkout: as mesmas sem mensagem", () => {
    const semMensagem = ["tag_condicional", "remover_participante", "adicionar_tag", "remover_tag", "adicionar_blacklist", "remover_blacklist"];
    expect(acoesPermitidas("saiu")).toEqual(semMensagem);
    expect(acoesPermitidas("checkout")).toEqual(semMensagem);
  });
});

describe("validarAutomacao: checkout", () => {
  const checkoutBase: EntradaAutomacao = { ...base, gatilho: "checkout" };
  it("aceita provedor válido e apara o produto", () => {
    const r = validarAutomacao({ ...checkoutBase, provedor: "hotmart", produto: " Formação " }, agora);
    expect(r).toEqual({ ok: true, valor: { ...checkoutBase, provedor: "hotmart", produto: "Formação", alvo_contas: null, checkout_evento: "aprovada" } });
  });
  it("sem provedor: qualquer plataforma (Etapa 3F)", () => {
    for (const provedor of [null, ""]) {
      const r = validarAutomacao({ ...checkoutBase, provedor, produto: "Formação" }, agora);
      expect(r).toEqual({ ok: true, valor: { ...checkoutBase, provedor: null, produto: "Formação", alvo_contas: null, checkout_evento: "aprovada" } });
    }
  });
  it("provedor fora de PROVEDORES: recusa", () => {
    const r = validarAutomacao({ ...checkoutBase, provedor: "stripe", produto: "Formação" }, agora);
    expect(r).toEqual({ ok: false, erro: "Escolha o checkout." });
  });
  it("sem produto: recusa", () => {
    const r = validarAutomacao({ ...checkoutBase, provedor: "hotmart", produto: "  " }, agora);
    expect(r).toEqual({ ok: false, erro: "Escreva o nome do produto." });
  });
  it("produto maior que 120 caracteres: recusa", () => {
    const r = validarAutomacao({ ...checkoutBase, provedor: "hotmart", produto: "x".repeat(121) }, agora);
    expect(r).toEqual({ ok: false, erro: "Escreva o nome do produto." });
  });
});

describe("validarAutomacao: ações por gatilho", () => {
  it("remover_participante com conteúdo {} é aceito (sem validarConteudo)", () => {
    const r = validarAutomacao(base, agora);
    expect(r).toEqual({ ok: true, valor: { ...base, alvo_contas: null, checkout_evento: null } });
  });
  it("ação não permitida pro gatilho recusa", () => {
    const r = validarAutomacao({ ...base, acoes: [{ tipo: "mensagem", conteudo: { formato: "texto", texto: "oi" }, atraso_min: 0 }, { tipo: "nome", conteudo: { padrao: "x" }, atraso_min: 0 }] }, agora);
    expect(r).toEqual({ ok: false, erro: "Ação 2: não vale para este gatilho." });
  });
  it("provedor/produto são zerados em gatilhos que não são checkout", () => {
    const r = validarAutomacao({ ...base, gatilho: "entrou", provedor: "hotmart", produto: "Formação" }, agora);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.valor.provedor).toBeNull();
      expect(r.valor.produto).toBeNull();
    }
  });
});

describe("bucket10min", () => {
  it("ISO do início do bloco de 10 minutos", () => {
    expect(bucket10min(new Date("2026-10-16T12:07:30Z"))).toBe("2026-10-16T12:00:00.000Z");
  });
});

describe("linhasEntrou", () => {
  const acoes = [
    { id: "x1", tipo: "mensagem" as const, conteudo: { formato: "texto" as const, texto: "oi", midia_url: null, nome_arquivo: null, mencionar_todos: false }, atraso_min: 0 },
    { id: "x2", tipo: "remover_participante" as const, conteudo: {}, atraso_min: 5 },
  ];
  it("uma execução de mensagem pro grupo + uma remoção por telefone", () => {
    const r = linhasEntrou({ id: "a1", campanha_id: "c1" }, acoes, "g1", ["5511" + "900000001", "5511" + "900000002"], agora);
    expect(r.execucoes).toEqual([
      {
        campanha_id: "c1", origem: "automacao", tipo: "mensagem", conteudo: acoes[0].conteudo, alvo_grupos: ["g1"], alvo_contas: null,
        agendada_para: agora.toISOString(), automacao_id: "a1", automacao_acao_id: "x1", gatilho_chave: "g1:2026-10-16T12:00:00.000Z",
      },
    ]);
    expect(r.remocoes).toEqual([
      {
        tipo: "remover", campanha_id: "c1", grupo_id: "g1", telefone: "5511" + "900000001", origem: "automacao",
        executar_apos: new Date(agora.getTime() + 5 * 60_000).toISOString(), automacao_id: "a1", automacao_acao_id: "x2", gatilho_chave: "g1:5511" + "900000001:2026-10-16T12:07:30.000Z",
      },
      {
        tipo: "remover", campanha_id: "c1", grupo_id: "g1", telefone: "5511" + "900000002", origem: "automacao",
        executar_apos: new Date(agora.getTime() + 5 * 60_000).toISOString(), automacao_id: "a1", automacao_acao_id: "x2", gatilho_chave: "g1:5511" + "900000002:2026-10-16T12:07:30.000Z",
      },
    ]);
  });
});

describe("linhasSaiu", () => {
  it("uma remoção por outra participação, chave com origem/telefone/destino", () => {
    const acoes = [{ id: "x1", tipo: "remover_participante" as const, conteudo: {}, atraso_min: 0 }];
    const r = linhasSaiu({ id: "a1", campanha_id: "c1" }, acoes, "5511" + "900000001", [{ grupoId: "g2", telefone: "5511" + "900000001" }, { grupoId: "g3", telefone: "5511" + "900000001" }], "g1", agora);
    expect(r).toEqual([
      { tipo: "remover", campanha_id: "c1", grupo_id: "g2", telefone: "5511" + "900000001", origem: "automacao", executar_apos: agora.toISOString(), automacao_id: "a1", automacao_acao_id: "x1", gatilho_chave: "saiu:g1:5511" + "900000001:2026-10-16T12:07:30.000Z:g2" },
      { tipo: "remover", campanha_id: "c1", grupo_id: "g3", telefone: "5511" + "900000001", origem: "automacao", executar_apos: agora.toISOString(), automacao_id: "a1", automacao_acao_id: "x1", gatilho_chave: "saiu:g1:5511" + "900000001:2026-10-16T12:07:30.000Z:g3" },
    ]);
  });
});

describe("linhasCheckout", () => {
  it("uma remoção por participação, chave venda:vendaId:grupoId", () => {
    const acoes = [{ id: "x1", tipo: "remover_participante" as const, conteudo: {}, atraso_min: 0 }];
    const r = linhasCheckout({ id: "a1", campanha_id: "c1" }, acoes, "v1", [{ grupoId: "g1", telefone: "5511" + "900000001" }], agora);
    expect(r).toEqual([
      { tipo: "remover", campanha_id: "c1", grupo_id: "g1", telefone: "5511" + "900000001", origem: "automacao", executar_apos: agora.toISOString(), automacao_id: "a1", automacao_acao_id: "x1", gatilho_chave: "venda:v1:g1" },
    ]);
  });
});

describe("chaves dos gatilhos de pessoa (entrou/saiu levam o instante do evento)", () => {
  const remover = [{ id: "x1", tipo: "remover_participante" as const, conteudo: {}, atraso_min: 0 }];
  const depois = new Date("2026-10-16T15:00:00Z");
  it("entrou: mesma entrada → mesma chave; entrar de novo depois → chave nova", () => {
    const a = linhasEntrou({ id: "a1", campanha_id: "c1" }, remover, "g1", ["5511" + "900000001"], agora).remocoes[0].gatilho_chave;
    const b = linhasEntrou({ id: "a1", campanha_id: "c1" }, remover, "g1", ["5511" + "900000001"], new Date(agora)).remocoes[0].gatilho_chave;
    const c = linhasEntrou({ id: "a1", campanha_id: "c1" }, remover, "g1", ["5511" + "900000001"], depois).remocoes[0].gatilho_chave;
    expect(a).toBe(b);
    expect(c).not.toBe(a);
  });
  it("saiu: mesma saída → mesma chave; sair de novo depois → chave nova", () => {
    const outras = [{ grupoId: "g2", telefone: "5511" + "900000001" }];
    const a = linhasSaiu({ id: "a1", campanha_id: "c1" }, remover, "5511" + "900000001", outras, "g1", agora)[0].gatilho_chave;
    const c = linhasSaiu({ id: "a1", campanha_id: "c1" }, remover, "5511" + "900000001", outras, "g1", depois)[0].gatilho_chave;
    expect(a).toBe("saiu:g1:5511" + "900000001:2026-10-16T12:07:30.000Z:g2");
    expect(c).toBe("saiu:g1:5511" + "900000001:2026-10-16T15:00:00.000Z:g2");
  });
});

describe("rodadaSuspeita", () => {
  const nosso = ["5511" + "999990000", "551199990000"];
  const lista = (n: number, comNosso = true) => [...(comNosso ? ["5511" + "999990000@s.whatsapp.net"] : []), ...Array.from({ length: n }, (_, i) => `55119000${String(i).padStart(5, "0")}`)];
  const ignorar = (motivo: string) => ({ tipo: "ignorar_rodada", motivo });
  const semAutomacoes = { tipo: "sem_automacoes", motivo: "entrada_em_massa" };
  it("rodada normal: null", () => {
    expect(rodadaSuspeita({ conhecidos: 50, lista: lista(52), entraram: 3, sairam: 1, telefonesConexao: nosso })).toBeNull();
  });
  it("lista vazia: ignorar a rodada", () => {
    expect(rodadaSuspeita({ conhecidos: 50, lista: [], entraram: 0, sairam: 50, telefonesConexao: nosso })).toEqual(ignorar("lista_vazia"));
  });
  it("nenhum número da conexão na lista: ignorar (variante do nono dígito conexão como presente)", () => {
    expect(rodadaSuspeita({ conhecidos: 5, lista: lista(5, false), entraram: 0, sairam: 0, telefonesConexao: nosso })).toEqual(ignorar("sem_numero_conectado"));
    expect(rodadaSuspeita({ conhecidos: 5, lista: ["551199990000", ...lista(4, false)], entraram: 0, sairam: 0, telefonesConexao: nosso })).toBeNull();
  });
  it("conexão sem telefone gravado: não barra pela regra do número", () => {
    expect(rodadaSuspeita({ conhecidos: 5, lista: lista(5, false), entraram: 0, sairam: 0, telefonesConexao: [] })).toBeNull();
  });
  it("lista parcial: 6 de 400 vistos (mais da metade sumiu de uma vez) → ignorar a rodada", () => {
    expect(rodadaSuspeita({ conhecidos: 400, lista: lista(5), entraram: 0, sairam: 394, telefonesConexao: nosso })).toEqual(ignorar("metade_saiu"));
  });
  it("metade_saiu: mais da metade de 10+ conhecidos; exatamente a metade ou menos de 10 conhecidos não", () => {
    expect(rodadaSuspeita({ conhecidos: 12, lista: lista(4), entraram: 0, sairam: 7, telefonesConexao: nosso })).toEqual(ignorar("metade_saiu"));
    expect(rodadaSuspeita({ conhecidos: 30, lista: lista(14), entraram: 0, sairam: 15, telefonesConexao: nosso })).toBeNull();
    expect(rodadaSuspeita({ conhecidos: 9, lista: lista(2), entraram: 0, sairam: 6, telefonesConexao: nosso })).toBeNull();
  });
  it("entrada em massa (10+ entradas, mais da metade da lista) em grupo com 10+ conhecidos: grava, sem automações", () => {
    expect(rodadaSuspeita({ conhecidos: 400, lista: lista(849), entraram: 450, sairam: 0, telefonesConexao: nosso })).toEqual(semAutomacoes);
    expect(rodadaSuspeita({ conhecidos: 10, lista: lista(30), entraram: 21, sairam: 0, telefonesConexao: nosso })).toEqual(semAutomacoes);
  });
  it("grupo novo/pequeno (menos de 10 conhecidos) enchendo rápido: não é suspeito", () => {
    expect(rodadaSuspeita({ conhecidos: 4, lista: lista(15), entraram: 12, sairam: 0, telefonesConexao: nosso })).toBeNull();
    expect(rodadaSuspeita({ conhecidos: 9, lista: lista(59), entraram: 51, sairam: 0, telefonesConexao: nosso })).toBeNull();
    expect(rodadaSuspeita({ conhecidos: 1, lista: lista(9), entraram: 9, sairam: 0, telefonesConexao: nosso })).toBeNull();
  });
});
