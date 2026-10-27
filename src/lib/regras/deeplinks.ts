import { baseSlug } from "./slug";

/** Endereços fixos do painel/rotas que um deep link nunca pode ocupar (`/api/...`, `/admin`, `/l/[slug]`,
 *  `/d/[slug]`, este último o do próprio deep link). */
export const SLUG_RESERVADOS = ["api", "admin", "l", "d"] as const;

const SLUG_REGEX = /^[a-z0-9-]{3,40}$/;

export type DeeplinkEntrada = { nome: string; destino: string };
export type DeeplinkValido = { nome: string; destino: string };

/** Nome (1–60) e destino (`https://`, até 500 caracteres — mesma regra do "Link após o término" de
 *  `validarCampanha` e das URLs de webhook). */
export function validarDeeplink(e: DeeplinkEntrada): { ok: true; valor: DeeplinkValido } | { ok: false; erro: string } {
  const nome = e.nome.trim();
  if (!nome || Array.from(nome).length > 60) return { ok: false, erro: "Dê um nome de até 60 caracteres." };
  const destino = e.destino.trim();
  if (!destino.startsWith("https://")) return { ok: false, erro: "O link precisa começar com https://" };
  if (destino.length > 500) return { ok: false, erro: "O link pode ter no máximo 500 caracteres." };
  return { ok: true, valor: { nome, destino } };
}

/** `[a-z0-9-]{3,40}`, sem as palavras reservadas (ver `SLUG_RESERVADOS`). A unicidade de verdade é da coluna
 *  (`deeplinks_slug_key`); quem chama trata o erro `23505` à parte. */
export function validarSlugDeeplink(slug: string): { ok: true; slug: string } | { ok: false; erro: string } {
  const v = slug.trim().toLowerCase();
  if (!SLUG_REGEX.test(v)) return { ok: false, erro: "O endereço do deep link aceita só letras minúsculas, números e hífen (3 a 40)." };
  if ((SLUG_RESERVADOS as readonly string[]).includes(v)) return { ok: false, erro: "Esse endereço é reservado; escolha outro." };
  return { ok: true, slug: v };
}

/** Sugestão de slug a partir do nome: regra de `baseSlug` (a mesma do link de campanha, `/l/[slug]`), só com o
 *  mínimo trocado de 2 para 3 (regra do deep link). A tela deixa editar antes de salvar; `validarSlugDeeplink`
 *  é quem decide de verdade na hora de gravar (reservas inclusive). */
export function sugerirSlugDeeplink(nome: string): string {
  const s = baseSlug(nome);
  return s.length >= 3 ? s : (s + "xxx").slice(0, 3);
}

/** Nome da pasta: 1 a 40 caracteres depois do trim (igual `validarPasta` de modelos). */
export function validarPastaDeeplink(nome: string): { ok: true; nome: string } | { ok: false; erro: string } {
  const limpo = nome.trim();
  if (limpo.length < 1 || limpo.length > 40) return { ok: false, erro: "Nome da pasta com 1 a 40 caracteres." };
  return { ok: true, nome: limpo };
}

export type DeeplinkLista = { id: string; created_at: string; nome: string; destino: string; slug: string; pasta: string | null; cliques: number };

/** Pastas com a contagem de deep links, em ordem alfabética pt-BR (igual `pastasDe` de modelos). */
export function pastasDeDeeplinks(l: DeeplinkLista[]): { nome: string; total: number }[] {
  const contagem = new Map<string, number>();
  for (const d of l) {
    if (!d.pasta) continue;
    contagem.set(d.pasta, (contagem.get(d.pasta) ?? 0) + 1);
  }
  return [...contagem.entries()].map(([nome, total]) => ({ nome, total })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export type OrdemDeeplinks = "recentes" | "antigos";

/** Busca pelo nome (sem acento) ou pelo slug exato, pasta e ordenação por data de criação. O slug casa inteiro (não por trecho): é o que `slugDaUrl` devolve pro botão "Pesquisar
 *  deeplink por url", e misturar as duas regras bagunçaria nomes que têm o slug de outro deep link como trecho. */
export function filtrarDeeplinks(l: DeeplinkLista[], f: { busca: string; pasta: string | null; ordem: OrdemDeeplinks }): DeeplinkLista[] {
  const busca = semAcento(f.busca.trim());
  return l
    .filter((d) => (f.pasta ? d.pasta === f.pasta : true))
    .filter((d) => !busca || semAcento(d.nome).includes(busca) || d.slug.toLowerCase() === busca)
    .sort((a, b) => (f.ordem === "antigos" ? a.created_at.localeCompare(b.created_at) : b.created_at.localeCompare(a.created_at)));
}
