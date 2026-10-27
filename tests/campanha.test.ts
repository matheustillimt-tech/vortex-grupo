import { describe, expect, it } from "vitest";
import { validarAula, validarCampanha, type CampanhaEntrada } from "@/src/lib/regras/campanha";

const base: CampanhaEntrada = {
  nome: "Aulão 21/10", slug: "aulao", padrao_nome: "AULÃO #{n}", descricao: "", fechado: true,
  limite_por_grupo: 1000, folga: 1, conexao_criadora_id: "c1", admins: ["c2"], usar_comunidade: false, crm_webhook_url: "",
  projeto_id: null,
};

describe("validarCampanha", () => {
  it("aceita a campanha padrão e tira o criador da lista de admins", () => {
    const r = validarCampanha({ ...base, admins: ["c1", "c2"] });
    expect(r).toEqual({ ok: true, valor: { ...base, admins: ["c2"], crm_webhook_url: null } });
  });
  it("aceita campanha sem número (nasce assim; o número é escolhido em Conexões associadas)", () => {
    const r = validarCampanha({ ...base, conexao_criadora_id: "" });
    expect(r.ok && r.valor.conexao_criadora_id).toBeNull();
  });
  it("aceita um projeto (uuid válido)", () => {
    const r = validarCampanha({ ...base, projeto_id: "11111111-1111-4111-8111-111111111111" });
    expect(r).toEqual({ ok: true, valor: { ...base, projeto_id: "11111111-1111-4111-8111-111111111111", crm_webhook_url: null } });
  });
  it("trata projeto_id undefined como null (sem projeto)", () => {
    const r = validarCampanha({ ...base, projeto_id: undefined });
    expect(r).toEqual({ ok: true, valor: { ...base, projeto_id: null, crm_webhook_url: null } });
  });
  it.each([
    [{ nome: " " }, "Dê um nome à campanha."],
    [{ slug: "Aulão" }, "O endereço do link aceita só letras minúsculas, números e hífen (2 a 40)."],
    [{ limite_por_grupo: 2000 }, "O limite por grupo vai de 10 a 1024."],
    [{ folga: 0 }, "A folga vai de 1 a 10 grupos."],
    [{ crm_webhook_url: "ftp://x" }, "O webhook do CRM precisa começar com https://"],
    [{ padrao_nome: "" }, "Dê um padrão de nome para os grupos."],
    [{ projeto_id: "não-é-um-uuid" }, "Projeto inválido."],
    [{ tipo: "evento" }, "Tipo de campanha inválido."],
    [{ termina_em: "amanhã" }, "Data e hora de término inválidas."],
    [{ link_apos_termino: "http://x" }, "O link após o término precisa começar com https://"],
    [{ link_apos_termino: "https://x/" + "a".repeat(500) }, "O link após o término pode ter no máximo 500 caracteres."],
  ])("%o → %s", (mudanca, erro) => {
    expect(validarCampanha({ ...base, ...mudanca })).toEqual({ ok: false, erro });
  });

  it("tipo, termina_em e link_apos_termino ausentes não entram no resultado (edição parcial)", () => {
    const r = validarCampanha({ ...base });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.valor.tipo).toBeUndefined();
      expect(r.valor.termina_em).toBeUndefined();
      expect(r.valor.link_apos_termino).toBeUndefined();
    }
  });

  it("aceita os 4 tipos", () => {
    for (const tipo of ["campanha", "lista", "viral", "aleatorio"]) {
      expect(validarCampanha({ ...base, tipo })).toMatchObject({ ok: true, valor: { tipo } });
    }
  });

  it("termina_em: converte a data de Brasília; vazio apaga (null)", () => {
    expect(validarCampanha({ ...base, termina_em: "2026-10-21T20:00" })).toMatchObject({ ok: true, valor: { termina_em: "2026-10-21T23:00:00.000Z" } });
    expect(validarCampanha({ ...base, termina_em: "" })).toMatchObject({ ok: true, valor: { termina_em: null } });
  });

  it("link_apos_termino: aceita https; vazio apaga (null)", () => {
    expect(validarCampanha({ ...base, link_apos_termino: "https://exemplo.test/fim" })).toMatchObject({ ok: true, valor: { link_apos_termino: "https://exemplo.test/fim" } });
    expect(validarCampanha({ ...base, link_apos_termino: "" })).toMatchObject({ ok: true, valor: { link_apos_termino: null } });
  });
});

describe("validarAula", () => {
  const base = { data_aula: "2026-10-21T20:00", link_aula: "https://youtube.com/live/x", sequencia_id: "s1", mensagem_fixa: "  Bem-vindo!  ", alertas_webhook_url: "" };
  it("converte a data de Brasília e limpa os campos", () => {
    expect(validarAula(base)).toEqual({
      ok: true,
      valor: { data_aula: "2026-10-21T23:00:00.000Z", link_aula: "https://youtube.com/live/x", sequencia_id: "s1", mensagem_fixa: "Bem-vindo!", alertas_webhook_url: null },
    });
  });
  it("tudo vazio vira null", () => {
    expect(validarAula({ data_aula: "", link_aula: "", sequencia_id: "", mensagem_fixa: " ", alertas_webhook_url: "" })).toEqual({
      ok: true,
      valor: { data_aula: null, link_aula: null, sequencia_id: null, mensagem_fixa: null, alertas_webhook_url: null },
    });
  });
  it("recusa data inválida, links sem https e sequência sem data", () => {
    expect(validarAula({ ...base, data_aula: "amanhã" })).toEqual({ ok: false, erro: "Data e hora da aula inválidas." });
    expect(validarAula({ ...base, link_aula: "http://x" })).toMatchObject({ ok: false });
    expect(validarAula({ ...base, alertas_webhook_url: "ftp://x" })).toMatchObject({ ok: false });
    expect(validarAula({ ...base, data_aula: "" })).toEqual({ ok: false, erro: "Para aplicar a sequência, informe a data e a hora da aula." });
  });
});
