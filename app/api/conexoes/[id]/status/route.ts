import { NextResponse } from "next/server";
import { credenciais } from "@/src/lib/conexoes";
import { permitido, SEM_PERMISSAO } from "@/src/lib/permissoes";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { zapbot } from "@/src/lib/zapbot/client";

/** Usado no pareamento por código: a tela pergunta aqui até o número conectar. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  // Conectar um número é mudar a conta: exige "editar" em Contas (a tela mostra o erro e para de perguntar).
  if (!(await permitido("contas", "editar"))) return NextResponse.json({ erro: SEM_PERMISSAO }, { status: 403 });
  const { id } = await params;
  try {
    const st = await zapbot().status(await credenciais(id));
    if (st.connected) {
      await dbAdmin().from("conexoes").update({ status: "conectado", telefone: st.phone, ultimo_erro: null, caiu_em: null }).eq("id", id);
      return NextResponse.json({ conectado: true, telefone: st.phone });
    }
    return NextResponse.json(st.error ? { conectado: false, erro: st.error } : { conectado: false });
  } catch {
    return NextResponse.json({ erro: "O Zapbot não respondeu. Tente de novo." }, { status: 502 });
  }
}
