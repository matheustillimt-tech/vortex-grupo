import { paraV2, resumoMensagemV2, type MensagemV2 } from "@/src/lib/regras/conteudo-v2";
import { Icone } from "./icone";

const LIMITE_TEXTO = 600;

const ICONE_FORMATO: Record<string, string> = {
  imagem: "image",
  video: "videocam",
  audio: "mic",
  documento: "description",
  figurinha: "sticky_note_2",
  gif: "gif_box",
};

function texto(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function cortar(s: string): string {
  const letras = Array.from(s);
  return letras.length > LIMITE_TEXTO ? `${letras.slice(0, LIMITE_TEXTO).join("")}…` : s;
}

/** Balão verde do WhatsApp com o conteúdo de uma `MensagemV2` — usado tanto na lista de ações/modelos quanto na
 *  coluna esquerda do editor (ver `editor-mensagens`). Server-safe. */
export function BolhaMensagemV2({ mensagem, mencionarTodos = false }: { mensagem: MensagemV2; mencionarTodos?: boolean }) {
  return (
    <div className="max-w-[260px] whitespace-pre-wrap break-words rounded-lg rounded-tl-none bg-[#005c4b] px-3 py-2 text-[13px] leading-snug text-white">
      <CorpoMensagemV2 mensagem={mensagem} />
      {mensagem.formato === "texto" && mencionarTodos && (
        <span className="mt-1 flex items-center gap-1 text-[12px] text-white/70">
          <Icone nome="alternate_email" tamanho={14} />
          marca todos
        </span>
      )}
    </div>
  );
}

function CorpoMensagemV2({ mensagem: m }: { mensagem: MensagemV2 }) {
  switch (m.formato) {
    case "texto":
      return m.texto ? <span className="block">{cortar(m.texto)}</span> : <span className="italic text-white/60">(sem texto)</span>;
    case "contato":
      return (
        <span className="flex items-center gap-1.5">
          <Icone nome="person" tamanho={16} />
          <span className="min-w-0">
            <span className="block font-medium">{m.contato.nome || "(sem nome)"}</span>
            <span className="block text-white/70">{m.contato.telefone}</span>
          </span>
        </span>
      );
    case "evento":
      return (
        <span className="flex items-start gap-1.5">
          <Icone nome="event" tamanho={16} className="mt-px" />
          <span className="min-w-0">
            <span className="block font-medium">{m.evento.nome || "(sem nome)"}</span>
            {m.evento.local && <span className="block text-white/70">{m.evento.local}</span>}
          </span>
        </span>
      );
    case "botoes":
      return (
        <>
          <span className="block">{cortar(m.texto) || <span className="italic text-white/60">(sem texto)</span>}</span>
          {m.botoes.length > 0 && (
            <span className="mt-1.5 block space-y-1">
              {m.botoes.map((b, i) => (
                <span key={i} className="block rounded border border-white/25 px-2 py-1 text-center text-white/90">
                  {b.rotulo || "(botão)"}
                </span>
              ))}
            </span>
          )}
        </>
      );
    case "enquete":
      return (
        <>
          <span className="flex items-start gap-1.5 font-semibold">
            <Icone nome="bar_chart" tamanho={16} className="mt-px" />
            <span className="min-w-0">{cortar(m.enquete.pergunta) || "(sem pergunta)"}</span>
          </span>
          {m.enquete.opcoes.length > 0 && (
            <ul className="mt-1.5 space-y-1">
              {m.enquete.opcoes.map((o, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span aria-hidden className="size-3.5 shrink-0 rounded-full border border-white/70" />
                  <span className="min-w-0">{o}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      );
    default:
      return (
        <>
          <span className="mb-1 flex items-center gap-1.5 text-white/80">
            <Icone nome={ICONE_FORMATO[m.formato] ?? "attach_file"} tamanho={16} />
            <span className="min-w-0 truncate">{m.nome_arquivo || m.formato}</span>
          </span>
          {m.legenda ? <span className="block">{cortar(m.legenda)}</span> : null}
        </>
      );
  }
}

/** Prévia da mensagem/enquete num balão verde do WhatsApp (sobre o fundo escuro da conversa); nome e descrição do
 *  grupo aparecem como texto num cartão escuro. "mensagem" e "enquete" aceitam o conteúdo antigo ou v2 (`paraV2`
 *  resolve os dois) — v2 com mais de uma mensagem mostra todas, em sequência. Server-safe. */
export function PreviaMensagem({ tipo, conteudo }: { tipo: "mensagem" | "enquete" | "nome" | "descricao"; conteudo: unknown }) {
  const c = (conteudo && typeof conteudo === "object" ? conteudo : {}) as Record<string, unknown>;
  if (tipo === "nome" || tipo === "descricao") {
    const corpo = cortar(texto(tipo === "nome" ? c.padrao : c.texto));
    return (
      <div className="rounded-lg bg-[#0b141a] p-3 text-[13px] leading-snug text-white">
        <span className="mb-1 flex items-center gap-1.5 text-[12px] text-white/60">
          <Icone nome={tipo === "nome" ? "edit" : "notes"} tamanho={14} />
          {tipo === "nome" ? "Nome do grupo" : "Descrição do grupo"}
        </span>
        <span className="block whitespace-pre-wrap break-words">{corpo || <span className="italic text-white/60">(sem texto)</span>}</span>
      </div>
    );
  }
  const v2 = paraV2(conteudo);
  return (
    <div className="space-y-1.5 rounded-lg bg-[#0b141a] p-3">
      {v2.mensagens.map((m, i) => (
        <BolhaMensagemV2 key={i} mensagem={m} mencionarTodos={v2.opcoes.mencionar_todos} />
      ))}
    </div>
  );
}

export { resumoMensagemV2 };
