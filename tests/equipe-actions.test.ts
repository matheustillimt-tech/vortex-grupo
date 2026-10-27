import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, filtro, type Chamada, type Resposta } from "./apoio/db-falso";
import { liberarTudo, usarMembro } from "./apoio/permissoes";

const EU = "00000000-2222-3333-4444-555555555555";
const ALVO = "11111111-2222-3333-4444-555555555555";
const OUTRO_ADMIN = "22222222-2222-3333-4444-555555555555";

const hoisted = vi.hoisted(() => ({
  adminAtual: undefined as unknown,
  exigirUsuarioMock: vi.fn(async () => ({ id: "00000000-2222-3333-4444-555555555555", email: "eu@exemplo.com" })),
  revalidar: vi.fn(),
  createUser: vi.fn(async () => ({ data: { user: { id: "novo-id" } }, error: null })),
  deleteUser: vi.fn(async () => ({ error: null })),
}));

vi.mock("@/src/lib/permissoes", async () => (await import("./apoio/permissoes")).permissoesFalsas());
vi.mock("@/src/lib/supabase/usuario", () => ({ exigirUsuario: hoisted.exigirUsuarioMock }));
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => hoisted.adminAtual }));
vi.mock("next/cache", () => ({ revalidatePath: hoisted.revalidar }));
// `registrarHistorico` também usa `dbAdmin` (o mesmo banco falso): sem isto, a gravação do histórico apareceria
// como uma chamada extra nas asserções que contam chamadas por tabela/operação.
vi.mock("@/src/lib/historico", () => ({ registrarHistorico: vi.fn() }));

import { criarAcesso, editarMembro, removerAcesso, salvarPermissoes } from "@/app/(painel)/equipe/actions";

/** `responder` cobre as consultas que o teste quer customizar; por padrão o chamador (`EU`) é Administrador e
 *  é o único Administrador da equipe — o banco falso responde como antes; a permissão vem de `apoio/permissoes`. */
function usar(responder?: (c: Chamada) => Resposta) {
  const padrao = (c: Chamada): Resposta => {
    if (c.tabela === "membros" && c.op === "select") {
      if (filtro(c, "eq", "usuario_id") === EU) return { data: { papel: "admin" } };
      if (filtro(c, "eq", "papel") === "admin") return { data: [{ usuario_id: EU }] };
    }
    return {};
  };
  const f = dbFalso((c) => responder?.(c) ?? padrao(c));
  hoisted.adminAtual = Object.assign({}, f.db as object, { auth: { admin: { createUser: hoisted.createUser, deleteUser: hoisted.deleteUser } } });
  return { chamadas: f.chamadas };
}

beforeEach(() => {
  vi.clearAllMocks();
  liberarTudo();
  hoisted.exigirUsuarioMock.mockResolvedValue({ id: EU, email: "eu@exemplo.com" });
  hoisted.createUser.mockResolvedValue({ data: { user: { id: "novo-id" } }, error: null });
  hoisted.deleteUser.mockResolvedValue({ error: null });
});

/** `EU` é Membro (não Administrador), pra testar a recusa (helper compartilhado de permissões). */
function usarNaoAdmin() {
  usarMembro({ papel: "membro", permissoes: {} });
  return usar((c) => {
    if (c.tabela === "membros" && c.op === "select" && filtro(c, "eq", "usuario_id") === EU) return { data: { papel: "membro" } };
    return {};
  });
}

describe("só Administrador (via cada ação)", () => {
  it("criarAcesso recusa quem não é Administrador", async () => {
    const { chamadas } = usarNaoAdmin();
    const r = await criarAcesso("nova@exemplo.com", "Nova Pessoa", "membro");
    expect(r).toEqual({ erro: "Só Administradores mudam a equipe." });
    expect(hoisted.createUser).not.toHaveBeenCalled();
    void chamadas;
  });

  it("editarMembro recusa quem não é Administrador", async () => {
    usarNaoAdmin();
    const r = await editarMembro(ALVO, { nome: "X", papel: "admin" });
    expect(r).toEqual({ erro: "Só Administradores mudam a equipe." });
  });

  it("salvarPermissoes recusa quem não é Administrador", async () => {
    usarNaoAdmin();
    const r = await salvarPermissoes(ALVO, { campanhas: "ver" });
    expect(r).toEqual({ erro: "Só Administradores mudam a equipe." });
  });

  it("removerAcesso recusa quem não é Administrador", async () => {
    usarNaoAdmin();
    const r = await removerAcesso(ALVO);
    expect(r).toEqual({ erro: "Só Administradores mudam a equipe." });
    expect(hoisted.deleteUser).not.toHaveBeenCalled();
  });
});

describe("criarAcesso", () => {
  it("cria o usuário, salva nome/papel em membros e devolve a senha (16 caracteres)", async () => {
    const { chamadas } = usar();
    const r = await criarAcesso(" Nova@Exemplo.com ", "  Nova Pessoa  ", "membro");
    expect(r.erro).toBeUndefined();
    expect(r.aviso).toBeUndefined();
    expect(r.senha).toHaveLength(16);
    expect(hoisted.createUser).toHaveBeenCalledWith({ email: "nova@exemplo.com", password: r.senha, email_confirm: true });
    const up = chamadas.find((c) => c.op === "upsert")!;
    expect(up.tabela).toBe("membros");
    expect(up.dados).toEqual({ usuario_id: "novo-id", nome: "Nova Pessoa", papel: "membro" });
    expect(up.opcoes).toEqual({ onConflict: "usuario_id" });
    expect(hoisted.revalidar).toHaveBeenCalledWith("/equipe");
    expect(hoisted.revalidar).toHaveBeenCalledWith("/equipe/permissoes");
  });

  it("e-mail inválido não toca no banco", async () => {
    usar();
    const r = await criarAcesso("não-é-email", "Nome", "membro");
    expect(r.erro).toBeTruthy();
    expect(hoisted.createUser).not.toHaveBeenCalled();
  });

  it("nome em branco", async () => {
    usar();
    expect((await criarAcesso("nova@exemplo.com", "   ", "membro")).erro).toBeTruthy();
  });

  it("papel inválido", async () => {
    usar();
    expect((await criarAcesso("nova@exemplo.com", "Nome", "root" as never)).erro).toBeTruthy();
  });

  it("e-mail já cadastrado", async () => {
    usar();
    hoisted.createUser.mockResolvedValueOnce({ data: { user: null }, error: { message: "already registered" } } as never);
    const r = await criarAcesso("ja@exemplo.com", "Nome", "membro");
    expect(r.erro).toBe("Esse e-mail já tem acesso.");
  });

  it("upsert em membros falha: ainda devolve a senha, com aviso", async () => {
    const { chamadas } = usar((c) => (c.op === "upsert" ? { error: { message: "caiu" } } : usarPadraoInline(c)));
    const r = await criarAcesso("nova@exemplo.com", "Nome", "membro");
    expect(r.senha).toHaveLength(16);
    expect(r.aviso).toBeTruthy();
    void chamadas;
  });
});

/** Repetição do `padrao` de `usar()`, pro responder customizado do teste de upsert continuar passando pela
 *  checagem de Administrador antes de simular a falha do `upsert`. */
function usarPadraoInline(c: Chamada): Resposta {
  if (c.tabela === "membros" && c.op === "select" && filtro(c, "eq", "usuario_id") === EU) return { data: { papel: "admin" } };
  return {};
}

describe("editarMembro", () => {
  it("salva nome e papel", async () => {
    const { chamadas } = usar((c) => {
      if (c.tabela === "membros" && c.op === "select" && filtro(c, "eq", "usuario_id") === EU) return { data: { papel: "admin" } };
      if (c.tabela === "membros" && c.op === "select" && filtro(c, "eq", "papel") === "admin") return { data: [{ usuario_id: EU }] };
      if (c.tabela === "membros" && c.op === "update") return { data: [{ usuario_id: ALVO }] };
      return {};
    });
    const r = await editarMembro(ALVO, { nome: " Fulano ", papel: "membro" });
    expect(r).toEqual({});
    const up = chamadas.find((c) => c.op === "update")!;
    expect(up.dados).toMatchObject({ nome: "Fulano", papel: "membro" });
    expect(filtro(up, "eq", "usuario_id")).toBe(ALVO);
  });

  it("id inválido não toca no banco", async () => {
    const { chamadas } = usar();
    const r = await editarMembro("não-é-uuid", { nome: "x", papel: "membro" });
    expect(r.erro).toBeTruthy();
    expect(chamadas.some((c) => c.op === "update")).toBe(false);
  });

  it("não deixa rebaixar o último Administrador", async () => {
    usar((c) => {
      if (c.tabela === "membros" && c.op === "select" && filtro(c, "eq", "usuario_id") === EU) return { data: { papel: "admin" } };
      // só o próprio alvo é Administrador hoje
      if (c.tabela === "membros" && c.op === "select" && filtro(c, "eq", "papel") === "admin") return { data: [{ usuario_id: ALVO }] };
      return {};
    });
    const r = await editarMembro(ALVO, { nome: "x", papel: "membro" });
    expect(r.erro).toBe("Precisa ficar pelo menos um Administrador.");
  });

  it("pessoa não encontrada (nenhuma linha atualizada)", async () => {
    usar((c) => {
      if (c.tabela === "membros" && c.op === "select" && filtro(c, "eq", "usuario_id") === EU) return { data: { papel: "admin" } };
      if (c.tabela === "membros" && c.op === "update") return { data: [] };
      return {};
    });
    const r = await editarMembro(ALVO, { nome: "x", papel: "admin" });
    expect(r.erro).toBe("Pessoa não encontrada.");
  });
});

describe("salvarPermissoes", () => {
  it("normaliza e salva pra um Membro", async () => {
    const { chamadas } = usar((c) => {
      if (c.tabela === "membros" && c.op === "select" && filtro(c, "eq", "usuario_id") === EU) return { data: { papel: "admin" } };
      if (c.tabela === "membros" && c.op === "select" && filtro(c, "eq", "usuario_id") === ALVO) return { data: { papel: "membro" } };
      if (c.tabela === "membros" && c.op === "update") return { data: [{ usuario_id: ALVO }] };
      return {};
    });
    const r = await salvarPermissoes(ALVO, { campanhas: "editar", metricas: "editar", chave_desconhecida: "editar" });
    expect(r).toEqual({});
    const up = chamadas.find((c) => c.op === "update")!;
    // "metricas" é só-Ver: nunca "editar"; chaves desconhecidas são descartadas.
    expect(up.dados).toMatchObject({ permissoes: { campanhas: "editar", metricas: "ver" } });
    expect(filtro(up, "eq", "usuario_id")).toBe(ALVO);
  });

  it("recusa salvar permissões de um Administrador", async () => {
    usar((c) => {
      if (c.tabela === "membros" && c.op === "select" && filtro(c, "eq", "usuario_id") === EU) return { data: { papel: "admin" } };
      if (c.tabela === "membros" && c.op === "select" && filtro(c, "eq", "usuario_id") === ALVO) return { data: { papel: "admin" } };
      return {};
    });
    const r = await salvarPermissoes(ALVO, { campanhas: "editar" });
    expect(r).toEqual({ erro: "Administrador já tem acesso total." });
  });

  it("pessoa não encontrada", async () => {
    usar((c) => {
      if (c.tabela === "membros" && c.op === "select" && filtro(c, "eq", "usuario_id") === EU) return { data: { papel: "admin" } };
      if (c.tabela === "membros" && c.op === "select" && filtro(c, "eq", "usuario_id") === ALVO) return { data: null };
      return {};
    });
    const r = await salvarPermissoes(ALVO, {});
    expect(r).toEqual({ erro: "Pessoa não encontrada." });
  });

  it("id inválido não toca no banco", async () => {
    const { chamadas } = usar();
    const r = await salvarPermissoes("não-é-uuid", {});
    expect(r.erro).toBeTruthy();
    expect(chamadas.some((c) => c.op === "update")).toBe(false);
  });
});

describe("removerAcesso", () => {
  it("remove quem não é o próprio chamador", async () => {
    const { chamadas } = usar();
    const r = await removerAcesso(ALVO);
    expect(r).toEqual({});
    expect(hoisted.deleteUser).toHaveBeenCalledWith(ALVO);
    void chamadas;
  });

  it("antes de excluir, revoga as chaves de atendente e os acessos de API da pessoa", async () => {
    const { chamadas } = usar();
    expect(await removerAcesso(ALVO)).toEqual({});
    const chaves = chamadas.find((c) => c.tabela === "api_chaves" && c.op === "update")!;
    expect(chaves.dados).toHaveProperty("revogada_em");
    expect(filtro(chaves, "eq", "criada_por")).toBe(ALVO);
    expect(chaves.filtros).toContainEqual(["not", "acesso_de", "is", null]);
    const acessos = chamadas.find((c) => c.tabela === "api_acessos" && c.op === "update")!;
    expect(acessos.dados).toMatchObject({ status: "revogado", decidido_por: EU });
    expect(filtro(acessos, "eq", "solicitante")).toBe(ALVO);
    expect(filtro(acessos, "in", "status")).toEqual(["aguardando", "aprovado"]);
  });

  it("se não conseguir revogar as chaves, não exclui a pessoa", async () => {
    usar((c) => {
      if (c.tabela === "membros" && c.op === "select") {
        if (filtro(c, "eq", "usuario_id") === EU) return { data: { papel: "admin" } };
        if (filtro(c, "eq", "papel") === "admin") return { data: [{ usuario_id: EU }] };
      }
      if (c.tabela === "api_chaves") return { error: { message: "caiu" } };
      return {};
    });
    expect((await removerAcesso(ALVO)).erro).toBeTruthy();
    expect(hoisted.deleteUser).not.toHaveBeenCalled();
  });

  it("ninguém remove o próprio acesso", async () => {
    usar((c) => {
      if (c.tabela === "membros" && c.op === "select" && filtro(c, "eq", "usuario_id") === EU) return { data: { papel: "admin" } };
      if (c.tabela === "membros" && c.op === "select" && filtro(c, "eq", "papel") === "admin") return { data: [{ usuario_id: EU }, { usuario_id: OUTRO_ADMIN }] };
      return {};
    });
    const r = await removerAcesso(EU);
    expect(r.erro).toBe("Você não pode remover o próprio acesso.");
    expect(hoisted.deleteUser).not.toHaveBeenCalled();
  });

  it("não deixa remover o último Administrador", async () => {
    usar((c) => {
      if (c.tabela === "membros" && c.op === "select" && filtro(c, "eq", "usuario_id") === EU) return { data: { papel: "admin" } };
      if (c.tabela === "membros" && c.op === "select" && filtro(c, "eq", "papel") === "admin") return { data: [{ usuario_id: ALVO }] };
      return {};
    });
    const r = await removerAcesso(ALVO);
    expect(r.erro).toBe("Precisa ficar pelo menos um Administrador.");
    expect(hoisted.deleteUser).not.toHaveBeenCalled();
  });

  it("id inválido não toca no banco", async () => {
    usar();
    const r = await removerAcesso("não-é-uuid");
    expect(r.erro).toBeTruthy();
    expect(hoisted.deleteUser).not.toHaveBeenCalled();
  });

  it("erro ao excluir o usuário", async () => {
    usar();
    hoisted.deleteUser.mockResolvedValueOnce({ error: { message: "caiu" } } as never);
    const r = await removerAcesso(ALVO);
    expect(r.erro).toBeTruthy();
  });
});
