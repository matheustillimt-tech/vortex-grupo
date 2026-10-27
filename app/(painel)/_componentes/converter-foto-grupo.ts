import { MAXIMO_BYTES_IMAGEM_GRUPO, QUALIDADE_JPEG_FOTO_GRUPO, nomeJpeg, recorteFotoGrupo, validarDimensoesImagem } from "@/src/lib/regras/imagem-grupo";

/** Converte a imagem escolhida na foto que o WhatsApp aceita (teste de 17/10/2026, ver `LADO_MINIMO_IMAGEM_GRUPO`):
 *  recorta o centro em quadrado, reduz para até 640 × 640 e gera JPEG com fundo branco (PNG transparente não fica
 *  preto). Só no navegador (canvas), sem dependência nova. Recusa imagem com o lado menor abaixo de 192 px. */
export async function converterFotoGrupo(arquivo: File): Promise<{ arquivo: File } | { erro: string }> {
  let imagem: ImageBitmap;
  try {
    imagem = await createImageBitmap(arquivo);
  } catch {
    return { erro: "Não foi possível ler a imagem." };
  }
  try {
    const dims = { largura: imagem.width, altura: imagem.height };
    const invalida = validarDimensoesImagem(dims);
    if (invalida) return { erro: invalida };
    const r = recorteFotoGrupo(dims);
    const canvas = document.createElement("canvas");
    canvas.width = r.saida;
    canvas.height = r.saida;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { erro: "Não foi possível converter a imagem." };
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, r.saida, r.saida);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(imagem, r.sx, r.sy, r.lado, r.lado, 0, 0, r.saida, r.saida);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", QUALIDADE_JPEG_FOTO_GRUPO));
    if (!blob) return { erro: "Não foi possível converter a imagem." };
    if (blob.size > MAXIMO_BYTES_IMAGEM_GRUPO) return { erro: "Imagem acima de 5 MB." };
    return { arquivo: new File([blob], nomeJpeg(arquivo.name), { type: "image/jpeg" }) };
  } finally {
    imagem.close();
  }
}
