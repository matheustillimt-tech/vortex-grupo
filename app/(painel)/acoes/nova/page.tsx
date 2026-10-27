import { permitido } from "@/src/lib/permissoes";
import { lerPresetAcao, MAXIMO_ITENS_ACAO, type CampanhaDoAssistente } from "@/src/lib/regras/assistente-acao";
import { ehUuid } from "@/src/lib/regras/uuid";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { bloqueio } from "../../_componentes/guarda";
import { SemAcesso } from "../../_componentes/sem-acesso";
import { AssistenteAcao, type ContaConectada } from "./assistente";

export const dynamic = "force-dynamic";

/** Assistente "Adicionar ação". `?campanha=<id>&acao=<tipo>` (botões "Enviar mensagem" e "ADICIONAR" da
 *  campanha) entra com Categoria, Campanha e Ação já escolhidas, no passo "Contas"; os presets só valem se a
 *  campanha estiver na lista (existe e não está arquivada) e a ação for uma das oferecidas. `?conta=<id>` (botão
 *  "ADICIONAR" da aba Ações do detalhe da conta, Etapa 3K Tarefa 4) marca essa conta assim que o passo "Contas"
 *  chegar a oferecê-la (ação normal: quando a campanha escolhida tiver essa conta; "Entrar no Grupo": direto,
 *  já que esse passo usa qualquer conta conectada) — não força campanha nem ação, a pessoa escolhe o resto. */
export default async function NovaAcao({ searchParams }: { searchParams: Promise<{ campanha?: string; acao?: string; conta?: string }> }) {
  const b = await bloqueio("campanhas");
  if (b) return b;
  if (!(await permitido("campanhas", "editar"))) return <SemAcesso />;
  const sp = await searchParams;
  const preset = lerPresetAcao(sp);
  const contaInicial = ehUuid(sp.conta) ? sp.conta : null;

  const db = await dbUsuario();
  const [campanhas, projetos, modelos, conexoes, contasConectadas] = await Promise.all([
    db.from("campanhas").select("id, nome, descricao, projeto_id").eq("arquivada", false).order("nome").limit(MAXIMO_ITENS_ACAO),
    db.from("projetos").select("id, nome, descricao").eq("arquivado", false).order("nome").limit(MAXIMO_ITENS_ACAO),
    db.from("modelos").select("id, nome, tipo, conteudo").eq("arquivado", false).in("tipo", ["mensagem", "enquete"]).order("nome").limit(MAXIMO_ITENS_ACAO),
    db.from("conexoes").select("nome, telefone").eq("status", "conectado").not("telefone", "is", null).order("nome").limit(MAXIMO_ITENS_ACAO),
    // "Entrar no Grupo" (Etapa 3K): qualquer conta conectada, não só as de uma campanha.
    db.from("conexoes").select("id, nome, telefone").eq("status", "conectado").order("nome").limit(MAXIMO_ITENS_ACAO),
  ]);
  if (campanhas.error) throw new Error(`Não foi possível carregar as campanhas: ${campanhas.error.message}`);
  if (projetos.error) throw new Error(`Não foi possível carregar os projetos: ${projetos.error.message}`);
  if (modelos.error) throw new Error(`Não foi possível carregar os modelos: ${modelos.error.message}`);
  if (conexoes.error) throw new Error(`Não foi possível carregar as conexões: ${conexoes.error.message}`);
  if (contasConectadas.error) throw new Error(`Não foi possível carregar as conexões: ${contasConectadas.error.message}`);

  const lista = (campanhas.data ?? []) as CampanhaDoAssistente[];
  const campanhaInicial = preset.campanha && lista.some((c) => c.id === preset.campanha) ? preset.campanha : null;

  return (
    <AssistenteAcao
      campanhas={lista}
      projetos={(projetos.data ?? []) as { id: string; nome: string; descricao: string }[]}
      modelos={(modelos.data ?? []) as { id: string; nome: string; tipo: "mensagem" | "enquete"; conteudo: unknown }[]}
      telefones={(conexoes.data ?? []) as { nome: string; telefone: string }[]}
      contasConectadas={(contasConectadas.data ?? []) as ContaConectada[]}
      campanhaInicial={campanhaInicial}
      acaoInicial={campanhaInicial ? preset.acao : null}
      contaInicial={contaInicial}
    />
  );
}
