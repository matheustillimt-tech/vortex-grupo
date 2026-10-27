import "server-only";
import { telefonesAdministrativos, telefonesConectados, telefonesProtegidos } from "./automacoes";
import { alertarSoLid, contaAutorizadaParaAlertar, ehIdLid, enfileirarRemocoes, type Db } from "./jobs/pessoas";
import { formasDoLid } from "./regras/administrativos";
import type { ItemLista } from "./regras/lista-telefones";
import { chaveTelefone, variantesTelefone } from "./telefone";

/** `administrativos` (Etapa 3K, Tarefa 6) só aparece quando algum número da lista é um Número administrativo:
 *  sem nenhum, o resultado tem o mesmo formato de antes. */
export type ResultadoBloqueio = { novos: number; jaEstavam: number; remocoes: number; ignorados: string[]; administrativos?: string[] };

const LOTE = 200;

export const ERRO_LID_EM_OUTRO = "Esse LID já está em outro número bloqueado.";

type Aberto = { telefone: string; grupo_id: string; grupos: { campanha_id: string; conexao_id?: string | null; nome?: string | null } };

/** Enfileira a remoção das participações abertas achadas. Quem só está no grupo com o id LID (`…@lid`, ou casou só
 *  pela forma do LID e não pelo telefone) nunca entra na fila: o Zapbot não remove por LID (a remoção falha ou fica em
 *  laço). Vira um alerta por grupo por dia, só em conta autorizada do anti-spam. */
async function removerAbertos(db: Db, abertos: Aberto[], telefonesDoLote: Set<string>): Promise<number> {
  let remocoes = 0;
  const alertados = new Set<string>();
  const autorizada = new Map<string | null, boolean>();
  for (const a of abertos) {
    if (ehIdLid(a.telefone) || !telefonesDoLote.has(a.telefone)) {
      if (alertados.has(a.grupo_id)) continue;
      alertados.add(a.grupo_id);
      const conexao = a.grupos.conexao_id ?? null;
      if (!autorizada.has(conexao)) autorizada.set(conexao, await contaAutorizadaParaAlertar(db, conexao));
      if (autorizada.get(conexao)) await alertarSoLid(db, { grupoNome: a.grupos.nome ?? "sem nome", campanhaId: a.grupos.campanha_id, conexaoId: conexao });
      continue;
    }
    remocoes += await enfileirarRemocoes(db, { campanhaId: a.grupos.campanha_id, grupoId: a.grupo_id, telefones: [a.telefone], origem: "bloqueado" });
  }
  return remocoes;
}

/** Grava os bloqueados novos e enfileira a remoção de todas as participações abertas deles (qualquer campanha).
 *  Número conectado no sistema nunca é bloqueado (vai em `ignorados`); Número administrativo do Anti-spam também
 *  não (vai em `administrativos`). `lid` (Bloquear por LID): grava junto e também procura quem está no grupo com o
 *  id LID (`participantes.telefone` cru, `…` ou `…@lid`): esses não entram na fila, viram alerta (`removerAbertos`). */
export async function bloquearTelefones(
  db: Db,
  itens: (ItemLista & { nome?: string | null; lid?: string | null })[],
  origem: "botao" | "manual" | "csv",
  usuarioId: string | null,
): Promise<ResultadoBloqueio> {
  if (!itens.length) return { novos: 0, jaEstavam: 0, remocoes: 0, ignorados: [] };
  const [conectados, administrativos] = await Promise.all([telefonesConectados(db), telefonesAdministrativos(db)]);
  const protegido = (t: string) => variantesTelefone(t).some((v) => conectados.has(v));
  const ehAdministrativo = (t: string) => variantesTelefone(t).some((v) => administrativos.has(v));
  const ignorados = itens.filter((i) => protegido(i.telefone)).map((i) => i.telefone);
  const recusados = itens.filter((i) => !protegido(i.telefone) && ehAdministrativo(i.telefone)).map((i) => i.telefone);
  const validos = itens.filter((i) => !protegido(i.telefone) && !ehAdministrativo(i.telefone));

  const ja = new Set<string>();
  let remocoes = 0;
  for (let i = 0; i < validos.length; i += LOTE) {
    const lote = validos.slice(i, i + LOTE);
    const variantes = [...new Set(lote.flatMap((v) => variantesTelefone(v.telefone)))];
    const { data: existentes, error } = await db.from("bloqueados").select("telefone").in("telefone", variantes);
    if (error) throw new Error(`Não foi possível ler os bloqueados: ${error.message}`);
    for (const e of (existentes ?? []) as { telefone: string }[]) ja.add(chaveTelefone(e.telefone));

    const novos = lote.filter((v) => !ja.has(chaveTelefone(v.telefone)));
    if (novos.length) {
      const { error: erroGravar } = await db
        .from("bloqueados")
        .upsert(novos.map((n) => ({ telefone: n.telefone, motivo: n.motivo, origem, criado_por: usuarioId, ...(n.nome ? { nome: n.nome } : {}), ...(n.lid ? { lid: n.lid } : {}) })), { onConflict: "telefone", ignoreDuplicates: true });
      // 23505 aqui só vem do `lid` (o telefone repetido é ignorado pelo upsert): o LID já é de outro bloqueado.
      if (erroGravar) throw new Error(erroGravar.code === "23505" ? ERRO_LID_EM_OUTRO : `Não foi possível gravar os bloqueados: ${erroGravar.message}`);
    }

    const ids = [...variantes, ...lote.flatMap((v) => (v.lid ? formasDoLid(v.lid) : []))];
    const { data: abertos, error: erroAbertos } = await db
      .from("participantes")
      .select("telefone, grupo_id, grupos!inner(campanha_id, ativo, conexao_id, nome)")
      .in("telefone", ids)
      .is("saiu_em", null)
      .eq("admin", false)
      .eq("grupos.ativo", true);
    if (erroAbertos) throw new Error(`Não foi possível ler os grupos dessas pessoas: ${erroAbertos.message}`);
    remocoes += await removerAbertos(db, (abertos ?? []) as unknown as Aberto[], new Set(variantes));
  }
  const jaEstavam = validos.filter((v) => ja.has(chaveTelefone(v.telefone))).length;
  return { novos: validos.length - jaEstavam, jaEstavam, remocoes, ignorados, ...(recusados.length ? { administrativos: recusados } : {}) };
}

/** Só libera o número: não põe ninguém de volta no grupo. */
export async function desbloquearTelefone(db: Db, telefone: string): Promise<void> {
  const { error } = await db.from("bloqueados").delete().in("telefone", variantesTelefone(telefone));
  if (error) throw new Error(`Não foi possível desbloquear: ${error.message}`);
}

/** Enfileira a remoção de quem está em grupo pra uma lista de telefones já bloqueados (não grava nada em
 *  `bloqueados`: a origem/motivo do registro existente é preservada). Usado pela análise periódica, que relê os
 *  bloqueados e pega quem entrou num grupo sem passar pela conferência (ex.: entrada manual, falha pontual).
 *  `conexaoId` (botão "Escanear" da aba Grupos do detalhe da conta, Etapa 3K Tarefa 4): só os grupos dessa
 *  conta — sem ele, o comportamento é o de hoje (todas as contas). */
export async function reenfileirarBloqueados(db: Db, telefones: string[], conexaoId?: string): Promise<number> {
  const protegidos = new Set(await telefonesProtegidos(db));
  const validos = telefones.filter((t) => !variantesTelefone(t).some((v) => protegidos.has(v)));
  let remocoes = 0;
  for (let i = 0; i < validos.length; i += LOTE) {
    const lote = validos.slice(i, i + LOTE);
    const variantes = [...new Set(lote.flatMap((v) => variantesTelefone(v)))];
    // Bloquear por LID (Etapa 3K, Tarefa 6): quem está no grupo com o id LID cru também é pego. Bloqueado sem
    // lid (todos os antigos) = só a consulta por telefone, como antes.
    const { data: comLid, error: erroLid } = await db.from("bloqueados").select("lid").in("telefone", variantes).not("lid", "is", null);
    if (erroLid) throw new Error(`Não foi possível ler os LIDs dos bloqueados: ${erroLid.message}`);
    const lids = ((comLid ?? []) as { lid: string | null }[]).flatMap((b) => (b.lid ? formasDoLid(b.lid) : []));
    let consulta = db
      .from("participantes")
      .select("telefone, grupo_id, grupos!inner(campanha_id, ativo, conexao_id, nome)")
      .in("telefone", [...variantes, ...lids])
      .is("saiu_em", null)
      .eq("admin", false)
      .eq("grupos.ativo", true);
    if (conexaoId) consulta = consulta.eq("grupos.conexao_id", conexaoId);
    const { data: abertos, error } = await consulta;
    if (error) throw new Error(`Não foi possível ler os grupos dessas pessoas: ${error.message}`);
    remocoes += await removerAbertos(db, (abertos ?? []) as unknown as Aberto[], new Set(variantes));
  }
  return remocoes;
}
