import { permissoesEfetivas, type Membro, type Papel } from "@/src/lib/regras/permissoes";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { Abas } from "../../_componentes/abas";
import { Cartao, Pagina, Selo } from "../../_componentes/ui";
import { ABAS_EQUIPE } from "../comum";
import { CartaoPermissoes } from "./cartao";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";

export const dynamic = "force-dynamic";

type LinhaMembroCompleta = { usuario_id: string; nome: string; papel: Papel; permissoes: Record<string, unknown> };
type UsuarioAuthResumo = { id: string; email?: string | null };

export default async function Permissoes() {
  const b = await bloqueio("equipe");
  if (b) return b;
  const db = dbAdmin();

  const [{ data: usuarios }, { data: membrosData }] = await Promise.all([
    db.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    db.from("membros").select("usuario_id, nome, papel, permissoes"),
  ]);

  const membros = (membrosData ?? []) as LinhaMembroCompleta[];
  const nomes = new Map(((usuarios?.users ?? []) as UsuarioAuthResumo[]).map((u) => [u.id, u.email ?? "Sem e-mail"]));

  const admins = membros.filter((m) => m.papel === "admin");
  const soMembros = membros
    .filter((m) => m.papel === "membro")
    .map((m) => ({ ...m, nomeExibicao: m.nome.trim() || nomes.get(m.usuario_id) || "Sem nome" }))
    .sort((a, b) => a.nomeExibicao.localeCompare(b.nomeExibicao, "pt-BR"));

  return (
    <Pagina titulo="Equipe">
      <Abas itens={ABAS_EQUIPE} />
      {admins.length > 0 && (
        <Cartao titulo="Administradores">
          <p className="flex flex-wrap items-center gap-2 text-sm text-vg-text-2">
            <span>{admins.map((a) => nomes.get(a.usuario_id) ?? a.usuario_id).join(", ")}</span>
            <Selo cor="destaque" semPonto>
              Acesso total
            </Selo>
          </p>
        </Cartao>
      )}
      {soMembros.length === 0 ? (
        <p className="text-sm text-vg-muted">Nenhum Membro ainda.</p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {soMembros.map((m) => (
            <CartaoPermissoes
              key={m.usuario_id}
              usuarioId={m.usuario_id}
              nome={m.nomeExibicao}
              permissoesIniciais={permissoesEfetivas({ papel: m.papel, permissoes: m.permissoes } as Membro)}
            />
          ))}
        </div>
      )}
    </Pagina>
  );
}
