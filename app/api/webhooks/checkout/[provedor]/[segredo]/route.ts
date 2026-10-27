import { NextResponse } from "next/server";
import { lerVenda, PROVEDORES, type Provedor } from "@/src/lib/checkout/parsers";
import { segredosIguais } from "@/src/lib/crypto";
import { dbAdmin } from "@/src/lib/supabase/admin";

/** Id da integração (não arquivada) da plataforma cujo segredo bate com o da URL; `null` se nenhuma bate.
 *  Compara com TODAS em tempo constante, sem parar na primeira que bate: o tempo de resposta não indica qual
 *  (nem quantas) integrações existem. */
function integracaoDoSegredo(integracoes: { id: string; segredo: string }[], segredo: string): string | null {
  let achada: string | null = null;
  for (const i of integracoes) {
    if (segredosIguais(i.segredo, segredo) && achada === null) achada = i.id;
  }
  return achada;
}

export async function POST(req: Request, { params }: { params: Promise<{ provedor: string; segredo: string }> }) {
  const { provedor, segredo } = await params;
  if (!PROVEDORES.includes(provedor as Provedor)) return new NextResponse(null, { status: 404 });
  const db = dbAdmin();
  // Qualquer webhook (integracoes_checkout) não arquivado da plataforma vale. Os links de antes da Etapa 3H
  // continuam valendo: a migração criou uma integração por plataforma com o segredo de provedores_checkout.
  const { data: integracoes, error: erroIntegracoes } = await db.from("integracoes_checkout").select("id, segredo").eq("plataforma", provedor).eq("arquivada", false);
  if (erroIntegracoes) {
    // Falha ao ler (não "segredo errado"): 500 pro checkout reenviar depois, em vez de 404 que ele pode desistir.
    console.error(`Webhook de checkout ${provedor}: não foi possível ler as integrações: ${erroIntegracoes.message}`);
    return new NextResponse(null, { status: 500 });
  }
  const integracaoId = integracaoDoSegredo((integracoes ?? []) as { id: string; segredo: string }[], segredo);
  if (!integracaoId) return new NextResponse(null, { status: 404 });

  const corpo = await req.json().catch(() => null);
  const venda = lerVenda(provedor as Provedor, corpo);
  if (!venda) return NextResponse.json({ ok: true, ignorado: "formato desconhecido" });
  // registrar_venda: evento repetido não muda nada, menos um não aprovado que chega aprovado depois (mesma chave,
  // ex.: order_id do Kiwify) — esse vira aprovado e volta pra fila do processarVendas. Grava também por qual
  // integração a venda chegou (aba Eventos do webhook).
  const { error } = await db.rpc("registrar_venda", {
    p_provedor: provedor,
    p_evento_id: venda.eventoId,
    p_aprovada: venda.aprovada,
    p_telefone: venda.telefone,
    p_produtos: venda.produtos,
    p_payload: corpo,
    p_integracao: integracaoId,
  });
  if (error) {
    console.error(`Venda ${provedor}/${venda.eventoId} não foi salva: ${error.message}`);
    return new NextResponse(null, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
