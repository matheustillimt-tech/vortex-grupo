import { describe, expect, it, vi } from "vitest";
import { esperaEntreMensagens, executarTarefa, ProgressoNaoSalvo, type ContextoTarefa } from "@/src/lib/jobs/executar-tarefa";
import type { ConteudoV2, MensagemV2, OpcoesEnvio } from "@/src/lib/regras/conteudo-v2";
import { OPCOES_ENVIO_PADRAO } from "@/src/lib/regras/conteudo-v2";
import { ZapbotError } from "@/src/lib/zapbot/client";
import { classificarErro } from "@/src/lib/zapbot/erros";

const c = { id: "i", token: "t", clientToken: "ct" };
const g = { groupId: "120@g.us", numero: 3 };

type Membro = { phone: string; isAdmin: boolean };

function zFalso(membros: Membro[] | null = []) {
  let n = 0;
  const id = () => `M${++n}`;
  return {
    enviar: vi.fn(async (_c: unknown, _rota: string, _corpo: unknown) => id()),
    enviarEnquete: vi.fn(async () => id()),
    configurarGrupo: vi.fn(async () => {}),
    participantes: vi.fn(async () => {}),
    obterGrupo: vi.fn(async () => (membros === null ? null : { groupId: g.groupId, name: "G", amAdmin: true, participantCount: membros.length, participants: membros })),
    linkConvite: vi.fn(async () => "https://chat.whatsapp.com/ATUAL"),
    status: vi.fn(async () => ({ connected: true, phone: "5537" + "980001001" })),
    enviarFigurinha: vi.fn(async () => id()),
    enviarGif: vi.fn(async () => id()),
    enviarContato: vi.fn(async () => id()),
    enviarEvento: vi.fn(async () => id()),
    enviarBotoes: vi.fn(async () => id()),
    fixarMensagem: vi.fn(async () => {}),
    mensagensTemporarias: vi.fn(async () => {}),
    modoEntrada: vi.fn(async () => {}),
    desativarComunidade: vi.fn(async () => {}),
    removerParticipantes: vi.fn(async (_c: unknown, _g: string, _t: string[]): Promise<string[] | null> => null),
    privacidadeAvancada: vi.fn(async () => {}),
    trocarFoto: vi.fn(async () => {}),
  };
}

const v2 = (mensagens: MensagemV2[], opcoes: Partial<OpcoesEnvio> = {}): ConteudoV2 => ({ versao: 2, mensagens, opcoes: { ...OPCOES_ENVIO_PADRAO, ...opcoes } });
const txt = (texto: string): MensagemV2 => ({ formato: "texto", texto });
const semEspera = (extra: Partial<ContextoTarefa> = {}): ContextoTarefa => ({ esperar: vi.fn(async () => {}), aleatorio: () => 0, ...extra });

describe("formato antigo (v1) — regressão: mesmo request de antes", () => {
  const casos: [string, unknown, string, Record<string, unknown>][] = [
    ["texto", { formato: "texto", texto: "Oi", midia_url: null, nome_arquivo: null, mencionar_todos: false }, "send-text", { phone: "120@g.us", message: "Oi" }],
    ["texto com menção", { formato: "texto", texto: "Oi", midia_url: null, nome_arquivo: null, mencionar_todos: true }, "send-text", { phone: "120@g.us", message: "Oi @all", mentionAll: true }],
    ["imagem", { formato: "imagem", texto: "leg", midia_url: "https://x/a.jpg", nome_arquivo: null, mencionar_todos: false }, "send-image", { phone: "120@g.us", image: "https://x/a.jpg", caption: "leg" }],
    ["vídeo sem legenda", { formato: "video", texto: "", midia_url: "https://x/v.mp4", nome_arquivo: null, mencionar_todos: false }, "send-video", { phone: "120@g.us", video: "https://x/v.mp4" }],
    ["áudio", { formato: "audio", texto: "", midia_url: "https://x/a.ogg", nome_arquivo: null, mencionar_todos: false }, "send-audio", { phone: "120@g.us", audio: "https://x/a.ogg" }],
    ["documento", { formato: "documento", texto: "", midia_url: "https://x/c.docx", nome_arquivo: "c.docx", mencionar_todos: false }, "send-document/docx", { phone: "120@g.us", document: "https://x/c.docx", fileName: "c.docx" }],
  ];
  for (const [nome, conteudo, rota, corpo] of casos) {
    it(nome, async () => {
      const z = zFalso();
      const salvar = vi.fn(async () => {});
      const r = await executarTarefa(z, c, "mensagem", conteudo, g, undefined, new Set(), semEspera({ salvarProgresso: salvar }));
      expect(r).toEqual({ messageId: "M1" });
      expect(z.enviar).toHaveBeenCalledTimes(1);
      expect(z.enviar).toHaveBeenCalledWith(c, rota, corpo);
      expect(salvar).not.toHaveBeenCalled(); // v1 não mexe em progresso
      expect(z.mensagensTemporarias).not.toHaveBeenCalled();
      expect(z.fixarMensagem).not.toHaveBeenCalled();
    });
  }

  it("enquete antiga continua no send-poll", async () => {
    const z = zFalso();
    await executarTarefa(z, c, "enquete", { pergunta: "Vem?", opcoes: ["Sim", "Não"], max_respostas: 1 }, g);
    expect(z.enviarEnquete).toHaveBeenCalledWith(c, "120@g.us", "Vem?", ["Sim", "Não"], 1);
  });
});

describe("mensagem v2", () => {
  it("manda em ordem, guarda o progresso depois de cada uma e devolve o messageId da primeira", async () => {
    const z = zFalso();
    const salvos: [number, string | null][] = [];
    const ctx = semEspera({ salvarProgresso: async (p, m) => void salvos.push([p, m]) });
    const r = await executarTarefa(z, c, "mensagem", v2([txt("um"), txt("dois"), txt("três")]), g, undefined, new Set(), ctx);
    expect(r).toEqual({ messageId: "M1" });
    expect(z.enviar.mock.calls.map((x) => (x[2] as { message: string }).message)).toEqual(["um", "dois", "três"]);
    expect(salvos).toEqual([[1, "M1"], [2, "M1"], [3, "M1"]]);
  });

  it("salva o progresso ANTES de mandar a próxima", async () => {
    const z = zFalso();
    const ordem: string[] = [];
    z.enviar.mockImplementation(async (_c, _r, corpo) => {
      ordem.push(`envia ${(corpo as { message: string }).message}`);
      return "X";
    });
    const ctx = semEspera({ salvarProgresso: async (p) => void ordem.push(`salva ${p}`) });
    await executarTarefa(z, c, "mensagem", v2([txt("a"), txt("b")]), g, undefined, new Set(), ctx);
    expect(ordem).toEqual(["envia a", "salva 1", "envia b", "salva 2"]);
  });

  it("retentativa depois de cair na 3ª de 3: manda só a 3ª e mantém o messageId da primeira", async () => {
    const z = zFalso();
    const ctx = semEspera({ progresso: 2, messageIdInicial: "PRIMEIRA", salvarProgresso: vi.fn(async () => {}) });
    const r = await executarTarefa(z, c, "mensagem", v2([txt("um"), txt("dois"), txt("três")], { fixar: "7d", temporarias: "24h" }), g, undefined, new Set(), ctx);
    expect(z.enviar).toHaveBeenCalledTimes(1);
    expect((z.enviar.mock.calls[0][2] as { message: string }).message).toBe("três");
    expect(ctx.salvarProgresso).toHaveBeenCalledWith(3, "PRIMEIRA");
    expect(z.mensagensTemporarias).not.toHaveBeenCalled(); // já foi ligada na primeira tentativa
    expect(z.fixarMensagem).toHaveBeenCalledWith(c, "120@g.us", "PRIMEIRA", "7d");
    expect(ctx.esperar).not.toHaveBeenCalled(); // a primeira desta rodada sai sem esperar
    expect(r.messageId).toBe("PRIMEIRA");
  });

  it("intervalo entre mensagens: 3–6 s com a opção, 1 s sem", async () => {
    expect(esperaEntreMensagens(false)).toBe(1000);
    expect(esperaEntreMensagens(true, () => 0)).toBe(3000);
    expect(esperaEntreMensagens(true, () => 1)).toBe(6000);
    const z = zFalso();
    const ctx = semEspera({ aleatorio: () => 0.5 });
    await executarTarefa(z, c, "mensagem", v2([txt("a"), txt("b"), txt("c")], { intervalo_mensagens: true }), g, undefined, new Set(), ctx);
    expect((ctx.esperar as ReturnType<typeof vi.fn>).mock.calls).toEqual([[4500], [4500]]);
    const z2 = zFalso();
    const ctx2 = semEspera();
    await executarTarefa(z2, c, "mensagem", v2([txt("a"), txt("b")]), g, undefined, new Set(), ctx2);
    expect((ctx2.esperar as ReturnType<typeof vi.fn>).mock.calls).toEqual([[1000]]);
  });

  it("sem tempo no lote: para entre mensagens, devolve pausada e não manda a próxima", async () => {
    const z = zFalso();
    const salvar = vi.fn(async () => {});
    const podeContinuar = vi.fn((espera: number) => espera < 0);
    const ctx = semEspera({ salvarProgresso: salvar, podeContinuar });
    const r = await executarTarefa(z, c, "mensagem", v2([txt("a"), txt("b"), txt("c")], { fixar: "24h" }), g, undefined, new Set(), ctx);
    expect(r).toEqual({ messageId: "M1", pausada: { esperaMs: 1000 } });
    expect(z.enviar).toHaveBeenCalledTimes(1);
    expect(salvar).toHaveBeenCalledWith(1, "M1");
    expect(podeContinuar).toHaveBeenCalledWith(1000);
    expect(z.fixarMensagem).not.toHaveBeenCalled(); // fixa só quando todas saírem
  });

  it("progresso que não grava depois do envio: para e lança ProgressoNaoSalvo (não manda a próxima)", async () => {
    const z = zFalso();
    let n = 0;
    const ctx = semEspera({
      salvarProgresso: async () => {
        if (++n === 2) throw new Error("banco fora");
      },
    });
    const erro = await executarTarefa(z, c, "mensagem", v2([txt("a"), txt("b"), txt("c")]), g, undefined, new Set(), ctx).catch((e) => e);
    expect(erro).toBeInstanceOf(ProgressoNaoSalvo);
    expect(erro.message).toContain("Mensagem 2 de 3 enviada");
    expect(erro.message).toContain("Pode ter sido feita");
    expect(z.enviar).toHaveBeenCalledTimes(2);
  });

  it("falha do Zapbot no meio: relança (a tarefa volta pra fila com o progresso das que já saíram)", async () => {
    const z = zFalso();
    z.enviar.mockResolvedValueOnce("M1").mockResolvedValueOnce("M2").mockRejectedValueOnce(new ZapbotError(500, "boom", {}));
    const salvar = vi.fn(async () => {});
    const erro = await executarTarefa(z, c, "mensagem", v2([txt("a"), txt("b"), txt("c")]), g, undefined, new Set(), semEspera({ salvarProgresso: salvar })).catch((e) => e);
    expect(classificarErro(erro)).toBe("repetir");
    expect(salvar.mock.calls).toEqual([[1, "M1"], [2, "M1"]]);
  });

  it("menciona todos nas de texto; temporárias antes da primeira; fixa a primeira no fim", async () => {
    const z = zFalso();
    const ordem: string[] = [];
    z.mensagensTemporarias.mockImplementation(async () => void ordem.push("temporarias"));
    z.enviar.mockImplementation(async (_c, rota) => (ordem.push(rota), `ID-${ordem.length}`));
    z.fixarMensagem.mockImplementation(async () => void ordem.push("fixar"));
    const conteudo = v2(
      [txt("Oi"), { formato: "imagem", midia_url: "https://x/a.jpg", nome_arquivo: null, legenda: "foto" }],
      { mencionar_todos: true, temporarias: "90d", fixar: "30d" },
    );
    const r = await executarTarefa(z, c, "mensagem", conteudo, g, undefined, new Set(), semEspera());
    expect(ordem).toEqual(["temporarias", "send-text", "send-image", "fixar"]);
    expect(z.mensagensTemporarias).toHaveBeenCalledWith(c, "120@g.us", 7776000);
    expect(z.enviar.mock.calls[0][2]).toEqual({ phone: "120@g.us", message: "Oi @all", mentionAll: true });
    expect(z.enviar.mock.calls[1][2]).toEqual({ phone: "120@g.us", image: "https://x/a.jpg", caption: "foto" });
    expect(z.fixarMensagem).toHaveBeenCalledWith(c, "120@g.us", "ID-2", "30d");
    expect(r).toEqual({ messageId: "ID-2" });
  });

  it("temporárias 24h e 7d viram 86400 e 604800", async () => {
    for (const [op, seg] of [["24h", 86400], ["7d", 604800]] as const) {
      const z = zFalso();
      await executarTarefa(z, c, "mensagem", v2([txt("a")], { temporarias: op }), g, undefined, new Set(), semEspera());
      expect(z.mensagensTemporarias).toHaveBeenCalledWith(c, "120@g.us", seg);
    }
  });

  it("falha ao fixar não falha a tarefa: vira nota", async () => {
    const z = zFalso();
    z.fixarMensagem.mockRejectedValueOnce(new ZapbotError(400, "cannot pin", {}));
    const r = await executarTarefa(z, c, "mensagem", v2([txt("a")], { fixar: "24h" }), g, undefined, new Set(), semEspera());
    expect(r.messageId).toBe("M1");
    expect(r.nota).toContain("cannot pin");
  });

  it("cada formato novo vai pra rota certa", async () => {
    const z = zFalso();
    const conteudo = v2([
      { formato: "gif", midia_url: "https://x/g.mp4", nome_arquivo: null, legenda: "uau" },
      { formato: "figurinha", midia_url: "https://x/f.webp", nome_arquivo: null, legenda: "" },
      { formato: "contato", contato: { nome: "Suporte", telefone: "5511" + "999990000" } },
      { formato: "evento", evento: { nome: "Aula", descricao: "ao vivo", inicio: "2026-10-20T23:00:00.000Z", fim: null, local: null } },
      {
        formato: "botoes",
        texto: "Escolha",
        botoes: [
          { tipo: "resposta", rotulo: "Sim", valor: "sim" },
          { tipo: "link", rotulo: "Site", valor: "https://x" },
          { tipo: "ligar", rotulo: "Ligar", valor: "+55 (11) " + "99999-0000" },
          { tipo: "copiar", rotulo: "Cupom", valor: "VORTEX10" },
        ],
      },
      { formato: "enquete", enquete: { pergunta: "Vem?", opcoes: ["Sim", "Não"], max_respostas: 1 } },
      { formato: "documento", midia_url: "https://x/a.pdf", nome_arquivo: "a.pdf", legenda: "" },
      { formato: "audio", midia_url: "https://x/a.ogg", nome_arquivo: null, legenda: "ignorada" },
    ], { mencionar_todos: true });
    await executarTarefa(z, c, "mensagem", conteudo, g, undefined, new Set(), semEspera());
    expect(z.enviarGif).toHaveBeenCalledWith(c, "120@g.us", "https://x/g.mp4", "uau");
    expect(z.enviarFigurinha).toHaveBeenCalledWith(c, "120@g.us", "https://x/f.webp");
    expect(z.enviarContato).toHaveBeenCalledWith(c, "120@g.us", "Suporte", "5511" + "999990000");
    expect(z.enviarEvento).toHaveBeenCalledWith(c, "120@g.us", { nome: "Aula", descricao: "ao vivo", inicio: Date.parse("2026-10-20T23:00:00.000Z") / 1000, fim: null, local: null });
    expect(z.enviarBotoes).toHaveBeenCalledWith(c, "120@g.us", "Escolha", [
      { type: "REPLY", id: "sim", label: "Sim" },
      { type: "URL", label: "Site", url: "https://x" },
      { type: "CALL", label: "Ligar", phone: "5511" + "999990000" },
      { type: "COPY", label: "Cupom", copyCode: "VORTEX10" },
    ]);
    expect(z.enviarEnquete).toHaveBeenCalledWith(c, "120@g.us", "Vem?", ["Sim", "Não"], 1);
    expect(z.enviar.mock.calls.map((x) => [x[1], x[2]])).toEqual([
      ["send-document/pdf", { phone: "120@g.us", document: "https://x/a.pdf", fileName: "a.pdf" }],
      ["send-audio", { phone: "120@g.us", audio: "https://x/a.ogg" }],
    ]);
  });

  it("404 no envio com número conectado: grupo sumiu (falha)", async () => {
    const z = zFalso();
    z.enviar.mockRejectedValueOnce(new ZapbotError(404, "Not Found", {}));
    const aoGrupoSumir = vi.fn(async () => {});
    const erro = await executarTarefa(z, c, "mensagem", v2([txt("a")]), g, aoGrupoSumir, new Set(), semEspera()).catch((e) => e);
    expect(classificarErro(erro)).toBe("falha");
    expect(aoGrupoSumir).toHaveBeenCalledTimes(1);
  });
});

describe("tipos novos", () => {
  it("configuracao: só os campos escolhidos (announce/locked no group-settings, aprovação no group-mode)", async () => {
    const z = zFalso();
    await executarTarefa(z, c, "configuracao", { so_admins_enviam: true, so_admins_editam: false, aprovacao_entrada: true }, g);
    expect(z.configurarGrupo).toHaveBeenCalledWith(c, { groupId: "120@g.us", announce: true, locked: false });
    expect(z.modoEntrada).toHaveBeenCalledWith(c, "120@g.us", true);

    const z2 = zFalso();
    await executarTarefa(z2, c, "configuracao", { aprovacao_entrada: false }, g);
    expect(z2.configurarGrupo).not.toHaveBeenCalled();
    expect(z2.modoEntrada).toHaveBeenCalledWith(c, "120@g.us", false);

    const z3 = zFalso();
    await executarTarefa(z3, c, "configuracao", { so_admins_editam: true }, g);
    expect(z3.configurarGrupo).toHaveBeenCalledWith(c, { groupId: "120@g.us", locked: true });
    expect(z3.modoEntrada).not.toHaveBeenCalled();
  });

  it("configuracao: temporarias (Alterar grupos em lote, Etapa 3E) liga/desliga chat-disappearing, diferente da opção de envio", async () => {
    const z = zFalso();
    await executarTarefa(z, c, "configuracao", { temporarias: "7d" }, g);
    expect(z.mensagensTemporarias).toHaveBeenCalledWith(c, "120@g.us", 604800);

    const z2 = zFalso();
    await executarTarefa(z2, c, "configuracao", { temporarias: "nao" }, g);
    expect(z2.mensagensTemporarias).toHaveBeenCalledWith(c, "120@g.us", 0);

    const z3 = zFalso();
    await executarTarefa(z3, c, "configuracao", { so_admins_enviam: true }, g);
    expect(z3.mensagensTemporarias).not.toHaveBeenCalled();
  });

  it("remover_participantes: nunca remove admin nem número conectado; usa o telefone como está no grupo", async () => {
    const z = zFalso([
      { phone: "553780001001@s.whatsapp.net", isAdmin: false }, // sem nono dígito no WhatsApp
      { phone: "5511" + "911112222", isAdmin: true },
      { phone: "5511" + "933334444", isAdmin: false }, // número conectado
    ]);
    const protegidos = new Set(["5511" + "933334444"]);
    const r = await executarTarefa(z, c, "remover_participantes", { telefones: ["5537" + "980001001", "5511" + "911112222", "5511" + "933334444", "5511" + "900000000"] }, g, undefined, protegidos);
    expect(z.removerParticipantes).toHaveBeenCalledTimes(1);
    expect(z.removerParticipantes).toHaveBeenCalledWith(c, "120@g.us", ["553780001001"]);
    expect(z.participantes).not.toHaveBeenCalled();
    expect(r.removidos).toEqual(["553780001001"]);
    expect(r.nota).toBe("1 removido(s); 1 número(s) conectado(s) no sistema não removido(s); 1 admin(s) não removido(s); 1 já fora do grupo.");
  });

  it("remover_participantes: ninguém pra remover não chama o Zapbot; grupo sumido vira falha", async () => {
    const z = zFalso([{ phone: "5511" + "911112222", isAdmin: true }]);
    const r = await executarTarefa(z, c, "remover_participantes", { telefones: ["5511" + "911112222"] }, g);
    expect(z.removerParticipantes).not.toHaveBeenCalled();
    expect(r).toEqual({ messageId: null, removidos: [], nota: "0 removido(s); 1 admin(s) não removido(s)." });

    const sumiu = zFalso(null);
    const erro = await executarTarefa(sumiu, c, "remover_participantes", { telefones: ["5511" + "900000000"] }, g).catch((e) => e);
    expect(classificarErro(erro)).toBe("falha");
  });

  it("remover_participantes: lista grande vai em lotes de 50", async () => {
    const tels = Array.from({ length: 120 }, (_, i) => `55119${String(10000000 + i)}`);
    const z = zFalso(tels.map((phone) => ({ phone, isAdmin: false })));
    const r = await executarTarefa(z, c, "remover_participantes", { telefones: tels }, g);
    expect(z.removerParticipantes.mock.calls.map((x) => x[2].length)).toEqual([50, 50, 20]);
    expect(r.removidos).toHaveLength(120);
    expect(r.nota).toBeUndefined();
  });

  it("remover_participantes: marca como removido só quem a resposta diz que saiu", async () => {
    const z = zFalso([{ phone: "5511" + "900000001", isAdmin: false }, { phone: "553780001001", isAdmin: false }]);
    z.removerParticipantes.mockResolvedValueOnce(["5511" + "900000001"]);
    const r = await executarTarefa(z, c, "remover_participantes", { telefones: ["5511" + "900000001", "5537" + "980001001"] }, g);
    expect(r.removidos).toEqual(["5511" + "900000001"]);
    expect(r.nota).toBe("1 removido(s); 1 recusado(s) pelo WhatsApp.");
  });

  it("desativar_comunidade: desativa a comunidade da campanha (conteudo.comunidade_id), não o grupo da tarefa", async () => {
    const z = zFalso();
    expect(await executarTarefa(z, c, "desativar_comunidade", {}, g)).toEqual({ messageId: null, nota: "Campanha sem comunidade." });
    expect(z.desativarComunidade).not.toHaveBeenCalled();
    expect(await executarTarefa(z, c, "desativar_comunidade", { comunidade_id: "999@g.us" }, g)).toEqual({ messageId: null, comunidadeDesativada: "999@g.us" });
    expect(z.desativarComunidade).toHaveBeenCalledWith(c, "999@g.us");
  });

  it("desativar_comunidade: 404 (número conectado) é a comunidade que sumiu — falha, sem desativar o grupo", async () => {
    const z = zFalso();
    z.desativarComunidade.mockRejectedValueOnce(new ZapbotError(404, "Not Found", {}));
    const aoGrupoSumir = vi.fn(async () => {});
    const erro = await executarTarefa(z, c, "desativar_comunidade", { comunidade_id: "999@g.us" }, g, aoGrupoSumir).catch((e) => e);
    expect(erro.message).toBe("A comunidade não existe mais no WhatsApp.");
    expect(classificarErro(erro)).toBe("falha");
    expect(aoGrupoSumir).not.toHaveBeenCalled();
  });

  it("atualizar_links: pega o link atual (sem reset) e devolve pro banco", async () => {
    const z = zFalso();
    expect(await executarTarefa(z, c, "atualizar_links", {}, g)).toEqual({ messageId: null, grupo: { link_convite: "https://chat.whatsapp.com/ATUAL" } });
    expect(z.linkConvite).toHaveBeenCalledWith(c, "120@g.us");
  });

  it("mover_grupos não chama o Zapbot", async () => {
    const z = zFalso();
    const r = await executarTarefa(z, c, "mover_grupos", { campanha_destino: "x" }, g);
    expect(r.nota).toBeTruthy();
    for (const f of Object.values(z)) expect(f).not.toHaveBeenCalled();
  });
});
