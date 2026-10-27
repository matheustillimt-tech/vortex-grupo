import { describe, expect, it } from "vitest";
import { duracao, filtroTipos, ICONE_ACAO, ROTULO_ACAO, situacaoAcao, tituloCartao } from "@/src/lib/regras/acoes";

describe("ROTULO_ACAO / ICONE_ACAO / tituloCartao", () => {
  it("cobre os 9 tipos de execução com os rótulos da spec", () => {
    expect(ROTULO_ACAO.mensagem).toBe("Enviar mensagem");
    expect(ROTULO_ACAO.enquete).toBe("Enviar enquete");
    expect(ROTULO_ACAO.nome).toBe("Trocar nome");
    expect(ROTULO_ACAO.descricao).toBe("Trocar descrição");
    expect(ROTULO_ACAO.abrir).toBe("Abrir Grupos");
    expect(ROTULO_ACAO.fechar).toBe("Fechar Grupos");
    expect(ROTULO_ACAO.admin_add).toBe("Adicionar administradores");
    expect(ROTULO_ACAO.admin_remover).toBe("Remover administradores");
    expect(ROTULO_ACAO.redefinir_link).toBe("Redefinir link de convite");
    expect(Object.keys(ROTULO_ACAO).sort()).toEqual(Object.keys(ICONE_ACAO).sort());
  });

  it("título do cartão prefixa 'Campanha: '", () => {
    expect(tituloCartao("mensagem")).toBe("Campanha: Enviar mensagem");
    expect(tituloCartao("redefinir_link")).toBe("Campanha: Redefinir link de convite");
  });

  it("cobre os 5 tipos novos (Etapa 3C, Tarefa 1)", () => {
    expect(ROTULO_ACAO.configuracao).toBe("Trocar configuração");
    expect(ROTULO_ACAO.remover_participantes).toBe("Remover participantes");
    expect(ROTULO_ACAO.desativar_comunidade).toBe("Desativar comunidade");
    expect(ROTULO_ACAO.atualizar_links).toBe("Atualizar links dos grupos");
    expect(ROTULO_ACAO.mover_grupos).toBe("Mover grupos para outra campanha");
    expect(ICONE_ACAO.configuracao).toBe("settings");
    expect(ICONE_ACAO.remover_participantes).toBe("person_remove");
    expect(ICONE_ACAO.desativar_comunidade).toBe("delete");
    expect(ICONE_ACAO.atualizar_links).toBe("link");
    expect(ICONE_ACAO.mover_grupos).toBe("move_to_inbox");
  });
});

describe("situacaoAcao", () => {
  const agora = new Date("2026-10-17T12:00:00Z");

  it("agendada: fila se já passou da hora, agendado se ainda não", () => {
    expect(situacaoAcao("agendada", "2026-10-17T11:00:00Z", false, agora)).toEqual({ rotulo: "Na fila", cor: "neutro" });
    expect(situacaoAcao("agendada", "2026-10-17T13:00:00Z", false, agora)).toEqual({ rotulo: "Agendado", cor: "neutro" });
  });

  it("enviando é sempre Processando", () => {
    expect(situacaoAcao("enviando", "2026-10-17T11:00:00Z", false, agora)).toEqual({ rotulo: "Processando", cor: "aviso" });
  });

  it("concluida: Sucesso sem falha, Falha com falha", () => {
    expect(situacaoAcao("concluida", "2026-10-17T11:00:00Z", false, agora)).toEqual({ rotulo: "Sucesso", cor: "ok" });
    expect(situacaoAcao("concluida", "2026-10-17T11:00:00Z", true, agora)).toEqual({ rotulo: "Falha", cor: "erro" });
  });

  it("bloqueada é Falha; cancelada é Cancelado; pulada é Pulado", () => {
    expect(situacaoAcao("bloqueada", "2026-10-17T11:00:00Z", false, agora)).toEqual({ rotulo: "Falha", cor: "erro" });
    expect(situacaoAcao("cancelada", "2026-10-17T11:00:00Z", false, agora)).toEqual({ rotulo: "Cancelado", cor: "neutro" });
    expect(situacaoAcao("pulada", "2026-10-17T11:00:00Z", false, agora)).toEqual({ rotulo: "Pulado", cor: "neutro" });
  });
});

describe("duracao", () => {
  it("milissegundos abaixo de 1s", () => {
    expect(duracao("2026-10-17T12:00:00.000Z", "2026-10-17T12:00:00.584Z")).toBe("584ms");
  });

  it("segundos abaixo de 1min, com ms", () => {
    expect(duracao("2026-10-17T12:00:00.000Z", "2026-10-17T12:00:12.000Z")).toBe("12s 0ms");
    expect(duracao("2026-10-17T12:00:00.000Z", "2026-10-17T12:00:08.882Z")).toBe("8s 882ms");
  });

  it("minutos e segundos", () => {
    expect(duracao("2026-10-17T12:00:00.000Z", "2026-10-17T12:03:04.000Z")).toBe("3min 4s");
  });

  it("minutos exatos, sem segundo sobrando", () => {
    expect(duracao("2026-10-17T12:00:00.000Z", "2026-10-17T12:05:00.000Z")).toBe("5min");
  });

  it("sem início, sem fim, ou fim antes do início: null", () => {
    expect(duracao(null, "2026-10-17T12:00:00.000Z")).toBeNull();
    expect(duracao("2026-10-17T12:00:00.000Z", null)).toBeNull();
    expect(duracao("2026-10-17T12:00:05.000Z", "2026-10-17T12:00:00.000Z")).toBeNull();
  });
});

describe("filtroTipos", () => {
  it("aceita array, filtra lixo e tira duplicado", () => {
    expect(filtroTipos(["mensagem", "nome", "mensagem", "lixo"])).toEqual(["mensagem", "nome"]);
  });

  it("aceita string separada por vírgula", () => {
    expect(filtroTipos("abrir,fechar")).toEqual(["abrir", "fechar"]);
  });

  it("nada válido (vazio, undefined, só lixo) vira null = todos os tipos", () => {
    expect(filtroTipos(undefined)).toBeNull();
    expect(filtroTipos(null)).toBeNull();
    expect(filtroTipos([])).toBeNull();
    expect(filtroTipos("lixo,outro-lixo")).toBeNull();
  });
});
