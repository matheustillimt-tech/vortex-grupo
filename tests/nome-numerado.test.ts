import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, filtro, type Chamada, type Resposta } from "./apoio/db-falso";

const hoisted = vi.hoisted(() => ({ dbAtual: undefined as unknown, alertarMock: vi.fn(async (_a: unknown, _db?: unknown) => undefined) }));
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => hoisted.dbAtual }));
vi.mock("@/src/lib/jobs/alertas", () => ({ alertar: hoisted.alertarMock }));

import { iniciarExecucoesVencidas } from "@/src/lib/jobs/execucoes";
import { nomeDoGrupo, padraoNumerado, trocarN } from "@/src/lib/regras/nome-grupo";

beforeAll(() => {
  process.env.NEXT_PUBLIC_SITE_URL ??= "https://grupos.exemplo";
});
beforeEach(() => vi.clearAllMocks());

describe("padraoNumerado", () => {
  it("sem {n}: número no fim com #", () => {
    expect(padraoNumerado("🟨 É HOJE 20H 🟨")).toBe("🟨 É HOJE 20H 🟨 #{n}");
    expect(trocarN(padraoNumerado("🟨 É HOJE 20H 🟨"), 3)).toBe("🟨 É HOJE 20H 🟨 #03");
  });
  it("com caractere da campanha, ele substitui o #", () => {
    expect(trocarN(padraoNumerado("AULÃO", "Nº"), 7, "Nº")).toBe("AULÃO Nº07");
  });
  it("número no início", () => {
    expect(padraoNumerado("AULÃO", "", true)).toBe("#{n} AULÃO");
  });
  it("já com {n}: não mexe", () => {
    expect(padraoNumerado("AULÃO {n} AO VIVO")).toBe("AULÃO {n} AO VIVO");
  });
  it("grupo criado depois sai com o mesmo nome numerado", () => {
    expect(nomeDoGrupo(padraoNumerado("🔴 ESTAMOS AO VIVO 🔴"), 15)).toBe("🔴 ESTAMOS AO VIVO 🔴 #15");
  });
});

const agora = new Date("2026-10-19T22:00:00.000Z");
const GRUPOS = [
  { id: "g1", conexao_id: "A", numero: 1 },
  { id: "g2", conexao_id: "A", numero: 2 },
];
function montar(vencida: Record<string, unknown>) {
  return dbFalso((c: Chamada): Resposta => {
    if (c.tabela === "execucoes" && c.op === "update" && (c.dados as { status?: string }).status === "enviando") return { data: [vencida] };
    if (c.tabela === "campanhas" && c.op === "select" && filtro(c, "eq", "id") === "c1") return { data: { nome: "Camp", slug: "camp", data_aula: null, link_aula: null, comunidade_id: null, caractere_numeracao: "", numero_no_inicio: false } };
    if (c.tabela === "campanha_variaveis") return { data: [] };
    if (c.tabela === "grupos" && c.op === "select") return { data: GRUPOS };
    return {};
  });
}
const nome = (extra: Record<string, unknown>) => ({
  id: "e1", campanha_id: "c1", tipo: "nome", origem: "avulsa", gatilho_chave: null, conteudo: { padrao: "⏰ FALTA 1 HORA ⏰" }, alvo_grupos: null, alvo_contas: null, agendada_para: agora.toISOString(), ...extra,
});

describe("Trocar nome da campanha inteira", () => {
  it("numera o padrão sem {n} e passa a valer pros próximos grupos", async () => {
    const { db, chamadas } = montar(nome({}));
    hoisted.dbAtual = db;
    await iniciarExecucoesVencidas(agora);
    const final = chamadas.find((c) => c.tabela === "execucoes" && c.op === "update" && "conteudo_final" in (c.dados as object))!;
    expect((final.dados as { conteudo_final: { padrao: string } }).conteudo_final.padrao).toBe("⏰ FALTA 1 HORA ⏰ #{n}");
    const padrao = chamadas.find((c) => c.tabela === "campanhas" && c.op === "update")!;
    expect(padrao.dados).toEqual({ padrao_nome: "⏰ FALTA 1 HORA ⏰ #{n}" });
  });

  it("grupos escolhidos: nome fixo, sem mexer no padrão da campanha", async () => {
    const { db, chamadas } = montar(nome({ alvo_grupos: ["g1"] }));
    hoisted.dbAtual = db;
    await iniciarExecucoesVencidas(agora);
    const final = chamadas.find((c) => c.tabela === "execucoes" && c.op === "update" && "conteudo_final" in (c.dados as object))!;
    expect((final.dados as { conteudo_final: { padrao: string } }).conteudo_final.padrao).toBe("⏰ FALTA 1 HORA ⏰");
    expect(chamadas.some((c) => c.tabela === "campanhas" && c.op === "update")).toBe(false);
  });
});
