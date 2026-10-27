import "server-only";
import { revalidatePath } from "next/cache";
import { slugUnico } from "../campanhas/slug";
import { env } from "../env";
import { registrarHistorico } from "../historico";
import { aplicarPadraoNaCriacao } from "../padrao-campanha";
import { normalizarAdminsNumeros } from "../regras/admins-numeros";
import { validarCampanha, type CampanhaEntrada } from "../regras/campanha";
import { TIPOS_CAMPANHA, type CampanhaTipo } from "../regras/campanha-tipo";
import { ehUuid } from "../regras/uuid";
import { dbAdmin } from "../supabase/admin";
import type { ChaveAutenticada } from "./auth";
import type { ResultadoApi } from "./consultas";

/** "Criar campanha" pela API/MCP (19/10/2026). Do zero = o diálogo "Criar campanha" do painel (`criarCampanha`:
 *  padrões do banco + Padrão de criação); `copiar_de` = o "Duplicar" do painel (`duplicarCampanha`: configurações,
 *  contas, variáveis e regras de compra, nunca grupos nem dados operacionais), com o nome escolhido. */

export type CampanhaCriadaApi = { id: string; nome: string; slug: string; link: string; painel: string };

type Entrada = { nome?: unknown; tipo?: unknown; copiar_de?: unknown; projeto?: unknown };

const falha = (status: number, erro: string) => ({ ok: false as const, status, erro });
const MAXIMO_NOME = 80;

export async function criarCampanhaApi(chave: Pick<ChaveAutenticada, "id" | "nome">, e: Entrada): Promise<ResultadoApi<CampanhaCriadaApi>> {
  const nome = typeof e.nome === "string" ? e.nome.trim() : "";
  if (!nome) return falha(400, "Dê um nome à campanha.");
  if (Array.from(nome).length > MAXIMO_NOME) return falha(400, `O nome vai até ${MAXIMO_NOME} caracteres.`);
  const copiarDe = e.copiar_de === undefined || e.copiar_de === null || e.copiar_de === "" ? null : e.copiar_de;
  if (copiarDe !== null && (typeof copiarDe !== "string" || !ehUuid(copiarDe))) return falha(400, "copiar_de inválido: use o id de uma campanha.");
  const db = dbAdmin();
  const r = copiarDe ? await copiar(db, copiarDe as string, nome) : await doZero(db, nome, e.tipo, e.projeto);
  if (!r.ok) return r;
  revalidatePath("/campanhas");
  revalidatePath("/", "layout");
  revalidatePath("/projetos");
  await registrarHistorico(null, {
    acao: "adicionar",
    area: "Campanhas",
    resumo: `Campanha "${nome}" criada${copiarDe ? ` como cópia de "${r.dados.origem}"` : ""} via API (chave ${chave.nome})`,
    refId: r.dados.id,
  });
  const site = env("NEXT_PUBLIC_SITE_URL");
  return { ok: true, status: 201, dados: { id: r.dados.id, nome, slug: r.dados.slug, link: `${site}/l/${r.dados.slug}`, painel: `${site}/campanhas/${r.dados.id}` } };
}

type DB = ReturnType<typeof dbAdmin>;
type Criada = ResultadoApi<{ id: string; slug: string; origem?: string }>;

async function copiar(db: DB, origemId: string, nome: string): Promise<Criada> {
  const { data: original, error } = await db.from("campanhas").select("*").eq("id", origemId).maybeSingle();
  if (error) return falha(500, "Não foi possível ler a campanha.");
  if (!original) return falha(404, "Campanha de origem não encontrada.");
  const [conexoes, variaveis, regras] = await Promise.all([
    db.from("campanha_conexoes").select("conexao_id").eq("campanha_id", origemId),
    db.from("campanha_variaveis").select("chave, valor").eq("campanha_id", origemId),
    db.from("regras_compra").select("provedor, produto").eq("campanha_id", origemId),
  ]);
  if (conexoes.error || variaveis.error || regras.error) return falha(500, "Não foi possível ler as configurações da campanha.");
  const slug = await slugUnico(db, nome);
  // Mesmos campos que o "Duplicar" do painel deixa de fora; a cópia nunca nasce arquivada.
  const { id: _i, slug: _s, created_at: _c, updated_at: _u, fixada: _f, comunidade_id: _co, ...resto } = original as Record<string, unknown>;
  const { data: nova, error: erroNova } = await db.from("campanhas").insert({ ...resto, nome, slug, arquivada: false }).select("id").single();
  if (erroNova || !nova) return falha(500, "Não foi possível criar a campanha.");
  const id = (nova as { id: string }).id;
  const c = (conexoes.data ?? []) as { conexao_id: string }[];
  const v = (variaveis.data ?? []) as { chave: string; valor: string }[];
  const g = (regras.data ?? []) as { provedor: string; produto: string }[];
  if (c.length) await db.from("campanha_conexoes").insert(c.map((x) => ({ campanha_id: id, conexao_id: x.conexao_id })));
  if (v.length) await db.from("campanha_variaveis").insert(v.map((x) => ({ campanha_id: id, chave: x.chave, valor: x.valor })));
  if (g.length) await db.from("regras_compra").insert(g.map((x) => ({ campanha_id: id, provedor: x.provedor, produto: x.produto })));
  return { ok: true, dados: { id, slug, origem: (original as { nome: string }).nome } };
}

async function doZero(db: DB, nome: string, tipoBruto: unknown, projetoBruto: unknown): Promise<Criada> {
  const tipo = tipoBruto === undefined || tipoBruto === null || tipoBruto === "" ? "campanha" : tipoBruto;
  if (!TIPOS_CAMPANHA.includes(tipo as CampanhaTipo)) return falha(400, `Tipo inválido: use ${TIPOS_CAMPANHA.join(", ")}.`);
  const projeto = projetoBruto === undefined || projetoBruto === null || projetoBruto === "" ? null : projetoBruto;
  if (projeto !== null) {
    if (typeof projeto !== "string" || !ehUuid(projeto)) return falha(400, "Projeto inválido.");
    const { data: p, error } = await db.from("projetos").select("id, arquivado").eq("id", projeto).maybeSingle();
    if (error) return falha(500, "Não foi possível verificar o projeto.");
    if (!p) return falha(404, "Projeto não encontrado.");
    if ((p as { arquivado: boolean }).arquivado) return falha(400, "Esse projeto está arquivado; escolha outro.");
  }
  // Nasce sem número (idêntico ao painel): só cria grupos depois que alguém associar uma conexão.
  const slug = await slugUnico(db, nome);
  const entrada: CampanhaEntrada = {
    nome,
    slug,
    padrao_nome: "GRUPO #{n}",
    descricao: "",
    fechado: true,
    limite_por_grupo: 350,
    folga: 1,
    conexao_criadora_id: "",
    admins: [],
    usar_comunidade: false,
    crm_webhook_url: "",
    projeto_id: projeto as string | null,
    tipo: tipo as CampanhaTipo,
  };
  const { entrada: aplicada, adminsNumeros } = await aplicarPadraoNaCriacao(entrada);
  const v = validarCampanha(aplicada);
  if (!v.ok) return falha(400, v.erro);
  const n = normalizarAdminsNumeros(adminsNumeros);
  if (!n.ok) return falha(400, n.erro);
  const { admins, ...campos } = v.valor;
  const r = await db.from("campanhas").insert(campos).select("id").single();
  if (r.error || !r.data) return falha(r.error?.code === "23505" ? 409 : 500, r.error?.code === "23505" ? "Já existe uma campanha com esse endereço de link." : "Não foi possível criar a campanha.");
  const id = (r.data as { id: string }).id;
  if (admins.length) await db.from("campanha_conexoes").insert(admins.map((conexao_id) => ({ campanha_id: id, conexao_id })));
  if (n.valor.length) await db.from("campanha_admins_numeros").insert(n.valor.map((telefone) => ({ campanha_id: id, telefone, criado_por: null })));
  return { ok: true, dados: { id, slug } };
}

/** "Arquivar" pela API/MCP (21/10/2026) = o "Arquivar"/"Desarquivar" do painel (`arquivarCampanha`): só tira a
 *  campanha da lista; grupos, mensagens e dados continuam. */
export async function arquivarCampanhaApi(
  chave: Pick<ChaveAutenticada, "id" | "nome">,
  e: { campanha?: unknown; arquivada?: unknown },
): Promise<ResultadoApi<{ id: string; nome: string; arquivada: boolean }>> {
  if (typeof e.campanha !== "string" || !ehUuid(e.campanha)) return falha(400, "Campanha inválida: use o id de uma campanha.");
  const arquivada = e.arquivada !== false;
  const db = dbAdmin();
  const { data: campanha, error } = await db.from("campanhas").select("id, nome").eq("id", e.campanha).maybeSingle();
  if (error) return falha(500, "Não foi possível ler a campanha.");
  if (!campanha) return falha(404, "Campanha não encontrada.");
  const { nome } = campanha as { nome: string };
  const r = await db.from("campanhas").update({ arquivada }).eq("id", e.campanha);
  if (r.error) return falha(500, "Não foi possível arquivar.");
  revalidatePath("/campanhas");
  revalidatePath("/", "layout");
  await registrarHistorico(null, {
    acao: "atualizar",
    area: "Campanhas",
    resumo: `Campanha "${nome}" ${arquivada ? "arquivada" : "desarquivada"} via API (chave ${chave.nome})`,
    refId: e.campanha,
  });
  return { ok: true, dados: { id: e.campanha, nome, arquivada } };
}

/** "Excluir" pela API/MCP (21/10/2026) = o "Excluir" do painel (`excluirCampanha`): exige o nome exato da campanha e
 *  nenhum envio em andamento. Apaga em cascata grupos, cliques, ações, automações etc. do Vórtex Grupo; os grupos
 *  continuam existindo no WhatsApp. Histórico gravado antes (depois não há campanha pra linkar). */
export async function excluirCampanhaApi(
  chave: Pick<ChaveAutenticada, "id" | "nome">,
  e: { campanha?: unknown; confirmar_nome?: unknown },
): Promise<ResultadoApi<{ id: string; nome: string; excluida: true }>> {
  if (typeof e.campanha !== "string" || !ehUuid(e.campanha)) return falha(400, "Campanha inválida: use o id de uma campanha.");
  const db = dbAdmin();
  const { data: campanha, error } = await db.from("campanhas").select("id, nome").eq("id", e.campanha).maybeSingle();
  if (error) return falha(500, "Não foi possível ler a campanha.");
  if (!campanha) return falha(404, "Campanha não encontrada.");
  const { nome } = campanha as { nome: string };
  const digitado = typeof e.confirmar_nome === "string" ? e.confirmar_nome.trim() : "";
  if (digitado !== nome) return falha(400, "O nome em confirmar_nome não é idêntico ao nome da campanha.");

  const { data: enviando, error: erroExec } = await db.from("execucoes").select("id").eq("campanha_id", e.campanha).eq("status", "enviando").limit(1);
  if (erroExec) return falha(500, "Não foi possível verificar os envios em andamento.");
  if (((enviando ?? []) as unknown[]).length > 0) return falha(409, "Há um envio em andamento nesta campanha; espere terminar para excluir.");

  await registrarHistorico(null, { acao: "remover", area: "Campanhas", resumo: `Campanha "${nome}" excluída via API (chave ${chave.nome})`, refId: e.campanha });
  const { error: erroDel } = await db.from("campanhas").delete().eq("id", e.campanha);
  if (erroDel) return falha(500, "Não foi possível excluir a campanha.");
  revalidatePath("/campanhas");
  revalidatePath("/", "layout");
  revalidatePath("/projetos");
  return { ok: true, dados: { id: e.campanha, nome, excluida: true } };
}
