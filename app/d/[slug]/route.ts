import { NextResponse, type NextRequest } from "next/server";
import { decidirDestino, ehLinkWhatsapp } from "@/src/lib/link";
import { ehBotDePreview } from "@/src/lib/regras/navegador";
import { dbAdmin } from "@/src/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Deep link avulso: soma o clique e redireciona (302) pro destino, numa chamada só (RPC
 * `registrar_clique_deeplink`, só o service role — a tabela `deeplinks` nunca é lida por anon/authenticated
 * aqui). Slug inexistente → 404 simples, sem detalhe (nunca revela se o slug existe por outro motivo).
 *
 * Destino de grupo do WhatsApp (`chat.whatsapp.com`) em navegador interno (Instagram, TikTok…) passa pela mesma
 * página de abertura por deep link que o link de campanha já usa (`decidirDestino`, com `base: "/d"` pra cair em
 * `/d/[slug]/abrir`); qualquer outro destino (site, checkout…) segue direto, em qualquer aparelho.
 *
 * HEAD (ninguém "visita" por HEAD) e bots de pré-visualização de link (o WhatsApp e outros mandam um request só
 * pra gerar o card do link) ainda são redirecionados, mas sem somar o clique: uma leitura simples do destino
 * (mesmo `dbAdmin`), sem a RPC que incrementa `deeplinks.cliques`.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = dbAdmin();
  const userAgent = req.headers.get("user-agent") ?? "";
  const semContagem = req.method === "HEAD" || ehBotDePreview(userAgent);
  let destino: string | null;
  if (semContagem) {
    const { data, error } = await db.from("deeplinks").select("destino").eq("slug", slug).maybeSingle();
    if (error) console.error("[deeplink] falha ao ler o destino (bot/HEAD)", error);
    destino = error ? null : ((data as { destino: string } | null)?.destino ?? null);
  } else {
    const { data, error } = await db.rpc("registrar_clique_deeplink", { p_slug: slug });
    if (error) console.error("[deeplink] falha ao registrar o clique", error);
    destino = error ? null : (data as string | null);
  }
  if (!destino) return new NextResponse("Link indisponível.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });

  let urlFinal = destino;
  if (ehLinkWhatsapp(destino)) {
    const grupo = { id: slug, numero: 0, cheio: false, ativo: true, link_convite: destino };
    urlFinal = decidirDestino({ grupo, userAgent, slug, base: "/d" }).url;
  }
  return NextResponse.redirect(new URL(urlFinal, req.url), 302);
}

export const HEAD = GET;
