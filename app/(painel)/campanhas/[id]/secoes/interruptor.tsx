"use client";
import { useState } from "react";
import { Botao, estiloInput } from "../../../_componentes/ui";
import { definirInterruptor, salvarPixel } from "./actions";

/** Interruptor "Ativado/Desativado" de uma seção: salva sozinho ao clicar, fica desabilitado enquanto salva e, se
 *  falhar, volta ao estado anterior e mostra o erro. */
export function Interruptor({ campanhaId, interruptor, ativo, rotulo, desabilitado = false }: {
  campanhaId: string;
  interruptor: string;
  ativo: boolean;
  /** Nome lido pelo leitor de tela (título da seção). */
  rotulo: string;
  desabilitado?: boolean;
}) {
  const [ligado, setLigado] = useState(ativo);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function alternar() {
    const novo = !ligado;
    setLigado(novo);
    setSalvando(true);
    setErro(null);
    try {
      const r = await definirInterruptor(campanhaId, interruptor, novo);
      if (r.erro) {
        setLigado(!novo);
        setErro(r.erro);
      }
    } catch {
      setLigado(!novo);
      setErro("Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        role="switch"
        aria-checked={ligado}
        aria-label={rotulo}
        disabled={desabilitado || salvando}
        onClick={alternar}
        className="flex items-center gap-2 text-[13px] text-vg-text disabled:opacity-50"
      >
        <span aria-hidden className={`relative h-5 w-9 rounded-full transition-colors ${ligado ? "bg-vg-accent/60" : "bg-white/20"}`}>
          <span className={`absolute top-0.5 size-4 rounded-full transition-all ${ligado ? "left-[18px] bg-vg-accent" : "left-0.5 bg-[#b4bdb7]"}`} />
        </span>
        <span>{ligado ? "Ativado" : "Desativado"}</span>
      </button>
      {erro && <p role="alert" className="max-w-[260px] text-right text-xs text-vg-erro">{erro}</p>}
    </div>
  );
}

/** Campo "ID do Pixel" + "SALVAR" do sub-bloco Pixel da Meta (desabilitado com o Deep Linking desligado). */
export function CampoPixel({ campanhaId, inicial, desabilitado }: { campanhaId: string; inicial: string; desabilitado: boolean }) {
  const [valor, setValor] = useState(inicial);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<{ texto: string; erro: boolean } | null>(null);

  async function salvar() {
    setSalvando(true);
    setMsg(null);
    try {
      const r = await salvarPixel(campanhaId, valor);
      setMsg(r.erro ? { texto: r.erro, erro: true } : { texto: "Salvo.", erro: false });
    } catch {
      setMsg({ texto: "Não foi possível salvar.", erro: true });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-1">
      <label className="block text-[13px] text-vg-text-2" htmlFor={`pixel-${campanhaId}`}>ID do Pixel</label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id={`pixel-${campanhaId}`}
          className={estiloInput}
          inputMode="numeric"
          placeholder="Ex.: 123456789012345"
          value={valor}
          disabled={desabilitado || salvando}
          onChange={(e) => setValor(e.target.value)}
        />
        <Botao onClick={salvar} disabled={desabilitado || salvando}>SALVAR</Botao>
      </div>
      {msg && <p className={`text-xs ${msg.erro ? "text-vg-erro" : "text-vg-ok"}`}>{msg.texto}</p>}
    </div>
  );
}
