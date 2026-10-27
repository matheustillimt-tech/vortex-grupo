"use client";
import { useRef, useState } from "react";
import { AJUDA_IMAGEM_GRUPO, TIPOS_IMAGEM_GRUPO, validarArquivoImagem } from "@/src/lib/regras/imagem-grupo";
import { dbNavegador } from "@/src/lib/supabase/navegador";
import { converterFotoGrupo } from "./converter-foto-grupo";
import { Icone } from "./icone";
import { Botao } from "./ui";

export type ValorImagemGrupo = { url: string; nome_arquivo?: string | null };

/**
 * Campo "Imagem do grupo" (Etapa 3M): prévia redonda de 96 px, "ESCOLHER IMAGEM" (ou "Trocar"/"Remover") e a ajuda
 * fixa. O arquivo é conferido (`validarArquivoImagem`: JPG/PNG até 5 MB), convertido no navegador em JPEG quadrado de
 * até 640 px com lado mínimo de 192 px (`converterFotoGrupo`, o que o WhatsApp aceita) e sobe pro bucket público `midias` em
 * `{pasta}/{Date.now()}-{nome-limpo}` (mesmo esquema do `conteudo-editor.tsx`); o valor é a URL pública (https). O
 * servidor confere a URL de novo (`ehUrlImagemGrupo`) antes de gravar.
 *
 * Controlado com `onChange` (sempre de um client component pai, nunca função vinda de server page) ou solto, com
 * `name`, pra formulários (um `<input type="hidden">` leva a URL).
 */
export function CampoImagemGrupo({ valor, onChange, pasta, name, rotulo, nota, desabilitado = false }: {
  valor: ValorImagemGrupo;
  onChange?: (v: ValorImagemGrupo) => void;
  pasta: string;
  name?: string;
  /** Rótulo acima do campo (ex.: "Imagem do grupo"). Não usa o `<label>` do `Campo`: o clique na prévia abriria o
   *  seletor de arquivo. */
  rotulo?: string;
  /** Texto extra abaixo da ajuda (ex.: "Tirar a imagem só vale para grupos novos…"). */
  nota?: string;
  desabilitado?: boolean;
}) {
  const [interno, setInterno] = useState<ValorImagemGrupo>(valor);
  const atual = onChange ? valor : interno;
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [falhouPrevia, setFalhouPrevia] = useState<string | null>(null);
  const arquivoRef = useRef<HTMLInputElement>(null);

  function mudar(v: ValorImagemGrupo) {
    setInterno(v);
    onChange?.(v);
  }

  async function subir(arquivo: File | null | undefined) {
    if (!arquivo) return;
    setErro(null);
    const invalido = validarArquivoImagem({ tipo: arquivo.type, tamanho: arquivo.size });
    if (invalido) return setErro(invalido);
    setEnviando(true);
    try {
      const convertida = await converterFotoGrupo(arquivo);
      if ("erro" in convertida) return setErro(convertida.erro);
      const foto = convertida.arquivo;
      const caminho = `${pasta}/${Date.now()}-${foto.name.replace(/[^\w.-]/g, "_")}`;
      const db = dbNavegador();
      const { error } = await db.storage.from("midias").upload(caminho, foto, { contentType: foto.type });
      if (error) return setErro("Falha ao subir a imagem.");
      mudar({ url: db.storage.from("midias").getPublicUrl(caminho).data.publicUrl, nome_arquivo: arquivo.name });
    } catch {
      setErro("Falha ao subir a imagem.");
    } finally {
      setEnviando(false);
      if (arquivoRef.current) arquivoRef.current.value = "";
    }
  }

  const url = atual.url?.startsWith("https://") ? atual.url : "";
  const mostraFoto = url && falhouPrevia !== url;

  return (
    <div className="space-y-2">
      {rotulo && <span className="block text-[13.3px] text-[#e3e9e5]">{rotulo}</span>}
      {name && <input type="hidden" name={name} value={atual.url ?? ""} />}
      <div className="flex flex-wrap items-center gap-4">
        <span className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-full border border-vg-line bg-vg-panel-2" aria-hidden>
          {mostraFoto ? (
            <img src={url} alt="" width={96} height={96} referrerPolicy="no-referrer" onError={() => setFalhouPrevia(url)} className="size-full object-cover" />
          ) : (
            <Icone nome="image" tamanho={32} className="text-vg-text-3" />
          )}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={arquivoRef}
            type="file"
            accept={TIPOS_IMAGEM_GRUPO.join(",")}
            className="hidden"
            disabled={desabilitado || enviando}
            onChange={(e) => subir(e.target.files?.[0])}
          />
          {url ? (
            <>
              <Botao type="button" variante="secundario" disabled={desabilitado || enviando} onClick={() => arquivoRef.current?.click()}>Trocar</Botao>
              <Botao type="button" variante="secundario" disabled={desabilitado || enviando} onClick={() => { setErro(null); mudar({ url: "", nome_arquivo: null }); }}>Remover</Botao>
            </>
          ) : (
            <Botao type="button" variante="secundario" icone={<Icone nome="upload" tamanho={18} />} disabled={desabilitado || enviando} onClick={() => arquivoRef.current?.click()}>
              ESCOLHER IMAGEM
            </Botao>
          )}
          {enviando && <span className="text-sm text-vg-muted">Enviando…</span>}
        </div>
      </div>
      {atual.nome_arquivo && url && !enviando && <p className="text-xs text-vg-muted">Arquivo: {atual.nome_arquivo}</p>}
      <p className="text-xs text-vg-muted">{AJUDA_IMAGEM_GRUPO}</p>
      {nota && <p className="text-xs text-vg-text-3">{nota}</p>}
      {erro && <p role="alert" className="text-sm text-vg-erro">{erro}</p>}
    </div>
  );
}
