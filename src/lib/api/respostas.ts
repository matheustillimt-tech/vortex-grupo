/** Respostas JSON da API v1: sucesso com os dados, erro sempre `{ erro }` em pt-BR. Nunca em cache. */

const SEM_CACHE = { "cache-control": "no-store" };

export function respostaApi(dados: unknown, status = 200, cabecalhos: Record<string, string> = {}): Response {
  return Response.json(dados, { status, headers: { ...SEM_CACHE, ...cabecalhos } });
}

export function erroApi(status: number, erro: string, cabecalhos: Record<string, string> = {}): Response {
  return respostaApi({ erro }, status, cabecalhos);
}

export const ERROS_API = {
  naoAutenticado: "Chave de API ausente ou inválida.",
  semEscopo: "Esta chave não tem permissão de envio.",
  limite: "Limite de 60 chamadas por minuto atingido. Tente de novo em instantes.",
  indisponivel: "Não foi possível conferir a chave agora. Tente de novo.",
  interno: "Não foi possível concluir a chamada.",
} as const;

/** `?pagina=` inteiro ≥ 1 (padrão 1, teto 10000). */
export function lerPagina(v: string | null): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 10_000) : 1;
}

/** `ResultadoApi` (de `consultas.ts`) → resposta JSON. */
export function responderResultado(r: { ok: true; dados: unknown; status?: number } | { ok: false; status: number; erro: string }): Response {
  return r.ok ? respostaApi(r.dados, r.status ?? 200) : erroApi(r.status, r.erro);
}
