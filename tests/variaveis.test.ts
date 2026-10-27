import { describe, expect, it } from "vitest";
import { juntarVariaveis, motivoVariaveis, resolverConteudo, resolverTexto, validarChave, variaveisAutomaticas } from "@/src/lib/regras/variaveis";

const campanha = { nome: "Webinário Outubro", slug: "webinario", data_aula: "2026-10-21T23:00:00Z", link_aula: "https://youtube.com/live/x" };

describe("variaveisAutomaticas", () => {
  it("data, hora e dia da semana em Brasília; links e nome", () => {
    expect(variaveisAutomaticas(campanha, "https://seu-dominio.com.br")).toEqual({
      data_aula: "21/10",
      hora_aula: "20h",
      dia_semana_aula: "quarta",
      link_aula: "https://youtube.com/live/x",
      link_grupo: "https://seu-dominio.com.br/l/webinario",
      nome_campanha: "Webinário Outubro",
    });
  });
  it("hora com minutos e aula que vira o dia em UTC", () => {
    const v = variaveisAutomaticas({ ...campanha, data_aula: "2026-10-22T00:30:00Z" }, "https://s");
    expect([v.data_aula, v.hora_aula, v.dia_semana_aula]).toEqual(["21/10", "21h30", "quarta"]);
  });
  it("sem data da aula: data, hora e dia ficam vazios (e bloqueiam se usados)", () => {
    const v = variaveisAutomaticas({ ...campanha, data_aula: null, link_aula: null }, "https://s");
    expect([v.data_aula, v.hora_aula, v.dia_semana_aula, v.link_aula]).toEqual(["", "", "", ""]);
  });
});

describe("resolverTexto", () => {
  const vars = juntarVariaveis({ hora_aula: "20h", link_aula: "" }, [{ chave: "cupom", valor: "VORTEX10" }, { chave: "hora_aula", valor: "ignorada" }]);

  it("troca as chaves com valor e deixa {n} em paz", () => {
    expect(resolverTexto("Hoje {hora_aula}, cupom {cupom}, grupo {n}", vars)).toEqual({ texto: "Hoje 20h, cupom VORTEX10, grupo {n}", faltando: [] });
  });
  it("chave vazia ou desconhecida fica no texto e vai pra faltando (sem repetir)", () => {
    expect(resolverTexto("{link_aula} {bonus} {bonus}", vars)).toEqual({ texto: "{link_aula} {bonus} {bonus}", faltando: ["link_aula", "bonus"] });
  });
  it("texto sem variáveis passa igual", () => {
    expect(resolverTexto("sem chaves {A} {x}", vars)).toEqual({ texto: "sem chaves {A} {x}", faltando: [] });
  });
});

describe("resolverConteudo", () => {
  const vars = { hora_aula: "20h", cupom: "V10" };
  it("mensagem, enquete, nome e descrição", () => {
    expect(resolverConteudo("mensagem", { formato: "texto", texto: "às {hora_aula}", mencionar_todos: true }, vars)).toEqual({
      conteudo: { formato: "texto", texto: "às 20h", mencionar_todos: true },
      faltando: [],
    });
    expect(resolverConteudo("enquete", { pergunta: "Vem às {hora_aula}?", opcoes: ["Sim {cupom}", "{bonus}"], max_respostas: 1 }, vars)).toEqual({
      conteudo: { pergunta: "Vem às 20h?", opcoes: ["Sim V10", "{bonus}"], max_respostas: 1 },
      faltando: ["bonus"],
    });
    expect(resolverConteudo("nome", { padrao: "{hora_aula} #{n}" }, vars).conteudo).toEqual({ padrao: "20h #{n}" });
    expect(resolverConteudo("abrir", {}, vars)).toEqual({ conteudo: {}, faltando: [] });
  });
});

describe("validarChave e motivo", () => {
  it("formato e chaves reservadas", () => {
    expect(validarChave("cupom")).toBeNull();
    expect(validarChave("Cupom")).toMatch(/minúsculas/);
    expect(validarChave("data_aula")).toBe("{data_aula} já é preenchida pela campanha.");
  });
  it("texto do bloqueio", () => {
    expect(motivoVariaveis(["cupom"], "Webinário")).toBe("Variável {cupom} vazia na campanha Webinário");
    expect(motivoVariaveis(["a_b", "cupom"], "W")).toBe("Variáveis {a_b}, {cupom} vazias na campanha W");
  });
});
