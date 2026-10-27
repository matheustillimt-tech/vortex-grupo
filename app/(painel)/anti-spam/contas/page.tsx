import { CHAVE_ANTISPAM_CONTAS, lerAntispamContas } from "@/src/lib/regras/antispam";
import { permitido } from "@/src/lib/permissoes";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { Abas } from "../../_componentes/abas";
import { Pagina } from "../../_componentes/ui";
import { ABAS_ANTISPAM } from "../comum";
import { FormContasAntispam, type ContaOpcao } from "./form";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";

export const dynamic = "force-dynamic";

/** Aba "Contas associadas": "Antispam por Contas Associadas" + escolha das contas que podem remover. */
export default async function ContasAntispam() {
  const b = await bloqueio("antispam");
  if (b) return b;
  const db = await dbUsuario();
  const [conexoes, config, podeEditar] = await Promise.all([
    db.from("conexoes").select("id, nome, telefone").order("nome"),
    db.from("configuracoes").select("valor").eq("chave", CHAVE_ANTISPAM_CONTAS).maybeSingle(),
    permitido("antispam", "editar"),
  ]);
  if (conexoes.error) throw new Error(`Não foi possível carregar as conexões: ${conexoes.error.message}`);
  if (config.error) throw new Error(`Não foi possível carregar a configuração: ${config.error.message}`);
  const cfg = lerAntispamContas((config.data as { valor: unknown } | null)?.valor);

  return (
    <Pagina titulo="Anti-spam">
      <Abas itens={ABAS_ANTISPAM} />
      <FormContasAntispam contas={(conexoes.data ?? []) as ContaOpcao[]} inicial={cfg} podeEditar={podeEditar} />
    </Pagina>
  );
}
