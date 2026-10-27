import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso } from "./apoio/db-falso";
import { liberarTudo, negarTudo } from "./apoio/permissoes";

const hoisted = vi.hoisted(() => ({ dbAtual: undefined as unknown }));

vi.mock("@/src/lib/permissoes", async () => (await import("./apoio/permissoes")).permissoesFalsas());
vi.mock("@/src/lib/supabase/usuario", () => ({ dbUsuario: async () => hoisted.dbAtual, exigirUsuario: async () => ({ id: "u1" }) }));

import { verificarMidiasExpiradas } from "@/app/(painel)/modelos/midias";

const MSG_COM_MIDIA = (url: string) => ({
  versao: 2,
  mensagens: [{ formato: "imagem", midia_url: url, nome_arquivo: null, legenda: "" }],
  opcoes: {},
});
const MSG_SEM_MIDIA = { versao: 2, mensagens: [{ formato: "texto", texto: "Oi" }], opcoes: {} };

function usar(linhas: { id: string; nome: string; conteudo: unknown }[]) {
  const f = dbFalso(() => ({ data: linhas }));
  hoisted.dbAtual = f.db;
  return f.chamadas;
}

const respostaFetch = (ok: boolean) => vi.fn(async () => ({ status: ok ? 200 : 404 }) as Response);

beforeEach(() => {
  vi.clearAllMocks();
  liberarTudo();
  vi.stubGlobal("fetch", respostaFetch(true));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("verificarMidiasExpiradas", () => {
  it("exige modelos/ver", async () => {
    negarTudo();
    usar([]);
    const r = await verificarMidiasExpiradas();
    expect("erro" in r).toBe(true);
  });

  it("sem modelos com mídia: lista vazia, sem checar nada", async () => {
    usar([{ id: "1", nome: "Sem mídia", conteudo: MSG_SEM_MIDIA }]);
    const r = await verificarMidiasExpiradas();
    expect(r).toEqual({ expiradas: [], naoVerificadas: [] });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("mídia que responde 2xx: não entra como expirada", async () => {
    usar([{ id: "1", nome: "Ok", conteudo: MSG_COM_MIDIA("https://exemplo.com/a.png") }]);
    const r = await verificarMidiasExpiradas();
    expect(r).toEqual({ expiradas: [], naoVerificadas: [] });
    expect(fetch).toHaveBeenCalledWith("https://exemplo.com/a.png", expect.objectContaining({ method: "HEAD", redirect: "manual" }));
  });

  it("mídia que responde não-2xx entra como expirada", async () => {
    vi.stubGlobal("fetch", respostaFetch(false));
    usar([{ id: "1", nome: "Quebrada", conteudo: MSG_COM_MIDIA("https://exemplo.com/a.png") }]);
    const r = await verificarMidiasExpiradas();
    expect(r).toEqual({ expiradas: [{ id: "1", nome: "Quebrada" }], naoVerificadas: [] });
  });

  it("falha de rede (timeout etc.) também conexão como expirada", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("abortado"); }));
    usar([{ id: "1", nome: "Caiu", conteudo: MSG_COM_MIDIA("https://exemplo.com/a.png") }]);
    const r = await verificarMidiasExpiradas();
    expect(r).toEqual({ expiradas: [{ id: "1", nome: "Caiu" }], naoVerificadas: [] });
  });

  it("nunca checa http (só https) nem host privado — nem chega a chamar fetch", async () => {
    usar([
      { id: "1", nome: "Http", conteudo: MSG_COM_MIDIA("http://exemplo.com/a.png") },
      { id: "2", nome: "Privado", conteudo: MSG_COM_MIDIA("https://192.168.0.5/a.png") },
      { id: "3", nome: "Localhost", conteudo: MSG_COM_MIDIA("https://localhost/a.png") },
    ]);
    const r = await verificarMidiasExpiradas();
    expect(r).toEqual({ expiradas: [], naoVerificadas: [] });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("erro do banco vira erro", async () => {
    const f = dbFalso(() => ({ error: { message: "x" } }));
    hoisted.dbAtual = f.db;
    const r = await verificarMidiasExpiradas();
    expect("erro" in r).toBe(true);
  });

  it("HEAD com 405 tenta de novo com GET + Range antes de considerar expirada", async () => {
    const chamadas: { metodo: string | undefined }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        chamadas.push({ metodo: init?.method });
        if (init?.method === "HEAD") return { status: 405 } as Response;
        return { status: 200 } as Response;
      }),
    );
    usar([{ id: "1", nome: "SoDeixaGet", conteudo: MSG_COM_MIDIA("https://exemplo.com/a.png") }]);
    const r = await verificarMidiasExpiradas();
    expect(r).toEqual({ expiradas: [], naoVerificadas: [] });
    expect(chamadas).toEqual([{ metodo: "HEAD" }, { metodo: "GET" }]);
    expect(fetch).toHaveBeenLastCalledWith(
      "https://exemplo.com/a.png",
      expect.objectContaining({ method: "GET", headers: { Range: "bytes=0-0" } }),
    );
  });

  it("HEAD com 403 também tenta de novo com GET + Range", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => ({ status: init?.method === "HEAD" ? 403 : 200 }) as Response),
    );
    usar([{ id: "1", nome: "Bloqueado", conteudo: MSG_COM_MIDIA("https://exemplo.com/a.png") }]);
    const r = await verificarMidiasExpiradas();
    expect(r).toEqual({ expiradas: [], naoVerificadas: [] });
  });

  it("GET de retentativa também falhando entra como expirada", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 405 }) as Response));
    usar([{ id: "1", nome: "SemJeito", conteudo: MSG_COM_MIDIA("https://exemplo.com/a.png") }]);
    const r = await verificarMidiasExpiradas();
    expect(r).toEqual({ expiradas: [{ id: "1", nome: "SemJeito" }], naoVerificadas: [] });
  });

  it("orçamento total esgotado: o que não deu tempo de checar vira não verificado", async () => {
    const original = Date.now;
    let agora = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => agora);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        agora += 25_000; // passa do orçamento de 20s a cada chamada
        return { status: 200 } as Response;
      }),
    );
    usar([
      { id: "1", nome: "Primeiro", conteudo: MSG_COM_MIDIA("https://exemplo.com/a.png") },
      { id: "2", nome: "SemTempo", conteudo: MSG_COM_MIDIA("https://exemplo.com/b.png") },
    ]);
    const r = await verificarMidiasExpiradas();
    Date.now = original;
    expect(r).toEqual({ expiradas: [], naoVerificadas: [{ id: "2", nome: "SemTempo" }] });
  });
});
