import type { Papel } from "@/src/lib/regras/permissoes";
import type { Aba } from "../_componentes/abas";

/** Abas do topo das telas de Equipe. */
export const ABAS_EQUIPE: Aba[] = [
  { href: "/equipe", rotulo: "Equipe", exato: true },
  { href: "/equipe/permissoes", rotulo: "Permissões" },
];

/** Só os campos de `auth.admin.listUsers()` usados aqui. */
export type UsuarioAuthResumo = { id: string; email?: string | null; last_sign_in_at?: string | null };

/** Linha de `membros` (sem `permissoes`, que só a aba Permissões usa). */
export type LinhaMembroDb = { usuario_id: string; nome: string; papel: Papel };

export type MembroListado = {
  id: string;
  email: string | null;
  nome: string;
  papel: Papel;
  /** false = tem usuário no `auth.users` mas nenhuma linha em `membros` (edge case: mostra "Sem acesso"). */
  temAcesso: boolean;
  ultimoAcesso: string | null;
};

/** Junta `auth.admin.listUsers()` com `membros`. Quem não tem linha em `membros` (edge case) aparece como
 *  "Membro" sem acesso nenhum. Ordena Administradores primeiro, depois por nome (ou e-mail, sem nome). */
export function montarListaMembros(usuarios: UsuarioAuthResumo[], membros: LinhaMembroDb[]): MembroListado[] {
  const porId = new Map(membros.map((m) => [m.usuario_id, m]));
  const lista: MembroListado[] = usuarios.map((u) => {
    const m = porId.get(u.id);
    const nome = m?.nome?.trim();
    return {
      id: u.id,
      email: u.email ?? null,
      nome: nome || u.email || "Sem nome",
      papel: m?.papel ?? "membro",
      temAcesso: !!m,
      ultimoAcesso: u.last_sign_in_at ?? null,
    };
  });
  return lista.sort((a, b) => {
    if (a.papel !== b.papel) return a.papel === "admin" ? -1 : 1;
    return a.nome.localeCompare(b.nome, "pt-BR");
  });
}
