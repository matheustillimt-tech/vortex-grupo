import Link from "next/link";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { ABAS_AUTOMACOES } from "../automacoes/abas";
import { Abas } from "../_componentes/abas";
import { estiloAcao, Pagina, Selo, Tabela } from "../_componentes/ui";
import { duplicarSequencia } from "./actions";
import { NovaSequencia } from "./nova";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";
import { permitido } from "@/src/lib/permissoes";

export const dynamic = "force-dynamic";

export default async function Sequencias() {
  const b = await bloqueio("automacoes");
  if (b) return b;
  const podeEditar = await permitido("automacoes", "editar");
  const db = await dbUsuario();
  const { data, error } = await db.from("sequencias").select("id, nome, sequencia_passos(count), campanhas(count)").order("created_at", { ascending: false });
  if (error) throw new Error("Não foi possível carregar as sequências.");
  const lista = data ?? [];
  return (
    <Pagina titulo="Automações">
      <Abas itens={ABAS_AUTOMACOES} />
      <p className="text-sm text-vg-muted">Sequências: passos relativos à data da aula (D-N, hora de Brasília). Aplique numa campanha em Configurações.</p>
      {podeEditar && <NovaSequencia />}
      <Tabela colunas={["Sequência", "Passos", "Campanhas", ""]} vazio={lista.length ? undefined : "Nenhuma sequência."}>
        {lista.map((s) => (
          <tr key={s.id}>
            <td className="px-3 py-2.5"><Link href={`/sequencias/${s.id}`} className="font-medium transition-colors hover:text-vg-accent-2">{s.nome}</Link></td>
            <td className="px-3 py-2.5"><Selo cor="neutro" semPonto>{(s.sequencia_passos as unknown as { count: number }[])[0]?.count ?? 0}</Selo></td>
            <td className="px-3 py-2.5"><Selo cor="neutro" semPonto>{(s.campanhas as unknown as { count: number }[])[0]?.count ?? 0}</Selo></td>
            <td className="px-3 py-2.5 text-right">{podeEditar && <form action={duplicarSequencia.bind(null, s.id)}><button className={estiloAcao.normal}>duplicar</button></form>}</td>
          </tr>
        ))}
      </Tabela>
    </Pagina>
  );
}
