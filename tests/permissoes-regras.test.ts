import { describe, expect, it } from "vitest";
import {
  AREAS_PERMISSAO,
  NIVEIS,
  ROTULO_NIVEL,
  areaDoCaminho,
  normalizarPermissoes,
  pode,
  permissoesEfetivas,
  verificarMudancaPapel,
  verificarRemocao,
  type Membro,
} from "@/src/lib/regras/permissoes";

describe("AREAS_PERMISSAO", () => {
  it("traz as 11 áreas na ordem da spec, com soVer em métricas e histórico", () => {
    expect(AREAS_PERMISSAO.map((a) => a.chave)).toEqual([
      "campanhas",
      "projetos",
      "contas",
      "metricas",
      "automacoes",
      "leads",
      "antispam",
      "modelos",
      "variaveis",
      "webhooks",
      "historico",
    ]);
    const soVer = AREAS_PERMISSAO.filter((a) => a.soVer).map((a) => a.chave);
    expect(soVer).toEqual(["metricas", "historico"]);
    for (const a of AREAS_PERMISSAO) expect(a.rotulo).toBeTruthy();
  });
});

describe("NIVEIS e ROTULO_NIVEL", () => {
  it("3 níveis com rótulo pt-BR", () => {
    expect(NIVEIS).toEqual(["nenhum", "ver", "editar"]);
    expect(ROTULO_NIVEL).toEqual({ nenhum: "Sem acesso", ver: "Ver", editar: "Editar" });
  });
});

describe("permissoesEfetivas", () => {
  it("null (sem linha) é tudo 'nenhum'", () => {
    const r = permissoesEfetivas(null);
    for (const a of AREAS_PERMISSAO) expect(r[a.chave]).toBe("nenhum");
  });

  it("admin é tudo 'editar', mesmo com permissões salvas vazias ou lixo", () => {
    const r = permissoesEfetivas({ papel: "admin", permissoes: {} });
    for (const a of AREAS_PERMISSAO) expect(r[a.chave]).toBe("editar");
    const r2 = permissoesEfetivas({ papel: "admin", permissoes: { campanhas: "nenhum" } });
    for (const a of AREAS_PERMISSAO) expect(r2[a.chave]).toBe("editar");
  });

  it("membro sem permissões salvas usa o padrão: tudo editar, menos soVer que é ver", () => {
    const r = permissoesEfetivas({ papel: "membro", permissoes: {} });
    expect(r.campanhas).toBe("editar");
    expect(r.projetos).toBe("editar");
    expect(r.contas).toBe("editar");
    expect(r.metricas).toBe("ver");
    expect(r.automacoes).toBe("editar");
    expect(r.leads).toBe("editar");
    expect(r.antispam).toBe("editar");
    expect(r.modelos).toBe("editar");
    expect(r.variaveis).toBe("editar");
    expect(r.webhooks).toBe("editar");
    expect(r.historico).toBe("ver");
  });

  it("membro com permissões salvas válidas sobrescreve o padrão", () => {
    const r = permissoesEfetivas({ papel: "membro", permissoes: { campanhas: "nenhum", leads: "ver" } });
    expect(r.campanhas).toBe("nenhum");
    expect(r.leads).toBe("ver");
    expect(r.projetos).toBe("editar"); // não sobrescrita: continua no padrão
  });

  it("membro com salvo inválido (chave desconhecida ou nível errado) ignora e mantém o padrão", () => {
    const r = permissoesEfetivas({ papel: "membro", permissoes: { campanhas: "tudo", desconhecida: "editar" } });
    expect(r.campanhas).toBe("editar");
  });

  it("área soVer salva como 'editar' é limitada a 'ver' (via normalização)", () => {
    const r = permissoesEfetivas({ papel: "membro", permissoes: { metricas: "editar" } });
    expect(r.metricas).toBe("ver");
  });
});

describe("pode", () => {
  const admin: Membro = { papel: "admin", permissoes: {} };
  const membroPadrao: Membro = { papel: "membro", permissoes: {} };
  const membroSemCampanhas: Membro = { papel: "membro", permissoes: { campanhas: "nenhum" } };
  const membroVeCampanhas: Membro = { papel: "membro", permissoes: { campanhas: "ver" } };

  it("'equipe' só vale pra admin", () => {
    expect(pode(admin, "equipe", "ver")).toBe(true);
    expect(pode(admin, "equipe", "editar")).toBe(true);
    expect(pode(membroPadrao, "equipe", "ver")).toBe(false);
    expect(pode(membroPadrao, "equipe", "editar")).toBe(false);
    expect(pode(null, "equipe", "ver")).toBe(false);
  });

  it("'nenhum' na área recusa ver e editar", () => {
    expect(pode(membroSemCampanhas, "campanhas", "ver")).toBe(false);
    expect(pode(membroSemCampanhas, "campanhas", "editar")).toBe(false);
  });

  it("'ver' na área permite ver mas não editar", () => {
    expect(pode(membroVeCampanhas, "campanhas", "ver")).toBe(true);
    expect(pode(membroVeCampanhas, "campanhas", "editar")).toBe(false);
  });

  it("'editar' na área permite ver e editar", () => {
    expect(pode(membroPadrao, "campanhas", "ver")).toBe(true);
    expect(pode(membroPadrao, "campanhas", "editar")).toBe(true);
  });

  it("null nunca pode nada", () => {
    expect(pode(null, "campanhas", "ver")).toBe(false);
    expect(pode(null, "equipe", "ver")).toBe(false);
  });
});

describe("normalizarPermissoes", () => {
  it("mantém só chaves conhecidas com nível válido", () => {
    expect(normalizarPermissoes({ campanhas: "ver", xyz: "editar", leads: "editar" })).toEqual({
      campanhas: "ver",
      leads: "editar",
    });
  });

  it("descarta nível inválido", () => {
    expect(normalizarPermissoes({ campanhas: "tudo" })).toEqual({});
  });

  it("área soVer com 'editar' vira 'ver'; com 'ver' ou 'nenhum' mantém", () => {
    expect(normalizarPermissoes({ metricas: "editar", historico: "editar" })).toEqual({ metricas: "ver", historico: "ver" });
    expect(normalizarPermissoes({ metricas: "ver" })).toEqual({ metricas: "ver" });
    expect(normalizarPermissoes({ metricas: "nenhum" })).toEqual({ metricas: "nenhum" });
  });

  it("entrada não-objeto (null, array, string, undefined, número) vira objeto vazio", () => {
    expect(normalizarPermissoes(null)).toEqual({});
    expect(normalizarPermissoes(undefined)).toEqual({});
    expect(normalizarPermissoes([])).toEqual({});
    expect(normalizarPermissoes("campanhas")).toEqual({});
    expect(normalizarPermissoes(42)).toEqual({});
  });

  it("objeto vazio vira objeto vazio", () => {
    expect(normalizarPermissoes({})).toEqual({});
  });
});

describe("areaDoCaminho", () => {
  it("'/' e caminho desconhecido (ex.: /login) são null", () => {
    expect(areaDoCaminho("/")).toBeNull();
    expect(areaDoCaminho("/login")).toBeNull();
    expect(areaDoCaminho("/qualquer-coisa")).toBeNull();
  });

  it.each([
    ["/campanhas", "campanhas"],
    ["/campanhas/abc", "campanhas"],
    ["/campanhas/abc/grupos", "campanhas"],
    ["/calendario", "campanhas"],
    ["/acoes", "campanhas"],
    ["/acoes/123", "campanhas"],
    ["/projetos", "projetos"],
    ["/projetos/123", "projetos"],
    ["/numeros", "contas"],
    ["/metricas", "metricas"],
    ["/alertas", "metricas"],
    ["/automacoes", "automacoes"],
    ["/automacoes/1", "automacoes"],
    ["/sequencias", "automacoes"],
    ["/leads", "leads"],
    ["/anti-spam", "antispam"],
    ["/blacklists", "antispam"],
    ["/blacklists/11111111-2222-3333-4444-555555555555", "antispam"],
    ["/modelos", "modelos"],
    ["/variaveis", "variaveis"],
    ["/hooks", "webhooks"],
    ["/hooks/historico", "webhooks"],
    ["/webhooks", "webhooks"],
    ["/integracoes", "webhooks"],
    ["/api-externa", "webhooks"],
    ["/mcp", "webhooks"],
    ["/deeplinks", "campanhas"],
    ["/historico", "historico"],
    ["/equipe", "equipe"],
  ])("%s → %s", (caminho, area) => {
    expect(areaDoCaminho(caminho)).toBe(area);
  });

  it("ignora query string e hash", () => {
    expect(areaDoCaminho("/campanhas/abc/grupos?aba=ativos#topo")).toBe("campanhas");
  });
});

const EU = "11111111-1111-4111-8111-111111111111";
const OUTRO_ADMIN = "22222222-2222-4222-8222-222222222222";
const MEMBRO = "33333333-3333-4333-8333-333333333333";

describe("verificarMudancaPapel", () => {
  it("promover a admin nunca dá erro", () => {
    expect(verificarMudancaPapel({ admins: [EU], alvo: MEMBRO, novoPapel: "admin", eu: EU })).toBeNull();
  });

  it("rebaixar quem não é admin não dá erro", () => {
    expect(verificarMudancaPapel({ admins: [EU], alvo: MEMBRO, novoPapel: "membro", eu: EU })).toBeNull();
  });

  it("rebaixar o último admin dá erro (inclusive rebaixar a si mesmo)", () => {
    expect(verificarMudancaPapel({ admins: [EU], alvo: EU, novoPapel: "membro", eu: EU })).toBe(
      "Precisa ficar pelo menos um Administrador.",
    );
  });

  it("rebaixar a si mesmo quando existem outros admins é permitido", () => {
    expect(verificarMudancaPapel({ admins: [EU, OUTRO_ADMIN], alvo: EU, novoPapel: "membro", eu: EU })).toBeNull();
  });

  it("rebaixar outro admin quando existem outros admins além do alvo é permitido", () => {
    expect(verificarMudancaPapel({ admins: [EU, OUTRO_ADMIN], alvo: OUTRO_ADMIN, novoPapel: "membro", eu: EU })).toBeNull();
  });
});

describe("verificarRemocao", () => {
  it("remover a si mesmo dá erro, mesmo havendo outros admins", () => {
    expect(verificarRemocao({ admins: [EU, OUTRO_ADMIN], alvo: EU, eu: EU })).toBe("Você não pode remover o próprio acesso.");
  });

  it("remover o último admin (não sendo a própria pessoa) dá erro", () => {
    expect(verificarRemocao({ admins: [OUTRO_ADMIN], alvo: OUTRO_ADMIN, eu: EU })).toBe(
      "Precisa ficar pelo menos um Administrador.",
    );
  });

  it("remover um membro comum não dá erro", () => {
    expect(verificarRemocao({ admins: [EU], alvo: MEMBRO, eu: EU })).toBeNull();
  });

  it("remover um admin quando existem outros admins não dá erro", () => {
    expect(verificarRemocao({ admins: [EU, OUTRO_ADMIN], alvo: OUTRO_ADMIN, eu: EU })).toBeNull();
  });
});
