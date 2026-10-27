import { headers } from "next/headers";
import { codigoConvite, linkAbrirWhatsapp } from "@/src/lib/link";
import { validarPixel } from "@/src/lib/regras/secoes-campanha";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { Tela } from "../tela";
import { AbrirWhatsapp } from "./abrir-whatsapp";

export const dynamic = "force-dynamic";

export default async function Abrir({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ g?: string; espera?: string }> }) {
  const { slug } = await params;
  const { g, espera } = await searchParams;

  if (espera) {
    return (
      <Tela>
        <meta httpEquiv="refresh" content={`10;url=/l/${slug}`} />
        <span aria-hidden className="mx-auto block size-8 animate-spin rounded-full border-2 border-vg-line-2 border-t-vg-accent" />
        <h1 className="text-xl font-semibold tracking-[-0.02em]">Abrindo novas vagas…</h1>
        <p className="text-sm text-vg-muted">Os grupos lotaram agora. Esta página tenta de novo sozinha em 10 segundos.</p>
      </Tela>
    );
  }

  const db = dbAdmin();
  const { data: camp } = await db.from("campanhas").select("id, arquivada, deep_linking, pixel_meta_ativo, pixel_meta_id").eq("slug", slug).maybeSingle();
  if (!camp || camp.arquivada) return <Tela><p className="text-sm text-vg-muted">Link indisponível.</p></Tela>;

  const { data } = g
    ? await db.from("grupos").select("link_convite").eq("id", g).eq("campanha_id", camp.id).eq("ativo", true).maybeSingle()
    : { data: null };
  const link = data?.link_convite;
  if (!link) return <Tela><p className="text-sm text-vg-muted">Link indisponível.</p></Tela>;

  const codigo = codigoConvite(link);
  const abrir = codigo ? linkAbrirWhatsapp(codigo, link, (await headers()).get("user-agent") ?? "") : null;

  // Deep Linking (seção da campanha): abre o WhatsApp sozinho. Pixel da Meta só com Deep Linking ligado, o Pixel
  // ativo e um id válido (só dígitos: é o único dado da campanha que entra no script).
  const deepLinking = camp.deep_linking === true;
  const pixel = deepLinking && camp.pixel_meta_ativo === true ? validarPixel(camp.pixel_meta_id) : null;

  return (
    <Tela>
      {pixel && <PixelMeta id={pixel} />}
      {deepLinking && abrir && <AbrirWhatsapp destino={abrir} pixel={!!pixel} />}
      <h1 className="text-2xl font-semibold tracking-[-0.03em]">Falta só um passo</h1>
      <p className="text-sm text-vg-muted">Toque no botão para entrar no grupo pelo WhatsApp.</p>
      {abrir && (
        <a href={abrir} className="block w-full rounded-xl bg-[#25d366] px-6 py-4 text-lg font-bold text-black shadow-[0_6px_20px_rgba(37,211,102,.25)]">Entrar no grupo</a>
      )}
      <a href={link} className="block text-sm text-vg-muted underline underline-offset-4">Não abriu? Toque aqui</a>
    </Tela>
  );
}

/** Código padrão do Pixel da Meta (connect.facebook.net) com `PageView`. `id` já passou por `validarPixel` (só
 *  dígitos). */
function PixelMeta({ id }: { id: string }) {
  const codigo = `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${id}');fbq('track','PageView');`;
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: codigo }} />
      <noscript>
        <img height="1" width="1" style={{ display: "none" }} alt="" src={`https://www.facebook.com/tr?id=${id}&ev=PageView&noscript=1`} />
      </noscript>
    </>
  );
}
