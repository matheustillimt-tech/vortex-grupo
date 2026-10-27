export type FiltrosPessoas = {
  campanha: string | null;
  grupo: string | null;
  situacao: "dentro" | "saiu" | null;
  tag: string | null;
  busca: string | null;
  pagina: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function primeiro(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

function uuid(v: string | string[] | undefined): string | null {
  const s = primeiro(v);
  return UUID.test(s) ? s : null;
}

/** Filtros da URL da tela Pessoas (e da exportação). Valor inválido vira "sem filtro" em vez de erro no banco. */
export function lerFiltros(sp: Record<string, string | string[] | undefined>): FiltrosPessoas {
  const campanha = uuid(sp.campanha);
  const situacao = primeiro(sp.situacao);
  const busca = primeiro(sp.q).replace(/\D/g, "");
  const pagina = Number.parseInt(primeiro(sp.pagina), 10);
  return {
    campanha,
    grupo: campanha ? uuid(sp.grupo) : null,
    situacao: situacao === "dentro" || situacao === "saiu" ? situacao : null,
    tag: uuid(sp.tag),
    busca: busca || null,
    pagina: Number.isFinite(pagina) && pagina > 0 ? pagina : 1,
  };
}

export function filtrosParaRpc(f: FiltrosPessoas) {
  return { p_campanha: f.campanha, p_grupo: f.grupo, p_situacao: f.situacao, p_tag: f.tag, p_busca: f.busca };
}

/** `?campanhas=a,b,c` da exportação em massa (lista de campanhas): só uuids válidos, sem repetir, até 50
 *  (`MAXIMO_CAMPANHAS_EXPORTACAO`) — entrada que não seja uuid é descartada (nunca erro no banco). `null` quando
 *  o parâmetro não vem (a rota cai no filtro de uma campanha só, ou em nenhum filtro). Lista vazia `[]` quando o
 *  parâmetro veio mas nenhum valor presta — a rota responde 400 em vez de exportar tudo. */
export const MAXIMO_CAMPANHAS_EXPORTACAO = 50;

export function lerCampanhasMultiplas(v: string | string[] | undefined): string[] | null {
  if (v === undefined) return null;
  const s = primeiro(v);
  const ids = [...new Set(s.split(",").map((x) => x.trim()).filter((x) => UUID.test(x)))];
  return ids.slice(0, MAXIMO_CAMPANHAS_EXPORTACAO);
}

export function filtrosParaQuery(f: FiltrosPessoas): string {
  const q = new URLSearchParams();
  if (f.campanha) q.set("campanha", f.campanha);
  if (f.grupo) q.set("grupo", f.grupo);
  if (f.situacao) q.set("situacao", f.situacao);
  if (f.tag) q.set("tag", f.tag);
  if (f.busca) q.set("q", f.busca);
  if (f.pagina > 1) q.set("pagina", String(f.pagina));
  return q.toString();
}
