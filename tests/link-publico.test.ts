import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, type Chamada, type Resposta } from "./apoio/db-falso";

const hoisted = vi.hoisted(() => ({
  dbAtual: undefined as unknown,
  dispararAutomacoesMock: vi.fn(async (..._a: unknown[]) => 0),
  alertarMock: vi.fn(async (_a: unknown, _db?: unknown) => undefined),
}));

vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => hoisted.dbAtual }));
vi.mock("@/src/lib/automacoes", () => ({ dispararAutomacoes: hoisted.dispararAutomacoesMock, dispararPorPessoas: vi.fn(async () => 0), telefonesProtegidos: async () => new Set<string>() }));
vi.mock("@/src/lib/jobs/alertas", () => ({ alertar: hoisted.alertarMock }));

import { NextRequest } from "next/server";
import { GET } from "@/app/l/[slug]/route";

beforeEach(() => {
  vi.clearAllMocks();
});

const G1 = { id: "g1", nome: "Turma 01", numero: 1, cheio: false, ativo: true, link_convite: "https://chat.whatsapp.com/G1", participantes: 10, conferido_em: null };
const G2 = { id: "g2", nome: "Turma 02", numero: 2, cheio: false, ativo: true, link_convite: "https://chat.whatsapp.com/G2", participantes: 5, conferido_em: null };

function montar(camp: Record<string, unknown>, grupos: unknown[]) {
  const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
    if (c.tabela === "campanhas") return { data: { id: "c1", limite_por_grupo: 1000, arquivada: false, tipo: "campanha", termina_em: null, link_apos_termino: null, ...camp } };
    if (c.tabela === "grupos" && c.op === "select") return { data: grupos };
    return {};
  });
  hoisted.dbAtual = db;
  return chamadas;
}

function pedir(cookies: Record<string, string> = {}) {
  const headers: Record<string, string> = { "user-agent": "Safari" };
  if (Object.keys(cookies).length) headers.cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  return GET(new NextRequest("https://grupos.test/l/aulao", { headers }), { params: Promise.resolve({ slug: "aulao" }) });
}

describe("link público (/l/[slug]) — regressão do comportamento atual", () => {
  it("escolhe o grupo de menor número com vaga, registra o clique e grava o cookie de retorno", async () => {
    const chamadas = montar({}, [G1, G2]);
    const res = await pedir();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://chat.whatsapp.com/G1");
    const clique = chamadas.find((c) => c.tabela === "cliques" && c.op === "insert")!;
    expect((clique.dados as { grupo_id: string }).grupo_id).toBe("g1");
    expect(res.cookies.get("vg_aulao")?.value).toBe("g1");
    expect(res.cookies.get("vg_visitante")?.value).toBeTruthy();
  });

  it("quem já tem o cookie do grupo volta pro mesmo grupo, mesmo não sendo o de menor número", async () => {
    montar({}, [G1, G2]);
    const res = await pedir({ vg_aulao: "g2" });
    expect(res.headers.get("location")).toBe("https://chat.whatsapp.com/G2");
  });

  it("sem grupo com vaga: vai pra página de espera e registra a ação criar_grupo", async () => {
    const chamadas = montar({}, []);
    const res = await pedir();
    expect(res.headers.get("location")).toBe("https://grupos.test/l/aulao/abrir?espera=1");
    const acao = chamadas.find((c) => c.tabela === "acoes")!;
    expect(acao.dados).toEqual({ tipo: "criar_grupo", campanha_id: "c1", origem: "link-sem-vaga" });
    const clique = chamadas.find((c) => c.tabela === "cliques" && c.op === "insert")!;
    expect((clique.dados as { grupo_id: string | null }).grupo_id).toBeNull();
    expect(res.cookies.get("vg_aulao")).toBeUndefined();
  });

  it("campanha inexistente ou arquivada: 404 de link indisponível", async () => {
    const { db } = dbFalso((c: Chamada): Resposta => (c.tabela === "campanhas" ? { data: null } : {}));
    hoisted.dbAtual = db;
    const res = await pedir();
    expect(res.status).toBe(404);
  });
});

describe("link público — tipo aleatorio (Etapa 3D)", () => {
  it("sorteia entre os grupos com vaga", async () => {
    montar({ tipo: "aleatorio" }, [G1, G2]);
    const sorteio = vi.spyOn(Math, "random").mockReturnValue(0.9);
    const res = await pedir();
    sorteio.mockRestore();
    expect(res.headers.get("location")).toBe("https://chat.whatsapp.com/G2");
  });

  it("mesmo aleatorio, quem já tem cookie volta pro mesmo grupo", async () => {
    montar({ tipo: "aleatorio" }, [G1, G2]);
    const res = await pedir({ vg_aulao: "g1" });
    expect(res.headers.get("location")).toBe("https://chat.whatsapp.com/G1");
  });
});

describe("link público — tipos lista e viral se comportam como campanha", () => {
  it.each(["lista", "viral"])("tipo %s escolhe o de menor número, igual campanha", async (tipo) => {
    montar({ tipo }, [G1, G2]);
    const res = await pedir();
    expect(res.headers.get("location")).toBe("https://chat.whatsapp.com/G1");
  });
});

describe("link público — campanha terminada (Etapa 3D)", () => {
  const TERMINADA = { termina_em: "2020-01-01T00:00:00.000Z" };

  it("com link_apos_termino: redireciona pra ele, sem escolher grupo nem pedir grupo novo", async () => {
    const chamadas = montar({ ...TERMINADA, link_apos_termino: "https://exemplo.test/acabou" }, [G1, G2]);
    const res = await pedir();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://exemplo.test/acabou");
    expect(chamadas.some((c) => c.tabela === "grupos")).toBe(false);
    expect(chamadas.some((c) => c.tabela === "acoes")).toBe(false);
  });

  it("sem link_apos_termino: página \"Link indisponível\" (sem espera, que recarregaria em laço)", async () => {
    montar({ ...TERMINADA }, [G1, G2]);
    const res = await pedir();
    expect(res.headers.get("location")).toBe("https://grupos.test/l/aulao/abrir");
  });

  it("clique registrado não é clique de grupo (grupo_id null), mesmo com cookie de um grupo antigo", async () => {
    const chamadas = montar({ ...TERMINADA, link_apos_termino: "https://exemplo.test/acabou" }, [G1, G2]);
    await pedir({ vg_aulao: "g1" });
    const clique = chamadas.find((c) => c.tabela === "cliques" && c.op === "insert")!;
    expect((clique.dados as { grupo_id: string | null }).grupo_id).toBeNull();
  });

  it("não grava o cookie de retorno quando a campanha terminou", async () => {
    montar({ ...TERMINADA, link_apos_termino: "https://exemplo.test/acabou" }, [G1, G2]);
    const res = await pedir();
    expect(res.cookies.get("vg_aulao")).toBeUndefined();
  });

  it("termina_em no futuro: funciona normal (não terminou)", async () => {
    montar({ termina_em: "2099-01-01T00:00:00.000Z" }, [G1, G2]);
    const res = await pedir();
    expect(res.headers.get("location")).toBe("https://chat.whatsapp.com/G1");
  });
});

describe("link público — cheio manual e travas de criação (Etapa 3E)", () => {
  function montarComCliques(camp: Record<string, unknown>, grupos: unknown[], cliques: number) {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "campanhas") return { data: { id: "c1", limite_por_grupo: 1000, arquivada: false, tipo: "campanha", termina_em: null, link_apos_termino: null, ...camp } };
      if (c.tabela === "grupos" && c.op === "select") return { data: grupos };
      if (c.tabela === "grupos" && c.op === "update") return { data: [{ id: "x" }] };
      if (c.tabela === "cliques" && c.op === "select") return { count: cliques };
      return {};
    });
    hoisted.dbAtual = db;
    return chamadas;
  }
  const marcouCheio = (chamadas: Chamada[]) => chamadas.some((c) => c.tabela === "grupos" && c.op === "update" && (c.dados as { cheio?: boolean }).cheio === true);

  it("automático (cheio_manual null): marca cheio pela estimativa, como antes", async () => {
    const chamadas = montarComCliques({}, [{ ...G1, participantes: 999, cheio_manual: null }], 10);
    await pedir();
    expect(marcouCheio(chamadas)).toBe(true);
  });

  it("marcado não cheio à mão: a estimativa contra o limite da campanha não marca cheio", async () => {
    const chamadas = montarComCliques({}, [{ ...G1, participantes: 999, cheio_manual: false }], 10);
    const res = await pedir();
    expect(res.headers.get("location")).toBe("https://chat.whatsapp.com/G1");
    expect(marcouCheio(chamadas)).toBe(false);
  });

  it("marcado não cheio à mão, mas no limite do WhatsApp (1024): marca cheio mesmo assim", async () => {
    const chamadas = montarComCliques({}, [{ ...G1, participantes: 1020, cheio_manual: false }], 10);
    await pedir();
    expect(marcouCheio(chamadas)).toBe(true);
  });

  it("sem vaga e 'Não criar grupos' ligado: não pede grupo novo", async () => {
    const chamadas = montarComCliques({ nao_criar_grupos: true }, [], 0);
    const res = await pedir();
    expect(res.headers.get("location")).toBe("https://grupos.test/l/aulao/abrir?espera=1");
    expect(chamadas.some((c) => c.tabela === "acoes")).toBe(false);
  });

  it("sem vaga e cliques da última hora no limite: não pede grupo novo; abaixo do limite, pede", async () => {
    const travado = montarComCliques({ limite_cliques_sem_criar: 50 }, [], 50);
    await pedir();
    expect(travado.some((c) => c.tabela === "acoes")).toBe(false);
    const liberado = montarComCliques({ limite_cliques_sem_criar: 50 }, [], 49);
    await pedir();
    expect(liberado.find((c) => c.tabela === "acoes")?.dados).toEqual({ tipo: "criar_grupo", campanha_id: "c1", origem: "link-sem-vaga" });
  });
});

describe("link público — cheio manual (Etapa 3E, revisão)", () => {
  function montarG(grupos: unknown[], cliques = 0) {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "campanhas") return { data: { id: "c1", limite_por_grupo: 1000, arquivada: false, tipo: "campanha", termina_em: null, link_apos_termino: null } };
      if (c.tabela === "grupos" && c.op === "select") return { data: grupos };
      if (c.tabela === "grupos" && c.op === "update") return { data: [{ id: "x" }] };
      if (c.tabela === "cliques" && c.op === "select") return { count: cliques };
      return {};
    });
    hoisted.dbAtual = db;
    return chamadas;
  }

  it("marcado cheio à mão (mesmo com cheio ainda false) nunca recebe: vai pro próximo grupo", async () => {
    montarG([{ ...G1, cheio_manual: true }, { ...G2, cheio_manual: null }]);
    const res = await pedir();
    expect(res.headers.get("location")).toBe("https://chat.whatsapp.com/G2");
  });

  it("marcado cheio à mão: nem com o cookie de quem já entrou", async () => {
    montarG([{ ...G1, cheio_manual: true }, { ...G2, cheio_manual: null }]);
    const res = await pedir({ vg_aulao: "g1" });
    expect(res.headers.get("location")).toBe("https://chat.whatsapp.com/G2");
  });

  it("só grupos marcados cheios à mão: espera e pede grupo novo", async () => {
    const cs = montarG([{ ...G1, cheio_manual: true }]);
    const res = await pedir();
    expect(res.headers.get("location")).toBe("https://grupos.test/l/aulao/abrir?espera=1");
    expect(cs.some((c) => c.tabela === "acoes" && c.op === "insert")).toBe(true);
  });

  it("marcado não cheio que bate 1024 pela estimativa: marca cheio sem alerta nem automações", async () => {
    const cs = montarG([{ ...G1, participantes: 1020, cheio_manual: false }], 10);
    await pedir();
    expect(cs.some((c) => c.tabela === "grupos" && c.op === "update")).toBe(true);
    expect(hoisted.alertarMock).not.toHaveBeenCalled();
    expect(hoisted.dispararAutomacoesMock).not.toHaveBeenCalled();
  });

  it("automático (null) que enche pela estimativa: alerta e automações como antes", async () => {
    montarG([{ ...G1, participantes: 999, cheio_manual: null }], 10);
    await pedir();
    expect(hoisted.alertarMock).toHaveBeenCalledWith(expect.objectContaining({ tipo: "grupo_cheio" }), expect.anything());
    expect(hoisted.dispararAutomacoesMock).toHaveBeenCalledWith({ campanhaId: "c1", gatilho: "grupo_cheio", grupoId: "g1" }, expect.any(Date), expect.anything());
  });
});

describe("link público — seções da campanha (Etapa 3J)", () => {
  function pedirComo(userAgent: string, cookies: Record<string, string> = {}) {
    const headers: Record<string, string> = { "user-agent": userAgent };
    if (Object.keys(cookies).length) headers.cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
    return GET(new NextRequest("https://grupos.test/l/aulao", { headers }), { params: Promise.resolve({ slug: "aulao" }) });
  }
  const ANDROID = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36";

  it("padrões da migração (cookie ligado, deep linking desligado): igual a hoje", async () => {
    montar({ cookie_redirecionamento: true, deep_linking: false }, [G1, G2]);
    const res = await pedir({ vg_aulao: "g2" });
    expect(res.headers.get("location")).toBe("https://chat.whatsapp.com/G2");
    expect(res.cookies.get("vg_aulao")?.value).toBe("g2");
    const celular = await pedirComo(ANDROID);
    expect(celular.headers.get("location")).toBe("https://chat.whatsapp.com/G1");
  });

  it("cookie desligado: não volta pro grupo do cookie e não grava vg_{slug} (vg_visitante continua)", async () => {
    const chamadas = montar({ cookie_redirecionamento: false }, [G1, G2]);
    const res = await pedir({ vg_aulao: "g2" });
    expect(res.headers.get("location")).toBe("https://chat.whatsapp.com/G1");
    expect(res.cookies.get("vg_aulao")).toBeUndefined();
    expect(res.cookies.get("vg_visitante")?.value).toBeTruthy();
    const clique = chamadas.find((c) => c.tabela === "cliques" && c.op === "insert")!;
    expect((clique.dados as { grupo_id: string }).grupo_id).toBe("g1");
  });

  it("deep linking ligado: celular vai pra página de abrir; computador vai direto", async () => {
    montar({ deep_linking: true }, [G1, G2]);
    const celular = await pedirComo(ANDROID);
    expect(celular.headers.get("location")).toBe("https://grupos.test/l/aulao/abrir?g=g1");
    expect(celular.cookies.get("vg_aulao")?.value).toBe("g1");
    montar({ deep_linking: true }, [G1, G2]);
    const pc = await pedir();
    expect(pc.headers.get("location")).toBe("https://chat.whatsapp.com/G1");
  });
});

describe("link público — robô de pré-visualização", () => {
  it("o robô do WhatsApp vai pro convite, mas não soma clique nem conexão na lotação", async () => {
    const chamadas = montar({}, [G1, G2]);
    const res = await GET(new NextRequest("https://grupos.test/l/aulao", { headers: { "user-agent": "WhatsApp/2.23.20.0" } }), { params: Promise.resolve({ slug: "aulao" }) });
    expect(res.headers.get("location")).toBe("https://chat.whatsapp.com/G1");
    expect(chamadas.some((c) => c.tabela === "cliques")).toBe(false);
  });
});
