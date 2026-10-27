/** `intervaloSeg`: faixa (em segundos) antes DESTE item, escolhida na ação (`segundosEntreGrupos`). Sem ela (ou
 *  `null`, opção "nao"), vale o espaçamento padrão de 3–8 s. */
export type ItemEnvio = { grupoId: string; conexaoId: string; intervaloSeg?: { min: number; max: number } | null };
export type TipoMensagem = "texto" | "imagem" | "video" | "audio" | "documento";

const MIN_MS = 3000;
const MAX_MS = 8000;

/** Cada número manda um grupo de cada vez, com intervalo variado (protege contra banimento). */
export function espacarEnvios<T extends ItemEnvio>(itens: T[], inicio: Date, aleatorio: () => number = Math.random): (T & { enviarApos: Date })[] {
  const cursor = new Map<string, number>();
  return itens.map((item) => {
    const anterior = cursor.get(item.conexaoId);
    const min = item.intervaloSeg ? item.intervaloSeg.min * 1000 : MIN_MS;
    const max = item.intervaloSeg ? item.intervaloSeg.max * 1000 : MAX_MS;
    const t = anterior === undefined ? inicio.getTime() : anterior + Math.round(min + aleatorio() * (max - min));
    cursor.set(item.conexaoId, t);
    return { ...item, enviarApos: new Date(t) };
  });
}

export function rotaEnvio(tipo: TipoMensagem, nomeArquivo?: string | null): string {
  switch (tipo) {
    case "texto": return "send-text";
    case "imagem": return "send-image";
    case "video": return "send-video";
    case "audio": return "send-audio";
    case "documento": {
      const ext = nomeArquivo?.split(".").pop()?.toLowerCase();
      return `send-document/${ext && ext !== nomeArquivo?.toLowerCase() ? ext : "pdf"}`;
    }
  }
}

type MensagemEnvio = { tipo: TipoMensagem; texto: string; midia_url: string | null; nome_arquivo: string | null; mencionar_todos: boolean };

export function corpoEnvio(m: MensagemEnvio, groupId: string): Record<string, unknown> {
  const texto = m.mencionar_todos && m.tipo === "texto" ? `${m.texto} @all`.trim() : m.texto;
  switch (m.tipo) {
    case "texto":
      return m.mencionar_todos ? { phone: groupId, message: texto, mentionAll: true } : { phone: groupId, message: texto };
    case "imagem":
      return { phone: groupId, image: m.midia_url, ...(m.texto ? { caption: m.texto } : {}) };
    case "video":
      return { phone: groupId, video: m.midia_url, ...(m.texto ? { caption: m.texto } : {}) };
    case "audio":
      return { phone: groupId, audio: m.midia_url };
    case "documento":
      return { phone: groupId, document: m.midia_url, fileName: m.nome_arquivo ?? "arquivo.pdf", ...(m.texto ? { caption: m.texto } : {}) };
  }
}
