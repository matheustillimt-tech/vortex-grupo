import type { EntradaAcao } from "./assistente-acao";
import { isoParaCampoBrasilia } from "./horario";

/** API v1 (Etapa 3H2): regras puras de entrada. A validação de verdade é a do assistente de ação
 *  (`validarEntradaAcao` + `criarAcaoComo`); aqui só traduz o corpo da API pro formato do assistente. */

const CAMPO_BRASILIA = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(:\d{2}(\.\d{1,9})?)?$/;
const ISO_COM_FUSO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

/** `agendar_para` → `quando` do assistente: ausente/null = "agora"; ISO 8601 com fuso (`Z` ou `±hh:mm`) vira o
 *  horário de Brasília (minuto); `AAAA-MM-DDTHH:MM[:SS]` sem fuso já é Brasília (segundos descartados). Outro formato → erro. */
export function quandoDaApi(v: unknown): { ok: true; quando: string } | { ok: false; erro: string } {
  if (v === undefined || v === null || v === "") return { ok: true, quando: "agora" };
  if (typeof v !== "string") return { ok: false, erro: "agendar_para inválido: use ISO 8601 (ex.: 2026-10-20T21:00:00-03:00)." };
  const local = CAMPO_BRASILIA.exec(v);
  if (local) return { ok: true, quando: local[1] };
  if (ISO_COM_FUSO.test(v)) {
    const t = new Date(v).getTime();
    if (!Number.isNaN(t)) return { ok: true, quando: isoParaCampoBrasilia(new Date(t).toISOString()) };
  }
  return { ok: false, erro: "agendar_para inválido: use ISO 8601 (ex.: 2026-10-20T21:00:00-03:00)." };
}

/** Corpo de `POST /api/v1/acoes` → entrada do assistente (categoria campanha). O resto (ids, tipo, conteúdo,
 *  horário no futuro, campanhas/contas/grupos no banco) é conferido pelas mesmas regras do assistente. */
export function entradaAcaoDaApi(corpo: unknown): { ok: true; entrada: EntradaAcao } | { ok: false; erro: string } {
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) return { ok: false, erro: "Corpo inválido: envie um objeto JSON." };
  const c = corpo as Record<string, unknown>;
  if (!Array.isArray(c.campanhas)) return { ok: false, erro: "Informe campanhas (lista de ids)." };
  const q = quandoDaApi(c.agendar_para);
  if (!q.ok) return q;
  return {
    ok: true,
    entrada: {
      categoria: "campanha",
      campanhas: c.campanhas as string[],
      projetoId: null,
      tipo: c.tipo as EntradaAcao["tipo"],
      contas: (c.contas ?? null) as string[] | null,
      grupos: (c.grupos ?? null) as string[] | null,
      conteudo: c.conteudo,
      importante: false,
      quando: q.quando,
    },
  };
}
