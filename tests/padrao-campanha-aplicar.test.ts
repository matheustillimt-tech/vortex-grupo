import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, type Chamada, type Resposta } from "./apoio/db-falso";

const hoisted = vi.hoisted(() => ({ dbAtual: undefined as unknown }));
vi.mock("@/src/lib/supabase/admin", () => ({ dbAdmin: () => hoisted.dbAtual }));

import { aplicarPadraoNaCriacao } from "@/src/lib/padrao-campanha";
import type { CampanhaEntrada } from "@/src/lib/regras/campanha";

const A1 = "a1a1a1a1-1111-4111-8111-111111111111";
const A2 = "a2a2a2a2-2222-4222-8222-222222222222";

const entrada: CampanhaEntrada = {
  nome: "Aulão", slug: "aulao", padrao_nome: "GRUPO #{n}", descricao: "", fechado: false, limite_por_grupo: 1000, folga: 1,
  conexao_criadora_id: "criadora", admins: [], usar_comunidade: false, crm_webhook_url: "", projeto_id: null,
};

function usar(responder: (c: Chamada) => Resposta) {
  const f = dbFalso(responder);
  hoisted.dbAtual = f.db;
  return { chamadas: f.chamadas };
}

beforeEach(() => vi.clearAllMocks());

describe("aplicarPadraoNaCriacao", () => {
  it("sem linha salva em configuracoes: devolve a entrada sem mudar nada e sem números", async () => {
    usar(() => ({ data: null }));
    expect(await aplicarPadraoNaCriacao(entrada)).toEqual({ entrada, adminsNumeros: [] });
  });

  it("erro ao ler configuracoes: devolve a entrada sem mudar nada (nunca derruba a criação)", async () => {
    usar(() => ({ error: { message: "fora do ar" } }));
    expect(await aplicarPadraoNaCriacao(entrada)).toEqual({ entrada, adminsNumeros: [] });
  });

  it("padrão salvo mas desligado (ativo: false): devolve a entrada sem mudar nada", async () => {
    usar(() => ({ data: { valor: { ativo: false, fechado: true, limite_por_grupo: 300, folga: 4, padrao_nome: "X #{n}", usar_comunidade: true, admins: [A1] } } }));
    expect(await aplicarPadraoNaCriacao(entrada)).toEqual({ entrada, adminsNumeros: [] });
  });

  const ligado = { ativo: true, fechado: true, limite_por_grupo: 300, folga: 4, padrao_nome: "X #{n}", usar_comunidade: true, admins: [A1, A2] };

  it("padrão salvo e ligado: troca os campos de criação de grupos e os admins (que existem em conexoes)", async () => {
    const { chamadas } = usar((c) => (c.tabela === "conexoes" ? { data: [{ id: A1 }, { id: A2 }] } : { data: { valor: ligado } }));
    const r = await aplicarPadraoNaCriacao(entrada);
    expect(r.entrada).toEqual({
      ...entrada, fechado: true, limite_por_grupo: 300, folga: 4, padrao_nome: "X #{n}", usar_comunidade: true, admins: [A1, A2],
    });
    expect(r.adminsNumeros).toEqual([]);
    const sel = chamadas.find((c) => c.tabela === "conexoes")!;
    expect(sel.filtros).toContainEqual(["in", "id", [A1, A2]]);
  });

  it("admin do padrão que não existe mais em conexoes: sai da lista (não quebra a criação)", async () => {
    usar((c) => (c.tabela === "conexoes" ? { data: [{ id: A2 }] } : { data: { valor: ligado } }));
    expect((await aplicarPadraoNaCriacao(entrada)).entrada.admins).toEqual([A2]);
  });

  it("erro ao conferir conexoes: cria sem admins do padrão (mas com os outros campos)", async () => {
    usar((c) => (c.tabela === "conexoes" ? { error: { message: "fora" } } : { data: { valor: ligado } }));
    const r = await aplicarPadraoNaCriacao(entrada);
    expect(r.entrada.admins).toEqual([]);
    expect(r.entrada.padrao_nome).toBe("X #{n}");
  });

  it("padrão ligado sem admins: nem consulta conexoes", async () => {
    const { chamadas } = usar(() => ({ data: { valor: { ...ligado, admins: [] } } }));
    expect((await aplicarPadraoNaCriacao(entrada)).entrada.admins).toEqual([]);
    expect(chamadas.some((c) => c.tabela === "conexoes")).toBe(false);
  });

  it("valor salvo corrompido (sem padrao_nome): trata como sem padrão", async () => {
    usar(() => ({ data: { valor: { ativo: true, limite_por_grupo: 300, folga: 4 } } }));
    expect(await aplicarPadraoNaCriacao(entrada)).toEqual({ entrada, adminsNumeros: [] });
  });

  it("padrão com admins_numeros e sem conexão nenhuma (criadora vazia): devolve os números do padrão", async () => {
    usar((c) => (c.tabela === "conexoes" ? { data: [] } : { data: { valor: { ...ligado, admins: [], admins_numeros: ["5511" + "999990001"] } } }));
    const r = await aplicarPadraoNaCriacao({ ...entrada, conexao_criadora_id: "" });
    expect(r.adminsNumeros).toEqual(["5511" + "999990001"]);
  });

  it("padrão com admins_numeros que colide com a conexão criadora: tira o número, mas não derruba a criação", async () => {
    usar((c) => {
      if (c.tabela === "conexoes") return { data: [{ id: "criadora", telefone: "5511" + "999990001" }] };
      return { data: { valor: { ...ligado, admins: [], admins_numeros: ["5511" + "999990001", "5511" + "999990002"] } } };
    });
    const r = await aplicarPadraoNaCriacao(entrada);
    expect(r.adminsNumeros).toEqual(["5511" + "999990002"]);
  });
});

/** Etapa 3M, Tarefa 2: "Imagem do grupo" do padrão vale na criação da campanha. */
describe("aplicarPadraoNaCriacao com a imagem do grupo", () => {
  const IMAGEM = "https://exemplo.supabase.co/storage/v1/object/public/midias/padrao-campanha/1760000000000-capa.png";
  const ligadoSemAdmins = { ativo: true, fechado: true, limite_por_grupo: 300, folga: 4, padrao_nome: "X #{n}", usar_comunidade: false, admins: [] };

  it("padrão ligado com imagem: a campanha nova nasce com imagem_grupo_url", async () => {
    usar(() => ({ data: { valor: { ...ligadoSemAdmins, imagem_grupo_url: IMAGEM } } }));
    const r = await aplicarPadraoNaCriacao(entrada);
    expect((r.entrada as CampanhaEntrada & { imagem_grupo_url?: string }).imagem_grupo_url).toBe(IMAGEM);
  });

  it("padrão de hoje (sem a chave): a campanha nova continua sem imagem (nenhuma chave nova na entrada)", async () => {
    usar(() => ({ data: { valor: ligadoSemAdmins } }));
    const r = await aplicarPadraoNaCriacao(entrada);
    expect("imagem_grupo_url" in r.entrada).toBe(false);
  });

  it("imagem salva estragada (http): ignorada, o resto do padrão vale", async () => {
    usar(() => ({ data: { valor: { ...ligadoSemAdmins, imagem_grupo_url: "http://x/a.png" } } }));
    const r = await aplicarPadraoNaCriacao(entrada);
    expect(r.entrada).toMatchObject({ limite_por_grupo: 300, folga: 4 });
    expect((r.entrada as CampanhaEntrada & { imagem_grupo_url?: unknown }).imagem_grupo_url).toBeUndefined();
  });
});
