import { describe, expect, it } from "vitest";
import { proximoFoco, SELETOR_ITEM_MENU } from "@/src/lib/regras/teclado-menu";

describe("proximoFoco", () => {
  it("setas são cíclicas", () => {
    expect(proximoFoco(0, 3, "ArrowDown")).toBe(1);
    expect(proximoFoco(2, 3, "ArrowDown")).toBe(0);
    expect(proximoFoco(0, 3, "ArrowUp")).toBe(2);
  });
  it("foco fora dos itens: Baixo vai pro primeiro, Cima pro último", () => {
    expect(proximoFoco(-1, 3, "ArrowDown")).toBe(0);
    expect(proximoFoco(-1, 3, "ArrowUp")).toBe(2);
  });
  it("Home/End vão pras pontas; outras teclas e menu vazio não navegam", () => {
    expect(proximoFoco(1, 3, "Home")).toBe(0);
    expect(proximoFoco(1, 3, "End")).toBe(2);
    expect(proximoFoco(1, 3, "a")).toBeNull();
    expect(proximoFoco(-1, 0, "ArrowDown")).toBeNull();
  });
  it("o seletor pula itens desabilitados", () => {
    expect(SELETOR_ITEM_MENU).toContain('[role="menuitem"]');
    expect(SELETOR_ITEM_MENU).toContain(":not(:disabled)");
  });
});
