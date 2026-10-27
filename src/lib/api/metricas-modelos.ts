import "server-only";
import { revalidatePath } from "next/cache";
import { registrarHistorico } from "../historico";
import { TIPOS_MODELO, validarConteudo, type TipoModelo } from "../regras/conteudo";
import { validarPasta } from "../regras/modelos";
import { ehUuid } from "../regras/uuid";
import { dbAdmin } from "../supabase/admin";
import type { ChaveAutenticada } from "./auth";
import type { ResultadoApi } from "./consultas";

/** Métricas por período e modelos de mensagem pela API/MCP (19/10/2026). Mesmas regras do painel:
 *  `metricas_campanha` (dias de Brasília; entrada não conta importado nem admin) e `validarConteudo`/`validarPasta`. */

const falha = (status: number, erro: string) => ({ ok: false as const, status, erro });
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const MAXIMO_DIAS = 366;
const fmtData = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });

export type DiaMetricas = { data: string; cliques: number; entraram: number; sairam: number };
export type MetricasPeriodoApi = { campanha: { id: string; nome: string }; de: string; ate: string; cliques: number; entraram: number; sairam: number; por_dia: DiaMetricas[] };

/** Cliques no link, entradas e saídas de uma campanha entre `de` e `ate` (AAAA-MM-DD, Brasília, os dois inclusos).
 *  Sem `ate`: hoje. Sem `de`: 7 dias até `ate`. */
export async function metricasPeriodoApi(id: string, deBruto: unknown, ateBruto: unknown, hoje: Date = new Date()): Promise<ResultadoApi<MetricasPeriodoApi>> {
  if (!ehUuid(id)) return falha(400, "Campanha inválida.");
  const ate = ateBruto === undefined || ateBruto === null || ateBruto === "" ? fmtData.format(hoje) : ateBruto;
  if (typeof ate !== "string" || !DATA.test(ate) || Number.isNaN(Date.parse(ate))) return falha(400, "ate inválido: use AAAA-MM-DD.");
  const de = deBruto === undefined || deBruto === null || deBruto === "" ? somarDias(ate, -6) : deBruto;
  if (typeof de !== "string" || !DATA.test(de) || Number.isNaN(Date.parse(de))) return falha(400, "de inválido: use AAAA-MM-DD.");
  if (de > ate) return falha(400, "de precisa ser antes de ate.");
  const total = diasEntre(de, ate) + 1;
  if (total > MAXIMO_DIAS) return falha(400, `Período de até ${MAXIMO_DIAS} dias.`);
  const db = dbAdmin();
  const [camp, met] = await Promise.all([
    db.from("campanhas").select("id, nome").eq("id", id).maybeSingle(),
    db.rpc("metricas_campanha", { p_campanha: id, p_desde: `${de}T00:00:00-03:00` }),
  ]);
  if (camp.error || met.error) return falha(500, "Não foi possível carregar as métricas.");
  if (!camp.data) return falha(404, "Campanha não encontrada.");
  const porData = new Map(((met.data ?? []) as { dia: string; cliques: number | string; entradas: number | string; saidas: number | string }[]).map((l) => [String(l.dia).slice(0, 10), l]));
  const por_dia: DiaMetricas[] = Array.from({ length: total }, (_, i) => {
    const data = somarDias(de, i);
    const l = porData.get(data);
    return { data, cliques: Number(l?.cliques ?? 0), entraram: Number(l?.entradas ?? 0), sairam: Number(l?.saidas ?? 0) };
  });
  const soma = (k: "cliques" | "entraram" | "sairam") => por_dia.reduce((t, d) => t + d[k], 0);
  const c = camp.data as { id: string; nome: string };
  return { ok: true, dados: { campanha: { id: c.id, nome: c.nome }, de, ate, cliques: soma("cliques"), entraram: soma("entraram"), sairam: soma("sairam"), por_dia } };
}

function somarDias(data: string, n: number): string {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86_400_000);
}

export type ModeloApi = { id: string; nome: string; tipo: string; pasta: string | null; conteudo: unknown };

/** Modelos não arquivados, por pasta e nome. */
export async function listarModelosApi(pasta: unknown): Promise<ResultadoApi<{ modelos: ModeloApi[] }>> {
  let q = dbAdmin().from("modelos").select("id, nome, tipo, pasta, conteudo").eq("arquivado", false).order("pasta", { nullsFirst: true }).order("nome").limit(500);
  if (typeof pasta === "string" && pasta.trim()) q = q.eq("pasta", pasta.trim());
  const { data, error } = await q;
  if (error) return falha(500, "Não foi possível carregar os modelos.");
  return { ok: true, dados: { modelos: (data ?? []) as ModeloApi[] } };
}

/** Novo modelo (mesmas regras do "Salvar modelo" do painel). */
export async function criarModeloApi(chave: Pick<ChaveAutenticada, "id" | "nome">, e: { nome?: unknown; tipo?: unknown; pasta?: unknown; conteudo?: unknown }): Promise<ResultadoApi<{ id: string }>> {
  const nome = typeof e.nome === "string" ? e.nome.trim() : "";
  if (!nome || Array.from(nome).length > 60) return falha(400, "Dê um nome de até 60 caracteres.");
  if (!(TIPOS_MODELO as readonly unknown[]).includes(e.tipo)) return falha(400, `Tipo inválido: use ${TIPOS_MODELO.join(", ")}.`);
  let pasta: string | null = null;
  if (e.pasta !== undefined && e.pasta !== null) {
    if (typeof e.pasta !== "string") return falha(400, "Pasta inválida.");
    if (e.pasta.trim()) {
      const p = validarPasta(e.pasta);
      if (!p.ok) return falha(400, p.erro);
      pasta = p.nome;
    }
  }
  const v = validarConteudo(e.tipo as TipoModelo, e.conteudo);
  if (!v.ok) return falha(400, v.erro);
  const { data, error } = await dbAdmin().from("modelos").insert({ nome, tipo: e.tipo, conteudo: v.valor, pasta }).select("id").single();
  if (error || !data) return falha(500, "Não foi possível salvar o modelo.");
  const id = (data as { id: string }).id;
  revalidatePath("/modelos");
  await registrarHistorico(null, { acao: "adicionar", area: "Modelos", resumo: `Modelo "${nome}" criado via API (chave ${chave.nome})`, refId: id });
  return { ok: true, status: 201, dados: { id } };
}
