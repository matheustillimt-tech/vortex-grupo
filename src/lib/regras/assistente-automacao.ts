import { acoesPermitidas, ehAcaoDePessoa, ROTULO_ACAO, validarAcaoDePessoa, validarTagCondicional, type EntradaAutomacao, type Gatilho, type TipoAcaoAutomacao } from "./automacoes";
import type { Provedor } from "../checkout/parsers";
import { validarConteudo } from "./conteudo";
import { brasiliaParaIso } from "./horario";

/** Passos do assistente de automação, na ordem da tela a partir da campanha: Categoria → Campanha →
 *  Grupo → Gatilho → Conta → Ação → Confirmar. "Grupo" e "Conta" aparecem sempre — o motor só usa `alvo_grupos`
 *  no cronograma (Ruling 1), mas o passo em si fica visível nos outros gatilhos com o texto explicativo. */
export const PASSOS_ASSISTENTE = ["categoria", "campanha", "grupos", "gatilho", "contas", "acao", "confirmar"] as const;
export type PassoAssistente = (typeof PASSOS_ASSISTENTE)[number];

/** Rótulos e ícones do stepper: Categoria `category`, Campanha
 *  `check_box`, Grupos `check_box`, Acionar ao `format_list_bulleted`, Contas `check_box`, Ação `checklist`,
 *  Confirmar `check`. Visual só — a chave de cada passo (`PassoAssistente`) não muda. */
export const ROTULO_PASSO: Record<PassoAssistente, { rotulo: string; icone: string }> = {
  categoria: { rotulo: "Categoria", icone: "category" },
  campanha: { rotulo: "Campanha", icone: "check_box" },
  grupos: { rotulo: "Grupos", icone: "check_box" },
  gatilho: { rotulo: "Acionar ao", icone: "format_list_bulleted" },
  contas: { rotulo: "Conexões", icone: "check_box" },
  acao: { rotulo: "Ação", icone: "checklist" },
  confirmar: { rotulo: "Confirmar", icone: "check" },
};

export type AcaoRascunho = { chave: string; tipo: TipoAcaoAutomacao; conteudo: unknown; atraso_min: number };

/** O que o assistente guarda enquanto a pessoa preenche. `quando` é o valor do campo datetime-local (Brasília).
 *  `provedor`/`produto` só valem com o gatilho "checkout". `todosGrupos`/`grupos` só valem de verdade no
 *  cronograma (Ruling 1); `todasContas`/`contas` valem em qualquer gatilho. */
export type EstadoAssistente = {
  categoria: "campanha" | null;
  campanhaId: string | null;
  gatilho: Gatilho | null;
  quando: string;
  todosGrupos: boolean;
  grupos: string[];
  todasContas: boolean;
  contas: string[];
  provedor: Provedor | null;
  produto: string;
  acoes: AcaoRascunho[];
  nome: string;
  pasta: string;
};

/** Os passos são sempre os mesmos (Ruling 1): "grupos" não depende mais do gatilho. */
export function passosDoAssistente(): PassoAssistente[] {
  return [...PASSOS_ASSISTENTE];
}

/** Passos exibidos na barra do topo (Etapa 3N): começa com Categoria, Gatilho, Ação, Confirmar e cresce
 *  conforme as escolhas — Campanha depois da Categoria, Contas depois da Campanha escolhida, Grupos enquanto o
 *  gatilho ainda não foi escolhido OU já é "cronograma" (Ruling 1: só ele usa `alvo_grupos`, mas o passo "Grupo"
 *  entra na barra assim que a Campanha é escolhida (Campanha → Grupo → Gatilho) e some só quando o
 *  gatilho escolhido não é o cronograma; revisão final B, item 5). Só visual: a navegação real continua nos 7
 *  passos de `passosDoAssistente`/`pendenciaDoPasso`, que não mudam. */
export function passosVisiveisAutomacao(e: EstadoAssistente): PassoAssistente[] {
  return passosDoAssistente().filter((p) => {
    if (p === "campanha") return e.categoria === "campanha";
    if (p === "contas") return !!e.campanhaId;
    if (p === "grupos") return !e.gatilho || e.gatilho === "cronograma";
    return true;
  });
}

/** Próximo passo da barra a partir de `atual` (pula os que a barra esconde; os escondidos nunca têm pendência). */
export function proximoPassoVisivel(e: EstadoAssistente, atual: PassoAssistente): PassoAssistente | null {
  const todos = passosDoAssistente();
  const visiveis = passosVisiveisAutomacao(e);
  return todos.slice(todos.indexOf(atual) + 1).find((p) => visiveis.includes(p)) ?? null;
}

/** Campo datetime-local (Brasília) → ISO, ou null se vazio/inválido. */
export function quandoIso(campo: string): string | null {
  try {
    return brasiliaParaIso(campo);
  } catch {
    return null;
  }
}

/** Grupos marcados que ainda são ativos da campanha escolhida (os de outra campanha ou desativados saem). */
export function gruposValidos(e: EstadoAssistente, ativosDaCampanha: string[]): string[] {
  const ativos = new Set(ativosDaCampanha);
  return e.grupos.filter((g) => ativos.has(g));
}

/** Ações do estado que ainda valem pro gatilho escolhido (usado ao trocar de gatilho, pra tirar as que deixaram
 *  de valer). */
export function acoesValidasParaGatilho(acoes: AcaoRascunho[], gatilho: Gatilho): AcaoRascunho[] {
  const permitidas = acoesPermitidas(gatilho);
  return acoes.filter((a) => permitidas.includes(a.tipo));
}

/** O que falta pra concluir o passo (texto pra mostrar), ou null se está completo. */
export function pendenciaDoPasso(
  passo: PassoAssistente,
  e: EstadoAssistente,
  ctx: { ativosDaCampanha: string[]; agora?: Date },
): string | null {
  const agora = ctx.agora ?? new Date();
  switch (passo) {
    case "categoria":
      return e.categoria ? null : "Escolha a categoria.";
    case "campanha":
      return e.campanhaId ? null : "Escolha a campanha.";
    case "gatilho": {
      if (!e.gatilho) return "Escolha o gatilho.";
      if (e.gatilho === "checkout") {
        // provedor null = qualquer plataforma (o cartão genérico de checkout); não é pendência.
        const produto = e.produto.trim();
        if (!produto) return "Escreva o nome do produto.";
        if (produto.length > 120) return "Produto com até 120 caracteres.";
        return null;
      }
      if (e.gatilho !== "cronograma") return null;
      const iso = quandoIso(e.quando);
      if (!iso) return "Escolha a data e a hora do disparo.";
      if (new Date(iso) <= agora) return "Escolha uma data futura.";
      return null;
    }
    case "grupos": {
      // Fora do cronograma o motor não usa `alvo_grupos` (Ruling 1): o passo vale sempre "todos", sem exigir nada.
      // Com o gatilho ainda não escolhido (passo visitado antes do Gatilho), a escolha livre ainda vale.
      if (e.gatilho && e.gatilho !== "cronograma") return null;
      if (e.todosGrupos) return null;
      return gruposValidos(e, ctx.ativosDaCampanha).length ? null : "Marque pelo menos um grupo.";
    }
    case "contas":
      if (e.todasContas) return null;
      return e.contas.length ? null : "Marque pelo menos uma conexão.";
    case "acao": {
      if (!e.acoes.length) return "Adicione pelo menos uma ação.";
      for (const [i, a] of e.acoes.entries()) {
        if (!Number.isInteger(a.atraso_min) || a.atraso_min < 0 || a.atraso_min > 1440) return `Ação ${i + 1}: atraso entre 0 e 1440 minutos.`;
        if (a.tipo === "remover_participante") continue; // sem conteúdo pra validar
        if (ehAcaoDePessoa(a.tipo)) {
          if (a.atraso_min !== 0) return `Ação ${i + 1}: ${ROTULO_ACAO[a.tipo]} é aplicada na hora, sem atraso.`;
          const p = validarAcaoDePessoa(a.tipo, a.conteudo);
          if (!p.ok) return `Ação ${i + 1}: ${p.erro}`;
          continue;
        }
        if (a.tipo === "tag_condicional") {
          const t = validarTagCondicional(a.conteudo);
          if (!t.ok) return `Ação ${i + 1}: ${t.erro}`;
          continue;
        }
        const v = validarConteudo(a.tipo, a.conteudo);
        if (!v.ok) return `Ação ${i + 1}: ${v.erro}`;
      }
      return null;
    }
    case "confirmar": {
      const nome = e.nome.trim();
      if (!nome) return "Dê um nome à automação.";
      if (nome.length > 80) return "Nome com até 80 caracteres.";
      if (e.pasta.trim().length > 40) return "Pasta com até 40 caracteres.";
      return null;
    }
  }
}

/** Dá pra ir direto ao passo `indice` (clique na barra): ele já foi visitado e todos os anteriores estão completos. */
export function podeIrPara(
  indice: number,
  passos: PassoAssistente[],
  visitados: ReadonlySet<PassoAssistente>,
  e: EstadoAssistente,
  ctx: { ativosDaCampanha: string[]; agora?: Date },
): boolean {
  const alvo = passos[indice];
  if (!alvo || !visitados.has(alvo)) return false;
  return passos.slice(0, indice).every((p) => pendenciaDoPasso(p, e, ctx) === null);
}

/** Estado → o que `salvarAutomacao` recebe. Campos que não valem pro gatilho escolhido vão nulos. `alvo_contas`
 *  vale em qualquer gatilho (o servidor confere se as contas marcadas são da campanha). */
export function montarEntrada(e: EstadoAssistente, ativosDaCampanha: string[]): EntradaAutomacao {
  const cronograma = e.gatilho === "cronograma";
  const checkout = e.gatilho === "checkout";
  return {
    nome: e.nome,
    campanha_id: e.campanhaId ?? "",
    gatilho: e.gatilho ?? "",
    quando: cronograma ? quandoIso(e.quando) : null,
    alvo_grupos: cronograma && !e.todosGrupos ? gruposValidos(e, ativosDaCampanha) : null,
    alvo_contas: e.todasContas ? null : e.contas,
    pasta: e.pasta.trim() || null,
    provedor: checkout ? e.provedor : null,
    produto: checkout ? e.produto.trim() || null : null,
    acoes: e.acoes.map((a) => ({ tipo: a.tipo, conteudo: a.conteudo, atraso_min: a.atraso_min })),
  };
}
