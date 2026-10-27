import { describe, expect, it } from "vitest";
import { aplicarAcoesDePessoa, dispararCheckout, dispararPorPessoas } from "@/src/lib/automacoes";
import { pendenciaDoPasso, type EstadoAssistente } from "@/src/lib/regras/assistente-automacao";
import {
  acoesPermitidas,
  alvoDaAcaoDePessoa,
  entradaDoImportJson,
  ICONE_ACAO_AUTOMACAO,
  linhasCheckout,
  linhasDoCronograma,
  linhasDoEvento,
  linhasEntrou,
  linhasSaiu,
  textoAcaoDePessoa,
  TIPOS_ACAO_AUTOMACAO,
  TIPOS_ACAO_PESSOA,
  validarAutomacao,
  type AcaoAutomacao,
  type EntradaAutomacao,
} from "@/src/lib/regras/automacoes";
import { planoDaRodada } from "@/src/lib/regras/pessoas";
import { dbFalso, filtro, type Chamada, type Resposta } from "./apoio/db-falso";

// Etapa 3J, Tarefa 4: ações de pessoa nas automações ("Remover Lead", tags, blacklist). As 4 ações novas são
// aplicadas na hora pelo motor (sem execução nem remoção), idempotentes, depois da Tag Condicional de cada pessoa.

const AGORA = new Date("2026-10-17T12:03:00.000Z");
const CAMP = "11111111-1111-4111-8111-111111111111";
const TAG = "44444444-4444-4444-8444-444444444444";
const TAG_COND = "55555555-5555-4555-8555-555555555555";
const LISTA = "77777777-7777-4777-8777-777777777777";
const P1 = "5511" + "900000001";
const P2 = "5511" + "900000002";
const CONECTADO = "5511" + "988887777";

const base: EntradaAutomacao = {
  nome: "A", campanha_id: CAMP, gatilho: "entrou", quando: null, alvo_grupos: null, pasta: null, provedor: null, produto: null,
  acoes: [{ tipo: "adicionar_tag", conteudo: { tag_id: TAG }, atraso_min: 0 }],
};

// ---------------------------------------------------------------- regras

describe("regras: ações de pessoa", () => {
  it("TIPOS_ACAO_AUTOMACAO mantém os 15 de antes e ganha os 4", () => {
    expect(TIPOS_ACAO_AUTOMACAO.slice(0, 15)).toEqual([
      "mensagem", "enquete", "nome", "descricao", "abrir", "fechar", "admin_add", "admin_remover", "redefinir_link", "remover_participante",
      "configuracao", "atualizar_links", "desativar_comunidade", "mover_grupos", "tag_condicional",
    ]);
    expect(TIPOS_ACAO_PESSOA).toEqual(["adicionar_tag", "remover_tag", "adicionar_blacklist", "remover_blacklist"]);
    expect(TIPOS_ACAO_AUTOMACAO.slice(15, 19)).toEqual([...TIPOS_ACAO_PESSOA]);
    // Etapa 3M: "Atualizar foto do grupo" entra depois, sem mexer na ordem de antes.
    expect(TIPOS_ACAO_AUTOMACAO.slice(19)).toEqual(["imagem"]);
  });

  it("ícones (Remover Lead, tags, blacklist) e um ícone pra cada ação", () => {
    expect(ICONE_ACAO_AUTOMACAO).toMatchObject({
      remover_participante: "person_remove",
      adicionar_tag: "label",
      remover_tag: "label_off",
      adicionar_blacklist: "block",
      remover_blacklist: "check_circle_outline",
    });
    expect(Object.keys(ICONE_ACAO_AUTOMACAO).sort()).toEqual([...TIPOS_ACAO_AUTOMACAO].sort());
  });

  it("permitidas: só nos gatilhos de pessoa; 'Mover grupos' fica só nos de grupo", () => {
    for (const g of ["entrou", "saiu", "checkout"] as const) {
      for (const t of TIPOS_ACAO_PESSOA) expect(acoesPermitidas(g)).toContain(t);
      expect(acoesPermitidas(g)).not.toContain("mover_grupos");
    }
    expect(acoesPermitidas("saiu")).not.toContain("mensagem");
    expect(acoesPermitidas("checkout")).not.toContain("mensagem");
    for (const g of ["cronograma", "grupo_criado", "grupo_cheio"] as const) {
      for (const t of TIPOS_ACAO_PESSOA) expect(acoesPermitidas(g)).not.toContain(t);
    }
  });

  it("valida: guarda só o id, atraso 0; atraso recusado; sem id recusado", () => {
    const r = validarAutomacao({
      ...base,
      acoes: [
        { tipo: "adicionar_tag", conteudo: { tag_id: TAG, lixo: 1 }, atraso_min: 0 },
        { tipo: "remover_tag", conteudo: { tag_id: TAG }, atraso_min: 0 },
        { tipo: "adicionar_blacklist", conteudo: { blacklist_id: LISTA, x: 2 }, atraso_min: 0 },
        { tipo: "remover_blacklist", conteudo: { blacklist_id: LISTA }, atraso_min: 0 },
      ],
    }, AGORA);
    expect(r.ok && r.valor.acoes).toEqual([
      { tipo: "adicionar_tag", conteudo: { tag_id: TAG }, atraso_min: 0 },
      { tipo: "remover_tag", conteudo: { tag_id: TAG }, atraso_min: 0 },
      { tipo: "adicionar_blacklist", conteudo: { blacklist_id: LISTA }, atraso_min: 0 },
      { tipo: "remover_blacklist", conteudo: { blacklist_id: LISTA }, atraso_min: 0 },
    ]);
    expect(validarAutomacao({ ...base, acoes: [{ tipo: "adicionar_tag", conteudo: { tag_id: TAG }, atraso_min: 5 }] }, AGORA))
      .toEqual({ ok: false, erro: "Ação 1: Adicionar tag é aplicada na hora, sem atraso." });
    expect(validarAutomacao({ ...base, gatilho: "saiu", acoes: [{ tipo: "adicionar_blacklist", conteudo: { blacklist_id: LISTA }, atraso_min: 1 }] }, AGORA).ok).toBe(false);
    expect(validarAutomacao({ ...base, acoes: [{ tipo: "adicionar_tag", conteudo: {}, atraso_min: 0 }] }, AGORA)).toEqual({ ok: false, erro: "Ação 1: Escolha a tag." });
    expect(validarAutomacao({ ...base, acoes: [{ tipo: "remover_blacklist", conteudo: { tag_id: TAG }, atraso_min: 0 }] }, AGORA)).toEqual({ ok: false, erro: "Ação 1: Escolha a blacklist." });
  });

  it("valida: recusa nos gatilhos de grupo", () => {
    const r = validarAutomacao({ ...base, gatilho: "grupo_criado", acoes: [{ tipo: "adicionar_tag", conteudo: { tag_id: TAG }, atraso_min: 0 }] }, AGORA);
    expect(r).toEqual({ ok: false, erro: "Ação 1: não vale para este gatilho." });
  });

  it("valida: Tag Condicional antes de uma ação de pessoa vale no entrou (é da pessoa, não do grupo)", () => {
    const acoes: AcaoAutomacao[] = [{ tipo: "tag_condicional", conteudo: { tag_id: TAG_COND, tem: true }, atraso_min: 0 }, { tipo: "adicionar_blacklist", conteudo: { blacklist_id: LISTA }, atraso_min: 0 }];
    expect(validarAutomacao({ ...base, acoes }, AGORA).ok).toBe(true);
  });

  it("importar JSON com atraso numa ação de pessoa: recusado pela mesma validação", () => {
    const e = entradaDoImportJson({ versao: 1, nome: "x", gatilho: "checkout", produto: "Curso", acoes: [{ tipo: "adicionar_tag", conteudo: { tag_id: TAG }, ordem: 0, atraso: 10 }] }, CAMP);
    expect(e.ok && validarAutomacao(e.valor, AGORA)).toEqual({ ok: false, erro: "Ação 1: Adicionar tag é aplicada na hora, sem atraso." });
  });

  it("nunca viram execução nem remoção", () => {
    const acoes = TIPOS_ACAO_PESSOA.map((tipo, i) => ({ id: `p${i}`, tipo, conteudo: { tag_id: TAG, blacklist_id: LISTA }, atraso_min: 0 }));
    const a = { id: "a1", campanha_id: CAMP };
    expect(linhasDoCronograma({ ...a, quando: AGORA.toISOString(), alvo_grupos: null }, acoes)).toEqual([]);
    expect(linhasDoEvento(a, acoes, "g1", AGORA)).toEqual([]);
    expect(linhasEntrou(a, acoes, "g1", [P1], AGORA)).toEqual({ execucoes: [], remocoes: [] });
    expect(linhasSaiu(a, acoes, P1, [{ grupoId: "g2", telefone: P1 }], "g1", AGORA)).toEqual([]);
    expect(linhasCheckout(a, acoes, "v1", [{ grupoId: "g2", telefone: P1 }], AGORA)).toEqual([]);
  });

  it("alvo e texto da confirmação/lista", () => {
    expect(alvoDaAcaoDePessoa({ tipo: "adicionar_tag", conteudo: { tag_id: TAG } })).toEqual({ tipo: "tag", id: TAG });
    expect(alvoDaAcaoDePessoa({ tipo: "remover_blacklist", conteudo: { blacklist_id: LISTA } })).toEqual({ tipo: "blacklist", id: LISTA });
    expect(alvoDaAcaoDePessoa({ tipo: "adicionar_tag", conteudo: { tag_id: "" } })).toBeNull();
    expect(alvoDaAcaoDePessoa({ tipo: "mensagem", conteudo: { tag_id: TAG } })).toBeNull();
    expect(textoAcaoDePessoa("adicionar_tag", "VIP")).toBe("Adicionar tag: VIP");
    expect(textoAcaoDePessoa("adicionar_blacklist", "Golpistas")).toBe("Adicionar à blacklist: Golpistas");
    expect(textoAcaoDePessoa("remover_tag", null)).toBe("Remover tag: (apagada)");
  });

  it("assistente: passo Ação pede a tag/blacklist e recusa atraso", () => {
    const estado = (acoes: EstadoAssistente["acoes"]): EstadoAssistente => ({
      categoria: "campanha", campanhaId: CAMP, gatilho: "saiu", quando: "", todosGrupos: true, grupos: [], todasContas: true, contas: [],
      provedor: null, produto: "", acoes, nome: "", pasta: "",
    });
    const ctx = { ativosDaCampanha: [] };
    expect(pendenciaDoPasso("acao", estado([{ chave: "a", tipo: "adicionar_tag", conteudo: { tag_id: "" }, atraso_min: 0 }]), ctx)).toBe("Ação 1: Escolha a tag.");
    expect(pendenciaDoPasso("acao", estado([{ chave: "a", tipo: "adicionar_blacklist", conteudo: { blacklist_id: LISTA }, atraso_min: 3 }]), ctx)).toBe("Ação 1: Adicionar à blacklist é aplicada na hora, sem atraso.");
    expect(pendenciaDoPasso("acao", estado([{ chave: "a", tipo: "remover_blacklist", conteudo: { blacklist_id: LISTA }, atraso_min: 0 }]), ctx)).toBeNull();
  });

  it("blacklist não tira admin nem número conectado: a remoção do anti-spam só vale pra candidatos da rodada", () => {
    const plano = planoDaRodada({
      grupoId: "g1",
      entraram: [{ telefone: P1, admin: true }, { telefone: CONECTADO, admin: false }, { telefone: P2, admin: false }],
      sairam: [],
      protegidos: [CONECTADO],
      bloqueados: [P1, CONECTADO, P2],
      abertos: [],
      pendentes: [],
    });
    expect(plano.removerBloqueio).toEqual([P2]);
  });
});

// ---------------------------------------------------------------- motor

type Acao = { id: string; ordem: number; tipo: string; conteudo: unknown; atraso_min: number };
const auto = (gatilho: string, acoes: Acao[], extra: Record<string, unknown> = {}) => ({
  id: "a1", campanha_id: "c1", gatilho, quando: null, alvo_grupos: null, ativo: true, provedor: null, produto: null, automacao_acoes: acoes, ...extra,
});
const addTag: Acao = { id: "addTag", ordem: 2, tipo: "adicionar_tag", conteudo: { tag_id: TAG }, atraso_min: 0 };
const tirarTag: Acao = { id: "tirarTag", ordem: 3, tipo: "remover_tag", conteudo: { tag_id: TAG }, atraso_min: 0 };
const addLista: Acao = { id: "addLista", ordem: 4, tipo: "adicionar_blacklist", conteudo: { blacklist_id: LISTA }, atraso_min: 0 };
const tirarLista: Acao = { id: "tirarLista", ordem: 5, tipo: "remover_blacklist", conteudo: { blacklist_id: LISTA }, atraso_min: 0 };
const msg: Acao = { id: "msg", ordem: 1, tipo: "mensagem", conteudo: { formato: "texto", texto: "Oi" }, atraso_min: 0 };
const rem: Acao = { id: "rem", ordem: 6, tipo: "remover_participante", conteudo: {}, atraso_min: 0 };
const cond = (tem: boolean): Acao => ({ id: "cond", ordem: 1, tipo: "tag_condicional", conteudo: { tag_id: TAG_COND, tem }, atraso_min: 0 });

type Mundo = {
  automacoes?: unknown;
  /** Tags manuais existentes (as que a consulta `tags ... tipo = manual` devolve). */
  manuais?: string[];
  blacklists?: string[];
  pessoaTags?: { telefone: string; tag_id: string; campanha_id: string | null }[];
  participantes?: { telefone: string; grupo_id: string }[];
  extra?: (c: Chamada) => Resposta | null;
};

function mundo(m: Mundo) {
  return dbFalso((c) => {
    const r = m.extra?.(c);
    if (r) return r;
    if (c.tabela === "automacoes") return { data: m.automacoes ?? [] };
    if (c.tabela === "conexoes") return { data: [{ telefone: CONECTADO }] };
    if (c.tabela === "tags") {
      const ids = filtro(c, "in", "id") as string[];
      return { data: (m.manuais ?? [TAG]).filter((t) => ids.includes(t)).map((id) => ({ id })) };
    }
    if (c.tabela === "blacklists") {
      const ids = filtro(c, "in", "id") as string[];
      return { data: (m.blacklists ?? [LISTA]).filter((b) => ids.includes(b)).map((id) => ({ id })) };
    }
    if (c.tabela === "pessoa_tags") {
      const ids = filtro(c, "in", "tag_id") as string[];
      const tels = filtro(c, "in", "telefone") as string[];
      return { data: (m.pessoaTags ?? []).filter((t) => ids.includes(t.tag_id) && tels.includes(t.telefone)) };
    }
    if (c.tabela === "participantes") return { data: m.participantes ?? [] };
    return {};
  });
}

const rpcs = (ch: Chamada[]) => ch.filter((c) => c.tabela.startsWith("rpc:")).map((c) => ({ rpc: c.tabela.slice(4), ...(c.dados as object) }));
const naLista = (ch: Chamada[]) => ch.filter((c) => c.tabela === "blacklist_numeros");
const escritas = (ch: Chamada[]) => ch.filter((c) => c.op !== "select" || c.tabela.startsWith("rpc:"));

describe("aplicarAcoesDePessoa", () => {
  it("tag: por_tag/tirar_tag do telefone (campanha null); só tag manual (confere tipo no banco)", async () => {
    const { db, chamadas } = mundo({});
    expect(await aplicarAcoesDePessoa(db, [addTag, tirarTag], [P1, P2, P1], "c1", new Set())).toBe(2);
    const sel = chamadas.find((c) => c.tabela === "tags")!;
    expect(filtro(sel, "eq", "tipo")).toBe("manual");
    expect(rpcs(chamadas)).toEqual([
      { rpc: "por_tag", p_telefones: [P1, P2], p_tag: TAG, p_campanha: null },
      { rpc: "tirar_tag", p_telefones: [P1, P2], p_tag: TAG, p_campanha: null },
    ]);
  });

  it("tag que não é manual (ou apagada): pulada sem erro", async () => {
    const { db, chamadas } = mundo({ manuais: [] });
    expect(await aplicarAcoesDePessoa(db, [addTag], [P1], "c1", new Set())).toBe(0);
    expect(rpcs(chamadas)).toEqual([]);
  });

  it("blacklist: insert com on conflict do nothing (só telefone que passa no check); remover apaga as variantes", async () => {
    const { db, chamadas } = mundo({});
    expect(await aplicarAcoesDePessoa(db, [addLista, tirarLista], [P1, "123", "+5511"], "c1", new Set())).toBe(2);
    const [ins, del] = naLista(chamadas);
    expect(ins.op).toBe("upsert");
    expect(ins.dados).toEqual([{ blacklist_id: LISTA, telefone: P1 }]);
    expect(ins.opcoes).toEqual({ onConflict: "blacklist_id,telefone", ignoreDuplicates: true });
    expect(del.op).toBe("delete");
    expect(filtro(del, "eq", "blacklist_id")).toBe(LISTA);
    expect(filtro(del, "in", "telefone")).toEqual(expect.arrayContaining([P1, "551100000001"]));
  });

  it("blacklist apagada: pulada sem erro", async () => {
    const { db, chamadas } = mundo({ blacklists: [] });
    expect(await aplicarAcoesDePessoa(db, [addLista], [P1], "c1", new Set())).toBe(0);
    expect(naLista(chamadas)).toEqual([]);
  });

  it("admin (participação aberta, em qualquer variante do telefone) nunca entra na blacklist por automação", async () => {
    // P1 = "55119 00000001" (com 9º dígito); a linha de admin vem gravada sem ele ("551100000001") — mesma pessoa.
    const { db, chamadas } = mundo({ participantes: [{ telefone: "551100000001", grupo_id: "g1" }] });
    expect(await aplicarAcoesDePessoa(db, [addLista], [P1, P2], "c1", new Set())).toBe(1);
    expect(naLista(chamadas)[0].dados).toEqual([{ blacklist_id: LISTA, telefone: P2 }]);
  });

  it("blacklist com todos admins: nada inserido (ação não conexão como aplicada)", async () => {
    const { db, chamadas } = mundo({ participantes: [{ telefone: P1, grupo_id: "g1" }] });
    expect(await aplicarAcoesDePessoa(db, [addLista], [P1], "c1", new Set())).toBe(0);
    expect(naLista(chamadas)).toEqual([]);
  });

  it("remover da blacklist não confere admin (só adicionar protege)", async () => {
    const { db, chamadas } = mundo({ participantes: [{ telefone: P1, grupo_id: "g1" }] });
    expect(await aplicarAcoesDePessoa(db, [tirarLista], [P1], "c1", new Set())).toBe(1);
    expect(naLista(chamadas)[0].op).toBe("delete");
  });

  it("ação de tag não consulta participantes (admin só importa pra blacklist)", async () => {
    const { db, chamadas } = mundo({});
    await aplicarAcoesDePessoa(db, [addTag], [P1], "c1", new Set());
    expect(chamadas.some((c) => c.tabela === "participantes")).toBe(false);
  });

  it("número conectado nunca entra em blacklist nem ganha tag (nas duas formas do nono dígito)", async () => {
    const { db, chamadas } = mundo({});
    // Sem `protegidos`: lê as conexões. O conectado está gravado com 9; chega sem.
    expect(await aplicarAcoesDePessoa(db, [addLista, addTag], ["551188887777"], "c1")).toBe(0);
    expect(naLista(chamadas)).toEqual([]);
    expect(rpcs(chamadas)).toEqual([]);
    const outro = mundo({});
    await aplicarAcoesDePessoa(outro.db, [addLista], [CONECTADO, P1], "c1");
    expect(naLista(outro.chamadas)[0].dados).toEqual([{ blacklist_id: LISTA, telefone: P1 }]);
  });

  it("idempotente: o mesmo disparo de novo faz exatamente as mesmas chamadas (todas sem efeito na 2ª vez)", async () => {
    const a = mundo({});
    const b = mundo({});
    await aplicarAcoesDePessoa(a.db, [addTag, addLista, tirarLista], [P1], "c1", new Set());
    await aplicarAcoesDePessoa(b.db, [addTag, addLista, tirarLista], [P1], "c1", new Set());
    expect(escritas(b.chamadas)).toEqual(escritas(a.chamadas));
  });

  it("erro do banco: lança (a conferência alerta; a venda tenta de novo)", async () => {
    const { db } = mundo({ extra: (c) => (c.tabela === "blacklist_numeros" ? { error: { message: "fora" } } : null) });
    await expect(aplicarAcoesDePessoa(db, [addLista], [P1], "c1", new Set())).rejects.toThrow(/blacklist: fora/);
  });
});

describe("motor: gatilhos de pessoa", () => {
  it("entrou: aplica tag e blacklist a quem entrou (menos o número conectado), sem mudar mensagem/remoção", async () => {
    const { db, chamadas } = mundo({ automacoes: [auto("entrou", [msg, addTag, addLista, rem])] });
    expect(await dispararPorPessoas({ campanhaId: "c1", gatilho: "entrou", grupoId: "g1", telefones: [P1, CONECTADO] }, AGORA, db)).toBe(2);
    expect(rpcs(chamadas)).toEqual([{ rpc: "por_tag", p_telefones: [P1], p_tag: TAG, p_campanha: null }]);
    expect(naLista(chamadas)[0].dados).toEqual([{ blacklist_id: LISTA, telefone: P1 }]);
    expect(chamadas.filter((c) => c.tabela === "acoes" && c.op === "insert").map((c) => (c.dados as { telefone: string }).telefone)).toEqual([P1]);
  });

  it("entrou com Tag Condicional: só quem passa ganha a tag", async () => {
    const { db, chamadas } = mundo({ automacoes: [auto("entrou", [cond(true), addTag])], pessoaTags: [{ telefone: P2, tag_id: TAG_COND, campanha_id: null }] });
    await dispararPorPessoas({ campanhaId: "c1", gatilho: "entrou", grupoId: "g1", telefones: [P1, P2] }, AGORA, db);
    expect(rpcs(chamadas)).toEqual([{ rpc: "por_tag", p_telefones: [P2], p_tag: TAG, p_campanha: null }]);
  });

  it("entrou com Tag Condicional que ninguém passa: nada", async () => {
    const { db, chamadas } = mundo({ automacoes: [auto("entrou", [cond(false), addLista])], pessoaTags: [{ telefone: P1, tag_id: TAG_COND, campanha_id: null }] });
    await dispararPorPessoas({ campanhaId: "c1", gatilho: "entrou", grupoId: "g1", telefones: [P1] }, AGORA, db);
    expect(naLista(chamadas)).toEqual([]);
  });

  it("saiu só com ações de pessoa (sem Remover Lead): aplica, sem ler participações pro atalho antigo (só a conferência de admin da blacklist)", async () => {
    const { db, chamadas } = mundo({ automacoes: [auto("saiu", [addTag, addLista])] });
    expect(await dispararPorPessoas({ campanhaId: "c1", gatilho: "saiu", grupoId: "g1", telefones: [P1] }, AGORA, db)).toBe(0);
    expect(rpcs(chamadas)).toEqual([{ rpc: "por_tag", p_telefones: [P1], p_tag: TAG, p_campanha: null }]);
    expect(naLista(chamadas)).toHaveLength(1);
    // "participantes" só aparece pela conferência de admin (adicionar_blacklist), nunca pelo atalho antigo
    // (participacoesAbertas, que juntaria com `grupos` e nunca rodou aqui: não há Remover Lead).
    const participantes = chamadas.filter((c) => c.tabela === "participantes");
    expect(participantes).toHaveLength(1);
    expect(filtro(participantes[0], "eq", "admin")).toBe(true);
  });

  it("saiu com Remover Lead e tag, sem outros grupos: a tag vale mesmo assim", async () => {
    const { db, chamadas } = mundo({ automacoes: [auto("saiu", [rem, addTag])], participantes: [] });
    await dispararPorPessoas({ campanhaId: "c1", gatilho: "saiu", grupoId: "g1", telefones: [P1] }, AGORA, db);
    expect(rpcs(chamadas)).toHaveLength(1);
    expect(chamadas.some((c) => c.tabela === "acoes")).toBe(false);
  });

  it("saiu com Tag Condicional que falha: nem tag nem blacklist", async () => {
    const { db, chamadas } = mundo({ automacoes: [auto("saiu", [cond(true), addTag, addLista])] });
    await dispararPorPessoas({ campanhaId: "c1", gatilho: "saiu", grupoId: "g1", telefones: [P1] }, AGORA, db);
    expect(rpcs(chamadas)).toEqual([]);
    expect(naLista(chamadas)).toEqual([]);
  });

  it("checkout só com ações de pessoa: aplica (o atalho antigo pulava sem Remover Lead), total = remoções (0)", async () => {
    const { db, chamadas } = mundo({ automacoes: [auto("checkout", [addTag, addLista], { provedor: "hotmart", produto: "Curso" })] });
    expect(await dispararCheckout({ vendaId: "v1", provedor: "hotmart", produtos: ["Curso"], telefone: P1 }, AGORA, db)).toBe(0);
    expect(rpcs(chamadas)).toEqual([{ rpc: "por_tag", p_telefones: [P1], p_tag: TAG, p_campanha: null }]);
    expect(naLista(chamadas)[0].dados).toEqual([{ blacklist_id: LISTA, telefone: P1 }]);
  });

  it("checkout de número conectado: nada (nem blacklist)", async () => {
    const { db, chamadas } = mundo({ automacoes: [auto("checkout", [addLista], { provedor: "hotmart", produto: "Curso" })] });
    expect(await dispararCheckout({ vendaId: "v1", provedor: "hotmart", produtos: ["Curso"], telefone: CONECTADO }, AGORA, db)).toBe(0);
    expect(naLista(chamadas)).toEqual([]);
  });

  it("checkout com Tag Condicional: respeita a condição antes das ações de pessoa", async () => {
    const autos = [auto("checkout", [cond(true), addTag, rem], { provedor: "hotmart", produto: "Curso" })];
    const falha = mundo({ automacoes: autos, participantes: [{ telefone: P1, grupo_id: "g2" }] });
    await dispararCheckout({ vendaId: "v1", provedor: "hotmart", produtos: ["Curso"], telefone: P1 }, AGORA, falha.db);
    expect(rpcs(falha.chamadas)).toEqual([]);
    const passa = mundo({ automacoes: autos, participantes: [{ telefone: P1, grupo_id: "g2" }], pessoaTags: [{ telefone: P1, tag_id: TAG_COND, campanha_id: null }] });
    expect(await dispararCheckout({ vendaId: "v1", provedor: "hotmart", produtos: ["Curso"], telefone: P1 }, AGORA, passa.db)).toBe(1);
    expect(rpcs(passa.chamadas)).toEqual([{ rpc: "por_tag", p_telefones: [P1], p_tag: TAG, p_campanha: null }]);
  });

  it("checkout repetido (retry da venda): as mesmas chamadas, nada novo", async () => {
    const autos = [auto("checkout", [addTag, addLista], { provedor: "hotmart", produto: "Curso" })];
    const a = mundo({ automacoes: autos });
    const b = mundo({ automacoes: autos });
    await dispararCheckout({ vendaId: "v1", provedor: "hotmart", produtos: ["Curso"], telefone: P1 }, AGORA, a.db);
    await dispararCheckout({ vendaId: "v1", provedor: "hotmart", produtos: ["Curso"], telefone: P1 }, AGORA, b.db);
    expect(escritas(b.chamadas)).toEqual(escritas(a.chamadas));
  });
});

describe("regressão: automações sem ações de pessoa criam as mesmas linhas de antes e não tocam tag/blacklist", () => {
  const nada = (ch: Chamada[]) => ch.some((c) => c.tabela === "tags" || c.tabela === "blacklists" || c.tabela === "blacklist_numeros" || c.tabela.startsWith("rpc:"));

  it("entrou (mensagem + Remover Lead)", async () => {
    const { db, chamadas } = mundo({ automacoes: [auto("entrou", [msg, rem])] });
    expect(await dispararPorPessoas({ campanhaId: "c1", gatilho: "entrou", grupoId: "g1", telefones: [P1, P2] }, AGORA, db)).toBe(3);
    expect(nada(chamadas)).toBe(false);
    expect(chamadas.filter((c) => c.tabela === "execucoes").flatMap((c) => c.dados as object[])).toEqual([
      { campanha_id: "c1", origem: "automacao", tipo: "mensagem", conteudo: msg.conteudo, alvo_grupos: ["g1"], alvo_contas: null, agendada_para: "2026-10-17T12:03:00.000Z", automacao_id: "a1", automacao_acao_id: "msg", gatilho_chave: "g1:2026-10-17T12:00:00.000Z" },
    ]);
    expect(chamadas.filter((c) => c.tabela === "acoes").map((c) => c.dados)).toEqual([P1, P2].map((telefone) => ({
      tipo: "remover", campanha_id: "c1", grupo_id: "g1", telefone, origem: "automacao", executar_apos: "2026-10-17T12:03:00.000Z",
      automacao_id: "a1", automacao_acao_id: "rem", gatilho_chave: `g1:${telefone}:2026-10-17T12:03:00.000Z`,
    })));
  });

  it("saiu (Remover Lead)", async () => {
    const { db, chamadas } = mundo({ automacoes: [auto("saiu", [rem])], participantes: [{ telefone: P1, grupo_id: "g2" }] });
    expect(await dispararPorPessoas({ campanhaId: "c1", gatilho: "saiu", grupoId: "g1", telefones: [P1] }, AGORA, db)).toBe(1);
    expect(nada(chamadas)).toBe(false);
    expect(chamadas.filter((c) => c.tabela === "acoes").map((c) => c.dados)).toEqual([{
      tipo: "remover", campanha_id: "c1", grupo_id: "g2", telefone: P1, origem: "automacao", executar_apos: "2026-10-17T12:03:00.000Z",
      automacao_id: "a1", automacao_acao_id: "rem", gatilho_chave: `saiu:g1:${P1}:2026-10-17T12:03:00.000Z:g2`,
    }]);
  });

  it("saiu sem Remover Lead nem ação de pessoa (só Tag Condicional órfã): sai cedo como antes", async () => {
    const { db, chamadas } = mundo({ automacoes: [auto("saiu", [cond(true)])] });
    expect(await dispararPorPessoas({ campanhaId: "c1", gatilho: "saiu", grupoId: "g1", telefones: [P1] }, AGORA, db)).toBe(0);
    expect(chamadas.some((c) => c.tabela === "participantes")).toBe(false);
    expect(nada(chamadas)).toBe(false);
  });

  it("checkout (Remover Lead)", async () => {
    const { db, chamadas } = mundo({ automacoes: [auto("checkout", [rem], { provedor: "hotmart", produto: "Curso" })], participantes: [{ telefone: P1, grupo_id: "g2" }] });
    expect(await dispararCheckout({ vendaId: "v1", provedor: "hotmart", produtos: ["Curso"], telefone: P1 }, AGORA, db)).toBe(1);
    expect(nada(chamadas)).toBe(false);
    expect(chamadas.filter((c) => c.tabela === "acoes").map((c) => c.dados)).toEqual([{
      tipo: "remover", campanha_id: "c1", grupo_id: "g2", telefone: P1, origem: "automacao", executar_apos: "2026-10-17T12:03:00.000Z",
      automacao_id: "a1", automacao_acao_id: "rem", gatilho_chave: "venda:v1:g2",
    }]);
  });
});
