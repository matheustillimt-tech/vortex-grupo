import { describe, expect, it } from "vitest";
import { escaparBuscaWebhook } from "@/app/(painel)/hooks/comum";

describe("escaparBuscaWebhook", () => {
  it("termo simples: vira %termo% entre aspas", () => {
    expect(escaparBuscaWebhook("crm")).toBe('"%crm%"');
  });

  it("escapa os curingas do ILIKE (% e _) e a barra invertida", () => {
    // Cada caractere passa por duas camadas de escape: primeiro pro ILIKE (vira \% ou \_), depois pras aspas do
    // PostgREST (cada barra invertida que já está lá dobra de novo) — por isso vêm 2 barras antes de cada um.
    expect(escaparBuscaWebhook("100%_off")).toBe('"%100\\\\%\\\\_off%"');
    expect(escaparBuscaWebhook("a\\b")).toBe('"%a\\\\\\\\b%"');
  });

  it("vírgula e parênteses (tentativa de injetar outro filtro no .or()) ficam dentro das aspas, como texto", () => {
    const v = escaparBuscaWebhook("a,ativo.eq.true)");
    expect(v).toBe('"%a,ativo.eq.true)%"');
    // Nada de aspas soltas que fechem a string antes da hora, e nenhuma vírgula fora de aspas.
    const dentro = v.slice(1, -1);
    expect(dentro.includes('"')).toBe(false);
  });

  it("aspas duplas no termo são escapadas, pra não fechar a string do PostgREST antes da hora", () => {
    expect(escaparBuscaWebhook('x"y')).toBe('"%x\\"y%"');
  });

  it("o `.or(...)` montado com dois campos preserva a vírgula e os parênteses como texto buscado", () => {
    const v = escaparBuscaWebhook("a,ativo.eq.true)");
    const or = `nome.ilike.${v},url.ilike.${v}`;
    // As únicas vírgulas fora de aspas são a que separa os dois campos do `.or()`.
    let dentroDeAspas = false;
    let virgulasForaDeAspas = 0;
    for (const c of or) {
      if (c === '"') dentroDeAspas = !dentroDeAspas;
      else if (c === "," && !dentroDeAspas) virgulasForaDeAspas += 1;
    }
    expect(virgulasForaDeAspas).toBe(1);
  });
});
