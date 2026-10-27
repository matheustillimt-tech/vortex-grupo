import { notFound } from "next/navigation";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";
import type { TipoModelo } from "@/src/lib/regras/conteudo";
import { pastasDe, type ModeloLista } from "@/src/lib/regras/modelos";
import { UUID } from "@/src/lib/regras/uuid";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import type { Valor } from "../../_componentes/conteudo-editor";
import { EditorModeloPagina, type ModeloEditavel } from "../editor";

export const dynamic = "force-dynamic";

const COLUNAS = "id, nome, tipo, conteudo, pasta, arquivado, created_at, updated_at";

export default async function EditarModelo({ params }: { params: Promise<{ id: string }> }) {
  const b = await bloqueio("modelos");
  if (b) return b;
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const db = await dbUsuario();
  const [{ data: modelo, error: erroModelo }, { data: ativos, error: erroPastas }] = await Promise.all([
    db.from("modelos").select("id, nome, tipo, conteudo, pasta").eq("id", id).maybeSingle(),
    db.from("modelos").select(COLUNAS).eq("arquivado", false).limit(1000),
  ]);
  if (erroModelo) throw new Error(`Não foi possível carregar o modelo: ${erroModelo.message}`);
  if (erroPastas) throw new Error(`Não foi possível carregar as pastas: ${erroPastas.message}`);
  if (!modelo) notFound();

  const pastas = pastasDe((ativos ?? []) as ModeloLista[]).map((p) => p.nome);
  const inicial: ModeloEditavel = {
    id: modelo.id as string,
    nome: modelo.nome as string,
    tipo: modelo.tipo as TipoModelo,
    conteudo: modelo.conteudo as Valor,
    pasta: (modelo.pasta as string | null) ?? null,
  };

  return <EditorModeloPagina inicial={inicial} pastas={pastas} />;
}
