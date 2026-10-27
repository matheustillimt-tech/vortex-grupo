import { beforeEach, describe, expect, it, vi } from "vitest";
import { liberarTudo, SEM_PERMISSAO, usarMembro } from "./apoio/permissoes";

/** Rotas de conectar número (QR, pareamento, status): exigem "editar" em Contas; sem → 403 sem tocar no Zapbot. */

const hoisted = vi.hoisted(() => ({
  credenciais: vi.fn(async () => ({ id: "z1", token: "t" })),
  status: vi.fn(async () => ({ connected: false })),
  qrCode: vi.fn(async () => ({ estado: "pronto", imagem: "data:image/png;base64,x" })),
  codigoPareamento: vi.fn(async () => ({ estado: "pronto", codigo: "ABCD-1234" })),
}));

vi.mock("@/src/lib/permissoes", async () => (await import("./apoio/permissoes")).permissoesFalsas());
vi.mock("@/src/lib/conexoes", () => ({ credenciais: hoisted.credenciais }));
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: vi.fn() }));
vi.mock("@/src/lib/zapbot/client", () => ({
  zapbot: () => ({ status: hoisted.status, qrCode: hoisted.qrCode, codigoPareamento: hoisted.codigoPareamento }),
}));

import { POST as pareamento } from "@/app/api/conexoes/[id]/pareamento/route";
import { GET as qr } from "@/app/api/conexoes/[id]/qr/route";
import { GET as status } from "@/app/api/conexoes/[id]/status/route";

const ctx = { params: Promise.resolve({ id: "c1" }) };
const pedidoPareamento = () => new Request("http://x/api/conexoes/c1/pareamento", { method: "POST", body: JSON.stringify({ telefone: "37" + "999990000" }) });

beforeEach(() => {
  vi.clearAllMocks();
  liberarTudo();
});

describe("rotas de conexão exigem editar em Conexões", () => {
  for (const [nome, chamar] of [
    ["qr", () => qr(new Request("http://x/api/conexoes/c1/qr"), ctx)],
    ["status", () => status(new Request("http://x/api/conexoes/c1/status"), ctx)],
    ["pareamento", () => pareamento(pedidoPareamento(), ctx)],
  ] as const) {
    it(`${nome}: só "ver" em Conexões → 403 com o erro, sem chamar o Zapbot`, async () => {
      usarMembro({ papel: "membro", permissoes: { contas: "ver" } });
      const res = await chamar();
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ erro: SEM_PERMISSAO });
      expect(hoisted.credenciais).not.toHaveBeenCalled();
    });

    it(`${nome}: sem linha em membros → 403`, async () => {
      usarMembro(null);
      expect((await chamar()).status).toBe(403);
    });

    it(`${nome}: com "editar" segue normal`, async () => {
      usarMembro({ papel: "membro", permissoes: { contas: "editar" } });
      const res = await chamar();
      expect(res.status).toBe(200);
      expect(hoisted.credenciais).toHaveBeenCalled();
    });
  }
});
