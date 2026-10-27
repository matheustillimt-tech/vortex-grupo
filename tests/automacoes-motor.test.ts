import { describe, expect, it } from "vitest";
import { removerPendentes, dispararAutomacoes, dispararCheckout, dispararPorPessoas, sincronizarCronograma } from "@/src/lib/automacoes";
import { dbFalso, filtro, type Chamada, type Resposta } from "./apoio/db-falso";

const CONTEUDO = { texto: "Oi" };

function automacaoCronograma(ativo: boolean) {
  return {
    id: "a1",
    campanha_id: "c1",
    gatilho: "cronograma",
    quando: "2026-10-20T10:00:00.000Z",
    alvo_grupos: ["g1", "g2"],
    ativo,
    automacao_acoes: [
      { id: "ac2", ordem: 2, tipo: "texto", conteudo: CONTEUDO, atraso_min: 30 },
      { id: "ac1", ordem: 1, tipo: "texto", conteudo: CONTEUDO, atraso_min: 0 },
    ],
  };
}

function automacaoEvento(gatilho: "grupo_criado" | "grupo_cheio") {
  return {
    id: "a2",
    campanha_id: "c1",
    gatilho,
    quando: null,
    alvo_grupos: null,
    ativo: true,
    automacao_acoes: [{ id: "ac1", ordem: 1, tipo: "texto", conteudo: CONTEUDO, atraso_min: 0 }],
  };
}

describe("sincronizarCronograma", () => {
  it("automação ativa: apaga só as execuções agendada (cancelada à mão fica) e faz upsert com as linhas do cronograma", async () => {
    const { db, chamadas } = dbFalso((c) => {
      if (c.tabela === "automacoes") return { data: automacaoCronograma(true) };
      if (c.tabela === "execucoes" && c.op === "upsert") return { data: [{ id: "e1" }, { id: "e2" }] };
      return {};
    });

    const total = await sincronizarCronograma("a1", db);

    expect(total).toBe(2);
    const del = chamadas.find((c) => c.tabela === "execucoes" && c.op === "delete");
    expect(del).toBeDefined();
    expect(filtro(del!, "eq", "automacao_id")).toBe("a1");
    expect(filtro(del!, "eq", "status")).toBe("agendada");
    expect(filtro(del!, "in", "status")).toBeUndefined();

    const ups = chamadas.find((c) => c.tabela === "execucoes" && c.op === "upsert");
    expect(ups).toBeDefined();
    expect(ups!.opcoes).toEqual({ onConflict: "automacao_acao_id,gatilho_chave", ignoreDuplicates: true });
    const linhas = ups!.dados as { agendada_para: string; gatilho_chave: string }[];
    expect(linhas).toHaveLength(2);
    expect(linhas.every((l) => l.gatilho_chave === "cronograma")).toBe(true);
    expect(linhas.find((l) => l.agendada_para === "2026-10-20T10:00:00.000Z")).toBeDefined();
    expect(linhas.find((l) => l.agendada_para === "2026-10-20T10:30:00.000Z")).toBeDefined();
  });

  it("automação ativa com uma ação já concluída (ignoreDuplicates): não falha o lote e só conexão as novas", async () => {
    const { db, chamadas } = dbFalso((c) => {
      if (c.tabela === "automacoes") return { data: automacaoCronograma(true) };
      // Só a segunda linha (ordem 1) foi de fato inserida: a outra já existia 'enviando'/'concluida' e o
      // onConflict/ignoreDuplicates não a devolve.
      if (c.tabela === "execucoes" && c.op === "upsert") return { data: [{ id: "e1" }] };
      return {};
    });

    const total = await sincronizarCronograma("a1", db);

    expect(total).toBe(1);
  });

  it("automação desativada: só apaga as pendentes 'agendada' (sem insert nem update pra 'cancelada')", async () => {
    const { db, chamadas } = dbFalso((c) => {
      if (c.tabela === "automacoes") return { data: automacaoCronograma(false) };
      if (c.tabela === "execucoes" && c.op === "delete") return { data: [{ id: "e1" }, { id: "e2" }] };
      return {};
    });

    const total = await sincronizarCronograma("a1", db);

    expect(total).toBe(2);
    expect(chamadas.some((c) => c.tabela === "execucoes" && (c.op === "insert" || c.op === "upsert" || c.op === "update"))).toBe(false);
    const del = chamadas.find((c) => c.tabela === "execucoes" && c.op === "delete");
    expect(del).toBeDefined();
    expect(filtro(del!, "eq", "automacao_id")).toBe("a1");
    expect(filtro(del!, "eq", "status")).toBe("agendada");
  });

  it("desativar e reativar: a reativação reinsere (nenhuma lápide 'cancelada' bloqueia o índice único)", async () => {
    let ativo = false;
    const { db, chamadas } = dbFalso((c) => {
      if (c.tabela === "automacoes") return { data: automacaoCronograma(ativo) };
      if (c.tabela === "execucoes" && c.op === "upsert") return { data: [{ id: "e1" }, { id: "e2" }] };
      return {};
    });

    await sincronizarCronograma("a1", db);
    ativo = true;
    const total = await sincronizarCronograma("a1", db);

    expect(total).toBe(2);
    expect(chamadas.some((c) => c.tabela === "execucoes" && c.op === "update")).toBe(false);
  });
});

describe("removerPendentes", () => {
  it("apaga as execuções agendadas da automação e devolve quantas", async () => {
    const { db, chamadas } = dbFalso((c) => (c.tabela === "execucoes" ? { data: [{ id: "e1" }] } : {}));

    const total = await removerPendentes("a1", db);

    expect(total).toBe(1);
    expect(chamadas[0].op).toBe("delete");
    expect(filtro(chamadas[0], "eq", "automacao_id")).toBe("a1");
    expect(filtro(chamadas[0], "eq", "status")).toBe("agendada");
  });

  it("apaga também as remoções da automação ainda na fila (remoção com atraso) e soma no total", async () => {
    const { db, chamadas } = dbFalso((c) => {
      if (c.tabela === "execucoes") return { data: [{ id: "e1" }] };
      if (c.tabela === "acoes") return { data: [{ id: "r1" }, { id: "r2" }] };
      return {};
    });

    const total = await removerPendentes("a1", db);

    expect(total).toBe(3);
    const acoes = chamadas.find((c) => c.tabela === "acoes")!;
    expect(acoes.op).toBe("delete");
    expect(filtro(acoes, "eq", "automacao_id")).toBe("a1");
    expect(filtro(acoes, "eq", "status")).toBe("fila");
  });

  it("erro ao apagar as remoções da fila: lança", async () => {
    const { db } = dbFalso((c) => (c.tabela === "acoes" ? { error: { message: "fora do ar" } } : {}));
    await expect(removerPendentes("a1", db)).rejects.toThrow("Não foi possível remover as remoções pendentes");
  });

  it("erro de banco: lança", async () => {
    const { db } = dbFalso(() => ({ error: { message: "fora do ar" } }));
    await expect(removerPendentes("a1", db)).rejects.toThrow("Não foi possível remover as execuções pendentes");
  });
});

describe("dispararAutomacoes", () => {
  it("lê as automações ativas da campanha/gatilho e faz upsert com onConflict e alvo_grupos do grupo", async () => {
    const { db, chamadas } = dbFalso((c) => (c.tabela === "automacoes" ? { data: [automacaoEvento("grupo_criado")] } : {}));

    const total = await dispararAutomacoes({ campanhaId: "c1", gatilho: "grupo_criado", grupoId: "g9" }, new Date("2026-10-16T12:00:00.000Z"), db);

    expect(total).toBe(1);
    const sel = chamadas.find((c) => c.tabela === "automacoes");
    expect(filtro(sel!, "eq", "campanha_id")).toBe("c1");
    expect(filtro(sel!, "eq", "gatilho")).toBe("grupo_criado");
    expect(filtro(sel!, "eq", "ativo")).toBe(true);

    const ups = chamadas.find((c) => c.tabela === "execucoes" && c.op === "upsert");
    expect(ups).toBeDefined();
    expect(ups!.opcoes).toEqual({ onConflict: "automacao_acao_id,gatilho_chave", ignoreDuplicates: true });
    const linhas = ups!.dados as { alvo_grupos: string[]; gatilho_chave: string }[];
    expect(linhas[0].alvo_grupos).toEqual(["g9"]);
    expect(linhas[0].gatilho_chave).toBe("g9");
  });

  it("sem automações ativas: não faz upsert e devolve 0", async () => {
    const { db, chamadas } = dbFalso((c) => (c.tabela === "automacoes" ? { data: [] } : {}));

    const total = await dispararAutomacoes({ campanhaId: "c1", gatilho: "grupo_cheio", grupoId: "g9" }, new Date(), db);

    expect(total).toBe(0);
    expect(chamadas.some((c) => c.op === "upsert")).toBe(false);
  });

  it("erro de banco no upsert: lança", async () => {
    const { db } = dbFalso((c) => {
      if (c.tabela === "automacoes") return { data: [automacaoEvento("grupo_criado")] };
      if (c.op === "upsert") return { error: { message: "fora do ar" } };
      return {};
    });

    await expect(dispararAutomacoes({ campanhaId: "c1", gatilho: "grupo_criado", grupoId: "g9" }, new Date(), db)).rejects.toThrow();
  });
});

const AGORA = new Date("2026-10-16T12:03:00.000Z");
const CONEXOES = [{ telefone: "5511" + "988887777" }, { telefone: null }];

function automacaoPessoa(gatilho: "entrou" | "saiu", acoes: { id: string; ordem: number; tipo: string; conteudo: unknown; atraso_min: number }[]) {
  return { id: "a3", campanha_id: "c1", gatilho, quando: null, alvo_grupos: null, ativo: true, provedor: null, produto: null, automacao_acoes: acoes };
}

const remocoes = (chamadas: Chamada[]) => chamadas.filter((c) => c.tabela === "acoes" && c.op === "insert").map((c) => c.dados as Record<string, string>);

describe("dispararPorPessoas: entrou", () => {
  const acoes = [
    { id: "msg", ordem: 1, tipo: "mensagem", conteudo: { formato: "texto", texto: "Bem-vindo" }, atraso_min: 0 },
    { id: "rem", ordem: 2, tipo: "remover_participante", conteudo: {}, atraso_min: 5 },
  ];

  it("agenda a mensagem do grupo (bloco de 10 min) e remove cada um, menos o número conectado (com ou sem nono dígito)", async () => {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "automacoes") return { data: [automacaoPessoa("entrou", acoes)] };
      if (c.tabela === "conexoes") return { data: CONEXOES };
      return {};
    });

    const total = await dispararPorPessoas({ campanhaId: "c1", gatilho: "entrou", grupoId: "g1", telefones: ["5511" + "900000001", "551188887777"] }, AGORA, db);

    const sel = chamadas.find((c) => c.tabela === "automacoes")!;
    expect(filtro(sel, "eq", "campanha_id")).toBe("c1");
    expect(filtro(sel, "eq", "gatilho")).toBe("entrou");
    expect(filtro(sel, "eq", "ativo")).toBe(true);
    const ups = chamadas.find((c) => c.tabela === "execucoes" && c.op === "upsert")!;
    expect(ups.opcoes).toEqual({ onConflict: "automacao_acao_id,gatilho_chave", ignoreDuplicates: true });
    expect(ups.dados).toEqual([expect.objectContaining({ automacao_acao_id: "msg", alvo_grupos: ["g1"], gatilho_chave: "g1:2026-10-16T12:00:00.000Z" })]);
    expect(remocoes(chamadas)).toEqual([
      expect.objectContaining({ tipo: "remover", grupo_id: "g1", telefone: "5511" + "900000001", origem: "automacao", automacao_acao_id: "rem", executar_apos: "2026-10-16T12:08:00.000Z", gatilho_chave: "g1:5511" + "900000001:2026-10-16T12:03:00.000Z" }),
    ]);
    expect(total).toBe(2);
  });

  it("remoção já na fila (23505) não é erro e não conexão", async () => {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "automacoes") return { data: [automacaoPessoa("entrou", [acoes[1]])] };
      if (c.tabela === "conexoes") return { data: [] };
      if (c.tabela === "acoes" && (c.dados as { telefone: string }).telefone === "5511" + "900000001") return { error: { message: "duplicate", code: "23505" } };
      return {};
    });

    const total = await dispararPorPessoas({ campanhaId: "c1", gatilho: "entrou", grupoId: "g1", telefones: ["5511" + "900000001", "5511" + "900000002"] }, AGORA, db);

    expect(remocoes(chamadas)).toHaveLength(2);
    expect(total).toBe(1);
    expect(chamadas.some((c) => c.tabela === "execucoes")).toBe(false);
  });

  it("só entrou número conectado: nada é agendado", async () => {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "automacoes") return { data: [automacaoPessoa("entrou", acoes)] };
      if (c.tabela === "conexoes") return { data: CONEXOES };
      return {};
    });

    expect(await dispararPorPessoas({ campanhaId: "c1", gatilho: "entrou", grupoId: "g1", telefones: ["5511" + "988887777"] }, AGORA, db)).toBe(0);
    expect(chamadas.some((c) => c.op === "insert" || c.op === "upsert")).toBe(false);
  });

  it("sem automações: não lê as conexões e devolve 0", async () => {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => (c.tabela === "automacoes" ? { data: [] } : {}));
    expect(await dispararPorPessoas({ campanhaId: "c1", gatilho: "entrou", grupoId: "g1", telefones: ["5511" + "900000001"] }, AGORA, db)).toBe(0);
    expect(chamadas.map((c) => c.tabela)).toEqual(["automacoes"]);
  });

  it("erro ao enfileirar remoção (que não é 23505): lança", async () => {
    const { db } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "automacoes") return { data: [automacaoPessoa("entrou", [acoes[1]])] };
      if (c.tabela === "conexoes") return { data: [] };
      if (c.tabela === "acoes") return { error: { message: "fora do ar" } };
      return {};
    });
    await expect(dispararPorPessoas({ campanhaId: "c1", gatilho: "entrou", grupoId: "g1", telefones: ["5511" + "900000001"] }, AGORA, db)).rejects.toThrow("fora do ar");
  });

  it("erro ao ler as automações: lança", async () => {
    const { db } = dbFalso(() => ({ error: { message: "fora do ar" } }));
    await expect(dispararPorPessoas({ campanhaId: "c1", gatilho: "entrou", grupoId: "g1", telefones: ["5511" + "900000001"] }, AGORA, db)).rejects.toThrow("Não foi possível ler as automações");
  });
});

describe("dispararPorPessoas: saiu", () => {
  const acoes = [{ id: "rem", ordem: 1, tipo: "remover_participante", conteudo: {}, atraso_min: 0 }];

  it("remove quem saiu dos outros grupos ativos da campanha (sem admin, com variantes do telefone)", async () => {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "automacoes") return { data: [automacaoPessoa("saiu", acoes)] };
      if (c.tabela === "conexoes") return { data: CONEXOES };
      if (c.tabela === "participantes") return { data: [{ telefone: "551100000001", grupo_id: "g2" }, { telefone: "5511" + "900000001", grupo_id: "g3" }] };
      return {};
    });

    const total = await dispararPorPessoas({ campanhaId: "c1", gatilho: "saiu", grupoId: "g1", telefones: ["5511" + "900000001"] }, AGORA, db);

    const sel = chamadas.find((c) => c.tabela === "participantes")!;
    expect(filtro(sel, "in", "telefone")).toEqual(["5511" + "900000001", "551100000001"]);
    expect(filtro(sel, "is", "saiu_em")).toBeNull();
    expect(filtro(sel, "eq", "admin")).toBe(false);
    expect(filtro(sel, "eq", "grupos.campanha_id")).toBe("c1");
    expect(filtro(sel, "eq", "grupos.ativo")).toBe(true);
    expect(filtro(sel, "neq", "grupo_id")).toBe("g1");
    expect(remocoes(chamadas)).toEqual([
      expect.objectContaining({ grupo_id: "g2", telefone: "551100000001", gatilho_chave: "saiu:g1:5511" + "900000001:2026-10-16T12:03:00.000Z:g2" }),
      expect.objectContaining({ grupo_id: "g3", telefone: "5511" + "900000001", gatilho_chave: "saiu:g1:5511" + "900000001:2026-10-16T12:03:00.000Z:g3" }),
    ]);
    expect(total).toBe(2);
  });

  it("número conectado que saiu não é removido de nada", async () => {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "automacoes") return { data: [automacaoPessoa("saiu", acoes)] };
      if (c.tabela === "conexoes") return { data: CONEXOES };
      if (c.tabela === "participantes") return { data: [{ telefone: "5511" + "988887777", grupo_id: "g2" }] };
      return {};
    });
    expect(await dispararPorPessoas({ campanhaId: "c1", gatilho: "saiu", grupoId: "g1", telefones: ["5511" + "988887777"] }, AGORA, db)).toBe(0);
    expect(remocoes(chamadas)).toHaveLength(0);
  });

  it("erro ao ler participações: lança", async () => {
    const { db } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "automacoes") return { data: [automacaoPessoa("saiu", acoes)] };
      if (c.tabela === "conexoes") return { data: [] };
      if (c.tabela === "participantes") return { error: { message: "fora do ar" } };
      return {};
    });
    await expect(dispararPorPessoas({ campanhaId: "c1", gatilho: "saiu", grupoId: "g1", telefones: ["5511" + "900000001"] }, AGORA, db)).rejects.toThrow("fora do ar");
  });
});

describe("dispararCheckout", () => {
  const automacao = (produto: string) => ({
    id: "a4", campanha_id: "c1", gatilho: "checkout", quando: null, alvo_grupos: null, ativo: true, provedor: "hotmart", produto,
    automacao_acoes: [{ id: "rem", ordem: 1, tipo: "remover_participante", conteudo: {}, atraso_min: 10 }],
  });

  it("produto casa: remove o comprador de todos os grupos ativos da campanha", async () => {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "automacoes") return { data: [automacao("Curso IA")] };
      if (c.tabela === "conexoes") return { data: CONEXOES };
      if (c.tabela === "participantes") return { data: [{ telefone: "5511" + "900000001", grupo_id: "g1" }, { telefone: "5511" + "900000001", grupo_id: "g2" }] };
      return {};
    });

    const total = await dispararCheckout({ vendaId: "v1", provedor: "hotmart", produtos: ["curso ia"], telefone: "5511" + "900000001" }, AGORA, db);

    const sel = chamadas.find((c) => c.tabela === "automacoes")!;
    expect(filtro(sel, "eq", "gatilho")).toBe("checkout");
    // Etapa 3F: a da plataforma da venda + a de qualquer plataforma (provedor null).
    expect(sel.filtros).toContainEqual(["or", "provedor.eq.hotmart,provedor.is.null"]);
    expect(filtro(sel, "eq", "ativo")).toBe(true);
    const part = chamadas.find((c) => c.tabela === "participantes")!;
    expect(filtro(part, "in", "telefone")).toEqual(["5511" + "900000001", "551100000001"]);
    expect(filtro(part, "eq", "admin")).toBe(false);
    expect(filtro(part, "eq", "grupos.campanha_id")).toBe("c1");
    expect(filtro(part, "eq", "grupos.ativo")).toBe(true);
    expect(remocoes(chamadas)).toEqual([
      expect.objectContaining({ grupo_id: "g1", gatilho_chave: "venda:v1:g1", executar_apos: "2026-10-16T12:13:00.000Z", origem: "automacao", automacao_id: "a4" }),
      expect.objectContaining({ grupo_id: "g2", gatilho_chave: "venda:v1:g2" }),
    ]);
    expect(total).toBe(2);
  });

  it("produto não casa: nada é lido nem enfileirado", async () => {
    const { db, chamadas } = dbFalso((c: Chamada): Resposta => (c.tabela === "automacoes" ? { data: [automacao("Outro")] } : {}));
    expect(await dispararCheckout({ vendaId: "v1", provedor: "hotmart", produtos: ["Curso IA"], telefone: "5511" + "900000001" }, AGORA, db)).toBe(0);
    expect(chamadas.map((c) => c.tabela)).toEqual(["automacoes"]);
  });

  it("erro de banco: lança", async () => {
    const { db } = dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "automacoes") return { data: [automacao("Curso IA")] };
      if (c.tabela === "conexoes") return { error: { message: "fora do ar" } };
      return {};
    });
    await expect(dispararCheckout({ vendaId: "v1", provedor: "hotmart", produtos: ["Curso IA"], telefone: "5511" + "900000001" }, AGORA, db)).rejects.toThrow("fora do ar");
  });
});
