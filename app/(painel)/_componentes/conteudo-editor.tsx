"use client";
import { useState } from "react";
import type { TipoExecucao } from "@/src/lib/regras/conteudo";
import type { TipoMensagem } from "@/src/lib/regras/espacamento";
import { dbNavegador } from "@/src/lib/supabase/navegador";
import { CampoImagemGrupo } from "./campo-imagem-grupo";
import { Campo, estiloAcao, estiloInput, Segmentos } from "./ui";

export type Valor = Record<string, unknown>;

const FORMATOS: { v: TipoMensagem; r: string; aceita?: string }[] = [
  { v: "texto", r: "Texto" },
  { v: "imagem", r: "Imagem", aceita: "image/*" },
  { v: "video", r: "Vídeo", aceita: "video/*" },
  { v: "audio", r: "Áudio", aceita: "audio/*" },
  { v: "documento", r: "Documento", aceita: ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip" },
];

/** Campos do conteúdo de cada tipo. Arquivo sobe pro bucket `midias` assim que é escolhido (`pasta/arquivo`).
 *  `telefones`: números conectados oferecidos em adicionar/remover admin. */
export function ConteudoEditor({ tipo, valor, onChange, pasta, telefones = [] }: { tipo: TipoExecucao; valor: Valor; onChange: (v: Valor) => void; pasta: string; telefones?: { nome: string; telefone: string }[] }) {
  const [subindo, setSubindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const set = (k: string, v: unknown) => onChange({ ...valor, [k]: v });
  const s = (k: string) => (typeof valor[k] === "string" ? (valor[k] as string) : "");

  async function subir(arquivo: File | null) {
    setErro(null);
    if (!arquivo) return onChange({ ...valor, midia_url: null, nome_arquivo: null });
    if (arquivo.size > 50 * 1024 * 1024) return setErro("Arquivo acima de 50 MB.");
    setSubindo(true);
    const caminho = `${pasta}/${Date.now()}-${arquivo.name.replace(/[^\w.-]/g, "_")}`;
    const db = dbNavegador();
    const { error } = await db.storage.from("midias").upload(caminho, arquivo, { contentType: arquivo.type });
    setSubindo(false);
    if (error) return setErro("Falha ao subir o arquivo.");
    onChange({ ...valor, midia_url: db.storage.from("midias").getPublicUrl(caminho).data.publicUrl, nome_arquivo: arquivo.name });
  }

  switch (tipo) {
    case "mensagem": {
      const formato = (valor.formato as TipoMensagem) ?? "texto";
      const aceita = FORMATOS.find((f) => f.v === formato)?.aceita;
      return (
        <div className="space-y-3">
          <div className="overflow-x-auto">
            <Segmentos<TipoMensagem> opcoes={FORMATOS.map((f) => ({ valor: f.v, rotulo: f.r }))} valor={formato} aoMudar={(v) => onChange({ ...valor, formato: v, midia_url: null, nome_arquivo: null })} />
          </div>
          {aceita && (
            <div className="space-y-1 text-sm">
              <input key={formato} type="file" accept={aceita} disabled={subindo} onChange={(e) => subir(e.target.files?.[0] ?? null)} className="block w-full text-sm text-vg-muted file:mr-3 file:rounded-lg file:border file:border-vg-line-2 file:bg-vg-panel-2 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-vg-text hover:file:bg-vg-panel" />
              {subindo && <p className="text-vg-muted">Subindo…</p>}
              {s("nome_arquivo") && !subindo && <p className="text-vg-muted">Arquivo: {s("nome_arquivo")}</p>}
              {erro && <p className="text-vg-erro">{erro}</p>}
            </div>
          )}
          {formato !== "audio" && (
            <Campo rotulo={formato === "texto" ? "Mensagem" : "Legenda (opcional)"}>
              <textarea className={estiloInput} rows={5} value={s("texto")} onChange={(e) => set("texto", e.target.value)} />
            </Campo>
          )}
          {formato === "texto" && (
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={valor.mencionar_todos === true} onChange={(e) => set("mencionar_todos", e.target.checked)} /> Mencionar todos</label>
          )}
        </div>
      );
    }
    case "enquete": {
      const opcoes = Array.isArray(valor.opcoes) ? (valor.opcoes as string[]) : ["", ""];
      return (
        <div className="space-y-3">
          <Campo rotulo="Pergunta"><input className={estiloInput} value={s("pergunta")} onChange={(e) => set("pergunta", e.target.value)} /></Campo>
          <div className="space-y-2">
            <span className="text-[13px] font-medium text-vg-text-2">Opções (2 a 12)</span>
            {opcoes.map((o, i) => (
              <div key={i} className="flex gap-2">
                <input className={estiloInput} value={o} onChange={(e) => set("opcoes", opcoes.map((x, k) => (k === i ? e.target.value : x)))} />
                {opcoes.length > 2 && <button type="button" className={estiloAcao.perigo} onClick={() => set("opcoes", opcoes.filter((_, k) => k !== i))}>remover</button>}
              </div>
            ))}
            {opcoes.length < 12 && <button type="button" className={estiloAcao.normal} onClick={() => set("opcoes", [...opcoes, ""])}>+ opção</button>}
          </div>
          <Campo rotulo="Máximo de respostas por pessoa">
            <input type="number" min={1} max={opcoes.length} className={estiloInput} value={Number(valor.max_respostas ?? 1)} onChange={(e) => set("max_respostas", Number(e.target.value))} />
          </Campo>
        </div>
      );
    }
    case "nome":
      return (
        <Campo rotulo="Novo nome" dica="{n} vira o número do grupo (01, 02…). Até 25 caracteres depois de preencher; variáveis valem aqui.">
          <input className={estiloInput} value={s("padrao")} onChange={(e) => set("padrao", e.target.value)} />
        </Campo>
      );
    case "descricao":
      return (
        <Campo rotulo="Nova descrição">
          <textarea className={estiloInput} rows={4} value={s("texto")} onChange={(e) => set("texto", e.target.value)} />
        </Campo>
      );
    case "admin_add":
    case "admin_remover":
      return (
        <div className="space-y-2">
          {telefones.length > 0 && (
            <Campo rotulo="Número conectado">
              <select className={estiloInput} value={telefones.some((t) => t.telefone === s("telefone")) ? s("telefone") : ""} onChange={(e) => set("telefone", e.target.value)}>
                <option value="">Escolha… ou digite abaixo</option>
                {telefones.map((t) => <option key={t.telefone} value={t.telefone}>{t.nome} ({t.telefone})</option>)}
              </select>
            </Campo>
          )}
          <Campo rotulo="Telefone (DDD + número)"><input className={estiloInput} value={s("telefone")} onChange={(e) => set("telefone", e.target.value)} placeholder="11 9 1234-5678" /></Campo>
        </div>
      );
    case "imagem":
      // "Trocar imagem" / "Atualizar foto do grupo" (Etapa 3M): mesmo campo da criação de grupos.
      return (
        <CampoImagemGrupo
          rotulo="Imagem do grupo"
          valor={{ url: s("url"), nome_arquivo: s("nome_arquivo") || null }}
          onChange={(v) => onChange({ ...valor, url: v.url, nome_arquivo: v.nome_arquivo ?? null })}
          pasta={pasta}
        />
      );
    default:
      return <p className="text-sm text-vg-muted">Sem conteúdo: só a ação no grupo.</p>;
  }
}
