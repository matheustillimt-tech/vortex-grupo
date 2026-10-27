import { describe, expect, it } from "vitest";
import { cabeNoPrazo, calcularAlvo } from "@/src/lib/jobs/tarefas";

describe("calcularAlvo", () => {
  it("usa o horário agendado quando o número já está livre", () => {
    expect(calcularAlvo(1000, 0)).toBe(1000);
    expect(calcularAlvo(1000, 500)).toBe(1000);
  });
  it("usa a liberação do número quando ela é mais tarde que o agendado", () => {
    expect(calcularAlvo(1000, 4000)).toBe(4000);
  });
});

describe("cabeNoPrazo", () => {
  it("cabe quando o alvo já passou (espera zero) e sobra margem", () => {
    expect(cabeNoPrazo(1000, 2000, 10_000)).toBe(true);
  });
  it("cabe quando a espera até o alvo deixa pelo menos a margem de sobra", () => {
    // agora=0, alvo=4000 → espera 4000ms; restante=10000 → sobra 6000 >= margem 5000
    expect(cabeNoPrazo(4000, 0, 10_000, 5000)).toBe(true);
  });
  it("não cabe quando a espera deixaria menos que a margem de sobra", () => {
    // agora=0, alvo=6000 → espera 6000ms; restante=10000 → sobra 4000 < margem 5000
    expect(cabeNoPrazo(6000, 0, 10_000, 5000)).toBe(false);
  });
  it("respeita a margem padrão de 5 s quando não informada", () => {
    expect(cabeNoPrazo(5000, 0, 10_000)).toBe(true); // sobra exatamente 5000
    expect(cabeNoPrazo(5001, 0, 10_000)).toBe(false);
  });
});
