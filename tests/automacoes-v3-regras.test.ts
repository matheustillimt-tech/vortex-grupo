import { describe, expect, it } from "vitest";
import {
  acoesDaPessoa,
  GATILHOS_CHECKOUT,
  linhasDoCronograma,
  linhasDoEvento,
  linhasEntrou,
  linhasEntrouCondicional,
  ROTULO_ACAO,
  rotuloGatilho,
  tagsDasCondicionais,
  TIPOS_ACAO_AUTOMACAO,
  validarAutomacao,
  type AcaoAutomacao,
  type EntradaAutomacao,
} from "@/src/lib/regras/automacoes";

// Etapa 3F, Tarefa 1: ações novas, Tag Condicional, contas e gatilhos por plataforma (regras puras).

const agora = new Date("2026-10-17T12:07:30Z");
const CAMP = "11111111-1111-4111-8111-111111111111";
const OUTRA = "33333333-3333-4333-8333-333333333333";
const TAG = "44444444-4444-4444-8444-444444444444";
const TAG2 = "55555555-5555-4555-8555-555555555555";
const CONTA = "66666666-6666-4666-8666-666666666666";

const base: EntradaAutomacao = {
  nome: "A", campanha_id: CAMP, gatilho: "grupo_criado", quando: null, alvo_grupos: null, pasta: null, provedor: null, produto: null,
  acoes: [{ tipo: "abrir", conteudo: {}, atraso_min: 0 }],
};
const remover: AcaoAutomacao = { tipo: "remover_participante", conteudo: {}, atraso_min: 0 };
const cond = (tem: boolean, tag = TAG): AcaoAutomacao => ({ tipo: "tag_condicional", conteudo: { tag_id: tag, tem }, atraso_min: 0 });

describe("rótulos", () => {
  it("cada ação tem o rótulo", () => {
    expect(ROTULO_ACAO).toEqual({
      mensagem: "Enviar mensagem",
      enquete: "Enviar enquete",
      nome: "Atualizar assunto do grupo",
      descricao: "Atualizar descrição do grupo",
      configuracao: "Atualizar configurações do grupo",
      atualizar_links: "Atualizar links dos grupos",
      redefinir_link: "Redefinir link de convite",
      fechar: "Fechar Grupos",
      abrir: "Abrir Grupos",
      admin_add: "Tornar administrador do grupo",
      admin_remover: "Remover administrador do grupo",
      remover_participante: "Remover Lead",
      desativar_comunidade: "Desativar comunidade",
      tag_condicional: "Tag Condicional",
      mover_grupos: "Mover grupos para outra campanha",
      adicionar_tag: "Adicionar tag",
      remover_tag: "Remover tag",
      adicionar_blacklist: "Adicionar à blacklist",
      remover_blacklist: "Remover da blacklist",
      imagem: "Atualizar foto do grupo",
    });
    expect(Object.keys(ROTULO_ACAO).sort()).toEqual([...TIPOS_ACAO_AUTOMACAO].sort());
  });

  it("gatilhos de checkout por plataforma; sem plataforma = 'Checkout - Compra aprovada' (qualquer)", () => {
    expect(GATILHOS_CHECKOUT.map((g) => g.rotulo)).toEqual([
      "Checkout - Compra aprovada",
      "Hotmart - Compra aprovada",
      "Kiwify - Compra aprovada",
      "Pagar.me - Compra aprovada",
      "Checkout próprio - Compra aprovada",
    ]);
    expect(rotuloGatilho("checkout", null)).toBe("Checkout - Compra aprovada");
    expect(rotuloGatilho("checkout", "kiwify")).toBe("Kiwify - Compra aprovada");
    expect(rotuloGatilho("checkout", "stripe")).toBe("Checkout - Compra aprovada");
    expect(rotuloGatilho("entrou", "hotmart")).toBe("Participante entrar no grupo");
  });
});

describe("validarAutomacao: ações novas", () => {
  it("configuração, atualizar links, desativar comunidade e mover grupos valem no cronograma (conteúdo pela validarConteudo)", () => {
    const acoes: AcaoAutomacao[] = [
      { tipo: "configuracao", conteudo: { so_admins_enviam: true, lixo: 1 }, atraso_min: 0 },
      { tipo: "atualizar_links", conteudo: { x: 1 }, atraso_min: 5 },
      { tipo: "desativar_comunidade", conteudo: {}, atraso_min: 0 },
      { tipo: "mover_grupos", conteudo: { campanha_destino: OUTRA }, atraso_min: 0 },
    ];
    const r = validarAutomacao({ ...base, gatilho: "cronograma", quando: "2026-10-20T10:00:00Z", acoes }, agora);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.valor.acoes).toEqual([
        { tipo: "configuracao", conteudo: { so_admins_enviam: true, so_admins_editam: undefined, aprovacao_entrada: undefined, temporarias: undefined }, atraso_min: 0 },
        { tipo: "atualizar_links", conteudo: {}, atraso_min: 5 },
        { tipo: "desativar_comunidade", conteudo: {}, atraso_min: 0 },
        { tipo: "mover_grupos", conteudo: { campanha_destino: OUTRA }, atraso_min: 0 },
      ]);
    }
  });

  it.each([
    [{ tipo: "configuracao", conteudo: {}, atraso_min: 0 }, "Ação 1: Escolha ao menos uma configuração pra trocar."],
    [{ tipo: "mover_grupos", conteudo: { campanha_destino: "x" }, atraso_min: 0 }, "Ação 1: Escolha a campanha de destino."],
    [{ tipo: "mover_grupos", conteudo: { campanha_destino: CAMP }, atraso_min: 0 }, "Ação 1: escolha outra campanha de destino."],
  ] as const)("recusa conteúdo inválido %#", (acao, erro) => {
    expect(validarAutomacao({ ...base, gatilho: "grupo_cheio", acoes: [acao as AcaoAutomacao] }, agora)).toEqual({ ok: false, erro });
  });

  it("ações perigosas por gatilho: desativar comunidade só no cronograma; mover grupos só no cronograma e no grupo cheio", () => {
    const desativar: AcaoAutomacao = { tipo: "desativar_comunidade", conteudo: {}, atraso_min: 0 };
    const mover: AcaoAutomacao = { tipo: "mover_grupos", conteudo: { campanha_destino: OUTRA }, atraso_min: 0 };
    const recusa = { ok: false, erro: "Ação 1: não vale para este gatilho." };
    expect(validarAutomacao({ ...base, gatilho: "grupo_criado", acoes: [desativar] }, agora)).toEqual(recusa);
    expect(validarAutomacao({ ...base, gatilho: "grupo_cheio", acoes: [desativar] }, agora)).toEqual(recusa);
    expect(validarAutomacao({ ...base, gatilho: "grupo_criado", acoes: [mover] }, agora)).toEqual(recusa);
    expect(validarAutomacao({ ...base, gatilho: "grupo_cheio", acoes: [mover] }, agora).ok).toBe(true);
    expect(validarAutomacao({ ...base, gatilho: "grupo_criado", acoes: [{ tipo: "atualizar_links", conteudo: {}, atraso_min: 0 }] }, agora).ok).toBe(true);
  });

  it("ações novas de grupo não valem nos gatilhos de pessoa", () => {
    for (const gatilho of ["entrou", "saiu"]) {
      const r = validarAutomacao({ ...base, gatilho, acoes: [{ tipo: "configuracao", conteudo: { so_admins_enviam: true }, atraso_min: 0 }] }, agora);
      expect(r).toEqual({ ok: false, erro: "Ação 1: não vale para este gatilho." });
    }
  });
});

describe("validarAutomacao: Tag Condicional", () => {
  it("só nos gatilhos de pessoa (entrou, saiu, checkout); nos outros recusa", () => {
    for (const gatilho of ["cronograma", "grupo_criado", "grupo_cheio"]) {
      const r = validarAutomacao({ ...base, gatilho, quando: "2026-10-20T10:00:00Z", acoes: [cond(true), { tipo: "abrir", conteudo: {}, atraso_min: 0 }] }, agora);
      expect(r).toEqual({ ok: false, erro: "Ação 1: não vale para este gatilho." });
    }
    for (const gatilho of ["entrou", "saiu"]) expect(validarAutomacao({ ...base, gatilho, acoes: [cond(true), remover] }, agora).ok).toBe(true);
    expect(validarAutomacao({ ...base, gatilho: "checkout", provedor: "hotmart", produto: "P", acoes: [cond(false), remover] }, agora).ok).toBe(true);
  });

  it("guarda só { tag_id, tem } e atraso 0 (a condição é avaliada na hora do gatilho)", () => {
    const r = validarAutomacao({ ...base, gatilho: "entrou", acoes: [{ tipo: "tag_condicional", conteudo: { tag_id: TAG, tem: false, extra: 1 }, atraso_min: 30 }, remover] }, agora);
    expect(r.ok && r.valor.acoes[0]).toEqual({ tipo: "tag_condicional", conteudo: { tag_id: TAG, tem: false }, atraso_min: 0 });
  });

  it.each([
    [{ tag_id: "x", tem: true }, "Ação 1: Escolha a tag."],
    [{ tem: true }, "Ação 1: Escolha a tag."],
    [{ tag_id: TAG }, "Ação 1: Escolha se a pessoa tem ou não tem a tag."],
    [{ tag_id: TAG, tem: "sim" }, "Ação 1: Escolha se a pessoa tem ou não tem a tag."],
  ])("recusa conteúdo %o", (conteudo, erro) => {
    expect(validarAutomacao({ ...base, gatilho: "entrou", acoes: [{ tipo: "tag_condicional", conteudo, atraso_min: 0 }, remover] }, agora)).toEqual({ ok: false, erro });
  });

  it("entrou: mensagem depois de uma Tag Condicional é recusada; antes dela, vale", () => {
    const m: AcaoAutomacao = { tipo: "mensagem", conteudo: { formato: "texto", texto: "oi" }, atraso_min: 0 };
    expect(validarAutomacao({ ...base, gatilho: "entrou", acoes: [cond(true), remover, m] }, agora)).toEqual({
      ok: false,
      erro: "Na entrada, a Tag Condicional só vale para remover ou marcar tags; mensagens vão pro grupo inteiro.",
    });
    expect(validarAutomacao({ ...base, gatilho: "entrou", acoes: [m, cond(true), remover] }, agora).ok).toBe(true);
  });

  it("Tag Condicional como última ação: recusa", () => {
    expect(validarAutomacao({ ...base, gatilho: "entrou", acoes: [remover, cond(true)] }, agora)).toEqual({
      ok: false,
      erro: "Ação 2: a Tag Condicional precisa de pelo menos uma ação depois dela.",
    });
  });
});

describe("validarAutomacao: conexões e evento de checkout", () => {
  it("alvo_contas: null/ausente = todas; lista válida sem repetição", () => {
    expect(validarAutomacao(base, agora)).toMatchObject({ ok: true, valor: { alvo_contas: null } });
    expect(validarAutomacao({ ...base, alvo_contas: null }, agora)).toMatchObject({ ok: true, valor: { alvo_contas: null } });
    expect(validarAutomacao({ ...base, alvo_contas: [CONTA, CONTA] }, agora)).toMatchObject({ ok: true, valor: { alvo_contas: [CONTA] } });
  });
  it.each([
    [[], "Marque pelo menos uma conexão."],
    [["x"], "Conexão inválida."],
    [Array.from({ length: 101 }, () => CONTA), "No máximo 100 conexões."],
  ])("alvo_contas %# recusa", (alvo_contas, erro) => {
    expect(validarAutomacao({ ...base, alvo_contas }, agora)).toEqual({ ok: false, erro });
  });
  it("checkout: evento padrão 'aprovada'; 'recusada' ainda não (a venda não separa recusa de outros não aprovados)", () => {
    const ck = { ...base, gatilho: "checkout", provedor: "kiwify", produto: "P", acoes: [remover] };
    expect(validarAutomacao(ck, agora)).toMatchObject({ ok: true, valor: { checkout_evento: "aprovada", provedor: "kiwify" } });
    expect(validarAutomacao({ ...ck, checkout_evento: "aprovada" }, agora).ok).toBe(true);
    expect(validarAutomacao({ ...ck, checkout_evento: "recusada" }, agora)).toEqual({ ok: false, erro: "Escolha o evento da venda." });
  });
  it("evento de checkout é zerado fora do checkout", () => {
    expect(validarAutomacao({ ...base, checkout_evento: "aprovada" }, agora)).toMatchObject({ ok: true, valor: { checkout_evento: null } });
  });
});

const comId = (acoes: AcaoAutomacao[]) => acoes.map((a, i) => ({ ...a, id: `x${i + 1}` }));

describe("acoesDaPessoa", () => {
  const msg: AcaoAutomacao = { tipo: "mensagem", conteudo: { formato: "texto", texto: "oi" }, atraso_min: 0 };

  it("sem Tag Condicional: todas as ações, sem consultar tag", () => {
    const acoes = comId([msg, remover]);
    let perguntou = false;
    expect(acoesDaPessoa(acoes, () => ((perguntou = true), false))).toEqual({ acoes, pulada: null });
    expect(perguntou).toBe(false);
  });

  it("condição passa: segue (a Tag Condicional não entra na lista)", () => {
    const acoes = comId([msg, cond(true), remover]);
    expect(acoesDaPessoa(acoes, (t) => t === TAG)).toEqual({ acoes: [acoes[0], acoes[2]], pulada: null });
  });

  it("condição falha: as ações seguintes são puladas, com motivo; as anteriores ficam", () => {
    const acoes = comId([msg, cond(true), remover, cond(false, TAG2), remover]);
    expect(acoesDaPessoa(acoes, () => false)).toEqual({
      acoes: [acoes[0]],
      pulada: { acao_id: "x2", motivo: "Tag Condicional (ação 2): a pessoa não tem a tag; era pra ter.", puladas: ["x3", "x5"] },
    });
  });

  it("'não tem': passa sem a tag e falha com ela; várias condições em sequência", () => {
    const acoes = comId([cond(false), remover, cond(true, TAG2), msg]);
    expect(acoesDaPessoa(acoes, (t) => t === TAG2).acoes.map((a) => a.id)).toEqual(["x2", "x4"]);
    expect(acoesDaPessoa(acoes, () => false).acoes.map((a) => a.id)).toEqual(["x2"]);
    const r = acoesDaPessoa(acoes, (t) => t === TAG);
    expect(r.acoes).toEqual([]);
    expect(r.pulada?.motivo).toBe("Tag Condicional (ação 1): a pessoa tem a tag; era pra não ter.");
  });

  it("conteúdo sem tag_id: conexão como condição falha", () => {
    const acoes = [{ id: "c", tipo: "tag_condicional" as const, conteudo: {}, atraso_min: 0 }, { ...remover, id: "r" }];
    expect(acoesDaPessoa(acoes, () => true).acoes).toEqual([]);
  });

  it("tagsDasCondicionais: ids sem repetição", () => {
    expect(tagsDasCondicionais([cond(true), remover, cond(false), cond(true, TAG2)])).toEqual([TAG, TAG2]);
  });
});

describe("linhas com conexões e Tag Condicional", () => {
  it("alvo_contas da automação vai em cada execução (cronograma, evento, entrou)", () => {
    const acoes = comId([{ tipo: "abrir", conteudo: {}, atraso_min: 0 }]);
    const auto = { id: "a1", campanha_id: "c1", alvo_contas: [CONTA] };
    expect(linhasDoCronograma({ ...auto, quando: "2026-10-20T10:00:00.000Z", alvo_grupos: null }, acoes)[0].alvo_contas).toEqual([CONTA]);
    expect(linhasDoEvento(auto, acoes, "g1", agora)[0].alvo_contas).toEqual([CONTA]);
    const m = comId([{ tipo: "mensagem", conteudo: {}, atraso_min: 0 }]);
    expect(linhasEntrou(auto, m, "g1", ["5511" + "900000001"], agora).execucoes[0].alvo_contas).toEqual([CONTA]);
    expect(linhasDoEvento({ id: "a1", campanha_id: "c1" }, acoes, "g1", agora)[0].alvo_contas).toBeNull();
  });

  it("Tag Condicional nunca vira execução nem remoção", () => {
    const acoes = comId([cond(true), { tipo: "abrir", conteudo: {}, atraso_min: 0 }]);
    expect(linhasDoEvento({ id: "a1", campanha_id: "c1" }, acoes, "g1", agora).map((l) => l.automacao_acao_id)).toEqual(["x2"]);
    expect(linhasDoCronograma({ id: "a1", campanha_id: "c1", quando: "2026-10-20T10:00:00.000Z", alvo_grupos: null }, acoes).map((l) => l.tipo)).toEqual(["abrir"]);
  });

  describe("linhasEntrouCondicional", () => {
    const acoes = comId([cond(true), { tipo: "mensagem", conteudo: { formato: "texto", texto: "oi" }, atraso_min: 0 }, remover]);
    const auto = { id: "a1", campanha_id: "c1" };
    const tags: Record<string, string[]> = { ["5511" + "900000001"]: [TAG] };
    const temTag = (t: string, tag: string) => (tags[t] ?? []).includes(tag);

    it("mensagem do grupo uma vez (se alguém passou) e remoção só de quem passou; mesmas chaves de linhasEntrou", () => {
      const r = linhasEntrouCondicional(auto, acoes, "g1", ["5511" + "900000001", "5511" + "900000002"], agora, temTag);
      const semCondicao = linhasEntrou(auto, acoes, "g1", ["5511" + "900000001"], agora);
      expect(r.execucoes).toEqual(semCondicao.execucoes);
      expect(r.remocoes).toEqual(semCondicao.remocoes);
      expect(r.puladas).toEqual([{ acao_id: "x1", motivo: "Tag Condicional (ação 1): a pessoa não tem a tag; era pra ter.", puladas: ["x2", "x3"] }]);
    });

    it("ninguém passa: nada é criado", () => {
      const r = linhasEntrouCondicional(auto, acoes, "g1", ["5511" + "900000002", "5511" + "900000003"], agora, temTag);
      expect(r.execucoes).toEqual([]);
      expect(r.remocoes).toEqual([]);
      expect(r.puladas).toHaveLength(2);
    });

    it("todos passam: igual a linhasEntrou sem a condição (uma mensagem só, uma remoção por pessoa)", () => {
      const r = linhasEntrouCondicional(auto, acoes, "g1", ["5511" + "900000001", "5511" + "900000002"], agora, () => true);
      expect(r).toEqual({ ...linhasEntrou(auto, acoes, "g1", ["5511" + "900000001", "5511" + "900000002"], agora), puladas: [] });
    });
  });
});
