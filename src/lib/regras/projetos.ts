/** Regras de Projetos (Etapa 2J): pastas de campanhas, cada uma com uma cor fixa. */
import { UUID } from "./uuid";

export const CORES_PROJETO = {
  amarelo: { rotulo: "Amarelo", classe: "bg-[#ffde07]", borda: "border-[#ffde07]", texto: "text-[#ffde07]" },
  verde: { rotulo: "Verde", classe: "bg-vg-ok", borda: "border-vg-ok", texto: "text-vg-ok" },
  azul: { rotulo: "Azul", classe: "bg-blue-500", borda: "border-blue-500", texto: "text-blue-400" },
  roxo: { rotulo: "Roxo", classe: "bg-purple-500", borda: "border-purple-500", texto: "text-purple-400" },
  rosa: { rotulo: "Rosa", classe: "bg-pink-500", borda: "border-pink-500", texto: "text-pink-400" },
  vermelho: { rotulo: "Vermelho", classe: "bg-vg-erro", borda: "border-vg-erro", texto: "text-vg-erro" },
  laranja: { rotulo: "Laranja", classe: "bg-vg-aviso", borda: "border-vg-aviso", texto: "text-vg-aviso" },
  cinza: { rotulo: "Cinza", classe: "bg-gray-500", borda: "border-gray-500", texto: "text-gray-400" },
} as const;

export type CorProjeto = keyof typeof CORES_PROJETO;

const CORES = Object.keys(CORES_PROJETO) as CorProjeto[];

export type ProjetoEntrada = { nome: string; descricao: string; cor: string };
export type Projeto = { nome: string; descricao: string; cor: CorProjeto };

/** Nome 1–60, descrição até 200, cor numa das 8 fixas (trim em nome e descrição). */
export function validarProjeto(e: ProjetoEntrada): { ok: true; valor: Projeto } | { ok: false; erro: string } {
  const nome = (e.nome ?? "").trim();
  if (!nome || nome.length > 60) return { ok: false, erro: "Dê um nome de até 60 caracteres." };
  const descricao = (e.descricao ?? "").trim();
  if (descricao.length > 200) return { ok: false, erro: "A descrição aceita até 200 caracteres." };
  if (!CORES.includes(e.cor as CorProjeto)) return { ok: false, erro: "Escolha uma cor válida." };
  return { ok: true, valor: { nome, descricao, cor: e.cor as CorProjeto } };
}

// ---------- "Posição" (Etapa 3N, Task 7) ----------

export type ProjetoComPosicao = { id: string; posicao: number | null; created_at: string };

/** Ordem "Posição" (nulls last, depois `created_at` desc — o padrão de hoje): quem tem `posicao` vem primeiro,
 *  por ela; o resto, por `created_at` desc, igual à ordenação padrão de sempre. Pura: quem chama já carregou as
 *  linhas. Usada tanto pra ordenar a tela quanto pra calcular "Mover para cima"/"Mover para baixo". */
export function ordenarPorPosicao<T extends ProjetoComPosicao>(itens: T[]): T[] {
  return itens.slice().sort((a, b) => {
    if (a.posicao !== null && b.posicao !== null) return a.posicao - b.posicao;
    if (a.posicao !== null) return -1;
    if (b.posicao !== null) return 1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

/** Algum projeto tem `posicao` definida: a ordenação padrão da tela passa a ser "Posição" (em vez de "Data de
 *  criação"), e as setas de mover aparecem. */
export function algumTemPosicao(itens: { posicao: number | null }[]): boolean {
  return itens.some((p) => p.posicao !== null);
}

/** "Mover para cima"/"Mover para baixo" (pura): troca `id` com o vizinho na ordem "Posição" (`idsEmOrdem` já
 *  deve vir dessa ordem — `ordenarPorPosicao`). Devolve a nova ordem de ids (pra renumerar 0..N-1 no banco), ou
 *  `null` quando `id` já está na ponta (nada pra trocar) ou não existe na lista. Sem buraco nem repetição: é
 *  sempre uma permutação da lista recebida. */
export function moverProjeto(idsEmOrdem: string[], id: string, direcao: "cima" | "baixo"): string[] | null {
  const i = idsEmOrdem.indexOf(id);
  if (i === -1) return null;
  const j = direcao === "cima" ? i - 1 : i + 1;
  if (j < 0 || j >= idsEmOrdem.length) return null;
  const nova = idsEmOrdem.slice();
  [nova[i], nova[j]] = [nova[j], nova[i]];
  return nova;
}

export type FiltroProjeto = { tipo: "todos" } | { tipo: "sem" } | { tipo: "projeto"; id: string };

/** Filtro de projeto na URL da lista de campanhas: ausente/"" = todos; "sem" = sem projeto; um uuid = o projeto;
 *  qualquer outro valor vira "todos" (nunca erro no banco). */
export function filtroProjeto(param: string | string[] | undefined): FiltroProjeto {
  const v = Array.isArray(param) ? param[0] : param;
  if (!v) return { tipo: "todos" };
  if (v === "sem") return { tipo: "sem" };
  if (UUID.test(v)) return { tipo: "projeto", id: v };
  return { tipo: "todos" };
}
