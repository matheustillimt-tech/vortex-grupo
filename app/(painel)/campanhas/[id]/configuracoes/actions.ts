"use server";
import { revalidatePath } from "next/cache";
import { registrarHistorico } from "@/src/lib/historico";
import { validarAula, type AulaEntrada } from "@/src/lib/regras/campanha";
import { validarChave } from "@/src/lib/regras/variaveis";
import { MAXIMO_GLOBAIS_NA_CAMPANHA, validarValorPorTipo } from "@/src/lib/regras/variaveis-globais";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { checarPermissao } from "@/src/lib/permissoes";
import { dbUsuario } from "@/src/lib/supabase/usuario";

/** Variável mudou: passos da sequência bloqueados (variável faltando) são apagados e o próximo tick recria com
 *  o valor novo. */
async function liberarBloqueadas(campanhaId: string): Promise<string | null> {
  const { error } = await dbAdmin().from("execucoes").delete().eq("campanha_id", campanhaId).eq("origem", "sequencia").eq("status", "bloqueada");
  return error ? error.message : null;
}

function revalidar(campanhaId: string) {
  revalidatePath(`/campanhas/${campanhaId}`, "layout");
  revalidatePath("/calendario");
}

/** Mudar a data da aula ou a sequência reagenda: execuções da sequência que ainda não saíram (agendada, pulada,
 *  bloqueada) são apagadas e o próximo tick recria pela data nova. As que já saíram ou foram canceladas ficam. */
export async function salvarAula(campanhaId: string, entrada: AulaEntrada): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  const v = validarAula(entrada);
  if (!v.ok) return { erro: v.erro };
  const db = dbAdmin();
  const { data: antes, error: erroAntes } = await db.from("campanhas").select("data_aula, sequencia_id").eq("id", campanhaId).single();
  if (erroAntes || !antes) return { erro: "Campanha não encontrada." };
  const { error } = await db.from("campanhas").update(v.valor).eq("id", campanhaId);
  if (error) return { erro: "Não foi possível salvar." };
  const mesmaData = (antes.data_aula ? new Date(antes.data_aula).getTime() : null) === (v.valor.data_aula ? new Date(v.valor.data_aula).getTime() : null);
  if (!mesmaData || antes.sequencia_id !== v.valor.sequencia_id) {
    const { error: erroReagendar } = await db.from("execucoes").delete().eq("campanha_id", campanhaId).eq("origem", "sequencia").in("status", ["agendada", "pulada", "bloqueada"]);
    if (erroReagendar) return { erro: "Salvo, mas não foi possível reagendar a sequência. Salve de novo." };
  }
  revalidar(campanhaId);
  await registrarHistorico(usuario, { acao: "atualizar", area: "Campanhas", resumo: "Configurações da aula atualizadas", refId: campanhaId });
  return {};
}

/** Todas as globais mostradas na campanha + até 100 chaves antigas só desta campanha. */
const MAXIMO_VALORES = MAXIMO_GLOBAIS_NA_CAMPANHA + 100;
const MAXIMO_VALOR = 2000;

/** Grava os valores das variáveis da campanha de uma vez (até `MAXIMO_VALORES`). Chave pelas regras de sempre; quando a chave é
 *  uma variável global, o valor também é validado pelo tipo dela. Valor vazio grava vazio (o envio continua
 *  bloqueando como antes). Se algum valor estiver errado, nada é gravado e `erros` diz qual (chave → mensagem). */
export async function salvarValores(campanhaId: string, valores: { chave: string; valor: string }[]): Promise<{ erro?: string; erros?: Record<string, string> }> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  if (typeof campanhaId !== "string" || !campanhaId) return { erro: "Campanha inválida." };
  if (!Array.isArray(valores)) return { erro: "Valores inválidos." };
  if (valores.length > MAXIMO_VALORES) return { erro: `No máximo ${MAXIMO_VALORES} variáveis de uma vez.` };
  if (!valores.length) return {};

  const linhas: { chave: string; valor: string }[] = [];
  const erros: Record<string, string> = {};
  for (const v of valores) {
    if (typeof v?.chave !== "string" || typeof v.valor !== "string") return { erro: "Valores inválidos." };
    const chave = v.chave.trim();
    if (linhas.some((l) => l.chave === chave)) return { erro: `A variável {${chave}} apareceu duas vezes.` };
    const valor = v.valor.trim();
    const erroChave = validarChave(chave);
    if (erroChave) erros[chave] = erroChave;
    else if (valor.length > MAXIMO_VALOR) erros[chave] = `Valor com até ${MAXIMO_VALOR} caracteres.`;
    linhas.push({ chave, valor });
  }

  const db = await dbUsuario();
  const chavesValidas = linhas.filter((l) => !erros[l.chave]).map((l) => l.chave);
  if (chavesValidas.length) {
    const { data: globais, error } = await db.from("variaveis_globais").select("chave, tipo").in("chave", chavesValidas);
    if (error) return { erro: "Não foi possível conferir as variáveis globais." };
    const tipoPorChave = new Map(((globais ?? []) as { chave: string; tipo: string }[]).map((g) => [g.chave, g.tipo]));
    for (const l of linhas) {
      const tipo = tipoPorChave.get(l.chave);
      const erro = tipo && !erros[l.chave] ? validarValorPorTipo(tipo, l.valor) : null;
      if (erro) erros[l.chave] = erro;
    }
  }
  if (Object.keys(erros).length) return { erro: "Confira os valores marcados: nada foi salvo.", erros };

  const { error } = await db.from("campanha_variaveis").upsert(linhas.map((l) => ({ campanha_id: campanhaId, ...l })), { onConflict: "campanha_id,chave" });
  if (error) return { erro: "Não foi possível salvar os valores." };
  await registrarHistorico(usuario, { acao: "atualizar", area: "Variáveis", resumo: `${linhas.length} variável(is) da campanha atualizada(s)`, refId: campanhaId });
  if (await liberarBloqueadas(campanhaId)) {
    revalidar(campanhaId);
    return { erro: "Valores salvos, mas não foi possível liberar os passos bloqueados da sequência. Salve de novo." };
  }
  revalidar(campanhaId);
  return {};
}

export async function removerVariavel(campanhaId: string, chave: string): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("campanhas", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const usuario = acesso.usuario;
  const { error } = await (await dbUsuario()).from("campanha_variaveis").delete().eq("campanha_id", campanhaId).eq("chave", chave);
  if (error) return { erro: "Não foi possível remover a variável." };
  await registrarHistorico(usuario, { acao: "remover", area: "Variáveis", resumo: `Variável "${chave}" removida da campanha`, refId: campanhaId });
  if (await liberarBloqueadas(campanhaId)) {
    revalidar(campanhaId);
    return { erro: "Variável removida, mas não foi possível liberar os passos bloqueados da sequência. Tente de novo." };
  }
  revalidar(campanhaId);
  return {};
}
