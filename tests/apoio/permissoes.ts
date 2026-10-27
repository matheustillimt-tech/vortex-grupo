import { vi } from "vitest";
import { AREAS_PERMISSAO, pode, type AreaOuEquipe, type Membro } from "@/src/lib/regras/permissoes";

/** Troca de `@/src/lib/permissoes` nos testes de ações e rotas:
 *
 *    vi.mock("@/src/lib/permissoes", async () => (await import("./apoio/permissoes")).permissoesFalsas());
 *
 *  Por padrão libera tudo (Administrador). `usarMembro(...)` muda quem está logado pro próximo teste e
 *  `liberarTudo()` volta ao padrão (chame no `beforeEach`). O usuário vem do `exigirUsuario` mockado no próprio
 *  teste (`@/src/lib/supabase/usuario`), quando houver — assim os testes de "sem sessão" continuam valendo. */

export const SEM_PERMISSAO = "Você não tem permissão para isso.";

const ADMIN: Membro = { papel: "admin", permissoes: {} };

export const estadoPermissoes: { membro: Membro | null; usuario: { id: string; email?: string | null } } = {
  membro: ADMIN,
  usuario: { id: "u1", email: "u1@exemplo.com" },
};

export function liberarTudo() {
  estadoPermissoes.membro = ADMIN;
}

/** Ex.: `usarMembro({ papel: "membro", permissoes: { leads: "ver" } })` ou `usarMembro(null)` (sem linha). */
export function usarMembro(membro: Membro | null) {
  estadoPermissoes.membro = membro;
}

/** Membro sem acesso nenhum (tudo "nenhum"): o jeito mais curto de testar a recusa. */
export function negarTudo() {
  const permissoes: Record<string, string> = {};
  for (const a of AREAS_PERMISSAO) permissoes[a.chave] = "nenhum";
  usarMembro({ papel: "membro", permissoes });
}

async function usuarioAtual() {
  const mod = (await import("@/src/lib/supabase/usuario").catch(() => ({}))) as { exigirUsuario?: () => Promise<{ id: string; email?: string | null }> };
  return typeof mod.exigirUsuario === "function" ? await mod.exigirUsuario() : estadoPermissoes.usuario;
}

export function permissoesFalsas() {
  class SemPermissao extends Error {
    constructor(mensagem: string = SEM_PERMISSAO) {
      super(mensagem);
      this.name = "SemPermissao";
    }
  }
  const membroAtual = vi.fn(async () => ({ usuario: await usuarioAtual(), membro: estadoPermissoes.membro }));
  return {
    SEM_PERMISSAO,
    SemPermissao,
    membroAtual,
    exigirPermissao: vi.fn(async (area: AreaOuEquipe, nivel: "ver" | "editar") => {
      const acesso = await membroAtual();
      if (!pode(acesso.membro, area, nivel)) throw new SemPermissao();
      return acesso;
    }),
    checarPermissao: vi.fn(async (area: AreaOuEquipe, nivel: "ver" | "editar") => {
      const acesso = await membroAtual();
      if (!pode(acesso.membro, area, nivel)) return { ok: false as const, erro: SEM_PERMISSAO };
      return { ok: true as const, ...acesso };
    }),
    permitido: vi.fn(async (area: AreaOuEquipe, nivel: "ver" | "editar") => pode(estadoPermissoes.membro, area, nivel)),
    areasVisiveis: vi.fn(async () =>
      ([...AREAS_PERMISSAO.map((a) => a.chave), "equipe"] as AreaOuEquipe[]).filter((a) => pode(estadoPermissoes.membro, a, "ver")),
    ),
  };
}
