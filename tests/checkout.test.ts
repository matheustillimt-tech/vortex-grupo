import { describe, expect, it } from "vitest";
import hotmart from "./fixtures/hotmart.json";
import kiwify from "./fixtures/kiwify.json";
import pagarme from "./fixtures/pagarme.json";
import vortex from "./fixtures/vortex.json";
import { lerVenda, produtoCasa } from "@/src/lib/checkout/parsers";

describe("lerVenda", () => {
  it("Hotmart aprovada", () => {
    expect(lerVenda("hotmart", hotmart)).toEqual({ eventoId: "evt-hot-1", aprovada: true, telefone: "5537" + "980001001", produtos: ["4512345", "Curso Exemplo"] });
  });
  it("Hotmart de outro evento não é aprovada", () => {
    expect(lerVenda("hotmart", { ...hotmart, event: "PURCHASE_REFUNDED" })?.aprovada).toBe(false);
  });
  it("Kiwify paga", () => {
    expect(lerVenda("kiwify", kiwify)).toEqual({ eventoId: "kiw-1", aprovada: true, telefone: "5537" + "980001001", produtos: ["prod-abc", "Curso Exemplo"] });
  });
  it("Pagar.me order.paid", () => {
    expect(lerVenda("pagarme", pagarme)).toEqual({ eventoId: "hook_pg_1", aprovada: true, telefone: "5537" + "980001001", produtos: ["curso-exemplo", "Curso Exemplo"] });
  });
  it("Checkout próprio aprovado", () => {
    expect(lerVenda("vortex", vortex)).toEqual({ eventoId: "vx-1", aprovada: true, telefone: "5537" + "980001001", produtos: ["curso-exemplo"] });
  });
  it("corpo sem id → null", () => {
    expect(lerVenda("kiwify", { foo: 1 })).toBeNull();
    expect(lerVenda("hotmart", null)).toBeNull();
  });
});

describe("produtoCasa", () => {
  it("compara id ou nome sem diferenciar maiúsculas e espaços", () => {
    expect(produtoCasa("curso exemplo", ["4512345", "Curso Exemplo"])).toBe(true);
    expect(produtoCasa(" 4512345 ", ["4512345"])).toBe(true);
    expect(produtoCasa("outro", ["4512345"])).toBe(false);
  });
});
