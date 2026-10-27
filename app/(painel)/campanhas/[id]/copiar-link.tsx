"use client";
import { useRef, useState } from "react";
import { Icone } from "../../_componentes/icone";
import { estiloBotao } from "../../_componentes/ui";

/** Plano B para navegadores que bloqueiam navigator.clipboard (janelas embutidas, permissão negada). */
function copiarPeloMetodoAntigo(texto: string): boolean {
  const campo = document.createElement("textarea");
  campo.value = texto;
  campo.setAttribute("readonly", "");
  campo.style.position = "fixed";
  campo.style.opacity = "0";
  document.body.appendChild(campo);
  campo.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(campo);
  return ok;
}

/** Campo com o link + "Copiar". Com `soBotao`, só o botão (o link fica à mostra em outro lugar). `variante`
 *  troca o estilo do botão: "cheio" (padrão, amarelo) ou "texto" (`content_copy` + "Copiar" sem fundo, usado
 *  na linha do grupo). `semIcone` tira o ícone de qualquer variante (cabeçalho
 *  da Visão geral, que já mostra a URL ao lado). `rotulo` é o `aria-label` do campo (padrão "Link da campanha",
 *  pra não mudar quem já chama sem passar nada — quem mostra o link de um grupo específico deve passar algo
 *  como `Link do grupo {nome}`). */
export function CopiarLink({ url, compacto = false, soBotao = false, variante = "cheio", semIcone = false, rotulo = "Link da campanha" }: {
  url: string;
  compacto?: boolean;
  soBotao?: boolean;
  variante?: "cheio" | "texto";
  semIcone?: boolean;
  rotulo?: string;
}) {
  const [estado, setEstado] = useState<"normal" | "ok" | "manual">("normal");
  const campo = useRef<HTMLInputElement>(null);

  async function copiar() {
    let ok = false;
    try {
      await navigator.clipboard.writeText(url);
      ok = true;
    } catch {
      ok = copiarPeloMetodoAntigo(url);
    }
    if (ok) {
      setEstado("ok");
      setTimeout(() => setEstado("normal"), 1800);
    } else {
      // Último recurso: deixa o endereço selecionado para Cmd+C / Ctrl+C.
      setEstado("manual");
      campo.current?.focus();
      campo.current?.select();
    }
  }

  if (soBotao) {
    return (
      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={copiar}
          aria-live="polite"
          className={
            semIcone
              ? "text-[13px] font-medium text-white transition-colors hover:text-vg-accent"
              : variante === "texto"
                ? "inline-flex items-center gap-1.5 text-[13px] font-medium text-vg-text-2 transition-colors hover:text-white"
                : estiloBotao("principal")
          }
        >
          {!semIcone && <Icone nome={estado === "ok" ? "check" : "content_copy"} tamanho={16} />}
          {estado === "ok" ? "Copiado!" : "Copiar"}
        </button>
        {/* Oculto visualmente; só existe para o fallback manual poder selecionar e copiar o link. */}
        <input ref={campo} readOnly value={url} aria-label={rotulo} className="sr-only" />
        {estado === "manual" && <p className="text-xs text-vg-muted">Este navegador bloqueou a cópia. Selecione o link e aperte Cmd+C (ou Ctrl+C).</p>}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className={`flex min-w-0 items-center gap-2 rounded-[9px] border border-vg-line-2 bg-vg-panel-3 ${compacto ? "py-1 pl-2.5 pr-1" : "py-1.5 pl-3 pr-1.5"}`}>
        <input
          ref={campo}
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className={`min-w-0 flex-1 bg-transparent text-vg-muted outline-none ${compacto ? "w-40 text-xs sm:w-56" : "w-full text-sm sm:w-80"}`}
          aria-label={rotulo}
        />
        <button
          type="button"
          onClick={copiar}
          className={`flex shrink-0 items-center gap-1.5 rounded-md font-semibold transition-colors ${compacto ? "px-2 py-1 text-xs" : "px-2.5 py-1.5 text-[13px]"} ${estado === "ok" ? "bg-vg-ok/15 text-vg-ok" : "text-vg-accent-2 hover:bg-vg-accent/10 hover:text-vg-accent-3"}`}
          aria-label="Copiar link"
        >
          {estado === "ok" ? <Icone nome="check" tamanho={14} /> : <Icone nome="content_copy" tamanho={14} />}
          {estado === "ok" ? "Copiado!" : "Copiar"}
        </button>
      </div>
      {estado === "manual" && <p className="text-xs text-vg-muted">Este navegador bloqueou a cópia. O link está selecionado: aperte Cmd+C (ou Ctrl+C).</p>}
    </div>
  );
}
