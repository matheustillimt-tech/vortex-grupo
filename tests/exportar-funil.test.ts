import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, type Chamada, type Resposta } from "./apoio/db-falso";
import { liberarTudo, usarMembro } from "./apoio/permissoes";

const hoisted = vi.hoisted(() => ({ dbAtual: undefined as unknown }));
vi.mock("@/src/lib/permissoes", async () => (await import("./apoio/permissoes")).permissoesFalsas());
vi.mock("@/src/lib/supabase/usuario", () => ({ dbUsuario: async () => hoisted.dbAtual }));

import { GET } from "@/app/api/exportar/funil/route";

beforeEach(() => liberarTudo());

function comAuth(db: unknown, user: unknown) {
  return Object.assign({}, db as object, { auth: { getUser: async () => ({ data: { user } }) } });
}

describe("GET /api/exportar/funil", () => {
  it("401 sem sessão", async () => {
    const { db } = dbFalso();
    hoisted.dbAtual = comAuth(db, null);
    const res = await GET(new Request("http://x/api/exportar/funil"));
    expect(res.status).toBe(401);
  });

  it("403 sem 'ver' em Métricas", async () => {
    usarMembro({ papel: "membro", permissoes: { metricas: "nenhum" } });
    const { db } = dbFalso();
    hoisted.dbAtual = comAuth(db, { id: "u1" });
    const res = await GET(new Request("http://x/api/exportar/funil"));
    expect(res.status).toBe(403);
  });

  it("gera o CSV com o resumo do período", async () => {
    usarMembro({ papel: "membro", permissoes: { metricas: "ver" } });
    const { db } = dbFalso((c: Chamada): Resposta =>
      c.tabela === "campanhas" ? { data: [{ id: "c1", nome: "Campanha 1", projeto_id: null }] } : { data: [] },
    );
    hoisted.dbAtual = comAuth(db, { id: "u1" });
    const res = await GET(new Request("http://x/api/exportar/funil"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
  });

  it("erro ao carregar campanhas: 500 com mensagem genérica, detalhe só no log", async () => {
    usarMembro({ papel: "membro", permissoes: { metricas: "ver" } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db } = dbFalso((c: Chamada): Resposta => (c.tabela === "campanhas" ? { error: { message: "detalhe-sensivel-do-banco" } } : { data: [] }));
    hoisted.dbAtual = comAuth(db, { id: "u1" });
    const res = await GET(new Request("http://x/api/exportar/funil"));
    expect(res.status).toBe(500);
    const texto = await res.text();
    expect(texto).not.toContain("detalhe-sensivel-do-banco");
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls.some((args) => JSON.stringify(args).includes("detalhe-sensivel-do-banco"))).toBe(true);
    spy.mockRestore();
  });

  it("erro ao carregar o resumo (rpc): 500 com mensagem genérica, detalhe só no log", async () => {
    usarMembro({ papel: "membro", permissoes: { metricas: "ver" } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db } = dbFalso((c: Chamada): Resposta =>
      c.tabela === "campanhas" ? { data: [] } : c.tabela === "rpc:resumo_campanhas" ? { error: { message: "outro-detalhe-sensivel" } } : {},
    );
    hoisted.dbAtual = comAuth(db, { id: "u1" });
    const res = await GET(new Request("http://x/api/exportar/funil"));
    expect(res.status).toBe(500);
    const texto = await res.text();
    expect(texto).not.toContain("outro-detalhe-sensivel");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
