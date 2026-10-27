import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, type Chamada, type Resposta } from "./apoio/db-falso";
import { liberarTudo, usarMembro } from "./apoio/permissoes";

const hoisted = vi.hoisted(() => ({ dbAtual: undefined as unknown }));
vi.mock("@/src/lib/permissoes", async () => (await import("./apoio/permissoes")).permissoesFalsas());
vi.mock("@/src/lib/supabase/usuario", () => ({ dbUsuario: async () => hoisted.dbAtual }));

import { GET } from "@/app/api/exportar/automacao/[id]/route";

const A1 = "11111111-1111-1111-1111-111111111111";

function comAuth(db: unknown, user: unknown) {
  return Object.assign({}, db as object, { auth: { getUser: async () => ({ data: { user } }) } });
}

async function chamar(db: unknown, qs = "") {
  return GET(new Request(`http://x/api/exportar/automacao/${A1}${qs}`), { params: Promise.resolve({ id: A1 }) });
}

beforeEach(() => liberarTudo());

describe("GET /api/exportar/automacao/[id]: permissão e validação básica", () => {
  it("id inválido → 400, sem ler o banco", async () => {
    const { db, chamadas } = dbFalso();
    hoisted.dbAtual = comAuth(db, { id: "u1" });
    const res = await GET(new Request("http://x/api/exportar/automacao/nao-e-uuid"), { params: Promise.resolve({ id: "nao-e-uuid" }) });
    expect(res.status).toBe(400);
    expect(chamadas).toHaveLength(0);
  });

  it("sem sessão → 401", async () => {
    const { db } = dbFalso();
    hoisted.dbAtual = comAuth(db, null);
    expect((await chamar(db)).status).toBe(401);
  });

  it("sem 'ver' em automações → 403", async () => {
    usarMembro({ papel: "membro", permissoes: { automacoes: "nenhum", leads: "ver" } });
    const { db, chamadas } = dbFalso();
    hoisted.dbAtual = comAuth(db, { id: "u1" });
    const res = await chamar(db);
    expect(res.status).toBe(403);
    expect(chamadas).toHaveLength(0);
  });

  it("sem 'ver' em leads → 403, mesmo vendo automações", async () => {
    usarMembro({ papel: "membro", permissoes: { automacoes: "ver", leads: "nenhum" } });
    const { db, chamadas } = dbFalso();
    hoisted.dbAtual = comAuth(db, { id: "u1" });
    const res = await chamar(db);
    expect(res.status).toBe(403);
    expect(chamadas).toHaveLength(0);
  });

  it("automação não encontrada → 404", async () => {
    usarMembro({ papel: "membro", permissoes: { automacoes: "ver", leads: "ver" } });
    const { db } = dbFalso((c: Chamada): Resposta => (c.tabela === "automacoes" ? { data: null } : {}));
    hoisted.dbAtual = comAuth(db, { id: "u1" });
    expect((await chamar(db)).status).toBe(404);
  });
});

describe("GET /api/exportar/automacao/[id]: CSV", () => {
  function banco(linhas: { telefone: string; status: string }[]) {
    let chamada = 0;
    return dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "automacoes") return { data: { id: A1 } };
      if (c.tabela === "acoes") {
        chamada++;
        return { data: chamada === 1 ? linhas : [] };
      }
      return {};
    });
  }

  it("'todos': dedupe por telefone, só a coluna Telefone", async () => {
    const { db } = banco([
      { telefone: "5537" + "980001001", status: "ok" },
      { telefone: "5537" + "980001001", status: "erro" },
      { telefone: "5537" + "980001002", status: "fila" },
    ]);
    hoisted.dbAtual = comAuth(db, { id: "u1" });
    const res = await chamar(db);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain('filename="automacao-numeros-');
    const linhas = (await res.text()).split("\r\n").filter(Boolean);
    expect(linhas[0].endsWith("Telefone")).toBe(true);
    expect(linhas.length).toBe(1 + 2); // cabeçalho + 2 telefones únicos
  });

  it("'com_status': uma linha por tentativa, com a situação traduzida", async () => {
    const { db } = banco([
      { telefone: "5537" + "980001001", status: "ok" },
      { telefone: "5537" + "980001001", status: "erro" },
    ]);
    hoisted.dbAtual = comAuth(db, { id: "u1" });
    const res = await chamar(db, "?tipo=com_status");
    const linhas = (await res.text()).split("\r\n").filter(Boolean);
    expect(linhas[0].endsWith("Telefone;Situação")).toBe(true);
    expect(linhas.length).toBe(1 + 2); // sem dedupe
    expect(linhas[1]).toContain("Sucesso");
    expect(linhas[2]).toContain("Falha");
  });

  it("'falhas': só quem deu erro, filtrando no banco (não em memória)", async () => {
    let filtroStatus: unknown;
    const { db } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "automacoes") return { data: { id: A1 } };
      if (c.tabela === "acoes") {
        filtroStatus = c.filtros.find((f) => f[0] === "eq" && f[1] === "status")?.[2];
        return { data: [{ telefone: "5537" + "980001001", status: "erro" }] };
      }
      return {};
    });
    hoisted.dbAtual = comAuth(db, { id: "u1" });
    const res = await chamar(db, "?tipo=falhas");
    expect(filtroStatus).toBe("erro");
    const linhas = (await res.text()).split("\r\n").filter(Boolean);
    expect(linhas.length).toBe(2);
    expect(res.headers.get("content-disposition")).toContain('filename="automacao-falhas-');
  });

  it("erro do banco → 500", async () => {
    const { db } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "automacoes") return { data: { id: A1 } };
      if (c.tabela === "acoes") return { error: { message: "deu ruim" } };
      return {};
    });
    hoisted.dbAtual = comAuth(db, { id: "u1" });
    expect((await chamar(db)).status).toBe(500);
  });
});
