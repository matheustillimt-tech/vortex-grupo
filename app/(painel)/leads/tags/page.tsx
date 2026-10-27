import { dbUsuario } from "@/src/lib/supabase/usuario";
import { Abas } from "../../_componentes/abas";
import { Pagina } from "../../_componentes/ui";
import { ABAS_LEADS, nomeDaTag, type TagLinha, type TipoTag } from "../comum";
import { ListaTags, NovaTag, type TagMostrada } from "./lista";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";

export const dynamic = "force-dynamic";

/** Ordem: manuais primeiro (são as que dá pra mexer), depois Comprador, Saiu e as de campanha. */
const ORDEM: Record<TipoTag, number> = { manual: 0, comprador: 1, saiu: 2, campanha: 3 };

export default async function Tags() {
  const b = await bloqueio("leads");
  if (b) return b;
  const db = await dbUsuario();
  const [{ data, error }, contagem] = await Promise.all([
    db.from("tags").select("id, nome, tipo, campanhas!tags_campanha_id_fkey(nome)"),
    db.rpc("contar_pessoas_por_tag"),
  ]);
  if (error) throw new Error(`Não foi possível carregar as tags: ${error.message}`);
  if (contagem.error) throw new Error(`Não foi possível contar os leads das tags: ${contagem.error.message}`);
  // Pessoas distintas por tag (contadas no banco): número com e sem o nono dígito e a Saiu de várias campanhas contam uma vez.
  const porTag = new Map(((contagem.data ?? []) as { tag_id: string; pessoas: number | string }[]).map((c) => [c.tag_id, Number(c.pessoas)]));
  const tags: TagMostrada[] = ((data ?? []) as unknown as TagLinha[])
    .map((t) => ({
      id: t.id,
      nome: nomeDaTag(t),
      tipo: t.tipo as TipoTag,
      pessoas: porTag.get(t.id) ?? 0,
    }))
    .sort((a, b) => (ORDEM[a.tipo] ?? 9) - (ORDEM[b.tipo] ?? 9) || a.nome.localeCompare(b.nome, "pt-BR"));

  return (
    <Pagina titulo="Leads" acoes={<NovaTag />}>
      <Abas itens={ABAS_LEADS} />
      <ListaTags tags={tags} />
    </Pagina>
  );
}
