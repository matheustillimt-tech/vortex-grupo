import { describe, expect, it } from "vitest";
import {
  aplicarPadraoEmEntrada,
  camposAplicaveis,
  lerPadraoCampanha,
  PADRAO_CAMPANHA_VAZIO,
  validarPadraoCampanha,
  type PadraoCampanhaEntrada,
} from "@/src/lib/regras/padrao-campanha";
import type { CampanhaEntrada } from "@/src/lib/regras/campanha";

const C1 = "c1c1c1c1-1111-4111-8111-111111111111";
const C2 = "c2c2c2c2-2222-4222-8222-222222222222";

const base: PadraoCampanhaEntrada = { ativo: true, fechado: true, limite_por_grupo: 1000, folga: 1, padrao_nome: "GRUPO #{n}", usar_comunidade: false, admins: [C1, C1] };

describe("validarPadraoCampanha", () => {
  it("aceita o padrão e deduplica os admins", () => {
    expect(validarPadraoCampanha(base)).toEqual({ ok: true, valor: { ...base, admins: [C1] } });
  });

  it("admin que não é uuid: recusa", () => {
    expect(validarPadraoCampanha({ ...base, admins: [C1, "c1"] })).toEqual({ ok: false, erro: "Conexão de administrador inválida." });
  });

  it.each([
    [{ padrao_nome: "" }, "Dê um padrão de nome para os grupos."],
    [{ limite_por_grupo: 5 }, "O limite por grupo vai de 10 a 1024."],
    [{ limite_por_grupo: 2000 }, "O limite por grupo vai de 10 a 1024."],
    [{ folga: 0 }, "A folga vai de 1 a 10 grupos."],
    [{ folga: 11 }, "A folga vai de 1 a 10 grupos."],
  ])("%o → %s", (mudanca, erro) => {
    expect(validarPadraoCampanha({ ...base, ...mudanca })).toEqual({ ok: false, erro });
  });

  it("mesma mensagem de erro que validarCampanha pros mesmos campos (reaproveita validarCriacaoGrupos)", async () => {
    const { validarCampanha } = await import("@/src/lib/regras/campanha");
    const camp = validarCampanha({
      nome: "x", slug: "xx", padrao_nome: "", descricao: "", fechado: true, limite_por_grupo: 1000, folga: 1,
      conexao_criadora_id: "c1", admins: [], usar_comunidade: false, crm_webhook_url: "", projeto_id: null,
    });
    const pad = validarPadraoCampanha({ ...base, padrao_nome: "" });
    expect(camp).toEqual({ ok: false, erro: "Dê um padrão de nome para os grupos." });
    expect(pad).toEqual({ ok: false, erro: "Dê um padrão de nome para os grupos." });
  });
});

describe("lerPadraoCampanha", () => {
  it("null quando o valor não é um objeto", () => {
    expect(lerPadraoCampanha(null)).toBeNull();
    expect(lerPadraoCampanha(undefined)).toBeNull();
    expect(lerPadraoCampanha("texto")).toBeNull();
  });

  it("null quando o conteúdo não passa na validação (configuração corrompida)", () => {
    expect(lerPadraoCampanha({ ativo: true, padrao_nome: "", limite_por_grupo: 1000, folga: 1 })).toBeNull();
  });

  it("lê um valor válido, com os padrões certos pros campos ausentes; descarta admins que não são uuid", () => {
    expect(lerPadraoCampanha({ ativo: true, padrao_nome: "AULÃO #{n}", limite_por_grupo: 500, folga: 2, admins: [C1, C2, 3, "estragado"] })).toEqual({
      ativo: true, fechado: true, limite_por_grupo: 500, folga: 2, padrao_nome: "AULÃO #{n}", usar_comunidade: false, admins: [C1, C2],
    });
  });

  it("fechado: ausente ou true vira true; só explicitamente false vira false", () => {
    expect(lerPadraoCampanha({ ativo: true, padrao_nome: "G #{n}", limite_por_grupo: 100, folga: 1, fechado: false })?.fechado).toBe(false);
    expect(lerPadraoCampanha({ ativo: true, padrao_nome: "G #{n}", limite_por_grupo: 100, folga: 1 })?.fechado).toBe(true);
  });
});

describe("aplicarPadraoEmEntrada", () => {
  const entrada: CampanhaEntrada = {
    nome: "Aulão", slug: "aulao", padrao_nome: "GRUPO #{n}", descricao: "", fechado: false, limite_por_grupo: 1000, folga: 1,
    conexao_criadora_id: "criadora", admins: [], usar_comunidade: false, crm_webhook_url: "", projeto_id: null,
  };

  it("padrão desligado: devolve a entrada sem mudar nada", () => {
    expect(aplicarPadraoEmEntrada(entrada, { ...PADRAO_CAMPANHA_VAZIO, ativo: false, admins: ["x"] })).toEqual(entrada);
  });

  it("padrão ligado: troca fechado, limite, folga, padrao_nome, usar_comunidade e admins; nunca nome/slug/descrição/criadora", () => {
    const padrao = { ativo: true, fechado: true, limite_por_grupo: 300, folga: 4, padrao_nome: "TURMA #{n}", usar_comunidade: true, admins: ["a1", "a2"] };
    expect(aplicarPadraoEmEntrada(entrada, padrao)).toEqual({
      ...entrada,
      fechado: true, limite_por_grupo: 300, folga: 4, padrao_nome: "TURMA #{n}", usar_comunidade: true, admins: ["a1", "a2"],
    });
  });
});

describe("recusar_bloqueados no padrão (Etapa 3M, Tarefa 4)", () => {
  const base = { ativo: true, padrao_nome: "G #{n}", limite_por_grupo: 100, folga: 1 };
  it("ausente = undefined (fica o default false da coluna); presente entra na leitura e no aplicar", () => {
    expect(lerPadraoCampanha(base)?.recusar_bloqueados).toBeUndefined();
    expect("recusar_bloqueados" in camposAplicaveis(lerPadraoCampanha(base)!)).toBe(false);
    const ligado = lerPadraoCampanha({ ...base, recusar_bloqueados: true })!;
    expect(ligado.recusar_bloqueados).toBe(true);
    expect(camposAplicaveis(ligado)).toMatchObject({ recusar_bloqueados: true });
    expect(lerPadraoCampanha({ ...base, recusar_bloqueados: "sim" })?.recusar_bloqueados).toBeUndefined();
  });
});

describe("camposAplicaveis", () => {
  it("só os campos que 'Aplicar em campanhas existentes' pode gravar — nunca ativo nem admins", () => {
    const padrao = { ativo: true, fechado: true, limite_por_grupo: 300, folga: 4, padrao_nome: "TURMA #{n}", usar_comunidade: true, admins: ["a1"] };
    expect(camposAplicaveis(padrao)).toEqual({ fechado: true, limite_por_grupo: 300, folga: 4, padrao_nome: "TURMA #{n}", usar_comunidade: true });
  });

  it("Etapa 3K: só entram as chaves novas que estão presentes no padrão", () => {
    const padrao = {
      ...base, admins: [C1],
      cookie_redirecionamento: false, deep_linking: true, inicio_contagem: 5, modo_criacao: "seguro" as const,
    };
    expect(camposAplicaveis(padrao)).toEqual({
      fechado: true, limite_por_grupo: 1000, folga: 1, padrao_nome: "GRUPO #{n}", usar_comunidade: false,
      cookie_redirecionamento: false, deep_linking: true, inicio_contagem: 5, modo_criacao: "seguro",
    });
  });

  it("liga links_periodicos: zera links_atualizados_em (primeira atualização no próximo tick)", () => {
    const padrao = { ...base, admins: [C1], links_periodicos: true, links_por_dia: 6 };
    expect(camposAplicaveis(padrao)).toMatchObject({ links_periodicos: true, links_por_dia: 6, links_atualizados_em: null });
  });
});

describe("Etapa 3K: campos novos de Configurações e Criação de grupos", () => {
  it("validarPadraoCampanha aceita os campos novos quando presentes e normaliza admins_numeros", () => {
    const r = validarPadraoCampanha({
      ...base, admins_numeros: ["(11) " + "99999-0001", "11" + "999990001"], cookie_redirecionamento: false, links_periodicos: true, links_por_dia: 6,
      aprovacao_entrada: true, mensagens_temporarias: "24h", inicio_contagem: 3, caractere_numeracao: "#", modo_criacao: "seguro",
    });
    expect(r).toMatchObject({
      ok: true,
      valor: {
        admins_numeros: ["5511" + "999990001"], cookie_redirecionamento: false, links_periodicos: true, links_por_dia: 6,
        aprovacao_entrada: true, mensagens_temporarias: "24h", inicio_contagem: 3, caractere_numeracao: "#", modo_criacao: "seguro",
      },
    });
  });

  it("campos novos ausentes: valor não ganha a chave (ausente = padrão do sistema)", () => {
    const r = validarPadraoCampanha(base);
    expect(r.ok && r.valor.links_por_dia).toBeUndefined();
    expect(r.ok && r.valor.cookie_redirecionamento).toBeUndefined();
  });

  it.each([
    [{ links_por_dia: 25 }, "A quantidade de atualizações por dia vai de 1 a 24."],
    [{ links_por_dia: 0 }, "A quantidade de atualizações por dia vai de 1 a 24."],
    [{ mensagens_temporarias: "sempre" }, "Opção de mensagens temporárias inválida."],
    [{ inicio_contagem: -1 }, "O início da contagem não pode ser negativo."],
    [{ caractere_numeracao: "####" }, "O caractere da numeração vai até 3 caracteres."],
    [{ limite_cliques_sem_criar: 0 }, "O limite de cliques sem criar grupo precisa ser pelo menos 1."],
    [{ modo_criacao: "turbo" }, "Modo de criação inválido."],
  ])("%o → %s", (mudanca, erro) => {
    expect(validarPadraoCampanha({ ...base, ...mudanca } as unknown as PadraoCampanhaEntrada)).toEqual({ ok: false, erro });
  });

  it("admins_numeros com mais de 20: recusa com a mensagem da Tarefa 1", () => {
    const vinte1 = Array.from({ length: 21 }, (_, i) => `55119${String(i).padStart(8, "0")}`);
    expect(validarPadraoCampanha({ ...base, admins_numeros: vinte1 })).toEqual({ ok: false, erro: "No máximo 20 administradores por número" });
  });

  it("lerPadraoCampanha: JSON de produção de hoje (sem as chaves novas) continua lido igual", () => {
    const jsonDeProducao = { ativo: true, fechado: true, limite_por_grupo: 1000, folga: 1, padrao_nome: "GRUPO #{n}", usar_comunidade: false, admins: [C1] };
    expect(lerPadraoCampanha(jsonDeProducao)).toEqual({ ativo: true, fechado: true, limite_por_grupo: 1000, folga: 1, padrao_nome: "GRUPO #{n}", usar_comunidade: false, admins: [C1] });
  });

  it("lerPadraoCampanha: lê os campos novos quando presentes no JSON salvo", () => {
    const salvo = { ...jsonBase(), cookie_redirecionamento: false, links_periodicos: true, links_por_dia: 12, admins_numeros: ["5511" + "999990001"] };
    const lido = lerPadraoCampanha(salvo);
    expect(lido).toMatchObject({ cookie_redirecionamento: false, links_periodicos: true, links_por_dia: 12, admins_numeros: ["5511" + "999990001"] });
  });

  function jsonBase() {
    return { ativo: true, fechado: true, limite_por_grupo: 1000, folga: 1, padrao_nome: "GRUPO #{n}", usar_comunidade: false, admins: [] };
  }
});

describe("Etapa 3K: aplicarPadraoEmEntrada com os campos novos", () => {
  const entrada: CampanhaEntrada = {
    nome: "Aulão", slug: "aulao", padrao_nome: "GRUPO #{n}", descricao: "", fechado: false, limite_por_grupo: 1000, folga: 1,
    conexao_criadora_id: "criadora", admins: [], usar_comunidade: false, crm_webhook_url: "", projeto_id: null,
  };

  it("padrão ligado com campos novos: entram no resultado (mesmo ponto de entrada de 'Criação de grupos')", () => {
    const padrao = { ...PADRAO_CAMPANHA_VAZIO, ativo: true, admins: [], cookie_redirecionamento: false, modo_criacao: "seguro" as const, inicio_contagem: 7 };
    const r = aplicarPadraoEmEntrada(entrada, padrao) as CampanhaEntrada & { cookie_redirecionamento: boolean; modo_criacao: string; inicio_contagem: number };
    expect(r.cookie_redirecionamento).toBe(false);
    expect(r.modo_criacao).toBe("seguro");
    expect(r.inicio_contagem).toBe(7);
  });

  it("padrão ligado sem os campos novos: regressão — nenhuma chave nova aparece no resultado", () => {
    const padrao = { ...PADRAO_CAMPANHA_VAZIO, ativo: true, admins: [] };
    const r = aplicarPadraoEmEntrada(entrada, padrao) as Record<string, unknown>;
    expect(r.cookie_redirecionamento).toBeUndefined();
    expect(r.modo_criacao).toBeUndefined();
    expect(r).toEqual({ ...entrada, fechado: true, limite_por_grupo: 350, folga: 1, padrao_nome: "GRUPO #{n}", usar_comunidade: false, admins: [] });
  });
});

/** Etapa 3M, Tarefa 2: "Imagem do grupo" no padrão (regras puras). */
describe("Padrão: imagem do grupo", () => {
  const IMAGEM = "https://exemplo.supabase.co/storage/v1/object/public/midias/padrao-campanha/1760000000000-capa.png";

  it("validar: https de host público ok; vazio vira null; http e host privado recusados; ausente continua ausente", () => {
    expect(validarPadraoCampanha({ ...base, imagem_grupo_url: IMAGEM })).toMatchObject({ ok: true, valor: { imagem_grupo_url: IMAGEM } });
    expect(validarPadraoCampanha({ ...base, imagem_grupo_url: "" })).toMatchObject({ ok: true, valor: { imagem_grupo_url: null } });
    expect(validarPadraoCampanha({ ...base, imagem_grupo_url: "http://x/a.png" })).toEqual({ ok: false, erro: "Imagem do grupo inválida: envie a imagem pelo Vórtex Grupo." });
    expect(validarPadraoCampanha({ ...base, imagem_grupo_url: "https://192.168.0.1/a.png" }).ok).toBe(false);
    const semChave = validarPadraoCampanha(base);
    expect(semChave.ok && "imagem_grupo_url" in semChave.valor).toBe(false);
  });

  it("lerPadraoCampanha: lê a imagem salva; estragada vira ausente sem invalidar o padrão", () => {
    const json = { ativo: true, fechado: true, limite_por_grupo: 1000, folga: 1, padrao_nome: "GRUPO #{n}", usar_comunidade: false, admins: [C1] };
    expect(lerPadraoCampanha({ ...json, imagem_grupo_url: IMAGEM })).toMatchObject({ imagem_grupo_url: IMAGEM });
    expect(lerPadraoCampanha({ ...json, imagem_grupo_url: null })).toMatchObject({ imagem_grupo_url: null });
    const estragada = lerPadraoCampanha({ ...json, imagem_grupo_url: "http://x/a.png" });
    expect(estragada).not.toBeNull();
    expect(estragada!.imagem_grupo_url).toBeUndefined();
  });

  it("aplicado na criação (aplicarPadraoEmEntrada) e ignorado no \"Aplicar\" (camposAplicaveis)", () => {
    const entrada: CampanhaEntrada = {
      nome: "Aulão", slug: "aulao", padrao_nome: "GRUPO #{n}", descricao: "", fechado: false, limite_por_grupo: 1000, folga: 1,
      conexao_criadora_id: "criadora", admins: [], usar_comunidade: false, crm_webhook_url: "", projeto_id: null,
    };
    const padrao = { ...PADRAO_CAMPANHA_VAZIO, ativo: true, imagem_grupo_url: IMAGEM };
    expect((aplicarPadraoEmEntrada(entrada, padrao) as CampanhaEntrada & { imagem_grupo_url?: string }).imagem_grupo_url).toBe(IMAGEM);
    expect(camposAplicaveis(padrao)).not.toHaveProperty("imagem_grupo_url");
  });
});
