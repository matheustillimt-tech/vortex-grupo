import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, filtro, type Chamada, type Resposta } from "./apoio/db-falso";
import { liberarTudo } from "./apoio/permissoes";

const h = vi.hoisted(() => ({
  db: undefined as unknown,
  resolverLid: vi.fn(async (..._a: unknown[]): Promise<{ telefone: string | null; lid: string } | null> => ({ telefone: "5511" + "977776666", lid: "123456789012345" })),
  participantes: vi.fn(async () => undefined),
  alertar: vi.fn(async () => undefined),
}));
vi.mock("@/src/lib/permissoes", async () => (await import("./apoio/permissoes")).permissoesFalsas());
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => h.db }));
vi.mock("@/src/lib/supabase/usuario", () => ({ exigirUsuario: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/src/lib/historico", () => ({ registrarHistorico: vi.fn() }));
vi.mock("@/src/lib/jobs/alertas", () => ({ alertar: h.alertar }));
vi.mock("@/src/lib/jobs/grupo-novo", () => ({ criarGatilhosGrupoNovo: vi.fn(async () => 0) }));
vi.mock("@/src/lib/conexoes", () => ({ paraZapbot: vi.fn((c: { id: string }) => ({ id: c.id, token: "t", clientToken: "c" })), credenciais: vi.fn(async (id: string) => ({ id, token: "t", clientToken: "c" })) }));
vi.mock("@/src/lib/zapbot/client", async (orig) => ({
  ...(await orig<typeof import("@/src/lib/zapbot/client")>()),
  zapbot: () => ({ resolverLid: h.resolverLid, participantes: h.participantes }),
}));

import { adicionarNumeroBloqueado, desbloquearBloqueados } from "@/app/(painel)/anti-spam/actions";
import { bloquearTelefones, reenfileirarBloqueados } from "@/src/lib/bloqueio";
import { executarContato, processarAcoes } from "@/src/lib/jobs/acoes";
import { tratarRodada, type Rodada } from "@/src/lib/jobs/pessoas";
import { AJUDA_ADMINISTRATIVOS, AJUDA_GOLPISTA, ERRO_LID, lidDoId } from "@/src/lib/regras/administrativos";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const LID = "123456789012345";

beforeEach(() => {
  vi.clearAllMocks();
  liberarTudo();
  h.resolverLid.mockImplementation(async () => ({ telefone: "5511" + "977776666", lid: LID }));
});

function usar(responder: (c: Chamada) => Resposta | undefined = () => undefined) {
  const f = dbFalso((c) => responder(c) ?? (c.op === "select" ? { data: [] } : {}));
  h.db = f.db;
  return f.chamadas;
}
const conectadas = (c: Chamada) => (c.tabela === "conexoes" && c.op === "select" && filtro(c, "eq", "status") === "conectado" ? { data: [{ id: A }, { id: B }] } : undefined);

describe("lidDoId", () => {
  it("…@lid e só dígitos são candidatos; jid de telefone e texto não", () => {
    expect(lidDoId(`${LID}@lid`)).toBe(LID);
    expect(lidDoId(LID)).toBe(LID);
    expect(lidDoId("5511" + "977776666@s.whatsapp.net")).toBeNull();
    expect(lidDoId("abc")).toBeNull();
  });
});

describe("Bloquear por LID (diálogo Adicionar número)", () => {
  it("telefone + interruptor: resolve-lid numa conexão conectada e grava telefone e LID", async () => {
    const chamadas = usar(conectadas);
    const r = await adicionarNumeroBloqueado("Golpe", "(11) " + "97777-6666", { porLid: true });
    expect(r.erro).toBeUndefined();
    expect(h.resolverLid).toHaveBeenCalledWith({ id: A, token: "t", clientToken: "c" }, "5511" + "977776666", { prazoTotalMs: 20_000 });
    const up = chamadas.find((c) => c.tabela === "bloqueados" && c.op === "upsert")!;
    expect(up.dados).toEqual([{ telefone: "5511" + "977776666", motivo: null, origem: "manual", criado_por: "u1", nome: "Golpe", lid: LID }]);
    // Quem está no grupo com o id LID também é procurado.
    const p = chamadas.find((c) => c.tabela === "participantes")!;
    expect(filtro(p, "in", "telefone")).toEqual(["5511" + "977776666", "551177776666", LID, `${LID}@lid`]);
  });

  it("LID digitado: o resolve-lid devolve o número e os dois são gravados", async () => {
    const chamadas = usar(conectadas);
    expect((await adicionarNumeroBloqueado("Golpe", `${LID}@lid`, { porLid: true })).erro).toBeUndefined();
    expect(h.resolverLid).toHaveBeenCalledWith(expect.anything(), LID, { prazoTotalMs: 20_000 });
    expect((chamadas.find((c) => c.op === "upsert")!.dados as { telefone: string; lid: string }[])[0]).toMatchObject({ telefone: "5511" + "977776666", lid: LID });
  });

  it("conexão autorizada do anti-spam vem primeiro", async () => {
    usar((c) => conectadas(c) ?? (c.tabela === "configuracoes" ? { data: { valor: { ligado: true, contas: [B] } } } : undefined));
    await adicionarNumeroBloqueado("Golpe", "11" + "977776666", { porLid: true });
    expect(h.resolverLid.mock.calls[0][0]).toEqual({ id: B, token: "t", clientToken: "c" });
  });

  it("sem conexão conectada ou sem resposta: erro e nada gravado", async () => {
    let chamadas = usar();
    expect(await adicionarNumeroBloqueado("Golpe", "11" + "977776666", { porLid: true })).toEqual({ erro: ERRO_LID });
    expect(chamadas.some((c) => c.tabela === "bloqueados")).toBe(false);
    h.resolverLid.mockImplementation(async () => {
      throw new Error("timeout");
    });
    chamadas = usar(conectadas);
    expect(await adicionarNumeroBloqueado("Golpe", "11" + "977776666", { porLid: true })).toEqual({ erro: ERRO_LID });
    h.resolverLid.mockImplementation(async () => null);
    chamadas = usar(conectadas);
    expect(await adicionarNumeroBloqueado("Golpe", "11" + "977776666", { porLid: true })).toEqual({ erro: ERRO_LID });
    // LID digitado e o Zapbot não devolveu o número: não salva meio-termo.
    h.resolverLid.mockImplementation(async () => ({ telefone: null, lid: LID }));
    chamadas = usar(conectadas);
    expect(await adicionarNumeroBloqueado("Golpe", LID, { porLid: true })).toEqual({ erro: ERRO_LID });
    expect(chamadas.some((c) => c.tabela === "bloqueados" || c.tabela === "acoes")).toBe(false);
  });

  it("interruptor desligado: o caminho de sempre (nenhuma chamada ao Zapbot)", async () => {
    const chamadas = usar();
    expect((await adicionarNumeroBloqueado("Golpe", "11" + "977776666")).erro).toBeUndefined();
    expect(h.resolverLid).not.toHaveBeenCalled();
    expect((chamadas.find((c) => c.op === "upsert")!.dados as object[])[0]).toEqual({ telefone: "5511" + "977776666", motivo: null, origem: "manual", criado_por: "u1", nome: "Golpe" });
  });
});

const rodada: Rodada = { grupoId: "g1", grupoNome: "G", campanhaId: "c1", campanhaNome: "C", entraram: [], sairam: [], protegidos: [], agora: "2026-10-17T12:00:00.000Z" };

describe("conferência casa participante por LID", () => {
  it("entrou como …@lid e o LID está bloqueado: nada na fila, um alerta por grupo por dia", async () => {
    const { db, chamadas } = dbFalso((c) => {
      if (c.tabela === "bloqueados" && filtro(c, "in", "lid")) return { data: [{ lid: LID }] };
      if (c.tabela === "rpc:tag_da_campanha") return { data: "tag" };
      if (c.op === "select") return { data: [] };
      return {};
    });
    const plano = await tratarRodada(db, { ...rodada, entraram: [{ telefone: `${LID}@lid`, admin: false }, { telefone: "553711110002", admin: false }] });
    expect(plano.removerBloqueio).toEqual([]);
    // Também não vira duplicado.
    expect(plano.removerDuplicado).toEqual([]);
    expect(filtro(chamadas.find((c) => c.tabela === "bloqueados")!, "in", "lid")).toEqual([LID, "553711110002"]);
    expect(chamadas.some((c) => c.tabela === "acoes" && c.op === "insert")).toBe(false);
    expect(h.alertar).toHaveBeenCalledTimes(1);
    expect(h.alertar).toHaveBeenCalledWith(expect.objectContaining({ tipo: "bloqueado_removido", texto: "Contato bloqueado no grupo G aparece só como LID — remova à mão", campanhaId: "c1" }), db);
    const conferiu = chamadas.find((c) => c.tabela === "alertas" && c.op === "select")!;
    expect(filtro(conferiu, "eq", "texto")).toBe("Contato bloqueado no grupo G aparece só como LID — remova à mão");
    expect(filtro(conferiu, "gte", "created_at")).toBeTruthy();
  });

  it("alerta de LID já levantado hoje pra esse grupo: não repete", async () => {
    const { db } = dbFalso((c) => {
      if (c.tabela === "bloqueados" && filtro(c, "in", "lid")) return { data: [{ lid: LID }] };
      if (c.tabela === "alertas" && c.op === "select") return { data: [{ id: "x" }] };
      if (c.tabela === "rpc:tag_da_campanha") return { data: "tag" };
      if (c.op === "select") return { data: [] };
      return {};
    });
    await tratarRodada(db, { ...rodada, entraram: [{ telefone: `${LID}@lid`, admin: false }] });
    expect(h.alertar).not.toHaveBeenCalled();
  });

  it("regressão: bloqueado antigo (sem lid) que entra pelo telefone é removido igual a hoje", async () => {
    const { db, chamadas } = dbFalso((c) => {
      if (c.tabela === "bloqueados_efetivos") return { data: [{ telefone: "553711110001" }] };
      if (c.tabela === "rpc:tag_da_campanha") return { data: "tag" };
      if (c.op === "select") return { data: [] };
      return {};
    });
    const plano = await tratarRodada(db, { ...rodada, entraram: [{ telefone: "553711110001", admin: false }] });
    expect(plano.removerBloqueio).toEqual(["553711110001"]);
    // Já casou pelo telefone: nem pergunta o LID.
    expect(chamadas.some((c) => c.tabela === "bloqueados")).toBe(false);
  });

  it("análise de grupos: quem está no grupo só com o id LID não entra na fila, vira alerta (um por grupo)", async () => {
    const { db, chamadas } = dbFalso((c) => {
      if (c.tabela === "bloqueados") return { data: [{ lid: LID }] };
      if (c.tabela === "participantes")
        return {
          data: [
            { telefone: `${LID}@lid`, grupo_id: "g1", grupos: { campanha_id: "c1", conexao_id: "x", nome: "Grupo 1" } },
            { telefone: LID, grupo_id: "g1", grupos: { campanha_id: "c1", conexao_id: "x", nome: "Grupo 1" } },
            { telefone: "5511" + "977776666", grupo_id: "g2", grupos: { campanha_id: "c1", conexao_id: "x", nome: "Grupo 2" } },
          ],
        };
      return { data: [] };
    });
    expect(await reenfileirarBloqueados(db, ["5511" + "977776666"])).toBe(1);
    expect(filtro(chamadas.find((c) => c.tabela === "participantes")!, "in", "telefone")).toEqual(["5511" + "977776666", "551177776666", LID, `${LID}@lid`]);
    const fila = chamadas.filter((c) => c.tabela === "acoes" && c.op === "insert").map((c) => (c.dados as { telefone: string }).telefone);
    expect(fila).toEqual(["5511" + "977776666"]);
    expect(h.alertar).toHaveBeenCalledTimes(1);
    expect(h.alertar).toHaveBeenCalledWith(expect.objectContaining({ texto: "Contato bloqueado no grupo Grupo 1 aparece só como LID — remova à mão" }), db);
  });

  it("bloquear com LID: participante só com o id LID não entra na fila", async () => {
    const { db, chamadas } = dbFalso((c) => {
      if (c.tabela === "participantes") return { data: [{ telefone: `${LID}@lid`, grupo_id: "g1", grupos: { campanha_id: "c1", conexao_id: "x", nome: "Grupo 1" } }] };
      return c.op === "select" ? { data: [] } : {};
    });
    const r = await bloquearTelefones(db, [{ telefone: "5511" + "977776666", motivo: null, lid: LID }], "manual", null);
    expect(r.remocoes).toBe(0);
    expect(chamadas.some((c) => c.tabela === "acoes" && c.op === "insert")).toBe(false);
    expect(h.alertar).toHaveBeenCalledTimes(1);
  });

  it("na hora de remover: remoção de bloqueado por id LID (já na fila) não chama o Zapbot, fecha com nota e alerta", async () => {
    const { db, chamadas } = dbFalso((c) => {
      if (c.tabela === "rpc:pegar_acoes") return { data: [{ id: "a1", tipo: "remover", campanha_id: "c1", grupo_id: "g1", telefone: `${LID}@lid`, dados: {}, tentativas: 1, origem: "bloqueado" }] };
      if (c.tabela === "grupos") return { data: { group_id: "120@g.us", conexao_id: "x", nome: "Grupo 1" } };
      if (c.tabela === "participantes" && c.op === "select") return { data: [{ admin: false }] };
      if (c.tabela === "bloqueados" && filtro(c, "eq", "lid") === LID) return { data: [{ telefone: "5511" + "977776666" }] };
      return { data: [] };
    });
    h.db = db;
    await processarAcoes({ ate: Date.now() + 55_000 });
    expect(h.participantes).not.toHaveBeenCalled();
    expect(chamadas.find((c) => c.tabela === "acoes" && c.op === "update")!.dados).toMatchObject({ status: "ok" });
    expect(h.alertar).toHaveBeenCalledWith(expect.objectContaining({ texto: "Contato bloqueado no grupo Grupo 1 aparece só como LID — remova à mão" }), db);
  });
});

describe("tela Números administrativos", () => {
  it("avisa que esses números não disparam automações de pessoa", () => {
    expect(AJUDA_ADMINISTRATIVOS).toContain("não disparam automações de pessoa");
    const pagina = readFileSync(path.resolve(__dirname, "../app/(painel)/anti-spam/administrativos/page.tsx"), "utf8");
    expect(pagina).toContain("subtitulo={AJUDA_ADMINISTRATIVOS}");
  });
});

describe("Denunciar golpista", () => {
  it("texto honesto: o Zapbot não denuncia", () => {
    expect(AJUDA_GOLPISTA).toBe("O Zapbot não tem denúncia ao WhatsApp. O número é bloqueado no WhatsApp de todas as conexões conectadas e marcado como golpista aqui.");
  });

  it("marca golpista e cria uma ação bloquear_contato por conexão conectada", async () => {
    const chamadas = usar(conectadas);
    const r = await adicionarNumeroBloqueado("Golpe", "11" + "977776666", { golpista: true });
    expect(r).toMatchObject({ contas: 2 });
    const up = chamadas.find((c) => c.tabela === "bloqueados" && c.op === "update")!;
    expect(up.dados).toMatchObject({ golpista: true, denunciado_em: expect.any(String) });
    expect(filtro(up, "in", "telefone")).toEqual(["5511" + "977776666", "551177776666"]);
    expect(chamadas.find((c) => c.tabela === "acoes" && c.op === "insert")!.dados).toEqual([
      { tipo: "bloquear_contato", telefone: null, dados: { telefone: "5511" + "977776666", conexao_id: A }, origem: "antispam" },
      { tipo: "bloquear_contato", telefone: null, dados: { telefone: "5511" + "977776666", conexao_id: B }, origem: "antispam" },
    ]);
  });

  it("número administrativo não vira golpista: recusado antes de tudo", async () => {
    const chamadas = usar((c) => conectadas(c) ?? (c.tabela === "numeros_administrativos" ? { data: [{ telefone: "5511" + "977776666" }] } : undefined));
    expect(await adicionarNumeroBloqueado("Golpe", "11" + "977776666", { golpista: true })).toEqual({ erro: "55 11 " + "97777-6666 é um número administrativo" });
    expect(chamadas.some((c) => c.tabela === "acoes" || (c.tabela === "bloqueados" && c.op !== "select"))).toBe(false);
  });

  it("processarAcoes: bloquear_contato chama block na conexão; desbloquear_contato chama unblock", async () => {
    const z = { bloquearContato: vi.fn(async () => undefined), desbloquearContato: vi.fn(async () => undefined) };
    const { db } = dbFalso((c) => (c.tabela === "conexoes" ? { data: { nome: "Conexão A", status: "conectado" } } : {}));
    const cred = vi.fn(async (id: string) => ({ id, token: "t", clientToken: "c" }));
    await executarContato(z, db, "bloquear_contato", { telefone: "5511" + "977776666", conexao_id: A }, cred);
    await executarContato(z, db, "desbloquear_contato", { telefone: "5511" + "977776666", conexao_id: A }, cred);
    expect(z.bloquearContato).toHaveBeenCalledWith({ id: A, token: "t", clientToken: "c" }, "5511" + "977776666");
    expect(z.desbloquearContato).toHaveBeenCalledWith({ id: A, token: "t", clientToken: "c" }, "5511" + "977776666");
  });

  it("conexão desconectada: erro (a fila tenta de novo e depois alerta)", async () => {
    const z = { bloquearContato: vi.fn(async () => undefined), desbloquearContato: vi.fn(async () => undefined) };
    const { db } = dbFalso((c) => (c.tabela === "conexoes" ? { data: { nome: "Conexão A", status: "desconectado" } } : {}));
    await expect(executarContato(z, db, "bloquear_contato", { telefone: "5511" + "977776666", conexao_id: A })).rejects.toThrow("Conexão desconectada.");
    expect(z.bloquearContato).not.toHaveBeenCalled();
  });

  it("desbloquear golpista: caixa desmarcada = só libera aqui; marcada = desbloquear_contato por conexão", async () => {
    let chamadas = usar(conectadas);
    expect(await desbloquearBloqueados(["11" + "977776666"], false)).toEqual({ desbloqueados: 1, contas: 0 });
    expect(chamadas.some((c) => c.tabela === "acoes")).toBe(false);
    expect(chamadas.some((c) => c.tabela === "bloqueados" && c.op === "delete")).toBe(true);

    chamadas = usar((c) => conectadas(c) ?? (c.tabela === "bloqueados" && c.op === "select" ? { data: [{ telefone: "5511" + "977776666" }] } : undefined));
    expect(await desbloquearBloqueados(["11" + "977776666"], true)).toEqual({ desbloqueados: 1, contas: 2 });
    expect(filtro(chamadas.find((c) => c.tabela === "bloqueados" && c.op === "select")!, "eq", "golpista")).toBe(true);
    expect((chamadas.find((c) => c.tabela === "acoes" && c.op === "insert")!.dados as { tipo: string }[]).map((x) => x.tipo)).toEqual(["desbloquear_contato", "desbloquear_contato"]);
  });
});

describe("regressão: bloqueio sem LID nem golpista", () => {
  it("bloquearTelefones grava e procura só pelo telefone, como antes", async () => {
    const { db, chamadas } = dbFalso((c) => (c.op === "select" ? { data: [] } : {}));
    await bloquearTelefones(db, [{ telefone: "5511" + "988887777", motivo: null }], "manual", null);
    expect(chamadas.find((c) => c.op === "upsert")!.dados).toEqual([{ telefone: "5511" + "988887777", motivo: null, origem: "manual", criado_por: null }]);
    expect(filtro(chamadas.find((c) => c.tabela === "participantes")!, "in", "telefone")).toEqual(["5511" + "988887777", "551188887777"]);
  });
});

describe("LID repetido em outro número", () => {
  it("bloquearTelefones: 23505 ao gravar com LID vira mensagem clara", async () => {
    const { db } = dbFalso((c) => {
      if (c.tabela === "bloqueados" && c.op === "upsert") return { error: { message: "duplicate key value violates unique constraint \"bloqueados_lid_key\"", code: "23505" } };
      return c.op === "select" ? { data: [] } : {};
    });
    await expect(bloquearTelefones(db, [{ telefone: "5511" + "977776666", motivo: null, lid: LID }], "manual", null)).rejects.toThrow("Esse LID já está em outro número bloqueado.");
  });

  it("outro erro ao gravar: mensagem de sempre", async () => {
    const { db } = dbFalso((c) => {
      if (c.tabela === "bloqueados" && c.op === "upsert") return { error: { message: "caiu" } };
      return c.op === "select" ? { data: [] } : {};
    });
    await expect(bloquearTelefones(db, [{ telefone: "5511" + "977776666", motivo: null, lid: LID }], "manual", null)).rejects.toThrow("Não foi possível gravar os bloqueados: caiu");
  });

  it("diálogo Adicionar número: o erro chega na tela", async () => {
    usar((c) => conectadas(c) ?? (c.tabela === "bloqueados" && c.op === "upsert" ? { error: { message: "dup", code: "23505" } } : undefined));
    expect(await adicionarNumeroBloqueado("Golpe", "(11) " + "97777-6666", { porLid: true })).toEqual({ erro: "Esse LID já está em outro número bloqueado." });
  });
});
