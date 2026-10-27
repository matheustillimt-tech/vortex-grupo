import Link from "next/link";
import { FILTROS_HISTORICO, ROTULO_FILTRO_HISTORICO, type FiltroHistorico } from "@/src/lib/regras/solicitacoes";

/** Botões de status do "Histórico de solicitações" (TODAS / APROVADAS / REJEITADAS / CANCELADAS / EXPIRADAS). Só
 *  links: `?status=` com a busca e a página preservadas (página que ficar vazia volta pra 1 na própria tela). */
export function FiltrosHistorico({ base, atual, busca, pagina }: { base: string; atual: FiltroHistorico; busca: string; pagina: number }) {
  const href = (f: FiltroHistorico) => {
    const p = new URLSearchParams();
    if (busca) p.set("q", busca);
    if (f !== "todas") p.set("status", f);
    if (pagina > 1) p.set("pagina", String(pagina));
    const s = p.toString();
    return `${base}${s ? `?${s}` : ""}`;
  };
  return (
    <nav aria-label="Status" className="flex flex-wrap gap-2">
      {FILTROS_HISTORICO.map((f) => (
        <Link
          key={f}
          href={href(f)}
          aria-current={f === atual ? "page" : undefined}
          className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
            f === atual ? "border-vg-accent/60 bg-vg-accent/15 text-vg-accent" : "border-vg-line-2 text-vg-text-2 hover:text-vg-text"
          }`}
        >
          {ROTULO_FILTRO_HISTORICO[f]}
        </Link>
      ))}
    </nav>
  );
}
