import { celulasDaLinha } from "./lista-telefones";
import { chaveTelefone, normalizarTelefone } from "../telefone";

/** Regras puras do Anti-spam › "Números administrativos", "Bloquear por LID" e "Denunciar golpista" (Etapa 3K,
 *  Tarefa 6). Sem `server-only`: a tela também usa os rótulos e a ordenação. */

/** Teto de linhas do "ADICIONAR CSV" (o mesmo do bloqueio em lote). */
export const MAX_LINHAS_ADMINISTRATIVOS = 5000;
export const MAX_NOME_ADMINISTRATIVO = 80;

export type Administrativo = { telefone: string; nome: string | null };
export type AdministrativoLinha = Administrativo & { created_at: string };

export type OrdemAdministrativos = "alfabetica" | "criacao";
export const ROTULO_ORDEM_ADMINISTRATIVOS: Record<OrdemAdministrativos, string> = { alfabetica: "Alfabética", criacao: "Data de criação" };

export function ordemAdministrativos(v: unknown): OrdemAdministrativos {
  return v === "criacao" ? "criacao" : "alfabetica";
}

/** "Alfabética": nome A→Z (sem diferenciar maiúsculas/acentos, sem nome no fim), depois telefone. "Data de
 *  criação": mais novos primeiro, depois telefone. */
export function ordenarAdministrativos<T extends AdministrativoLinha>(lista: T[], ordem: OrdemAdministrativos): T[] {
  const copia = [...lista];
  if (ordem === "criacao") {
    return copia.sort((a, b) => (a.created_at === b.created_at ? a.telefone.localeCompare(b.telefone) : a.created_at < b.created_at ? 1 : -1));
  }
  return copia.sort((a, b) => {
    const na = a.nome?.trim() || null;
    const nb = b.nome?.trim() || null;
    if (na && !nb) return -1;
    if (!na && nb) return 1;
    if (na && nb) {
      const c = na.localeCompare(nb, "pt-BR", { sensitivity: "base" });
      if (c) return c;
    }
    return a.telefone.localeCompare(b.telefone);
  });
}

/** Busca por nome (sem diferenciar maiúsculas/acentos) ou pelos dígitos do telefone. */
export function filtrarAdministrativos<T extends Administrativo>(lista: T[], busca: string): T[] {
  const q = busca.trim();
  if (!q) return lista;
  const semAcento = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const texto = semAcento(q);
  const digitos = q.replace(/\D/g, "");
  return lista.filter((a) => (a.nome ? semAcento(a.nome).includes(texto) : false) || (digitos.length > 0 && a.telefone.includes(digitos)));
}

/** Diálogo "ADICIONAR": nome obrigatório (até 80) e telefone válido. */
export function validarAdministrativo(nome: unknown, telefone: unknown): { ok: true; valor: Administrativo } | { ok: false; erro: string } {
  const n = typeof nome === "string" ? nome.trim() : "";
  if (!n || n.length > MAX_NOME_ADMINISTRATIVO) return { ok: false, erro: `Informe o nome (até ${MAX_NOME_ADMINISTRATIVO} caracteres).` };
  const t = typeof telefone === "string" ? normalizarTelefone(telefone) : null;
  if (!t) return { ok: false, erro: "Telefone inválido." };
  return { ok: true, valor: { telefone: t, nome: n } };
}

/** "ADICIONAR CSV" (colunas nome,telefone), com o mesmo leitor de células do CSV de bloqueados (`;`, tab ou
 *  vírgula, aspas). Cabeçalho com "nome"/"telefone" decide a ordem das colunas; sem cabeçalho vale nome,telefone
 *  (e uma coluna só = só o telefone). Linha sem dígito nenhum (cabeçalho, vazia) é pulada; o mesmo número com e
 *  sem o 9 entra uma vez. Nome passa de 80 é cortado. */
export function lerCsvAdministrativos(texto: string): { validos: Administrativo[]; invalidos: string[] } {
  const validos: Administrativo[] = [];
  const invalidos: string[] = [];
  const vistos = new Set<string>();
  let colNome = 0;
  let colTel = 1;
  for (const linha of texto.replace(/^﻿/, "").split(/\r?\n/)) {
    if (!linha.trim()) continue;
    const cel = celulasDaLinha(linha);
    const minusculas = cel.map((c) => c.toLowerCase());
    const iTel = minusculas.findIndex((c) => c === "telefone" || c === "número" || c === "numero");
    if (iTel >= 0 && !/\d/.test(linha)) {
      colTel = iTel;
      const iNome = minusculas.findIndex((c) => c === "nome");
      colNome = iNome >= 0 ? iNome : -1;
      continue;
    }
    const bruto = cel.length === 1 ? cel[0] : (cel[colTel] ?? "");
    const nomeBruto = cel.length === 1 || colNome < 0 ? "" : (cel[colNome] ?? "");
    if (!/\d/.test(bruto)) {
      if (/\d/.test(linha)) invalidos.push(linha.trim().slice(0, 40));
      continue;
    }
    const telefone = normalizarTelefone(bruto);
    if (!telefone) {
      invalidos.push(bruto);
      continue;
    }
    const chave = chaveTelefone(telefone);
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    validos.push({ telefone, nome: nomeBruto.trim().slice(0, MAX_NOME_ADMINISTRATIVO) || null });
  }
  return { validos, invalidos };
}

/** Resumo do "ADICIONAR CSV". */
export function resumoCsvAdministrativos(r: { adicionados: number; invalidos: number; jaExistiam: number }): string {
  return `${r.adicionados} adicionados, ${r.invalidos} inválidos, ${r.jaExistiam} já existiam`;
}

export function textoNumeroAdministrativo(telefone: string): string {
  return `${telefone} é um número administrativo`;
}

/** LID guardado em `bloqueados.lid`: só dígitos, 6 a 20. */
export const LID = /^[0-9]{6,20}$/;

/** Id de participante que pode ser um LID: `…@lid` (os dígitos antes do @) ou só dígitos (6 a 20). Um telefone
 *  comum também é "só dígitos": a comparação com `bloqueados.lid` (ids opacos do WhatsApp, que não colidem com
 *  telefones na prática) é que decide. Outro formato (`…@s.whatsapp.net`, texto) = `null`. */
export function lidDoId(id: string): string | null {
  const t = id.trim();
  const m = /^([0-9]{6,20})@lid$/i.exec(t);
  if (m) return m[1];
  return LID.test(t) ? t : null;
}

/** Formas em que um LID pode estar gravado em `participantes.telefone` (cru como o Zapbot mandou). */
export function formasDoLid(lid: string): string[] {
  return [lid, `${lid}@lid`];
}

/** Texto da aba "Números administrativos": o que acontece (e o que não acontece) com esses números. */
export const AJUDA_ADMINISTRATIVOS =
  "Números administrativos nunca são removidos dos grupos nem bloqueados, e não disparam automações de pessoa.";

/** Ajuda do interruptor "Denunciar golpista" (o Zapbot não tem rota de denúncia). */
export const AJUDA_GOLPISTA =
  "O Zapbot não tem denúncia ao WhatsApp. O número é bloqueado no WhatsApp de todas as conexões conectadas e marcado como golpista aqui.";
export const ERRO_LID = "Não foi possível descobrir o LID agora.";

/** Uma linha `acoes` (`bloquear_contato`/`desbloquear_contato`) por conta conectada. */
export function acoesDeContato(tipo: "bloquear_contato" | "desbloquear_contato", telefone: string, contas: string[]) {
  return [...new Set(contas)].map((conexao_id) => ({ tipo, telefone: null, dados: { telefone, conexao_id }, origem: "antispam" }));
}
