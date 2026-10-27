import { describe, expect, it } from "vitest";
import { resultadoErro } from "@/src/lib/jobs/tarefas";

describe("resultadoErro", () => {
  it("repetir volta pra fila com espera de 30 s", () => {
    expect(resultadoErro("repetir", 1)).toEqual({ status: "fila", esperaMs: 30_000, pausarConexaoMs: 0, desconectar: false });
  });
  it("pausar pausa o número por 10 min e volta pra fila", () => {
    expect(resultadoErro("pausar", 1)).toEqual({ status: "fila", esperaMs: 600_000, pausarConexaoMs: 600_000, desconectar: false });
  });
  it("desconectado vira erro e marca o número", () => {
    expect(resultadoErro("desconectado", 1)).toEqual({ status: "erro", esperaMs: 0, pausarConexaoMs: 0, desconectar: true });
  });
  it("falha vira erro direto", () => {
    expect(resultadoErro("falha", 1).status).toBe("erro");
  });
  it("depois de 3 tentativas, repetir vira erro", () => {
    expect(resultadoErro("repetir", 3).status).toBe("erro");
  });
});
