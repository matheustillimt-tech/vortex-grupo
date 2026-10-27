import { notFound } from "next/navigation";
import type { TipoPasso } from "@/src/lib/regras/conteudo";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { ABAS_AUTOMACOES } from "../../automacoes/abas";
import { Abas } from "../../_componentes/abas";
import { estiloAcao, Pagina } from "../../_componentes/ui";
import { duplicarSequencia, excluirSequencia } from "../actions";
import { EditorSequencia } from "./editor";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";
import { permitido } from "@/src/lib/permissoes";

export const dynamic = "force-dynamic";

export default async function Sequencia({ params }: { params: Promise<{ id: string }> }) {
  const b = await bloqueio("automacoes");
  if (b) return b;
  const podeEditar = await permitido("automacoes", "editar");
  const { id } = await params;
  const db = await dbUsuario();
  const [{ data: s }, { data: passos }, { data: modelos }] = await Promise.all([
    db.from("sequencias").select("id, nome").eq("id", id).maybeSingle(),
    db.from("sequencia_passos").select("id, dia_relativo, hora, tipo, conteudo, importante").eq("sequencia_id", id).order("ordem"),
    db.from("modelos").select("id, nome, tipo, conteudo").eq("arquivado", false).order("nome"),
  ]);
  if (!s) notFound();
  return (
    <Pagina
      titulo="Automações"
      subtitulo={s.nome}
      trilha={[{ rotulo: "Sequências", href: "/sequencias" }]}
      acoes={
        podeEditar ? (
          <div className="flex items-center gap-4">
            <form action={duplicarSequencia.bind(null, id)}><button className={estiloAcao.normal}>Duplicar</button></form>
            <form action={excluirSequencia.bind(null, id)}><button className={estiloAcao.perigo}>Excluir</button></form>
          </div>
        ) : undefined
      }
    >
      <Abas itens={ABAS_AUTOMACOES} />
      <EditorSequencia
        sequenciaId={id}
        nome={s.nome}
        inicial={(passos ?? []).map((p) => ({ id: p.id, dia_relativo: p.dia_relativo, hora: String(p.hora).slice(0, 5), tipo: p.tipo as TipoPasso, conteudo: p.conteudo, importante: p.importante }))}
        modelos={modelos ?? []}
      />
    </Pagina>
  );
}
