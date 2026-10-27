import { describe, expect, it } from "vitest";
import { diagnosticar, precisaDiagnostico, tempoFora } from "@/src/lib/regras/queda";

describe("diagnóstico de número caído", () => {
  it("existe no WhatsApp = desconectado; não existe = banido; sem resposta = indefinido", () => {
    expect(diagnosticar(true)).toBe("desconectado");
    expect(diagnosticar(false)).toBe("banido");
    expect(diagnosticar(null)).toBe("indefinido");
  });

  it("reconfere a cada 30 min", () => {
    const agora = new Date("2026-10-20T12:00:00Z");
    expect(precisaDiagnostico({ diagnostico_em: null }, agora)).toBe(true);
    expect(precisaDiagnostico({ diagnostico_em: "2026-10-20T11:45:00Z" }, agora)).toBe(false);
    expect(precisaDiagnostico({ diagnostico_em: "2026-10-20T11:30:00Z" }, agora)).toBe(true);
  });

  it("tempo fora do ar", () => {
    const agora = new Date("2026-10-20T12:00:00Z");
    expect(tempoFora(null, agora)).toBeNull();
    expect(tempoFora("2026-10-20T11:59:40Z", agora)).toBe("agora há pouco");
    expect(tempoFora("2026-10-20T11:55:00Z", agora)).toBe("há 5 min");
    expect(tempoFora("2026-10-20T09:00:00Z", agora)).toBe("há 3 h");
    expect(tempoFora("2026-10-19T11:00:00Z", agora)).toBe("há 1 dia");
  });
});

import { lerTelefonesAviso, mensagemAvisoQueda } from "@/src/lib/regras/queda";
import { normalizarTelefone } from "@/src/lib/telefone";

describe("aviso de chip caído", () => {
  it("lê telefones um por linha ou com vírgula, sem repetidos", () => {
    expect(lerTelefonesAviso("37 " + "99999-8888\n(37) " + "99999-8888, 5511" + "988887777", normalizarTelefone)).toEqual({ ok: true, telefones: ["5537" + "999998888", "5511" + "988887777"] });
    expect(lerTelefonesAviso("", normalizarTelefone)).toEqual({ ok: true, telefones: [] });
    expect(lerTelefonesAviso("123", normalizarTelefone).ok).toBe(false);
  });

  it("mensagem diz o chip, o número e se foi banido", () => {
    const m = mensagemAvisoQueda({ nome: "Chip 1 - (2002)", telefone: "553770002002", diagnostico: "desconectado", link: "https://x/numeros/1" });
    expect(m).toContain("Chip 1 - (2002)");
    expect(m).toContain("+553770002002");
    expect(m).toContain("DESCONECTADO");
    expect(m).toContain("https://x/numeros/1");
    expect(mensagemAvisoQueda({ nome: "C", telefone: null, diagnostico: "banido", link: "l" })).toContain("BANIDO");
  });
});
