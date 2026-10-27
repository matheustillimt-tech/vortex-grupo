import { describe, expect, it } from "vitest";
import { proximoEnvio, type CandidatoEnvio } from "@/src/lib/regras/proximo-envio";

const item = (p: Partial<CandidatoEnvio>): CandidatoEnvio => ({
  chave: "x",
  campanhaId: "c1",
  quando: "2026-10-21T22:50:00Z",
  tipo: "mensagem",
  resumo: "",
  situacao: "agendado",
  ...p,
});
const agora = new Date("2026-10-21T20:00:00Z");

describe("proximoEnvio", () => {
  it("pega o menor horário futuro entre agendados e projetados", () => {
    const r = proximoEnvio(
      [
        item({ chave: "feito", quando: "2026-10-21T12:00:00Z", situacao: "feito" }),
        item({ chave: "depois", quando: "2026-10-21T23:02:00Z", situacao: "projetado", resumo: "Link da aula" }),
        item({ chave: "proximo", quando: "2026-10-21T22:50:00Z", tipo: "nome", resumo: "AO VIVO #{n}" }),
      ],
      agora,
    );
    expect(r).toEqual({ quando: "2026-10-21T22:50:00Z", campanhaId: "c1", descricao: "AO VIVO #{n}", chaves: ["proximo"] });
  });

  it("junta o que sai no mesmo minuto e usa o nome do tipo quando não há resumo", () => {
    const r = proximoEnvio(
      [
        item({ chave: "b", quando: "2026-10-21T22:50:30Z", tipo: "abrir", situacao: "projetado" }),
        item({ chave: "a", quando: "2026-10-21T22:50:00Z", tipo: "nome", resumo: "AO VIVO #{n}" }),
      ],
      agora,
    );
    expect(r?.descricao).toBe("AO VIVO #{n} + Abrir grupo");
    expect(r?.chaves).toEqual(["a", "b"]);
    expect(r?.quando).toBe("2026-10-21T22:50:00Z");
  });

  it("ignora o que já passou e o que não está pendente", () => {
    expect(
      proximoEnvio(
        [
          item({ quando: "2026-10-21T19:00:00Z" }),
          item({ situacao: "executando" }),
          item({ situacao: "cancelado" }),
          item({ situacao: "pulado" }),
          item({ situacao: "falhou" }),
          item({ situacao: "feito" }),
        ],
        agora,
      ),
    ).toBeNull();
  });

  it("lista vazia", () => {
    expect(proximoEnvio([], agora)).toBeNull();
  });
});
