import { headers } from "next/headers";
import { codigoConvite, linkAbrirWhatsapp } from "@/src/lib/link";
import { dbAdmin } from "@/src/lib/supabase/admin";

export const dynamic = "force-dynamic";

function Tela({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[radial-gradient(60%_45%_at_50%_0%,rgba(15,169,104,0.09),transparent)] px-6 text-center">
      <div className="w-full max-w-sm space-y-5 rounded-2xl border border-vg-line bg-linear-to-b from-vg-panel to-vg-panel-3 px-6 py-8">{children}</div>
    </main>
  );
}

/** Página de abertura por deep link do link avulso: igual `/l/[slug]/abrir`, mas sem `g` nem `espera` (o deep
 *  link não escolhe grupo nem tem lotação — o slug já aponta pro único destino salvo em `deeplinks`). */
export default async function AbrirDeeplink({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = dbAdmin();
  const { data } = await db.from("deeplinks").select("destino").eq("slug", slug).maybeSingle();
  const link = (data as { destino: string } | null)?.destino;
  if (!link) return <Tela><p className="text-sm text-vg-muted">Link indisponível.</p></Tela>;

  const codigo = codigoConvite(link);
  const abrir = codigo ? linkAbrirWhatsapp(codigo, link, (await headers()).get("user-agent") ?? "") : null;

  return (
    <Tela>
      <h1 className="text-2xl font-semibold tracking-[-0.03em]">Falta só um passo</h1>
      <p className="text-sm text-vg-muted">Toque no botão para entrar no grupo pelo WhatsApp.</p>
      {abrir && (
        <a href={abrir} className="block w-full rounded-xl bg-[#25d366] px-6 py-4 text-lg font-bold text-black shadow-[0_6px_20px_rgba(37,211,102,.25)]">Entrar no grupo</a>
      )}
      <a href={link} className="block text-sm text-vg-muted underline underline-offset-4">Não abriu? Toque aqui</a>
    </Tela>
  );
}
