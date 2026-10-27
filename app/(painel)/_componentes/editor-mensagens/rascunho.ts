import { TIPOS_BOTAO, type BotaoV2, type FormatoMensagemV2, type MensagemV2, type TipoBotao } from "@/src/lib/regras/conteudo-v2";

/** Estado do formulário central (rascunho da mensagem em edição) — um superconjunto plano de todos os formatos,
 *  pra não precisar de um componente por formato guardando estado próprio. Convertido pra `MensagemV2` só ao
 *  salvar (`mensagemDeRascunho`). Módulo puro — sem React, pra poder testar/trocar sem tocar na UI. */
export type Rascunho = {
  texto: string;
  midia_url: string | null;
  nome_arquivo: string | null;
  legenda: string;
  contato_nome: string;
  contato_telefone: string;
  evento_nome: string;
  evento_descricao: string;
  evento_inicio: string;
  evento_fim: string;
  evento_local: string;
  botoes: BotaoV2[];
  enquete_pergunta: string;
  enquete_opcoes: string[];
  enquete_max: number;
};

export function rascunhoVazio(): Rascunho {
  return {
    texto: "",
    midia_url: null,
    nome_arquivo: null,
    legenda: "",
    contato_nome: "",
    contato_telefone: "",
    evento_nome: "",
    evento_descricao: "",
    evento_inicio: "",
    evento_fim: "",
    evento_local: "",
    botoes: [{ tipo: "link" as TipoBotao, rotulo: "", valor: "" }],
    enquete_pergunta: "",
    enquete_opcoes: ["", ""],
    enquete_max: 1,
  };
}

/** Carrega uma mensagem existente (ao clicar numa já salva pra editar) de volta no formulário central. */
export function rascunhoDeMensagem(m: MensagemV2): Rascunho {
  const base = rascunhoVazio();
  switch (m.formato) {
    case "texto":
      return { ...base, texto: m.texto };
    case "contato":
      return { ...base, contato_nome: m.contato.nome, contato_telefone: m.contato.telefone };
    case "evento":
      return {
        ...base,
        evento_nome: m.evento.nome,
        evento_descricao: m.evento.descricao ?? "",
        evento_inicio: m.evento.inicio,
        evento_fim: m.evento.fim ?? "",
        evento_local: m.evento.local ?? "",
      };
    case "botoes":
      return { ...base, texto: m.texto, botoes: m.botoes.length ? m.botoes : base.botoes };
    case "enquete":
      return { ...base, enquete_pergunta: m.enquete.pergunta, enquete_opcoes: m.enquete.opcoes, enquete_max: m.enquete.max_respostas };
    default:
      return { ...base, midia_url: m.midia_url, nome_arquivo: m.nome_arquivo, legenda: m.legenda };
  }
}

/** Converte o rascunho atual pro `MensagemV2` do formato escolhido, ou devolve o motivo de não poder salvar ainda
 *  (mensagens de erro curtas, pra mostrar junto do botão SALVAR — a validação completa de verdade é a do servidor,
 *  `validarConteudoV2`). */
export function mensagemDeRascunho(formato: FormatoMensagemV2, r: Rascunho): { ok: true; valor: MensagemV2 } | { ok: false; erro: string } {
  switch (formato) {
    case "texto":
      if (!r.texto.trim()) return { ok: false, erro: "Escreva a mensagem." };
      return { ok: true, valor: { formato: "texto", texto: r.texto } };
    case "contato":
      if (!r.contato_nome.trim()) return { ok: false, erro: "Escreva o nome do contato." };
      if (!r.contato_telefone.trim()) return { ok: false, erro: "Escreva o telefone do contato." };
      return { ok: true, valor: { formato: "contato", contato: { nome: r.contato_nome.trim(), telefone: r.contato_telefone.trim() } } };
    case "evento":
      if (!r.evento_nome.trim()) return { ok: false, erro: "Escreva o nome do evento." };
      if (!r.evento_inicio) return { ok: false, erro: "Escolha a data de início do evento." };
      return {
        ok: true,
        valor: {
          formato: "evento",
          evento: {
            nome: r.evento_nome.trim(),
            descricao: r.evento_descricao.trim() || null,
            inicio: new Date(r.evento_inicio).toISOString(),
            fim: r.evento_fim ? new Date(r.evento_fim).toISOString() : null,
            local: r.evento_local.trim() || null,
          },
        },
      };
    case "botoes": {
      if (!r.texto.trim()) return { ok: false, erro: "Escreva o texto da mensagem." };
      const botoes = r.botoes.filter((b) => b.rotulo.trim() && b.valor.trim());
      if (botoes.length < 1) return { ok: false, erro: "Preencha ao menos 1 botão." };
      if (botoes.length > 3) return { ok: false, erro: "No máximo 3 botões." };
      return { ok: true, valor: { formato: "botoes", texto: r.texto, botoes } };
    }
    case "enquete": {
      const opcoes = r.enquete_opcoes.map((o) => o.trim()).filter(Boolean);
      if (!r.enquete_pergunta.trim()) return { ok: false, erro: "Escreva a pergunta da enquete." };
      if (opcoes.length < 2) return { ok: false, erro: "A enquete precisa de ao menos 2 opções." };
      return {
        ok: true,
        valor: { formato: "enquete", enquete: { pergunta: r.enquete_pergunta.trim(), opcoes, max_respostas: Math.min(r.enquete_max, opcoes.length) || 1 } },
      };
    }
    default: {
      if (!r.midia_url) return { ok: false, erro: "Envie o arquivo." };
      return { ok: true, valor: { formato, midia_url: r.midia_url, nome_arquivo: r.nome_arquivo, legenda: r.legenda } };
    }
  }
}

export const TIPOS_BOTAO_ROTULO: Record<TipoBotao, string> = { resposta: "Resposta", link: "Link", ligar: "Ligar", copiar: "Copiar" };
export { TIPOS_BOTAO };
export { TIPOS_BOTAO_DISPONIVEIS } from "@/src/lib/regras/conteudo-v2";
