import { notFound } from "next/navigation";
import { permitido } from "@/src/lib/permissoes";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";
import { ContasAssociadas } from "./lista";

export const dynamic = "force-dynamic";

export default async function ContasDaCampanha({ params }: { params: Promise<{ id: string }> }) {
  const b = await bloqueio("campanhas");
  if (b) return b;
  const { id } = await params;
  const db = await dbUsuario();

  const { data: campanha, error: erroCampanha } = await db
    .from("campanhas")
    .select("conexao_criadora_id, reassociar_acoes")
    .eq("id", id)
    .maybeSingle();
  if (erroCampanha) throw new Error("Não foi possível carregar a campanha.");
  if (!campanha) notFound();

  const [{ data: associadas, error: erroAssociadas }, { data: conexoes, error: erroConexoes }, podeEditar] = await Promise.all([
    db.from("campanha_conexoes").select("conexao_id").eq("campanha_id", id),
    db.from("conexoes").select("id, nome, telefone, status").order("nome"),
    permitido("campanhas", "editar"),
  ]);
  if (erroAssociadas || erroConexoes) throw new Error("Não foi possível carregar as conexões.");

  const idsAssociados = new Set((associadas ?? []).map((a) => a.conexao_id as string));
  if (campanha.conexao_criadora_id) idsAssociados.add(campanha.conexao_criadora_id);

  const todas = conexoes ?? [];
  const contas = todas
    .filter((c) => idsAssociados.has(c.id))
    .map((c) => ({ id: c.id, nome: c.nome, telefone: c.telefone, status: c.status, criadora: c.id === campanha.conexao_criadora_id }));
  const disponiveis = todas.filter((c) => !idsAssociados.has(c.id)).map((c) => ({ id: c.id, nome: c.nome, telefone: c.telefone, status: c.status }));

  return (
    <div className="mx-auto max-w-[1200px] space-y-4 px-4 pb-6 pt-4 md:px-6">
      <ContasAssociadas
        campanhaId={id}
        contas={contas}
        disponiveis={disponiveis}
        reassociarAcoes={campanha.reassociar_acoes}
        podeEditar={podeEditar}
      />
    </div>
  );
}
