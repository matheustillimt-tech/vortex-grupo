import "server-only";
import { linhasParaMaterializar, type PassoMaterializavel } from "../regras/sequencia";
import { dbAdmin } from "../supabase/admin";

/** Para cada campanha ativa com data da aula e sequência: passos que chegaram na hora viram execuções
 *  (agendada, ou pulada se já passou há mais de 15 min). O único (campanha_id, passo_id) impede duplicar. */
export async function materializarSequencias(agora: Date = new Date()): Promise<number> {
  const db = dbAdmin();
  const { data: campanhas, error } = await db
    .from("campanhas")
    .select("id, data_aula, sequencia_id")
    .eq("arquivada", false)
    .not("data_aula", "is", null)
    .not("sequencia_id", "is", null);
  if (error) throw new Error(`Não foi possível ler as campanhas com sequência: ${error.message}`);
  const lista = (campanhas ?? []) as { id: string; data_aula: string; sequencia_id: string }[];
  if (!lista.length) return 0;
  const { data: passos, error: erroPassos } = await db
    .from("sequencia_passos")
    .select("id, sequencia_id, dia_relativo, hora, tipo, conteudo, importante")
    .in("sequencia_id", [...new Set(lista.map((c) => c.sequencia_id))]);
  if (erroPassos) throw new Error(`Não foi possível ler os passos das sequências: ${erroPassos.message}`);

  let criadas = 0;
  const erros: string[] = [];
  for (const c of lista) {
    const meus = ((passos ?? []) as (PassoMaterializavel & { sequencia_id: string })[]).filter((p) => p.sequencia_id === c.sequencia_id);
    const linhas = linhasParaMaterializar(c, meus, agora);
    if (!linhas.length) continue;
    const { data: novas, error: erroInsert } = await db.from("execucoes").upsert(linhas, { onConflict: "campanha_id,passo_id", ignoreDuplicates: true }).select("id");
    if (erroInsert) {
      erros.push(`campanha ${c.id}: ${erroInsert.message}`);
      continue;
    }
    const idsNovas = (novas ?? []).map((n) => n.id as string);
    if (!idsNovas.length) continue;
    // Corrida com um salvarPassos/salvarAula que reagendou enquanto este tick calculava: confere se a campanha
    // ainda tem a mesma aula/sequência usada pro cálculo. Se mudou, apaga o que acabou de inserir (só o que este
    // tick criou, por id) pro próximo tick recalcular com os dados novos.
    const { data: atual, error: erroAtual } = await db.from("campanhas").select("data_aula, sequencia_id").eq("id", c.id).single();
    if (erroAtual) {
      erros.push(`campanha ${c.id}: ${erroAtual.message}`);
      continue;
    }
    const mudou = atual.data_aula !== c.data_aula || atual.sequencia_id !== c.sequencia_id;
    if (mudou) {
      const { error: erroDelete } = await db.from("execucoes").delete().in("id", idsNovas);
      if (erroDelete) erros.push(`campanha ${c.id}: ${erroDelete.message}`);
      continue;
    }
    criadas += idsNovas.length;
  }
  if (erros.length) throw new Error(`Falha ao materializar sequências: ${erros.join("; ")}`);
  return criadas;
}
