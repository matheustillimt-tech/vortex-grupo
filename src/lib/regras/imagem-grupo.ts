import { hostPrivadoOuLocal } from "./webhooks";

/** Imagem do grupo (Etapa 3M, Tarefa 2): "Trocar imagem" (ação), "Atualizar foto do grupo" (automação) e "Imagem do
 *  grupo" (Criação de grupos, Alterar grupos em lote e Padrão de criação). Módulo puro: vale no navegador (antes de
 *  subir o arquivo) e no servidor (antes de gravar). */

export const MAXIMO_URL_IMAGEM_GRUPO = 2048;
export const MAXIMO_BYTES_IMAGEM_GRUPO = 5 * 1024 * 1024;
export const TIPOS_IMAGEM_GRUPO = ["image/jpeg", "image/png"] as const;
export const MAXIMO_NOME_ARQUIVO_IMAGEM = 200;

/** Teste com o Zapbot em 17/10/2026 (`PUT group-picture`, grupos de teste): o WhatsApp recusa imagem com o lado
 *  menor abaixo de ~190 px ("the given data is not a valid image"; 188 px recusada, 190 px aceita). A regra usa
 *  192 px, com folga. Acima disso aceita JPEG, PNG e até imagem não quadrada, mas a foto de grupo do WhatsApp é
 *  quadrada: o navegador recorta o centro em quadrado e converte para JPEG antes de subir (`recorteFotoGrupo`). */
export const LADO_MINIMO_IMAGEM_GRUPO = 192;
/** Lado da foto que sobe (o tamanho da foto de grupo do WhatsApp). Imagem menor (até 192 px) não é ampliada. */
export const LADO_FOTO_GRUPO = 640;
/** Qualidade do JPEG gerado no navegador. */
export const QUALIDADE_JPEG_FOTO_GRUPO = 0.9;

/** Ajuda fixa do campo de imagem. */
export const AJUDA_IMAGEM_GRUPO = `JPG ou PNG, até 5 MB, com pelo menos ${LADO_MINIMO_IMAGEM_GRUPO} × ${LADO_MINIMO_IMAGEM_GRUPO} px. O Vórtex Grupo corta o centro em quadrado e envia em JPG de até ${LADO_FOTO_GRUPO} × ${LADO_FOTO_GRUPO} px.`;
/** Nota do "Alterar grupos em lote": o Zapbot não tem rota para apagar a foto de um grupo. */
export const NOTA_TIRAR_IMAGEM = "Tirar a imagem só vale para grupos novos: o WhatsApp não deixa o Vórtex Grupo apagar a foto de um grupo.";

/** Onde o Vórtex Grupo guarda as imagens enviadas: `${NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/midias/`.
 *  `null` sem a variável (ou sem `https://`): aí nenhuma URL é aceita. `process.env.NEXT_PUBLIC_SUPABASE_URL` escrito
 *  por extenso de propósito: o Next troca pelo valor também no navegador. */
export function prefixoMidias(base: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL): string | null {
  const b = (base ?? "").trim().replace(/\/+$/, "");
  if (!b.startsWith("https://")) return null;
  return `${b}/storage/v1/object/public/midias/`;
}

/** URL aceita como imagem do grupo: só imagem enviada pelo Vórtex Grupo (bucket público `midias` do nosso Supabase,
 *  `prefixoMidias`), até 2048 caracteres, URL válida, sem usuário/senha, sem `..` nem barra codificada no caminho, e
 *  com host que não é local nem IP privado (o Zapbot baixa a imagem: nunca pode virar sonda de SSRF). Nada de
 *  `http:`, `data:`, caminho relativo ou link de outro site. */
export function ehUrlImagemGrupo(v: unknown, prefixo: string | null = prefixoMidias()): v is string {
  if (typeof v !== "string" || !v.startsWith("https://") || v.length > MAXIMO_URL_IMAGEM_GRUPO) return false;
  if (!prefixo || !v.startsWith(prefixo) || v.length <= prefixo.length) return false;
  if (/%2f|%5c|\\/i.test(v)) return false;
  let u: URL;
  let p: URL;
  try {
    u = new URL(v);
    p = new URL(prefixo);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password || !u.hostname) return false;
  // Depois de normalizar (`..`, `%2e%2e`), o caminho ainda tem que estar dentro de `midias/`.
  if (u.origin !== p.origin || !u.pathname.startsWith(p.pathname) || u.pathname.length <= p.pathname.length) return false;
  return !hostPrivadoOuLocal(u.hostname.replace(/^\[/, "").replace(/\]$/, ""));
}

/** `imagem_grupo_url` vinda de um formulário: vazio/nulo = `null` (sem imagem); URL válida = ela; qualquer outra
 *  coisa = inválida (`undefined`). */
export function lerImagemGrupoUrl(v: unknown): string | null | undefined {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return undefined;
  const url = v.trim();
  if (!url) return null;
  return ehUrlImagemGrupo(url) ? url : undefined;
}

export const ERRO_IMAGEM_GRUPO_URL = "Imagem do grupo inválida: envie a imagem pelo Vórtex Grupo.";

/** Arquivo escolhido no navegador, conferido antes de subir pro `midias`. Devolve o erro ou `null`. */
export function validarArquivoImagem(a: { tipo: string; tamanho: number }): string | null {
  if (!(TIPOS_IMAGEM_GRUPO as readonly string[]).includes(a.tipo)) return "Use uma imagem JPG ou PNG.";
  if (a.tamanho > MAXIMO_BYTES_IMAGEM_GRUPO) return "Imagem acima de 5 MB.";
  return null;
}

/** Dimensões lidas no navegador (depois de abrir a imagem). Devolve o erro ou `null`. */
export function validarDimensoesImagem(d: { largura: number; altura: number }): string | null {
  if (!(d.largura > 0 && d.altura > 0)) return "Não foi possível ler a imagem.";
  if (Math.min(d.largura, d.altura) < LADO_MINIMO_IMAGEM_GRUPO) {
    return `Imagem pequena demais (${d.largura} × ${d.altura} px): o WhatsApp pede pelo menos ${LADO_MINIMO_IMAGEM_GRUPO} × ${LADO_MINIMO_IMAGEM_GRUPO} px.`;
  }
  return null;
}

/** Recorte do centro em quadrado (`sx`, `sy`, `lado` na imagem original) e o lado da saída: `LADO_FOTO_GRUPO`, ou o
 *  lado do recorte quando ele é menor (nunca amplia). */
export function recorteFotoGrupo(d: { largura: number; altura: number }): { sx: number; sy: number; lado: number; saida: number } {
  const lado = Math.min(d.largura, d.altura);
  return { sx: Math.floor((d.largura - lado) / 2), sy: Math.floor((d.altura - lado) / 2), lado, saida: Math.min(lado, LADO_FOTO_GRUPO) };
}

/** Nome do arquivo convertido: o mesmo nome, com extensão `.jpg`. */
export function nomeJpeg(nome: string): string {
  const base = nome.replace(/\.[^./\\]*$/, "") || "imagem";
  return `${base}.jpg`;
}

export const ERRO_IMAGEM_RECUSADA = `O WhatsApp recusou a imagem. Use JPG ou PNG com pelo menos ${LADO_MINIMO_IMAGEM_GRUPO} × ${LADO_MINIMO_IMAGEM_GRUPO} px, enviada pelo Vórtex Grupo.`;

/** Erro do Zapbot na troca de foto que é da IMAGEM (não adianta tentar de novo). Só as respostas vistas no teste de
 *  17/10/2026: o WhatsApp recusou ("the given data is not a valid image", HTTP 502, imagem pequena demais) ou o
 *  Zapbot não reconheceu o formato ("formato de imagem não reconhecido…"). Falha ao BAIXAR a imagem ("download
 *  media: status 503", tempo esgotado, 5xx) pode ser passageira: devolve `null` e a fila tenta de novo. Devolve a
 *  mensagem clara ou `null` (erro de outro tipo). */
export function erroDaImagemNoZapbot(mensagem: string): string | null {
  const m = mensagem.toLowerCase();
  // Só estas duas frases são da imagem; o "502" que acompanha "not a valid image" não pode virar "passageiro".
  if (m.includes("not a valid image") || m.includes("formato de imagem")) return ERRO_IMAGEM_RECUSADA;
  return null;
}
