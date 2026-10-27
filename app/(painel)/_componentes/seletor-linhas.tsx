"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { estiloInput } from "./ui";

/** Select "Linhas por página" (`Paginacao`): troca só `parametro` na URL e
 *  volta `pagina` para 1, lendo o resto de `useSearchParams` — sem prop de função (só dados: nome do parâmetro,
 *  opções, valor atual). */
export function SeletorLinhas({ parametro, opcoes, valor, parametroPagina = "pagina" }: {
  parametro: string;
  opcoes: readonly number[];
  valor: number;
  /** Nome do parâmetro de página a zerar (padrão "pagina"); telas embutidas com prefixo (ex.: "subpagina")
   *  passam o próprio nome, pra não deixar a página antiga presa num parâmetro que ninguém lê mais. */
  parametroPagina?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function aoMudar(novo: string) {
    const params = new URLSearchParams(searchParams);
    params.set(parametro, novo);
    params.set(parametroPagina, "1");
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <label className="flex shrink-0 items-center gap-2 whitespace-nowrap text-vg-text">
      Linhas por página
      <select
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        aria-label="Linhas por página"
        className={`${estiloInput} w-16 py-1`}
      >
        {opcoes.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );
}
