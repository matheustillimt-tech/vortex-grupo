import type { Metadata } from "next";
import Link from "next/link";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";
import { contarTentativa, lerConvite, MSG_ACESSO } from "@/src/lib/api/acessos";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { exigirUsuario } from "@/src/lib/supabase/usuario";
import { estiloBotao, estiloCartao, Pagina } from "../../../_componentes/ui";
import { FormPedidoAcesso } from "../../acessos";
import { ROTULO_ESCOPO } from "../../comum";

export const dynamic = "force-dynamic";
// O token está no caminho: não mandar a URL como Referer pra nenhum link que sair daqui.
export const metadata: Metadata = { referrer: "no-referrer", robots: { index: false, follow: false } };

/** Link de convite da API (Etapa 3K, Tarefa 7). Só membro logado com Webhooks/ver (o middleware já exige
 *  login: a rota não é pública). Cada abertura conta no limite de tentativas por hora. Link mal formado, inexistente, usado ou vencido
 *  dão a mesma mensagem. Nunca loga o token. */
export default async function PedidoAcesso({ params }: { params: Promise<{ token: string }> }) {
  const b = await bloqueio("webhooks");
  if (b) return b;
  const usuario = await exigirUsuario();
  const { token } = await params;
  const db = dbAdmin();

  let erro: string | null = null;
  let chave: { nome: string; escopo: keyof typeof ROTULO_ESCOPO } | null = null;
  const t = await contarTentativa(db, usuario.id);
  if (t === "limite") erro = MSG_ACESSO.muitasTentativas;
  else if (t === "indisponivel") erro = MSG_ACESSO.indisponivel;
  else {
    const r = await lerConvite(db, token);
    if ("erro" in r) erro = r.erro;
    else chave = { nome: r.convite.nome, escopo: r.convite.escopo };
  }

  return (
    <Pagina titulo="Pedir acesso à API" subtitulo="Um administrador compartilhou uma chave da API com você.">
      <section className={`${estiloCartao} max-w-xl space-y-4 p-5`}>
        {chave ? (
          <>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-vg-muted">Chave</dt>
              <dd>{chave.nome}</dd>
              <dt className="text-vg-muted">Escopo</dt>
              <dd>{ROTULO_ESCOPO[chave.escopo]}</dd>
            </dl>
            <p className="text-xs text-vg-muted">
              Você não recebe esta chave: se o administrador aprovar, você gera uma chave sua, com o mesmo escopo, em &quot;Meus acessos&quot;.
            </p>
            <FormPedidoAcesso token={token} />
          </>
        ) : (
          <>
            <p className="text-sm text-vg-erro">{erro}</p>
            <Link href="/api-externa/acesso" className={estiloBotao("contorno")}>MEUS ACESSOS</Link>
          </>
        )}
      </section>
    </Pagina>
  );
}
