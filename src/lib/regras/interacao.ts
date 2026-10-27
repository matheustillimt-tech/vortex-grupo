/** Pequenas regras de interação de UI que valem a pena testar sem montar o componente (Etapa 3N, revisão
 *  final B). */

/** Uma linha de lista inteira é clicável (navega ao clicar/Enter) mas tem controles internos (checkbox, botão
 *  de expandir, menu) que não devem disparar a navegação quando o Enter sai de dentro deles e borbulha até o
 *  `onKeyDown` da linha. Só navega quando o Enter foi dado na própria linha (`target === currentTarget`) —
 *  nunca quando ele veio de um filho (ex.: automacoes/lista.tsx). */
export function enterNaPropriaLinha(tecla: string, alvo: unknown, alvoAtual: unknown): boolean {
  return tecla === "Enter" && alvo === alvoAtual;
}

/** Campo que salva no `onBlur` (ex.: links-por-dia.tsx): só vale a pena bater no servidor quando o valor atual
 *  é diferente do último valor de fato salvo — sair do campo sem mudar nada (Tab, clique fora) não deve gerar
 *  uma chamada de servidor nem um "salvando..." (revisão final B, item 4). */
export function deveSalvarAoSair(valorAtual: string, ultimoSalvo: string): boolean {
  return valorAtual !== ultimoSalvo;
}

/** Vários blocos que salvam sozinhos ao escolher (ex.: tags.tsx, "Quando entrar"/"Quando sair"): enquanto
 *  QUALQUER bloco está salvando, os controles de TODOS ficam desabilitados — não só os do bloco em questão —
 *  senão mudar outro bloco no meio do caminho sobrescreveria o estado que acabou de voltar do servidor
 *  (revisão final B, item m4). */
export function algumBlocoSalvando<T>(salvando: T | null): boolean {
  return salvando !== null;
}

/** Texto do `window.confirm` pra desativar grupos em lote (campanhas/[id]/grupos/lista.tsx): descreve o que de
 *  fato acontece — `desativarGrupos` não exclui nada, os grupos ficam desativados, continuam na lista
 *  (esmaecidos) e o sistema para de usá-los (revisão final B, item m5). */
export function textoConfirmarDesativarGrupos(quantidade: number): string {
  return `Desativar ${quantidade} grupo(s)? Eles ficam desativados, continuam na lista (esmaecidos) e o sistema para de usá-los. No WhatsApp eles continuam existindo.`;
}
