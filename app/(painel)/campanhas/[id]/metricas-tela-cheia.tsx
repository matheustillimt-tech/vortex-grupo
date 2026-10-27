"use client";
import { useEffect, useState } from "react";
import { Icone } from "../../_componentes/icone";

function suportaTelaCheia(): boolean {
  return typeof document !== "undefined" && document.fullscreenEnabled === true;
}

function alternarTelaCheia(idAlvo: string) {
  const el = document.getElementById(idAlvo);
  if (!el) return;
  const p = document.fullscreenElement === el ? document.exitFullscreen() : el.requestFullscreen();
  p.catch(() => {});
}

/** `fullscreen` da linha do título "Métricas": põe o bloco inteiro (os 5
 *  gráficos) em tela cheia — diferente do `fullscreen` de cada gráfico (`MenuGrafico`), que mira só o gráfico
 *  dele. Mesma técnica (Fullscreen API no elemento por `id`); sem suporte do navegador, não aparece. */
export function MetricasTelaCheia({ idAlvo }: { idAlvo: string }) {
  const [telaCheia, setTelaCheia] = useState(false);
  const [podeTelaCheia, setPodeTelaCheia] = useState(false);

  useEffect(() => {
    setPodeTelaCheia(suportaTelaCheia());
  }, []);

  useEffect(() => {
    const aoMudar = () => setTelaCheia(document.fullscreenElement === document.getElementById(idAlvo));
    document.addEventListener("fullscreenchange", aoMudar);
    return () => document.removeEventListener("fullscreenchange", aoMudar);
  }, [idAlvo]);

  if (!podeTelaCheia) return null;
  return (
    <button
      type="button"
      onClick={() => alternarTelaCheia(idAlvo)}
      aria-label={telaCheia ? "Saia da tela cheia" : "Ver Métricas em tela cheia"}
      aria-pressed={telaCheia}
      title={telaCheia ? "Saia da tela cheia" : "Ver Métricas em tela cheia"}
      className="grid size-8 place-items-center rounded-md text-vg-text-2 transition-colors hover:bg-white/5 hover:text-white"
    >
      <Icone nome={telaCheia ? "fullscreen_exit" : "fullscreen"} tamanho={20} />
    </button>
  );
}
