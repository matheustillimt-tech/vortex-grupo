import { dbAdmin } from "@/src/lib/supabase/admin";
import { exigirUsuario } from "@/src/lib/supabase/usuario";
import { Abas } from "../_componentes/abas";
import { Icone } from "../_componentes/icone";
import { Informativo } from "../_componentes/numeros";
import { Pagina } from "../_componentes/ui";
import { ABAS_EQUIPE, montarListaMembros, type LinhaMembroDb, type UsuarioAuthResumo } from "./comum";
import { BotaoAdicionar } from "./convidar";
import { BotaoAtualizar, ListaEquipe } from "./lista";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";

export const dynamic = "force-dynamic";

export default async function Equipe() {
  const b = await bloqueio("equipe");
  if (b) return b;
  const eu = await exigirUsuario();
  const db = dbAdmin();

  const [{ data: usuarios }, { data: membros }] = await Promise.all([
    db.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    db.from("membros").select("usuario_id, nome, papel"),
  ]);

  const lista = montarListaMembros((usuarios?.users ?? []) as UsuarioAuthResumo[], (membros ?? []) as LinhaMembroDb[]);

  return (
    <Pagina
      titulo="Equipe"
      // "N/∞" ao lado do título — o Vórtex Grupo não limita o número de membros.
      contador={
        <span className="flex items-center gap-1 text-sm text-vg-muted">
          {lista.length}/<Icone nome="all_inclusive" tamanho={16} />
        </span>
      }
      acoes={
        <>
          <BotaoAtualizar />
          <BotaoAdicionar />
        </>
      }
    >
      <Abas itens={ABAS_EQUIPE} />
      <Informativo>
        <strong>ATENÇÃO:</strong> Administradores veem e mudam tudo, inclusive a equipe. Membros só veem e mudam o que estiver
        liberado na aba Permissões.
      </Informativo>
      <h2 className="text-[15px] font-medium text-vg-text">Membros</h2>
      <ListaEquipe membros={lista} euId={eu.id} />
    </Pagina>
  );
}
