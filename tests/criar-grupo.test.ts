import { describe, expect, it, vi } from "vitest";
import { criarGrupoPassos, type PassosFeitos } from "@/src/lib/jobs/acoes";

function zFalso(falharEm?: string) {
  const chamadas: string[] = [];
  const passo = (nome: string, valor?: unknown) => vi.fn(async () => {
    chamadas.push(nome);
    if (nome === falharEm) throw new Error(`falhou ${nome}`);
    return valor;
  });
  return {
    chamadas,
    z: {
      criarGrupo: passo("criarGrupo", "120@g.us"),
      participantes: passo("participantes"),
      configurarGrupo: passo("configurarGrupo"),
      criarComunidade: passo("criarComunidade", "999@g.us"),
      ligarGrupo: passo("ligarGrupo"),
      linkConvite: passo("linkConvite", "https://chat.whatsapp.com/X"),
    },
  };
}

const dados = {
  criador: { id: "i", token: "t", clientToken: "c" },
  admins: ["5511888888888"],
  nome: "AULÃO #01",
  descricao: "desc",
  fechado: true,
  comunidadeId: null,
  criarComunidade: { nome: "Aulão", descricao: "desc" },
};

describe("criarGrupoPassos", () => {
  it("faz todos os passos na ordem", async () => {
    const { z, chamadas } = zFalso();
    const r = await criarGrupoPassos(z as never, dados, {});
    expect(chamadas).toEqual(["criarGrupo", "participantes", "configurarGrupo", "criarComunidade", "ligarGrupo", "linkConvite"]);
    expect(r).toEqual({ groupId: "120@g.us", promovidos: true, configurado: true, comunidadeId: "999@g.us", ligado: true, link: "https://chat.whatsapp.com/X" });
    expect(z.configurarGrupo).toHaveBeenCalledWith(dados.criador, { groupId: "120@g.us", name: "AULÃO #01", description: "desc", announce: true });
  });

  it("retoma do passo que falhou sem repetir o que já foi feito", async () => {
    const primeira = zFalso("configurarGrupo");
    const feito: Record<string, unknown> = {};
    await expect(criarGrupoPassos(primeira.z as never, dados, feito)).rejects.toThrow("falhou configurarGrupo");
    expect(feito).toEqual({ groupId: "120@g.us", promovidos: true });

    const segunda = zFalso();
    await criarGrupoPassos(segunda.z as never, dados, feito);
    expect(segunda.chamadas).toEqual(["configurarGrupo", "criarComunidade", "ligarGrupo", "linkConvite"]);
  });

  it("sem comunidade pula os passos de comunidade; sem admins não promove", async () => {
    const { z, chamadas } = zFalso();
    await criarGrupoPassos(z as never, { ...dados, admins: [], criarComunidade: null }, {});
    expect(chamadas).toEqual(["criarGrupo", "configurarGrupo", "linkConvite"]);
  });

  it("comunidade já existente só liga", async () => {
    const { z, chamadas } = zFalso();
    await criarGrupoPassos(z as never, { ...dados, comunidadeId: "888@g.us", criarComunidade: null }, {});
    expect(chamadas).toContain("ligarGrupo");
    expect(chamadas).not.toContain("criarComunidade");
  });

  it("chama aoAvancar com o groupId logo depois de criarGrupo", async () => {
    const { z } = zFalso();
    const vistos: PassosFeitos[] = [];
    await criarGrupoPassos(z as never, dados, {}, async (f) => {
      vistos.push({ ...f });
    });
    expect(vistos[0]).toEqual({ groupId: "120@g.us" });
  });
});
