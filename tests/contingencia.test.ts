import { describe, expect, it } from "vitest";
import { erroDaConferencia, escolherCriadora, listarNumeros, naoParticipaDoGrupo, papeisDasContas, resumirContingencia } from "@/src/lib/regras/contingencia";

const A = { id: "a", nome: "Chip A", telefone: "5511" + "999990001", status: "conectado" };
const B = { id: "b", nome: "Chip B", telefone: "5511" + "999990002", status: "conectado" };

describe("resumirContingencia", () => {
  it("grupo com outra conexão conectada e admin tem reserva; só a dona não conta", () => {
    const r = resumirContingencia(
      [{ id: "g1", numero: 1, conexao_id: "a" }, { id: "g2", numero: 2, conexao_id: "a" }],
      [A, B],
      [{ grupo_id: "g1", telefone: A.telefone }, { grupo_id: "g1", telefone: B.telefone }, { grupo_id: "g2", telefone: A.telefone }],
    );
    expect(r).toEqual({ total: 2, comReserva: 1, semReserva: [2], donoCaido: [], conectadas: 2 });
  });

  it("reserva desconectada não conta; dono caído aparece", () => {
    const r = resumirContingencia([{ id: "g1", numero: 1, conexao_id: "a" }], [{ ...A, status: "desconectado" }, { ...B, status: "desconectado" }], [{ grupo_id: "g1", telefone: B.telefone }]);
    expect(r.semReserva).toEqual([1]);
    expect(r.donoCaido).toEqual([1]);
    expect(r.conectadas).toBe(0);
  });

  it("dono caído com reserva admin conectada: tem reserva (a troca automática leva o grupo)", () => {
    const r = resumirContingencia([{ id: "g1", numero: 1, conexao_id: "a" }], [{ ...A, status: "desconectado" }, B], [{ grupo_id: "g1", telefone: B.telefone }]);
    expect(r).toMatchObject({ comReserva: 1, semReserva: [], donoCaido: [1] });
  });

  it("admin gravado sem o nono dígito ainda conta", () => {
    const r = resumirContingencia([{ id: "g1", numero: 1, conexao_id: "a" }], [A, B], [{ grupo_id: "g1", telefone: "551199990002" }]);
    expect(r.semReserva).toEqual([]);
  });

  it("ordena pelos números dos grupos", () => {
    const r = resumirContingencia([{ id: "g9", numero: 9, conexao_id: "a" }, { id: "g2", numero: 2, conexao_id: "a" }], [A], []);
    expect(r.semReserva).toEqual([2, 9]);
  });
});

describe("listarNumeros", () => {
  it("formata com zero à esquerda e 'e' no fim", () => {
    expect(listarNumeros([1])).toBe("#01");
    expect(listarNumeros([1, 2, 9])).toBe("#01, #02 e #09");
    expect(listarNumeros([1, 2, 3, 4], 2)).toBe("#01, #02 e mais 2");
    expect(listarNumeros([])).toBe("");
  });
});

describe("escolherCriadora", () => {
  const criadora = { id: "c", status: "conectado", telefone: "5537" + "900000001" };
  const reserva = { id: "r", status: "conectado", telefone: "5537" + "900000002" };
  const caida = { ...criadora, status: "desconectado" };
  it("usa a criadora quando ela está conectada", () => {
    expect(escolherCriadora({ criadoraId: "c", associadas: [reserva], conexoes: [criadora, reserva] })).toBe("c");
  });
  it("com a criadora caída, a associada conectada cria", () => {
    expect(escolherCriadora({ criadoraId: "c", associadas: [reserva], conexoes: [caida, reserva] })).toBe("r");
  });
  it("sem nenhuma conectada, ninguém cria", () => {
    const r2 = { ...reserva, status: "desconectado" };
    expect(escolherCriadora({ criadoraId: "c", associadas: [r2], conexoes: [caida, r2] })).toBeNull();
  });
  it("a retentativa mantém a conexão escolhida, mesmo com a criadora de volta", () => {
    expect(escolherCriadora({ criadoraId: "c", associadas: [reserva], jaEscolhida: "r", conexoes: [criadora, reserva] })).toBe("r");
  });
  it("a retentativa não troca de número se a escolhida caiu", () => {
    const r2 = { ...reserva, status: "desconectado" };
    expect(escolherCriadora({ criadoraId: "c", associadas: [r2], jaEscolhida: "r", conexoes: [criadora, r2] })).toBeNull();
  });
});

describe("erro da conferência", () => {
  it("reconhece o 'não está no grupo' do Zapbot", () => {
    expect(naoParticipaDoGrupo("Zapbot 502: you're not participating in that group")).toBe(true);
    expect(naoParticipaDoGrupo("timeout")).toBe(false);
  });
  it("vira texto em português com o nome do grupo", () => {
    expect(erroDaConferencia("IMERSÃO #01", "you're not participating in that group")).toMatch(/^Não está no grupo IMERSÃO #01/);
    expect(erroDaConferencia("IMERSÃO #01", "timeout")).toBe("Não conseguiu ler o grupo IMERSÃO #01: timeout");
  });
});

describe("papeisDasContas", () => {
  it("uma etiqueta por campanha ativa: principal onde cria, reserva onde é associada; arquivada não conta", () => {
    const p = papeisDasContas(
      [{ id: "w", nome: "Webinar", conexao_criadora_id: "c1" }, { id: "t", nome: "Teste", conexao_criadora_id: "c2" }],
      [{ campanha_id: "w", conexao_id: "c2" }, { campanha_id: "arquivada", conexao_id: "x" }],
    );
    expect(Object.fromEntries(p)).toEqual({
      c1: [{ papel: "principal", campanha: "Webinar" }],
      c2: [{ papel: "principal", campanha: "Teste" }, { papel: "reserva", campanha: "Webinar" }],
    });
  });
});
