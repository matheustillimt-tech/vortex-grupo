import type { TipoExecucao } from "./conteudo";

/** Preenchidas pela campanha; não podem ser usadas como chave personalizada. */
export const CHAVES_AUTOMATICAS = ["data_aula", "hora_aula", "dia_semana_aula", "link_aula", "link_grupo", "nome_campanha"] as const;

const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const BRASILIA_MS = 3 * 3600_000; // UTC−3, sem horário de verão desde 2019
/** `{chave}` com 2 a 30 letras minúsculas ou _. `{n}` (1 letra) fica de fora: é o número do grupo. */
const VARIAVEL = /\{([a-z_]{2,30})\}/g;

export type CampanhaVariaveis = { nome: string; slug: string; data_aula: string | null; link_aula: string | null };

export function variaveisAutomaticas(c: CampanhaVariaveis, site: string): Record<string, string> {
  const base = { link_aula: c.link_aula ?? "", link_grupo: `${site}/l/${c.slug}`, nome_campanha: c.nome, data_aula: "", hora_aula: "", dia_semana_aula: "" };
  if (!c.data_aula) return base;
  const b = new Date(new Date(c.data_aula).getTime() - BRASILIA_MS); // relógio de Brasília nos campos UTC
  const dd = String(b.getUTCDate()).padStart(2, "0");
  const mm = String(b.getUTCMonth() + 1).padStart(2, "0");
  const min = b.getUTCMinutes();
  return {
    ...base,
    data_aula: `${dd}/${mm}`,
    hora_aula: min ? `${b.getUTCHours()}h${String(min).padStart(2, "0")}` : `${b.getUTCHours()}h`,
    dia_semana_aula: DIAS[b.getUTCDay()],
  };
}

/** Personalizadas + automáticas (as automáticas ganham se alguém conseguiu salvar a mesma chave). */
export function juntarVariaveis(automaticas: Record<string, string>, personalizadas: { chave: string; valor: string }[]): Record<string, string> {
  return { ...Object.fromEntries(personalizadas.map((p) => [p.chave, p.valor])), ...automaticas };
}

/** Variáveis de um grupo: o valor do grupo sobrepõe o da campanha; vazio (ou só espaço) herda o da campanha. As
 *  automáticas (`CHAVES_AUTOMATICAS`) continuam vindo da campanha. */
export function variaveisDoGrupo(daCampanha: Record<string, string>, doGrupo: { chave: string; valor: string | null }[]): Record<string, string> {
  const vars = { ...daCampanha };
  for (const v of doGrupo) {
    if ((CHAVES_AUTOMATICAS as readonly string[]).includes(v.chave)) continue;
    if (typeof v.valor === "string" && v.valor.trim()) vars[v.chave] = v.valor;
  }
  return vars;
}

/** Troca cada `{chave}` pelo valor. Chave sem valor (ou vazia) fica como está e entra em `faltando`. */
export function resolverTexto(texto: string, vars: Record<string, string>): { texto: string; faltando: string[] } {
  const faltando = new Set<string>();
  const out = texto.replace(VARIAVEL, (inteiro, chave: string) => {
    const v = vars[chave];
    if (v === undefined || !v.trim()) {
      faltando.add(chave);
      return inteiro;
    }
    return v;
  });
  return { texto: out, faltando: [...faltando] };
}

/** Resolve as variáveis em todos os campos de texto do conteúdo de um tipo. */
export function resolverConteudo(tipo: TipoExecucao, conteudo: unknown, vars: Record<string, string>): { conteudo: unknown; faltando: string[] } {
  const c = { ...((conteudo ?? {}) as Record<string, unknown>) };
  const faltando = new Set<string>();
  const r = (t: unknown) => {
    const x = resolverTexto(typeof t === "string" ? t : "", vars);
    x.faltando.forEach((f) => faltando.add(f));
    return x.texto;
  };
  if (tipo === "mensagem" && c.versao === 2) {
    // v2: cada mensagem tem seus campos de texto (o formato antigo segue no ramo de baixo, sem mudança).
    const mensagens = (Array.isArray(c.mensagens) ? c.mensagens : []).map((bruta) => {
      const m = { ...((bruta ?? {}) as Record<string, unknown>) };
      if (typeof m.texto === "string") m.texto = r(m.texto);
      if (typeof m.legenda === "string") m.legenda = r(m.legenda);
      if (Array.isArray(m.botoes)) {
        m.botoes = m.botoes.map((b) => {
          const bb = { ...((b ?? {}) as Record<string, unknown>) };
          bb.rotulo = r(bb.rotulo);
          bb.valor = r(bb.valor);
          return bb;
        });
      }
      if (m.contato && typeof m.contato === "object") {
        const k = { ...(m.contato as Record<string, unknown>) };
        k.nome = r(k.nome);
        m.contato = k;
      }
      if (m.evento && typeof m.evento === "object") {
        const e = { ...(m.evento as Record<string, unknown>) };
        e.nome = r(e.nome);
        if (typeof e.descricao === "string") e.descricao = r(e.descricao);
        if (typeof e.local === "string") e.local = r(e.local);
        m.evento = e;
      }
      if (m.enquete && typeof m.enquete === "object") {
        const q = { ...(m.enquete as Record<string, unknown>) };
        q.pergunta = r(q.pergunta);
        q.opcoes = (Array.isArray(q.opcoes) ? q.opcoes : []).map(r);
        m.enquete = q;
      }
      return m;
    });
    return { conteudo: { ...c, mensagens }, faltando: [...faltando] };
  }
  if (tipo === "mensagem" || tipo === "descricao") c.texto = r(c.texto);
  if (tipo === "nome") c.padrao = r(c.padrao);
  if (tipo === "enquete") {
    c.pergunta = r(c.pergunta);
    c.opcoes = (Array.isArray(c.opcoes) ? c.opcoes : []).map(r);
  }
  return { conteudo: c, faltando: [...faltando] };
}

export function validarChave(chave: string): string | null {
  if (!/^[a-z_]{2,30}$/.test(chave)) return "A chave aceita só letras minúsculas sem acento e _ (2 a 30).";
  if ((CHAVES_AUTOMATICAS as readonly string[]).includes(chave)) return `{${chave}} já é preenchida pela campanha.`;
  return null;
}

/** Texto do bloqueio: "Variável {cupom} vazia na campanha X". */
export function motivoVariaveis(faltando: string[], campanha: string): string {
  const lista = faltando.map((f) => `{${f}}`).join(", ");
  return `${faltando.length > 1 ? "Variáveis" : "Variável"} ${lista} ${faltando.length > 1 ? "vazias" : "vazia"} na campanha ${campanha}`;
}
