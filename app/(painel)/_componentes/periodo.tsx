import Link from "next/link";

/** 7 Dias · 14 Dias · …: grupo com borda, ativo amarelo com fundo translúcido. Links (sem JS). */
export function SeletorPeriodo({
  atual,
  opcoes,
  href,
  sufixo = " Dias",
  rotulo = "Período",
}: {
  atual: number;
  opcoes: readonly number[];
  href: (d: number) => string;
  sufixo?: string;
  rotulo?: string;
}) {
  return (
    <nav aria-label={rotulo} className="inline-flex max-w-full overflow-x-auto rounded-[10px] border border-white/[0.14]">
      {opcoes.map((d) => (
        <Link
          key={d}
          href={href(d)}
          scroll={false}
          aria-current={d === atual ? "page" : undefined}
          className={`whitespace-nowrap px-4 py-1.5 text-sm font-semibold tabular-nums transition-colors ${d === atual ? "rounded-[10px] bg-vg-accent/15 text-vg-accent ring-1 ring-vg-accent/60" : "text-[#e3e9e5] hover:text-white"}`}
        >
          {d}{sufixo}
        </Link>
      ))}
    </nav>
  );
}
