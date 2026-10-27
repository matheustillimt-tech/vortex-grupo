import { filtrosParaQuery, type FiltrosPessoas } from "@/src/lib/regras/filtros-pessoas";
import { filtrosVisaoGeralParaQuery, type FiltrosVisaoGeral } from "@/src/lib/regras/filtros-leads";
import type { Aba } from "../_componentes/abas";

/** Abas do topo das telas de Leads (a página da pessoa fica fora das abas). "Visão geral" (cadastro — Nome |
 *  Número | Campos | Tags) é a aba padrão desde a Etapa 3I, Tarefa 1; "Participações" é a lista de hoje
 *  (Campanha | Grupo | Entrou | Saiu | Tags), que não mudou de lugar. */
export const ABAS_LEADS: Aba[] = [
  { href: "/leads", rotulo: "Visão geral", exato: true },
  { href: "/leads/tags", rotulo: "Tags" },
  { href: "/leads/participacoes", rotulo: "Participações" },
];

export type TipoTag = "manual" | "campanha" | "comprador" | "saiu";

export const ROTULO_TIPO_TAG: Record<TipoTag, string> = {
  manual: "Manual",
  campanha: "Campanha",
  comprador: "Comprador",
  saiu: "Saiu",
};

export type TagLinha = { id: string; nome: string; tipo: string; campanhas: { nome: string } | null };

/** A tag "Campanha" mostra o nome atual da campanha (se ela for renomeada, a tag acompanha). */
export function nomeDaTag(t: TagLinha): string {
  return t.tipo === "campanha" && t.campanhas ? t.campanhas.nome : t.nome;
}

/** Endereço da aba "Participações" com os filtros atuais + `mudar`. Mudar qualquer filtro volta pra página 1;
 *  trocar de campanha limpa o grupo (o grupo é de uma campanha só). */
export function urlLeads(atual: FiltrosPessoas, mudar: Partial<FiltrosPessoas>, base = "/leads/participacoes"): string {
  const f = { ...atual, ...mudar };
  if (!("pagina" in mudar)) f.pagina = 1;
  if ("campanha" in mudar && mudar.campanha !== atual.campanha) f.grupo = null;
  if (!f.campanha) f.grupo = null;
  const q = filtrosParaQuery(f);
  return q ? `${base}?${q}` : base;
}

/** Endereço da aba "Visão geral" (cadastro) com os filtros atuais + `mudar`. Mudar qualquer filtro volta pra
 *  página 1. */
export function urlVisaoGeral(atual: FiltrosVisaoGeral, mudar: Partial<FiltrosVisaoGeral>): string {
  const f = { ...atual, ...mudar };
  if (!("pagina" in mudar)) f.pagina = 1;
  const q = filtrosVisaoGeralParaQuery(f);
  return q ? `/leads?${q}` : "/leads";
}
