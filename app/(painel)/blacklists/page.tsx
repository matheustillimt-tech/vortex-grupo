import { permitido } from "@/src/lib/permissoes";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { Abas } from "../_componentes/abas";
import { Pagina } from "../_componentes/ui";
import { ABAS_ANTISPAM } from "../anti-spam/comum";
import { BotaoCadastrarBlacklist, ListaBlacklists, type BlacklistLinha } from "./lista";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";

export const dynamic = "force-dynamic";

/** Blacklists: listas nomeadas de números. Números de lista ativa contam como bloqueados no anti-spam. */
export default async function Blacklists() {
  const b = await bloqueio("antispam");
  if (b) return b;
  const db = await dbUsuario();
  const [{ data, error }, podeEditar] = await Promise.all([
    db.from("blacklists").select("id, nome, ativa, created_at, blacklist_numeros(count)").order("created_at", { ascending: false }),
    permitido("antispam", "editar"),
  ]);
  if (error) throw new Error(`Não foi possível carregar as blacklists: ${error.message}`);
  const itens: BlacklistLinha[] = ((data ?? []) as { id: string; nome: string; ativa: boolean; created_at: string; blacklist_numeros: { count: number }[] }[]).map((l) => ({
    id: l.id,
    nome: l.nome,
    ativa: l.ativa,
    created_at: l.created_at,
    numeros: l.blacklist_numeros?.[0]?.count ?? 0,
  }));

  return (
    <Pagina titulo="Blacklists" acoes={podeEditar ? <BotaoCadastrarBlacklist /> : undefined}>
      <Abas itens={ABAS_ANTISPAM} />
      <ListaBlacklists itens={itens} podeEditar={podeEditar} />
    </Pagina>
  );
}
