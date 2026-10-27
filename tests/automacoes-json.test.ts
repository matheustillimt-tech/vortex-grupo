import { describe, expect, it } from "vitest";
import { entradaDoImportJson, exportarAutomacaoJson, validarAutomacao, VERSAO_JSON_AUTOMACAO } from "@/src/lib/regras/automacoes";

// Etapa 3F, Tarefa 2: "Exportar JSON" / "Importar JSON" do menu `more_vert` da lista de automações — nunca leva
// id, campanha, contas ou grupos; a importação reaproveita a validação do assistente (`validarAutomacao`).

describe("exportarAutomacaoJson", () => {
  it("monta o formato (versão, nome, gatilho, ações em ordem) sem nada de identificação", () => {
    const json = exportarAutomacaoJson({
      nome: "Sai quem comprou",
      gatilho: "checkout",
      quando: null,
      provedor: "hotmart",
      produto: "Curso X",
      checkout_evento: null,
      acoes: [
        { tipo: "remover_participante", conteudo: {}, atraso_min: 0 },
        { tipo: "tag_condicional", conteudo: { tag_id: "11111111-1111-1111-1111-111111111111", tem: true }, atraso_min: 5 },
      ],
    });
    expect(json).toEqual({
      versao: 1,
      nome: "Sai quem comprou",
      gatilho: "checkout",
      quando: null,
      provedor: "hotmart",
      produto: "Curso X",
      checkout_evento: null,
      acoes: [
        { tipo: "remover_participante", conteudo: {}, ordem: 0 },
        { tipo: "tag_condicional", conteudo: { tag_id: "11111111-1111-1111-1111-111111111111", tem: true }, ordem: 1, atraso: 5 },
      ],
    });
  });

  it("atraso 0 não aparece no JSON (fica implícito)", () => {
    const json = exportarAutomacaoJson({
      nome: "x", gatilho: "cronograma", quando: "2026-10-20T10:00:00Z", provedor: null, produto: null, checkout_evento: null,
      acoes: [{ tipo: "nome", conteudo: { padrao: "Grupo {{n}}" }, atraso_min: 0 }],
    });
    expect(json.acoes[0]).not.toHaveProperty("atraso");
  });
});

describe("entradaDoImportJson", () => {
  const CAMPANHA = "22222222-2222-2222-2222-222222222222";

  it("lê versão, nome, gatilho e ações (ordenadas pelo campo `ordem`, mesmo fora de ordem no arquivo)", () => {
    const bruto = {
      versao: VERSAO_JSON_AUTOMACAO,
      nome: "Boas-vindas",
      gatilho: "entrou",
      acoes: [
        { tipo: "remover_participante", conteudo: {}, ordem: 1 },
        { tipo: "mensagem", conteudo: { formato: "texto", texto: "oi" }, ordem: 0, atraso: 3 },
      ],
    };
    const r = entradaDoImportJson(bruto, CAMPANHA);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor.campanha_id).toBe(CAMPANHA);
    expect(r.valor.alvo_grupos).toBeNull();
    expect(r.valor.alvo_contas).toBeNull();
    expect(r.valor.pasta).toBeNull();
    expect(r.valor.acoes.map((a) => a.tipo)).toEqual(["mensagem", "remover_participante"]);
    expect(r.valor.acoes[0].atraso_min).toBe(3);
  });

  it("versão ausente ou diferente de 1 é recusada", () => {
    expect(entradaDoImportJson({ nome: "x", gatilho: "cronograma", acoes: [] }, CAMPANHA)).toMatchObject({ ok: false });
    expect(entradaDoImportJson({ versao: 2, nome: "x", gatilho: "cronograma", acoes: [] }, CAMPANHA)).toMatchObject({ ok: false });
  });

  it("não é objeto, sem nome, sem gatilho ou sem lista de ações: cada um recusado com uma mensagem", () => {
    expect(entradaDoImportJson(null, CAMPANHA).ok).toBe(false);
    expect(entradaDoImportJson("texto", CAMPANHA).ok).toBe(false);
    expect(entradaDoImportJson({ versao: 1, gatilho: "cronograma", acoes: [] }, CAMPANHA).ok).toBe(false);
    expect(entradaDoImportJson({ versao: 1, nome: "x", acoes: [] }, CAMPANHA).ok).toBe(false);
    expect(entradaDoImportJson({ versao: 1, nome: "x", gatilho: "cronograma" }, CAMPANHA).ok).toBe(false);
  });

  it("ida e volta: exportar e importar de novo (na mesma campanha ou em outra) passa pela validação do salvar", () => {
    const original: { nome: string; gatilho: string; quando: string | null; provedor: string | null; produto: string | null; checkout_evento: string | null; acoes: { tipo: string; conteudo: unknown; atraso_min: number }[] } = {
      nome: "Sai quem comprou",
      gatilho: "checkout",
      quando: null,
      provedor: "hotmart",
      produto: "Curso X",
      checkout_evento: null,
      acoes: [{ tipo: "remover_participante", conteudo: {}, atraso_min: 0 }],
    };
    const json = exportarAutomacaoJson(original);
    const entrada = entradaDoImportJson(json, CAMPANHA);
    expect(entrada.ok).toBe(true);
    if (!entrada.ok) return;
    const v = validarAutomacao(entrada.valor);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.valor).toMatchObject({ nome: "Sai quem comprou", gatilho: "checkout", provedor: "hotmart", produto: "Curso X", campanha_id: CAMPANHA });
  });

  it("ida e volta de um cronograma com data no passado: a validação recusa (automação nova sempre exige futura)", () => {
    const json = exportarAutomacaoJson({
      nome: "x", gatilho: "cronograma", quando: "2020-01-01T10:00:00Z", provedor: null, produto: null, checkout_evento: null,
      acoes: [{ tipo: "nome", conteudo: { padrao: "Grupo {{n}}" }, atraso_min: 0 }],
    });
    const entrada = entradaDoImportJson(json, CAMPANHA);
    expect(entrada.ok).toBe(true);
    if (!entrada.ok) return;
    const v = validarAutomacao(entrada.valor);
    expect(v).toMatchObject({ ok: false, erro: "Escolha uma data futura." });
  });
});
