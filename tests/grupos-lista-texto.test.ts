import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** Testes de texto/estrutura (sem montar `.tsx`, como os outros arquivos desta pasta): confirmam que a Etapa 3N,
 *  Tarefa 5, está nos arquivos certos — a linha de grupo com os 5 rótulos/ícones, "Excluir" chamando a mesma
 *  action de "Desativar" de hoje (`desativarGrupos`) e a paginação de Mensagens sem `first_page`/`last_page`. */
const raiz = path.resolve(__dirname, "..");
const ler = (rel: string) => readFileSync(path.join(raiz, rel), "utf8");

describe("Grupos: linha com rótulo + ícone das 5 métricas", () => {
  it("lista.tsx mostra Redirect/ads_click, Cliques reais/mouse, Participantes/group, Administradores/admin_panel_settings e Leads/person", () => {
    const lista = ler("app/(painel)/campanhas/[id]/grupos/lista.tsx");
    for (const [rotulo, icone] of [
      ["Redirect", "ads_click"],
      ["Cliques reais", "mouse"],
      ["Participantes", "group"],
      ["Administradores", "admin_panel_settings"],
      ["Leads", "person"],
    ]) {
      expect(lista).toContain(`rotulo="${rotulo}" icone="${icone}"`);
    }
  });

  it("o nome trunca com title e o more_vert (MenuCartao) fica na linha do nome, não embaixo com as métricas", () => {
    const lista = ler("app/(painel)/campanhas/[id]/grupos/lista.tsx");
    expect(lista).toMatch(/truncate text-\[15px\] font-medium" title=\{g\.nome\}/);
    // A linha do nome (checkbox + avatar + nome + MenuCartao) é o primeiro bloco da `<li>`.
    const inicioLi = lista.indexOf("<li key={g.id}");
    const inicioMetricas = lista.indexOf("MetricaGrupo", inicioLi);
    const menuCartaoNaLinhaDoNome = lista.indexOf("<MenuCartao itens={itensMenu(g)} />", inicioLi);
    expect(menuCartaoNaLinhaDoNome).toBeGreaterThan(inicioLi);
    expect(menuCartaoNaLinhaDoNome).toBeLessThan(inicioMetricas);
  });
});

describe("Grupos: barra em massa \"Excluir\"", () => {
  it("o botão \"Excluir\" chama a mesma função que fazia \"Desativar\" hoje (desativarGrupos) com a confirmação do plano", () => {
    const lista = ler("app/(painel)/campanhas/[id]/grupos/lista.tsx");
    expect(lista).toContain("Excluir");
    expect(lista).not.toMatch(/>\s*Desativar\s*</);
    // O texto da confirmação (que descreve a desativação de verdade, não uma exclusão) mora em
    // `textoConfirmarDesativarGrupos` (revisão final B, item m5) — testado em tests/interacao-regras.test.ts.
    expect(lista).toContain("textoConfirmarDesativarGrupos(marcados.length)");
    // `excluir()` continua chamando `desativarGrupos` (a mesma action de antes) — só o texto do botão mudou.
    const inicioExcluir = lista.indexOf("async function excluir()");
    const fimExcluir = lista.indexOf("\n  }", inicioExcluir);
    expect(lista.slice(inicioExcluir, fimExcluir)).toContain("desativarGrupos(marcados, campanhaId)");
  });
});

describe("Paginação: sem pontas e opções próprias em Mensagens", () => {
  it("Paginacao esconde first_page/last_page quando pontas=false, e mostra quando pontas=true (padrão)", () => {
    const paginacao = ler("app/(painel)/_componentes/paginacao.tsx");
    expect(paginacao).toContain("pontas = true");
    expect(paginacao).toMatch(/\{pontas && seta\(primeira, "first_page"/);
    expect(paginacao).toMatch(/\{pontas && seta\(ultima, "last_page"/);
  });

  it("Mensagens da campanha passa pontas={false} e as opções 10/25/50", () => {
    const mensagens = ler("app/(painel)/campanhas/[id]/mensagens/page.tsx");
    expect(mensagens).toContain("pontas={false}");
    expect(mensagens).toContain("opcoesPorPagina={POR_PAGINA_MENSAGENS}");
    const tipos = ler("app/(painel)/_acoes/tipos.ts");
    expect(tipos).toMatch(/POR_PAGINA_MENSAGENS = \[10, 25, 50\]/);
  });
});
