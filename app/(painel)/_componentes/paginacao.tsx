import Link from "next/link";
import { Icone } from "./icone";
import { SeletorLinhas } from "./seletor-linhas";

/** "Linhas por página 12 · 1-6 de 6" + setas primeira/anterior/próxima/última (links; sem página: seta
 *  apagada). `primeira`/`ultima` são opcionais pra quem já usava este componente (lista de pessoas, grupos…)
 *  continuar igual sem precisar calcular as URLs das pontas. */
export function Paginacao({
  de,
  ate,
  total,
  anterior,
  proxima,
  primeira,
  ultima,
  porPagina = 12,
  opcoesPorPagina,
  parametroPorPagina,
  parametroPagina,
  pontas = true,
  alinhar = "direita",
  rotuloDe = "de",
}: {
  de: number;
  ate: number;
  total: number;
  anterior?: string;
  proxima?: string;
  primeira?: string;
  ultima?: string;
  porPagina?: number;
  /** Com `parametroPorPagina`, troca o texto fixo por um `<SeletorLinhas>`. */
  opcoesPorPagina?: readonly number[];
  /** Nome do parâmetro de URL do seletor de linhas (ex.: "por"). */
  parametroPorPagina?: string;
  /** Nome do parâmetro de página que o seletor de linhas zera (padrão "pagina"; telas embutidas com prefixo
   *  passam o próprio nome, ex.: "subpagina"). */
  parametroPagina?: string;
  /** `false` esconde `first_page`/`last_page` (Automações). */
  pontas?: boolean;
  alinhar?: "direita" | "esquerda";
  /** Palavra entre "ate" e "total" ("de", padrão; Desempenho usa "of"). */
  rotuloDe?: string;
}) {
  const seta = (href: string | undefined, nome: string, rotulo: string) =>
    href ? (
      <Link href={href} scroll={false} aria-label={rotulo} className="grid size-8 place-items-center rounded-full text-vg-text hover:bg-white/5">
        <Icone nome={nome} />
      </Link>
    ) : (
      <span aria-hidden className="grid size-8 place-items-center text-vg-text-3"><Icone nome={nome} /></span>
    );
  const alinhamento = alinhar === "esquerda" ? "justify-start" : "justify-end";
  return (
    <div className={`flex items-center ${alinhamento} gap-x-3 gap-y-2 overflow-x-auto whitespace-nowrap text-sm`}>
      {opcoesPorPagina && parametroPorPagina ? (
        <SeletorLinhas parametro={parametroPorPagina} opcoes={opcoesPorPagina} valor={porPagina} parametroPagina={parametroPagina} />
      ) : (
        <span className="text-vg-text">Linhas por página <span className="ml-3 tabular-nums">{porPagina}</span></span>
      )}
      <span aria-hidden className="text-vg-text-3">·</span>
      <span className="tabular-nums text-vg-text">{de}-{ate} {rotuloDe} {total}</span>
      <span aria-hidden className="text-vg-text-3">·</span>
      <span className="flex items-center">
        {pontas && seta(primeira, "first_page", "Primeira página")}
        {seta(anterior, "chevron_left", "Página anterior")}
        {seta(proxima, "chevron_right", "Próxima página")}
        {pontas && seta(ultima, "last_page", "Última página")}
      </span>
    </div>
  );
}
