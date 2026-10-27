import { describe, expect, it } from "vitest";
import { linhasDoCronograma, linhasDoEvento, ROTULO_GATILHO, validarAutomacao, type EntradaAutomacao } from "@/src/lib/regras/automacoes";

const agora = new Date("2026-10-16T12:00:00Z");
const CAMP = "11111111-1111-4111-8111-111111111111";
const G1 = "22222222-2222-4222-8222-222222222222";
const base: EntradaAutomacao = {
  nome: "Aula aviso",
  campanha_id: CAMP,
  gatilho: "cronograma",
  quando: "2026-10-17T15:00:00Z",
  alvo_grupos: null,
  pasta: null,
  provedor: null,
  produto: null,
  acoes: [{ tipo: "abrir", conteudo: {}, atraso_min: 0 }],
};

describe("validarAutomacao", () => {
  it("aceita o cronograma futuro e normaliza nome/pasta", () => {
    const r = validarAutomacao({ ...base, nome: "  Aula aviso ", pasta: "  " }, agora);
    expect(r).toEqual({ ok: true, valor: { ...base, nome: "Aula aviso", pasta: null, alvo_contas: null, checkout_evento: null } });
  });
  it.each([
    [{ nome: "" }, "Dê um nome de até 80 caracteres."],
    [{ gatilho: "xyz" }, "Escolha um gatilho."],
    [{ quando: null }, "Escolha a data e a hora do disparo."],
    [{ quando: "2026-10-16T11:00:00Z" }, "Escolha uma data futura."],
    [{ acoes: [] }, "Adicione pelo menos uma ação."],
    [{ acoes: [{ tipo: "xyz", conteudo: {}, atraso_min: 0 }] }, "Ação 1: tipo inválido."],
    [{ acoes: [{ tipo: "remover_participante", conteudo: {}, atraso_min: 0 }] }, "Ação 1: não vale para este gatilho."],
    [{ acoes: [{ tipo: "abrir", conteudo: {}, atraso_min: 2000 }] }, "Ação 1: atraso entre 0 e 1440 minutos."],
    [{ acoes: [{ tipo: "mensagem", conteudo: { formato: "texto", texto: "" }, atraso_min: 0 }] }, "Ação 1: "],
    [{ alvo_grupos: [] }, "Marque pelo menos um grupo."],
    [{ pasta: "x".repeat(41) }, "Pasta com até 40 caracteres."],
    [{ campanha_id: "c1" }, "Campanha inválida."],
    [{ campanha_id: "" }, "Campanha inválida."],
    [{ alvo_grupos: [G1, "g1"] }, "Grupo inválido."],
    [{ alvo_grupos: Array.from({ length: 501 }, () => G1) }, "No máximo 500 grupos."],
    [{ acoes: Array.from({ length: 21 }, () => ({ tipo: "abrir", conteudo: {}, atraso_min: 0 })) }, "No máximo 20 ações."],
  ] as const)("recusa %o", (mudanca, erro) => {
    const r = validarAutomacao({ ...base, ...mudanca } as EntradaAutomacao, agora);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro.startsWith(erro)).toBe(true);
  });
  it("gatilho de grupo ignora quando e alvo", () => {
    const r = validarAutomacao({ ...base, gatilho: "grupo_criado", quando: "2020-01-01T00:00:00Z", alvo_grupos: [G1] }, agora);
    expect(r).toEqual({ ok: true, valor: { ...base, gatilho: "grupo_criado", quando: null, alvo_grupos: null, alvo_contas: null, checkout_evento: null } });
  });
});

describe("validarAutomacao: data futura só quando o quando muda ou a automação fica ativa", () => {
  const passado = "2026-10-10T15:00:00Z";
  it("edição sem mudar o quando (mesmo instante, outro formato) e desativada: aceita data vencida", () => {
    const r = validarAutomacao({ ...base, quando: passado, nome: "Novo nome" }, agora, { quandoAnterior: "2026-10-10T15:00:00.000+00:00", ativando: false });
    expect(r.ok).toBe(true);
  });
  it("edição que muda o quando pra uma data vencida: recusa", () => {
    const r = validarAutomacao({ ...base, quando: passado }, agora, { quandoAnterior: "2026-10-09T15:00:00Z", ativando: false });
    expect(r).toEqual({ ok: false, erro: "Escolha uma data futura." });
  });
  it("ativando com o quando salvo já vencido: recusa", () => {
    const r = validarAutomacao({ ...base, quando: passado }, agora, { quandoAnterior: passado, ativando: true });
    expect(r).toEqual({ ok: false, erro: "Escolha uma data futura." });
  });
  it("automação nova (sem quando anterior): exige data futura", () => {
    expect(validarAutomacao({ ...base, quando: passado }, agora).ok).toBe(false);
    expect(validarAutomacao({ ...base, quando: passado }, agora, { quandoAnterior: null }).ok).toBe(false);
  });
  it("aceita exatamente 20 ações e 500 grupos", () => {
    const acoes = Array.from({ length: 20 }, () => ({ tipo: "abrir" as const, conteudo: {}, atraso_min: 0 }));
    expect(validarAutomacao({ ...base, acoes, alvo_grupos: Array.from({ length: 500 }, () => G1) }, agora).ok).toBe(true);
  });
});

describe("linhas de execução", () => {
  const acoes = [
    { id: "x1", tipo: "abrir" as const, conteudo: {}, atraso_min: 0 },
    { id: "x2", tipo: "fechar" as const, conteudo: {}, atraso_min: 90 },
  ];
  it("cronograma: quando + atraso, alvo da automação, chave 'cronograma'", () => {
    expect(linhasDoCronograma({ id: "a1", campanha_id: "c1", quando: "2026-10-17T15:00:00.000Z", alvo_grupos: ["g1"] }, acoes)).toEqual([
      { campanha_id: "c1", origem: "automacao", tipo: "abrir", conteudo: {}, alvo_grupos: ["g1"], alvo_contas: null, agendada_para: "2026-10-17T15:00:00.000Z", automacao_id: "a1", automacao_acao_id: "x1", gatilho_chave: "cronograma" },
      { campanha_id: "c1", origem: "automacao", tipo: "fechar", conteudo: {}, alvo_grupos: ["g1"], alvo_contas: null, agendada_para: "2026-10-17T16:30:00.000Z", automacao_id: "a1", automacao_acao_id: "x2", gatilho_chave: "cronograma" },
    ]);
  });
  it("evento: agora + atraso, só o grupo do evento, chave = grupo", () => {
    expect(linhasDoEvento({ id: "a1", campanha_id: "c1" }, acoes, "g9", agora).map((l) => [l.agendada_para, l.alvo_grupos, l.gatilho_chave])).toEqual([
      ["2026-10-16T12:00:00.000Z", ["g9"], "g9"],
      ["2026-10-16T13:30:00.000Z", ["g9"], "g9"],
    ]);
  });
  it("rótulos", () => {
    expect(ROTULO_GATILHO.cronograma).toBe("Cronograma de disparo");
  });
});
