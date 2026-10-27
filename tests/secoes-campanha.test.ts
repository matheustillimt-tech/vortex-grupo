import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, type Chamada, type Resposta } from "./apoio/db-falso";

const hoisted = vi.hoisted(() => ({
  dbAtual: undefined as unknown,
  revalidar: vi.fn(),
  historicoMock: vi.fn(async (..._a: unknown[]) => undefined),
}));

vi.mock("@/src/lib/permissoes", async () => (await import("./apoio/permissoes")).permissoesFalsas());
vi.mock("@/src/lib/supabase/usuario", () => ({ exigirUsuario: async () => ({ id: "u1" }), dbUsuario: async () => hoisted.dbAtual }));
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => hoisted.dbAtual }));
vi.mock("next/cache", () => ({ revalidatePath: hoisted.revalidar }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" }) }));
vi.mock("@/src/lib/historico", () => ({ registrarHistorico: hoisted.historicoMock }));

import { definirInterruptor, salvarCampanhasAnteriores, salvarLinksPorDia, salvarPixel, salvarTagsCampanha } from "@/app/(painel)/campanhas/[id]/secoes/actions";
import { SECOES, lerSecao as lerSecaoDaTela } from "@/app/(painel)/campanhas/[id]/visao-geral";
import {
  algumaTagEscolhida,
  COLUNA_DO_INTERRUPTOR,
  SECOES_CAMPANHA,
  alteracaoDoInterruptor,
  ehInterruptor,
  lerCampanhasAnteriores,
  lerLinksPorDia,
  lerLinksPorDiaEntrada,
  lerSecao,
  lerTagsCampanha,
  validarPixel,
} from "@/src/lib/regras/secoes-campanha";
import { SEM_PERMISSAO, liberarTudo, negarTudo } from "./apoio/permissoes";

const CAMPANHA_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const raiz = path.resolve(__dirname, "..");
const ler = (rel: string) => readFileSync(path.join(raiz, rel), "utf8");

function usar(responder: (c: Chamada) => Resposta = () => ({})) {
  const f = dbFalso(responder);
  hoisted.dbAtual = f.db;
  return f.chamadas;
}
const campanha = (extra: Record<string, unknown> = {}) => (c: Chamada): Resposta =>
  c.tabela === "campanhas" && c.op === "select" ? { data: { deep_linking: false, pixel_meta_id: null, ...extra } } : {};
const updates = (cs: Chamada[]) => cs.filter((c) => c.tabela === "campanhas" && c.op === "update").map((c) => c.dados);

beforeEach(() => {
  vi.clearAllMocks();
  liberarTudo();
});

describe("menu de seções", () => {
  it("16 itens (sem Remover compradores, removido em 19/10/2026; Dividir envios entre chips e Aviso de chip caído em 20/10/2026), Data da aula por último", () => {
    expect(SECOES_CAMPANHA.map((s) => s.rotulo)).toEqual([
      "Métricas",
      "Gerenciamento de Tags",
      "Variáveis",
      "Cookie de redirecionamento",
      "Verificação de Colaboradores",
      "Confirmação de entrega",
      "Gestão de comunidades",
      "Atualização de links",
      "Atualização periódica de links",
      "Redefinir link de convite",
      "Remover Lead de Campanhas Anteriores",
      "Deep Linking",
      "Checar participantes duplicados",
      "Dividir envios entre chips",
      "Aviso de chip caído",
      "Data da aula e sequência",
    ]);
    expect(SECOES_CAMPANHA.map((s) => s.valor)).toEqual([
      "metricas", "tags", "variaveis", "cookie", "colaboradores", "entrega", "comunidades", "links-banimento",
      "links-periodicos", "redefinir-link", "anteriores", "deep-linking", "duplicados", "dividir-chips", "aviso-queda", "aula",
    ]);
  });

  it("a Visão geral usa o mesmo menu", () => {
    expect(SECOES).toBe(SECOES_CAMPANHA);
    expect(lerSecaoDaTela).toBe(lerSecao);
  });

  it("?secao=compradores e ?secao=vip (removidos em 19/10/2026) e valor desconhecido abrem Métricas", () => {
    expect(lerSecao("compradores")).toBe("metricas");
    expect(lerSecao("vip")).toBe("metricas");
    expect(lerSecao("deep-linking")).toBe("deep-linking");
    expect(lerSecao("inventada")).toBe("metricas");
    expect(lerSecao(undefined)).toBe("metricas");
  });
});

describe("regras dos interruptores", () => {
  it("lista branca com as 10 colunas das seções (nada grava compradores_ativo nem as colunas do Grupo VIP); tags e links periódicos saíram (Etapa 3N, Tarefa 5): salvam ao escolher/ao sair, sem interruptor", () => {
    expect(COLUNA_DO_INTERRUPTOR).not.toHaveProperty("compradores");
    expect(Object.values(COLUNA_DO_INTERRUPTOR).sort()).toEqual(
      [
        "cookie_redirecionamento", "verificacao_colaboradores", "confirmar_entrega", "usar_comunidade",
        "atualizar_links_banimento", "redefinir_link_cheio", "remover_anteriores_ativo", "deep_linking", "checar_duplicados",
        "dividir_chips",
      ].sort(),
    );
    expect(ehInterruptor("pixel")).toBe(true);
    expect(ehInterruptor("cookie")).toBe(true);
    expect(ehInterruptor("tags")).toBe(false);
    expect(ehInterruptor("links-periodicos")).toBe(false);
    expect(ehInterruptor("vip")).toBe(false);
    for (const ruim of ["nome", "slug", "pixel_meta_id", "toString", "__proto__", "constructor", "", null, 1]) expect(ehInterruptor(ruim)).toBe(false);
  });

  it("validarPixel: 10 a 20 dígitos (com espaço em volta), nada além", () => {
    expect(validarPixel(" 1234567890 ")).toBe("1234567890");
    expect(validarPixel("12345678901234567890")).toBe("12345678901234567890");
    for (const ruim of ["123456789", "123456789012345678901", "12345abcde", "1234567890');alert(1)//", "", null, 1234567890]) expect(validarPixel(ruim)).toBeNull();
  });

  const agora = new Date("2026-10-17T12:00:00.000Z");
  const semDeep = { deep_linking: false, pixel_meta_id: null };

  it("grava só a coluna do interruptor", () => {
    expect(alteracaoDoInterruptor("cookie", false, semDeep, agora)).toEqual({ ok: true, update: { cookie_redirecionamento: false } });
    expect(alteracaoDoInterruptor("duplicados", false, semDeep, agora)).toEqual({ ok: true, update: { checar_duplicados: false } });
  });

  it("Confirmação de entrega ligando grava confirmar_entrega_desde; desligando não", () => {
    expect(alteracaoDoInterruptor("entrega", true, semDeep, agora)).toEqual({ ok: true, update: { confirmar_entrega: true, confirmar_entrega_desde: agora.toISOString() } });
    expect(alteracaoDoInterruptor("entrega", false, semDeep, agora)).toEqual({ ok: true, update: { confirmar_entrega: false } });
  });

  it("Pixel só liga com Deep Linking ligado e id preenchido; desligar sempre pode", () => {
    expect(alteracaoDoInterruptor("pixel", true, semDeep, agora).ok).toBe(false);
    expect(alteracaoDoInterruptor("pixel", true, { deep_linking: true, pixel_meta_id: null }, agora).ok).toBe(false);
    expect(alteracaoDoInterruptor("pixel", true, { deep_linking: true, pixel_meta_id: "1234567890" }, agora)).toEqual({ ok: true, update: { pixel_meta_ativo: true } });
    expect(alteracaoDoInterruptor("pixel", false, semDeep, agora)).toEqual({ ok: true, update: { pixel_meta_ativo: false } });
  });
});

describe("definirInterruptor", () => {
  it("sem permissão: recusa sem tocar no banco", async () => {
    negarTudo();
    const chamadas = usar(campanha());
    expect(await definirInterruptor(CAMPANHA_ID, "cookie", false)).toEqual({ erro: SEM_PERMISSAO });
    expect(chamadas).toEqual([]);
  });

  it("recusa coluna fora da lista branca, id inválido e valor que não é booleano", async () => {
    const chamadas = usar(campanha());
    expect(await definirInterruptor(CAMPANHA_ID, "nome", true)).toEqual({ erro: "Seção inválida." });
    expect(await definirInterruptor(CAMPANHA_ID, "pixel_meta_id", true)).toEqual({ erro: "Seção inválida." });
    expect(await definirInterruptor("nao-e-uuid", "cookie", true)).toEqual({ erro: "Campanha inválida." });
    expect(await definirInterruptor(CAMPANHA_ID, "cookie", "sim" as unknown as boolean)).toEqual({ erro: "Valor inválido." });
    expect(chamadas).toEqual([]);
  });

  it("grava só aquela coluna, registra o histórico e revalida a campanha", async () => {
    const chamadas = usar(campanha());
    expect(await definirInterruptor(CAMPANHA_ID, "duplicados", false)).toEqual({});
    expect(updates(chamadas)).toEqual([{ checar_duplicados: false }]);
    expect(chamadas.find((c) => c.op === "update")!.filtros).toContainEqual(["eq", "id", CAMPANHA_ID]);
    expect(hoisted.historicoMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ area: "Campanhas", resumo: "Campanha: Checar participantes duplicados desativado", refId: CAMPANHA_ID }));
    expect(hoisted.revalidar).toHaveBeenCalledWith(`/campanhas/${CAMPANHA_ID}`, "layout");
  });

  it("histórico de ativar usa o título da seção", async () => {
    usar(campanha());
    await definirInterruptor(CAMPANHA_ID, "deep-linking", true);
    expect(hoisted.historicoMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ resumo: "Campanha: Deep Linking ativado" }));
  });

  it("Pixel com Deep Linking desligado: recusa e não grava", async () => {
    const chamadas = usar(campanha({ pixel_meta_id: "1234567890" }));
    const r = await definirInterruptor(CAMPANHA_ID, "pixel", true);
    expect(r.erro).toMatch(/Deep Linking/);
    expect(updates(chamadas)).toEqual([]);
    expect(hoisted.historicoMock).not.toHaveBeenCalled();
  });

  it("campanha que não existe: erro, sem gravar", async () => {
    const chamadas = usar(() => ({ data: null }));
    expect(await definirInterruptor(CAMPANHA_ID, "cookie", false)).toEqual({ erro: "Campanha não encontrada." });
    expect(updates(chamadas)).toEqual([]);
  });

  it("falha ao gravar: devolve erro (o interruptor volta) e não registra histórico", async () => {
    usar((c) => (c.op === "update" ? { error: { message: "caiu" } } : campanha()(c)));
    expect(await definirInterruptor(CAMPANHA_ID, "cookie", false)).toEqual({ erro: "Não foi possível salvar." });
    expect(hoisted.historicoMock).not.toHaveBeenCalled();
  });
});

describe("salvarPixel", () => {
  it("sem permissão: recusa", async () => {
    negarTudo();
    const chamadas = usar(campanha({ deep_linking: true }));
    expect(await salvarPixel(CAMPANHA_ID, "1234567890")).toEqual({ erro: SEM_PERMISSAO });
    expect(chamadas).toEqual([]);
  });

  it("id inválido não grava", async () => {
    const chamadas = usar(campanha({ deep_linking: true }));
    expect((await salvarPixel(CAMPANHA_ID, "abc")).erro).toMatch(/10 a 20 dígitos/);
    expect(chamadas).toEqual([]);
  });

  it("com Deep Linking desligado: recusa", async () => {
    const chamadas = usar(campanha());
    expect((await salvarPixel(CAMPANHA_ID, "1234567890")).erro).toMatch(/Deep Linking/);
    expect(updates(chamadas)).toEqual([]);
  });

  it("grava o id limpo; vazio apaga o id e desliga o Pixel", async () => {
    let chamadas = usar(campanha({ deep_linking: true }));
    expect(await salvarPixel(CAMPANHA_ID, " 1234567890 ")).toEqual({});
    expect(updates(chamadas)).toEqual([{ pixel_meta_id: "1234567890" }]);
    chamadas = usar(campanha({ deep_linking: true }));
    expect(await salvarPixel(CAMPANHA_ID, "  ")).toEqual({});
    expect(updates(chamadas)).toEqual([{ pixel_meta_id: null, pixel_meta_ativo: false }]);
  });
});

describe("estrutura", () => {
  it("MENSAGEM AUTOMATICA abre o assistente de automação com a campanha (que começa em Grupo)", () => {
    expect(ler("app/(painel)/campanhas/[id]/mensagens/page.tsx")).toMatch(/<BotaoLink href=\{`\/automacoes\/nova\?campanha=\$\{id\}`\}[^\n]*>MENSAGEM AUTOMATICA<\/BotaoLink>/);
    expect(ler("app/(painel)/automacoes/assistente.tsx")).toMatch(/campanhaPreSelecionada \? "grupos" : "categoria"/);
  });

  it("a conferência lê checar_duplicados junto com a campanha do grupo", () => {
    expect(ler("src/lib/jobs/conferir-grupos.ts")).toMatch(/campanhas\([^)]*checar_duplicados[^)]*\)/);
  });

  it("o link público lê cookie_redirecionamento e deep_linking; a página de abrir lê o Pixel", () => {
    expect(ler("app/l/[slug]/route.ts")).toMatch(/select\("[^"]*cookie_redirecionamento, deep_linking[^"]*"\)/);
    expect(ler("app/l/[slug]/abrir/page.tsx")).toMatch(/select\("[^"]*deep_linking, pixel_meta_ativo, pixel_meta_id"\)/);
  });
});

describe("página de abrir (/l/[slug]/abrir): Deep Linking e Pixel", () => {
  async function abrir(camp: Record<string, unknown>) {
    usar((c) => {
      if (c.tabela === "campanhas") return { data: { id: "c1", arquivada: false, ...camp } };
      if (c.tabela === "grupos") return { data: { link_convite: "https://chat.whatsapp.com/ABC123" } };
      return {};
    });
    // O vitest compila o TSX no modo clássico (React.createElement): o React precisa estar no escopo global.
    (globalThis as { React?: unknown }).React = await import("react");
    const { default: Abrir } = await import("@/app/l/[slug]/abrir/page");
    const { renderToStaticMarkup } = await import("react-dom/server");
    return renderToStaticMarkup(await Abrir({ params: Promise.resolve({ slug: "aulao" }), searchParams: Promise.resolve({ g: "g1" }) }));
  }

  it("sem deep linking (padrão): a página de hoje, sem Pixel", async () => {
    const html = await abrir({});
    expect(html).toContain("Falta só um passo");
    expect(html).toContain("whatsapp://chat?code=ABC123");
    expect(html).not.toContain("connect.facebook.net");
  });

  it("Pixel ligado sem Deep Linking: nada de Pixel", async () => {
    const html = await abrir({ deep_linking: false, pixel_meta_ativo: true, pixel_meta_id: "1234567890" });
    expect(html).not.toContain("connect.facebook.net");
  });

  it("Deep Linking + Pixel ativo + id: script padrão com o id e PageView", async () => {
    const html = await abrir({ deep_linking: true, pixel_meta_ativo: true, pixel_meta_id: "1234567890" });
    expect(html).toContain("https://connect.facebook.net/en_US/fbevents.js");
    expect(html).toContain("fbq('init','1234567890')");
    expect(html).toContain("fbq('track','PageView')");
    expect(html).toContain("Entrar no grupo");
  });

  it("id fora do padrão (gravado de algum jeito) nunca entra no HTML", async () => {
    const html = await abrir({ deep_linking: true, pixel_meta_ativo: true, pixel_meta_id: "1');alert(1)//" });
    expect(html).not.toContain("connect.facebook.net");
    expect(html).not.toContain("alert(1)");
  });
});

const TAG_A = "bbbbbbbb-1111-4111-8111-111111111111";
const TAG_B = "bbbbbbbb-2222-4222-8222-222222222222";
const OUTRA = "cccccccc-1111-4111-8111-111111111111";
const vazio = { adicionar: "", remover: "" };

describe("Gerenciamento de Tags: regras e salvarTagsCampanha", () => {
  it("lerTagsCampanha: vazio vira null e tags_ativo false; mesma tag em Adicionar e Remover do mesmo bloco é recusada; em blocos diferentes pode e liga tags_ativo", () => {
    expect(lerTagsCampanha({ entrou: vazio, saiu: vazio })).toEqual({
      ok: true,
      colunas: { tag_entrou_adicionar: null, tag_entrou_remover: null, tag_saiu_adicionar: null, tag_saiu_remover: null, tags_ativo: false },
      ids: [],
    });
    expect(lerTagsCampanha({ entrou: { adicionar: TAG_A, remover: TAG_A }, saiu: vazio })).toMatchObject({ ok: false, erro: expect.stringMatching(/entrar/) });
    expect(lerTagsCampanha({ entrou: vazio, saiu: { adicionar: TAG_B, remover: TAG_B } })).toMatchObject({ ok: false, erro: expect.stringMatching(/sair/) });
    expect(lerTagsCampanha({ entrou: { adicionar: TAG_A, remover: "" }, saiu: { adicionar: "", remover: TAG_A } })).toMatchObject({ ok: true, ids: [TAG_A] });
    expect((lerTagsCampanha({ entrou: { adicionar: TAG_A, remover: "" }, saiu: { adicionar: "", remover: TAG_A } }) as { colunas: { tags_ativo: boolean } }).colunas.tags_ativo).toBe(true);
    expect(lerTagsCampanha({ entrou: { adicionar: "x'; drop", remover: "" }, saiu: vazio })).toEqual({ ok: false, erro: "Tag inválida." });
  });

  it("algumaTagEscolhida: tags_ativo é consequência de ter alguma tag escolhida (nunca de um botão separado)", () => {
    const nenhuma = { tag_entrou_adicionar: null, tag_entrou_remover: null, tag_saiu_adicionar: null, tag_saiu_remover: null };
    expect(algumaTagEscolhida(nenhuma)).toBe(false);
    expect(algumaTagEscolhida({ ...nenhuma, tag_entrou_adicionar: TAG_A })).toBe(true);
    expect(algumaTagEscolhida({ ...nenhuma, tag_saiu_remover: TAG_B })).toBe(true);
  });

  const tagsDoBanco = (linhas: { id: string; tipo: string }[]) => (c: Chamada): Resposta => {
    if (c.tabela === "tags") return { data: linhas };
    if (c.tabela === "campanhas" && c.op === "update") return { data: [{ id: CAMPANHA_ID }] };
    return {};
  };

  it("sem permissão: recusa sem tocar no banco", async () => {
    negarTudo();
    const chamadas = usar(tagsDoBanco([]));
    expect(await salvarTagsCampanha(CAMPANHA_ID, { entrou: { adicionar: TAG_A, remover: "" }, saiu: vazio })).toEqual({ erro: SEM_PERMISSAO });
    expect(chamadas).toEqual([]);
  });

  it("tag que não é manual (ou não existe) é recusada", async () => {
    let chamadas = usar(tagsDoBanco([{ id: TAG_A, tipo: "comprador" }]));
    expect((await salvarTagsCampanha(CAMPANHA_ID, { entrou: { adicionar: TAG_A, remover: "" }, saiu: vazio })).erro).toMatch(/manuais/);
    expect(updates(chamadas)).toEqual([]);
    chamadas = usar(tagsDoBanco([]));
    expect((await salvarTagsCampanha(CAMPANHA_ID, { entrou: { adicionar: TAG_A, remover: "" }, saiu: vazio })).erro).toMatch(/manuais/);
    expect(updates(chamadas)).toEqual([]);
  });

  it("mesma tag em Adicionar e Remover: recusa sem ler o banco", async () => {
    const chamadas = usar(tagsDoBanco([{ id: TAG_A, tipo: "manual" }]));
    expect((await salvarTagsCampanha(CAMPANHA_ID, { entrou: { adicionar: TAG_A, remover: TAG_A }, saiu: vazio })).erro).toBeTruthy();
    expect(chamadas).toEqual([]);
  });

  it("grava as 4 colunas + tags_ativo = true (alguma tag escolhida), registra histórico e revalida", async () => {
    const chamadas = usar(tagsDoBanco([{ id: TAG_A, tipo: "manual" }, { id: TAG_B, tipo: "manual" }]));
    expect(await salvarTagsCampanha(CAMPANHA_ID, { entrou: { adicionar: TAG_A, remover: "" }, saiu: { adicionar: "", remover: TAG_B } })).toEqual({});
    expect(updates(chamadas)).toEqual([{ tag_entrou_adicionar: TAG_A, tag_entrou_remover: null, tag_saiu_adicionar: null, tag_saiu_remover: TAG_B, tags_ativo: true }]);
    expect(hoisted.historicoMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ resumo: "Campanha: Gerenciamento de Tags ativado", refId: CAMPANHA_ID }));
    expect(hoisted.revalidar).toHaveBeenCalledWith(`/campanhas/${CAMPANHA_ID}`, "layout");
  });

  it("limpar tudo grava tags_ativo = false", async () => {
    const chamadas = usar(tagsDoBanco([]));
    expect(await salvarTagsCampanha(CAMPANHA_ID, { entrou: vazio, saiu: vazio })).toEqual({});
    expect(updates(chamadas)).toEqual([{ tag_entrou_adicionar: null, tag_entrou_remover: null, tag_saiu_adicionar: null, tag_saiu_remover: null, tags_ativo: false }]);
    expect(hoisted.historicoMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ resumo: "Campanha: Gerenciamento de Tags desativado" }));
  });
});

describe("Remover Lead de Campanhas Anteriores: regras e salvarCampanhasAnteriores", () => {
  it("lerCampanhasAnteriores: uuids, sem repetir, sem a própria, até 50", () => {
    expect(lerCampanhasAnteriores([OUTRA, OUTRA], CAMPANHA_ID)).toEqual({ ok: true, ids: [OUTRA] });
    expect(lerCampanhasAnteriores([CAMPANHA_ID], CAMPANHA_ID).ok).toBe(false);
    expect(lerCampanhasAnteriores(["nada"], CAMPANHA_ID).ok).toBe(false);
    expect(lerCampanhasAnteriores("x", CAMPANHA_ID).ok).toBe(false);
    const muitas = Array.from({ length: 51 }, (_, i) => `dddddddd-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(lerCampanhasAnteriores(muitas, CAMPANHA_ID).ok).toBe(false);
    expect(lerCampanhasAnteriores(muitas.slice(0, 50), CAMPANHA_ID).ok).toBe(true);
  });

  const banco = (existentes: string[]) => (c: Chamada): Resposta => {
    if (c.tabela === "campanhas" && c.op === "select") return { data: existentes.map((id) => ({ id })) };
    if (c.tabela === "campanhas" && c.op === "update") return { data: [{ id: CAMPANHA_ID }] };
    return {};
  };

  it("sem permissão: recusa sem tocar no banco", async () => {
    negarTudo();
    const chamadas = usar(banco([OUTRA]));
    expect(await salvarCampanhasAnteriores(CAMPANHA_ID, [OUTRA])).toEqual({ erro: SEM_PERMISSAO });
    expect(chamadas).toEqual([]);
  });

  it("a própria campanha na lista: recusa", async () => {
    const chamadas = usar(banco([OUTRA, CAMPANHA_ID]));
    expect((await salvarCampanhasAnteriores(CAMPANHA_ID, [OUTRA, CAMPANHA_ID])).erro).toMatch(/própria/);
    expect(updates(chamadas)).toEqual([]);
  });

  it("campanha que não existe: recusa", async () => {
    const chamadas = usar(banco([]));
    expect((await salvarCampanhasAnteriores(CAMPANHA_ID, [OUTRA])).erro).toMatch(/não existe/);
    expect(updates(chamadas)).toEqual([]);
  });

  it("grava a lista (vazia também) e registra histórico", async () => {
    let chamadas = usar(banco([OUTRA]));
    expect(await salvarCampanhasAnteriores(CAMPANHA_ID, [OUTRA])).toEqual({});
    expect(updates(chamadas)).toEqual([{ campanhas_anteriores: [OUTRA] }]);
    expect(hoisted.historicoMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ resumo: "Campanha: Remover Lead de Campanhas Anteriores salvo (1 campanha)" }));
    chamadas = usar(banco([]));
    expect(await salvarCampanhasAnteriores(CAMPANHA_ID, [])).toEqual({});
    expect(updates(chamadas)).toEqual([{ campanhas_anteriores: [] }]);
  });
});

describe("estrutura (Tarefa 2)", () => {
  it("a conferência lê as tags e as campanhas anteriores junto com a campanha do grupo", () => {
    const texto = ler("src/lib/jobs/conferir-grupos.ts");
    for (const col of ["tags_ativo", "tag_entrou_adicionar", "tag_entrou_remover", "tag_saiu_adicionar", "tag_saiu_remover", "remover_anteriores_ativo", "campanhas_anteriores"]) {
      expect(texto).toMatch(new RegExp(`campanhas\\([^)]*${col}[^)]*\\)`));
    }
  });

  it("as seções Tags, Colaboradores e Anteriores têm os textos do plano", () => {
    const pagina = ler("app/(painel)/campanhas/[id]/page.tsx");
    for (const t of [
      "Selecione uma tag para adicionar ou remover automaticamente aos participantes quando entrarem ou sairem de um grupo da campanha.",
      "Verificação de Colaboradores pelo telefone",
      "Página pública onde o lead digita um número e confere se ele é da equipe desta campanha.",
      "Ativar Verificação de Colaboradores",
      "Ao ingressar nesta campanha, o participante será automaticamente removido das campanhas anteriores selecionadas.",
      "Admins e números conectados nunca saem",
    ]) expect(pagina).toContain(t);
    const tags = ler("app/(painel)/campanhas/[id]/secoes/tags.tsx");
    for (const t of ["Quando o participante entrar", "Quando o participante sair", "Adicionar tag", "Remover tag"]) expect(tags).toContain(t);
    // Sem interruptor nem botão "SALVAR" visível (Etapa 3N, Tarefa 5): salva ao escolher. O comentário do
    // arquivo pode citar a palavra; o que não pode existir é o próprio botão (JSX com esse texto).
    expect(tags).not.toMatch(/>SALVAR</);
  });
});

describe("Atualização periódica de links: lerLinksPorDia, lerLinksPorDiaEntrada e salvarLinksPorDia", () => {
  it("aceita inteiro de 1 a 24 (número ou texto do campo)", () => {
    expect([1, 24, "6", " 12 "].map(lerLinksPorDia)).toEqual([1, 24, 6, 12]);
    expect([0, 25, 1.5, "", "abc", null, undefined, -1].map(lerLinksPorDia)).toEqual([null, null, null, null, null, null, null, null]);
  });

  it("lerLinksPorDiaEntrada: vazio desliga; número de 1 a 24 liga; o resto é inválido (sem interruptor nem SALVAR — Etapa 3N)", () => {
    expect(lerLinksPorDiaEntrada("")).toEqual({ ok: true, ligar: false });
    expect(lerLinksPorDiaEntrada(undefined)).toEqual({ ok: true, ligar: false });
    expect(lerLinksPorDiaEntrada(null)).toEqual({ ok: true, ligar: false });
    expect(lerLinksPorDiaEntrada("6")).toEqual({ ok: true, ligar: true, n: 6 });
    expect(lerLinksPorDiaEntrada(24)).toEqual({ ok: true, ligar: true, n: 24 });
    expect(lerLinksPorDiaEntrada(25).ok).toBe(false);
    expect(lerLinksPorDiaEntrada("abc").ok).toBe(false);
  });

  it("sem permissão: nada é gravado", async () => {
    negarTudo();
    const chamadas = usar();
    expect(await salvarLinksPorDia(CAMPANHA_ID, 4)).toEqual({ erro: SEM_PERMISSAO });
    expect(chamadas).toEqual([]);
  });

  it("valor fora de 1..24 ou campanha inválida: recusa sem gravar", async () => {
    const chamadas = usar();
    expect((await salvarLinksPorDia(CAMPANHA_ID, 25)).erro).toMatch(/1 a 24/);
    expect((await salvarLinksPorDia("x", 2)).erro).toBe("Campanha inválida.");
    expect(chamadas).toEqual([]);
  });

  it("número grava links_periodicos=true + links_por_dia (zera links_atualizados_em) e registra no histórico", async () => {
    const chamadas = usar((c) => (c.op === "update" ? { data: [{ id: CAMPANHA_ID }] } : {}));
    expect(await salvarLinksPorDia(CAMPANHA_ID, "6")).toEqual({});
    expect(updates(chamadas)).toEqual([{ links_periodicos: true, links_por_dia: 6, links_atualizados_em: null }]);
    expect(hoisted.historicoMock).toHaveBeenCalledTimes(1);
  });

  it("campo vazio grava links_periodicos=false, sem mudar links_por_dia", async () => {
    const chamadas = usar((c) => (c.op === "update" ? { data: [{ id: CAMPANHA_ID }] } : {}));
    expect(await salvarLinksPorDia(CAMPANHA_ID, "")).toEqual({});
    expect(updates(chamadas)).toEqual([{ links_periodicos: false }]);
    expect(hoisted.historicoMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ resumo: "Campanha: Atualização periódica de links desativada" }));
  });
});

describe("estrutura (Tarefa 3)", () => {
  it("as 4 seções desta tarefa estão na página com os textos do brief e nenhuma seção fica sem conteúdo", () => {
    const pagina = ler("app/(painel)/campanhas/[id]/page.tsx");
    for (const t of [
      "Confirma se a mensagem chegou nos grupos usando as outras conexões da campanha",
      "Atualizar os links de maneira automática quando algum número é banido",
      "Atenção: Para que essa funcionalidade funcione corretamente, é necessário ter uma outra conexão associada na campanha que seja administradora dos grupos.",
      "Atualiza periodicamente os links de convite de todos os grupos da campanha",
      "A verificação ocorre a cada hora.",
      "Quando um grupo enche, o link de convite é revogado automaticamente",
    ]) expect(pagina).toContain(t);
    expect(pagina).not.toContain("Esta seção chega na próxima parte desta etapa.");
  });

  it("o tick roda links depois de folga e entregas depois de eventos", () => {
    const tick = ler("app/api/cron/tick/route.ts");
    const ordem = ["\"folga\"", "\"links\"", "\"conferencia\"", "\"eventos\"", "\"entregas\"", "\"execucoes2\""].map((n) => tick.indexOf(`passo(${n}`));
    expect(ordem.every((i) => i > 0)).toBe(true);
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
  });
});

describe("Remover compradores removido (decisão do dono, 19/10/2026)", () => {
  it("os interruptores compradores e vip são recusados sem tocar no banco", async () => {
    for (const i of ["compradores", "vip"]) {
      const chamadas = usar(campanha());
      expect(await definirInterruptor(CAMPANHA_ID, i, true)).toEqual({ erro: "Seção inválida." });
      expect(chamadas).toEqual([]);
    }
  });

  it("a página e as configurações não têm mais Remover compradores nem nada do Grupo VIP", () => {
    for (const arq of ["app/(painel)/campanhas/[id]/page.tsx", "app/(painel)/campanhas/[id]/configuracoes/page.tsx"]) {
      const pagina = ler(arq);
      for (const t of ["Remover compradores", "compradores_ativo", "regras_compra", "RegrasCompra", "Grupo VIP Hotmart", "vip_ativo", "vip_entradas"]) {
        expect(pagina).not.toContain(t);
      }
    }
  });
});
