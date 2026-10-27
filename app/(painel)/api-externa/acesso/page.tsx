import { bloqueio } from "@/app/(painel)/_componentes/guarda";
import { exigirUsuario } from "@/src/lib/supabase/usuario";
import { Pagina } from "../../_componentes/ui";
import { MeusAcessos } from "../acessos";
import { carregarMeusAcessos } from "../acessos-dados";

export const dynamic = "force-dynamic";

/** "Meus acessos" (Etapa 3K, Tarefa 7): os pedidos de acesso do próprio usuário a chaves da API. Membro com
 *  Webhooks/ver (a área da API; o padrão de um membro novo); o atendente chega aqui pelo link do convite. A chave só aparece no
 *  clique em "VER CHAVE", uma vez. */
export default async function MeusAcessosPagina() {
  const b = await bloqueio("webhooks");
  if (b) return b;
  const usuario = await exigirUsuario();
  const itens = await carregarMeusAcessos(usuario.id);
  return (
    <Pagina
      titulo="Meus acessos"
      trilha={[{ rotulo: "API", href: "/api-externa" }, { rotulo: "Meus acessos" }]}
      subtitulo="Chaves da API que você pediu a um administrador. Aprovado, clique em VER CHAVE: ela aparece uma vez só."
    >
      <MeusAcessos itens={itens} />
    </Pagina>
  );
}
