"use server";
import { headers } from "next/headers";
import {
  RESPOSTA_DA_EQUIPE,
  RESPOSTA_FORA_DA_EQUIPE,
  RESPOSTA_MUITAS_CONSULTAS,
  RESPOSTA_NUMERO_INVALIDO,
  criarLimiteConsultas,
  numeroDaEquipe,
} from "@/src/lib/regras/colaboradores";
import { dbAdmin } from "@/src/lib/supabase/admin";

export type RespostaVerificacao = { texto: string; tom: "ok" | "erro" | "neutro" } | null;

/** Freio contra varredura de números: 20 consultas a cada 10 minutos por IP (por instância do servidor). */
const permitir = criarLimiteConsultas({ maximo: 20, janelaMs: 10 * 60_000 });

const INDISPONIVEL: RespostaVerificacao = { texto: "Link indisponível.", tom: "neutro" };

/** Verificação de Colaboradores (POST: o número nunca vai pra URL). Pública: confere de novo a campanha e responde
 *  só "faz parte" / "não faz parte" — nunca nomes, números nem a lista. */
export async function verificarColaborador(slug: string, _anterior: RespostaVerificacao, form: FormData): Promise<RespostaVerificacao> {
  if (typeof slug !== "string" || !slug || slug.length > 200) return INDISPONIVEL;
  const bruto = form.get("numero");
  const numero = typeof bruto === "string" ? bruto.slice(0, 40) : "";
  if (!numero.trim()) return { texto: RESPOSTA_NUMERO_INVALIDO, tom: "neutro" };

  const db = dbAdmin();
  const { data: camp } = await db.from("campanhas").select("id, arquivada, verificacao_colaboradores, conexao_criadora_id").eq("slug", slug).maybeSingle();
  if (!camp || camp.arquivada || camp.verificacao_colaboradores !== true) return INDISPONIVEL;

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "sem-ip";
  if (!permitir(`${slug}|${ip}`, Date.now())) return { texto: RESPOSTA_MUITAS_CONSULTAS, tom: "neutro" };
  if (numeroDaEquipe(numero, []) === null) return { texto: RESPOSTA_NUMERO_INVALIDO, tom: "neutro" };

  const { data: associadas, error: erroAssociadas } = await db.from("campanha_conexoes").select("conexao_id").eq("campanha_id", camp.id);
  const ids = new Set(((associadas ?? []) as { conexao_id: string }[]).map((a) => a.conexao_id));
  if (camp.conexao_criadora_id) ids.add(camp.conexao_criadora_id);
  const { data: contas, error: erroContas } = ids.size ? await db.from("conexoes").select("telefone").in("id", [...ids]) : { data: [], error: null };
  if (erroAssociadas || erroContas) return { texto: "Não foi possível verificar agora. Tente de novo em instantes.", tom: "neutro" };

  const daEquipe = numeroDaEquipe(numero, ((contas ?? []) as { telefone: string | null }[]).map((c) => c.telefone));
  return daEquipe ? { texto: RESPOSTA_DA_EQUIPE, tom: "ok" } : { texto: RESPOSTA_FORA_DA_EQUIPE, tom: "erro" };
}
