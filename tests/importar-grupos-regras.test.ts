import { describe, expect, it } from "vitest";
import { contaEhAdmin, mensagemSemImportaveis, precisaLerGrupo } from "@/src/lib/regras/importar-grupos";

const grupo = (amAdmin: boolean, participants: { phone: string; isAdmin: boolean }[] = [], participantCount = participants.length) => ({ amAdmin, participantCount, participants });

describe("contaEhAdmin", () => {
  it("amAdmin true basta", () => expect(contaEhAdmin(grupo(true), "556280003004")).toBe(true));
  it("amAdmin false mas a conta está entre os admins", () => {
    expect(contaEhAdmin(grupo(false, [{ phone: "556280003004@s.whatsapp.net", isAdmin: true }]), "556280003004")).toBe(true);
  });
  it("compara com e sem o nono dígito", () => {
    expect(contaEhAdmin(grupo(false, [{ phone: "5562" + "980003004", isAdmin: true }]), "556280003004")).toBe(true);
  });
  it("conta na lista sem ser admin: false", () => {
    expect(contaEhAdmin(grupo(false, [{ phone: "556280003004", isAdmin: false }]), "556280003004")).toBe(false);
  });
  it("outro número admin: false", () => {
    expect(contaEhAdmin(grupo(false, [{ phone: "556299999999", isAdmin: true }]), "556280003004")).toBe(false);
  });
});

describe("precisaLerGrupo", () => {
  it("sem amAdmin e sem participantes na lista: lê", () => expect(precisaLerGrupo(grupo(false, [], 12))).toBe(true));
  it("amAdmin true: não lê", () => expect(precisaLerGrupo(grupo(true, [], 12))).toBe(false));
  it("participantes já vieram: não lê", () => expect(precisaLerGrupo(grupo(false, [{ phone: "1", isAdmin: false }]))).toBe(false));
  it("grupo vazio: não lê", () => expect(precisaLerGrupo(grupo(false, [], 0))).toBe(false));
});

describe("mensagemSemImportaveis", () => {
  it("sem extras: só a frase de sempre", () => {
    expect(mensagemSemImportaveis(0, 0)).toBe("Nenhum grupo disponível para importar: nenhuma conexão da campanha é admin de um grupo fora do sistema.");
  });
  it("aponta os grupos que já estão em outra campanha", () => expect(mensagemSemImportaveis(2, 0)).toContain('2 grupo(s) em que a conexão é admin já estão em outra campanha'));
  it("avisa os não conferidos", () => expect(mensagemSemImportaveis(0, 3)).toContain("3 grupo(s) não puderam ser conferidos"));
});
