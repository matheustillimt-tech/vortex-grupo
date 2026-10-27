import { describe, expect, it } from "vitest";
import {
  ACOES_ASSISTENTE,
  avisoCriada,
  campanhasDoEstado,
  destinoDepoisDeCriar,
  estadoAcaoInicial,
  estadoComPreset,
  lerPresetAcao,
  montarEntradaAcao,
  PASSOS_ACAO,
  passosVisiveis,
  pendenciaDoPassoAcao,
  podeIrParaAcao,
  quandoParaIso,
  validarEntradaAcao,
  type CampanhaDoAssistente,
  type EstadoAcao,
} from "@/src/lib/regras/assistente-acao";
import { proximoIndiceRadio } from "@/src/lib/regras/teclado-radio";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const C = "33333333-3333-3333-3333-333333333333";
const P = "44444444-4444-4444-4444-444444444444";
const G = "55555555-5555-5555-5555-555555555555";
const AGORA = new Date("2026-10-17T12:00:00Z"); // 09:00 em Brasília

const CAMPANHAS: CampanhaDoAssistente[] = [
  { id: A, nome: "Aula A", descricao: null, projeto_id: P },
  { id: B, nome: "Aula B", descricao: null, projeto_id: P },
  { id: C, nome: "Aula C", descricao: null, projeto_id: null },
];

const estado = (p: Partial<EstadoAcao>): EstadoAcao => ({ ...estadoAcaoInicial(), ...p });

describe("ações oferecidas", () => {
  it("as 18 que existem, na ordem da tela, sem enquete solta (\"Trocar imagem\" desde a Etapa 3M)", () => {
    expect(ACOES_ASSISTENTE.map((a) => a.rotulo)).toEqual([
      "Enviar mensagem", "Trocar nome", "Trocar descrição", "Trocar imagem", "Trocar configuração", "Fechar Grupos",
      "Relatório de status de mensagens", "Histórico de mensagens enviadas", "Abrir Grupos", "Entrar no Grupo",
      "Adicionar administradores", "Remover administradores", "Remover participantes", "Desativar comunidade",
      "Mover grupos para outra campanha", "Atualizar links dos grupos", "Redefinir link de convite", "Privacidade Avançada na Conversa",
    ]);
  });
});

describe("presets da URL", () => {
  it("só uuid e só ação da lista", () => {
    expect(lerPresetAcao({ campanha: A, acao: "mensagem" })).toEqual({ campanha: A, acao: "mensagem" });
    expect(lerPresetAcao({ campanha: "x", acao: "enquete" })).toEqual({ campanha: null, acao: null });
    expect(lerPresetAcao({ campanha: [A], acao: ["mensagem"] })).toEqual({ campanha: null, acao: null });
  });

  it("campanha + ação começa em Conexões com Categoria/Campanha/Ação marcadas", () => {
    const { estado: e, passo } = estadoComPreset(A, "mensagem");
    expect(passo).toBe("contas");
    expect(e).toMatchObject({ categoria: "campanha", campanhas: [A], tipo: "mensagem" });
    expect((e.conteudo as { versao: number }).versao).toBe(2);
    // pode voltar: os passos anteriores estão completos
    expect(podeIrParaAcao(0, new Set(["categoria", "campanha", "acao", "contas"]), e, CAMPANHAS)).toBe(true);
  });

  it("só a campanha começa em Ação; nada começa em Categoria", () => {
    expect(estadoComPreset(A, null).passo).toBe("acao");
    expect(estadoComPreset(null, "mensagem")).toEqual({ estado: estadoAcaoInicial(), passo: "categoria" });
  });
});

describe("campanhas da ação e pendências", () => {
  it("projeto = campanhas ativas do projeto", () => {
    expect(campanhasDoEstado(estado({ categoria: "projeto", projetoId: P }), CAMPANHAS)).toEqual([A, B]);
    expect(pendenciaDoPassoAcao("campanha", estado({ categoria: "projeto", projetoId: "999" + "99999-9999-9999-9999-999" + "999999999" }), CAMPANHAS)).toBe("Esse projeto não tem campanhas ativas.");
  });

  it("campanha exige ao menos uma; ação exige tipo", () => {
    expect(pendenciaDoPassoAcao("campanha", estado({ categoria: "campanha" }), CAMPANHAS)).toBe("Escolha ao menos uma campanha.");
    expect(pendenciaDoPassoAcao("acao", estado({ categoria: "campanha", campanhas: [A] }), CAMPANHAS)).toBe("Escolha a ação.");
  });

  it("contas/grupos específicos só pesam com uma campanha", () => {
    const uma = estado({ categoria: "campanha", campanhas: [A], contasTodas: false, gruposTodos: false });
    expect(pendenciaDoPassoAcao("contas", uma, CAMPANHAS)).toBe("Escolha ao menos uma conexão.");
    expect(pendenciaDoPassoAcao("grupos", uma, CAMPANHAS)).toBe("Escolha ao menos um grupo.");
    const varias = { ...uma, campanhas: [A, B] };
    expect(pendenciaDoPassoAcao("contas", varias, CAMPANHAS)).toBeNull();
    expect(pendenciaDoPassoAcao("grupos", varias, CAMPANHAS)).toBeNull();
  });

  it("com várias campanhas a entrada vai com todas as conexões e todos os grupos", () => {
    const e = estado({ categoria: "campanha", campanhas: [A, B], tipo: "abrir", contasTodas: false, contas: [G], gruposTodos: false, grupos: [G] });
    expect(montarEntradaAcao(e, CAMPANHAS)).toMatchObject({ campanhas: [A, B], contas: null, grupos: null, quando: "agora" });
    const uma = { ...e, campanhas: [A] };
    expect(montarEntradaAcao(uma, CAMPANHAS)).toMatchObject({ contas: [G], grupos: [G] });
  });

  it("conteúdo: remover participantes lê o texto e acusa linha inválida", () => {
    const base = estado({ categoria: "campanha", campanhas: [A], tipo: "remover_participantes" });
    expect(pendenciaDoPassoAcao("conteudo", { ...base, telefonesTexto: "" }, CAMPANHAS)).toBe("Informe ao menos um telefone.");
    expect(pendenciaDoPassoAcao("conteudo", { ...base, telefonesTexto: "37 " + "99999-0000\n123" }, CAMPANHAS)).toBe("Telefone inválido: 123.");
    const ok = { ...base, telefonesTexto: "37 " + "99999-0000\n(11) " + "98888-7777\n37" + "999990000" };
    expect(pendenciaDoPassoAcao("conteudo", ok, CAMPANHAS)).toBeNull();
    expect(montarEntradaAcao(ok, CAMPANHAS)?.conteudo).toEqual({ telefones: ["5537" + "999990000", "5511" + "988887777"] });
  });

  it("conteúdo: configuração precisa de ao menos uma escolha; mover não vai pra uma das campanhas", () => {
    const conf = estado({ categoria: "campanha", campanhas: [A], tipo: "configuracao", conteudo: {} });
    expect(pendenciaDoPassoAcao("conteudo", conf, CAMPANHAS)).toBe("Escolha ao menos uma configuração pra trocar.");
    expect(pendenciaDoPassoAcao("conteudo", { ...conf, conteudo: { aprovacao_entrada: true } }, CAMPANHAS)).toBeNull();
    const mover = estado({ categoria: "campanha", campanhas: [A, B], tipo: "mover_grupos", conteudo: { campanha_destino: B } });
    expect(pendenciaDoPassoAcao("conteudo", mover, CAMPANHAS)).toBe("A campanha de destino não pode ser uma das campanhas da ação.");
    expect(pendenciaDoPassoAcao("conteudo", { ...mover, conteudo: { campanha_destino: C } }, CAMPANHAS)).toBeNull();
  });

  it("confirmar: agendado precisa de data no futuro", () => {
    const e = estado({ agendar: true });
    expect(pendenciaDoPassoAcao("confirmar", e, CAMPANHAS, AGORA)).toBe("Escolha a data e a hora.");
    expect(pendenciaDoPassoAcao("confirmar", { ...e, dataHora: "2026-10-17T08:59" }, CAMPANHAS, AGORA)).toBe("Esse horário já passou.");
    expect(pendenciaDoPassoAcao("confirmar", { ...e, dataHora: "2026-10-17T09:30" }, CAMPANHAS, AGORA)).toBeNull();
  });

  it("não pula pra passo não visitado nem por cima de pendência", () => {
    const e = estado({ categoria: "campanha" });
    expect(podeIrParaAcao(2, new Set(["categoria", "campanha", "acao"]), e, CAMPANHAS)).toBe(false);
    expect(podeIrParaAcao(1, new Set(["categoria"]), e, CAMPANHAS)).toBe(false);
  });
});

describe("quandoParaIso (Brasília)", () => {
  it("agora, futuro, passado e inválido", () => {
    expect(quandoParaIso("agora", AGORA)).toEqual({ ok: true, iso: AGORA.toISOString() });
    expect(quandoParaIso("2026-10-17T10:00", AGORA)).toEqual({ ok: true, iso: "2026-10-17T13:00:00.000Z" });
    expect(quandoParaIso("2026-10-17T09:00", AGORA)).toEqual({ ok: false, erro: "Esse horário já passou." });
    expect(quandoParaIso("amanhã", AGORA)).toEqual({ ok: false, erro: "Data e hora inválidas." });
  });
});

describe("validarEntradaAcao", () => {
  const base = { categoria: "campanha", campanhas: [A], projetoId: null, tipo: "abrir", contas: null, grupos: null, conteudo: {}, importante: false, quando: "agora" };

  it("aceita e normaliza (ids repetidos saem, importante só em mensagem)", () => {
    const r = validarEntradaAcao({ ...base, campanhas: [A, A, B], importante: true }, AGORA);
    expect(r).toEqual({ ok: true, valor: expect.objectContaining({ campanhas: [A, B], importante: false, agendadaPara: AGORA.toISOString(), agora: true }) });
  });

  it("recusa categoria, ids, tipo e listas vazias", () => {
    expect(validarEntradaAcao({ ...base, categoria: "privado" }, AGORA)).toEqual({ ok: false, erro: "Escolha a categoria." });
    expect(validarEntradaAcao({ ...base, campanhas: ["x"] }, AGORA)).toEqual({ ok: false, erro: "Lista de campanhas inválida." });
    expect(validarEntradaAcao({ ...base, campanhas: [] }, AGORA)).toEqual({ ok: false, erro: "Escolha ao menos um item em campanhas." });
    expect(validarEntradaAcao({ ...base, tipo: "enquete" }, AGORA)).toEqual({ ok: false, erro: "Escolha a ação." });
    expect(validarEntradaAcao({ ...base, contas: [] }, AGORA)).toEqual({ ok: false, erro: "Escolha ao menos um item em conexões." });
    expect(validarEntradaAcao({ ...base, categoria: "projeto", projetoId: "x" }, AGORA)).toEqual({ ok: false, erro: "Escolha o projeto." });
  });

  it("contas/grupos específicos com mais de uma campanha", () => {
    expect(validarEntradaAcao({ ...base, campanhas: [A, B], grupos: [G] }, AGORA)).toEqual({ ok: false, erro: "Conexões e grupos específicos só valem com uma campanha." });
  });

  it("conteúdo pelo validador do tipo, mover pra fora das campanhas e horário no futuro", () => {
    expect(validarEntradaAcao({ ...base, tipo: "nome", conteudo: { padrao: "  " } }, AGORA)).toEqual({ ok: false, erro: "Escreva o novo nome." });
    expect(validarEntradaAcao({ ...base, tipo: "mover_grupos", conteudo: { campanha_destino: A } }, AGORA)).toEqual({ ok: false, erro: "A campanha de destino não pode ser uma das campanhas da ação." });
    expect(validarEntradaAcao({ ...base, quando: "2026-10-17T08:00" }, AGORA)).toEqual({ ok: false, erro: "Esse horário já passou." });
    const ag = validarEntradaAcao({ ...base, quando: "2026-10-18T08:00" }, AGORA);
    expect(ag.ok && ag.valor.agendadaPara).toBe("2026-10-18T11:00:00.000Z");
  });
});

describe("volta depois de criar", () => {
  it("aba Ações da campanha de origem, se continua na ação; senão /acoes", () => {
    expect(destinoDepoisDeCriar(A, [A], 1)).toBe(`/campanhas/${A}/acoes?criada=1`);
    expect(destinoDepoisDeCriar(A, [B, C], 2)).toBe("/acoes?criada=2");
    expect(destinoDepoisDeCriar(null, [A], 1)).toBe("/acoes?criada=1");
  });
  it("aviso", () => {
    expect(avisoCriada("1")).toBe("Ação criada.");
    expect(avisoCriada("3")).toBe("3 ações criadas (uma por campanha).");
    expect(avisoCriada("x")).toBeNull();
    expect(avisoCriada(undefined)).toBeNull();
  });
});

describe("passosVisiveis (barra do topo, Etapa 3N)", () => {
  it("começa com 5 (sem Contas/Grupos) antes da campanha resolver um alvo", () => {
    expect(passosVisiveis(estadoAcaoInicial(), CAMPANHAS)).toEqual(["categoria", "campanha", "acao", "conteudo", "confirmar"]);
    expect(passosVisiveis(estado({ categoria: "campanha" }), CAMPANHAS)).toEqual(["categoria", "campanha", "acao", "conteudo", "confirmar"]);
  });

  it("ganha Contas/Grupos depois que a campanha resolve pelo menos um alvo", () => {
    expect(passosVisiveis(estado({ categoria: "campanha", campanhas: [A] }), CAMPANHAS)).toEqual(PASSOS_ACAO);
    expect(passosVisiveis(estado({ categoria: "campanha", campanhas: [A, B] }), CAMPANHAS)).toEqual(PASSOS_ACAO);
    expect(passosVisiveis(estado({ categoria: "projeto", projetoId: P }), CAMPANHAS)).toEqual(PASSOS_ACAO);
  });

  it("'Entrar no Grupo' sempre mostra os passos dele (Conexões é o próprio alvo)", () => {
    expect(passosVisiveis(estado({ tipo: "entrar_grupo" }), CAMPANHAS)).toEqual(["acao", "contas", "conteudo", "confirmar"]);
  });

  it("relatório não tem Contas/Grupos pra começar com (já é assim em passosDoTipo)", () => {
    expect(passosVisiveis(estado({ tipo: "relatorio_status" }), CAMPANHAS)).toEqual(["categoria", "campanha", "acao", "conteudo", "confirmar"]);
  });
});

describe("teclado do grupo de rádio", () => {
  it("setas dão a volta, Home/End, outras teclas não mexem", () => {
    expect(proximoIndiceRadio("ArrowRight", 2, 3)).toBe(0);
    expect(proximoIndiceRadio("ArrowLeft", 0, 3)).toBe(2);
    expect(proximoIndiceRadio("ArrowDown", 0, 3)).toBe(1);
    expect(proximoIndiceRadio("Home", 2, 3)).toBe(0);
    expect(proximoIndiceRadio("End", 0, 3)).toBe(2);
    expect(proximoIndiceRadio("Enter", 0, 3)).toBeNull();
  });
});
