"use client";
import { useEffect, useRef, useState } from "react";
import { csvDaSerie, nomeArquivoGrafico } from "@/src/lib/regras/grafico-exportar";
import { proximoFoco, SELETOR_ITEM_MENU } from "@/src/lib/regras/teclado-menu";
import { Icone } from "./icone";

const FUNDO_PADRAO = "#080a09";

function baixar(blob: Blob, nome: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function svgDoAlvo(idAlvo: string): SVGSVGElement | null {
  return document.getElementById(idAlvo)?.querySelector("svg") ?? null;
}

/** SVG serializado com `<style>`/fundo embutidos, pra abrir sozinho fora da página. */
function svgSerializado(svg: SVGSVGElement, fundo: string): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const estilo = document.createElementNS("http://www.w3.org/2000/svg", "style");
  estilo.textContent = `svg { background: ${fundo}; }`;
  clone.insertBefore(estilo, clone.firstChild);
  const retanguloFundo = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  retanguloFundo.setAttribute("x", "0");
  retanguloFundo.setAttribute("y", "0");
  retanguloFundo.setAttribute("width", "100%");
  retanguloFundo.setAttribute("height", "100%");
  retanguloFundo.setAttribute("fill", fundo);
  clone.insertBefore(retanguloFundo, clone.firstChild);
  return new XMLSerializer().serializeToString(clone);
}

function baixarSvg(idAlvo: string, titulo: string) {
  const svg = svgDoAlvo(idAlvo);
  if (!svg) return;
  const texto = svgSerializado(svg, FUNDO_PADRAO);
  baixar(new Blob([texto], { type: "image/svg+xml" }), nomeArquivoGrafico(titulo, "svg"));
}

async function baixarPng(idAlvo: string, titulo: string) {
  const svg = svgDoAlvo(idAlvo);
  if (!svg) return;
  const fundo = getComputedStyle(document.documentElement).getPropertyValue("--color-vg-bg").trim() || FUNDO_PADRAO;
  const texto = svgSerializado(svg, fundo);
  const viewBox = svg.viewBox.baseVal;
  const largura = (viewBox && viewBox.width) || svg.clientWidth || 600;
  const altura = (viewBox && viewBox.height) || svg.clientHeight || 220;
  const escala = 2;
  const img = new Image();
  const carregada = new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("falha ao carregar o SVG"));
  });
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(texto)}`;
  try {
    await carregada;
  } catch {
    return;
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(largura * escala);
  canvas.height = Math.round(altura * escala);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = fundo;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  canvas.toBlob((blob) => {
    if (blob) baixar(blob, nomeArquivoGrafico(titulo, "png"));
  }, "image/png");
}

function baixarCsv(titulo: string, serie: { data: string; valor: number }[]) {
  baixar(new Blob([csvDaSerie(titulo, serie)], { type: "text/csv;charset=utf-8" }), nomeArquivoGrafico(titulo, "csv"));
}

function alvoEmTelaCheia(idAlvo: string): boolean {
  return document.fullscreenElement === document.getElementById(idAlvo);
}

/** Nem todo navegador/contexto tem tela cheia (iframe sem `allow="fullscreen"`, Safari antigo…): sem isso, o
 *  botão fica ali sem fazer nada. */
function suportaTelaCheia(): boolean {
  return typeof document !== "undefined" && document.fullscreenEnabled === true;
}

function alternarTelaCheia(idAlvo: string) {
  const el = document.getElementById(idAlvo);
  if (!el) return;
  // `requestFullscreen`/`exitFullscreen` devolvem uma Promise que rejeita se o navegador recusar (ex.: sem
  // interação do usuário, política de permissão) — sem isso, vira um "unhandled rejection" no console.
  const p = document.fullscreenElement === el ? document.exitFullscreen() : el.requestFullscreen();
  p.catch(() => {});
}

/**
 * Cabeçalho de ações do gráfico (`GraficoMetrica`): botão `fullscreen`
 * (vira `fullscreen_exit` quando ativo) + menu "⋮" com "Download SVG", "Download PNG", "Download CSV" e "Ver em
 * tela cheia". Tudo com APIs do navegador (`XMLSerializer`, `<canvas>`,
 * `Blob`, `requestFullscreen`); sem dependência nova. Teclado do menu: setas/Home/End navegam, Esc fecha
 * (reaproveita `teclado-menu.ts`, idêntico ao `MenuCartao`).
 */
export function MenuGrafico({ idAlvo, titulo, serie, telaCheia: permiteTelaCheia = true }: {
  idAlvo: string;
  titulo: string;
  serie?: { data: string; valor: number }[];
  /** `false` tira o botão `fullscreen` e "Ver em tela cheia" do menu (Atividades: só o menu
   *  de download). Padrão `true` = hoje. */
  telaCheia?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [telaCheia, setTelaCheia] = useState(false);
  // Lido só no cliente (efeito), pra não divergir da renderização do servidor (sem `document` lá).
  const [podeTelaCheiaNavegador, setPodeTelaCheiaNavegador] = useState(false);
  const podeTelaCheia = permiteTelaCheia && podeTelaCheiaNavegador;
  const containerRef = useRef<HTMLDivElement>(null);
  const gatilhoRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setPodeTelaCheiaNavegador(suportaTelaCheia());
  }, []);

  useEffect(() => {
    const aoMudar = () => setTelaCheia(alvoEmTelaCheia(idAlvo));
    document.addEventListener("fullscreenchange", aoMudar);
    return () => document.removeEventListener("fullscreenchange", aoMudar);
  }, [idAlvo]);

  useEffect(() => {
    if (!aberto) return;
    containerRef.current?.querySelector<HTMLButtonElement>(SELETOR_ITEM_MENU)?.focus();

    const fecharComFoco = () => {
      setAberto(false);
      gatilhoRef.current?.focus({ preventScroll: true });
    };
    const aoClicarFora = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setAberto(false);
    };
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        fecharComFoco();
        return;
      }
      const focaveis = [...(containerRef.current?.querySelectorAll<HTMLButtonElement>(SELETOR_ITEM_MENU) ?? [])];
      const proximo = proximoFoco(focaveis.indexOf(document.activeElement as HTMLButtonElement), focaveis.length, e.key);
      if (proximo === null) return;
      e.preventDefault();
      focaveis[proximo]?.focus();
    };
    document.addEventListener("mousedown", aoClicarFora);
    document.addEventListener("keydown", aoTeclar);
    return () => {
      document.removeEventListener("mousedown", aoClicarFora);
      document.removeEventListener("keydown", aoTeclar);
    };
  }, [aberto]);

  function escolher(acao: () => void) {
    setAberto(false);
    gatilhoRef.current?.focus({ preventScroll: true });
    acao();
  }

  return (
    <div ref={containerRef} className="relative flex items-center gap-0.5">
      {podeTelaCheia && (
        <button
          type="button"
          onClick={() => alternarTelaCheia(idAlvo)}
          aria-label={telaCheia ? "Saia da tela cheia" : "Ver em tela cheia"}
          aria-pressed={telaCheia}
          title={telaCheia ? "Saia da tela cheia" : "Ver em tela cheia"}
          className="grid size-8 place-items-center rounded-md text-vg-text-2 transition-colors hover:bg-white/5 hover:text-white"
        >
          <Icone nome={telaCheia ? "fullscreen_exit" : "fullscreen"} tamanho={20} />
        </button>
      )}
      <button
        ref={gatilhoRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-label="Menu do gráfico"
        onClick={() => setAberto((a) => !a)}
        className="grid size-8 place-items-center rounded-md text-vg-text-2 transition-colors hover:bg-white/5 hover:text-white"
      >
        <Icone nome="menu" tamanho={20} />
      </button>
      {aberto && (
        <div role="menu" className="absolute right-0 top-full z-10 mt-1 w-48 overflow-hidden rounded-lg border border-vg-line bg-vg-panel py-1 shadow-xl">
          <button
            type="button"
            role="menuitem"
            onClick={() => escolher(() => baixarSvg(idAlvo, titulo))}
            className="block w-full px-3 py-2 text-left text-[13px] text-vg-text transition-colors hover:bg-white/5"
          >
            Download SVG
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => escolher(() => baixarPng(idAlvo, titulo))}
            className="block w-full px-3 py-2 text-left text-[13px] text-vg-text transition-colors hover:bg-white/5"
          >
            Download PNG
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!serie}
            onClick={() => serie && escolher(() => baixarCsv(titulo, serie))}
            className="block w-full px-3 py-2 text-left text-[13px] text-vg-text transition-colors hover:bg-white/5 disabled:pointer-events-none disabled:opacity-40"
          >
            Download CSV
          </button>
          {podeTelaCheia && (
            <button
              type="button"
              role="menuitem"
              onClick={() => escolher(() => alternarTelaCheia(idAlvo))}
              className="block w-full px-3 py-2 text-left text-[13px] text-vg-text transition-colors hover:bg-white/5"
            >
              Ver em tela cheia
            </button>
          )}
        </div>
      )}
    </div>
  );
}
