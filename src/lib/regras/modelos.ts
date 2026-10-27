import type { TipoModelo } from "./conteudo";
import { paraV2, type ConteudoV2 } from "./conteudo-v2";

export type ModeloLista = {
  id: string;
  nome: string;
  tipo: TipoModelo;
  conteudo: unknown;
  pasta: string | null;
  arquivado: boolean;
  created_at: string;
  updated_at: string;
};

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Pastas dos modelos não arquivados, com a contagem de cada uma, em ordem alfabética pt-BR. */
export function pastasDe(l: ModeloLista[]): { nome: string; total: number }[] {
  const contagem = new Map<string, number>();
  for (const m of l) {
    if (m.arquivado || !m.pasta) continue;
    contagem.set(m.pasta, (contagem.get(m.pasta) ?? 0) + 1);
  }
  return [...contagem.entries()].map(([nome, total]) => ({ nome, total })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

export type OrdemModelos = "atualizacao" | "criacao" | "nome";

export function filtrarModelos(
  l: ModeloLista[],
  f: { busca: string; pasta: string | null; ordem: OrdemModelos; arquivados: boolean },
): ModeloLista[] {
  const busca = semAcento(f.busca.trim());
  return l
    .filter((m) => m.arquivado === f.arquivados)
    .filter((m) => (f.pasta ? m.pasta === f.pasta : true))
    .filter((m) => !busca || semAcento(m.nome).includes(busca))
    .sort((a, b) => {
      if (f.ordem === "nome") return a.nome.localeCompare(b.nome, "pt-BR");
      if (f.ordem === "criacao") return b.created_at.localeCompare(a.created_at);
      return b.updated_at.localeCompare(a.updated_at);
    });
}

export type ValidacaoPasta = { ok: true; nome: string } | { ok: false; erro: string };

/** Nome da pasta: 1 a 40 caracteres depois do trim. */
export function validarPasta(nome: string): ValidacaoPasta {
  const limpo = nome.trim();
  if (limpo.length < 1 || limpo.length > 40) return { ok: false, erro: "Nome da pasta com 1 a 40 caracteres." };
  return { ok: true, nome: limpo };
}

const SUFIXO = " (cópia)";

/** "{nome} (cópia)", cortando o nome original pra caber em 60 letras no total (por code point, pra não partir emoji). */
export function nomeDaCopia(nome: string): string {
  const base = Array.from(nome).slice(0, 60 - SUFIXO.length).join("");
  return `${base}${SUFIXO}`;
}

/** Endereços de mídia (únicos, na ordem em que aparecem) de um conteúdo de modelo "mensagem": toda mensagem de
 *  imagem, vídeo, gif, áudio, documento ou figurinha com `midia_url` preenchido. Aceita o conteúdo cru do banco
 *  (v1 ou v2) — `paraV2` normaliza. Usada pela checagem de "mídias expirando ou expiradas" em `/modelos`. */
export function urlsDeMidia(conteudoBruto: unknown): string[] {
  const conteudo: ConteudoV2 = paraV2(conteudoBruto);
  const vistos = new Set<string>();
  for (const m of conteudo.mensagens) {
    if ("midia_url" in m && m.midia_url) vistos.add(m.midia_url);
  }
  return [...vistos];
}
