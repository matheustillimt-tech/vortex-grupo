"use client";
import Link from "next/link";
import { Icone } from "./icone";

/** Botões amarelos colados (cantos arredondados só nas pontas, divisórias finas). */
export function FaixaBotoes({ children }: { children: React.ReactNode }) {
  return <div className="inline-flex max-w-full overflow-hidden rounded-lg">{children}</div>;
}

const BASE =
  "flex min-w-0 items-center gap-2 px-4 py-2.5 text-left text-[12.5px] font-semibold leading-tight transition-colors first:rounded-l-lg last:rounded-r-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70 disabled:pointer-events-none disabled:opacity-60";
/** Botão de ação (sem `ativo`): cheio, separado do vizinho por uma linha fina. */
const CHEIO = "bg-vg-primario text-white hover:bg-vg-primario-hover border-l border-white/15 first:border-l-0";

/** Mesmo visual cheio/amarelo da faixa, pra um botão avulso que não dá pra encaixar dentro de uma única
 *  `FaixaBotoes` (ex.: `ExportarLeadsMenu`/`AtualizarLeadsBotao`, que têm o próprio estado de menu/mensagem).
 *  Os três ficam lado a lado com um pequeno espaço entre eles, todos amarelos cheios. */
export const ESTILO_BOTAO_FAIXA_CHEIO =
  "inline-flex min-w-0 items-center gap-2 rounded-lg bg-vg-primario px-4 py-2.5 text-left text-[12.5px] font-semibold uppercase leading-tight text-white transition-colors hover:bg-vg-primario-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70 disabled:pointer-events-none disabled:opacity-60";
/** Filtro: contornado quando inativo, cheio quando ativo (mesma borda para não mudar o tamanho). */
const FILTRO_INATIVO = "bg-transparent text-vg-accent border-y border-r border-vg-accent/50 first:border-l hover:bg-vg-accent/10";
const FILTRO_ATIVO = "bg-vg-primario text-white border-y border-r border-vg-primario first:border-l";

/** Item da faixa. Com `href` vira link; com `ativo` definido vira filtro (contorno/cheio). `caixaNormal` tira
 *  o `uppercase` (Atividades "7 / 14 / … / Todo Período"). Sem `icone` (ex.:
 *  os botões "7 / 14 / …" não levam `schedule`), fica só o texto. */
export function BotaoFaixa({ icone, children, ativo, href, onClick, disabled, caixaNormal = false }: {
  icone?: string;
  children: React.ReactNode;
  ativo?: boolean;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  caixaNormal?: boolean;
}) {
  const cor = ativo === undefined ? CHEIO : ativo ? FILTRO_ATIVO : FILTRO_INATIVO;
  const caixa = caixaNormal ? "" : "uppercase";
  const conteudo = (
    <>
      {icone && <Icone nome={icone} tamanho={18} />}
      <span className="min-w-0">{children}</span>
    </>
  );
  if (href) {
    return (
      <Link href={href} className={`${BASE} ${caixa} ${cor}`} aria-current={ativo ? "page" : undefined}>
        {conteudo}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`${BASE} ${caixa} ${cor}`} aria-pressed={ativo}>
      {conteudo}
    </button>
  );
}
