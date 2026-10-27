import { describe, expect, it } from "vitest";
import {
  corteFalhaSemProcessar,
  corteFila,
  DETALHE_NAO_PROCESSADA,
  detalheDaVenda,
  duracaoProcessamento,
  lerAbaDetalhe,
  lerFiltrosEventos,
  lerFiltrosIntegracoes,
  limitesDatas,
  linkIntegracao,
  PLATAFORMAS_INTEGRACAO,
  regrasImportantes,
  statusDaVenda,
  urlEventos,
  urlIntegracoes,
  validarIntegracao,
} from "@/src/lib/regras/integracoes";

describe("PLATAFORMAS_INTEGRACAO", () => {
  it("as 4 que o Vórtex Grupo recebe, com os nomes de mercado", () => {
    expect(PLATAFORMAS_INTEGRACAO.map((p) => p.rotulo)).toEqual(["Hotmart", "Kiwify", "Pagar.me", "Checkout próprio"]);
  });
});

describe("validarIntegracao", () => {
  it("aceita e apara o nome", () => {
    expect(validarIntegracao({ nome: " Kiwify ", plataforma: "kiwify" })).toEqual({ ok: true, valor: { nome: "Kiwify", plataforma: "kiwify" } });
  });
  it("recusa nome vazio, > 60 e plataforma desconhecida", () => {
    expect(validarIntegracao({ nome: "", plataforma: "kiwify" }).ok).toBe(false);
    expect(validarIntegracao({ nome: 3, plataforma: "kiwify" }).ok).toBe(false);
    expect(validarIntegracao({ nome: "x".repeat(61), plataforma: "kiwify" }).ok).toBe(false);
    expect(validarIntegracao({ nome: "a", plataforma: "eduzz" }).ok).toBe(false);
  });
});

describe("linkIntegracao", () => {
  it("mesma rota de antes (os links antigos têm esse formato)", () => {
    expect(linkIntegracao("https://seu-dominio.com.br/", "hotmart", "abc")).toBe("https://seu-dominio.com.br/api/webhooks/checkout/hotmart/abc");
  });
});

describe("regrasImportantes", () => {
  it("3 regras, a primeira diz onde colar na plataforma", () => {
    const r = regrasImportantes("pagarme");
    expect(r).toHaveLength(3);
    expect(r[0]).toContain("order.paid");
  });
});

describe("filtros da lista", () => {
  it("padrões e valores inválidos", () => {
    expect(lerFiltrosIntegracoes({})).toEqual({ aba: "ativas", q: "", ordem: "recentes", pagina: 1 });
    expect(lerFiltrosIntegracoes({ aba: "arquivadas", q: " hot ", ordem: "antigos", pagina: "2" })).toEqual({ aba: "arquivadas", q: "hot", ordem: "antigos", pagina: 2 });
    expect(lerFiltrosIntegracoes({ aba: "x", ordem: "y", pagina: "-1" })).toEqual({ aba: "ativas", q: "", ordem: "recentes", pagina: 1 });
  });
  it("url: mudar filtro volta pra página 1; Arquivadas por ?aba= (o /webhooks/arquivadas antigo redireciona pros Hooks)", () => {
    const f = { aba: "ativas" as const, q: "hot", ordem: "recentes" as const, pagina: 3 };
    expect(urlIntegracoes(f, { aba: "arquivadas" })).toBe("/webhooks?aba=arquivadas&q=hot");
    expect(urlIntegracoes(f, { pagina: 4 })).toBe("/webhooks?q=hot&pagina=4");
    expect(urlIntegracoes({ ...f, q: "" }, {})).toBe("/webhooks");
  });
});

describe("detalhe", () => {
  it("aba padrão é Visão geral", () => {
    expect(lerAbaDetalhe(undefined)).toBe("visao");
    expect(lerAbaDetalhe("contas")).toBe("contas");
    expect(lerAbaDetalhe("eventos")).toBe("eventos");
    expect(lerAbaDetalhe("automacoes")).toBe("automacoes");
    expect(lerAbaDetalhe("x")).toBe("visao");
  });

  it("statusDaVenda: fila (recente, não processada), processando (não processada há 2+ min), falhas (sem telefone), sucesso (o resto)", () => {
    const agora = new Date("2026-10-17T12:00:00Z");
    expect(statusDaVenda({ created_at: "2026-10-17T11:59:30Z", processada_em: null, resultado: null }, agora)).toBe("fila");
    expect(statusDaVenda({ created_at: "2026-10-17T11:57:00Z", processada_em: null, resultado: null }, agora)).toBe("processando");
    expect(statusDaVenda({ created_at: "2026-10-17T11:00:00Z", processada_em: "2026-10-17T11:01:00Z", resultado: "sem telefone" }, agora)).toBe("falhas");
    expect(statusDaVenda({ created_at: "2026-10-17T11:00:00Z", processada_em: "2026-10-17T11:01:00Z", resultado: "2 remoção(ões) na fila" }, agora)).toBe("sucesso");
    expect(statusDaVenda({ created_at: "2026-10-17T11:00:00Z", processada_em: "2026-10-17T11:01:00Z", resultado: "ignorada (não é compra aprovada)" }, agora)).toBe("sucesso");
    expect(corteFila(agora)).toBe("2026-10-17T11:58:00.000Z");
  });

  it("statusDaVenda: não processada por 1h ou mais vira falhas (não some pra sempre em 'processando')", () => {
    const agora = new Date("2026-10-17T12:00:00Z");
    expect(statusDaVenda({ created_at: "2026-10-17T11:01:00Z", processada_em: null, resultado: null }, agora)).toBe("processando");
    expect(statusDaVenda({ created_at: "2026-10-17T11:00:00Z", processada_em: null, resultado: null }, agora)).toBe("falhas");
    expect(statusDaVenda({ created_at: "2026-10-17T10:00:00Z", processada_em: null, resultado: null }, agora)).toBe("falhas");
    expect(corteFalhaSemProcessar(agora)).toBe("2026-10-17T11:00:00.000Z");
  });

  it("detalheDaVenda: mostra o resultado quando processou, 'não processada' quando caiu em falhas sem nunca processar, nada no resto", () => {
    expect(detalheDaVenda({ created_at: "x", processada_em: "y", resultado: "sem telefone" }, "falhas")).toBe("sem telefone");
    expect(detalheDaVenda({ created_at: "x", processada_em: null, resultado: null }, "falhas")).toBe(DETALHE_NAO_PROCESSADA);
    expect(detalheDaVenda({ created_at: "x", processada_em: null, resultado: null }, "processando")).toBeNull();
    expect(detalheDaVenda({ created_at: "x", processada_em: "y", resultado: null }, "sucesso")).toBeNull();
  });

  it("filtros de eventos: status, datas válidas e página (sem filtro de automações — revisão final B, item 6)", () => {
    expect(lerFiltrosEventos({})).toEqual({ status: "todos", de: "", ate: "", pagina: 1 });
    expect(lerFiltrosEventos({ status: "falhas", de: "2026-10-01", ate: "2026-02-31", pagina: "2" })).toEqual({ status: "falhas", de: "2026-10-01", ate: "", pagina: 2 });
    expect(lerFiltrosEventos({ status: "x", de: "ontem" })).toEqual({ status: "todos", de: "", ate: "", pagina: 1 });
  });

  it("limitesDatas: dias de Brasília inclusive", () => {
    expect(limitesDatas("2026-10-01", "2026-10-02")).toEqual({ desde: "2026-10-01T03:00:00.000Z", antes: "2026-10-03T03:00:00.000Z" });
    expect(limitesDatas("", "")).toEqual({ desde: null, antes: null });
  });

  it("urlEventos mantém a aba e os filtros", () => {
    const f = { status: "sucesso" as const, de: "2026-10-01", ate: "", pagina: 2 };
    expect(urlEventos("abc", f, { status: "todos" })).toBe("/webhooks/abc?aba=eventos&de=2026-10-01");
    expect(urlEventos("abc", f, { pagina: 3 })).toBe("/webhooks/abc?aba=eventos&status=sucesso&de=2026-10-01&pagina=3");
  });
});

describe("duracaoProcessamento", () => {
  it("sem processada_em: null", () => {
    expect(duracaoProcessamento("2026-10-17T10:00:00Z", null)).toBeNull();
  });
  it("segundos, minutos e horas", () => {
    expect(duracaoProcessamento("2026-10-17T10:00:00Z", "2026-10-17T10:00:30Z")).toBe("30 s");
    expect(duracaoProcessamento("2026-10-17T10:00:00Z", "2026-10-17T10:05:00Z")).toBe("5 min");
    expect(duracaoProcessamento("2026-10-17T10:00:00Z", "2026-10-17T12:00:00Z")).toBe("2 h");
  });
});
