import { describe, expect, it, vi } from "vitest";
import { criarGatilhosGrupoNovo } from "@/src/lib/jobs/grupo-novo";

function dbFalso(passadas: unknown[], erroInsert: { message: string } | null = null, erroSelect: { message: string } | null = null) {
  const inseridas: unknown[] = [];
  const consulta = {
    select: vi.fn(() => consulta),
    eq: vi.fn(() => consulta),
    neq: vi.fn(() => consulta),
    order: vi.fn(() => consulta),
    limit: vi.fn(async () => (erroSelect ? { data: null, error: erroSelect } : { data: passadas, error: null })),
    insert: vi.fn(async (linhas: unknown[]) => {
      inseridas.push(...linhas);
      return { error: erroInsert };
    }),
  };
  return { db: { from: vi.fn(() => consulta) }, inseridas, consulta };
}

const agora = new Date("2026-10-21T15:00:00Z");
const importante = (id: string, quando: string) => ({ id, tipo: "mensagem", origem: "sequencia", status: "concluida", importante: true, agendada_para: quando, conteudo_final: { formato: "texto", texto: id } });

describe("criarGatilhosGrupoNovo", () => {
  it("agenda a fixa e as 3 últimas importantes só pro grupo novo", async () => {
    const { db, inseridas, consulta } = dbFalso([
      importante("d", "2026-10-21T12:00:00Z"),
      importante("c", "2026-10-20T12:00:00Z"),
      importante("b", "2026-10-19T12:00:00Z"),
      importante("a", "2026-10-18T12:00:00Z"),
    ]);
    expect(await criarGatilhosGrupoNovo("c1", "g9", "Bem-vindo!", agora, db as never)).toBe(4);
    expect(consulta.eq).toHaveBeenCalledWith("importante", true);
    expect(inseridas.map((l) => (l as { conteudo: { texto: string } }).conteudo.texto)).toEqual(["Bem-vindo!", "b", "c", "d"]);
  });

  it("nada a mandar: não insere", async () => {
    const { db, consulta } = dbFalso([]);
    expect(await criarGatilhosGrupoNovo("c1", "g9", null, agora, db as never)).toBe(0);
    expect(consulta.insert).not.toHaveBeenCalled();
  });

  it("falha ao inserir sobe o erro (a ação de criar grupo tenta de novo)", async () => {
    const { db } = dbFalso([], { message: "fora do ar" });
    await expect(criarGatilhosGrupoNovo("c1", "g9", "Oi", agora, db as never)).rejects.toThrow("Não foi possível agendar as mensagens do grupo novo: fora do ar");
  });

  it("falha ao ler as importantes sobe o erro e não insere nada", async () => {
    const { db, consulta } = dbFalso([], null, { message: "fora do ar" });
    await expect(criarGatilhosGrupoNovo("c1", "g9", "Oi", agora, db as never)).rejects.toThrow("Não foi possível ler as mensagens importantes: fora do ar");
    expect(consulta.insert).not.toHaveBeenCalled();
  });
});
