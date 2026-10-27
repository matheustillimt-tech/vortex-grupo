/** Teclado de um grupo de rádio (padrão WAI-ARIA): ←/↑ volta, →/↓ avança (dando a volta nas pontas), Home vai pra
 *  primeira e End pra última. Devolve o índice novo ou `null` se a tecla não mexe na escolha. */
export function proximoIndiceRadio(tecla: string, atual: number, total: number): number | null {
  if (total <= 0) return null;
  switch (tecla) {
    case "ArrowRight":
    case "ArrowDown":
      return (atual + 1) % total;
    case "ArrowLeft":
    case "ArrowUp":
      return (atual - 1 + total) % total;
    case "Home":
      return 0;
    case "End":
      return total - 1;
    default:
      return null;
  }
}
