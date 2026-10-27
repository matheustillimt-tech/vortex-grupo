import { bloqueio } from "@/app/(painel)/_componentes/guarda";
import { conteudoInicial, TIPOS_MODELO, type TipoModelo } from "@/src/lib/regras/conteudo";
import { conteudoV2Vazio } from "@/src/lib/regras/conteudo-v2";
import { pastasDe, type ModeloLista } from "@/src/lib/regras/modelos";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import type { Valor } from "../../_componentes/conteudo-editor";
import { EditorModeloPagina, type ModeloEditavel } from "../editor";

export const dynamic = "force-dynamic";

const COLUNAS = "id, nome, tipo, conteudo, pasta, arquivado, created_at, updated_at";

export default async function NovoModelo({ searchParams }: { searchParams: Promise<{ tipo?: string; pasta?: string }> }) {
  const b = await bloqueio("modelos");
  if (b) return b;
  const sp = await searchParams;
  const tipo: TipoModelo = (TIPOS_MODELO as readonly string[]).includes(sp.tipo ?? "") ? (sp.tipo as TipoModelo) : "mensagem";
  const pasta = sp.pasta?.trim().slice(0, 40) || null;

  const db = await dbUsuario();
  const { data, error } = await db.from("modelos").select(COLUNAS).eq("arquivado", false).limit(1000);
  if (error) throw new Error(`Não foi possível carregar as pastas: ${error.message}`);
  const pastas = pastasDe((data ?? []) as ModeloLista[]).map((p) => p.nome);

  const inicial: ModeloEditavel = {
    id: null,
    nome: "",
    tipo,
    conteudo: (tipo === "mensagem" ? conteudoV2Vazio() : conteudoInicial(tipo)) as Valor,
    pasta,
  };

  return <EditorModeloPagina inicial={inicial} pastas={pastas} />;
}
