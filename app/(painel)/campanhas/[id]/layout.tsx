import { notFound } from "next/navigation";
import { fotoDaCampanha, mapaFotosCampanhas } from "@/src/lib/regras/foto";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";
import { CabecalhoCampanha } from "./cabecalho";

export default async function LayoutCampanha({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  // A página também guarda (o layout não renderiza de novo entre as abas), mas aqui o nome da campanha já vazaria.
  const b = await bloqueio("campanhas");
  if (b) return b;
  const { id } = await params;
  const db = await dbUsuario();
  // `*` em vez de "nome, imagem_grupo_url": a imagem da campanha (`imagem_grupo_url`, Task 2 da Etapa 3M) entra
  // sozinha quando a coluna existir. A foto do primeiro grupo vem em paralelo; erro nela = letra (não derruba).
  const [{ data }, fotos] = await Promise.all([
    db.from("campanhas").select("*").eq("id", id).maybeSingle(),
    db.rpc("fotos_campanhas", { p_ids: [id] }),
  ]);
  if (!data) notFound();
  const foto = fotoDaCampanha(data as { imagem_grupo_url?: string | null }, fotos.error ? null : mapaFotosCampanhas(fotos.data).get(id));
  return (
    <div>
      <CabecalhoCampanha id={id} nome={data.nome} foto={foto} />
      {children}
    </div>
  );
}
