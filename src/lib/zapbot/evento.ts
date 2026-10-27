import type { SupabaseClient } from "@supabase/supabase-js";
import type { TipoRecibo } from "../regras/leadscore";
import { alguemEscuta, eventoContaPareada, eventoMensagemRecebida, lerMensagemRecebida } from "../regras/webhooks";
import { normalizarTelefone } from "../telefone";
import { emitirSemFalhar, type WebhookComUrl } from "../webhooks";

type Evento = {
  type?: string;
  isTest?: boolean;
  phone?: string;
  status?: string;
  messageId?: string;
  ids?: unknown;
  isGroup?: boolean;
  participantPhone?: string;
};

const TIPO_DO_STATUS: Record<string, TipoRecibo> = { RECEIVED: "recebeu", READ: "visualizou", PLAYED: "reproduziu" };

/** Recibo de entrega/leitura/reprodução (MessageStatusCallback, https://api.zapbot.online/docs) → `{ ids, lido,
 *  tipo, telefone }`. Em grupo, quem recebeu/leu vem em `participantPhone` (`phone` é o id do grupo); fora de
 *  grupo, em `phone`. `telefone` é null quando não dá pra saber a pessoa (campo ausente, ou um id que não é
 *  número de telefone: LID `…@lid` ou qualquer sufixo que não seja `@s.whatsapp.net`/`@c.us`): aí o banco só
 *  soma, sem linha por pessoa. PLAYED vira "reproduziu" e não soma em lidos
 *  (o WhatsApp também manda READ pra mesma pessoa). */
export function lerRecibo(e: Evento): { ids: string[]; lido: boolean; tipo: TipoRecibo; telefone: string | null } | null {
  if (e.type !== "MessageStatusCallback") return null;
  const tipo = typeof e.status === "string" ? TIPO_DO_STATUS[e.status] : undefined;
  if (!tipo) return null;
  const ids = Array.isArray(e.ids) ? e.ids.filter((i): i is string => typeof i === "string" && i.length > 0) : [];
  if (!ids.length && typeof e.messageId === "string" && e.messageId) ids.push(e.messageId);
  if (!ids.length) return null;
  const bruto = e.isGroup === false ? e.phone : e.participantPhone;
  return { ids, lido: tipo === "visualizou", tipo, telefone: telefoneDoRecibo(bruto) };
}

const SUFIXOS_DE_TELEFONE = new Set(["s.whatsapp.net", "c.us"]);

/** Só número de telefone vira pessoa: sem sufixo, ou com `@s.whatsapp.net`/`@c.us`. LID (`@lid`, que pode ter
 *  15 dígitos e passaria por telefone) e qualquer outro sufixo → null. */
function telefoneDoRecibo(bruto: unknown): string | null {
  if (typeof bruto !== "string") return null;
  const [numero, sufixo, ...resto] = bruto.trim().split("@");
  if (resto.length || (sufixo !== undefined && !SUFIXOS_DE_TELEFONE.has(sufixo.toLowerCase()))) return null;
  return normalizarTelefone(numero);
}

/** Uma escrita por aviso: a rota precisa responder rápido (até ~2 avisos por pessoa por mensagem). */
export async function processarEventoZapbot(conexaoId: string, evento: unknown, db: Pick<SupabaseClient, "from" | "rpc">) {
  if (!evento || typeof evento !== "object") return;
  const e = evento as Evento;
  if (e.isTest) return;
  if (e.type === "ConnectedCallback") {
    const novo = { status: "conectado", telefone: e.phone ?? null, ultimo_erro: null, caiu_em: null };
    // Hook "Conta pareada" só quando o status MUDA para conectado: o update condicional (status ≠ conectado)
    // diz se houve a transição. Se não houve (já estava conectado) ou deu erro, o update de sempre roda igual.
    const { data: mudou, error } = await db.from("conexoes").update(novo).eq("id", conexaoId).neq("status", "conectado").select("nome, telefone");
    if (error || !mudou?.length) {
      await db.from("conexoes").update(novo).eq("id", conexaoId);
      return;
    }
    const conta = mudou[0] as { nome?: string | null; telefone?: string | null };
    await emitirSemFalhar(db, [eventoContaPareada({ conexaoId, nome: conta.nome ?? null, telefone: conta.telefone ?? e.phone ?? null })]);
    return;
  }
  if (e.type === "ReceivedCallback") {
    await mensagemRecebida(conexaoId, evento as Record<string, unknown>, db);
    return;
  }
  const recibo = lerRecibo(e);
  if (recibo) {
    // Uma chamada só: o banco grava o recibo da pessoa e soma em entregues/lidos só o que for novo.
    const { error } = await db.rpc("somar_recibos", { p_ids: recibo.ids, p_lido: recibo.lido, p_telefone: recibo.telefone, p_tipo: recibo.tipo });
    if (error) console.error(`[webhook zapbot] recibo não somado: ${error.message}`);
  }
}

/** Hook "Mensagem recebida (PV)": só PV (não grupo, não da própria conta). Uma leitura (webhooks ativos com o
 *  evento); sem nenhum, para aí. Nada é gravado além da fila de `eventos_saida`. Nunca lança. */
async function mensagemRecebida(conexaoId: string, bruto: Record<string, unknown>, db: Pick<SupabaseClient, "from">): Promise<void> {
  const m = lerMensagemRecebida(bruto);
  if (!m) return;
  try {
    const { data, error } = await db.from("webhooks").select("id, url, eventos, campanhas, ativo, arquivado").eq("ativo", true).eq("arquivado", false).contains("eventos", ["mensagem_recebida"]);
    if (error) {
      console.error(`[webhook zapbot] não foi possível ler os hooks de mensagem recebida: ${error.message}`);
      return;
    }
    const ws = (data ?? []) as WebhookComUrl[];
    if (!alguemEscuta(ws, ["mensagem_recebida"])) return;
    const { data: conta } = await db.from("conexoes").select("nome").eq("id", conexaoId).maybeSingle();
    await emitirSemFalhar(db, [eventoMensagemRecebida({ conexaoId, conta: (conta as { nome?: string } | null)?.nome ?? null, ...m })], ws);
  } catch (err) {
    console.error("[webhook zapbot] mensagem recebida não enfileirada", err);
  }
}
