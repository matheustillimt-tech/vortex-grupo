import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, type Chamada, type Resposta } from "./apoio/db-falso";
import { liberarTudo, usarMembro } from "./apoio/permissoes";

const h = vi.hoisted(() => ({
  db: undefined as unknown,
  bloquear: vi.fn(async (..._a: unknown[]) => ({ novos: 1, jaEstavam: 0, remocoes: 0, ignorados: [] as string[] })),
}));

vi.mock("@/src/lib/permissoes", async () => (await import("./apoio/permissoes")).permissoesFalsas());
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => h.db }));
vi.mock("@/src/lib/supabase/usuario", () => ({ exigirUsuario: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/src/lib/historico", () => ({ registrarHistorico: vi.fn() }));
vi.mock("@/src/lib/bloqueio", () => ({ bloquearTelefones: h.bloquear }));

import { adicionarNumeroBloqueado, salvarAntispamContas } from "@/app/(painel)/anti-spam/actions";

const A = "11111111-1111-1111-1111-111111111111";

function usar(responder?: (c: Chamada) => Resposta) {
  const f = dbFalso(responder);
  h.db = f.db;
  return f.chamadas;
}

beforeEach(() => {
  vi.clearAllMocks();
  liberarTudo();
});

describe("adicionarNumeroBloqueado", () => {
  it("exige nome e telefone válido; grava com o nome pelo bloqueio de sempre", async () => {
    usar();
    expect((await adicionarNumeroBloqueado("  ", "11" + "999990001")).erro).toBeTruthy();
    expect((await adicionarNumeroBloqueado("Fulano", "123")).erro).toBe("Telefone inválido.");
    expect(h.bloquear).not.toHaveBeenCalled();
    const r = await adicionarNumeroBloqueado(" Fulano ", "(11) " + "99999-0001");
    expect(r.erro).toBeUndefined();
    expect(h.bloquear).toHaveBeenCalledWith(expect.anything(), [{ telefone: "5511" + "999990001", motivo: null, nome: "Fulano" }], "manual", "u1");
  });

  it("sem antispam/editar não grava", async () => {
    usar();
    usarMembro({ papel: "membro", permissoes: { antispam: "ver" } });
    expect((await adicionarNumeroBloqueado("Fulano", "11" + "999990001")).erro).toBeTruthy();
    expect(h.bloquear).not.toHaveBeenCalled();
  });
});

describe("salvarAntispamContas", () => {
  it("grava em configuracoes (antispam_contas) depois de conferir as conexões", async () => {
    const chamadas = usar((c) => (c.tabela === "conexoes" ? { data: [{ id: A }] } : {}));
    expect(await salvarAntispamContas({ ligado: true, contas: [A] })).toEqual({});
    const up = chamadas.find((c) => c.op === "upsert")!;
    expect(up.tabela).toBe("configuracoes");
    expect(up.dados).toEqual({ chave: "antispam_contas", valor: { ligado: true, contas: [A] } });
  });

  it("conexão que não existe mais e ligado sem conexão recusam sem gravar", async () => {
    const chamadas = usar((c) => (c.tabela === "conexoes" ? { data: [] } : {}));
    expect((await salvarAntispamContas({ ligado: true, contas: [A] })).erro).toBeTruthy();
    expect((await salvarAntispamContas({ ligado: true, contas: [] })).erro).toBeTruthy();
    expect(chamadas.some((c) => c.op === "upsert")).toBe(false);
  });

  it("sem antispam/editar não grava", async () => {
    const chamadas = usar();
    usarMembro({ papel: "membro", permissoes: { antispam: "ver" } });
    expect((await salvarAntispamContas({ ligado: false, contas: [] })).erro).toBeTruthy();
    expect(chamadas).toEqual([]);
  });
});
