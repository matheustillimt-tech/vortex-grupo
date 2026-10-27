import { permitido } from "@/src/lib/permissoes";
import { EVENTOS_WEBHOOK, type Evento } from "@/src/lib/regras/webhooks";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { bloqueio } from "../../_componentes/guarda";
import { SemAcesso } from "../../_componentes/sem-acesso";
import type { CampanhaOpcao } from "../comum";
import { AssistenteHook } from "./assistente";

export const dynamic = "force-dynamic";

/** Assistente "Adicionar hook": Hook → teste → Confirmar. `?evento=` pré-marca um evento. O token é gerado pela action
 *  `novoToken()` quando o assistente abre e só passa a valer em "SALVAR". */
export default async function NovoHook({ searchParams }: { searchParams: Promise<{ evento?: string | string[] }> }) {
  const b = await bloqueio("webhooks");
  if (b) return b;
  if (!(await permitido("webhooks", "editar"))) return <SemAcesso />;
  const db = await dbUsuario();
  const { data, error } = await db.from("campanhas").select("id, nome").eq("arquivada", false).order("nome");
  if (error) throw new Error(`Não foi possível carregar as campanhas: ${error.message}`);
  // `?evento=solicitacoes_entrada` (atalho das Configurações de Solicitações): já vem marcado no passo de eventos.
  // Só um evento conhecido; o resto é ignorado. Passa só o nome do evento (dado), nunca função.
  const pedido = (await searchParams).evento;
  const evento = typeof pedido === "string" && (EVENTOS_WEBHOOK as readonly string[]).includes(pedido) ? (pedido as Evento) : null;
  return <AssistenteHook campanhas={(data ?? []) as CampanhaOpcao[]} inicial={null} eventosIniciais={evento ? [evento] : []} />;
}
