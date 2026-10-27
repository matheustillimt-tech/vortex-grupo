"use client";
import { useState } from "react";
import { conteudoInicial, podeSerImportante, ROTULO_TIPO, TIPOS_PASSO, type TipoPasso } from "@/src/lib/regras/conteudo";
import { conteudoV2Vazio, paraV2, type ConteudoV2 } from "@/src/lib/regras/conteudo-v2";
import { rotuloDia, type PassoEntrada } from "@/src/lib/regras/sequencia";
import { ConteudoEditor, type Valor } from "../../_componentes/conteudo-editor";
import { DicaVariaveis } from "../../_componentes/dica-variaveis";
import { EditorMensagens, type ModeloParaEditor } from "../../_componentes/editor-mensagens";
import { EscolherModelo, type ModeloLinha } from "../../_componentes/escolher-modelo";
import { Botao, Campo, estiloAcao, estiloCartao, estiloInput } from "../../_componentes/ui";
import { renomearSequencia, salvarPassos } from "../actions";

function conteudoInicialPasso(t: TipoPasso): unknown {
  return t === "mensagem" ? conteudoV2Vazio() : conteudoInicial(t);
}

function modelosParaEditor(modelos: ModeloLinha[], tipo: TipoPasso): ModeloParaEditor[] {
  return modelos.filter((m) => m.tipo === tipo).map((m) => ({ id: m.id, nome: m.nome, mensagens: paraV2(m.conteudo).mensagens }));
}

export function EditorSequencia({ sequenciaId, nome: nomeInicial, inicial, modelos }: { sequenciaId: string; nome: string; inicial: PassoEntrada[]; modelos: ModeloLinha[] }) {
  const [nome, setNome] = useState(nomeInicial);
  const [passos, setPassos] = useState<PassoEntrada[]>(inicial);
  const [msg, setMsg] = useState<{ texto: string; erro: boolean } | null>(null);
  const [salvando, setSalvando] = useState(false);

  const mudar = (i: number, p: Partial<PassoEntrada>) => { setPassos(passos.map((x, k) => (k === i ? { ...x, ...p } : x))); setMsg(null); };
  const mover = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= passos.length) return;
    const nova = [...passos];
    [nova[i], nova[j]] = [nova[j], nova[i]];
    setPassos(nova);
  };
  const ordenarPorHorario = () => setPassos([...passos].sort((a, b) => a.dia_relativo - b.dia_relativo || a.hora.localeCompare(b.hora)));

  return (
    <div className="space-y-4">
      <div className="flex max-w-xl flex-col gap-2 sm:flex-row">
        <input className={estiloInput} value={nome} onChange={(e) => setNome(e.target.value)} />
        <Botao variante="secundario" onClick={async () => {
          const r = await renomearSequencia(sequenciaId, nome);
          setMsg(r.erro ? { texto: r.erro, erro: true } : { texto: "Nome salvo.", erro: false });
        }}>Renomear</Botao>
      </div>
      <DicaVariaveis />
      {passos.map((p, i) => (
        <div key={p.id ?? `novo-${i}`} className={`${estiloCartao} space-y-3 p-4`}>
          <div className="flex flex-wrap items-end gap-3">
            <Campo rotulo="Dia">
              <select className={estiloInput} value={p.dia_relativo} onChange={(e) => mudar(i, { dia_relativo: Number(e.target.value) })}>
                {Array.from({ length: 38 }, (_, k) => k - 30).map((d) => <option key={d} value={d}>{rotuloDia(d)}{d === 0 ? " (dia da aula)" : ""}</option>)}
              </select>
            </Campo>
            <Campo rotulo="Hora (Brasília)"><input type="time" className={estiloInput} value={p.hora} onChange={(e) => mudar(i, { hora: e.target.value })} /></Campo>
            <Campo rotulo="Tipo">
              <select className={estiloInput} value={p.tipo} onChange={(e) => { const t = e.target.value as TipoPasso; mudar(i, { tipo: t, conteudo: conteudoInicialPasso(t), importante: false }); }}>
                {TIPOS_PASSO.map((t) => <option key={t} value={t}>{ROTULO_TIPO[t]}</option>)}
              </select>
            </Campo>
            {podeSerImportante(p.tipo) && (
              <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={p.importante} onChange={(e) => mudar(i, { importante: e.target.checked })} /> Importante (vai pro grupo novo)</label>
            )}
            <div className="ml-auto flex items-center gap-3 pb-2">
              <button type="button" onClick={() => mover(i, -1)} className={estiloAcao.neutro} aria-label="Subir passo">↑</button>
              <button type="button" onClick={() => mover(i, 1)} className={estiloAcao.neutro} aria-label="Descer passo">↓</button>
              <button type="button" onClick={() => setPassos(passos.filter((_, k) => k !== i))} className={estiloAcao.perigo}>remover</button>
            </div>
          </div>
          {p.tipo === "mensagem" ? (
            <EditorMensagens
              valor={paraV2(p.conteudo)}
              onChange={(c: ConteudoV2) => mudar(i, { conteudo: c })}
              modelos={modelosParaEditor(modelos, "mensagem")}
              pasta={`sequencias/${sequenciaId}`}
              ocultarDicaVariaveis
            />
          ) : (
            <>
              <EscolherModelo tipo={p.tipo} modelos={modelos} aoEscolher={(c) => mudar(i, { conteudo: c })} />
              <ConteudoEditor tipo={p.tipo} valor={(p.conteudo ?? {}) as Valor} onChange={(c) => mudar(i, { conteudo: c })} pasta={`sequencias/${sequenciaId}`} />
            </>
          )}
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Botao variante="secundario" onClick={() => setPassos([...passos, { dia_relativo: 0, hora: "20:00", tipo: "mensagem", conteudo: conteudoV2Vazio(), importante: false }])}>+ Passo</Botao>
        <Botao variante="secundario" onClick={ordenarPorHorario}>Ordenar por horário</Botao>
        <Botao disabled={salvando} onClick={async () => {
          setSalvando(true);
          const r = await salvarPassos(sequenciaId, passos);
          setSalvando(false);
          if (r.passos) setPassos(r.passos);
          setMsg(r.erro ? { texto: r.erro, erro: true } : { texto: "Sequência salva. Campanhas que usam esta sequência são reagendadas no próximo minuto.", erro: false });
        }}>Salvar sequência</Botao>
      </div>
      {msg && <p className={`text-sm ${msg.erro ? "text-vg-erro" : "text-vg-muted"}`}>{msg.texto}</p>}
    </div>
  );
}
