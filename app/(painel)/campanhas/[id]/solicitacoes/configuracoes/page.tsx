import { notFound } from "next/navigation";
import { permitido } from "@/src/lib/permissoes";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";
import { Pagina } from "../../../../_componentes/ui";
import { AbasSolicitacoes } from "../abas";
import { CartaoConfig, LinhasAtalhos, type TagOpcao } from "./cartoes";
import { FormularioSolicitacoes } from "./formulario";

export const dynamic = "force-dynamic";

/** Aba "Solicitações de entrada" › Configurações, em cartões (Etapa 3N): aprovação nos grupos
 *  (aplicada por execução, nunca aqui no render), reserva de vaga, aprovação por tag, recusa por bloqueio, aprovar
 *  quem não está bloqueado (extra mantido) e os atalhos. Só dados (ids, listas, hrefs) vão pros componentes cliente. */
export default async function SolicitacoesConfiguracoes({ params }: { params: Promise<{ id: string }> }) {
  const b = await bloqueio("campanhas");
  if (b) return b;
  const { id } = await params;
  const db = await dbUsuario();
  const [{ data, error }, { data: tagsData, error: erroTags }, podeEditar] = await Promise.all([
    db
      .from("campanhas")
      .select("aprovacao_entrada, recusar_bloqueados, aprovar_automaticamente, reservar_vaga_pendentes, aprovar_por_tag, aprovar_tags")
      .eq("id", id)
      .maybeSingle(),
    // Sem embed de campanhas (ver tests/embeds-ambiguos.test.ts).
    db.from("tags").select("id, nome, tipo").order("nome"),
    permitido("campanhas", "editar"),
  ]);
  if (error) throw new Error(`Não foi possível carregar a campanha: ${error.message}`);
  if (!data) notFound();
  if (erroTags) throw new Error(`Não foi possível carregar as tags: ${erroTags.message}`);
  const c = data as {
    aprovacao_entrada?: boolean | null;
    recusar_bloqueados?: boolean | null;
    aprovar_automaticamente?: boolean | null;
    reservar_vaga_pendentes?: boolean | null;
    aprovar_por_tag?: boolean | null;
    aprovar_tags?: string[] | null;
  };
  const tags = (tagsData ?? []) as TagOpcao[];
  const atalhos = [
    { icone: "http", rotulo: "Receber por webhook", href: "/hooks/novo?evento=solicitacoes_entrada" },
    { icone: "key", rotulo: "Gerenciar via API", href: "/api-externa" },
    { icone: "block", rotulo: "Anti-spam", href: "/anti-spam" },
    { icone: "playlist_remove", rotulo: "Blacklists", href: "/blacklists" },
    // A aba Grupos não abre o diálogo de criação por query: o atalho leva à aba.
    { icone: "settings", rotulo: "Configurações do grupo", href: `/campanhas/${id}/grupos` },
  ];
  return (
    <Pagina titulo="Solicitações de entrada">
      <AbasSolicitacoes campanhaId={id} />
      <FormularioSolicitacoes
        campanhaId={id}
        podeEditar={podeEditar}
        tags={tags}
        inicial={{
          aprovacao_entrada: c.aprovacao_entrada === true,
          recusar_bloqueados: c.recusar_bloqueados === true,
          aprovar_automaticamente: c.aprovar_automaticamente === true,
          reservar_vaga_pendentes: c.reservar_vaga_pendentes === true,
          aprovar_por_tag: c.aprovar_por_tag === true,
          aprovar_tags: (c.aprovar_tags ?? []).filter((t) => tags.some((x) => x.id === t)),
        }}
      />
      <div className="max-w-2xl">
        <CartaoConfig icone="hub" titulo="Integrações e atalhos">
          <LinhasAtalhos itens={atalhos} />
        </CartaoConfig>
      </div>
    </Pagina>
  );
}
