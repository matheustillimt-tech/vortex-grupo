import "server-only";
import { aplicarPadraoEmEntrada, lerPadraoCampanha } from "./regras/padrao-campanha";
import { semConflitoDeContas } from "./regras/admins-numeros";
import type { CampanhaEntrada } from "./regras/campanha";
import { dbAdmin } from "./supabase/admin";

const CHAVE = "padrao_campanha";

export type ResultadoPadraoNaCriacao = { entrada: CampanhaEntrada; adminsNumeros: string[] };

/**
 * Padrão de criação de campanhas (Etapa 3D, Tarefa 3; completo na Etapa 3K, Tarefa 2): lê a linha `configuracoes`
 * (chave `padrao_campanha`) com `dbAdmin` — a criação de campanha (`criarCampanha`, em
 * `app/(painel)/campanhas/actions.ts`) é o único ponto de entrada. Quando o padrão está ligado (`ativo`), troca
 * os campos de "Configurações"/"Criação de grupos" presentes no padrão e os admins da entrada pelos do padrão (só
 * os admins de conta que ainda existem em `conexoes`); senão (ou se não houver linha, ou a linha estiver
 * corrompida), devolve a entrada sem mudar nada — idêntico ao comportamento de antes do padrão existir. Os
 * administradores por número (`admins_numeros`) não entram em `CampanhaEntrada` (tabela própria,
 * `campanha_admins_numeros`, só existe depois que a campanha nasce) — por isso a função devolve os dois:
 * `criarCampanha` manda `entrada` pra `salvarCampanha` e `adminsNumeros` pra ele gravar na tabela depois do
 * insert, dentro da mesma action (`salvarCampanha` ganhou o parâmetro `adminsNumeros`). A "Imagem do grupo"
 * (`imagem_grupo_url`, Etapa 3M) entra como os outros campos presentes no padrão (já validada por
 * `lerPadraoCampanha`); "Aplicar em campanhas existentes" nunca a grava (`camposAplicaveis`). "Recusar
 * automaticamente números bloqueados" (`recusar_bloqueados`, Etapa 3M Tarefa 4) entra do mesmo jeito: ausente no
 * padrão = a coluna fica no default (false, nenhum pedido de entrada respondido).
 */
export async function aplicarPadraoNaCriacao(entrada: CampanhaEntrada): Promise<ResultadoPadraoNaCriacao> {
  const { data, error } = await dbAdmin().from("configuracoes").select("valor").eq("chave", CHAVE).maybeSingle();
  if (error || !data) return { entrada, adminsNumeros: [] };
  const padrao = lerPadraoCampanha(data.valor);
  if (!padrao || !padrao.ativo) return { entrada, adminsNumeros: [] };
  const admins = await adminsExistentes(padrao.admins);
  const aplicada = aplicarPadraoEmEntrada(entrada, { ...padrao, admins });
  const adminsNumeros = await numerosSemConflito(padrao.admins_numeros ?? [], [aplicada.conexao_criadora_id, ...admins]);
  return { entrada: aplicada, adminsNumeros };
}

/** Só os admins do padrão que ainda existem em `conexoes` (uma conta excluída depois de salvar o padrão não pode
 *  quebrar a criação da campanha na chave estrangeira de `campanha_conexoes`). Erro ao conferir: nenhum admin —
 *  a campanha nasce só com a conta criadora, e os admins podem ser associados depois. */
async function adminsExistentes(admins: string[]): Promise<string[]> {
  if (!admins.length) return [];
  const { data, error } = await dbAdmin().from("conexoes").select("id").in("id", admins);
  if (error || !data) return [];
  const existem = new Set((data as { id: string }[]).map((c) => c.id));
  return admins.filter((a) => existem.has(a));
}

/** Tira do padrão os números administradores que colidem com as contas desta campanha nova (criadora + admins de
 *  conta) — nunca falha a criação por isso, só não grava o número conflitante (mesma regra de
 *  `normalizarAdminsNumeros`, Etapa 3K Tarefa 1). Erro ao conferir as contas: nenhum número (mais seguro do que
 *  gravar um número que por acaso é de uma conta que a consulta não conseguiu confirmar). */
async function numerosSemConflito(numeros: string[], contaIds: (string | null)[]): Promise<string[]> {
  if (!numeros.length) return [];
  const ids = contaIds.filter((id): id is string => !!id);
  if (!ids.length) return numeros;
  const { data, error } = await dbAdmin().from("conexoes").select("telefone").in("id", ids);
  if (error) return [];
  const telefones = ((data ?? []) as { telefone: string | null }[]).map((c) => c.telefone);
  return semConflitoDeContas(numeros, telefones);
}
