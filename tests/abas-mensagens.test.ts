import { describe, expect, it } from "vitest";
import { ABAS_MENSAGENS, dataHoraCompleta, fimDoDiaIso, inicioDoDiaIso, lerAbaMensagens } from "@/src/lib/regras/abas-mensagens";

describe("abas de mensagens", () => {
  it("rótulos na ordem da tela", () => {
    expect(ABAS_MENSAGENS.map((a) => a.rotulo)).toEqual(["Visão geral", "Na fila", "Agendado", "Processando", "Sucesso", "Falhas"]);
    expect(ABAS_MENSAGENS.map((a) => a.valor)).toEqual(["todas", "fila", "agendado", "processando", "sucesso", "falhas"]);
  });
  it("lê a aba da URL", () => {
    expect(lerAbaMensagens("falhas")).toBe("falhas");
    expect(lerAbaMensagens("xyz")).toBe("todas");
    expect(lerAbaMensagens(undefined)).toBe("todas");
  });
});

describe("datas", () => {
  it("início e fim do dia em Brasília", () => {
    expect(inicioDoDiaIso("2026-10-16")).toBe("2026-10-16T03:00:00.000Z");
    expect(fimDoDiaIso("2026-10-16")).toBe("2026-10-17T03:00:00.000Z");
    expect(inicioDoDiaIso("16/10/2026")).toBeNull();
    expect(fimDoDiaIso(undefined)).toBeNull();
  });
  it("data e hora completas", () => {
    expect(dataHoraCompleta("2026-10-15T16:53:21Z")).toBe("15/10/2026, 13:53:21");
  });
});
