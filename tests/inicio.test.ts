import { describe, expect, it } from "vitest";
import { aplicarOrdem, chaveOrdemInicio, formatarNumero, formatarTelefone, numeroOuTraco, quandoCurto, urlSemSegredo } from "@/src/lib/regras/inicio";

describe("quandoCurto", () => {
  it("só a hora quando é hoje em Brasília; com a data quando não é", () => {
    const agora = new Date("2026-10-15T15:00:00Z");
    expect(quandoCurto("2026-10-15T22:50:00Z", agora)).toBe("19:50");
    expect(quandoCurto("2026-10-16T02:30:00Z", agora)).toBe("23:30");
    expect(quandoCurto("2026-10-21T22:50:00Z", agora)).toBe("21/10 19:50");
  });
});

describe("formatarNumero", () => {
  it("milhar com ponto", () => {
    expect(formatarNumero(1284)).toBe("1.284");
    expect(formatarNumero(42)).toBe("42");
  });
});

describe("numeroOuTraco", () => {
  it("formata o número quando a leitura deu certo", () => {
    expect(numeroOuTraco(1284)).toBe("1.284");
    expect(numeroOuTraco(0)).toBe("0");
  });
  it("vira travessão quando a leitura falhou (null)", () => {
    expect(numeroOuTraco(null)).toBe("—");
  });
});

describe("formatarTelefone", () => {
  it("13 dígitos: código do país + DDD + celular com 9 (5+4)", () => {
    expect(formatarTelefone("5537" + "980001001")).toBe("+55 37 " + "98000-1001");
  });
  it("12 dígitos: código do país + DDD + fixo (4+4)", () => {
    expect(formatarTelefone("553780001001")).toBe("+55 37 8000-1001");
  });
  it("outros tamanhos: devolve como veio", () => {
    expect(formatarTelefone("123")).toBe("123");
    expect(formatarTelefone("")).toBe("");
  });
});

describe("aplicarOrdem (reordenar cartões do Início, Etapa 3N)", () => {
  it("sem nada salvo, mantém a ordem de hoje", () => {
    expect(aplicarOrdem(["a", "b", "c"], [])).toEqual(["a", "b", "c"]);
  });
  it("respeita a ordem salva quando os ids continuam todos aí", () => {
    expect(aplicarOrdem(["a", "b", "c"], ["c", "a", "b"])).toEqual(["c", "a", "b"]);
  });
  it("id novo (não estava salvo) entra no fim, na ordem em que apareceu", () => {
    expect(aplicarOrdem(["a", "b", "c", "d"], ["c", "a"])).toEqual(["c", "a", "b", "d"]);
  });
  it("id removido (salvo mas não existe mais) simplesmente não aparece", () => {
    expect(aplicarOrdem(["a", "c"], ["c", "b", "a"])).toEqual(["c", "a"]);
  });
  it("novos e removidos juntos", () => {
    expect(aplicarOrdem(["a", "d", "e"], ["b", "a", "c"])).toEqual(["a", "d", "e"]);
  });
});

describe("chaveOrdemInicio (revisão final B, item m10)", () => {
  it("com identificador (e-mail) disponível: prefixa a chave", () => {
    expect(chaveOrdemInicio("inicio-ordem-contas", "ana@exemplo.com")).toBe("ana@exemplo.com:inicio-ordem-contas");
  });
  it("duas pessoas diferentes no mesmo navegador ganham chaves diferentes", () => {
    const a = chaveOrdemInicio("inicio-ordem-contas", "a@x.com");
    const b = chaveOrdemInicio("inicio-ordem-contas", "b@x.com");
    expect(a).not.toBe(b);
  });
  it("sem identificador: a chave fica como estava", () => {
    expect(chaveOrdemInicio("inicio-ordem-contas", "")).toBe("inicio-ordem-contas");
  });
});

describe("urlSemSegredo", () => {
  it("tira query string e token, deixa origem + caminho", () => {
    expect(urlSemSegredo("https://crm.exemplo.com/webhooks/entrada?token=abc123&x=1")).toBe("https://crm.exemplo.com/webhooks/entrada");
  });
  it("sem query, devolve igual", () => {
    expect(urlSemSegredo("https://crm.exemplo.com/webhooks/entrada")).toBe("https://crm.exemplo.com/webhooks/entrada");
  });
  it("não é uma URL válida: devolve como veio", () => {
    expect(urlSemSegredo("não é url")).toBe("não é url");
  });
});
