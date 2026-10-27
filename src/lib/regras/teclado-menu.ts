/** Navegação por teclado dos menus suspensos (menu "⋮" do cartão e lista de abas). Pura: o componente cliente
 *  só aplica o resultado. */

/** Itens focáveis de um menu aberto: `role="menuitem"` que não estão desabilitados (pulados no foco e nas setas). */
export const SELETOR_ITEM_MENU = '[role="menuitem"]:not(:disabled):not([aria-disabled="true"])';

/** Índice do próximo item a focar, ou `null` se a tecla não é de navegação. Setas Cima/Baixo são cíclicas; Home/End
 *  vão pras pontas. `atual = -1` (foco fora dos itens): Baixo vai pro primeiro, Cima pro último. */
export function proximoFoco(atual: number, total: number, tecla: string): number | null {
  if (total <= 0) return null;
  switch (tecla) {
    case "ArrowDown":
      return atual < 0 ? 0 : (atual + 1) % total;
    case "ArrowUp":
      return atual < 0 ? total - 1 : (atual - 1 + total) % total;
    case "Home":
      return 0;
    case "End":
      return total - 1;
    default:
      return null;
  }
}
