import { beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import { dbFalso, filtro, type Chamada, type Resposta } from "./apoio/db-falso";
import { liberarTudo, usarMembro } from "./apoio/permissoes";

const hoisted = vi.hoisted(() => ({ dbAtual: undefined as unknown }));
vi.mock("@/src/lib/permissoes", async () => (await import("./apoio/permissoes")).permissoesFalsas());
vi.mock("@/src/lib/supabase/usuario", () => ({ dbUsuario: async () => hoisted.dbAtual }));

import { GET } from "@/app/api/exportar/bloqueados/route";
import { GET as GET_PESSOAS } from "@/app/api/exportar/pessoas/route";

beforeEach(() => liberarTudo());

function comAuth(db: unknown, user: unknown) {
  return Object.assign({}, db as object, { auth: { getUser: async () => ({ data: { user } }) } });
}

describe("exportações exigem 'ver' na área (403 sem)", () => {
  it("bloqueados: sem 'ver' em Anti-spam → 403, sem ler o banco", async () => {
    usarMembro({ papel: "membro", permissoes: { antispam: "nenhum", leads: "editar" } });
    const { db, chamadas } = dbFalso();
    hoisted.dbAtual = comAuth(db, { id: "u1" });
    const res = await GET(new Request("http://x/api/exportar/bloqueados"));
    expect(res.status).toBe(403);
    expect(chamadas).toHaveLength(0);
  });

  it("pessoas: sem 'ver' em Leads → 403, sem ler o banco", async () => {
    usarMembro({ papel: "membro", permissoes: { leads: "nenhum" } });
    const { db, chamadas } = dbFalso();
    hoisted.dbAtual = comAuth(db, { id: "u1" });
    const res = await GET_PESSOAS(new Request("http://x/api/exportar/pessoas"));
    expect(res.status).toBe(403);
    expect(chamadas).toHaveLength(0);
  });

  it("'ver' basta pra exportar (bloqueados com Anti-spam em Ver)", async () => {
    usarMembro({ papel: "membro", permissoes: { antispam: "ver" } });
    const { db } = dbFalso(() => ({ data: [] }));
    hoisted.dbAtual = comAuth(db, { id: "u1" });
    const res = await GET(new Request("http://x/api/exportar/bloqueados"));
    expect(res.status).toBe(200);
  });

  it("sem sessão continua 401", async () => {
    usarMembro(null);
    const { db } = dbFalso();
    hoisted.dbAtual = comAuth(db, null);
    expect((await GET_PESSOAS(new Request("http://x/api/exportar/pessoas"))).status).toBe(401);
  });
});

describe("GET /api/exportar/bloqueados", () => {
  it("401 sem sessão", async () => {
    const { db } = dbFalso();
    hoisted.dbAtual = comAuth(db, null);
    const res = await GET(new Request("http://x/api/exportar/bloqueados"));
    expect(res.status).toBe(401);
  });

  it("gera CSV com os bloqueados, paginando de 1000", async () => {
    const pagina1 = Array.from({ length: 1000 }, (_, i) => ({
      telefone: `55379990${String(i).padStart(4, "0")}`,
      motivo: null,
      origem: "manual",
      created_at: "2026-10-16T12:00:00Z",
    }));
    const pagina2 = [{ telefone: "5537" + "999099999", motivo: "spam de link", origem: "csv", created_at: "2026-10-16T12:00:00Z" }];
    let chamada = 0;
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "bloqueados") {
        chamada++;
        return { data: chamada === 1 ? pagina1 : pagina2 };
      }
      return {};
    });
    hoisted.dbAtual = comAuth(db, { id: "u1" });

    const res = await GET(new Request("http://x/api/exportar/bloqueados"));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain('filename="bloqueados-');
    const texto = await res.text();
    const linhas = texto.split("\r\n").filter(Boolean);
    expect(linhas[0].endsWith("Telefone;Motivo;Origem;Criado em")).toBe(true);
    expect(linhas.length).toBe(1 + pagina1.length + pagina2.length);
    expect(linhas.at(-1)).toBe("55 37 " + "99909-9999;spam de link;Planilha;16/10/2026 09:00");
    expect(chamada).toBe(2);
    // created_at sozinho não é único (inserção em lote compartilha o now() da transação): a paginação por
    // offset precisa de uma segunda coluna de ordenação única pra não pular/repetir linha entre páginas.
    for (const c of chamadas.filter((c) => c.tabela === "bloqueados")) {
      expect(filtro(c, "order", "created_at")).toBeDefined();
      expect(filtro(c, "order", "telefone")).toEqual({ ascending: true });
    }
  });

  it("devolve erro 500 quando o banco falha", async () => {
    const { db } = dbFalso(() => ({ error: { message: "deu ruim" } }));
    hoisted.dbAtual = comAuth(db, { id: "u1" });
    const res = await GET(new Request("http://x/api/exportar/bloqueados"));
    expect(res.status).toBe(500);
  });
});

describe("exportar pessoas com ?campanhas=", () => {
  it("todos os valores inválidos → 400, sem exportar tudo (nenhuma consulta)", async () => {
    usarMembro({ papel: "membro", permissoes: { leads: "ver" } });
    const { db, chamadas } = dbFalso(() => ({ data: [] }));
    hoisted.dbAtual = comAuth(db, { id: "u1" });
    const res = await GET_PESSOAS(new Request("http://x/api/exportar/pessoas?campanhas=x,y"));
    expect(res.status).toBe(400);
    expect(chamadas).toHaveLength(0);
    expect((await GET_PESSOAS(new Request("http://x/api/exportar/pessoas?campanhas="))).status).toBe(400);
  });

  it("um id válido → 200, filtrando por essa campanha", async () => {
    usarMembro({ papel: "membro", permissoes: { leads: "ver" } });
    const { db, chamadas } = dbFalso(() => ({ data: [] }));
    hoisted.dbAtual = comAuth(db, { id: "u1" });
    const U = "11111111-1111-4111-8111-111111111111";
    const res = await GET_PESSOAS(new Request(`http://x/api/exportar/pessoas?campanhas=${U},lixo`));
    expect(res.status).toBe(200);
    // A linha de "Ver exportações" (insert em `exportacoes`, Etapa 3K) não conta: só as leituras de `listar_pessoas`.
    expect(chamadas.filter((c) => c.tabela === "rpc:listar_pessoas").map((c) => (c.dados as { p_campanha: string }).p_campanha)).toEqual([U]);
  });
});

describe("GET /api/exportar/blacklists/[id]", () => {
  const ID = "11111111-1111-1111-1111-111111111111";
  const ctx = { params: Promise.resolve({ id: ID }) };

  it("401 sem sessão e 403 sem 'ver' em Anti-spam, sem ler o banco", async () => {
    const { GET: GET_BL } = await import("@/app/api/exportar/blacklists/[id]/route");
    const { db, chamadas } = dbFalso();
    hoisted.dbAtual = comAuth(db, null);
    expect((await GET_BL(new Request("http://x"), ctx)).status).toBe(401);
    usarMembro({ papel: "membro", permissoes: { antispam: "nenhum" } });
    hoisted.dbAtual = comAuth(db, { id: "u1" });
    expect((await GET_BL(new Request("http://x"), ctx)).status).toBe(403);
    expect(chamadas).toHaveLength(0);
  });

  it("CSV com telefone legível e data, só da lista pedida", async () => {
    const { GET: GET_BL } = await import("@/app/api/exportar/blacklists/[id]/route");
    usarMembro({ papel: "membro", permissoes: { antispam: "ver" } });
    const { db, chamadas } = dbFalso((c) =>
      c.tabela === "blacklists" ? { data: { nome: "L" } } : { data: [{ telefone: "5511" + "999990001", created_at: "2026-10-17T12:00:00Z" }] },
    );
    hoisted.dbAtual = comAuth(db, { id: "u1" });
    const res = await GET_BL(new Request("http://x"), ctx);
    expect(res.status).toBe(200);
    const texto = await res.text();
    expect(texto).toContain("Telefone;Adicionado em");
    expect(texto).toContain("55 11 " + "99999-0001;17/10/2026 09:00");
    expect(filtro(chamadas.find((c) => c.tabela === "blacklist_numeros")!, "eq", "blacklist_id")).toBe(ID);
  });
});
