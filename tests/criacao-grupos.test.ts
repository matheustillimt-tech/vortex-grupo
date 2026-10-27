import { describe, expect, it } from "vitest";
import {
  criacaoAutomatica,
  ESPERA_MODO_SEGURO_MS,
  esperarModoSeguro,
  execucaoFecharGrupo,
  motivoNaoCriar,
  opcoesCriacao,
  PADRAO_CRIACAO,
  proximoNumero,
  segundosTemporarias,
  validarOpcoesCriacao,
} from "@/src/lib/regras/criacao-grupos";
import { nomeDoGrupo } from "@/src/lib/regras/nome-grupo";
import { cheioFinal, estaCheio, LIMITE_WHATSAPP } from "@/src/lib/regras/ocupacao";
import { juntarVariaveis, resolverTexto, variaveisDoGrupo } from "@/src/lib/regras/variaveis";

/** Cópia exata do `nomeDoGrupo` de antes da Etapa 3E: o padrão novo tem que dar o mesmo nome. */
function nomeAntigo(padrao: string, n: number): string {
  const nome = padrao.includes("{n}") ? padrao.replaceAll("{n}", String(n).padStart(2, "0")) : `${padrao} ${String(n).padStart(2, "0")}`;
  return Array.from(nome).slice(0, 25).join("");
}

describe("regressão: nome do grupo com os padrões da campanha", () => {
  const padroes = ["AULÃO #{n}", "Aulão", "COMO FAÇO 100 MIL MENSAL #{n}", "Turma #", "{n} - Turma {n}", "", "Grupo 🚀 {n}", "Um nome bem comprido sem número nenhum aqui"];
  const numeros = [0, 1, 2, 9, 10, 99, 100, 1234];
  const o = opcoesCriacao({});
  it("com as opções padrão sai exatamente o nome de antes", () => {
    for (const p of padroes) {
      for (const n of numeros) {
        expect(nomeDoGrupo(p, n, { caractere: o.caractere_numeracao, noInicio: o.numero_no_inicio })).toBe(nomeAntigo(p, n));
        expect(nomeDoGrupo(p, n)).toBe(nomeAntigo(p, n));
      }
    }
  });
  it("os padrões das opções batem com os padrões da migração", () => {
    expect(opcoesCriacao({})).toEqual(PADRAO_CRIACAO);
    expect(opcoesCriacao(null)).toEqual(PADRAO_CRIACAO);
    expect(PADRAO_CRIACAO).toEqual({
      caractere_numeracao: "",
      inicio_contagem: 1,
      numero_no_inicio: false,
      nao_criar_grupos: false,
      limite_cliques_sem_criar: null,
      criar_aberto_fechar_24h: false,
      mensagens_temporarias: "nao",
      aprovacao_entrada: false,
      modo_criacao: "normal",
      imagem_grupo_url: null,
      recusar_bloqueados: false,
    });
  });
  it("numeração de antes: o maior + 1, começando em 1", () => {
    expect(proximoNumero(null, 1)).toBe(1);
    expect(proximoNumero(undefined, 1)).toBe(1);
    expect(proximoNumero(0, 1)).toBe(1);
    expect(proximoNumero(7, 1)).toBe(8);
  });
});

describe("nomeDoGrupo com numeração", () => {
  it("caractere vai antes do número, no lugar de {n}", () => {
    expect(nomeDoGrupo("AULÃO {n}", 3, { caractere: "#" })).toBe("AULÃO #03");
    expect(nomeDoGrupo("AULÃO {n}", 3, { caractere: "!" })).toBe("AULÃO !03");
  });
  it("sem {n}: no fim por padrão, no começo com noInicio", () => {
    expect(nomeDoGrupo("Aulão", 3, { caractere: "#" })).toBe("Aulão #03");
    expect(nomeDoGrupo("Aulão", 3, { caractere: "#", noInicio: true })).toBe("#03 Aulão");
    expect(nomeDoGrupo("Aulão", 3, { noInicio: true })).toBe("03 Aulão");
  });
  it("com {n} a posição vem do padrão (noInicio não mexe)", () => {
    expect(nomeDoGrupo("Aulão {n} VIP", 3, { noInicio: true })).toBe("Aulão 03 VIP");
  });
  it("continua cortando em 25", () => {
    expect(Array.from(nomeDoGrupo("COMO FAÇO 100 MIL MENSAL", 7, { caractere: "###", noInicio: true }))).toHaveLength(25);
  });
});

describe("opções de criação", () => {
  it("lê valores válidos e cai no padrão com lixo", () => {
    expect(opcoesCriacao({ caractere_numeracao: "#", inicio_contagem: 0, numero_no_inicio: true, nao_criar_grupos: true, limite_cliques_sem_criar: 50, criar_aberto_fechar_24h: true, mensagens_temporarias: "7d", aprovacao_entrada: true, modo_criacao: "seguro" })).toEqual({
      caractere_numeracao: "#",
      inicio_contagem: 0,
      numero_no_inicio: true,
      nao_criar_grupos: true,
      limite_cliques_sem_criar: 50,
      criar_aberto_fechar_24h: true,
      mensagens_temporarias: "7d",
      aprovacao_entrada: true,
      modo_criacao: "seguro",
      imagem_grupo_url: null,
      recusar_bloqueados: false,
    });
    expect(opcoesCriacao({ inicio_contagem: -3, limite_cliques_sem_criar: 0, mensagens_temporarias: "30d", modo_criacao: "x" })).toEqual(PADRAO_CRIACAO);
  });
  it("início da contagem: primeiro grupo nele, nunca abaixo dele", () => {
    expect(proximoNumero(null, 0)).toBe(0);
    expect(proximoNumero(null, 50)).toBe(50);
    expect(proximoNumero(3, 50)).toBe(50);
    expect(proximoNumero(60, 50)).toBe(61);
  });
  it("travas de criação automática", () => {
    expect(motivoNaoCriar(PADRAO_CRIACAO, 999_999)).toBeNull();
    expect(motivoNaoCriar({ nao_criar_grupos: true, limite_cliques_sem_criar: null }, 0)).toMatch(/Não criar grupos/);
    expect(motivoNaoCriar({ nao_criar_grupos: false, limite_cliques_sem_criar: 100 }, 99)).toBeNull();
    expect(motivoNaoCriar({ nao_criar_grupos: false, limite_cliques_sem_criar: 100 }, 100)).toMatch(/Cliques altos \(100 na última hora, limite 100\)/);
  });
  it("só o botão manual escapa das travas", () => {
    expect(criacaoAutomatica("manual")).toBe(false);
    expect(criacaoAutomatica("folga")).toBe(true);
    expect(criacaoAutomatica("link-sem-vaga")).toBe(true);
    expect(criacaoAutomatica(null)).toBe(true);
  });
  it("modo seguro espera 10 min desde a última criação da conexão; normal nunca espera", () => {
    const agora = new Date("2026-10-17T12:00:00Z");
    expect(esperarModoSeguro("normal", new Date(agora.getTime() - 1000), agora)).toBeNull();
    expect(esperarModoSeguro("seguro", null, agora)).toBeNull();
    expect(esperarModoSeguro("seguro", new Date(agora.getTime() - ESPERA_MODO_SEGURO_MS), agora)).toBeNull();
    const ultima = new Date(agora.getTime() - 4 * 60_000);
    expect(esperarModoSeguro("seguro", ultima, agora)).toEqual(new Date(ultima.getTime() + 10 * 60_000));
  });
  it("mensagens temporárias em segundos ('nao' não chama o Zapbot)", () => {
    expect(segundosTemporarias("nao")).toBeNull();
    expect(segundosTemporarias("24h")).toBe(86400);
    expect(segundosTemporarias("7d")).toBe(604800);
    expect(segundosTemporarias("90d")).toBe(7776000);
  });
  it("execução de fechar: 24 h depois, origem grupo_novo, só o grupo criado", () => {
    expect(execucaoFecharGrupo("c1", "g1", new Date("2026-10-17T12:00:00Z"))).toEqual({
      campanha_id: "c1",
      origem: "grupo_novo",
      tipo: "fechar",
      conteudo: {},
      alvo_grupos: ["g1"],
      agendada_para: "2026-10-18T12:00:00.000Z",
      importante: false,
    });
  });
});

describe("cheioFinal", () => {
  it("automático (null) = estimativa de antes", () => {
    for (const [p, c, l] of [[900, 167, 1000], [900, 100, 1000], [0, 0, 1], [10, 0, 10], [9, 0, 10]] as const) {
      expect(cheioFinal(null, p, c, l)).toBe(estaCheio(p, c, l));
      expect(cheioFinal(undefined, p, c, l)).toBe(estaCheio(p, c, l));
    }
  });
  it("manual vale por cima da estimativa", () => {
    expect(cheioFinal(true, 0, 0, 1000)).toBe(true);
    expect(cheioFinal(false, 1000, 0, 1000)).toBe(false);
    expect(cheioFinal(false, 900, 100, 1000)).toBe(false);
  });
  it("no limite do WhatsApp é sempre cheio, mesmo marcado não cheio", () => {
    expect(cheioFinal(false, LIMITE_WHATSAPP, 0, 2000)).toBe(true);
    expect(cheioFinal(false, 1023, 2, 2000)).toBe(true);
    expect(cheioFinal(false, 1023, 0, 2000)).toBe(false);
  });  it("reservados = 0 (padrão): resultado idêntico ao de hoje numa grade de entradas (Etapa 3N)", () => {
    for (const manual of [null, undefined, true, false] as const) {
      for (const p of [0, 1, 9, 10, 500, 999, 1000, 1023, 1024]) {
        for (const c of [0, 1, 2, 10, 200]) {
          for (const l of [1, 10, 500, 1000, 2000]) {
            expect(cheioFinal(manual, p, c, l, 0)).toBe(cheioFinal(manual, p, c, l));
            expect(estaCheio(p, c, l, 0)).toBe(estaCheio(p, c, l));
          }
        }
      }
    }
  });
  it("reservados somam só contra o limite da campanha, nunca contra o do WhatsApp; manual continua valendo", () => {
    expect(cheioFinal(null, 5, 0, 10)).toBe(false);
    expect(cheioFinal(null, 5, 0, 10, 4)).toBe(false);
    expect(cheioFinal(null, 5, 0, 10, 5)).toBe(true);
    expect(cheioFinal(false, 5, 0, 10, 50)).toBe(false);
    // 1020 pessoas, limite da campanha 2000, 10 reservados: o limite do WhatsApp não conta reservas.
    expect(cheioFinal(null, 1020, 0, 2000, 10)).toBe(false);
    expect(cheioFinal(null, 5, 0, 10, Number.NaN)).toBe(false);
    expect(cheioFinal(null, 5, 0, 10, -3)).toBe(false);
  });
});

describe("variaveisDoGrupo", () => {
  const camp = juntarVariaveis({ link_grupo: "https://x/l/a", nome_campanha: "C" }, [{ chave: "cupom", valor: "CAMP" }, { chave: "bonus", valor: "B" }]);
  it("sem valor no grupo, herda tudo da campanha", () => {
    expect(variaveisDoGrupo(camp, [])).toEqual(camp);
  });
  it("valor do grupo sobrepõe; vazio, só espaço ou null herdam", () => {
    const v = variaveisDoGrupo(camp, [{ chave: "cupom", valor: "GRUPO" }, { chave: "bonus", valor: "  " }, { chave: "extra", valor: "" }, { chave: "nulo", valor: null }]);
    expect(v.cupom).toBe("GRUPO");
    expect(v.bonus).toBe("B");
    expect("extra" in v).toBe(false);
    expect(resolverTexto("{cupom} {bonus}", v).texto).toBe("GRUPO B");
  });
  it("chave só do grupo preenche o que faltava na campanha", () => {
    expect(resolverTexto("{so_grupo}", variaveisDoGrupo(camp, [{ chave: "so_grupo", valor: "ok" }]))).toEqual({ texto: "ok", faltando: [] });
  });
  it("automáticas continuam da campanha", () => {
    expect(variaveisDoGrupo(camp, [{ chave: "link_grupo", valor: "outro" }]).link_grupo).toBe("https://x/l/a");
  });
  it("não muda o objeto da campanha", () => {
    variaveisDoGrupo(camp, [{ chave: "cupom", valor: "GRUPO" }]);
    expect(camp.cupom).toBe("CAMP");
  });
});

describe("trocarN / nomeLongo com caractere (Trocar nome, Etapa 3E)", () => {
  it("padrão vazio: igual a antes", async () => {
    const { trocarN, nomeLongo } = await import("@/src/lib/regras/nome-grupo");
    for (const p of ["AULÃO #{n}", "Nome fixo", "{n}{n}"]) for (const n of [1, 12, 100]) {
      expect(trocarN(p, n)).toBe(p.replaceAll("{n}", String(n).padStart(2, "0")));
      expect(trocarN(p, n, "")).toBe(trocarN(p, n));
    }
    expect(nomeLongo("COMO FAÇO 100 MIL MENSAL {n}", [1])).toBe(nomeLongo("COMO FAÇO 100 MIL MENSAL {n}", [1], ""));
  });
  it("caractere vai antes do número; nome fixo (sem {n}) continua fixo", async () => {
    const { trocarN, nomeLongo } = await import("@/src/lib/regras/nome-grupo");
    expect(trocarN("Turma {n}", 3, "!")).toBe("Turma !03");
    expect(trocarN("Encerrado", 3, "!")).toBe("Encerrado");
    expect(nomeLongo("1234567890123456789012 {n}", [1], "")).toBeNull();
    expect(nomeLongo("1234567890123456789012 {n}", [1], "#")).toBe("1234567890123456789012 #01");
  });
});

describe("padraoComNumero (revisão final da Etapa 3E, 'Alterar grupos em lote' nunca dá nome idêntico pra todos)", () => {
  it("padrão já com {n}: devolve sem mudar", async () => {
    const { padraoComNumero } = await import("@/src/lib/regras/nome-grupo");
    expect(padraoComNumero("AULÃO #{n}")).toBe("AULÃO #{n}");
    expect(padraoComNumero("AULÃO #{n}", true)).toBe("AULÃO #{n}");
  });
  it("padrão sem {n}: número no fim (padrão) ou no início (noInicio)", async () => {
    const { padraoComNumero } = await import("@/src/lib/regras/nome-grupo");
    expect(padraoComNumero("GRUPO VIP")).toBe("GRUPO VIP {n}");
    expect(padraoComNumero("GRUPO VIP", false)).toBe("GRUPO VIP {n}");
    expect(padraoComNumero("GRUPO VIP", true)).toBe("{n} GRUPO VIP");
  });
});

describe("recusar_bloqueados nas opções de criação (Etapa 3M, Tarefa 4)", () => {
  it("lê só true; ausente/lixo = false; validação aceita ausente e recusa não booleano", () => {
    expect(opcoesCriacao({ recusar_bloqueados: true }).recusar_bloqueados).toBe(true);
    expect(opcoesCriacao({ recusar_bloqueados: "true" }).recusar_bloqueados).toBe(false);
    const { recusar_bloqueados: _r, ...semCampo } = PADRAO_CRIACAO;
    expect(validarOpcoesCriacao(semCampo as never)).toEqual({ ok: true, valor: PADRAO_CRIACAO });
    expect(validarOpcoesCriacao({ ...PADRAO_CRIACAO, recusar_bloqueados: true })).toMatchObject({ ok: true, valor: { recusar_bloqueados: true } });
    expect(validarOpcoesCriacao({ ...PADRAO_CRIACAO, recusar_bloqueados: 1 }).ok).toBe(false);
  });
});

describe("validarOpcoesCriacao (diálogo 'Criação de grupos', Etapa 3E Tarefa 3)", () => {
  const ok = { ...PADRAO_CRIACAO };
  it("os padrões passam", () => {
    expect(validarOpcoesCriacao(ok)).toEqual({ ok: true, valor: PADRAO_CRIACAO });
  });
  it("caractere da numeração: até 3 caracteres", () => {
    expect(validarOpcoesCriacao({ ...ok, caractere_numeracao: "####" })).toEqual({ ok: false, erro: "O caractere da numeração vai até 3 caracteres." });
    expect(validarOpcoesCriacao({ ...ok, caractere_numeracao: "###" }).ok).toBe(true);
  });
  it("início da contagem: inteiro não negativo", () => {
    expect(validarOpcoesCriacao({ ...ok, inicio_contagem: -1 })).toEqual({ ok: false, erro: "O início da contagem não pode ser negativo." });
    expect(validarOpcoesCriacao({ ...ok, inicio_contagem: 1.5 }).ok).toBe(false);
  });
  it("limite de cliques sem criar: null ou inteiro >= 1", () => {
    expect(validarOpcoesCriacao({ ...ok, limite_cliques_sem_criar: 0 })).toEqual({ ok: false, erro: "O limite de cliques sem criar grupo precisa ser pelo menos 1." });
    expect(validarOpcoesCriacao({ ...ok, limite_cliques_sem_criar: null }).ok).toBe(true);
    expect(validarOpcoesCriacao({ ...ok, limite_cliques_sem_criar: 50 }).ok).toBe(true);
  });
  it("mensagens temporárias e modo de criação: só os valores válidos", () => {
    expect(validarOpcoesCriacao({ ...ok, mensagens_temporarias: "99d" as never })).toEqual({ ok: false, erro: "Opção de mensagens temporárias inválida." });
    expect(validarOpcoesCriacao({ ...ok, modo_criacao: "turbo" as never })).toEqual({ ok: false, erro: "Modo de criação inválido." });
  });
});
