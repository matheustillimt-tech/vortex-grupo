import { describe, expect, it } from "vitest";
import { dispararAutomacoes, dispararCheckout, dispararPorPessoas, sincronizarCronograma } from "@/src/lib/automacoes";
import { dbFalso, filtro, type Chamada, type Resposta } from "./apoio/db-falso";

// Etapa 3F, Tarefa 1: motor com contas, ações novas, Tag Condicional e checkout por plataforma. As automações que já
// existem (sem Tag Condicional, sem contas) seguem exatamente o caminho de antes: os testes de regressão abaixo
// conferem que nem leem `pessoa_tags`.

const AGORA = new Date("2026-10-17T12:03:00.000Z");
const CONTA = "66666666-6666-4666-8666-666666666666";
const TAG = "44444444-4444-4444-8444-444444444444";
const P1 = "5511" + "900000001";
const P2 = "5511" + "900000002";

type Acao = { id: string; ordem: number; tipo: string; conteudo: unknown; atraso_min: number };
const auto = (gatilho: string, acoes: Acao[], extra: Record<string, unknown> = {}) => ({
  id: "a1", campanha_id: "c1", gatilho, quando: null, alvo_grupos: null, ativo: true, provedor: null, produto: null, automacao_acoes: acoes, ...extra,
});
const cond = (tem: boolean, ordem = 1): Acao => ({ id: "cond", ordem, tipo: "tag_condicional", conteudo: { tag_id: TAG, tem }, atraso_min: 0 });
const msg: Acao = { id: "msg", ordem: 2, tipo: "mensagem", conteudo: { formato: "texto", texto: "Oi" }, atraso_min: 0 };
const rem: Acao = { id: "rem", ordem: 3, tipo: "remover_participante", conteudo: {}, atraso_min: 0 };

const remocoes = (chamadas: Chamada[]) => chamadas.filter((c) => c.tabela === "acoes" && c.op === "insert").map((c) => c.dados as Record<string, string>);
const execucoes = (chamadas: Chamada[]) => chamadas.filter((c) => c.tabela === "execucoes" && c.op === "upsert").flatMap((c) => c.dados as Record<string, unknown>[]);
const leuTags = (chamadas: Chamada[]) => chamadas.some((c) => c.tabela === "pessoa_tags");

describe("regressão: automações sem Tag Condicional não leem tags", () => {
  it("entrou (mensagem + remover)", async () => {
    const { db, chamadas } = dbFalso((c) => (c.tabela === "automacoes" ? { data: [auto("entrou", [msg, rem])] } : c.tabela === "conexoes" ? { data: [] } : {}));
    expect(await dispararPorPessoas({ campanhaId: "c1", gatilho: "entrou", grupoId: "g1", telefones: [P1, P2] }, AGORA, db)).toBe(3);
    expect(leuTags(chamadas)).toBe(false);
    expect(execucoes(chamadas)).toEqual([expect.objectContaining({ automacao_acao_id: "msg", alvo_contas: null, gatilho_chave: "g1:2026-10-17T12:00:00.000Z" })]);
    expect(remocoes(chamadas).map((r) => r.telefone)).toEqual([P1, P2]);
  });

  it("saiu e checkout", async () => {
    const saiu = dbFalso((c) => {
      if (c.tabela === "automacoes") return { data: [auto("saiu", [rem])] };
      if (c.tabela === "participantes") return { data: [{ telefone: P1, grupo_id: "g2" }] };
      return c.tabela === "conexoes" ? { data: [] } : {};
    });
    expect(await dispararPorPessoas({ campanhaId: "c1", gatilho: "saiu", grupoId: "g1", telefones: [P1] }, AGORA, saiu.db)).toBe(1);
    expect(leuTags(saiu.chamadas)).toBe(false);

    const ck = dbFalso((c) => {
      if (c.tabela === "automacoes") return { data: [auto("checkout", [rem], { provedor: "hotmart", produto: "Curso" })] };
      if (c.tabela === "participantes") return { data: [{ telefone: P1, grupo_id: "g2" }] };
      return c.tabela === "conexoes" ? { data: [] } : {};
    });
    expect(await dispararCheckout({ vendaId: "v1", provedor: "hotmart", produtos: ["Curso"], telefone: P1 }, AGORA, ck.db)).toBe(1);
    expect(leuTags(ck.chamadas)).toBe(false);
    expect(remocoes(ck.chamadas)).toEqual([expect.objectContaining({ gatilho_chave: "venda:v1:g2", grupo_id: "g2" })]);
  });
});

describe("alvo_contas e ações novas", () => {
  it("grupo cheio: execuções levam alvo_contas e as ações novas (configuração, mover grupos) viram execução", async () => {
    const acoes: Acao[] = [
      { id: "cfg", ordem: 1, tipo: "configuracao", conteudo: { so_admins_enviam: true }, atraso_min: 0 },
      { id: "mov", ordem: 2, tipo: "mover_grupos", conteudo: { campanha_destino: "c2" }, atraso_min: 10 },
    ];
    const { db, chamadas } = dbFalso((c) => (c.tabela === "automacoes" ? { data: [auto("grupo_cheio", acoes, { alvo_contas: [CONTA] })] } : {}));
    expect(await dispararAutomacoes({ campanhaId: "c1", gatilho: "grupo_cheio", grupoId: "g9" }, AGORA, db)).toBe(2);
    expect(filtro(chamadas[0], "eq", "gatilho")).toBe("grupo_cheio");
    expect(execucoes(chamadas)).toEqual([
      expect.objectContaining({ tipo: "configuracao", alvo_contas: [CONTA], alvo_grupos: ["g9"], gatilho_chave: "g9", agendada_para: "2026-10-17T12:03:00.000Z" }),
      expect.objectContaining({ tipo: "mover_grupos", alvo_contas: [CONTA], gatilho_chave: "g9", agendada_para: "2026-10-17T12:13:00.000Z" }),
    ]);
  });

  it("cronograma: alvo_contas vai pra execução; sem conexões = null (todas)", async () => {
    const acoes: Acao[] = [{ id: "lnk", ordem: 1, tipo: "atualizar_links", conteudo: {}, atraso_min: 0 }];
    for (const [alvo, esperado] of [[[CONTA], [CONTA]], [undefined, null]] as const) {
      const { db, chamadas } = dbFalso((c) => {
        if (c.tabela === "automacoes") return { data: { ...auto("cronograma", acoes, { quando: "2026-10-20T10:00:00.000Z" }), ...(alvo ? { alvo_contas: alvo } : {}) } };
        return c.op === "upsert" ? { data: [{ id: "e1" }] } : {};
      });
      expect(await sincronizarCronograma("a1", db)).toBe(1);
      expect(execucoes(chamadas)).toEqual([expect.objectContaining({ tipo: "atualizar_links", alvo_contas: esperado })]);
    }
  });

  it("entrou: a mensagem leva alvo_contas", async () => {
    const { db, chamadas } = dbFalso((c) => (c.tabela === "automacoes" ? { data: [auto("entrou", [msg], { alvo_contas: [CONTA] })] } : c.tabela === "conexoes" ? { data: [] } : {}));
    await dispararPorPessoas({ campanhaId: "c1", gatilho: "entrou", grupoId: "g1", telefones: [P1] }, AGORA, db);
    expect(execucoes(chamadas)).toEqual([expect.objectContaining({ alvo_contas: [CONTA] })]);
  });
});

/** Banco falso com `pessoa_tags` respondendo as linhas dadas (filtradas pelos `in` de tag e telefone, como o banco). */
function comTags(automacoes: unknown[], tags: { telefone: string; tag_id: string; campanha_id: string | null }[], extra: (c: Chamada) => Resposta | null = () => null) {
  return dbFalso((c) => {
    const r = extra(c);
    if (r) return r;
    if (c.tabela === "automacoes") return { data: automacoes };
    if (c.tabela === "conexoes") return { data: [{ telefone: "5511" + "988887777" }] };
    if (c.tabela === "pessoa_tags") {
      const ids = filtro(c, "in", "tag_id") as string[];
      const tels = filtro(c, "in", "telefone") as string[];
      return { data: tags.filter((t) => ids.includes(t.tag_id) && tels.includes(t.telefone)) };
    }
    return {};
  });
}

describe("Tag Condicional: entrou", () => {
  const acoes = [cond(true), msg, rem];

  it("lê pessoa_tags uma vez (tags das condições, telefones nas duas formas) e cria só pra quem passa", async () => {
    // P1 tem a tag gravada sem o nono dígito: conta igual.
    const { db, chamadas } = comTags([auto("entrou", acoes)], [{ telefone: "551100000001", tag_id: TAG, campanha_id: null }]);
    const total = await dispararPorPessoas({ campanhaId: "c1", gatilho: "entrou", grupoId: "g1", telefones: [P1, P2] }, AGORA, db);

    const sel = chamadas.filter((c) => c.tabela === "pessoa_tags");
    expect(sel).toHaveLength(1);
    expect(filtro(sel[0], "in", "tag_id")).toEqual([TAG]);
    expect(filtro(sel[0], "in", "telefone")).toEqual([P1, "551100000001", P2, "551100000002"]);
    expect(execucoes(chamadas)).toEqual([expect.objectContaining({ automacao_acao_id: "msg", gatilho_chave: "g1:2026-10-17T12:00:00.000Z" })]);
    expect(remocoes(chamadas)).toEqual([expect.objectContaining({ telefone: P1, automacao_acao_id: "rem" })]);
    expect(execucoes(chamadas).concat(remocoes(chamadas)).some((l) => l.automacao_acao_id === "cond")).toBe(false);
    expect(total).toBe(2);
  });

  it("condição falha pra todos: nada é criado; o mesmo gatilho de novo depois de ganhar a tag cria com as mesmas chaves (sem duplicar)", async () => {
    const sem = comTags([auto("entrou", acoes)], []);
    expect(await dispararPorPessoas({ campanhaId: "c1", gatilho: "entrou", grupoId: "g1", telefones: [P1] }, AGORA, sem.db)).toBe(0);
    expect(sem.chamadas.some((c) => c.op === "upsert" || c.op === "insert")).toBe(false);

    const tags = [{ telefone: P1, tag_id: TAG, campanha_id: null }];
    const primeira = comTags([auto("entrou", acoes)], tags);
    await dispararPorPessoas({ campanhaId: "c1", gatilho: "entrou", grupoId: "g1", telefones: [P1] }, AGORA, primeira.db);
    // Reavaliação (mesmo disparo de novo): mesmas chaves → o upsert ignora e a remoção cai no 23505.
    const segunda = comTags([auto("entrou", acoes)], tags, (c) => (c.tabela === "acoes" ? { error: { message: "duplicate", code: "23505" } } : null));
    const total = await dispararPorPessoas({ campanhaId: "c1", gatilho: "entrou", grupoId: "g1", telefones: [P1] }, AGORA, segunda.db);
    const chaves = (ch: Chamada[]) => [...execucoes(ch), ...remocoes(ch)].map((l) => `${l.automacao_acao_id}|${l.gatilho_chave}`);
    expect(chaves(segunda.chamadas)).toEqual(chaves(primeira.chamadas));
    expect(segunda.chamadas.find((c) => c.op === "upsert")!.opcoes).toEqual({ onConflict: "automacao_acao_id,gatilho_chave", ignoreDuplicates: true });
    expect(total).toBe(1); // a mensagem (contada como antes); a remoção repetida não conta
  });

  it("tag de outra campanha (ex.: 'Saiu' de lá) não conexão; sem campanha ou desta campanha conexão", async () => {
    const tags = [{ telefone: P1, tag_id: TAG, campanha_id: "c2" }, { telefone: P2, tag_id: TAG, campanha_id: "c1" }];
    const { db, chamadas } = comTags([auto("entrou", [cond(true), rem])], tags);
    await dispararPorPessoas({ campanhaId: "c1", gatilho: "entrou", grupoId: "g1", telefones: [P1, P2] }, AGORA, db);
    expect(remocoes(chamadas).map((r) => r.telefone)).toEqual([P2]);
  });

  it("número conectado continua protegido (nem entra na avaliação)", async () => {
    const { db, chamadas } = comTags([auto("entrou", [cond(false), rem])], []);
    expect(await dispararPorPessoas({ campanhaId: "c1", gatilho: "entrou", grupoId: "g1", telefones: ["5511" + "988887777"] }, AGORA, db)).toBe(0);
    expect(remocoes(chamadas)).toEqual([]);
    expect(leuTags(chamadas)).toBe(false);
  });

  it("muitos telefones: lê as tags em lotes de 200 (variantes) e junta o resultado", async () => {
    // 150 telefones de 13 dígitos = 300 variantes → 2 consultas (200 + 100). O último tem a tag.
    const tels = Array.from({ length: 150 }, (_, i) => `55119${String(i).padStart(8, "0")}`);
    const ultimo = tels[149];
    const { db, chamadas } = comTags([auto("entrou", [cond(true), rem])], [{ telefone: ultimo, tag_id: TAG, campanha_id: null }]);
    await dispararPorPessoas({ campanhaId: "c1", gatilho: "entrou", grupoId: "g1", telefones: tels }, AGORA, db);
    const sel = chamadas.filter((c) => c.tabela === "pessoa_tags");
    expect(sel.map((c) => (filtro(c, "in", "telefone") as string[]).length)).toEqual([200, 100]);
    expect(remocoes(chamadas).map((r) => r.telefone)).toEqual([ultimo]);
  });

  it("erro ao ler as tags: lança (a conferência alerta e a próxima rodada não repete o que já entrou)", async () => {
    const { db } = comTags([auto("entrou", acoes)], [], (c) => (c.tabela === "pessoa_tags" ? { error: { message: "fora do ar" } } : null));
    await expect(dispararPorPessoas({ campanhaId: "c1", gatilho: "entrou", grupoId: "g1", telefones: [P1] }, AGORA, db)).rejects.toThrow("Não foi possível ler as tags das pessoas");
  });
});

describe("Tag Condicional: saiu", () => {
  it("'não tem a tag': remove só quem não tem", async () => {
    const { db, chamadas } = comTags([auto("saiu", [cond(false), rem])], [{ telefone: P1, tag_id: TAG, campanha_id: null }], (c) =>
      c.tabela === "participantes" ? { data: [{ telefone: (filtro(c, "in", "telefone") as string[])[0], grupo_id: "g2" }] } : null,
    );
    expect(await dispararPorPessoas({ campanhaId: "c1", gatilho: "saiu", grupoId: "g1", telefones: [P1, P2] }, AGORA, db)).toBe(1);
    expect(remocoes(chamadas)).toEqual([expect.objectContaining({ telefone: P2, grupo_id: "g2", gatilho_chave: `saiu:g1:${P2}:2026-10-17T12:03:00.000Z:g2` })]);
  });
});

describe("Tag Condicional e plataforma: checkout", () => {
  const participa = (c: Chamada) => (c.tabela === "participantes" ? { data: [{ telefone: P1, grupo_id: "g1" }] } : null);

  it("condição falha: não lê participações nem enfileira; passa: remove", async () => {
    const a = auto("checkout", [cond(true), rem], { provedor: "kiwify", produto: "Curso" });
    const falha = comTags([a], [], participa);
    expect(await dispararCheckout({ vendaId: "v1", provedor: "kiwify", produtos: ["Curso"], telefone: P1 }, AGORA, falha.db)).toBe(0);
    expect(falha.chamadas.some((c) => c.tabela === "participantes" || c.tabela === "acoes")).toBe(false);

    const passa = comTags([a], [{ telefone: P1, tag_id: TAG, campanha_id: null }], participa);
    expect(await dispararCheckout({ vendaId: "v1", provedor: "kiwify", produtos: ["Curso"], telefone: P1 }, AGORA, passa.db)).toBe(1);
    expect(remocoes(passa.chamadas)).toEqual([expect.objectContaining({ gatilho_chave: "venda:v1:g1", automacao_acao_id: "rem" })]);
  });

  it("comprador que é número conectado continua protegido", async () => {
    const a = auto("checkout", [cond(false), rem], { provedor: "kiwify", produto: "Curso" });
    const { db, chamadas } = comTags([a], [], participa);
    expect(await dispararCheckout({ vendaId: "v1", provedor: "kiwify", produtos: ["Curso"], telefone: "5511" + "988887777" }, AGORA, db)).toBe(0);
    expect(remocoes(chamadas)).toEqual([]);
  });

  it("filtra a plataforma da venda + qualquer plataforma; automação sem provedor dispara pra qualquer venda", async () => {
    const qualquer = auto("checkout", [rem], { provedor: null, produto: "Curso" });
    const { db, chamadas } = comTags([qualquer], [], participa);
    expect(await dispararCheckout({ vendaId: "v9", provedor: "pagarme", produtos: ["curso"], telefone: P1 }, AGORA, db)).toBe(1);
    expect(chamadas[0].filtros).toContainEqual(["or", "provedor.eq.pagarme,provedor.is.null"]);
  });

  it("provedor desconhecido: só as de qualquer plataforma (nada de valor estranho no filtro)", async () => {
    const { db, chamadas } = comTags([], []);
    await dispararCheckout({ vendaId: "v9", provedor: "x,provedor.neq.y", produtos: ["Curso"], telefone: P1 }, AGORA, db);
    expect(chamadas[0].filtros).toContainEqual(["or", "provedor.is.null"]);
  });

  it("evento 'recusada' não dispara numa venda aprovada; null (as de antes) e 'aprovada' disparam", async () => {
    const lista = [
      { ...auto("checkout", [rem], { provedor: "hotmart", produto: "Curso", checkout_evento: "recusada" }), id: "a-rec" },
      { ...auto("checkout", [{ ...rem, id: "rem2" }], { provedor: "hotmart", produto: "Curso", checkout_evento: "aprovada" }), id: "a-apr" },
      { ...auto("checkout", [{ ...rem, id: "rem3" }], { provedor: "hotmart", produto: "Curso" }), id: "a-null" },
    ];
    const { db, chamadas } = comTags(lista, [], participa);
    expect(await dispararCheckout({ vendaId: "v1", provedor: "hotmart", produtos: ["Curso"], telefone: P1 }, AGORA, db)).toBe(2);
    expect(remocoes(chamadas).map((r) => r.automacao_id)).toEqual(["a-apr", "a-null"]);
  });
});
