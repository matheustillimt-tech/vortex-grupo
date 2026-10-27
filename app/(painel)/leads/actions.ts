"use server";
import { revalidatePath } from "next/cache";
import { bloquearTelefones, desbloquearTelefone, reenfileirarBloqueados, type ResultadoBloqueio } from "@/src/lib/bloqueio";
import { registrarHistorico } from "@/src/lib/historico";
import { FONTE_BLOQUEADOS } from "@/src/lib/regras/antispam";
import { validarCampos, validarNomeLead } from "@/src/lib/regras/leads";
import { lerListaDeTelefones } from "@/src/lib/regras/lista-telefones";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { checarPermissao, exigirPermissao } from "@/src/lib/permissoes";
import { textoNumeroAdministrativo } from "@/src/lib/regras/administrativos";
import { normalizarTelefone, telefoneLegivel } from "@/src/lib/telefone";
import { pegarTravaConta } from "@/src/lib/trava";

const MAX_LINHAS = 5000;
const MAX_LOTE = 100;
const MAX_BRUTO = 500;
const PAGINA_ANALISE = 1000;
const ORCAMENTO_ANALISE_MS = 45_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Botão "Escanear" da aba Grupos do detalhe da conta (Etapa 3K, Tarefa 4): mesma trava de 2 minutos de
// `atualizarLeads`. Só vale pra chamada com `conexaoId` — o botão "Analisar grupos" do Anti-spam (sem conta) não
// muda (comportamento de hoje, sem trava).
const THROTTLE_ESCANEAR_MS = 2 * 60_000;

function atualizarTelas(telefone?: string) {
  revalidatePath("/leads", "layout");
  revalidatePath("/anti-spam", "layout");
  if (telefone) revalidatePath(`/leads/${telefone}`);
}

/** Valida que `telefones` é um array de strings, normaliza cada uma, remove duplicados e corta em `maximo`.
 *  Qualquer outro valor (undefined, número, objeto) vira lista vazia. Corta os itens brutos em `MAX_BRUTO` antes
 *  de normalizar, pra um array gigante não custar caro só pra ser descartado depois. */
function normalizarTelefones(telefones: unknown, maximo: number): string[] {
  if (!Array.isArray(telefones)) return [];
  const unicos = new Set<string>();
  for (const t of telefones.slice(0, MAX_BRUTO)) {
    if (typeof t !== "string") continue;
    const n = normalizarTelefone(t);
    if (n) unicos.add(n);
  }
  return [...unicos].slice(0, maximo);
}

/** Últimos 4 dígitos, pra identificar o telefone no histórico sem gravá-lo inteiro. */
function mascarado(telefone: string): string {
  return `•••${telefone.slice(-4)}`;
}

export async function bloquearPessoa(telefone: string, motivo: string): Promise<{ erro?: string; resumo?: ResultadoBloqueio }> {
  const acesso = await checarPermissao("antispam", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  const t = normalizarTelefone(telefone);
  if (!t) return { erro: "Telefone inválido." };
  try {
    const resumo = await bloquearTelefones(dbAdmin(), [{ telefone: t, motivo: motivo.trim() || null }], "botao", usuario.id);
    if (resumo.ignorados.length) return { erro: "Esse é um número conectado no sistema: não dá pra bloquear." };
    if (resumo.administrativos?.length) return { erro: textoNumeroAdministrativo(telefoneLegivel(t)) };
    atualizarTelas(t);
    await registrarHistorico(usuario, { acao: "adicionar", area: "Anti-spam", resumo: `Telefone bloqueado (${mascarado(t)})` });
    return { resumo };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "Não foi possível bloquear." };
  }
}

export async function bloquearVarios(texto: string, motivo: string, origem: "manual" | "csv"): Promise<{ erro?: string; resumo?: ResultadoBloqueio & { invalidos: string[] } }> {
  const acesso = await checarPermissao("antispam", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  if (origem !== "manual" && origem !== "csv") return { erro: "Origem inválida." };
  if (texto.split(/\r?\n/).length > MAX_LINHAS) return { erro: `No máximo ${MAX_LINHAS} linhas por vez.` };
  const { validos, invalidos } = lerListaDeTelefones(texto);
  if (!validos.length) return { erro: invalidos.length ? "Nenhum telefone válido na lista." : "Cole pelo menos um telefone." };
  const padrao = motivo.trim() || null;
  try {
    const resumo = await bloquearTelefones(dbAdmin(), validos.map((v) => ({ telefone: v.telefone, motivo: v.motivo ?? padrao })), origem, usuario.id);
    atualizarTelas();
    if (resumo.novos) await registrarHistorico(usuario, { acao: "adicionar", area: "Anti-spam", resumo: `${resumo.novos} telefone(s) bloqueado(s)` });
    return { resumo: { ...resumo, invalidos } };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "Não foi possível bloquear." };
  }
}

export async function desbloquear(telefone: string): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("antispam", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  const t = typeof telefone === "string" ? normalizarTelefone(telefone) : null;
  if (!t) return { erro: "Telefone inválido." };
  try {
    await desbloquearTelefone(dbAdmin(), t);
    atualizarTelas(t);
    await registrarHistorico(usuario, { acao: "remover", area: "Anti-spam", resumo: `Telefone desbloqueado (${mascarado(t)})` });
    return {};
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "Não foi possível desbloquear." };
  }
}

/** Desbloqueia em lote (botão "desbloquear selecionados"), até `MAX_LOTE` números por chamada. */
export async function desbloquearVarios(telefones: unknown): Promise<{ erro?: string; desbloqueados?: number }> {
  const acesso = await checarPermissao("antispam", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  const lista = normalizarTelefones(telefones, MAX_LOTE);
  if (!lista.length) return { erro: "Nenhum telefone válido." };
  const db = dbAdmin();
  try {
    for (const t of lista) await desbloquearTelefone(db, t);
    atualizarTelas();
    await registrarHistorico(usuario, { acao: "remover", area: "Anti-spam", resumo: `${lista.length} telefone(s) desbloqueado(s)` });
    return { desbloqueados: lista.length };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "Não foi possível desbloquear." };
  }
}

export type ResultadoAnaliseGrupos = {
  processados: number;
  remocoes: number;
  parcial: boolean;
  /** Só quando `parcial`: o último telefone conferido. Passe em `depois` na próxima chamada pra continuar dali. */
  proximo?: string;
};

/** Relê os bloqueados (em ordem de telefone, páginas de 1000) e enfileira a remoção de quem está em grupo, sem
 *  regravar a tabela `bloqueados` (preserva motivo/origem já salvos). Serve pra pegar quem entrou num grupo sem passar
 *  pela conferência de rotina. Pra uma base grande de bloqueados não travar a chamada (o servidor corta requisições
 *  longas), para depois de ~45s e devolve `parcial: true` com `proximo` (cursor): o botão chama de novo passando
 *  `depois = proximo` e continua de onde parou, sem repetir nem pular ninguém.
 *
 *  `conexaoId` (botão "Escanear" da aba Grupos do detalhe da conta, Etapa 3K Tarefa 4): analisa só os grupos
 *  dessa conta (`reenfileirarBloqueados` ganhou o mesmo parâmetro) e troca a permissão pra `contas`/`editar` (o
 *  botão "Analisar grupos" do Anti-spam, sem conta, continua exigindo `antispam`/`editar`, sem trava — comportamento
 *  de hoje). Com conta, também exige `antispam`/`editar`, e uma trava atômica de 2 minutos
 *  (`conexoes.grupos_escaneados_em`) evita clique duplo; a continuação (`depois`) não passa pela trava. */
export async function analisarGrupos(depois?: string, conexaoId?: string): Promise<{ erro?: string; resumo?: ResultadoAnaliseGrupos }> {
  const acesso = await checarPermissao(conexaoId ? "contas" : "antispam", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  // Com conta: além de Contas/editar, também Anti-spam/editar (a análise enfileira remoções do anti-spam).
  if (conexaoId) {
    const antispam = await checarPermissao("antispam", "editar");
    if (!antispam.ok) return { erro: antispam.erro };
  }
  const usuario = acesso.usuario;
  if (depois !== undefined && (typeof depois !== "string" || !/^\d{1,20}$/.test(depois))) return { erro: "Ponto de continuação inválido." };
  if (conexaoId !== undefined && !UUID.test(conexaoId)) return { erro: "Conexão inválida." };
  const db = dbAdmin();
  // Continuação (`depois`) de uma análise parcial: é o mesmo pedido, não passa pela trava de novo.
  if (conexaoId && depois === undefined) {
    const { data: conta, error: erroConta } = await db.from("conexoes").select("grupos_escaneados_em").eq("id", conexaoId).maybeSingle();
    if (erroConta) return { erro: "Não foi possível conferir a conexão." };
    if (!conta) return { erro: "Conexão não encontrada." };
    const ultima = (conta as { grupos_escaneados_em: string | null }).grupos_escaneados_em;
    if (ultima && Date.now() - Date.parse(ultima) < THROTTLE_ESCANEAR_MS) return { erro: "Aguarde 2 minutos entre duas atualizações." };
    // Trava atômica: dois cliques ao mesmo tempo, só um analisa.
    const trava = await pegarTravaConta(db, { conexaoId, coluna: "grupos_escaneados_em", ms: THROTTLE_ESCANEAR_MS });
    if (!trava.ok) return { erro: trava.motivo === "ocupada" ? "Aguarde 2 minutos entre duas atualizações." : "Não foi possível pedir a análise. Tente de novo." };
  }
  const prazo = Date.now() + ORCAMENTO_ANALISE_MS;
  try {
    let cursor = depois;
    let remocoes = 0;
    let processados = 0;
    let parcial = false;
    for (;;) {
      if (Date.now() >= prazo) {
        parcial = true;
        break;
      }
      // Bloqueados + números das blacklists ativas (fonte única do anti-spam).
      let consulta = db.from(FONTE_BLOQUEADOS).select("telefone").order("telefone", { ascending: true });
      if (cursor) consulta = consulta.gt("telefone", cursor);
      const { data, error } = await consulta.limit(PAGINA_ANALISE);
      if (error) return { erro: "Não foi possível ler os bloqueados." };
      const lote = ((data ?? []) as { telefone: string }[]).map((b) => b.telefone);
      if (!lote.length) break;
      remocoes += await reenfileirarBloqueados(db, lote, conexaoId);
      processados += lote.length;
      cursor = lote[lote.length - 1];
      if (lote.length < PAGINA_ANALISE) break;
    }
    atualizarTelas();
    if (remocoes) await registrarHistorico(usuario, { acao: "executar", area: conexaoId ? "Contas" : "Anti-spam", resumo: `Análise de grupos: ${remocoes} remoção(ões) enfileirada(s)`, ...(conexaoId ? { refId: conexaoId } : {}) });
    return { resumo: { processados, remocoes, parcial, ...(parcial && cursor ? { proximo: cursor } : {}) } };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "Não foi possível analisar os grupos." };
  }
}

/** Tag existente (`tagId`) ou manual nova (`novaTag`): cria se não existir, reaproveita se já existir (sem
 *  diferenciar maiúsculas). Reaproveitada pela página do lead e pelo cadastro manual (Visão geral). */
async function resolverOuCriarTag(db: ReturnType<typeof dbAdmin>, tagId: string | null, novaTag: string): Promise<{ id?: string; erro?: string }> {
  if (tagId !== null && (typeof tagId !== "string" || !UUID.test(tagId))) return { erro: "Tag inválida." };
  let id = tagId;
  const nome = typeof novaTag === "string" ? novaTag.trim() : "";
  if (!id && nome) {
    if (nome.length > 40) return { erro: "Nome da tag com no máximo 40 letras." };
    const { data: criada, error } = await db.from("tags").insert({ nome, tipo: "manual" }).select("id").single();
    if (error && error.code !== "23505") return { erro: "Não foi possível criar a tag." };
    if (criada) id = criada.id;
    else {
      const escapado = nome.replace(/[\\%_]/g, (c) => "\\" + c);
      const { data: existente } = await db.from("tags").select("id").eq("tipo", "manual").ilike("nome", escapado).maybeSingle();
      id = existente?.id ?? null;
    }
  }
  if (!id) return { erro: "Escolha uma tag ou digite o nome de uma nova." };
  return { id };
}

/** Tag existente (`tagId`) ou manual nova (`novaTag`). */
export async function porTagNaPessoa(telefone: string, tagId: string | null, novaTag: string): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("leads", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  const t = typeof telefone === "string" ? normalizarTelefone(telefone) : null;
  if (!t) return { erro: "Telefone inválido." };
  const db = dbAdmin();
  const resolvida = await resolverOuCriarTag(db, tagId, novaTag);
  if (resolvida.erro) return { erro: resolvida.erro };
  const id = resolvida.id!;
  const { error } = await db.rpc("por_tag", { p_telefones: [t], p_tag: id, p_campanha: null });
  if (error) return { erro: "Não foi possível pôr a tag." };
  atualizarTelas(t);
  await registrarHistorico(usuario, { acao: "atualizar", area: "Leads", resumo: `Tag posta no lead (${mascarado(t)})`, refId: id });
  return {};
}

// ---------- Visão geral (cadastro — Etapa 3I, Tarefa 1) ----------

export type DadosCadastroLead = {
  telefone: string;
  nome?: unknown;
  campos?: unknown;
  tagIds?: unknown;
  novaTag?: unknown;
};

/** Diálogo "Cadastrar" da Visão geral: grava em `contatos` (upsert por telefone) e, se vierem tags, grava em
 *  `pessoa_tags` (reaproveita a tag existente ou cria uma manual nova, idêntico ao "pôr tag" da página do lead).
 *  Um contato cadastrado à mão aparece na Visão geral mesmo sem nunca ter entrado num grupo (a RPC `listar_leads`
 *  já faz a união). */
export async function cadastrarLead(dados: DadosCadastroLead): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("leads", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  const t = typeof dados?.telefone === "string" ? normalizarTelefone(dados.telefone) : null;
  if (!t) return { erro: "Número do WhatsApp inválido." };
  const nomeValidado = validarNomeLead(dados?.nome);
  if ("erro" in nomeValidado) return { erro: nomeValidado.erro };
  const camposValidados = validarCampos(dados?.campos);
  if ("erro" in camposValidados) return { erro: camposValidados.erro };
  const db = dbAdmin();

  const tagIds = (Array.isArray(dados?.tagIds) ? dados.tagIds : []).filter((id): id is string => typeof id === "string" && UUID.test(id));
  const novaTag = typeof dados?.novaTag === "string" ? dados.novaTag.trim() : "";
  if (novaTag) {
    const resolvida = await resolverOuCriarTag(db, null, novaTag);
    if (resolvida.erro) return { erro: resolvida.erro };
    if (resolvida.id) tagIds.push(resolvida.id);
  }

  const { error } = await db.from("contatos").upsert({ telefone: t, nome: nomeValidado.nome, campos: camposValidados.campos });
  if (error) return { erro: "Não foi possível cadastrar o lead." };
  for (const id of new Set(tagIds)) {
    const { error: erroTag } = await db.rpc("por_tag", { p_telefones: [t], p_tag: id, p_campanha: null });
    if (erroTag) return { erro: "Lead cadastrado, mas não foi possível pôr uma das tags." };
  }
  atualizarTelas(t);
  await registrarHistorico(usuario, { acao: "adicionar", area: "Leads", resumo: `Lead cadastrado (${mascarado(t)})` });
  return {};
}

/** Nome e campos editáveis na página do lead (`/leads/[telefone]`); upsert por telefone, idêntico ao cadastro. */
export async function atualizarLead(telefone: string, nome: unknown, campos: unknown): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("leads", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  const t = typeof telefone === "string" ? normalizarTelefone(telefone) : null;
  if (!t) return { erro: "Telefone inválido." };
  const nomeValidado = validarNomeLead(nome);
  if ("erro" in nomeValidado) return { erro: nomeValidado.erro };
  const camposValidados = validarCampos(campos);
  if ("erro" in camposValidados) return { erro: camposValidados.erro };
  const { error } = await dbAdmin().from("contatos").upsert({ telefone: t, nome: nomeValidado.nome, campos: camposValidados.campos });
  if (error) return { erro: "Não foi possível salvar." };
  atualizarTelas(t);
  await registrarHistorico(usuario, { acao: "atualizar", area: "Leads", resumo: `Lead atualizado (${mascarado(t)})` });
  return {};
}

export async function tirarTagDaPessoa(telefone: string, tagId: string, campanhaId: string | null): Promise<void> {
  const { usuario } = await exigirPermissao("leads", "editar");
  const t = typeof telefone === "string" ? normalizarTelefone(telefone) : null;
  if (!t) throw new Error("Telefone inválido.");
  if (typeof tagId !== "string" || !UUID.test(tagId)) throw new Error("Tag inválida.");
  if (campanhaId !== null && (typeof campanhaId !== "string" || !UUID.test(campanhaId))) throw new Error("Campanha inválida.");
  const { error } = await dbAdmin().rpc("tirar_tag", { p_telefones: [t], p_tag: tagId, p_campanha: campanhaId });
  if (error) throw new Error("Não foi possível tirar a tag.");
  atualizarTelas(t);
  await registrarHistorico(usuario, { acao: "atualizar", area: "Leads", resumo: `Tag removida do lead (${mascarado(t)})`, refId: tagId });
}

// ---------- Tags manuais (aba Tags) ----------

const MAX_NOME_TAG = 40;
const ERRO_REPETIDA = "Já existe uma tag com esse nome.";

/** Nome válido (1–40 letras depois de tirar os espaços das pontas) ou a mensagem de erro. */
function nomeDeTag(bruto: unknown): { nome: string } | { erro: string } {
  if (typeof bruto !== "string") return { erro: "Digite o nome da tag." };
  const nome = bruto.trim();
  if (!nome) return { erro: "Digite o nome da tag." };
  if (nome.length > MAX_NOME_TAG) return { erro: `Nome da tag com no máximo ${MAX_NOME_TAG} letras.` };
  return { nome };
}

/** Confere que a tag existe e é manual (as automáticas — campanha, Comprador, Saiu — não se renomeiam nem se excluem). */
async function tagManual(db: ReturnType<typeof dbAdmin>, id: unknown): Promise<{ erro?: string }> {
  if (typeof id !== "string" || !UUID.test(id)) return { erro: "Tag inválida." };
  const { data, error } = await db.from("tags").select("id, tipo").eq("id", id).maybeSingle();
  if (error) return { erro: "Não foi possível ler a tag." };
  if (!data) return { erro: "Tag não encontrada." };
  if (data.tipo !== "manual") return { erro: "Tag automática: não dá pra renomear nem excluir." };
  return {};
}

export async function criarTag(nome: string): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("leads", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  const v = nomeDeTag(nome);
  if ("erro" in v) return v;
  const { error } = await dbAdmin().from("tags").insert({ nome: v.nome, tipo: "manual" });
  if (error) return { erro: error.code === "23505" ? ERRO_REPETIDA : "Não foi possível criar a tag." };
  atualizarTelas();
  await registrarHistorico(usuario, { acao: "adicionar", area: "Leads", resumo: `Tag "${v.nome}" criada` });
  return {};
}

export async function renomearTag(id: string, nome: string): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("leads", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  if (typeof id !== "string" || !UUID.test(id)) return { erro: "Tag inválida." };
  const v = nomeDeTag(nome);
  if ("erro" in v) return v;
  const db = dbAdmin();
  const conferida = await tagManual(db, id);
  if (conferida.erro) return conferida;
  const { error } = await db.from("tags").update({ nome: v.nome }).eq("id", id).eq("tipo", "manual");
  if (error) return { erro: error.code === "23505" ? ERRO_REPETIDA : "Não foi possível renomear a tag." };
  atualizarTelas();
  await registrarHistorico(usuario, { acao: "atualizar", area: "Leads", resumo: `Tag renomeada para "${v.nome}"`, refId: id });
  return {};
}

/** Exclui a tag manual; as marcações nas pessoas saem junto (`on delete cascade`). */
export async function excluirTag(id: string): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("leads", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  const db = dbAdmin();
  const conferida = await tagManual(db, id);
  if (conferida.erro) return conferida;
  const { error } = await db.from("tags").delete().eq("id", id).eq("tipo", "manual");
  if (error) return { erro: "Não foi possível excluir a tag." };
  atualizarTelas();
  await registrarHistorico(usuario, { acao: "remover", area: "Leads", resumo: "Tag excluída", refId: id });
  return {};
}
