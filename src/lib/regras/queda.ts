/** Diagnóstico de um número fora do ar (tarja no topo do painel). O Zapbot só diz "desconectado"; quem separa
 *  desconexão de banimento é o WhatsApp: perguntado por outro número conectado, conta banida deixa de existir. */
export type DiagnosticoQueda = "desconectado" | "banido" | "indefinido";

/** Reconfere o diagnóstico de um número que continua caído a cada 30 min (banimento pode vir depois da queda). */
export const REDIAGNOSTICO_MS = 30 * 60_000;

/** `existe`: resposta do phone-exists pelo outro número (null = sem outro número conectado ou sem resposta). */
export function diagnosticar(existe: boolean | null): DiagnosticoQueda {
  if (existe === true) return "desconectado";
  if (existe === false) return "banido";
  return "indefinido";
}

export function precisaDiagnostico(c: { diagnostico_em?: string | null }, agora: Date): boolean {
  if (!c.diagnostico_em) return true;
  return agora.getTime() - new Date(c.diagnostico_em).getTime() >= REDIAGNOSTICO_MS;
}

export const TEXTO_DIAGNOSTICO: Record<DiagnosticoQueda, string> = {
  desconectado: "Não foi banido: o número continua ativo no WhatsApp. Só precisa parear de novo (ler o QR).",
  banido: "Possível banimento: o WhatsApp não encontra mais esse número. Confira no celular do chip.",
  indefinido: "Ainda não deu pra saber se foi banido (precisa de outro número conectado pra conferir).",
};

/** "há 5 min", "há 2 h", "há 3 dias". */
export function tempoFora(caiuEm: string | null | undefined, agora: Date): string | null {
  if (!caiuEm) return null;
  const min = Math.max(0, Math.floor((agora.getTime() - new Date(caiuEm).getTime()) / 60_000));
  if (min < 1) return "agora há pouco";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return `há ${d} ${d === 1 ? "dia" : "dias"}`;
}

export const MAXIMO_TELEFONES_AVISO = 10;

/** Campo "Telefones para avisar": um por linha (ou separados por vírgula). DDD + número viram 55…; repetidos saem. */
export function lerTelefonesAviso(texto: string, normalizar: (t: string) => string | null): { ok: true; telefones: string[] } | { ok: false; erro: string } {
  const partes = texto.split(/[\n,;]+/).map((p) => p.trim()).filter(Boolean);
  const telefones: string[] = [];
  for (const p of partes) {
    const t = normalizar(p);
    if (!t) return { ok: false, erro: `Telefone inválido: ${p}. Use DDD + número, ex.: 11 9 1234-5678.` };
    if (!telefones.includes(t)) telefones.push(t);
  }
  if (telefones.length > MAXIMO_TELEFONES_AVISO) return { ok: false, erro: `No máximo ${MAXIMO_TELEFONES_AVISO} telefones.` };
  return { ok: true, telefones };
}

/** Mensagem que o chip reserva manda no privado de quem deve ser avisado. */
export function mensagemAvisoQueda(a: { nome: string; telefone: string | null; diagnostico: DiagnosticoQueda; link: string }): string {
  const numero = a.telefone ? ` (+${a.telefone})` : "";
  const oQue = a.diagnostico === "banido" ? "caiu e pode ter sido *BANIDO* (o WhatsApp não encontra mais o número)" : "foi *DESCONECTADO* do WhatsApp";
  const fazer = a.diagnostico === "banido" ? "Confira no celular do chip." : "Precisa parear de novo (ler o QR).";
  return `⚠️ *Aviso do Vórtex Grupo*\n\nO número *${a.nome}*${numero} ${oQue}.\n\nOs envios e grupos dele estão parados. ${fazer}\n\nDá uma olhada lá no Vórtex Grupo:\n${a.link}`;
}
