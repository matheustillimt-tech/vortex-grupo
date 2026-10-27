import "server-only";
import { revalidatePath } from "next/cache";
import { registrarHistorico, type UsuarioParaHistorico } from "../historico";
import { cancelarSeguintes } from "../jobs/encadeadas";
import { rotuloAcaoAssistente, validarEntradaAcao, type TipoAcaoAssistente } from "../regras/assistente-acao";
import { MOTIVO_ANTERIOR_CANCELADA } from "../regras/encadeadas";
import { isoParaCampoBrasilia } from "../regras/horario";
import { dbAdmin } from "../supabase/admin";
import type { OrigemAcao } from "./criar";

/** Cancelar e editar uma ação (execução) ainda agendada — o mesmo núcleo pro painel e pra API/MCP. Só mexe em
 *  execução com `status = 'agendada'` (o filtro vai no próprio update: se o tick pegou nesse meio-tempo, nada muda). */

type DB = ReturnType<typeof dbAdmin>;

export const ERRO_JA_COMECOU_CANCELAR = "Já começou: não dá mais pra cancelar.";
export const ERRO_JA_COMECOU_EDITAR = "Já começou ou foi cancelada: não dá mais pra editar.";

/** Cancela a execução e, em cascata, as seguintes dela ainda agendadas ("Adicionar outra ação"). Lança em erro. */
export async function cancelarExecucaoAgendada(id: string, db: DB = dbAdmin()): Promise<void> {
  const { data, error } = await db.from("execucoes").update({ status: "cancelada" }).eq("id", id).eq("status", "agendada").select("id");
  if (error) throw new Error(`Não foi possível cancelar: ${error.message}`);
  if (!data?.length) throw new Error(ERRO_JA_COMECOU_CANCELAR);
  // Se falhar aqui, o passo `encadeadas` do tick cancela as seguintes do mesmo jeito (anterior cancelada).
  await cancelarSeguintes([id], MOTIVO_ANTERIOR_CANCELADA, db);
}

const via = (origem: OrigemAcao) => (origem.tipo === "api" ? ` via API (chave ${origem.chave.nome})` : "");

function revalidar(campanhaId: string) {
  revalidatePath(`/campanhas/${campanhaId}`, "layout");
  revalidatePath("/acoes");
  revalidatePath("/calendario");
}

type ExecucaoAgendada = {
  id: string;
  campanha_id: string;
  tipo: TipoAcaoAssistente;
  conteudo: unknown;
  status: string;
  agendada_para: string;
  alvo_contas: string[] | null;
  alvo_grupos: string[] | null;
  importante: boolean;
};

async function carregar(db: DB, id: string): Promise<{ erro: string } | { ok: true; execucao: ExecucaoAgendada }> {
  const { data, error } = await db
    .from("execucoes")
    .select("id, campanha_id, tipo, conteudo, status, agendada_para, alvo_contas, alvo_grupos, importante")
    .eq("id", id)
    .maybeSingle();
  if (error) return { erro: "Não foi possível carregar a ação." };
  if (!data) return { erro: "Ação não encontrada." };
  return { ok: true, execucao: data as ExecucaoAgendada };
}

/** Cancelar pela API/MCP: confere que a ação existe e cancela (com as seguintes), com histórico. */
export async function cancelarAcaoComo(origem: OrigemAcao, ator: UsuarioParaHistorico, id: string): Promise<{ erro: string } | { ok: true; id: string }> {
  const db = dbAdmin();
  const c = await carregar(db, id);
  if ("erro" in c) return c;
  if (c.execucao.status !== "agendada") return { erro: ERRO_JA_COMECOU_CANCELAR };
  try {
    await cancelarExecucaoAgendada(id, db);
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "Não foi possível cancelar." };
  }
  revalidar(c.execucao.campanha_id);
  await registrarHistorico(ator, { acao: "remover", area: "Ações", resumo: `${rotuloAcaoAssistente(c.execucao.tipo)} cancelada${via(origem)}`, refId: id });
  return { ok: true, id };
}

/** O que muda numa edição: o conteúdo novo (montado a partir do atual; `undefined` = mantém) e/ou o horário
 *  (`quando` no formato do assistente; `undefined` = mantém). Tipo, campanha e alvos não mudam. */
export type Edicao = { conteudo?: (atual: { tipo: TipoAcaoAssistente; conteudo: unknown }) => unknown | { erro: string }; quando?: string };

/** Editar uma ação agendada: passa pelas MESMAS regras da criação (`validarEntradaAcao`, horário no futuro) com a
 *  campanha, o tipo e os alvos que ela já tem, e grava conteúdo + horário só se ela continuar agendada. */
export async function editarAcaoComo(
  origem: OrigemAcao,
  ator: UsuarioParaHistorico,
  id: string,
  edicao: Edicao,
): Promise<{ erro: string } | { ok: true; id: string; agendada_para: string }> {
  if (!edicao.conteudo && edicao.quando === undefined) return { erro: "Informe o que mudar: o conteúdo e/ou agendar_para." };
  const db = dbAdmin();
  const c = await carregar(db, id);
  if ("erro" in c) return c;
  const atual = c.execucao;
  if (atual.status !== "agendada") return { erro: ERRO_JA_COMECOU_EDITAR };

  let conteudo = atual.conteudo;
  if (edicao.conteudo) {
    const novo = edicao.conteudo({ tipo: atual.tipo, conteudo: atual.conteudo });
    if (novo && typeof novo === "object" && "erro" in novo && typeof (novo as { erro: unknown }).erro === "string") return novo as { erro: string };
    conteudo = novo;
  }
  const v = validarEntradaAcao({
    categoria: "campanha",
    campanhas: [atual.campanha_id],
    projetoId: null,
    tipo: atual.tipo,
    contas: atual.alvo_contas,
    grupos: atual.alvo_grupos,
    conteudo,
    importante: false,
    quando: edicao.quando ?? isoParaCampoBrasilia(atual.agendada_para),
  });
  if (!v.ok) return { erro: v.erro };
  if (v.valor.agora) return { erro: "Pra editar, o horário novo precisa ser no futuro." };

  const { data, error } = await db
    .from("execucoes")
    .update({ conteudo: v.valor.conteudo, agendada_para: v.valor.agendadaPara })
    .eq("id", id)
    .eq("status", "agendada")
    .select("id");
  if (error) return { erro: "Não foi possível salvar." };
  if (!data?.length) return { erro: ERRO_JA_COMECOU_EDITAR };
  revalidar(atual.campanha_id);
  await registrarHistorico(ator, { acao: "atualizar", area: "Ações", resumo: `${rotuloAcaoAssistente(atual.tipo)} editada${via(origem)}`, refId: id });
  return { ok: true, id, agendada_para: v.valor.agendadaPara };
}
