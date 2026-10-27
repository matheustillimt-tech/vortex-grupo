import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, type Chamada, type Resposta } from "./apoio/db-falso";
import { liberarTudo, usarMembro } from "./apoio/permissoes";

const hoisted = vi.hoisted(() => ({ dbAtual: undefined as unknown }));
vi.mock("@/src/lib/permissoes", async () => (await import("./apoio/permissoes")).permissoesFalsas());
vi.mock("@/src/lib/supabase/usuario", () => ({ dbUsuario: async () => hoisted.dbAtual }));

import { GET } from "@/app/api/exportar/grupos/route";

beforeEach(() => liberarTudo());

function comAuth(db: unknown, user: unknown) {
  return Object.assign({}, db as object, { auth: { getUser: async () => ({ data: { user } }) } });
}

const CAMP = "999" + "99999-2222-3333-4444-555555555555";

describe("GET /api/exportar/grupos", () => {
  it("401 sem sessão", async () => {
    const { db } = dbFalso();
    hoisted.dbAtual = comAuth(db, null);
    const res = await GET(new Request(`http://x/api/exportar/grupos?campanha=${CAMP}`));
    expect(res.status).toBe(401);
  });

  it("403 sem 'ver' em Campanhas, sem ler o banco", async () => {
    usarMembro({ papel: "membro", permissoes: { campanhas: "nenhum" } });
    const { db, chamadas } = dbFalso();
    hoisted.dbAtual = comAuth(db, { id: "u1" });
    const res = await GET(new Request(`http://x/api/exportar/grupos?campanha=${CAMP}`));
    expect(res.status).toBe(403);
    expect(chamadas).toHaveLength(0);
  });

  it("400 sem ?campanha= válido", async () => {
    usarMembro({ papel: "membro", permissoes: { campanhas: "ver" } });
    const { db, chamadas } = dbFalso();
    hoisted.dbAtual = comAuth(db, { id: "u1" });
    const res = await GET(new Request("http://x/api/exportar/grupos?campanha=lixo"));
    expect(res.status).toBe(400);
    expect(chamadas).toHaveLength(0);
  });

  it("gera o CSV com os grupos, mesmo com 'ver' só (sem precisar de 'editar')", async () => {
    usarMembro({ papel: "membro", permissoes: { campanhas: "ver" } });
    const { db } = dbFalso((c: Chamada): Resposta =>
      c.tabela === "grupos"
        ? {
            data: [
              { numero: 1, nome: "Aulão #1", link_convite: "https://chat.whatsapp.com/abc", participantes: 120, cheio: false, created_at: "2026-10-16T12:00:00Z", conexoes: { nome: "Número 1" } },
            ],
          }
        : {},
    );
    hoisted.dbAtual = comAuth(db, { id: "u1" });
    const res = await GET(new Request(`http://x/api/exportar/grupos?campanha=${CAMP}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain('filename="grupos-');
    const texto = await res.text();
    const linhas = texto.split("\r\n").filter(Boolean);
    expect(linhas[0].endsWith("Número;Nome;Link;Participantes;Cheio;Conexão;Criado em")).toBe(true);
    expect(linhas[1]).toBe("1;Aulão #1;https://chat.whatsapp.com/abc;120;Não;Número 1;16/10/2026 09:00");
  });

  it("erro do banco: 500", async () => {
    usarMembro({ papel: "membro", permissoes: { campanhas: "ver" } });
    const { db } = dbFalso(() => ({ error: { message: "deu ruim" } }));
    hoisted.dbAtual = comAuth(db, { id: "u1" });
    const res = await GET(new Request(`http://x/api/exportar/grupos?campanha=${CAMP}`));
    expect(res.status).toBe(500);
  });
});
