import { NextResponse } from "next/server";
import { segredosIguais } from "@/src/lib/crypto";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { processarEventoZapbot } from "@/src/lib/zapbot/evento";

export async function POST(req: Request, { params }: { params: Promise<{ conexaoId: string; segredo: string }> }) {
  const { conexaoId, segredo } = await params;
  const db = dbAdmin();
  const { data } = await db.from("conexoes").select("webhook_secret").eq("id", conexaoId).maybeSingle();
  if (!data || !segredosIguais(data.webhook_secret, segredo)) return new NextResponse(null, { status: 404 });
  const corpo = await req.json().catch(() => null);
  await processarEventoZapbot(conexaoId, corpo, db);
  return new NextResponse(null, { status: 200 });
}
