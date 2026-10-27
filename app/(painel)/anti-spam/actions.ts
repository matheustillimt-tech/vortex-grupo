"use server";
import { revalidatePath } from "next/cache";
import { bloquearTelefones, desbloquearTelefone, type ResultadoBloqueio } from "@/src/lib/bloqueio";
import { registrarHistorico } from "@/src/lib/historico";
import { checarPermissao } from "@/src/lib/permissoes";
import { paraZapbot, type ConexaoLinha } from "@/src/lib/conexoes";
import {
  acoesDeContato,
  ERRO_LID,
  LID,
  lerCsvAdministrativos,
  MAX_LINHAS_ADMINISTRATIVOS,
  resumoCsvAdministrativos,
  textoNumeroAdministrativo,
  validarAdministrativo,
} from "@/src/lib/regras/administrativos";
import { CHAVE_ANTISPAM_CONTAS, lerAntispamContas, validarAntispamContas } from "@/src/lib/regras/antispam";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { normalizarTelefone, telefoneLegivel, variantesTelefone } from "@/src/lib/telefone";
import { PRAZO_TELA_MS, zapbot } from "@/src/lib/zapbot/client";

/** Diálogo "Adicionar número": "Nome *" e telefone. Mesmo caminho do bloqueio de sempre (grava em
 *  `bloqueados` e enfileira a remoção de quem já está em grupo), agora com o nome.
 *
 *  Etapa 3K, Tarefa 6 (`opcoes`, ausente = como antes):
 *  - `porLid` ("Bloquear por LID"): o campo vira "Telefone ou LID"; o `resolve-lid` do Zapbot (numa conta conectada
 *    autorizada do anti-spam, senão qualquer conectada) devolve o outro lado e os dois são gravados. Sem conta ou
 *    sem resposta: "Não foi possível descobrir o LID agora." e nada é gravado.
 *  - `golpista` ("Denunciar golpista"): marca `golpista`/`denunciado_em` e enfileira um `bloquear_contato` por
 *    conta conectada (o Zapbot não tem denúncia ao WhatsApp). */
export async function adicionarNumeroBloqueado(
  nome: unknown,
  telefone: unknown,
  opcoes?: { porLid?: unknown; golpista?: unknown },
): Promise<{ erro?: string; resumo?: ResultadoBloqueio; contas?: number }> {
  const acesso = await checarPermissao("antispam", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const n = typeof nome === "string" ? nome.trim() : "";
  if (!n || n.length > 80) return { erro: "Informe o nome (até 80 caracteres)." };
  const porLid = opcoes?.porLid === true;
  const golpista = opcoes?.golpista === true;
  const bruto = typeof telefone === "string" ? telefone.trim() : "";
  const db = dbAdmin();

  let t: string | null = null;
  let lid: string | null = null;
  if (porLid) {
    // `…@lid` é LID; 10 a 13 dígitos é telefone (BR com ou sem 55); o resto (LIDs têm ~15 dígitos) vai como veio e
    // a resposta decide: se o LID devolvido é o que foi digitado, era um LID.
    const digitos = bruto.split("@")[0].replace(/\D/g, "");
    if (!LID.test(digitos)) return { erro: "Telefone ou LID inválido." };
    const telefoneDigitado = /@lid$/i.test(bruto) ? null : digitos.length >= 10 && digitos.length <= 13 ? normalizarTelefone(digitos) : null;
    const r = await descobrirLid(db, telefoneDigitado ?? digitos);
    if (!r) return { erro: ERRO_LID };
    const eraLid = !telefoneDigitado && r.lid === digitos;
    t = eraLid ? normalizarTelefone(r.telefone ?? "") : (telefoneDigitado ?? normalizarTelefone(digitos));
    lid = r.lid;
    if (!t || !LID.test(lid) || (!eraLid && r.lid === t)) return { erro: ERRO_LID };
  } else {
    t = normalizarTelefone(bruto);
    if (!t) return { erro: "Telefone inválido." };
  }

  try {
    const item = { telefone: t, motivo: null, nome: n, ...(lid ? { lid } : {}) };
    const resumo = await bloquearTelefones(db, [item], "manual", acesso.usuario.id);
    if (resumo.ignorados.length) return { erro: "Esse é um número conectado no sistema: não dá pra bloquear." };
    if (resumo.administrativos?.length) return { erro: textoNumeroAdministrativo(telefoneLegivel(t)) };
    // Já estava bloqueado: o LID e a marca de golpista entram no registro que existe (motivo/origem ficam).
    const marcas: Record<string, unknown> = {};
    if (lid && !resumo.novos) marcas.lid = lid;
    if (golpista) Object.assign(marcas, { golpista: true, denunciado_em: new Date().toISOString() });
    if (Object.keys(marcas).length) {
      const { error } = await db.from("bloqueados").update(marcas).in("telefone", variantesTelefone(t));
      if (error) return { erro: error.code === "23505" ? "Esse LID já está em outro número bloqueado." : "Número bloqueado, mas não foi possível gravar o LID/golpista." };
    }
    let contas = 0;
    if (golpista) {
      const { data, error } = await db.from("conexoes").select("id").eq("status", "conectado");
      if (error) return { erro: "Número bloqueado, mas não foi possível ler as conexões conectadas." };
      const ids = ((data ?? []) as { id: string }[]).map((c) => c.id);
      if (ids.length) {
        const { error: erroFila } = await db.from("acoes").insert(acoesDeContato("bloquear_contato", t, ids));
        if (erroFila) return { erro: "Número bloqueado, mas não foi possível pedir o bloqueio no WhatsApp das conexões." };
      }
      contas = ids.length;
    }
    revalidatePath("/anti-spam", "layout");
    revalidatePath("/leads", "layout");
    const extras = [lid ? "por LID" : "", golpista ? `golpista, bloqueio no WhatsApp de ${contas} conexão(ões)` : ""].filter(Boolean).join(", ");
    if (resumo.novos || extras) {
      await registrarHistorico(acesso.usuario, { acao: "adicionar", area: "Anti-spam", resumo: `Telefone bloqueado (•••${t.slice(-4)})${extras ? ` — ${extras}` : ""}` });
    }
    return { resumo, contas };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "Não foi possível bloquear." };
  }
}

/** `resolve-lid` numa conta conectada: primeiro as autorizadas do "Antispam por Contas Associadas" (ligado), senão
 *  qualquer conectada. Tenta até 3 contas; nenhuma respondeu = `null`. */
async function descobrirLid(db: ReturnType<typeof dbAdmin>, valor: string): Promise<{ telefone: string | null; lid: string } | null> {
  const { data: cfgLinha } = await db.from("configuracoes").select("valor").eq("chave", CHAVE_ANTISPAM_CONTAS).maybeSingle();
  const cfg = lerAntispamContas((cfgLinha as { valor: unknown } | null)?.valor);
  const { data, error } = await db.from("conexoes").select("*").eq("status", "conectado");
  if (error) return null;
  const conectadas = (data ?? []) as ConexaoLinha[];
  const autorizadas = cfg.ligado ? conectadas.filter((c) => cfg.contas.includes(c.id)) : [];
  const ordem = autorizadas.length ? autorizadas : conectadas;
  for (const c of ordem.slice(0, 3)) {
    try {
      const r = await zapbot().resolverLid(paraZapbot(c), valor, { prazoTotalMs: PRAZO_TELA_MS });
      if (r) return r;
    } catch {
      // Conta que não respondeu: tenta a próxima.
    }
  }
  return null;
}

/** "EXCLUIR" da aba Números bloqueados com a caixa "Também desbloquear no WhatsApp das contas" (desmarcada por
 *  padrão): só os golpistas entre os escolhidos ganham um `desbloquear_contato` por conta conectada. Desmarcada =
 *  o desbloqueio de sempre (só libera o número aqui). */
export async function desbloquearBloqueados(telefones: unknown, desbloquearNoWhatsApp: unknown): Promise<{ erro?: string; desbloqueados?: number; contas?: number }> {
  const acesso = await checarPermissao("antispam", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const lista = Array.isArray(telefones)
    ? [...new Set(telefones.slice(0, 500).flatMap((x) => (typeof x === "string" ? [normalizarTelefone(x)] : [])).filter((x): x is string => !!x))].slice(0, 100)
    : [];
  if (!lista.length) return { erro: "Nenhum telefone válido." };
  const db = dbAdmin();
  try {
    let pedidos = 0;
    if (desbloquearNoWhatsApp === true) {
      const { data: golpistas, error } = await db.from("bloqueados").select("telefone").in("telefone", lista.flatMap(variantesTelefone)).eq("golpista", true);
      if (error) return { erro: "Não foi possível ler os golpistas." };
      const tels = ((golpistas ?? []) as { telefone: string }[]).map((g) => g.telefone);
      if (tels.length) {
        const { data: contas, error: erroContas } = await db.from("conexoes").select("id").eq("status", "conectado");
        if (erroContas) return { erro: "Não foi possível ler as conexões conectadas." };
        const ids = ((contas ?? []) as { id: string }[]).map((c) => c.id);
        const linhas = tels.flatMap((t) => acoesDeContato("desbloquear_contato", t, ids));
        if (linhas.length) {
          const { error: erroFila } = await db.from("acoes").insert(linhas);
          if (erroFila) return { erro: "Não foi possível pedir o desbloqueio no WhatsApp das conexões." };
        }
        pedidos = linhas.length;
      }
    }
    for (const t of lista) await desbloquearTelefone(db, t);
    revalidatePath("/anti-spam", "layout");
    revalidatePath("/leads", "layout");
    await registrarHistorico(acesso.usuario, {
      acao: "remover",
      area: "Anti-spam",
      resumo: `${lista.length} telefone(s) desbloqueado(s)${pedidos ? ` — ${pedidos} desbloqueio(s) no WhatsApp das conexões` : ""}`,
    });
    return { desbloqueados: lista.length, contas: pedidos };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "Não foi possível desbloquear." };
  }
}

// Números administrativos (Etapa 3K, Tarefa 6): nunca removidos nem bloqueados (`telefonesProtegidos`).

function atualizarAdministrativos() {
  revalidatePath("/anti-spam", "layout");
}

/** Diálogo "ADICIONAR" da aba Números administrativos ("Nome *", "Telefone *"). */
export async function adicionarAdministrativo(nome: unknown, telefone: unknown): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("antispam", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const v = validarAdministrativo(nome, telefone);
  if (!v.ok) return { erro: v.erro };
  const db = dbAdmin();
  const { data: ja, error: erroJa } = await db.from("numeros_administrativos").select("telefone").in("telefone", variantesTelefone(v.valor.telefone)).limit(1);
  if (erroJa) return { erro: "Não foi possível conferir a lista." };
  if (((ja ?? []) as unknown[]).length) return { erro: "Esse número já é administrativo." };
  const { error } = await db.from("numeros_administrativos").insert({ telefone: v.valor.telefone, nome: v.valor.nome, criado_por: acesso.usuario.id });
  if (error) return { erro: error.code === "23505" ? "Esse número já é administrativo." : "Não foi possível salvar." };
  atualizarAdministrativos();
  await registrarHistorico(acesso.usuario, { acao: "adicionar", area: "Anti-spam", resumo: `Número administrativo adicionado (•••${v.valor.telefone.slice(-4)})` });
  return {};
}

/** "ADICIONAR CSV" (colunas nome,telefone; até 5000 linhas). Resumo "N adicionados, M inválidos, K já existiam". */
export async function importarAdministrativos(texto: unknown): Promise<{ erro?: string; resumo?: string }> {
  const acesso = await checarPermissao("antispam", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  if (typeof texto !== "string" || !texto.trim()) return { erro: "Arquivo vazio." };
  if (texto.split(/\r?\n/).length > MAX_LINHAS_ADMINISTRATIVOS + 1) return { erro: `No máximo ${MAX_LINHAS_ADMINISTRATIVOS} linhas por vez.` };
  const { validos, invalidos } = lerCsvAdministrativos(texto);
  if (!validos.length) return { erro: invalidos.length ? "Nenhum telefone válido no arquivo." : "Arquivo sem números." };
  const db = dbAdmin();
  const existentes = new Set<string>();
  for (let i = 0; i < validos.length; i += 200) {
    const variantes = validos.slice(i, i + 200).flatMap((v) => variantesTelefone(v.telefone));
    const { data, error } = await db.from("numeros_administrativos").select("telefone").in("telefone", variantes);
    if (error) return { erro: "Não foi possível conferir a lista." };
    for (const e of (data ?? []) as { telefone: string }[]) for (const x of variantesTelefone(e.telefone)) existentes.add(x);
  }
  const novos = validos.filter((v) => !variantesTelefone(v.telefone).some((x) => existentes.has(x)));
  for (let i = 0; i < novos.length; i += 500) {
    const { error } = await db
      .from("numeros_administrativos")
      .upsert(novos.slice(i, i + 500).map((v) => ({ telefone: v.telefone, nome: v.nome, criado_por: acesso.usuario.id })), { onConflict: "telefone", ignoreDuplicates: true });
    if (error) return { erro: "Não foi possível salvar." };
  }
  atualizarAdministrativos();
  if (novos.length) await registrarHistorico(acesso.usuario, { acao: "adicionar", area: "Anti-spam", resumo: `${novos.length} número(s) administrativo(s) importado(s) por CSV` });
  return { resumo: resumoCsvAdministrativos({ adicionados: novos.length, invalidos: invalidos.length, jaExistiam: validos.length - novos.length }) };
}

/** `delete` por linha e "Excluir" em massa (até 500 por vez). */
export async function excluirAdministrativos(telefones: unknown): Promise<{ erro?: string; excluidos?: number }> {
  const acesso = await checarPermissao("antispam", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const lista = Array.isArray(telefones) ? [...new Set(telefones.filter((t): t is string => typeof t === "string" && /^[0-9]{11,15}$/.test(t)))].slice(0, 500) : [];
  if (!lista.length) return { erro: "Nenhum número escolhido." };
  const { error } = await dbAdmin().from("numeros_administrativos").delete().in("telefone", lista);
  if (error) return { erro: "Não foi possível excluir." };
  atualizarAdministrativos();
  await registrarHistorico(acesso.usuario, { acao: "remover", area: "Anti-spam", resumo: `${lista.length} número(s) administrativo(s) excluído(s)` });
  return { excluidos: lista.length };
}

/** Aba "Contas associadas": interruptor "Antispam por Contas Associadas" + contas escolhidas, em `configuracoes`
 *  (chave `antispam_contas`). Conferido na hora de cada remoção do anti-spam (`executarRemover`). */
export async function salvarAntispamContas(entrada: unknown): Promise<{ erro?: string }> {
  const acesso = await checarPermissao("antispam", "editar");
  if (!acesso.ok) return { erro: acesso.erro };
  const v = validarAntispamContas(entrada);
  if (!v.ok) return { erro: v.erro };
  const db = dbAdmin();
  if (v.valor.contas.length) {
    const { data, error } = await db.from("conexoes").select("id").in("id", v.valor.contas);
    if (error) return { erro: "Não foi possível conferir as conexões." };
    if (((data ?? []) as { id: string }[]).length !== v.valor.contas.length) return { erro: "Alguma conexão escolhida não existe mais. Recarregue a página." };
  }
  const { error } = await db.from("configuracoes").upsert({ chave: CHAVE_ANTISPAM_CONTAS, valor: v.valor });
  if (error) return { erro: "Não foi possível salvar." };
  revalidatePath("/anti-spam/contas");
  const n = v.valor.contas.length;
  await registrarHistorico(acesso.usuario, {
    acao: "atualizar",
    area: "Anti-spam",
    resumo: v.valor.ligado ? `Antispam por Conexões Associadas ligado (${n} conexão${n === 1 ? "" : "s"})` : "Antispam por Conexões Associadas desligado",
  });
  return {};
}
