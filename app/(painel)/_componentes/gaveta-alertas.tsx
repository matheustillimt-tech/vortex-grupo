"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef } from "react";
import { INFO_ALERTA, tipoAlertaValido } from "@/src/lib/regras/alertas";
import { isoParaBrasilia } from "@/src/lib/regras/horario";
import { marcarTodosVistos } from "../actions";
import { Icone } from "./icone";
import { estiloAcao, estiloBotao, Vazio } from "./ui";

const FOCAVEIS =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export type AlertaGaveta = { id: string; created_at: string; tipo: string; texto: string };

/** Gaveta de notificações do sino: painel de 320 px à direita sobre fundo escurecido, com os alertas não
 *  vistos mais novos (20). Esc e clique no fundo fecham; foco presa dentro enquanto aberta, como a `Janela`. */
export function GavetaAlertas({
  aberta,
  aoFechar,
  alertas,
  verMetricas,
}: {
  aberta: boolean;
  aoFechar: () => void;
  alertas: AlertaGaveta[];
  /** Os avisos moram em Métricas: sem "ver" lá, não mostra o link "Ver todos". */
  verMetricas: boolean;
}) {
  const idTitulo = useId();
  const refPainel = useRef<HTMLDivElement>(null);
  const refFechar = useRef<HTMLButtonElement>(null);
  const refAoFechar = useRef(aoFechar);
  const router = useRouter();
  useEffect(() => {
    refAoFechar.current = aoFechar;
  });

  useEffect(() => {
    if (!aberta) return;
    const anterior = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    refFechar.current?.focus();

    const corpoAnterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        refAoFechar.current();
        return;
      }
      if (e.key !== "Tab" || !refPainel.current) return;
      const focaveis = [...refPainel.current.querySelectorAll<HTMLElement>(FOCAVEIS)].filter((el) => el.offsetParent !== null || el === document.activeElement);
      const dentro = refPainel.current.contains(document.activeElement);
      if (!dentro) {
        e.preventDefault();
        (focaveis[0] ?? refPainel.current).focus();
        return;
      }
      if (focaveis.length === 0) return;
      const primeiro = focaveis[0];
      const ultimo = focaveis[focaveis.length - 1];
      if (e.shiftKey && document.activeElement === primeiro) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primeiro.focus();
      }
    };
    document.addEventListener("keydown", aoTeclar);
    return () => {
      document.removeEventListener("keydown", aoTeclar);
      document.body.style.overflow = corpoAnterior;
      if (anterior?.isConnected) anterior.focus();
    };
  }, [aberta]);

  if (!aberta) return null;

  async function marcarEAtualizar() {
    await marcarTodosVistos();
    router.refresh();
  }

  return (
    <div className="fixed inset-0 z-50">
      {/* Fundo: irmão do painel (não ancestral), pra não escondê-lo da leitura de tela. Clique fecha. */}
      <div aria-hidden onClick={aoFechar} className="fixed inset-0 bg-black/60 backdrop-blur-[2px]" />
      <div
        ref={refPainel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        tabIndex={-1}
        className="fixed inset-y-0 right-0 flex w-[320px] max-w-full flex-col border-l border-vg-line bg-vg-panel shadow-xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-vg-line px-4 py-3.5">
          <h2 id={idTitulo} className="text-[15px] font-medium">Notificações</h2>
          <button
            ref={refFechar}
            type="button"
            onClick={aoFechar}
            aria-label="Fechar"
            className="grid size-8 place-items-center rounded-md text-vg-text-2 transition-colors hover:bg-white/5 hover:text-white"
          >
            <Icone nome="close" tamanho={20} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {alertas.length === 0 ? (
            <Vazio texto="Não há notificações por enquanto." />
          ) : (
            <ul className="divide-y divide-vg-line">
              {alertas.map((a) => {
                const info = tipoAlertaValido(a.tipo) ? INFO_ALERTA[a.tipo] : { rotulo: a.tipo, icone: "notifications" };
                return (
                  <li key={a.id}>
                    <Link href="/alertas" onClick={aoFechar} className="flex items-start gap-2.5 px-4 py-3 text-sm transition-colors hover:bg-white/5">
                      <Icone nome={info.icone} className="mt-0.5 shrink-0 text-vg-text-2" />
                      <div className="min-w-0">
                        <p className="text-vg-text"><span className="font-medium text-vg-text-2">{info.rotulo}</span> — {a.texto}</p>
                        <p className="mt-0.5 text-xs tabular-nums text-vg-muted">{isoParaBrasilia(a.created_at)}</p>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-vg-line px-4 py-3">
          <form action={marcarEAtualizar}>
            <button type="submit" className={estiloBotao("secundario")} disabled={alertas.length === 0}>
              Marcar como vistos
            </button>
          </form>
          {verMetricas && (
            <Link href="/alertas" onClick={aoFechar} className={estiloAcao.normal}>
              Ver todos
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
