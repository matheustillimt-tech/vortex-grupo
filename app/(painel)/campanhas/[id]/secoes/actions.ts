"use server";
import { revalidatePath } from "next/cache";
import { registrarHistorico } from "@/src/lib/historico";
import { checarPermissao } from "@/src/lib/permissoes";
import {
  alteracaoDoInterruptor,
  ehInterruptor,
  lerCampanhasAnteriores,
  lerChipsDivisao,
  lerLinksPorDiaEntrada,
  lerTagsCampanha,
  tituloDoInterruptor,
  validarPixel,
  type TagsCampanhaEntrada,
} from "@/src/lib/regras/secoes-campanha";
import { lerTelefonesAviso } from "@/src/lib/regras/queda";
import { ehUuid } from "@/src/lib/regras/uuid";
import { normalizarTelefone } from "@/src/lib/telefone";
import { dbAdmin } from "@/src/lib/supabase/admin";

function revalidar(campanhaId: string) {
  revalidatePath(`/campanhas/${campanhaId}`, "layout");
}

/** Liga/desliga o interruptor de uma seção da Visão geral. Grava só a coluna da lista branca daquela seção
 *  (`COLUNA_DOS_INTERRUPTORES`), mais os efeitos combinados de `alteracaoDoInterruptor`. */
export async function definirInterruptor(campanhaId: string, secao: string, valor: boolean): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  if (!ehUuid(campanhaId)) return { erro: "Campanha inválida." };
  if (!ehInterruptor(secao)) return { erro: "Seção inválida." };
  if (typeof valor !== "boolean") return { erro: "Valor inválido." };

  const db = dbAdmin();
  const { data: atual, error: erroAtual } = await db.from("campanhas").select("deep_linking, pixel_meta_id").eq("id", campanhaId).maybeSingle();
  if (erroAtual) return { erro: "Não foi possível ler a campanha." };
  if (!atual) return { erro: "Campanha não encontrada." };

  const alteracao = alteracaoDoInterruptor(secao, valor, atual as { deep_linking: boolean; pixel_meta_id: string | null }, new Date());
  if (!alteracao.ok) return { erro: alteracao.erro };
  const { error } = await db.from("campanhas").update(alteracao.update).eq("id", campanhaId);
  if (error) return { erro: "Não foi possível salvar." };

  revalidar(campanhaId);
  await registrarHistorico(acesso.usuario, {
    acao: "atualizar",
    area: "Campanhas",
    resumo: `Campanha: ${tituloDoInterruptor(secao)} ${valor ? "ativado" : "desativado"}`,
    refId: campanhaId,
  });
  return {};
}

/** Grava o ID do Pixel da Meta (sub-bloco do Deep Linking). Vazio apaga o id e desliga o Pixel. */
export async function salvarPixel(campanhaId: string, id: string): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  if (!ehUuid(campanhaId)) return { erro: "Campanha inválida." };
  if (typeof id !== "string") return { erro: "ID do Pixel inválido." };
  const vazio = !id.trim();
  const pixel = vazio ? null : validarPixel(id);
  if (!vazio && !pixel) return { erro: "O ID do Pixel tem de 10 a 20 dígitos." };

  const db = dbAdmin();
  const { data: atual, error: erroAtual } = await db.from("campanhas").select("deep_linking").eq("id", campanhaId).maybeSingle();
  if (erroAtual) return { erro: "Não foi possível ler a campanha." };
  if (!atual) return { erro: "Campanha não encontrada." };
  if (!(atual as { deep_linking: boolean }).deep_linking) return { erro: "Ative o Deep Linking antes de configurar o Pixel da Meta." };

  const { error } = await db.from("campanhas").update(pixel ? { pixel_meta_id: pixel } : { pixel_meta_id: null, pixel_meta_ativo: false }).eq("id", campanhaId);
  if (error) return { erro: "Não foi possível salvar." };

  revalidar(campanhaId);
  await registrarHistorico(acesso.usuario, { acao: "atualizar", area: "Campanhas", resumo: pixel ? "Campanha: ID do Pixel da Meta salvo" : "Campanha: ID do Pixel da Meta apagado", refId: campanhaId });
  return {};
}

/** "Gerenciamento de Tags": as tags postas/tiradas quando o participante entra ou sai. Cada tag tem que existir e ser
 *  `manual` (as automáticas Campanha, Comprador e Saiu continuam por conta do sistema). */
export async function salvarTagsCampanha(campanhaId: string, entrada: TagsCampanhaEntrada): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  if (!ehUuid(campanhaId)) return { erro: "Campanha inválida." };
  const lido = lerTagsCampanha(entrada);
  if (!lido.ok) return { erro: lido.erro };

  const db = dbAdmin();
  if (lido.ids.length) {
    const { data: tags, error: erroTags } = await db.from("tags").select("id, tipo").in("id", lido.ids);
    if (erroTags) return { erro: "Não foi possível ler as tags." };
    const manuais = new Set(((tags ?? []) as { id: string; tipo: string }[]).filter((t) => t.tipo === "manual").map((t) => t.id));
    if (lido.ids.some((t) => !manuais.has(t))) return { erro: "Escolha só tags criadas por você (manuais)." };
  }
  const { data: feita, error } = await db.from("campanhas").update(lido.colunas).eq("id", campanhaId).select("id");
  if (error) return { erro: "Não foi possível salvar." };
  if (!feita?.length) return { erro: "Campanha não encontrada." };

  revalidar(campanhaId);
  await registrarHistorico(acesso.usuario, {
    acao: "atualizar",
    area: "Campanhas",
    resumo: `Campanha: Gerenciamento de Tags ${lido.colunas.tags_ativo ? "ativado" : "desativado"}`,
    refId: campanhaId,
  });
  return {};
}

/** "Remover Lead de Campanhas Anteriores": as campanhas de onde quem entra nesta sai. Todas têm que existir. */
export async function salvarCampanhasAnteriores(campanhaId: string, ids: string[]): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  if (!ehUuid(campanhaId)) return { erro: "Campanha inválida." };
  const lido = lerCampanhasAnteriores(ids, campanhaId);
  if (!lido.ok) return { erro: lido.erro };

  const db = dbAdmin();
  if (lido.ids.length) {
    const { data: existentes, error: erroLer } = await db.from("campanhas").select("id").in("id", lido.ids);
    if (erroLer) return { erro: "Não foi possível ler as campanhas." };
    const achadas = new Set(((existentes ?? []) as { id: string }[]).map((c) => c.id));
    if (lido.ids.some((id) => !achadas.has(id))) return { erro: "Alguma campanha escolhida não existe mais. Recarregue a página." };
  }
  const { data: feita, error } = await db.from("campanhas").update({ campanhas_anteriores: lido.ids }).eq("id", campanhaId).select("id");
  if (error) return { erro: "Não foi possível salvar." };
  if (!feita?.length) return { erro: "Campanha não encontrada." };

  revalidar(campanhaId);
  const n = lido.ids.length;
  await registrarHistorico(acesso.usuario, {
    acao: "atualizar",
    area: "Campanhas",
    resumo: `Campanha: Remover Lead de Campanhas Anteriores salvo (${n} campanha${n === 1 ? "" : "s"})`,
    refId: campanhaId,
  });
  return {};
}

/** "Atualização periódica de links": campo único (sem interruptor nem "SALVAR" — Etapa 3N), que salva ao
 *  sair. Vazio desliga (`links_periodicos = false`, sem mudar `links_por_dia`); um número de 1 a 24 liga
 *  (`links_periodicos = true` + grava `links_por_dia`). */
export async function salvarLinksPorDia(campanhaId: string, valor: number | string): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  if (!ehUuid(campanhaId)) return { erro: "Campanha inválida." };
  const lido = lerLinksPorDiaEntrada(valor);
  if (!lido.ok) return { erro: lido.erro };

  const update = lido.ligar
    ? { links_periodicos: true, links_por_dia: lido.n, links_atualizados_em: null }
    : { links_periodicos: false };
  const { data: feita, error } = await dbAdmin().from("campanhas").update(update).eq("id", campanhaId).select("id");
  if (error) return { erro: "Não foi possível salvar." };
  if (!feita?.length) return { erro: "Campanha não encontrada." };

  revalidar(campanhaId);
  await registrarHistorico(acesso.usuario, {
    acao: "atualizar",
    area: "Campanhas",
    resumo: lido.ligar ? `Campanha: Atualização periódica de links com ${lido.n} atualização(ões) por dia` : "Campanha: Atualização periódica de links desativada",
    refId: campanhaId,
  });
  return {};
}

/** "Dividir envios entre chips": os chips que podem enviar as mensagens e enquetes da campanha. Vazio = todos os
 *  conectados e admin do grupo. Todos têm que existir. */
export async function salvarChipsDivisao(campanhaId: string, ids: string[]): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  if (!ehUuid(campanhaId)) return { erro: "Campanha inválida." };
  const lido = lerChipsDivisao(ids);
  if (!lido.ok) return { erro: lido.erro };

  const db = dbAdmin();
  if (lido.ids.length) {
    const { data: existentes, error: erroLer } = await db.from("conexoes").select("id").in("id", lido.ids);
    if (erroLer) return { erro: "Não foi possível ler os chips." };
    const achados = new Set(((existentes ?? []) as { id: string }[]).map((c) => c.id));
    if (lido.ids.some((id) => !achados.has(id))) return { erro: "Algum chip escolhido não existe mais. Recarregue a página." };
  }
  const { data: feita, error } = await db.from("campanhas").update({ chips_divisao: lido.ids }).eq("id", campanhaId).select("id");
  if (error) return { erro: "Não foi possível salvar." };
  if (!feita?.length) return { erro: "Campanha não encontrada." };

  revalidar(campanhaId);
  const n = lido.ids.length;
  await registrarHistorico(acesso.usuario, {
    acao: "atualizar",
    area: "Campanhas",
    resumo: `Campanha: Dividir envios entre chips salvo (${n ? `${n} chip${n === 1 ? "" : "s"}` : "todos os chips"})`,
    refId: campanhaId,
  });
  return {};
}

/** "Aviso de chip caído": telefones que recebem mensagem no privado quando um chip da campanha cai. Vazio = sem aviso. */
export async function salvarTelefonesAviso(campanhaId: string, texto: string): Promise<{ erro?: string; telefones?: string[] }> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  if (!ehUuid(campanhaId)) return { erro: "Campanha inválida." };
  const lido = lerTelefonesAviso(typeof texto === "string" ? texto : "", normalizarTelefone);
  if (!lido.ok) return { erro: lido.erro };
  const { data: feita, error } = await dbAdmin().from("campanhas").update({ telefones_aviso_queda: lido.telefones }).eq("id", campanhaId).select("id");
  if (error) return { erro: "Não foi possível salvar." };
  if (!feita?.length) return { erro: "Campanha não encontrada." };

  revalidar(campanhaId);
  const n = lido.telefones.length;
  await registrarHistorico(acesso.usuario, {
    acao: "atualizar",
    area: "Campanhas",
    resumo: `Campanha: Aviso de chip caído salvo (${n ? `${n} telefone${n === 1 ? "" : "s"}` : "desligado"})`,
    refId: campanhaId,
  });
  return { telefones: lido.telefones };
}
