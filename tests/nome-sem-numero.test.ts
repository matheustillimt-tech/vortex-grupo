import { describe, expect, it } from "vitest";
import { nomeSemNumero } from "@/src/lib/regras/nome-grupo";

describe("nomeSemNumero (cartão da campanha)", () => {
  it("tira o número do fim, com o caractere colado", () => {
    expect(nomeSemNumero("🔥 22/10: 100K COM IA #01", 1)).toBe("🔥 22/10: 100K COM IA");
    expect(nomeSemNumero("🟨 IMERSÃO IA 🟨 #14", 14)).toBe("🟨 IMERSÃO IA 🟨");
    expect(nomeSemNumero("AULÃO 03", 3)).toBe("AULÃO");
    expect(nomeSemNumero("AULÃO | 7", 7)).toBe("AULÃO");
  });
  it("tira o número do começo", () => {
    expect(nomeSemNumero("01 AULÃO", 1)).toBe("AULÃO");
    expect(nomeSemNumero("#02 - AULÃO", 2)).toBe("AULÃO");
  });
  it("não mexe em número que não é o do grupo nem em nome sem número", () => {
    expect(nomeSemNumero("🔥 22/10: 100K COM IA", 1)).toBe("🔥 22/10: 100K COM IA");
    expect(nomeSemNumero("IA 2026", 1)).toBe("IA 2026");
    expect(nomeSemNumero("IA 21", 1)).toBe("IA 21");
    expect(nomeSemNumero("10 DICAS", 1)).toBe("10 DICAS");
    expect(nomeSemNumero("#01", 1)).toBe("#01");
  });
});
