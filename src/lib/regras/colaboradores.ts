import { chaveTelefone, normalizarTelefone } from "../telefone";

/** Página pública "Verificação de Colaboradores" (`/l/{slug}/colaboradores`): só responde sim ou não. */
export const RESPOSTA_DA_EQUIPE = "Este número faz parte da equipe.";
export const RESPOSTA_FORA_DA_EQUIPE = "Este número não faz parte da equipe. Desconfie de pedidos de pagamento no privado.";
export const RESPOSTA_NUMERO_INVALIDO = "Digite o número com DDD.";
export const RESPOSTA_MUITAS_CONSULTAS = "Muitas consultas seguidas. Tente de novo em alguns minutos.";

/** O número digitado (com ou sem 55, com ou sem o nono dígito, com máscara) é um dos telefones da equipe? `null` =
 *  número inválido. */
export function numeroDaEquipe(digitado: string, telefones: (string | null | undefined)[]): boolean | null {
  const n = normalizarTelefone(digitado.slice(0, 40));
  if (!n) return null;
  const chave = chaveTelefone(n);
  return telefones.some((t) => {
    const tn = t ? normalizarTelefone(t) : null;
    return !!tn && chaveTelefone(tn) === chave;
  });
}

/** Limite de consultas por chave (IP) numa janela. Em memória: vale por instância do servidor (freio contra quem
 *  tenta varrer números, não uma garantia). */
export function criarLimiteConsultas({ maximo, janelaMs, chavesMax = 10_000 }: { maximo: number; janelaMs: number; chavesMax?: number }) {
  const contagens = new Map<string, { inicio: number; n: number }>();
  return function permitir(chave: string, agora: number): boolean {
    const atual = contagens.get(chave);
    if (!atual || agora - atual.inicio >= janelaMs) {
      if (contagens.size >= chavesMax) {
        for (const [k, v] of contagens) if (agora - v.inicio >= janelaMs) contagens.delete(k);
        if (contagens.size >= chavesMax) contagens.clear();
      }
      contagens.set(chave, { inicio: agora, n: 1 });
      return true;
    }
    atual.n++;
    return atual.n <= maximo;
  };
}
