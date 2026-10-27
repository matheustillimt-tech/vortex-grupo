/** Banco falso encadeável no formato do supabase-js: registra cada consulta (tabela, operação, dados, filtros) e
 *  responde pelo `responder`. RPC aparece como tabela `rpc:<nome>` com os argumentos em `dados`. */
export type Chamada = {
  tabela: string;
  op: "select" | "insert" | "update" | "upsert" | "delete";
  dados?: unknown;
  opcoes?: unknown;
  filtros: [string, ...unknown[]][];
};
export type Resposta = { data?: unknown; error?: { message: string; code?: string } | null; count?: number | null };

export function dbFalso(responder: (c: Chamada) => Resposta = () => ({})) {
  const chamadas: Chamada[] = [];
  const responde = (c: Chamada) => {
    chamadas.push(c);
    const r = responder(c);
    return { data: r.data ?? null, error: r.error ?? null, count: r.count ?? null };
  };
  function from(tabela: string) {
    const c: Chamada = { tabela, op: "select", filtros: [] };
    let resposta: { data: unknown; error: unknown; count: unknown } | undefined;
    const q: Record<string, unknown> = {};
    const filtro = (nome: string) => (...args: unknown[]) => {
      c.filtros.push([nome, ...args]);
      return q;
    };
    for (const f of ["eq", "neq", "in", "is", "not", "lt", "lte", "gt", "gte", "like", "ilike", "or", "order", "limit", "range", "contains"]) q[f] = filtro(f);
    q.select = () => q;
    q.single = () => q;
    q.maybeSingle = () => q;
    q.insert = (d: unknown, o?: unknown) => Object.assign(c, { op: "insert", dados: d, opcoes: o }) && q;
    q.update = (d: unknown) => Object.assign(c, { op: "update", dados: d }) && q;
    q.upsert = (d: unknown, o?: unknown) => Object.assign(c, { op: "upsert", dados: d, opcoes: o }) && q;
    q.delete = () => Object.assign(c, { op: "delete" }) && q;
    q.then = (ok: (v: unknown) => unknown, falha?: (e: unknown) => unknown) => {
      resposta ??= responde(c);
      return Promise.resolve(resposta).then(ok, falha);
    };
    return q;
  }
  const rpc = (nome: string, args: unknown) => Promise.resolve(responde({ tabela: `rpc:${nome}`, op: "select", dados: args, filtros: [] }));
  return { db: { from, rpc } as never, chamadas };
}

/** Valor de um filtro registrado (ex.: `filtro(c, "eq", "tipo")` → valor do `.eq("tipo", …)`). */
export function filtro(c: Chamada, nome: string, coluna: string): unknown {
  return c.filtros.find((f) => f[0] === nome && f[1] === coluna)?.[2];
}
