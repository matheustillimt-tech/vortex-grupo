import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, type Chamada, type Resposta } from "./apoio/db-falso";
import { liberarTudo, usarMembro } from "./apoio/permissoes";
import { PADRAO_CRIACAO } from "@/src/lib/regras/criacao-grupos";
import {
  diffAdmins,
  emLotes,
  ERRO_ADMIN_E_CONTA,
  ERRO_MAXIMO_ADMINS,
  mascaraTelefoneBr,
  normalizarAdminsNumeros,
  normalizarTelefoneAdmin,
  campoDeTelefoneSalvo,
  semConflitoDeContas,
} from "@/src/lib/regras/admins-numeros";

const hoisted = vi.hoisted(() => ({
  adminAtual: undefined as unknown,
  registrarHistoricoMock: vi.fn(async (..._a: unknown[]) => undefined),
}));

vi.mock("@/src/lib/permissoes", async () => (await import("./apoio/permissoes")).permissoesFalsas());
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => hoisted.adminAtual }));
vi.mock("@/src/lib/supabase/usuario", () => ({ exigirUsuario: vi.fn(async () => ({ id: "u1", email: "u1@x.com" })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/src/lib/historico", () => ({ registrarHistorico: hoisted.registrarHistoricoMock }));

import {
  salvarAlterarGruposEmLote,
  salvarCriacaoDeGrupos,
  type AlterarEmLoteEntrada,
  type InformacoesCriacaoEntrada,
} from "@/app/(painel)/campanhas/[id]/grupos/actions";

describe("normalizarAdminsNumeros", () => {
  it("normaliza (DDI 55), tira vazios e duplicados (com e sem o nono dígito)", () => {
    expect(normalizarAdminsNumeros(["(11) " + "99999-0001", "", "  ", "5511" + "999990001", "551199990001", "+55 21 " + "98888-7777"])).toEqual({
      ok: true,
      valor: ["5511" + "999990001", "5521" + "988887777"],
    });
  });

  it("recusa o telefone da conexão criadora e dos números conectados da campanha", () => {
    const contas = ["5511" + "900000001", "551190000002", null];
    expect(normalizarAdminsNumeros(["11" + "900000001"], contas)).toEqual({ ok: false, erro: ERRO_ADMIN_E_CONTA });
    // Conectado salvo sem o nono dígito, digitado com.
    expect(normalizarAdminsNumeros(["5511" + "990000002"], contas)).toEqual({ ok: false, erro: ERRO_ADMIN_E_CONTA });
    expect(ERRO_ADMIN_E_CONTA).toBe("Esse número já é uma conexão da campanha");
  });

  it("no máximo 20 (duplicados não contam)", () => {
    const vinte = Array.from({ length: 20 }, (_, i) => `55119${String(i).padStart(8, "0")}`);
    expect(normalizarAdminsNumeros([...vinte, vinte[0]])).toMatchObject({ ok: true });
    expect(normalizarAdminsNumeros([...vinte, "5511" + "988887777"])).toEqual({ ok: false, erro: ERRO_MAXIMO_ADMINS });
    expect(ERRO_MAXIMO_ADMINS).toBe("No máximo 20 administradores por número");
  });

  it("telefone inválido ou lista que não é lista: recusa", () => {
    expect(normalizarAdminsNumeros(["123"])).toMatchObject({ ok: false });
    expect(normalizarAdminsNumeros("5511" + "999990001")).toMatchObject({ ok: false });
    expect(normalizarAdminsNumeros([55_11_99999_0001])).toMatchObject({ ok: false });
  });
});

describe("normalizarTelefoneAdmin (só dos administradores por número)", () => {
  it("brasileiro sem DDI: DDD em uso; 11 dígitos só celular com 9", () => {
    expect(normalizarTelefoneAdmin("(11) " + "99999-0001")).toBe("5511" + "999990001");
    expect(normalizarTelefoneAdmin("1133334444")).toBe("551133334444");
    expect(normalizarTelefoneAdmin("1199990001")).toBe("551199990001");
    // EUA sem "+": 11 dígitos que não são celular brasileiro → recusa (o normalizador global poria 55).
    expect(normalizarTelefoneAdmin("14155551234")).toBeNull();
    // DDD que não existe.
    expect(normalizarTelefoneAdmin("20" + "999990001")).toBeNull();
    expect(normalizarTelefoneAdmin("10" + "999990001")).toBeNull();
  });

  it("com + : dígitos como estão, sem pôr 55", () => {
    expect(normalizarTelefoneAdmin("+1 415 555 1234")).toBe("14155551234");
    expect(normalizarTelefoneAdmin("+55 11 " + "99999-0001")).toBe("5511" + "999990001");
    expect(normalizarTelefoneAdmin("+123")).toBeNull();
  });

  it("com 55 na frente: DDD em uso; outros 12–15 dígitos aceitos como estão", () => {
    expect(normalizarTelefoneAdmin("5511" + "999990001")).toBe("5511" + "999990001");
    expect(normalizarTelefoneAdmin("5520" + "999990001")).toBeNull();
    expect(normalizarTelefoneAdmin("351" + "912345678")).toBe("351" + "912345678");
    expect(normalizarTelefoneAdmin("1234567890123456")).toBeNull();
  });

  it("salvo volta pro campo sem mudar de leitura (estrangeiro ganha +)", () => {
    for (const t of ["5511" + "999990001", "551199990001", "14155551234", "351" + "912345678"]) {
      expect(normalizarTelefoneAdmin(campoDeTelefoneSalvo(t))).toBe(t);
    }
    expect(campoDeTelefoneSalvo("5511" + "999990001")).toBe("+55 (11) " + "99999-0001");
    expect(campoDeTelefoneSalvo("14155551234")).toBe("+14155551234");
  });

  it("estrangeiro de 11 dígitos sem + na lista: recusa a lista", () => {
    expect(normalizarAdminsNumeros(["14155551234"])).toMatchObject({ ok: false });
    expect(normalizarAdminsNumeros(["+14155551234"])).toEqual({ ok: true, valor: ["14155551234"] });
  });
});

describe("diffAdmins, emLotes e máscara", () => {
  it("novos e tirados; nono dígito não vira tira-e-põe", () => {
    expect(diffAdmins(["5511" + "999990001", "5511" + "999990002"], ["551199990001", "5511" + "999990003"])).toEqual({ novos: ["5511" + "999990003"], tirados: ["5511" + "999990002"] });
    expect(diffAdmins([], [])).toEqual({ novos: [], tirados: [] });
  });

  it("lotes de 5", () => {
    expect(emLotes([1, 2, 3, 4, 5, 6, 7], 5)).toEqual([[1, 2, 3, 4, 5], [6, 7]]);
    expect(emLotes([], 5)).toEqual([]);
  });

  it("semConflitoDeContas: Etapa 3K Tarefa 2 — tira só o número que colide, nunca falha a lista inteira", () => {
    expect(semConflitoDeContas(["5511" + "999990001", "5511" + "999990002"], ["5511" + "999990002", null])).toEqual(["5511" + "999990001"]);
    // Com e sem o nono dígito contam como o mesmo (mesma regra de normalizarAdminsNumeros).
    expect(semConflitoDeContas(["5511" + "999990002"], ["551199990002"])).toEqual([]);
    expect(semConflitoDeContas(["5511" + "999990001"], [])).toEqual(["5511" + "999990001"]);
    expect(semConflitoDeContas([], ["5511" + "999990001"])).toEqual([]);
  });

  it("máscara BR enquanto digita", () => {
    expect(mascaraTelefoneBr("11")).toBe("(11");
    expect(mascaraTelefoneBr("119999")).toBe("(11) 9999");
    expect(mascaraTelefoneBr("1199999000")).toBe("(11) 9999-9000");
    expect(mascaraTelefoneBr("11" + "999990001")).toBe("(11) " + "99999-0001");
    expect(mascaraTelefoneBr("5511" + "999990001")).toBe("+55 (11) " + "99999-0001");
    expect(mascaraTelefoneBr("351" + "912345678")).toBe("+351" + "912345678");
    expect(mascaraTelefoneBr("+1415")).toBe("+1415");
    expect(mascaraTelefoneBr("+55119")).toBe("+55 (11) 9");
    expect(mascaraTelefoneBr("+")).toBe("+");
    expect(mascaraTelefoneBr("")).toBe("");
  });
});

// ——— Actions ———

const CAMP = "999" + "99999-2222-3333-4444-555555555555";
const CRIADORA = "11111111-1111-1111-1111-111111111111";
const CONTA2 = "22222222-2222-2222-2222-222222222222";

const ALTERAR: AlterarEmLoteEntrada = {
  padrao_nome: "AULÃO #{n}", descricao: "desc", fechado: true, aprovacao_entrada: false, caractere_numeracao: "", mensagens_temporarias: "nao", imagem_grupo_url: null, forcar: false,
};
const INFORMACOES: InformacoesCriacaoEntrada = {
  ...PADRAO_CRIACAO, padrao_nome: "AULÃO #{n}", descricao: "desc", fechado: true, limite_por_grupo: 1000, folga: 1, usar_comunidade: false,
};

/** Campanha com a criadora (55119 00000001) e a conta 2 (55119 00000002) e `salvos` em campanha_admins_numeros. Nada
 *  muda nas informações nem nas contas (não cria execução de nome/descrição/configuração). */
function montar(salvos: string[], extra?: (c: Chamada) => Resposta | undefined) {
  const f = dbFalso((c) => {
    const e = extra?.(c);
    if (e) return e;
    if (c.tabela === "campanhas" && c.op === "select") {
      return { data: { ...ALTERAR, numero_no_inicio: false, conexao_criadora_id: CRIADORA } };
    }
    if (c.tabela === "campanha_conexoes" && c.op === "select") return { data: [{ conexao_id: CONTA2 }] };
    if (c.tabela === "conexoes" && c.op === "select") {
      return { data: [{ id: CRIADORA, telefone: "5511" + "900000001" }, { id: CONTA2, telefone: "5511" + "900000002" }] };
    }
    if (c.tabela === "campanha_admins_numeros" && c.op === "select") return { data: salvos.map((telefone) => ({ telefone })) };
    // `upsert(...).select()` com ignoreDuplicates devolve só as linhas inseridas de fato.
    if (c.tabela === "campanha_admins_numeros" && c.op === "upsert") return { data: (c.dados as { telefone: string }[]).map(({ telefone }) => ({ telefone })) };
    return {};
  });
  hoisted.adminAtual = f.db;
  return f.chamadas;
}

const execucoes = (cs: Chamada[]) => cs.filter((c) => c.tabela === "execucoes" && c.op === "insert").map((c) => c.dados as Record<string, unknown>[]);
const execucoesPlanas = (cs: Chamada[]) => execucoes(cs).flat();
const historicos = () => hoisted.registrarHistoricoMock.mock.calls.map((c) => (c[1] as { resumo: string }).resumo);

beforeEach(() => {
  vi.clearAllMocks();
  liberarTudo();
});

describe("salvarAlterarGruposEmLote com administradores por número", () => {
  it("número novo: grava na lista e cria uma execução admin_add pra todos os grupos ativos", async () => {
    const cs = montar([]);
    const r = await salvarAlterarGruposEmLote(CAMP, ALTERAR, [CONTA2], ["(11) " + "99999-0001"]);
    expect(r).toEqual({});
    const up = cs.find((c) => c.tabela === "campanha_admins_numeros" && c.op === "upsert");
    expect(up?.dados).toEqual([{ campanha_id: CAMP, telefone: "5511" + "999990001", criado_por: "u1" }]);
    expect(execucoesPlanas(cs)).toEqual([
      expect.objectContaining({ campanha_id: CAMP, origem: "massa", tipo: "admin_add", conteudo: { telefone: "5511" + "999990001" }, alvo_grupos: null }),
    ]);
    expect(historicos()).toContain("Administradores por número: +1, −0 (rebaixados: 0)");
  });

  it("tirar sem marcar a caixa: sai da lista, mas não cria admin_remover", async () => {
    const cs = montar(["5511" + "999990001", "5511" + "999990002"]);
    const r = await salvarAlterarGruposEmLote(CAMP, ALTERAR, [CONTA2], ["5511" + "999990001"]);
    expect(r).toEqual({});
    const del = cs.find((c) => c.tabela === "campanha_admins_numeros" && c.op === "delete");
    expect(del?.filtros).toContainEqual(["in", "telefone", ["5511" + "999990002"]]);
    expect(execucoes(cs)).toHaveLength(0);
    expect(historicos()).toContain("Administradores por número: +0, −1 (rebaixados: 0)");
  });

  it("tirar marcando a caixa: cria admin_remover só pra esse número", async () => {
    const cs = montar(["5511" + "999990001", "5511" + "999990002"]);
    // "55119 99990001" está na lista nova: pedir pra rebaixar ele é ignorado.
    const r = await salvarAlterarGruposEmLote(CAMP, ALTERAR, [CONTA2], ["5511" + "999990001"], ["5511" + "999990002", "5511" + "999990001"]);
    expect(r).toEqual({});
    expect(execucoesPlanas(cs)).toEqual([
      expect.objectContaining({ origem: "massa", tipo: "admin_remover", conteudo: { telefone: "5511" + "999990002" }, alvo_grupos: null }),
    ]);
    expect(historicos()).toContain("Administradores por número: +0, −1 (rebaixados: 1)");
  });

  it("execuções num insert só, e só pros números inseridos de fato (upsert que ignorou duplicado não gera admin_add)", async () => {
    const cs = montar([], (c) => (c.tabela === "campanha_admins_numeros" && c.op === "upsert" ? { data: [{ telefone: "5511" + "999990001" }] } : undefined));
    const r = await salvarAlterarGruposEmLote(CAMP, ALTERAR, [CONTA2], ["11" + "999990001", "11" + "999990003"]);
    expect(r).toEqual({});
    const inserts = cs.filter((c) => c.tabela === "execucoes" && c.op === "insert");
    expect(inserts).toHaveLength(1);
    expect(inserts[0].dados).toEqual([expect.objectContaining({ tipo: "admin_add", conteudo: { telefone: "5511" + "999990001" }, alvo_grupos: null, origem: "massa" })]);
  });

  it("número volta pra lista com admin_remover ainda agendado: cancela a remoção pendente", async () => {
    const cs = montar([], (c) => (c.tabela === "execucoes" && c.op === "update" ? { data: [{ id: "ex1" }] } : undefined));
    const r = await salvarAlterarGruposEmLote(CAMP, ALTERAR, [CONTA2], ["11" + "999990002"]);
    expect(r).toEqual({});
    const cancel = cs.find((c) => c.tabela === "execucoes" && c.op === "update");
    expect(cancel?.dados).toEqual({ status: "cancelada" });
    expect(cancel?.filtros).toEqual(expect.arrayContaining([
      ["eq", "campanha_id", CAMP],
      ["eq", "tipo", "admin_remover"],
      ["eq", "status", "agendada"],
      ["in", "conteudo->>telefone", ["5511" + "999990002", "551199990002"]],
    ]));
    expect(execucoes(cs)[0]).toEqual([expect.objectContaining({ tipo: "admin_add" })]);
    expect(historicos()).toContain("Administradores por número: +1, −0 (rebaixados: 0); 1 remoção(ões) de admin pendente(s) cancelada(s)");
  });

  it("Criação não cancela nada nem cria execução", async () => {
    const cs = montar([]);
    await salvarCriacaoDeGrupos(CAMP, INFORMACOES, [CONTA2], ["11" + "999990002"]);
    expect(cs.some((c) => c.tabela === "execucoes")).toBe(false);
  });

  it("número de conexão da campanha: recusa com a mensagem e não grava a lista", async () => {
    const cs = montar([]);
    const r = await salvarAlterarGruposEmLote(CAMP, ALTERAR, [CONTA2], ["11" + "900000002"]);
    expect(r.erro).toMatch(/Esse número já é uma conexão da campanha/);
    expect(cs.some((c) => c.tabela === "campanha_admins_numeros" && c.op !== "select")).toBe(false);
    expect(execucoes(cs)).toHaveLength(0);
  });

  it("mais de 20: recusa antes de salvar qualquer coisa", async () => {
    const cs = montar([]);
    const lista = Array.from({ length: 21 }, (_, i) => `55119${String(i).padStart(8, "0")}`);
    const r = await salvarAlterarGruposEmLote(CAMP, ALTERAR, [CONTA2], lista);
    expect(r.erro).toBe("No máximo 20 administradores por número");
    expect(cs).toHaveLength(0);
  });

  it("sem a lista (chamada de antes): não lê nem grava campanha_admins_numeros", async () => {
    const cs = montar([]);
    const r = await salvarAlterarGruposEmLote(CAMP, ALTERAR, [CONTA2]);
    expect(r).toEqual({});
    expect(cs.some((c) => c.tabela === "campanha_admins_numeros")).toBe(false);
  });

  it("lista igual à salva: nada grava, nenhum histórico de administradores por número", async () => {
    const cs = montar(["5511" + "999990001"]);
    await salvarAlterarGruposEmLote(CAMP, ALTERAR, [CONTA2], ["(11) " + "99999-0001"]);
    expect(cs.some((c) => c.tabela === "campanha_admins_numeros" && c.op !== "select")).toBe(false);
    expect(historicos().some((h) => h.startsWith("Administradores por número"))).toBe(false);
  });

  it("sem permissão de editar: recusa sem tocar no banco", async () => {
    usarMembro({ papel: "membro", permissoes: { campanhas: "ver" } });
    const cs = montar([]);
    const r = await salvarAlterarGruposEmLote(CAMP, ALTERAR, [CONTA2], ["11" + "999990001"]);
    expect(r.erro).toBeTruthy();
    expect(cs).toHaveLength(0);
  });
});

describe("salvarCriacaoDeGrupos com administradores por número", () => {
  it("grava a lista (só pra grupos novos): nenhuma execução, nem admin_remover dos tirados", async () => {
    const cs = montar(["5511" + "999990002"]);
    const r = await salvarCriacaoDeGrupos(CAMP, INFORMACOES, [CONTA2], ["11" + "999990001"]);
    expect(r).toEqual({});
    expect(cs.find((c) => c.tabela === "campanha_admins_numeros" && c.op === "upsert")?.dados).toEqual([
      { campanha_id: CAMP, telefone: "5511" + "999990001", criado_por: "u1" },
    ]);
    expect(cs.find((c) => c.tabela === "campanha_admins_numeros" && c.op === "delete")?.filtros).toContainEqual(["in", "telefone", ["5511" + "999990002"]]);
    expect(execucoes(cs)).toHaveLength(0);
  });
});
