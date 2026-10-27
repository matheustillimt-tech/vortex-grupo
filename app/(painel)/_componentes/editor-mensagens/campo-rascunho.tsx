"use client";
import { useState } from "react";
import type { FormatoMensagemV2, TipoBotao } from "@/src/lib/regras/conteudo-v2";
import { dbNavegador } from "@/src/lib/supabase/navegador";
import { Campo, estiloAcao, estiloInput } from "../ui";
import { ACEITA_ARQUIVO, EH_MIDIA } from "./formatos";
import { TIPOS_BOTAO_DISPONIVEIS, TIPOS_BOTAO_ROTULO, type Rascunho } from "./rascunho";

/** Campos de formulário do rascunho pra formatos que não são "escreva na caixa de texto" (contato, evento,
 *  botões, enquete) — upload de mídia inclusive, reaproveitando o mesmo bucket/fluxo do editor antigo. O campo de
 *  texto em si (texto/legenda/botões) e a barra de formatação ficam em `editor-mensagens.tsx`, que é quem tem o
 *  `textarea` e o ref da seleção. */
export function CampoRascunho({ formato, rascunho, setRascunho, pasta }: {
  formato: FormatoMensagemV2;
  rascunho: Rascunho;
  setRascunho: (r: Rascunho) => void;
  pasta: string;
}) {
  const [subindo, setSubindo] = useState(false);
  const [erroUpload, setErroUpload] = useState<string | null>(null);
  const set = <K extends keyof Rascunho>(k: K, v: Rascunho[K]) => setRascunho({ ...rascunho, [k]: v });

  async function subir(arquivo: File | null) {
    setErroUpload(null);
    if (!arquivo) return setRascunho({ ...rascunho, midia_url: null, nome_arquivo: null });
    if (arquivo.size > 50 * 1024 * 1024) return setErroUpload("Arquivo acima de 50 MB.");
    setSubindo(true);
    const caminho = `${pasta}/${Date.now()}-${arquivo.name.replace(/[^\w.-]/g, "_")}`;
    const db = dbNavegador();
    const { error } = await db.storage.from("midias").upload(caminho, arquivo, { contentType: arquivo.type });
    setSubindo(false);
    if (error) return setErroUpload("Falha ao subir o arquivo.");
    setRascunho({ ...rascunho, midia_url: db.storage.from("midias").getPublicUrl(caminho).data.publicUrl, nome_arquivo: arquivo.name });
  }

  if (EH_MIDIA.has(formato)) {
    return (
      <div className="space-y-2 text-sm">
        <input
          key={formato}
          type="file"
          accept={ACEITA_ARQUIVO[formato]}
          disabled={subindo}
          onChange={(e) => subir(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-vg-muted file:mr-3 file:rounded-lg file:border file:border-vg-line-2 file:bg-vg-panel-2 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-vg-text hover:file:bg-vg-panel"
        />
        {subindo && <p className="text-vg-muted">Subindo…</p>}
        {rascunho.nome_arquivo && !subindo && <p className="text-vg-muted">Arquivo: {rascunho.nome_arquivo}</p>}
        {erroUpload && <p className="text-vg-erro">{erroUpload}</p>}
      </div>
    );
  }

  if (formato === "contato") {
    return (
      <div className="space-y-2">
        <Campo rotulo="Nome do contato"><input className={estiloInput} value={rascunho.contato_nome} onChange={(e) => set("contato_nome", e.target.value)} /></Campo>
        <Campo rotulo="Telefone (DDD + número)"><input className={estiloInput} value={rascunho.contato_telefone} onChange={(e) => set("contato_telefone", e.target.value)} placeholder="11 9 1234-5678" /></Campo>
      </div>
    );
  }

  if (formato === "evento") {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        <Campo rotulo="Nome do evento"><input className={estiloInput} value={rascunho.evento_nome} onChange={(e) => set("evento_nome", e.target.value)} /></Campo>
        <Campo rotulo="Local (opcional)"><input className={estiloInput} value={rascunho.evento_local} onChange={(e) => set("evento_local", e.target.value)} /></Campo>
        <Campo rotulo="Início"><input type="datetime-local" className={estiloInput} value={rascunho.evento_inicio} onChange={(e) => set("evento_inicio", e.target.value)} /></Campo>
        <Campo rotulo="Fim (opcional)"><input type="datetime-local" className={estiloInput} value={rascunho.evento_fim} onChange={(e) => set("evento_fim", e.target.value)} /></Campo>
        <div className="sm:col-span-2">
          <Campo rotulo="Descrição (opcional)"><textarea className={estiloInput} rows={2} value={rascunho.evento_descricao} onChange={(e) => set("evento_descricao", e.target.value)} /></Campo>
        </div>
      </div>
    );
  }

  if (formato === "botoes") {
    const mudarBotao = (i: number, p: Partial<(typeof rascunho.botoes)[number]>) =>
      set("botoes", rascunho.botoes.map((b, k) => (k === i ? { ...b, ...p } : b)));
    return (
      <div className="space-y-2">
        <span className="text-[12.5px] text-vg-text-2">Botões (1 a 3)</span>
        {rascunho.botoes.map((b, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <select className={`${estiloInput} w-28`} value={b.tipo} onChange={(e) => mudarBotao(i, { tipo: e.target.value as TipoBotao })}>
              {TIPOS_BOTAO_DISPONIVEIS.map((t) => <option key={t} value={t}>{TIPOS_BOTAO_ROTULO[t]}</option>)}
            </select>
            <input className={estiloInput} placeholder="Rótulo" value={b.rotulo} onChange={(e) => mudarBotao(i, { rotulo: e.target.value })} />
            <input className={estiloInput} placeholder={b.tipo === "link" ? "https://…" : "Valor"} value={b.valor} onChange={(e) => mudarBotao(i, { valor: e.target.value })} />
            {rascunho.botoes.length > 1 && (
              <button type="button" className={estiloAcao.perigo} onClick={() => set("botoes", rascunho.botoes.filter((_, k) => k !== i))}>remover</button>
            )}
          </div>
        ))}
        {rascunho.botoes.length < 3 && (
          <button type="button" className={estiloAcao.normal} onClick={() => set("botoes", [...rascunho.botoes, { tipo: "link" as TipoBotao, rotulo: "", valor: "" }])}>+ botão</button>
        )}
      </div>
    );
  }

  // Texto (e qualquer formato sem campos próprios): só a área de mensagem, que fica fora deste componente.
  if (formato !== "enquete") return null;

  // enquete
  const opcoes = rascunho.enquete_opcoes;
  return (
    <div className="space-y-2">
      <Campo rotulo="Pergunta"><input className={estiloInput} value={rascunho.enquete_pergunta} onChange={(e) => set("enquete_pergunta", e.target.value)} /></Campo>
      <div className="space-y-1.5">
        <span className="text-[12.5px] text-vg-text-2">Opções (2 a 12)</span>
        {opcoes.map((o, i) => (
          <div key={i} className="flex gap-2">
            <input className={estiloInput} value={o} onChange={(e) => set("enquete_opcoes", opcoes.map((x, k) => (k === i ? e.target.value : x)))} />
            {opcoes.length > 2 && <button type="button" className={estiloAcao.perigo} onClick={() => set("enquete_opcoes", opcoes.filter((_, k) => k !== i))}>remover</button>}
          </div>
        ))}
        {opcoes.length < 12 && <button type="button" className={estiloAcao.normal} onClick={() => set("enquete_opcoes", [...opcoes, ""])}>+ opção</button>}
      </div>
      <Campo rotulo="Máximo de respostas por pessoa">
        <input type="number" min={1} max={opcoes.length} className={estiloInput} value={rascunho.enquete_max} onChange={(e) => set("enquete_max", Number(e.target.value))} />
      </Campo>
    </div>
  );
}
