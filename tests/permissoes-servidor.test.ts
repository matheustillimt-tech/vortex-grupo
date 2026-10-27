import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, filtro, type Chamada, type Resposta } from "./apoio/db-falso";

const hoisted = vi.hoisted(() => ({
  dbAtual: undefined as unknown,
  adminAtual: undefined as unknown,
  exigirUsuarioMock: vi.fn(async () => ({ id: "u1", email: "u1@exemplo.com" })),
}));

vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => hoisted.adminAtual }));
vi.mock("@/src/lib/supabase/usuario", () => ({ exigirUsuario: hoisted.exigirUsuarioMock, dbUsuario: async () => hoisted.dbAtual }));

import { areasVisiveis, checarPermissao, exigirPermissao, membroAtual, permitido, SEM_PERMISSAO, SemPermissao } from "@/src/lib/permissoes";

/** `linha`: o que a leitura de `membros` devolve (null = sem linha); `erro`: a leitura falha. */
function usarLinha(linha: unknown, erro?: { message: string }) {
  const f = dbFalso((c: Chamada): Resposta => {
    if (c.tabela === "membros") return erro ? { error: erro } : { data: linha };
    return {};
  });
  hoisted.dbAtual = f.db;
  return f.chamadas;
}

/** O que a leitura de reserva (`dbAdmin`) devolve. */
function usarAdmin(r: Resposta) {
  const f = dbFalso((c: Chamada): Resposta => (c.tabela === "membros" ? r : {}));
  hoisted.adminAtual = f.db;
  return f.chamadas;
}

beforeEach(() => {
  vi.clearAllMocks();
  usarAdmin({ error: { message: "não devia ser chamado" } });
  hoisted.exigirUsuarioMock.mockResolvedValue({ id: "u1", email: "u1@exemplo.com" });
});

describe("membroAtual", () => {
  it("lê só a própria linha em membros (papel e permissões)", async () => {
    const chamadas = usarLinha({ papel: "membro", permissoes: { leads: "ver" } });
    const r = await membroAtual();
    expect(r.usuario.id).toBe("u1");
    expect(r.membro).toEqual({ papel: "membro", permissoes: { leads: "ver" } });
    const leitura = chamadas.find((c) => c.tabela === "membros")!;
    expect(filtro(leitura, "eq", "usuario_id")).toBe("u1");
  });

  it("sem linha: membro null", async () => {
    usarLinha(null);
    expect((await membroAtual()).membro).toBeNull();
  });

  it("erro na leitura pela RLS: tenta uma vez pelo servidor (dbAdmin) e usa a linha de lá", async () => {
    const erroLog = vi.spyOn(console, "error").mockImplementation(() => {});
    usarLinha(null, { message: "falhou" });
    const admin = usarAdmin({ data: { papel: "membro", permissoes: { leads: "ver" } } });
    const r = await membroAtual();
    expect(r.membro).toEqual({ papel: "membro", permissoes: { leads: "ver" } });
    expect(filtro(admin.find((c) => c.tabela === "membros")!, "eq", "usuario_id")).toBe("u1");
    expect(erroLog).toHaveBeenCalled();
    erroLog.mockRestore();
  });

  it("leitura pela RLS que lança também cai no servidor", async () => {
    const erroLog = vi.spyOn(console, "error").mockImplementation(() => {});
    hoisted.dbAtual = { from: () => { throw new Error("rede"); } };
    usarAdmin({ data: { papel: "admin", permissoes: {} } });
    expect((await membroAtual()).membro?.papel).toBe("admin");
    erroLog.mockRestore();
  });

  it("erro nas duas leituras: membro null e registra no log", async () => {
    const erroLog = vi.spyOn(console, "error").mockImplementation(() => {});
    usarLinha(null, { message: "falhou" });
    usarAdmin({ error: { message: "também falhou" } });
    expect((await membroAtual()).membro).toBeNull();
    expect(erroLog).toHaveBeenCalledTimes(2);
    erroLog.mockRestore();
  });

  it("sem linha (sem erro) não consulta o servidor: continua sem acesso", async () => {
    usarLinha(null);
    const admin = usarAdmin({ data: { papel: "admin", permissoes: {} } });
    expect((await membroAtual()).membro).toBeNull();
    expect(admin).toHaveLength(0);
  });

  it("sem sessão: o redirect do exigirUsuario sobe", async () => {
    hoisted.exigirUsuarioMock.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    usarLinha(null);
    await expect(membroAtual()).rejects.toThrow("NEXT_REDIRECT");
  });
});

describe("Administrador", () => {
  beforeEach(() => void usarLinha({ papel: "admin", permissoes: {} }));

  it("edita qualquer área, inclusive Equipe", async () => {
    await expect(exigirPermissao("webhooks", "editar")).resolves.toMatchObject({ usuario: { id: "u1" } });
    expect(await permitido("equipe", "editar")).toBe(true);
    expect(await checarPermissao("antispam", "editar")).toMatchObject({ ok: true, usuario: { id: "u1" } });
  });

  it("vê todas as áreas e Equipe", async () => {
    const areas = await areasVisiveis();
    expect(areas).toContain("equipe");
    expect(areas).toHaveLength(12);
  });
});

describe("Membro", () => {
  beforeEach(() => void usarLinha({ papel: "membro", permissoes: { leads: "ver", campanhas: "editar", webhooks: "nenhum" } }));

  it("ver: vê, mas não edita", async () => {
    expect(await permitido("leads", "ver")).toBe(true);
    expect(await permitido("leads", "editar")).toBe(false);
    await expect(exigirPermissao("leads", "editar")).rejects.toBeInstanceOf(SemPermissao);
    expect(await checarPermissao("leads", "editar")).toEqual({ ok: false, erro: SEM_PERMISSAO });
  });

  it("editar: vê e edita", async () => {
    expect(await permitido("campanhas", "ver")).toBe(true);
    await expect(exigirPermissao("campanhas", "editar")).resolves.toMatchObject({ membro: { papel: "membro" } });
  });

  it("nenhum: nem vê", async () => {
    expect(await permitido("webhooks", "ver")).toBe(false);
    await expect(exigirPermissao("webhooks", "ver")).rejects.toThrow(SEM_PERMISSAO);
  });

  it("nunca Equipe; áreas visíveis sem as de 'nenhum'", async () => {
    expect(await permitido("equipe", "ver")).toBe(false);
    const areas = await areasVisiveis();
    expect(areas).not.toContain("equipe");
    expect(areas).not.toContain("webhooks");
    expect(areas).toContain("leads");
    expect(areas).toContain("projetos"); // não salva = padrão de Membro ("editar")
  });
});

describe("sem linha em membros (null)", () => {
  beforeEach(() => void usarLinha(null));

  it("nada liberado", async () => {
    expect(await permitido("campanhas", "ver")).toBe(false);
    expect(await areasVisiveis()).toEqual([]);
    await expect(exigirPermissao("campanhas", "ver")).rejects.toBeInstanceOf(SemPermissao);
    expect(await checarPermissao("historico", "ver")).toEqual({ ok: false, erro: SEM_PERMISSAO });
  });
});
