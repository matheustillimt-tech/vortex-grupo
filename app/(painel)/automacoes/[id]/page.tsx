import { notFound } from "next/navigation";
import type { Provedor } from "@/src/lib/checkout/parsers";
import type { Gatilho, TipoAcaoAutomacao } from "@/src/lib/regras/automacoes";
import { isoParaCampoBrasilia } from "@/src/lib/regras/horario";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { Assistente } from "../assistente";
import { carregarOpcoesAssistente } from "../opcoes-assistente";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AcaoBanco = { ordem: number; tipo: TipoAcaoAutomacao; conteudo: unknown; atraso_min: number };

export default async function EditarAutomacao({ params }: { params: Promise<{ id: string }> }) {
  const b = await bloqueio("automacoes");
  if (b) return b;
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const db = await dbUsuario();
  const { data: a, error } = await db
    .from("automacoes")
    .select("id, nome, campanha_id, gatilho, quando, alvo_grupos, alvo_contas, pasta, provedor, produto, ativo, automacao_acoes(ordem, tipo, conteudo, atraso_min)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Não foi possível carregar a automação: ${error.message}`);
  if (!a) notFound();
  const opcoes = await carregarOpcoesAssistente(a.campanha_id as string);
  const alvo = a.alvo_grupos as string[] | null;
  const alvoContas = a.alvo_contas as string[] | null;
  const acoes = ((a.automacao_acoes ?? []) as AcaoBanco[]).sort((x, y) => x.ordem - y.ordem);

  return (
    <Assistente
      automacaoId={id}
      ativo={a.ativo as boolean}
      inicial={{
        categoria: "campanha",
        campanhaId: a.campanha_id as string,
        gatilho: a.gatilho as Gatilho,
        quando: a.quando ? isoParaCampoBrasilia(a.quando as string) : "",
        todosGrupos: !alvo,
        grupos: alvo ?? [],
        todasContas: !alvoContas,
        contas: alvoContas ?? [],
        provedor: a.provedor as Provedor | null,
        produto: (a.produto as string | null) ?? "",
        acoes: acoes.map((x) => ({ tipo: x.tipo, conteudo: x.conteudo, atraso_min: x.atraso_min })),
        nome: a.nome as string,
        pasta: (a.pasta as string | null) ?? "",
      }}
      {...opcoes}
    />
  );
}
