import { NextResponse } from "next/server";
import { credenciais } from "@/src/lib/conexoes";
import { permitido, SEM_PERMISSAO } from "@/src/lib/permissoes";
import { normalizarTelefone } from "@/src/lib/telefone";
import { zapbot } from "@/src/lib/zapbot/client";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  // Conectar um número é mudar a conta: exige "editar" em Contas (a tela mostra o erro e para de perguntar).
  if (!(await permitido("contas", "editar"))) return NextResponse.json({ erro: SEM_PERMISSAO }, { status: 403 });
  const { id } = await params;
  const { telefone } = (await req.json().catch(() => ({}))) as { telefone?: string };
  const t = normalizarTelefone(telefone ?? "");
  if (!t) return NextResponse.json({ erro: "Telefone inválido. Use DDD + número." }, { status: 400 });
  try {
    const r = await zapbot().codigoPareamento(await credenciais(id), t);
    return NextResponse.json({ conectado: r.estado === "conectado", codigo: r.estado === "pronto" ? r.codigo : null });
  } catch {
    return NextResponse.json({ erro: "O Zapbot não respondeu. Tente de novo." }, { status: 502 });
  }
}
