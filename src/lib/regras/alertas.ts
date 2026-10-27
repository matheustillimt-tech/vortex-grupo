/** Regras da tela `/alertas` (Etapa 3A, Task 2): tipos (rótulo pt-BR + ícone Material), filtros da URL e o
 *  agrupamento ("Agrupar por"). Puro — sem `server-only`, porque filtros também são lidos/escritos no cliente. */

export const TIPOS_ALERTA = [
  "grupo_cheio",
  "numero_caiu",
  "execucao_bloqueada",
  "tarefa_erro",
  "grupo_sumiu",
  "criacao_erro",
  "bloqueado_removido",
  "antispam_sem_conta",
  "entrega_nao_confirmada",
] as const;

export type TipoAlerta = (typeof TIPOS_ALERTA)[number];

export function tipoAlertaValido(v: unknown): v is TipoAlerta {
  return typeof v === "string" && (TIPOS_ALERTA as readonly string[]).includes(v);
}

/** Rótulo pt-BR + ícone Material de cada tipo, na ordem do filtro "Tipo". */
export const INFO_ALERTA: Record<TipoAlerta, { rotulo: string; icone: string }> = {
  grupo_cheio: { rotulo: "Grupo cheio", icone: "groups" },
  numero_caiu: { rotulo: "Número caiu", icone: "wifi_off" },
  execucao_bloqueada: { rotulo: "Envio bloqueado", icone: "block" },
  tarefa_erro: { rotulo: "Erro no envio", icone: "error" },
  grupo_sumiu: { rotulo: "Grupo sumiu", icone: "help" },
  criacao_erro: { rotulo: "Erro na criação", icone: "report" },
  bloqueado_removido: { rotulo: "Bloqueado removido", icone: "person_remove" },
  antispam_sem_conta: { rotulo: "Anti-spam sem conexão autorizada", icone: "gpp_maybe" },
  entrega_nao_confirmada: { rotulo: "Confirmação de entrega", icone: "mark_chat_unread" },
};

export const AGRUPAR_VALORES = ["nenhum", "tipo", "conta", "data"] as const;
export type Agrupar = (typeof AGRUPAR_VALORES)[number];

export function agruparValido(v: unknown): v is Agrupar {
  return typeof v === "string" && (AGRUPAR_VALORES as readonly string[]).includes(v);
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** "AAAA-MM-DD" válido (não valida calendário, ex. 31 de fevereiro: suficiente pra filtro de intervalo). */
export function dataAlertaValida(v: unknown): v is string {
  return typeof v === "string" && DATA.test(v);
}

export type LinhaAlerta = {
  id: string;
  created_at: string;
  tipo: string;
  texto: string;
  campanha_id: string | null;
  /** Conta (conexão) envolvida (Etapa 3A, revisão) — `null` nas linhas antigas, de antes da coluna existir, e
   *  nos tipos que nunca tiveram conta associada. */
  conexao_id: string | null;
  visto: boolean;
};
export type ContaAlerta = { id: string; nome: string };

/** Acha a conta do alerta: `conexao_id` primeiro (dado de verdade, Etapa 3A revisão); sem ele (linha antiga, de
 *  antes da coluna existir), cai no fallback — o nome da conta às vezes está dentro do texto (ex. "Número
 *  Vendas 1 caiu…"), mesma ideia do `umaPorNumero` de `/metricas`. `null` quando nenhuma bate. */
export function contaDoAlerta(alerta: Pick<LinhaAlerta, "conexao_id" | "texto">, contas: readonly ContaAlerta[]): ContaAlerta | null {
  if (alerta.conexao_id) return contas.find((c) => c.id === alerta.conexao_id) ?? null;
  return contas.find((c) => c.nome && alerta.texto.includes(c.nome)) ?? null;
}

const fmtChaveDia = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
const fmtRotuloDia = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" });

export type GrupoAlertas<T> = { chave: string; rotulo: string; linhas: T[] };

/** Agrupa pelo critério escolhido em "Agrupar por"; `null`/"nenhum" devolve um grupo só (sem cabeçalho). A
 *  ordem de cada grupo some: tipo segue `TIPOS_ALERTA`, conta por nome, data da mais nova pra mais antiga —
 *  dentro de cada grupo as linhas continuam na ordem que chegaram (mais novo primeiro). */
export function agruparAlertas<T extends LinhaAlerta>(linhas: T[], criterio: Agrupar, contas: readonly ContaAlerta[] = []): GrupoAlertas<T>[] {
  if (criterio === "nenhum") return linhas.length ? [{ chave: "todos", rotulo: "", linhas }] : [];

  const grupos = new Map<string, { rotulo: string; linhas: T[] }>();
  for (const l of linhas) {
    let chave: string;
    let rotulo: string;
    if (criterio === "tipo") {
      chave = l.tipo;
      rotulo = tipoAlertaValido(l.tipo) ? INFO_ALERTA[l.tipo].rotulo : l.tipo;
    } else if (criterio === "conta") {
      const conta = contaDoAlerta(l, contas);
      chave = conta?.id ?? "__sem_conta__";
      rotulo = conta?.nome ?? "Sem conexão";
    } else {
      chave = fmtChaveDia.format(new Date(l.created_at));
      rotulo = fmtRotuloDia.format(new Date(l.created_at));
    }
    const grupo = grupos.get(chave);
    if (grupo) grupo.linhas.push(l);
    else grupos.set(chave, { rotulo, linhas: [l] });
  }

  const entradas = [...grupos.entries()];
  if (criterio === "tipo") {
    entradas.sort(([a], [b]) => {
      const ia = TIPOS_ALERTA.indexOf(a as TipoAlerta);
      const ib = TIPOS_ALERTA.indexOf(b as TipoAlerta);
      return (ia === -1 ? TIPOS_ALERTA.length : ia) - (ib === -1 ? TIPOS_ALERTA.length : ib);
    });
  } else if (criterio === "conta") {
    entradas.sort(([, a], [, b]) => a.rotulo.localeCompare(b.rotulo, "pt-BR"));
  } else {
    entradas.sort(([a], [b]) => b.localeCompare(a));
  }
  return entradas.map(([chave, g]) => ({ chave, ...g }));
}

export type FiltrosAlertas = { tipo: string; conta: string; inicio: string | null; fim: string | null; agrupar: Agrupar; pagina: number };

function primeiro(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Filtros da URL de `/alertas`. Valor inválido (tipo fora da lista, conta que não é uuid, data mal formada)
 *  vira "sem filtro" em vez de erro no banco. */
export function lerFiltrosAlertas(sp: Record<string, string | string[] | undefined>): FiltrosAlertas {
  const tipo = primeiro(sp.tipo);
  const conta = primeiro(sp.conta);
  const agrupar = primeiro(sp.agrupar);
  const pagina = Number.parseInt(primeiro(sp.pagina), 10);
  const inicio = primeiro(sp.de);
  const fim = primeiro(sp.ate);
  return {
    tipo: tipoAlertaValido(tipo) ? tipo : "",
    conta: UUID.test(conta) ? conta : "",
    inicio: dataAlertaValida(inicio) ? inicio : null,
    fim: dataAlertaValida(fim) ? fim : null,
    agrupar: agruparValido(agrupar) ? agrupar : "nenhum",
    pagina: Number.isFinite(pagina) && pagina > 0 ? pagina : 1,
  };
}

export function filtrosAlertasParaQuery(f: FiltrosAlertas): string {
  const q = new URLSearchParams();
  if (f.tipo) q.set("tipo", f.tipo);
  if (f.conta) q.set("conta", f.conta);
  if (f.inicio) q.set("de", f.inicio);
  if (f.fim) q.set("ate", f.fim);
  if (f.agrupar !== "nenhum") q.set("agrupar", f.agrupar);
  if (f.pagina > 1) q.set("pagina", String(f.pagina));
  return q.toString();
}

/** Endereço de `/alertas` com os filtros atuais + `mudar`. Mudar qualquer filtro volta pra página 1. */
export function urlAlertas(atual: FiltrosAlertas, mudar: Partial<FiltrosAlertas>): string {
  const f = { ...atual, ...mudar };
  if (!("pagina" in mudar)) f.pagina = 1;
  const q = filtrosAlertasParaQuery(f);
  return q ? `/alertas?${q}` : "/alertas";
}
