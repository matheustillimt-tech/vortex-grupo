import { describe, expect, it } from "vitest";
import {
  ABAS_CONTAS,
  estaPausado,
  filtrarContas,
  lerAbaContas,
  lerAbaDetalheConta,
  lerOrdemContas,
  OPCOES_ORDEM_CONTAS,
  validarNomeConexao,
  webhookValeParaCampanhas,
  type ContaLista,
} from "@/src/lib/regras/contas";

const c = (id: string, nome: string, status: string, created_at: string, telefone: string | null = null, projeto: string | null = null): ContaLista =>
  ({ id, nome, telefone, status, created_at, ultimo_erro: null, pausado_ate: null, projeto_id: projeto, projeto_nome: projeto });
const l = [
  c("1", "Loja Centro", "conectado", "2026-10-03T00:00:00Z", "5537" + "980002003"),
  c("2", "Captação Vórtex", "desconectado", "2026-10-01T00:00:00Z", "553780001001"),
  c("3", "Novo", "pendente", "2026-10-02T00:00:00Z"),
];

describe("contas", () => {
  it("abas", () => {
    expect(ABAS_CONTAS.map((a) => a.rotulo)).toEqual(["Todas", "Conectadas", "Desconectadas", "Sem sessão"]);
    expect(lerAbaContas("sem_sessao")).toBe("sem_sessao");
    expect(lerAbaContas("x")).toBe("todas");
  });
  it("lerAbaDetalheConta: abre em 'Ações' por padrão; 'webhooks' só é válida com permitido('webhooks','ver')", () => {
    expect(lerAbaDetalheConta("webhooks", true)).toBe("webhooks");
    expect(lerAbaDetalheConta("webhooks", false)).toBe("acoes");
    expect(lerAbaDetalheConta("campanhas", false)).toBe("campanhas"); // outras abas não mudam
    expect(lerAbaDetalheConta(undefined, true)).toBe("acoes");
    expect(lerAbaDetalheConta("lixo", true)).toBe("acoes");
    // regressão: link antigo `?aba=grupos` continua abrindo a aba Grupos (não a padrão nova).
    expect(lerAbaDetalheConta("grupos", true)).toBe("grupos");
  });
  it("ordenação: os 4 rótulos + 'Nome' (revisão final); valor inválido cai em 'criacao'", () => {
    expect(OPCOES_ORDEM_CONTAS.map((o) => o.rotulo)).toEqual(["Data de criação", "Data de atualização", "Posição", "Por projeto", "Nome"]);
    expect(lerOrdemContas("projeto")).toBe("projeto");
    expect(lerOrdemContas("nome")).toBe("nome");
    expect(lerOrdemContas("x")).toBe("criacao");
  });
  it("ordena 'Nome' em ordem alfabética (pt-BR)", () => {
    expect(filtrarContas(l, { aba: "todas", busca: "", ordem: "nome" }).map((x) => x.id)).toEqual(["2", "1", "3"]);
  });
  it("filtra por aba, ordena por criação (atualização e posição caem na mesma ordem, sem coluna própria)", () => {
    expect(filtrarContas(l, { aba: "todas", busca: "", ordem: "criacao" }).map((x) => x.id)).toEqual(["2", "3", "1"]);
    expect(filtrarContas(l, { aba: "todas", busca: "", ordem: "atualizacao" }).map((x) => x.id)).toEqual(["2", "3", "1"]);
    expect(filtrarContas(l, { aba: "todas", busca: "", ordem: "posicao" }).map((x) => x.id)).toEqual(["2", "3", "1"]);
    expect(filtrarContas(l, { aba: "conectadas", busca: "", ordem: "criacao" }).map((x) => x.id)).toEqual(["1"]);
    expect(filtrarContas(l, { aba: "desconectadas", busca: "", ordem: "criacao" }).map((x) => x.id)).toEqual(["2"]);
    expect(filtrarContas(l, { aba: "sem_sessao", busca: "", ordem: "criacao" }).map((x) => x.id)).toEqual(["3"]);
  });
  it("ordena 'Por projeto' por nome do projeto e depois por nome da conexão; sem projeto vai pro final", () => {
    const comProjetos = [
      c("1", "Zeta", "conectado", "2026-10-03T00:00:00Z", null, "Beta"),
      c("2", "Alfa", "conectado", "2026-10-01T00:00:00Z", null, "Beta"),
      c("3", "Sem pasta", "conectado", "2026-10-02T00:00:00Z", null, null),
      c("4", "Qualquer", "conectado", "2026-10-04T00:00:00Z", null, "Alfa"),
    ];
    expect(filtrarContas(comProjetos, { aba: "todas", busca: "", ordem: "projeto" }).map((x) => x.id)).toEqual(["4", "2", "1", "3"]);
  });
  it("busca por nome sem acento ou por telefone", () => {
    expect(filtrarContas(l, { aba: "todas", busca: "vortex", ordem: "criacao" }).map((x) => x.id)).toEqual(["2"]);
    expect(filtrarContas(l, { aba: "todas", busca: "8000-2003", ordem: "criacao" }).map((x) => x.id)).toEqual(["1"]);
  });
  it("valida nome", () => {
    expect(validarNomeConexao("  Vendas  ")).toEqual({ ok: true, nome: "Vendas" });
    expect(validarNomeConexao("")).toEqual({ ok: false, erro: "Dê um nome de até 40 caracteres." });
    expect(validarNomeConexao("x".repeat(41))).toEqual({ ok: false, erro: "Dê um nome de até 40 caracteres." });
  });
});

describe("estaPausado", () => {
  const agora = new Date("2026-10-16T12:00:00Z");

  it("false sem pausado_ate", () => {
    expect(estaPausado(null, agora)).toBe(false);
  });

  it("true quando pausado_ate está no futuro", () => {
    expect(estaPausado("2026-10-16T13:00:00Z", agora)).toBe(true);
  });

  it("false quando pausado_ate já passou", () => {
    expect(estaPausado("2026-10-16T11:00:00Z", agora)).toBe(false);
  });
});

describe("webhookValeParaCampanhas (aba Webhooks do detalhe da conexão)", () => {
  it("campanhas null vale pra qualquer campanha (webhook geral)", () => {
    expect(webhookValeParaCampanhas(null, ["c1"])).toBe(true);
    expect(webhookValeParaCampanhas(null, [])).toBe(true);
  });

  it("lista: vale só quando alguma campanha da conexão está nela", () => {
    expect(webhookValeParaCampanhas(["c1", "c2"], ["c2"])).toBe(true);
    expect(webhookValeParaCampanhas(["c1", "c2"], ["c3"])).toBe(false);
    expect(webhookValeParaCampanhas(["c1"], [])).toBe(false);
  });
});
