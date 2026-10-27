import { describe, expect, it, vi } from "vitest";
import { executarTarefa } from "@/src/lib/jobs/executar-tarefa";
import { ZapbotError } from "@/src/lib/zapbot/client";
import { classificarErro } from "@/src/lib/zapbot/erros";

const c = { id: "i", token: "t", clientToken: "ct" };
const g = { groupId: "120@g.us", numero: 7 };

function zFalso(membros: string[] | null = []) {
  return {
    enviar: vi.fn(async () => "MSG1"),
    enviarEnquete: vi.fn(async () => "POLL1"),
    configurarGrupo: vi.fn(async () => {}),
    participantes: vi.fn(async () => {}),
    obterGrupo: vi.fn(async () =>
      membros === null ? null : { groupId: g.groupId, name: "G", amAdmin: true, participantCount: membros.length, participants: membros.map((phone) => ({ phone, isAdmin: false })) },
    ),
    linkConvite: vi.fn(async () => "https://chat.whatsapp.com/NOVO"),
    status: vi.fn(async () => ({ connected: true, phone: "5537" + "980001001" })),
    enviarFigurinha: vi.fn(async () => "STK"),
    enviarGif: vi.fn(async () => "GIF"),
    enviarContato: vi.fn(async () => "CTT"),
    enviarEvento: vi.fn(async () => "EVT"),
    enviarBotoes: vi.fn(async () => "BTN"),
    fixarMensagem: vi.fn(async () => {}),
    mensagensTemporarias: vi.fn(async () => {}),
    modoEntrada: vi.fn(async () => {}),
    desativarComunidade: vi.fn(async () => {}),
    removerParticipantes: vi.fn(async () => null),
    privacidadeAvancada: vi.fn(async () => {}),
    trocarFoto: vi.fn(async () => {}),
  };
}

describe("executarTarefa", () => {
  it("mensagem usa a rota e o corpo da Fase 1 e devolve o messageId", async () => {
    const z = zFalso();
    const r = await executarTarefa(z, c, "mensagem", { formato: "texto", texto: "Começou!", midia_url: null, nome_arquivo: null, mencionar_todos: true }, g);
    expect(r).toEqual({ messageId: "MSG1" });
    expect(z.enviar).toHaveBeenCalledWith(c, "send-text", { phone: "120@g.us", message: "Começou! @all", mentionAll: true });
  });

  it("enquete manda send-poll com pergunta, opções e máximo", async () => {
    const z = zFalso();
    const r = await executarTarefa(z, c, "enquete", { pergunta: "Vem?", opcoes: ["Sim", "Não"], max_respostas: 1 }, g);
    expect(r).toEqual({ messageId: "POLL1" });
    expect(z.enviarEnquete).toHaveBeenCalledWith(c, "120@g.us", "Vem?", ["Sim", "Não"], 1);
  });

  it("nome troca {n} pelo número do grupo e devolve o nome pro banco", async () => {
    const z = zFalso();
    expect(await executarTarefa(z, c, "nome", { padrao: "🔴 AO VIVO #{n}" }, g)).toEqual({ messageId: null, grupo: { nome: "🔴 AO VIVO #07" } });
    expect(z.configurarGrupo).toHaveBeenCalledWith(c, { groupId: "120@g.us", name: "🔴 AO VIVO #07" });
  });

  it("descrição, abrir e fechar mexem só no campo certo", async () => {
    const z = zFalso();
    await executarTarefa(z, c, "descricao", { texto: "Aula hoje" }, g);
    await executarTarefa(z, c, "abrir", {}, g);
    await executarTarefa(z, c, "fechar", {}, g);
    expect(z.configurarGrupo.mock.calls.map((x) => (x as unknown[])[1])).toEqual([
      { groupId: "120@g.us", description: "Aula hoje" },
      { groupId: "120@g.us", announce: false },
      { groupId: "120@g.us", announce: true },
    ]);
  });

  it("admin_add adiciona antes quando não é membro e promove", async () => {
    const z = zFalso(["5511" + "999990000"]);
    await executarTarefa(z, c, "admin_add", { telefone: "5537" + "980001001" }, g);
    expect(z.participantes.mock.calls.map((x) => (x as unknown[])[3])).toEqual(["add", "promote"]);
  });

  it("admin_add só promove quando já é membro (casa o nono dígito e o @s.whatsapp.net)", async () => {
    const z = zFalso(["553780001001@s.whatsapp.net"]);
    await executarTarefa(z, c, "admin_add", { telefone: "5537" + "980001001" }, g);
    expect(z.participantes.mock.calls.map((x) => (x as unknown[])[3])).toEqual(["promote"]);
  });

  it("admin_remover rebaixa só se for membro", async () => {
    const fora = zFalso([]);
    await executarTarefa(fora, c, "admin_remover", { telefone: "5537" + "980001001" }, g);
    expect(fora.participantes).not.toHaveBeenCalled();
    const dentro = zFalso(["5537" + "980001001"]);
    await executarTarefa(dentro, c, "admin_remover", { telefone: "5537" + "980001001" }, g);
    expect(dentro.participantes).toHaveBeenCalledWith(c, "120@g.us", ["5537" + "980001001"], "demote");
  });

  it("admin_remover de um número conectado (com ou sem nono dígito): não rebaixa e devolve a nota", async () => {
    const z = zFalso(["5537" + "980001001"]);
    const protegidos = new Set(["553780001001"]);
    const r = await executarTarefa(z, c, "admin_remover", { telefone: "5537" + "980001001" }, g, undefined, protegidos);
    expect(r).toEqual({ messageId: null, nota: "Número conectado no sistema: não foi rebaixado." });
    expect(z.participantes).not.toHaveBeenCalled();
    expect(z.obterGrupo).not.toHaveBeenCalled();
  });

  it("grupo que sumiu vira falha (não repete e não derruba o número)", async () => {
    const z = zFalso(null);
    const erro = await executarTarefa(z, c, "admin_add", { telefone: "5537" + "980001001" }, g).catch((e) => e);
    expect(erro.message).toBe("O grupo não existe mais no WhatsApp.");
    expect(classificarErro(erro)).toBe("falha");
  });

  it("redefinir link pede reset e devolve o link novo pro banco", async () => {
    const z = zFalso();
    expect(await executarTarefa(z, c, "redefinir_link", {}, g)).toEqual({ messageId: null, grupo: { link_convite: "https://chat.whatsapp.com/NOVO" } });
    expect(z.linkConvite).toHaveBeenCalledWith(c, "120@g.us", true);
  });
});

describe("executarTarefa — 404 numa rota de grupo", () => {
  const erro404 = () => new ZapbotError(404, "Not Found", {});
  const casos: [string, unknown, (z: ReturnType<typeof zFalso>) => void][] = [
    ["mensagem", { formato: "texto", texto: "Oi", midia_url: null, nome_arquivo: null, mencionar_todos: false }, (z) => z.enviar.mockRejectedValueOnce(erro404())],
    ["enquete", { pergunta: "Vem?", opcoes: ["Sim", "Não"], max_respostas: 1 }, (z) => z.enviarEnquete.mockRejectedValueOnce(erro404())],
    ["nome", { padrao: "Turma #{n}" }, (z) => z.configurarGrupo.mockRejectedValueOnce(erro404())],
    ["fechar", {}, (z) => z.configurarGrupo.mockRejectedValueOnce(erro404())],
    ["admin_add", { telefone: "5537" + "980001001" }, (z) => z.participantes.mockRejectedValueOnce(erro404())],
    ["redefinir_link", {}, (z) => z.linkConvite.mockRejectedValueOnce(erro404())],
  ];

  for (const [tipo, conteudo, falhar] of casos) {
    it(`${tipo}: número conectado → grupo sumiu (falha, não desconecta) e avisa uma vez`, async () => {
      const z = zFalso();
      falhar(z);
      const aoGrupoSumir = vi.fn(async () => {});
      const erro = await executarTarefa(z, c, tipo as never, conteudo, g, aoGrupoSumir).catch((e) => e);
      expect(erro).toBeInstanceOf(ZapbotError);
      expect(erro.status).toBe(400);
      expect(erro.message).toBe("O grupo não existe mais no WhatsApp.");
      expect(classificarErro(erro)).toBe("falha");
      expect(z.status).toHaveBeenCalledWith(c);
      expect(aoGrupoSumir).toHaveBeenCalledTimes(1);
    });
  }

  it("número desconectado → relança o 404 original (desconectado) e não mexe no grupo", async () => {
    const z = zFalso();
    const original = erro404();
    z.enviar.mockRejectedValueOnce(original);
    z.status.mockResolvedValueOnce({ connected: false, phone: "" });
    const aoGrupoSumir = vi.fn(async () => {});
    const erro = await executarTarefa(z, c, "mensagem", { formato: "texto", texto: "Oi", midia_url: null, nome_arquivo: null, mencionar_todos: false }, g, aoGrupoSumir).catch((e) => e);
    expect(erro).toBe(original);
    expect(classificarErro(erro)).toBe("desconectado");
    expect(aoGrupoSumir).not.toHaveBeenCalled();
  });

  it("status também falha → relança o 404 original", async () => {
    const z = zFalso();
    const original = erro404();
    z.configurarGrupo.mockRejectedValueOnce(original);
    z.status.mockRejectedValueOnce(new ZapbotError(404, "Not Found", {}));
    const aoGrupoSumir = vi.fn(async () => {});
    const erro = await executarTarefa(z, c, "abrir", {}, g, aoGrupoSumir).catch((e) => e);
    expect(erro).toBe(original);
    expect(aoGrupoSumir).not.toHaveBeenCalled();
  });

  it("erro que não é 404 não consulta o status", async () => {
    const z = zFalso();
    z.enviar.mockRejectedValueOnce(new ZapbotError(500, "boom", {}));
    const erro = await executarTarefa(z, c, "mensagem", { formato: "texto", texto: "Oi", midia_url: null, nome_arquivo: null, mencionar_todos: false }, g).catch((e) => e);
    expect(erro.status).toBe(500);
    expect(z.status).not.toHaveBeenCalled();
  });

  it("aviso que lança não troca o erro da tarefa", async () => {
    const z = zFalso();
    z.configurarGrupo.mockRejectedValueOnce(erro404());
    const erro = await executarTarefa(z, c, "descricao", { texto: "x" }, g, async () => { throw new Error("banco fora"); }).catch((e) => e);
    expect(erro.message).toBe("O grupo não existe mais no WhatsApp.");
  });

  it("grupo que não veio no obterGrupo (admin) também avisa", async () => {
    const z = zFalso(null);
    const aoGrupoSumir = vi.fn(async () => {});
    await executarTarefa(z, c, "admin_remover", { telefone: "5537" + "980001001" }, g, aoGrupoSumir).catch(() => {});
    expect(aoGrupoSumir).toHaveBeenCalledTimes(1);
  });
});

describe("executarTarefa — nome com caractere da numeração (Etapa 3E)", () => {
  it("com caractere no conteúdo, vai antes do número; sem, igual a antes", async () => {
    const z = zFalso();
    expect(await executarTarefa(z, c, "nome", { padrao: "AO VIVO {n}", caractere: "#" }, g)).toEqual({ messageId: null, grupo: { nome: "AO VIVO #07" } });
    expect(await executarTarefa(z, c, "nome", { padrao: "AO VIVO #{n}" }, g)).toEqual({ messageId: null, grupo: { nome: "AO VIVO #07" } });
  });
});
