import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbFalso, filtro, type Chamada, type Resposta } from "./apoio/db-falso";
import { liberarTudo, usarMembro } from "./apoio/permissoes";

/** Etapa 3K, Tarefa 3: rotas dos dois relatórios e "Ver exportações" (metadados em `exportacoes`, arquivo gerado
 *  de novo no `?exportacao={id}`). */

const hoisted = vi.hoisted(() => ({ dbAtual: undefined as unknown }));
vi.mock("@/src/lib/permissoes", async () => (await import("./apoio/permissoes")).permissoesFalsas());
vi.mock("@/src/lib/supabase/usuario", () => ({ dbUsuario: async () => hoisted.dbAtual }));

import { GET as GET_STATUS } from "@/app/api/exportar/status-mensagens/route";
import { GET as GET_HISTORICO } from "@/app/api/exportar/mensagens-enviadas/route";
import { GET as GET_PESSOAS } from "@/app/api/exportar/pessoas/route";
import { readFileSync } from "node:fs";
import path from "node:path";
import { filtrosDaUrl, hrefBaixarDeNovo, lerExportacao, nomeGeradaPor, registrarExportacao, resumoFiltros, tiposVisiveis } from "@/src/lib/exportacoes";
import { CABECALHO_PESSOAS, CABECALHO_STATUS_MENSAGENS, dataDoArquivo, linhaCsvPessoa, montarCsv, textoDaMensagem } from "@/src/lib/regras/csv";
import type { PessoaLinha } from "@/src/lib/regras/pessoas";

const A = "11111111-1111-1111-1111-111111111111";
const E1 = "77777777-7777-7777-7777-777777777771";
const X1 = "88888888-8888-8888-8888-888888888881";

beforeEach(() => liberarTudo());

function comAuth(db: unknown, user: unknown) {
  return Object.assign({}, db as object, { auth: { getUser: async () => ({ data: { user } }) } });
}
const insercoes = (chamadas: Chamada[]) => chamadas.filter((c) => c.tabela === "exportacoes" && c.op === "insert");
/** Bytes do corpo (o `text()` tira o BOM; o arquivo tem que sair igual, BOM incluso). */
const bytes = async (res: Response) => new Uint8Array(await res.arrayBuffer());
const linhasCsv = async (res: Response) => (await res.text()).replace(/^﻿/, "").trim().split("\r\n");

describe("src/lib/exportacoes", () => {
  it("filtros da URL sem `exportacao` nem vazios; resumo conexão listas de ids", () => {
    expect(filtrosDaUrl(new URLSearchParams(`campanhas=${A},${E1}&exportacao=${X1}&busca=&situacao=ativos`))).toEqual({ campanhas: `${A},${E1}`, situacao: "ativos" });
    expect(resumoFiltros({ campanhas: `${A},${E1}`, inicio: "2026-10-01" })).toBe("campanhas: 2 · inicio: 2026-10-01");
    expect(resumoFiltros({ execucoes: E1 })).toBe("execucoes: 1");
    expect(resumoFiltros({})).toBe("Sem filtros");
    expect(hrefBaixarDeNovo("historico_mensagens", X1)).toBe(`/api/exportar/mensagens-enviadas?exportacao=${X1}`);
  });

  it("registrarExportacao grava só metadados e nunca lança", async () => {
    const { db, chamadas } = dbFalso();
    await registrarExportacao(db, { tipo: "leads", filtros: { campanhas: A }, linhas: 3, nomeArquivo: "pessoas.csv", usuario: { id: "u1" } });
    expect(chamadas[0]).toMatchObject({ tabela: "exportacoes", op: "insert", dados: { tipo: "leads", filtros: { campanhas: A }, linhas: 3, nome_arquivo: "pessoas.csv", criada_por: "u1" } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ruim = dbFalso(() => ({ error: { message: "sem tabela" } }));
    await expect(registrarExportacao(ruim.db, { tipo: "leads", filtros: {}, linhas: 0, nomeArquivo: "x.csv", usuario: null })).resolves.toBeUndefined();
    const explode = { from: () => { throw new Error("rede"); } } as never;
    await expect(registrarExportacao(explode, { tipo: "leads", filtros: {}, linhas: 0, nomeArquivo: "x.csv", usuario: null })).resolves.toBeUndefined();
    spy.mockRestore();
  });

  it("lerExportacao confere o tipo", async () => {
    const { db } = dbFalso(() => ({ data: { tipo: "leads", filtros: { campanhas: A } } }));
    expect(await lerExportacao(db, X1, "leads")).toEqual({ campanhas: A });
    expect(await lerExportacao(db, X1, "status_mensagens")).toBeNull();
    expect(await lerExportacao(db, "lixo", "leads")).toBeNull();
  });

  it("textoDaMensagem: v2 juntas, enquete pela pergunta, até 500 caracteres", () => {
    const v2 = { versao: 2, mensagens: [{ formato: "texto", texto: "Oi" }, { formato: "imagem", legenda: "Foto", midia_url: "u", nome_arquivo: null }], opcoes: {} };
    expect(textoDaMensagem("mensagem", v2)).toBe("Oi | Foto");
    expect(textoDaMensagem("mensagem", { formato: "texto", texto: "Antigo", midia_url: null, nome_arquivo: null, mencionar_todos: false })).toBe("Antigo");
    expect(textoDaMensagem("enquete", { pergunta: "Vem?", opcoes: ["S", "N"], max_respostas: 1 })).toBe("Vem?");
    expect(textoDaMensagem("mensagem", { formato: "texto", texto: "x".repeat(600) })).toHaveLength(500);
  });
});

describe("Ver exportações: o que aparece e pra quem", () => {
  const ler = (rel: string) => readFileSync(path.resolve(__dirname, "..", rel), "utf8");

  it("sem Leads/ver só o histórico de mensagens (sem telefone)", () => {
    expect(tiposVisiveis(true)).toEqual(["leads", "status_mensagens", "historico_mensagens", "solicitacoes"]);
    expect(tiposVisiveis(false)).toEqual(["historico_mensagens"]);
  });

  it("a página filtra a consulta pelos tipos visíveis", () => {
    const pagina = ler("app/(painel)/campanhas/exportacoes/page.tsx");
    expect(pagina).toMatch(/const veLeads = await permitido\("leads", "ver"\)/);
    expect(pagina).toMatch(/\.in\("tipo", tiposVisiveis\(veLeads\)\)/);
    expect(pagina).toMatch(/nomeGeradaPor\(/);
  });

  it("\"Gerada por\": nome do membro; sem nome, o e-mail antes do @", () => {
    expect(nomeGeradaPor("Ana", "g@x.com")).toBe("Ana");
    expect(nomeGeradaPor("  ", "ana.s@x.com")).toBe("ana.s");
    expect(nomeGeradaPor(null, null)).toBe("—");
  });

  it("RLS: equipe só lê e registra a própria linha; sem update/delete", () => {
    const sql = ler("supabase/migrations/20261017200300_exportacoes_rls.sql");
    expect(sql).toMatch(/drop policy if exists equipe_tudo on exportacoes/);
    expect(sql).toMatch(/for insert to authenticated with check \(criada_por = auth\.uid\(\)\)/);
    expect(sql).toMatch(/grant select, insert on exportacoes to authenticated;/);
    expect(sql).not.toMatch(/update.*to authenticated|delete.*to authenticated/);
  });

  it("métricas: erros de \"Entrar no Grupo\" e de bloquear/desbloquear contato fora da contagem de ações com erro", () => {
    expect(ler("app/(painel)/metricas/page.tsx")).toMatch(/from\("acoes"\)\.select\("campanha_id", \{ count: "exact" \}\)\.eq\("status", "erro"\)\.not\("tipo", "in", "\(entrar_grupo,bloquear_contato,desbloquear_contato\)"\)/);
  });
});

describe("GET /api/exportar/status-mensagens", () => {
  function banco(paginas: Record<string, unknown>[][], exportacao?: { tipo: string; filtros: unknown }) {
    let pagina = 0;
    return dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "exportacoes" && c.op === "select") return { data: exportacao ?? null };
      if (c.tabela === "execucoes") return { data: [{ id: E1, tipo: "mensagem", conteudo: { formato: "texto", texto: "Começou!" }, agendada_para: "2026-10-16T22:00:00Z" }] };
      if (c.tabela === "rpc:relatorio_status_mensagens") return { data: paginas[pagina++] ?? [] };
      return {};
    });
  }
  const linha = (p: Record<string, unknown>) => ({
    execucao_id: E1, tipo: "mensagem", campanha: "Aula A", grupo: "#1 Grupo 1", conta: "Conexão 1", status: "enviado", enviado_em: "2026-10-16T22:00:05Z",
    telefone: "", recebeu_em: null, visualizou_em: null, reproduziu_em: null, ...p,
  });

  it("401 sem sessão; 403 sem Leads/ver (sai telefone) ou sem Campanhas/ver, sem ler o banco", async () => {
    const { db, chamadas } = banco([]);
    hoisted.dbAtual = comAuth(db, null);
    expect((await GET_STATUS(new Request(`http://x/api/exportar/status-mensagens?execucoes=${E1}`))).status).toBe(401);
    hoisted.dbAtual = comAuth(db, { id: "u1" });
    usarMembro({ papel: "membro", permissoes: { campanhas: "editar", leads: "nenhum" } });
    expect((await GET_STATUS(new Request(`http://x/api/exportar/status-mensagens?execucoes=${E1}`))).status).toBe(403);
    usarMembro({ papel: "membro", permissoes: { campanhas: "nenhum", leads: "ver" } });
    expect((await GET_STATUS(new Request(`http://x/api/exportar/status-mensagens?execucoes=${E1}`))).status).toBe(403);
    expect(chamadas).toHaveLength(0);
  });

  it("400 sem ações válidas ou com mais de 50", async () => {
    hoisted.dbAtual = comAuth(banco([]).db, { id: "u1" });
    expect((await GET_STATUS(new Request("http://x/api/exportar/status-mensagens?execucoes=lixo"))).status).toBe(400);
    const muitas = Array.from({ length: 51 }, (_, i) => `77777777-7777-7777-7777-${String(i).padStart(12, "0")}`).join(",");
    expect((await GET_STATUS(new Request(`http://x/api/exportar/status-mensagens?execucoes=${muitas}`))).status).toBe(400);
  });

  it("CSV com e sem recibos: uma linha por pessoa; envio sem recibo = Telefone vazio; grava a exportação", async () => {
    const { db, chamadas } = banco([
      [
        linha({ telefone: "5537" + "980001001", recebeu_em: "2026-10-16T22:01:00Z", visualizou_em: "2026-10-16T22:10:00Z" }),
        linha({ telefone: "5511" + "988887777", recebeu_em: "2026-10-16T22:02:00Z", reproduziu_em: "2026-10-16T22:30:00Z" }),
        linha({ grupo: "#2 Grupo 2", status: "erro", enviado_em: null }),
      ],
    ]);
    hoisted.dbAtual = comAuth(db, { id: "u1" });
    const res = await GET_STATUS(new Request(`http://x/api/exportar/status-mensagens?execucoes=${E1},lixo`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="status-mensagens-${dataDoArquivo()}.csv"`);
    const [cab, l1, l2, l3, ...resto] = await linhasCsv(res);
    expect(cab).toBe(CABECALHO_STATUS_MENSAGENS.join(";"));
    expect(l1.split(";")).toEqual([
      "Enviar mensagem: Começou! (16/10/2026 19:00)", "16/10/2026 19:00", "Aula A", "#1 Grupo 1", "Conexão 1", "Enviado", expect.stringContaining("98000-1001"), "16/10/2026 19:01", "16/10/2026 19:10", "",
    ]);
    expect(l2.split(";").slice(7)).toEqual(["16/10/2026 19:02", "", "16/10/2026 19:30"]);
    expect(l3.split(";").slice(1)).toEqual(["", "Aula A", "#2 Grupo 2", "Conexão 1", "Falha", "", "", "", ""]);
    expect(resto).toEqual([]);
    const rpc = chamadas.find((c) => c.tabela === "rpc:relatorio_status_mensagens")!;
    expect(rpc.dados).toEqual({ p_execucoes: [E1], p_limite: 1000, p_deslocamento: 0 });
    expect(insercoes(chamadas).map((c) => c.dados)).toEqual([
      { tipo: "status_mensagens", filtros: { execucoes: E1 }, linhas: 3, nome_arquivo: `status-mensagens-${dataDoArquivo()}.csv`, criada_por: "u1" },
    ]);
  });

  it("paginado de 1000 em 1000", async () => {
    const cheia = Array.from({ length: 1000 }, (_, i) => linha({ telefone: `55119${String(i).padStart(8, "0")}` }));
    const { db, chamadas } = banco([cheia, [linha({})]]);
    hoisted.dbAtual = comAuth(db, { id: "u1" });
    const res = await GET_STATUS(new Request(`http://x/api/exportar/status-mensagens?execucoes=${E1}`));
    expect((await linhasCsv(res)).length).toBe(1 + 1001);
    expect(chamadas.filter((c) => c.tabela === "rpc:relatorio_status_mensagens").map((c) => (c.dados as { p_deslocamento: number }).p_deslocamento)).toEqual([0, 1000]);
  });

  it("teto de 100 mil linhas: corta, avisa no log e manda X-Truncado: 1 (abaixo do teto, sem o cabeçalho)", async () => {
    const cheia = Array.from({ length: 1000 }, () => linha({}));
    const { db } = dbFalso((c: Chamada): Resposta => (c.tabela === "rpc:relatorio_status_mensagens" ? { data: cheia } : c.tabela === "execucoes" ? { data: [] } : {}));
    hoisted.dbAtual = comAuth(db, { id: "u1" });
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await GET_STATUS(new Request(`http://x/api/exportar/status-mensagens?execucoes=${E1}`));
    expect(res.headers.get("X-Truncado")).toBe("1");
    expect((await linhasCsv(res)).length).toBe(1 + 100_000);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    hoisted.dbAtual = comAuth(banco([[linha({})]]).db, { id: "u1" });
    expect((await GET_STATUS(new Request(`http://x/api/exportar/status-mensagens?execucoes=${E1}`))).headers.get("X-Truncado")).toBeNull();
  });

  it("?exportacao={id}: usa os filtros guardados e não cria linha nova; de outro tipo → 404", async () => {
    const { db, chamadas } = banco([[linha({})]], { tipo: "status_mensagens", filtros: { execucoes: E1 } });
    hoisted.dbAtual = comAuth(db, { id: "u1" });
    const res = await GET_STATUS(new Request(`http://x/api/exportar/status-mensagens?exportacao=${X1}`));
    expect(res.status).toBe(200);
    expect(chamadas.find((c) => c.tabela === "rpc:relatorio_status_mensagens")!.dados).toMatchObject({ p_execucoes: [E1] });
    expect(insercoes(chamadas)).toHaveLength(0);

    hoisted.dbAtual = comAuth(banco([], { tipo: "leads", filtros: {} }).db, { id: "u1" });
    expect((await GET_STATUS(new Request(`http://x/api/exportar/status-mensagens?exportacao=${X1}`))).status).toBe(404);
  });

  it("erro do banco: 500 genérico", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    hoisted.dbAtual = comAuth(dbFalso((c) => (c.tabela.startsWith("rpc:") ? { error: { message: "detalhe" } } : {})).db, { id: "u1" });
    const res = await GET_STATUS(new Request(`http://x/api/exportar/status-mensagens?execucoes=${E1}`));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("detalhe");
    spy.mockRestore();
  });
});

describe("GET /api/exportar/mensagens-enviadas", () => {
  const tarefa = (p: Record<string, unknown> = {}) => ({
    id: "t1", tipo: "mensagem", status: "enviado", message_id: "MSG1", entregues: 10, lidos: 4, enviado_em: "2026-10-05T13:00:00Z",
    grupos: { nome: "Grupo 1", numero: 1 }, conexoes: { nome: "Conexão 1" },
    execucoes: { agendada_para: "2026-10-05T13:00:00Z", origem: "avulsa", conteudo: { formato: "texto", texto: "Oi {nome}" }, conteudo_final: { formato: "texto", texto: "Oi Aula" }, campanhas: { nome: "Aula A" } },
    ...p,
  });
  function banco(tarefas: unknown[], exportacao?: { tipo: string; filtros: unknown }) {
    return dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "exportacoes" && c.op === "select") return { data: exportacao ?? null };
      if (c.tabela === "tarefas") return { data: tarefas };
      return {};
    });
  }
  const url = (q: string) => new Request(`http://x/api/exportar/mensagens-enviadas?${q}`);

  it("401 sem sessão; 403 sem Campanhas/ver; Leads não é exigido (sem telefone)", async () => {
    const { db } = banco([tarefa()]);
    hoisted.dbAtual = comAuth(db, null);
    expect((await GET_HISTORICO(url(`inicio=2026-10-01&fim=2026-10-17&campanhas=${A}`))).status).toBe(401);
    hoisted.dbAtual = comAuth(db, { id: "u1" });
    usarMembro({ papel: "membro", permissoes: { campanhas: "nenhum", leads: "editar" } });
    expect((await GET_HISTORICO(url(`inicio=2026-10-01&fim=2026-10-17&campanhas=${A}`))).status).toBe(403);
    usarMembro({ papel: "membro", permissoes: { campanhas: "ver", leads: "nenhum" } });
    expect((await GET_HISTORICO(url(`inicio=2026-10-01&fim=2026-10-17&campanhas=${A}`))).status).toBe(200);
  });

  it("respeita o intervalo (Brasília, fim inclusive) e as campanhas; mensagem/enquete só", async () => {
    const { db, chamadas } = banco([tarefa(), tarefa({ id: "t2", tipo: "enquete", status: "erro", message_id: null, entregues: 0, lidos: 0, enviado_em: null, grupos: null, execucoes: { agendada_para: "2026-10-06T13:00:00Z", origem: "automacao", conteudo: { pergunta: "Vem?" }, conteudo_final: null, campanhas: { nome: "Aula A" } } })]);
    hoisted.dbAtual = comAuth(db, { id: "u1" });
    const res = await GET_HISTORICO(url(`inicio=2026-10-01&fim=2026-10-17&campanhas=${A},lixo`));
    expect(res.status).toBe(200);
    const q = chamadas.find((c) => c.tabela === "tarefas")!;
    expect(filtro(q, "gte", "execucoes.agendada_para")).toBe("2026-10-01T03:00:00.000Z");
    expect(filtro(q, "lt", "execucoes.agendada_para")).toBe("2026-10-18T03:00:00.000Z");
    expect(filtro(q, "in", "execucoes.campanha_id")).toEqual([A]);
    expect(filtro(q, "in", "tipo")).toEqual(["mensagem", "enquete"]);
    expect(q.filtros.find((f) => f[0] === "range")).toEqual(["range", 0, 999]);
    const [cab, l1, l2] = await linhasCsv(res);
    expect(cab).toBe("Data;Campanha;Grupo;Conexão;Tipo;Mensagem;Status;ID da mensagem;Entregues;Lidos;Origem");
    expect(l1).toBe("05/10/2026 10:00;Aula A;#1 Grupo 1;Conexão 1;Mensagem;Oi Aula;Enviado;MSG1;10;4;Avulsa");
    expect(l2).toBe("06/10/2026 10:00;Aula A;;Conexão 1;Enquete;Vem?;Falha;;0;0;Automação");
    expect(insercoes(chamadas).map((c) => c.dados)).toEqual([
      { tipo: "historico_mensagens", filtros: { inicio: "2026-10-01", fim: "2026-10-17", campanhas: A }, linhas: 2, nome_arquivo: `mensagens-enviadas-${dataDoArquivo()}.csv`, criada_por: "u1" },
    ]);
  });

  it("400 com intervalo maior que 90 dias, invertido ou sem campanha", async () => {
    hoisted.dbAtual = comAuth(banco([]).db, { id: "u1" });
    expect((await GET_HISTORICO(url(`inicio=2026-01-01&fim=2026-10-17&campanhas=${A}`))).status).toBe(400);
    expect((await GET_HISTORICO(url(`inicio=2026-10-17&fim=2026-10-01&campanhas=${A}`))).status).toBe(400);
    expect((await GET_HISTORICO(url("inicio=2026-10-01&fim=2026-10-17&campanhas=lixo"))).status).toBe(400);
  });

  it("teto de 100 mil linhas: X-Truncado: 1", async () => {
    const cheia = Array.from({ length: 1000 }, () => tarefa());
    hoisted.dbAtual = comAuth(banco(cheia).db, { id: "u1" });
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await GET_HISTORICO(url(`inicio=2026-10-01&fim=2026-10-17&campanhas=${A}`));
    expect(res.headers.get("X-Truncado")).toBe("1");
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("100000"));
    spy.mockRestore();
  });

  it("?exportacao={id} não cria linha nova", async () => {
    const { db, chamadas } = banco([tarefa()], { tipo: "historico_mensagens", filtros: { inicio: "2026-10-01", fim: "2026-10-17", campanhas: A } });
    hoisted.dbAtual = comAuth(db, { id: "u1" });
    expect((await GET_HISTORICO(url(`exportacao=${X1}`))).status).toBe(200);
    expect(insercoes(chamadas)).toHaveLength(0);
  });
});

describe("GET /api/exportar/pessoas (regressão + Ver exportações)", () => {
  const pessoa: PessoaLinha = {
    participante_id: "p1", telefone: "5537" + "980001001", campanha_id: A, campanha: "Aula A", grupo_id: "g1", grupo: "Grupo 1",
    entrou_em: "2026-10-10T12:00:00Z", saiu_em: null, motivo_saida: null, tags: ["vip"],
  } as PessoaLinha;
  function banco(exportacao?: { tipo: string; filtros: unknown }) {
    return dbFalso((c: Chamada): Resposta => {
      if (c.tabela === "exportacoes" && c.op === "select") return { data: exportacao ?? null };
      if (c.tabela === "rpc:listar_pessoas") return { data: [pessoa] };
      return {};
    });
  }

  it("devolve o mesmo CSV de hoje e grava a exportação com os filtros da URL", async () => {
    const { db, chamadas } = banco();
    hoisted.dbAtual = comAuth(db, { id: "u1" });
    const res = await GET_PESSOAS(new Request(`http://x/api/exportar/pessoas?campanhas=${A}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="pessoas-${dataDoArquivo()}.csv"`);
    expect(await bytes(res)).toEqual(new TextEncoder().encode(montarCsv(CABECALHO_PESSOAS, [linhaCsvPessoa(pessoa)])));
    expect(insercoes(chamadas).map((c) => c.dados)).toEqual([
      { tipo: "leads", filtros: { campanhas: A }, linhas: 1, nome_arquivo: `pessoas-${dataDoArquivo()}.csv`, criada_por: "u1" },
    ]);
  });

  it("falha ao gravar a exportação não derruba o download", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db } = dbFalso((c: Chamada): Resposta => (c.tabela === "exportacoes" ? { error: { message: "sem tabela" } } : c.tabela === "rpc:listar_pessoas" ? { data: [pessoa] } : {}));
    hoisted.dbAtual = comAuth(db, { id: "u1" });
    const res = await GET_PESSOAS(new Request("http://x/api/exportar/pessoas"));
    expect(res.status).toBe(200);
    expect(await bytes(res)).toEqual(new TextEncoder().encode(montarCsv(CABECALHO_PESSOAS, [linhaCsvPessoa(pessoa)])));
    spy.mockRestore();
  });

  it("?exportacao={id}: filtros guardados, sem linha nova; tipo errado → 404; sem Leads/ver → 403", async () => {
    const { db, chamadas } = banco({ tipo: "leads", filtros: { campanhas: A } });
    hoisted.dbAtual = comAuth(db, { id: "u1" });
    const res = await GET_PESSOAS(new Request(`http://x/api/exportar/pessoas?exportacao=${X1}`));
    expect(res.status).toBe(200);
    expect((chamadas.find((c) => c.tabela === "rpc:listar_pessoas")!.dados as { p_campanha: string }).p_campanha).toBe(A);
    expect(insercoes(chamadas)).toHaveLength(0);

    hoisted.dbAtual = comAuth(banco({ tipo: "status_mensagens", filtros: {} }).db, { id: "u1" });
    expect((await GET_PESSOAS(new Request(`http://x/api/exportar/pessoas?exportacao=${X1}`))).status).toBe(404);

    usarMembro({ papel: "membro", permissoes: { leads: "nenhum", campanhas: "editar" } });
    expect((await GET_PESSOAS(new Request(`http://x/api/exportar/pessoas?exportacao=${X1}`))).status).toBe(403);
  });
});
