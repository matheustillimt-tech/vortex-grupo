import "server-only";
import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import { AREAS_PERMISSAO, pode, type AreaOuEquipe, type Membro } from "./regras/permissoes";
import { dbAdmin } from "./supabase/admin";
import { dbUsuario, exigirUsuario } from "./supabase/usuario";

/** Permissões no painel (Etapa 2K): quem está logado + a própria linha em `membros` (lida pela RLS, só a dela).
 *  Sem linha ou com erro na leitura → `membro: null` → nenhuma área liberada (nem Equipe). */

export const SEM_PERMISSAO = "Você não tem permissão para isso.";

export class SemPermissao extends Error {
  constructor(mensagem: string = SEM_PERMISSAO) {
    super(mensagem);
    this.name = "SemPermissao";
  }
}

export type Acesso = { usuario: User; membro: Membro | null };
export type Nivel = "ver" | "editar";

type LinhaMembro = { papel: Membro["papel"]; permissoes: Record<string, unknown> | null };
type Leitura = { ok: true; linha: LinhaMembro | null } | { ok: false; erro: unknown };

async function lerLinha(ler: () => PromiseLike<{ data: unknown; error: unknown }>): Promise<Leitura> {
  try {
    const { data, error } = await ler();
    if (error) return { ok: false, erro: error };
    return { ok: true, linha: (data as LinhaMembro | null) ?? null };
  } catch (e) {
    return { ok: false, erro: e };
  }
}

/** Uma leitura por requisição (`cache`): layout, página e ações da mesma renderização reaproveitam.
 *  Lê pela RLS (`dbUsuario`); se essa leitura der erro (não "sem linha"), tenta uma vez com `dbAdmin` — o usuário
 *  já foi confirmado pelo `getUser` do `exigirUsuario`. Sem linha continua sendo "sem acesso". */
export const membroAtual = cache(async (): Promise<Acesso> => {
  const usuario = await exigirUsuario();
  let r = await lerLinha(async () => (await dbUsuario()).from("membros").select("papel, permissoes").eq("usuario_id", usuario.id).maybeSingle());
  if (!r.ok) {
    console.error("[permissoes] leitura de membros pela RLS falhou; tentando pelo servidor", r.erro);
    r = await lerLinha(() => dbAdmin().from("membros").select("papel, permissoes").eq("usuario_id", usuario.id).maybeSingle());
    if (!r.ok) {
      console.error("[permissoes] não foi possível ler a linha em membros", r.erro);
      return { usuario, membro: null };
    }
  }
  if (!r.linha) return { usuario, membro: null };
  return { usuario, membro: { papel: r.linha.papel, permissoes: r.linha.permissoes ?? {} } };
});

/** Pra ações que lançam (ou devolvem void): libera e devolve `{ usuario, membro }`, ou lança `SemPermissao`. */
export async function exigirPermissao(area: AreaOuEquipe, nivel: Nivel): Promise<Acesso> {
  const acesso = await membroAtual();
  if (!pode(acesso.membro, area, nivel)) throw new SemPermissao();
  return acesso;
}

/** Pra ações que devolvem `{ erro }`: `{ ok: true, usuario, membro }` ou `{ ok: false, erro }` (sem lançar). */
export async function checarPermissao(area: AreaOuEquipe, nivel: Nivel): Promise<({ ok: true } & Acesso) | { ok: false; erro: string }> {
  const acesso = await membroAtual();
  if (!pode(acesso.membro, area, nivel)) return { ok: false, erro: SEM_PERMISSAO };
  return { ok: true, ...acesso };
}

/** Sim/não, sem lançar (páginas, layout, rotas de exportação). */
export async function permitido(area: AreaOuEquipe, nivel: Nivel): Promise<boolean> {
  const { membro } = await membroAtual();
  return pode(membro, area, nivel);
}

/** Áreas com pelo menos "ver" (e "equipe" pra Administrador): dados simples pro menu e pra home (cliente). */
export async function areasVisiveis(): Promise<AreaOuEquipe[]> {
  const { membro } = await membroAtual();
  const todas: AreaOuEquipe[] = [...AREAS_PERMISSAO.map((a) => a.chave), "equipe"];
  return todas.filter((a) => pode(membro, a, "ver"));
}
