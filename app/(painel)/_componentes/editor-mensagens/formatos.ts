import type { FormatoMensagemV2 } from "@/src/lib/regras/conteudo-v2";

/** Botões redondos amarelos de tipo (coluna esquerda) — Ordem da tela. Sem "Texto": não há botão `chat` porque texto já é o formato padrão ao abrir o editor; clicar de novo no
 *  tipo já marcado (`escolherTipo` no editor) volta pra Texto. */
export const BOTOES_TIPO: { formato: FormatoMensagemV2; icone: string; rotulo: string }[] = [
  { formato: "enquete", icone: "bar_chart", rotulo: "Enquete" },
  { formato: "contato", icone: "person", rotulo: "Contato" },
  { formato: "evento", icone: "event", rotulo: "Evento" },
  { formato: "botoes", icone: "smart_button", rotulo: "Botões" },
  { formato: "figurinha", icone: "sticky_note_2", rotulo: "Figurinha" },
  { formato: "audio", icone: "mic", rotulo: "Áudio" },
  { formato: "imagem", icone: "image", rotulo: "Imagem" },
  { formato: "video", icone: "videocam", rotulo: "Vídeo" },
  { formato: "gif", icone: "gif_box", rotulo: "GIF" },
  { formato: "documento", icone: "description", rotulo: "Documento" },
];

export const ACEITA_ARQUIVO: Partial<Record<FormatoMensagemV2, string>> = {
  imagem: "image/*",
  video: "video/*",
  gif: "image/gif",
  audio: "audio/*",
  documento: ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip",
  figurinha: "image/webp,image/png",
};

export const EH_MIDIA: ReadonlySet<FormatoMensagemV2> = new Set(["imagem", "video", "gif", "audio", "documento", "figurinha"]);
