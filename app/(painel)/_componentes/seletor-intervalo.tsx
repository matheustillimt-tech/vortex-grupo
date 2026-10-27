"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Icone } from "./icone";
import { estiloInput } from "./ui";

/**
 * "Selecione o intervalo de datas" (cabeçalho dos gráficos): botão que abre dois
 * `<input type="date">` e, ao confirmar, troca `parametroInicio`/`parametroFim` na URL (nomes recebidos por
 * prop — sem função); "Limpar" remove os dois. A validação (`lerIntervalo`) é feita por quem lê a URL na página;
 * aqui só lê/escreve os parâmetros.
 */
export function SeletorIntervalo({ parametroInicio, parametroFim }: { parametroInicio: string; parametroFim: string }) {
  const [aberto, setAberto] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const containerRef = useRef<HTMLDivElement>(null);
  const gatilhoRef = useRef<HTMLButtonElement>(null);
  const [de, setDe] = useState(() => searchParams.get(parametroInicio) ?? "");
  const [ate, setAte] = useState(() => searchParams.get(parametroFim) ?? "");

  useEffect(() => {
    if (!aberto) return;
    const aoClicarFora = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setAberto(false);
    };
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setAberto(false);
        gatilhoRef.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("mousedown", aoClicarFora);
    document.addEventListener("keydown", aoTeclar);
    return () => {
      document.removeEventListener("mousedown", aoClicarFora);
      document.removeEventListener("keydown", aoTeclar);
    };
  }, [aberto]);

  function aplicar(novoDe: string, novoAte: string) {
    const params = new URLSearchParams(searchParams);
    if (novoDe) params.set(parametroInicio, novoDe);
    else params.delete(parametroInicio);
    if (novoAte) params.set(parametroFim, novoAte);
    else params.delete(parametroFim);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
    setAberto(false);
    gatilhoRef.current?.focus({ preventScroll: true });
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={gatilhoRef}
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-expanded={aberto}
        aria-haspopup="dialog"
        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1.5 text-xs text-vg-text-2 transition-colors hover:bg-white/5 hover:text-white"
      >
        <Icone nome="event" tamanho={16} />
        Selecione o intervalo de datas
      </button>
      {aberto && (
        <div
          role="dialog"
          aria-label="Selecione o intervalo de datas"
          className="absolute right-0 top-full z-10 mt-1 w-64 space-y-3 rounded-lg border border-vg-line bg-vg-panel p-3 shadow-xl"
        >
          <label className="block space-y-1 text-xs text-vg-text-2">
            Inicio do intervalo
            <input type="date" value={de} onChange={(e) => setDe(e.target.value)} className={estiloInput} />
          </label>
          <label className="block space-y-1 text-xs text-vg-text-2">
            Fim do intervalo
            <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className={estiloInput} />
          </label>
          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                setDe("");
                setAte("");
                aplicar("", "");
              }}
              className="text-xs text-vg-text-2 underline-offset-2 hover:text-white hover:underline"
            >
              Limpar
            </button>
            <button
              type="button"
              onClick={() => aplicar(de, ate)}
              className="rounded-md bg-vg-primario px-3 py-1 text-xs font-semibold text-white hover:bg-vg-primario-hover"
            >
              Confirmar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
