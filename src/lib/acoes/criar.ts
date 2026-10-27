import "server-only";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { contasDaCampanha, type ContaDaCampanha } from "@/app/(painel)/_acoes/contas-da-campanha";
import { registrarHistorico, type UsuarioParaHistorico } from "../historico";
import { MAXIMO_ITENS_ACAO, rotuloAcaoAssistente, TIPOS_SO_PAINEL, validarEntradaAcao, type EntradaAcaoValida } from "../regras/assistente-acao";
import { dbAdmin } from "../supabase/admin";

/** De onde veio a ação: o assistente do painel ou a API v1 / MCP (com a chave, pro histórico). */
export type OrigemAcao = { tipo: "painel" } | { tipo: "api"; chave: { id: string; nome: string } };

type DB = ReturnType<typeof dbAdmin>;

/** Tamanho do lote de `.in("id", …)`: até 1000 ids de uma vez estoura o limite de tamanho da URL (GET), então
 *  qualquer lista de ids vinda do assistente (até `MAXIMO_ITENS_ACAO`) é dividida em lotes menores e os
 *  resultados são juntados. */
const TAMANHO_LOTE_IN = 150;

async function selecionarEmLotes<T>(
  ids: string[],
  consultar: (lote: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<{ data: T[] } | { error: string }> {
  const lotes: string[][] = [];
  for (let i = 0; i < ids.length; i += TAMANHO_LOTE_IN) lotes.push(ids.slice(i, i + TAMANHO_LOTE_IN));
  const resultados = await Promise.all(lotes.map(consultar));
  const comErro = resultados.find((r) => r.error);
  if (comErro) return { error: comErro.error!.message };
  return { data: resultados.flatMap((r) => r.data ?? []) };
}

/**
 * Núcleo de "Adicionar ação" (assistente do painel e API v1/MCP — as mesmas regras, sem cópia): uma execução
 * avulsa por campanha (todas no mesmo horário), com as contas e os grupos escolhidos (`alvo_contas`/`alvo_grupos`,
 * `null` = todos). Confere tudo no servidor: formato e conteúdo (`validarEntradaAcao`), campanhas existem e não
 * estão arquivadas (ou as ativas do projeto), contas e grupos são da campanha, destino de "mover grupos" existe,
 * não está arquivado e não é uma das campanhas. NÃO confere permissão: quem chama já conferiu (a server action
 * pelo papel do usuário; a API pela chave com escopo `envio`). `ator` = usuário logado (painel) ou `null` (API).
 * "Adicionar outra ação" (`seguintes`, só o painel): cada ação extra vira mais uma execução por campanha, com o
 * mesmo destino e horário e `depois_de` = a anterior da mesma campanha (o tick só a solta quando a anterior
 * terminou). Tudo num único insert: ou entra a corrente inteira, ou nada. `ids` = todas as execuções criadas.
 */
export async function criarAcaoComo(origem: OrigemAcao, ator: UsuarioParaHistorico, entrada: unknown): Promise<{ erro: string } | { ok: true; ids: string[] }> {
  // As ações da Etapa 3K (relatórios, Entrar no Grupo, Privacidade Avançada) são só do painel: pela API v1/MCP a
  // resposta continua a de antes pra um tipo que ela não conhece.
  const tipoBruto = (entrada as { tipo?: unknown } | null)?.tipo;
  if (origem.tipo === "api" && (TIPOS_SO_PAINEL as readonly unknown[]).includes(tipoBruto)) return { erro: "Escolha a ação." };
  const v = validarEntradaAcao(entrada);
  if (!v.ok) return { erro: v.erro };
  const e = v.valor;
  const db = dbAdmin();
  if (e.tipo === "entrar_grupo") return criarEntrarNoGrupo(db, ator, e);

  // Campanhas da ação.
  let campanhas: string[];
  if (e.categoria === "campanha") {
    const r = await selecionarEmLotes(e.campanhas, (lote) => db.from("campanhas").select("id, arquivada").in("id", lote));
    if ("error" in r) return { erro: "Não foi possível conferir as campanhas." };
    const linhas = r.data as { id: string; arquivada: boolean }[];
    if (linhas.length !== e.campanhas.length) return { erro: "Campanha não encontrada." };
    if (linhas.some((c) => c.arquivada)) return { erro: "Campanha arquivada não recebe ação." };
    campanhas = e.campanhas;
  } else {
    const { data: projeto, error } = await db.from("projetos").select("id, arquivado").eq("id", e.projetoId!).maybeSingle();
    if (error) return { erro: "Não foi possível conferir o projeto." };
    if (!projeto) return { erro: "Projeto não encontrado." };
    if ((projeto as { arquivado: boolean }).arquivado) return { erro: "Projeto arquivado." };
    const { data, error: erroCampanhas } = await db.from("campanhas").select("id").eq("projeto_id", e.projetoId!).eq("arquivada", false).order("nome").limit(MAXIMO_ITENS_ACAO);
    if (erroCampanhas) return { erro: "Não foi possível carregar as campanhas do projeto." };
    campanhas = ((data ?? []) as { id: string }[]).map((c) => c.id);
    if (!campanhas.length) return { erro: "Esse projeto não tem campanhas ativas." };
  }

  // Contas e grupos específicos: só com uma campanha, e têm que ser dela.
  if ((e.contas || e.grupos) && campanhas.length !== 1) return { erro: "Conexões e grupos específicos só valem com uma campanha." };
  if (e.contas) {
    let daCampanha: ContaDaCampanha[];
    try {
      daCampanha = await contasDaCampanha(db, campanhas[0]);
    } catch {
      return { erro: "Não foi possível conferir as conexões." };
    }
    const ids = new Set(daCampanha.map((c) => c.id));
    if (e.contas.some((c) => !ids.has(c))) return { erro: "Conexão escolhida não é desta campanha." };
  }
  if (e.grupos) {
    const r = await selecionarEmLotes(e.grupos, (lote) => db.from("grupos").select("id, conexao_id").eq("campanha_id", campanhas[0]).in("id", lote));
    if ("error" in r) return { erro: "Não foi possível conferir os grupos." };
    const linhas = r.data as { id: string; conexao_id: string }[];
    if (linhas.length !== e.grupos.length) return { erro: "Grupo escolhido não é desta campanha." };
    if (e.contas && linhas.some((g) => !e.contas!.includes(g.conexao_id))) return { erro: "Grupo escolhido não é de uma das conexões escolhidas." };
  }

  // Mover grupos: destino válido e fora da ação (na principal e em cada ação extra).
  const acoes = [{ tipo: e.tipo, conteudo: e.conteudo, importante: e.importante }, ...e.seguintes];
  for (const [i, a] of acoes.entries()) {
    if (a.tipo !== "mover_grupos") continue;
    const prefixo = acoes.length > 1 ? `Ação ${i + 1}: ` : "";
    const destino = (a.conteudo as { campanha_destino: string }).campanha_destino;
    if (campanhas.includes(destino)) return { erro: `${prefixo}A campanha de destino não pode ser uma das campanhas da ação.` };
    const { data, error } = await db.from("campanhas").select("id, arquivada").eq("id", destino).maybeSingle();
    if (error) return { erro: "Não foi possível conferir a campanha de destino." };
    if (!data) return { erro: `${prefixo}Campanha de destino não encontrada.` };
    if ((data as { arquivada: boolean }).arquivada) return { erro: `${prefixo}Campanha de destino está arquivada.` };
  }

  // "Importante" é reenviada pra todo grupo novo da campanha: com conta ou grupo específico como alvo, a ação
  // não valeria pra um grupo que ainda não existia, então "importante" é sempre falsa aqui (o assistente já nem
  // oferece a opção nesse caso — isto é defesa de servidor).
  const podeImportante = !e.contas && !e.grupos;
  const linha = (campanhaId: string, a: (typeof acoes)[number]) => ({
    campanha_id: campanhaId,
    origem: "avulsa",
    tipo: a.tipo,
    conteudo: a.conteudo,
    importante: a.importante && podeImportante,
    agendada_para: e.agendadaPara,
    alvo_contas: e.contas,
    alvo_grupos: e.grupos,
    criada_por: ator?.id ?? null,
  });
  // Sem ação extra: exatamente as linhas de antes (o banco gera o id). Com ações extras ("Adicionar outra ação"):
  // os ids saem daqui pra a seguinte n apontar (`depois_de`) pra execução n-1 DA MESMA campanha, e tudo vai num
  // único insert — um comando só no banco, então ou entram todas ou nenhuma (a FK é conferida no fim do comando).
  const linhas = e.seguintes.length
    ? campanhas.flatMap((campanhaId) => {
        let anterior: string | null = null;
        return acoes.map((a) => {
          const id = randomUUID();
          const l = { id, ...linha(campanhaId, a), depois_de: anterior };
          anterior = id;
          return l;
        });
      })
    : campanhas.map((campanhaId) => linha(campanhaId, acoes[0]));
  const { data: criadas, error } = await db.from("execucoes").insert(linhas).select("id");
  if (error) return { erro: "Não foi possível salvar." };
  const ids = ((criadas ?? []) as { id: string }[]).map((c) => c.id);

  for (const id of campanhas) revalidatePath(`/campanhas/${id}`, "layout");
  revalidatePath("/acoes");
  revalidatePath("/calendario");
  const onde = campanhas.length === 1 ? "1 campanha" : `${campanhas.length} campanhas`;
  const via = origem.tipo === "api" ? ` via API (chave ${origem.chave.nome})` : "";
  const quando = `${e.agora ? "agora" : "agendada"}${via}`;
  await registrarHistorico(ator, {
    acao: "adicionar",
    area: "Ações",
    resumo: e.seguintes.length
      ? `Ação criada com ${acoes.length} ações encadeadas (${acoes.map((a) => rotuloAcaoAssistente(a.tipo)).join(" → ")}) em ${onde}, ${quando}`
      : `${rotuloAcaoAssistente(e.tipo)} em ${onde}, ${quando}`,
    refId: campanhas.length === 1 ? campanhas[0] : e.projetoId,
  });
  return { ok: true, ids };
}

/** "Entrar no Grupo" (Etapa 3K): uma linha `acoes` (`tipo 'entrar_grupo'`, `dados {link, conexao_id}`) por conta
 *  escolhida, só as conectadas; `processarAcoes` faz o `join-group` no próximo minuto, uma vez por conta. Dedupe:
 *  conta que já tem o mesmo convite na fila fica de fora (e o índice único `acoes_um_entrar_por_conta` segura o
 *  resto). `ids` = linhas criadas na fila `acoes` (não são execuções). */
async function criarEntrarNoGrupo(db: DB, ator: UsuarioParaHistorico, e: EntradaAcaoValida): Promise<{ erro: string } | { ok: true; ids: string[] }> {
  const link = (e.conteudo as { link: string }).link;
  const r = await selecionarEmLotes(e.contas ?? [], (lote) => db.from("conexoes").select("id, status").in("id", lote));
  if ("error" in r) return { erro: "Não foi possível conferir as conexões." };
  const linhasContas = r.data as { id: string; status: string }[];
  if (linhasContas.length !== (e.contas ?? []).length) return { erro: "Conexão não encontrada." };
  const conectadas = linhasContas.filter((c) => c.status === "conectado").map((c) => c.id);
  if (!conectadas.length) return { erro: "Nenhuma das conexões escolhidas está conectada." };

  const { data: pendentes, error: erroPendentes } = await db
    .from("acoes")
    .select("dados")
    .eq("tipo", "entrar_grupo")
    .in("status", ["fila", "processando"])
    .eq("dados->>link", link);
  if (erroPendentes) return { erro: "Não foi possível conferir a fila." };
  const naFila = new Set(((pendentes ?? []) as { dados: { conexao_id?: string } }[]).map((p) => p.dados?.conexao_id));
  const novas = conectadas.filter((id) => !naFila.has(id));
  if (!novas.length) return { erro: "Essas conexões já estão na fila pra entrar nesse grupo." };

  const { data, error } = await db
    .from("acoes")
    .insert(novas.map((conexao_id) => ({ tipo: "entrar_grupo", dados: { link, conexao_id }, origem: "painel" })))
    .select("id");
  if (error) return { erro: error.code === "23505" ? "Essas conexões já estão na fila pra entrar nesse grupo." : "Não foi possível salvar." };
  const ids = ((data ?? []) as { id: string }[]).map((x) => x.id);
  revalidatePath("/acoes");
  const fora = (e.contas ?? []).length - novas.length;
  // Sem o link no histórico: o código do convite dá acesso ao grupo.
  await registrarHistorico(ator, {
    acao: "adicionar",
    area: "Ações",
    resumo: `Entrar no Grupo pelo convite com ${novas.length} ${novas.length === 1 ? "conexão" : "conexões"}${fora ? ` (${fora} fora: desconectada ou já na fila)` : ""}`,
  });
  return { ok: true, ids };
}
