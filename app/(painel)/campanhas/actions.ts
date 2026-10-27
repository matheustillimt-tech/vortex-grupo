"use server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { registrarHistorico } from "@/src/lib/historico";
import { aplicarPadraoNaCriacao } from "@/src/lib/padrao-campanha";
import { normalizarAdminsNumeros, semConflitoDeContas } from "@/src/lib/regras/admins-numeros";
import { validarCampanha, type CampanhaEntrada } from "@/src/lib/regras/campanha";
import { TIPOS_CAMPANHA, type CampanhaTipo } from "@/src/lib/regras/campanha-tipo";
import {
  camposAplicaveis,
  lerPadraoCampanha,
  MAXIMO_CAMPANHAS_PADRAO,
  validarPadraoCampanha,
  type PadraoCampanha,
  type PadraoCampanhaCampos,
  type PadraoCampanhaEntrada,
} from "@/src/lib/regras/padrao-campanha";
import { slugUnico } from "@/src/lib/campanhas/slug";
import { checarPermissao } from "@/src/lib/permissoes";
import { mensagemExecucoes, type ContagemExecucoes } from "@/src/lib/regras/contas-associadas";
import { ehUuid } from "@/src/lib/regras/uuid";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { dbUsuario } from "@/src/lib/supabase/usuario";

type DB = Pick<SupabaseClient, "from">;

/** `adminsNumeros` (Etapa 3K, Tarefa 2): números administradores do Padrão de criação pra gravar em
 *  `campanha_admins_numeros` logo depois do insert — só usado por `criarCampanha` (campanha nova). Já vêm sem
 *  conflito com as contas da campanha (ver `aplicarPadraoNaCriacao`), mas esta é uma server action (dá pra chamar
 *  direto): passam de novo por `normalizarAdminsNumeros` (formato, repetidos, máximo) antes de gravar qualquer coisa. */
export async function salvarCampanha(id: string | null, entrada: CampanhaEntrada, adminsNumeros?: string[]): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  const v = validarCampanha(entrada);
  if (!v.ok) return { erro: v.erro };
  let numerosAdmins: string[] = [];
  if (adminsNumeros !== undefined) {
    const n = normalizarAdminsNumeros(adminsNumeros);
    if (!n.ok) return { erro: n.erro };
    numerosAdmins = n.valor;
  }
  const db = await dbUsuario();

  // Projeto é opcional, mas quando informado precisa existir de verdade (ativo ou arquivado — a campanha pode
  // continuar num projeto arquivado, só não oferece escolher um novo arquivado).
  let projetoNome: string | null = null;
  if (v.valor.projeto_id) {
    const { data: projeto, error: erroProjeto } = await db.from("projetos").select("id, nome").eq("id", v.valor.projeto_id).maybeSingle();
    if (erroProjeto) return { erro: "Não foi possível verificar o projeto." };
    if (!projeto) return { erro: "Projeto não encontrado." };
    projetoNome = projeto.nome;
  }

  const { admins, ...campos } = v.valor;
  const r = id ? await db.from("campanhas").update(campos).eq("id", id).select("id").single() : await db.from("campanhas").insert(campos).select("id").single();
  if (r.error) return { erro: r.error.code === "23505" ? "Já existe uma campanha com esse endereço de link." : "Não foi possível salvar." };
  const campanhaId = r.data.id as string;
  const del = await db.from("campanha_conexoes").delete().eq("campanha_id", campanhaId);
  if (del.error) return { erro: "Campanha salva, mas não foi possível atualizar os números admins." };
  if (admins.length) {
    const ins = await db.from("campanha_conexoes").insert(admins.map((conexao_id) => ({ campanha_id: campanhaId, conexao_id })));
    if (ins.error) return { erro: "Campanha salva, mas não foi possível atualizar os números admins." };
  }
  if (!id && numerosAdmins.length) {
    const ins = await db.from("campanha_admins_numeros").insert(numerosAdmins.map((telefone) => ({ campanha_id: campanhaId, telefone, criado_por: usuario.id })));
    if (ins.error) return { erro: "Campanha salva, mas não foi possível salvar os administradores por número." };
  }
  revalidatePath("/campanhas");
  revalidatePath("/", "layout");
  revalidatePath("/projetos");
  if (campos.projeto_id) revalidatePath(`/projetos/${campos.projeto_id}`);
  await registrarHistorico(usuario, {
    acao: id ? "atualizar" : "adicionar",
    area: "Campanhas",
    resumo: `Campanha "${campos.nome}" ${id ? "atualizada" : "criada"}${projetoNome ? ` no projeto ${projetoNome}` : ""}`,
    refId: campanhaId,
  });
  if (!id) redirect(`/campanhas/${campanhaId}`);
  return {};
}

export async function arquivarCampanha(id: string, arquivada: boolean): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  const r = await (await dbUsuario()).from("campanhas").update({ arquivada }).eq("id", id);
  if (r.error) return { erro: "Não foi possível arquivar." };
  revalidatePath("/campanhas");
  revalidatePath("/", "layout");
  await registrarHistorico(usuario, { acao: "atualizar", area: "Campanhas", resumo: arquivada ? "Campanha arquivada" : "Campanha desarquivada", refId: id });
  return {};
}

/** Diálogo "Criar campanha": Nome, Tipo e Projeto (opcional; vem preenchido por `/campanhas/nova?projeto=`).
 *  O resto usa os padrões do banco (os mesmos de `CAMPANHA_VAZIA`,
 *  em `formulario.tsx`) e o endereço do link é gerado do nome (único). A campanha nasce SEM número
 *  (21/10/2026): nenhum grupo é criado até alguém escolher a conexão em "Conexões associadas". `aplicarPadraoNaCriacao`
 *  é o único ponto de entrada do padrão de criação (Tarefa 3): aplica o padrão salvo quando ele está ligado. */
export async function criarCampanha(nome: string, tipo: string, projetoId: string | null = null): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const nomeLimpo = nome.trim();
  if (!nomeLimpo) return { erro: "Dê um nome à campanha." };
  if (!TIPOS_CAMPANHA.includes(tipo as CampanhaTipo)) return { erro: "Tipo de campanha inválido." };
  const projeto = projetoId || null;
  if (projeto !== null && !ehUuid(projeto)) return { erro: "Projeto inválido." };

  const db = await dbUsuario();
  // Campanha nova só entra em projeto que existe e não está arquivado (salvarCampanha aceita arquivado porque a
  // edição pode manter uma campanha que já estava nele).
  if (projeto) {
    const { data: p, error: erroProjeto } = await db.from("projetos").select("id, arquivado").eq("id", projeto).maybeSingle();
    if (erroProjeto) return { erro: "Não foi possível verificar o projeto." };
    if (!p) return { erro: "Projeto não encontrado." };
    if (p.arquivado) return { erro: "Esse projeto está arquivado; escolha outro." };
  }
  const slug = await slugUnico(db, nomeLimpo);

  const entrada: CampanhaEntrada = {
    nome: nomeLimpo,
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
    projeto_id: projeto,
    tipo: tipo as CampanhaTipo,
  };
  const { entrada: aplicada, adminsNumeros } = await aplicarPadraoNaCriacao(entrada);
  return salvarCampanha(null, aplicada, adminsNumeros);
}

/** "Duplicar" (menu CONFIGURAÇÕES): copia a linha de `campanhas` (menos id, slug, created_at, updated_at,
 *  fixada e comunidade_id — a cópia nunca fica fixada nem entra na mesma comunidade do WhatsApp) com o nome
 *  "Cópia de X" e um slug novo, mais `campanha_conexoes` e `campanha_variaveis`. Nunca copia
 *  grupos, execuções, cliques nem qualquer outro dado operacional. Usa `dbAdmin` (ação de equipe, não precisa
 *  da RLS) e abre a cópia. */
export async function duplicarCampanha(id: string): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  const admin = dbAdmin();

  const { data: original, error: erroOriginal } = await admin.from("campanhas").select("*").eq("id", id).maybeSingle();
  if (erroOriginal) return { erro: "Não foi possível ler a campanha." };
  if (!original) return { erro: "Campanha não encontrada." };

  const [{ data: conexoes, error: erroConexoes }, { data: variaveis, error: erroVariaveis }] = await Promise.all([
    admin.from("campanha_conexoes").select("conexao_id").eq("campanha_id", id),
    admin.from("campanha_variaveis").select("chave, valor").eq("campanha_id", id),
  ]);
  if (erroConexoes || erroVariaveis) return { erro: "Não foi possível ler as configurações da campanha." };

  const nomeCopia = `Cópia de ${original.nome}`;
  const slug = await slugUnico(admin, nomeCopia);
  const { id: _id, slug: _slug, created_at: _createdAt, updated_at: _updatedAt, fixada: _fixada, comunidade_id: _comunidadeId, ...resto } = original as Record<string, unknown>;

  const { data: nova, error: erroNova } = await admin.from("campanhas").insert({ ...resto, nome: nomeCopia, slug }).select("id").single();
  if (erroNova) return { erro: "Não foi possível duplicar a campanha." };
  const novaId = nova.id as string;

  if (conexoes?.length) await admin.from("campanha_conexoes").insert(conexoes.map((c) => ({ campanha_id: novaId, conexao_id: c.conexao_id })));
  if (variaveis?.length) await admin.from("campanha_variaveis").insert(variaveis.map((v) => ({ campanha_id: novaId, chave: v.chave, valor: v.valor })));

  revalidatePath("/campanhas");
  revalidatePath("/", "layout");
  await registrarHistorico(usuario, {
    acao: "adicionar",
    area: "Campanhas",
    resumo: `Campanha "${nomeCopia}" criada como cópia de "${original.nome as string}"`,
    refId: novaId,
  });
  redirect(`/campanhas/${novaId}`);
}

/** "Fixar no topo"/"Desafixar" (menu CONFIGURAÇÕES e botão `push_pin` do cartão). */
export async function fixarCampanha(id: string, fixada: boolean): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  const r = await (await dbUsuario()).from("campanhas").update({ fixada }).eq("id", id);
  if (r.error) return { erro: "Não foi possível fixar a campanha." };
  revalidatePath("/campanhas");
  revalidatePath("/", "layout");
  await registrarHistorico(usuario, { acao: "atualizar", area: "Campanhas", resumo: fixada ? "Campanha fixada no topo" : "Campanha desafixada", refId: id });
  return {};
}

/** Arquivar/desarquivar em massa (barra de ações da lista). */
export async function arquivarVarias(ids: string[], arquivada: boolean): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  if (!ids.length) return {};
  const r = await (await dbUsuario()).from("campanhas").update({ arquivada }).in("id", ids);
  if (r.error) return { erro: "Não foi possível arquivar." };
  revalidatePath("/campanhas");
  revalidatePath("/", "layout");
  await registrarHistorico(usuario, {
    acao: "atualizar",
    area: "Campanhas",
    resumo: `${ids.length} campanha(s) ${arquivada ? "arquivada(s)" : "desarquivada(s)"} em massa`,
  });
  return {};
}

/** "Excluir" (menu CONFIGURAÇÕES; vermelho). Exige o nome digitado idêntico ao nome de verdade e nenhuma
 *  execução `enviando` (um envio em andamento ficaria pela metade). Grava o histórico antes de excluir — depois
 *  não há mais `campanha_id` pra linkar caso a gravação falhasse depois. O apagamento cascateia (`on delete
 *  cascade`) pra `campanha_conexoes`, `grupos`, `cliques`, `execucoes`, `acoes`, `eventos_saida`,
 *  `campanha_variaveis`, `alertas`, `tags`, `pessoa_tags` e `automacoes` — os grupos continuam existindo de
 *  verdade no WhatsApp, só saem do Vórtex Grupo. Usa `dbAdmin`: ação de equipe, forte confirmação já feita na tela. */
export async function excluirCampanha(id: string, nomeDigitado: string): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  const admin = dbAdmin();

  const { data: campanha, error: erroCampanha } = await admin.from("campanhas").select("id, nome").eq("id", id).maybeSingle();
  if (erroCampanha) return { erro: "Não foi possível ler a campanha." };
  if (!campanha) return { erro: "Campanha não encontrada." };
  if (nomeDigitado.trim() !== campanha.nome) return { erro: "O nome digitado não é idêntico ao nome da campanha." };

  const { data: enviando, error: erroExec } = await admin.from("execucoes").select("id").eq("campanha_id", id).eq("status", "enviando").limit(1);
  if (erroExec) return { erro: "Não foi possível verificar os envios em andamento." };
  if ((enviando ?? []).length > 0) return { erro: "Há um envio em andamento nesta campanha; espere terminar para excluir." };

  await registrarHistorico(usuario, { acao: "remover", area: "Campanhas", resumo: `Campanha "${campanha.nome}" excluída`, refId: id });

  const { error: erroDel } = await admin.from("campanhas").delete().eq("id", id);
  if (erroDel) return { erro: "Não foi possível excluir a campanha." };

  revalidatePath("/campanhas");
  revalidatePath("/", "layout");
  redirect("/campanhas");
}

const CHAVE_PADRAO = "padrao_campanha";

/** Diálogo "Padrão de criação de campanhas" — botão "Salvar". Grava em `configuracoes` (chave
 *  `padrao_campanha`); `aplicarPadraoNaCriacao` (src/lib/padrao-campanha.ts) é quem usa isso ao criar. */
export async function salvarPadraoCampanha(entrada: PadraoCampanhaEntrada): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  const v = validarPadraoCampanha(entrada);
  if (!v.ok) return { erro: v.erro };
  const db = await dbUsuario();
  const { error } = await db.from("configuracoes").upsert({ chave: CHAVE_PADRAO, valor: v.valor });
  if (error) return { erro: "Não foi possível salvar o padrão de criação." };
  revalidatePath("/campanhas");
  await registrarHistorico(usuario, {
    acao: "atualizar",
    area: "Campanhas",
    resumo: `Padrão de criação de campanhas salvo (${v.valor.ativo ? "ativado" : "desativado"})`,
  });
  return {};
}

/** Colunas de `campanhas` que "Copiar de campanha existente" lê (Etapa 3K, Tarefa 2): os campos obrigatórios do
 *  padrão + todos os novos de "Configurações"/"Criação de grupos" + a "Imagem do grupo" (Etapa 3M). "Aplicar em
 *  campanhas existentes" grava `camposAplicaveis`, que nunca inclui a imagem. */
const COLUNAS_PADRAO =
  "fechado, limite_por_grupo, folga, padrao_nome, usar_comunidade, cookie_redirecionamento, checar_duplicados, deep_linking, " +
  "verificacao_colaboradores, atualizar_links_banimento, links_periodicos, links_por_dia, redefinir_link_cheio, aprovacao_entrada, " +
  "mensagens_temporarias, inicio_contagem, caractere_numeracao, numero_no_inicio, nao_criar_grupos, limite_cliques_sem_criar, " +
  "modo_criacao, criar_aberto_fechar_24h, imagem_grupo_url, recusar_bloqueados";

/** "Copiar de campanha existente": devolve os campos de "Configurações"/"Criação de grupos" + admins (de
 *  conta e por número) dessa campanha, pra preencher o formulário do diálogo — não grava nada (só "Salvar"
 *  grava). */
export async function copiarPadraoDeCampanha(campanhaId: string): Promise<{ valor?: PadraoCampanhaCampos; erro?: string }> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const db = await dbUsuario();
  const [{ data: campanha, error: erroCampanha }, { data: admins, error: erroAdmins }, { data: numeros, error: erroNumeros }] = await Promise.all([
    db.from("campanhas").select(COLUNAS_PADRAO).eq("id", campanhaId).maybeSingle(),
    db.from("campanha_conexoes").select("conexao_id").eq("campanha_id", campanhaId),
    db.from("campanha_admins_numeros").select("telefone").eq("campanha_id", campanhaId),
  ]);
  if (erroCampanha || erroAdmins || erroNumeros) return { erro: "Não foi possível carregar essa campanha." };
  if (!campanha) return { erro: "Campanha não encontrada." };
  const v = validarPadraoCampanha({
    ativo: true,
    // `campanha` vem de um `select` com string montada em runtime (COLUNAS_PADRAO, Etapa 3K): o postgrest-js não
    // consegue tipar as colunas a partir de uma `string` genérica (vira `GenericStringError`), daí o `any`.
    ...(campanha as any), // eslint-disable-line @typescript-eslint/no-explicit-any
    admins: (admins ?? []).map((a) => a.conexao_id as string),
    admins_numeros: (numeros ?? []).map((n) => n.telefone as string),
  });
  if (!v.ok) return { erro: v.erro };
  const { ativo: _ativo, ...campos } = v.valor;
  return { valor: campos };
}

/** "Aplicar padrão" em "Aplicar em campanhas existentes": grava `fechado`, `limite_por_grupo`, `folga`,
 *  `padrao_nome` e `usar_comunidade` nas campanhas escolhidas — nunca nome, imagem nem descrição dos grupos, e os
 *  grupos que já existem não são renomeados (`padrao_nome` vale pros próximos). Quando o padrão tem contas admin,
 *  substitui as contas associadas de cada campanha por elas, campanha a campanha, na RPC atômica
 *  `aplicar_contas_campanha` (insere as novas antes de apagar as que saíram; nunca a conta criadora; reassocia ou
 *  cancela as ações agendadas das contas que saíram, igual a "Remover" na aba Contas associadas). Padrão sem
 *  contas admin = não mexe nas contas associadas. Até `MAXIMO_CAMPANHAS_PADRAO` por execução; um registro no
 *  histórico por campanha. */
export async function aplicarPadraoEmCampanhas(
  campos: PadraoCampanhaCampos,
  ids: string[],
): Promise<{ erro?: string; aplicadas?: number; aviso?: string }> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  const v = validarPadraoCampanha({ ativo: true, ...campos });
  if (!v.ok) return { erro: v.erro };
  const alvos = [...new Set(ids)];
  if (!alvos.length) return { erro: "Escolha ao menos uma campanha." };
  if (alvos.length > MAXIMO_CAMPANHAS_PADRAO) return { erro: `No máximo ${MAXIMO_CAMPANHAS_PADRAO} campanhas por vez.` };
  if (!alvos.every(ehUuid)) return { erro: "Campanha inválida na seleção." };

  const db = await dbUsuario();

  // Só contas que existem de verdade (o padrão pode ter sido salvo antes de uma conta ser excluída).
  let admins: string[] = [];
  if (v.valor.admins.length) {
    const { data: existentes, error: erroConexoes } = await db.from("conexoes").select("id").in("id", v.valor.admins);
    if (erroConexoes) return { erro: "Não foi possível conferir as conexões de administrador do padrão." };
    const existem = new Set(((existentes ?? []) as { id: string }[]).map((c) => c.id));
    admins = v.valor.admins.filter((a) => existem.has(a));
    if (!admins.length) return { erro: "Nenhuma das conexões de administrador do padrão existe mais. Escolha as conexões de novo." };
  }

  const { data: atualizadas, error: erroUpdate } = await db
    .from("campanhas")
    .update(camposAplicaveis(v.valor))
    .in("id", alvos)
    .select("id, nome, conexao_criadora_id");
  if (erroUpdate) return { erro: "Não foi possível aplicar o padrão nas campanhas." };
  const campanhas = (atualizadas ?? []) as { id: string; nome: string; conexao_criadora_id: string | null }[];

  const falhas: string[] = [];
  const falhasNumeros: string[] = [];
  let numerosGravados = 0;
  const total: ContagemExecucoes = { reassociadas: 0, canceladas: 0, mantidas: 0 };
  for (const c of campanhas) {
    let resumo = `Padrão de criação aplicado na campanha "${c.nome}"`;
    if (admins.length) {
      const contas = admins.filter((a) => a !== c.conexao_criadora_id);
      const { data, error } = await db.rpc("aplicar_contas_campanha", { p_campanha: c.id, p_contas: contas });
      if (error) {
        falhas.push(c.nome);
        resumo += " (as conexões associadas não foram trocadas: erro)";
      } else {
        const r = ((Array.isArray(data) ? data[0] : data) ?? {}) as Partial<Record<"adicionadas" | "removidas" | "reassociadas" | "canceladas" | "mantidas", number>>;
        total.reassociadas += r.reassociadas ?? 0;
        total.canceladas += r.canceladas ?? 0;
        total.mantidas = (total.mantidas ?? 0) + (r.mantidas ?? 0);
        resumo += ` — conexões associadas trocadas (${r.adicionadas ?? 0} entrou, ${r.removidas ?? 0} saiu)`;
        const execucoes = mensagemExecucoes({ reassociadas: r.reassociadas ?? 0, canceladas: r.canceladas ?? 0, mantidas: r.mantidas ?? 0 });
        if (execucoes) resumo += `; ${execucoes.replace(/\.$/, "")}`;
      }
    }
    // Administradores por número (Etapa 3K, Tarefa 2): acrescenta sem nunca apagar os que a campanha já tem —
    // só os que não colidem com as contas (criadora + admins) de hoje desta campanha.
    if (v.valor.admins_numeros?.length) {
      // Sem conseguir ler as contas, não dá pra garantir que nenhum número colide com uma conta: pula esta campanha.
      const { data: vinculadas, error: erroVinculadas } = await db.from("campanha_conexoes").select("conexao_id").eq("campanha_id", c.id);
      const idsContas = [c.conexao_criadora_id, ...((vinculadas ?? []) as { conexao_id: string }[]).map((x) => x.conexao_id)].filter((x): x is string => !!x);
      let telefonesContas: (string | null)[] = [];
      let erroContas = !!erroVinculadas;
      if (!erroContas && idsContas.length) {
        const { data: contasInfo, error: erroInfo } = await db.from("conexoes").select("telefone").in("id", idsContas);
        if (erroInfo) erroContas = true;
        telefonesContas = ((contasInfo ?? []) as { telefone: string | null }[]).map((x) => x.telefone);
      }
      const numeros = erroContas ? [] : semConflitoDeContas(v.valor.admins_numeros, telefonesContas);
      if (erroContas) falhasNumeros.push(c.nome);
      else if (numeros.length) {
        const { error: erroNumeros } = await db
          .from("campanha_admins_numeros")
          .upsert(numeros.map((telefone) => ({ campanha_id: c.id, telefone, criado_por: usuario.id })), { onConflict: "campanha_id,telefone", ignoreDuplicates: true });
        if (erroNumeros) falhasNumeros.push(c.nome);
        else numerosGravados += numeros.length;
      }
    }
    await registrarHistorico(usuario, { acao: "atualizar", area: "Campanhas", resumo, refId: c.id });
  }

  revalidatePath("/campanhas");
  for (const c of campanhas) revalidatePath(`/campanhas/${c.id}`, "layout");

  const avisos: string[] = [];
  if (campanhas.length < alvos.length) avisos.push(`${alvos.length - campanhas.length} campanha(s) não foram encontradas.`);
  if (falhas.length) avisos.push(`Não foi possível trocar as conexões associadas de: ${falhas.join(", ")}.`);
  if (falhasNumeros.length) avisos.push(`Não foi possível salvar os administradores por número de: ${falhasNumeros.join(", ")}.`);
  if (numerosGravados) avisos.push(`${numerosGravados} administrador(es) por número acrescentado(s).`);
  const execucoes = mensagemExecucoes(total);
  if (execucoes) avisos.push(execucoes);
  return avisos.length ? { aplicadas: campanhas.length, aviso: avisos.join(" ") } : { aplicadas: campanhas.length };
}

/** Padrão salvo em `configuracoes` (chave `padrao_campanha`), pra servir o diálogo já preenchido. */
export async function lerPadraoCampanhaAtual(): Promise<PadraoCampanha | null> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return null;
  const db = await dbUsuario();
  const { data, error } = await db.from("configuracoes").select("valor").eq("chave", CHAVE_PADRAO).maybeSingle();
  if (error || !data) return null;
  return lerPadraoCampanha(data.valor);
}
