import Link from "next/link";
import { Icone } from "./icone";
import { Simbolo } from "./logo";

export type Tom = "ok" | "atencao" | "erro" | "neutro";
export type CorSelo = "ok" | "erro" | "neutro" | "aviso" | "destaque";
export type Trilha = { rotulo: string; href?: string }[];

/** Superfície padrão e a caixa informativa amarela. */
export const estiloCartao = "rounded-xl border border-vg-line bg-vg-bg";
export const estiloCartaoDestaque = "rounded-xl border border-vg-destaque-borda bg-vg-destaque text-[#c9f3dd]";

/** Ações em texto dentro de listas e tabelas (ver, cancelar, marcar como visto…). */
export const estiloAcao = {
  normal: "inline-flex items-center gap-1 text-xs font-medium text-vg-accent transition-colors hover:text-vg-accent-3",
  perigo: "inline-flex items-center gap-1 text-xs font-medium text-vg-erro transition-colors hover:text-red-300",
  neutro: "inline-flex items-center gap-1 text-xs text-vg-muted transition-colors hover:text-vg-text",
} as const;

/** Símbolo + nome do produto (menu e login). */
export function Marca({ comNome = true }: { comNome?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <Simbolo tamanho={28} />
      {comNome && <span className="text-[15px] font-semibold tracking-[-0.01em]">Vórtex Grupo</span>}
    </span>
  );
}

export function Migalha({ trilha }: { trilha: Trilha }) {
  return (
    <p className="mb-0.5 text-xs text-vg-muted">
      {trilha.map((t, i) => (
        <span key={`${t.rotulo}-${i}`}>
          {t.href ? <Link href={t.href} className="transition-colors hover:text-vg-text">{t.rotulo}</Link> : t.rotulo} /{" "}
        </span>
      ))}
    </p>
  );
}

export function Pagina({ titulo, sobretitulo, subtitulo, trilha, acoes, infoTitulo, contador, children }: {
  /** Sem `titulo`, não desenha o `<h1>` (telas com o título na faixa de abas do topo, ex.: Modelos). */
  titulo?: string;
  sobretitulo?: string;
  subtitulo?: React.ReactNode;
  trilha?: Trilha;
  acoes?: React.ReactNode;
  /** Slot ao lado do título (ex.: `info_outlined` de Atividades/Desempenho). */
  infoTitulo?: React.ReactNode;
  /** Contador ao lado do título (ex.: "0/∞" da Equipe). */
  contador?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-[1200px] space-y-5 px-4 py-6 md:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          {sobretitulo && <p className="mb-0.5 text-sm text-vg-muted">{sobretitulo}</p>}
          {infoTitulo || contador ? (
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-normal leading-8">{titulo}</h1>
              {infoTitulo}
              {contador}
            </div>
          ) : (
            titulo && <h1 className="text-2xl font-normal leading-8">{titulo}</h1>
          )}
          {subtitulo && <p className="mt-1 text-sm text-vg-muted">{subtitulo}</p>}
        </div>
        {acoes && <div className="flex flex-wrap items-center gap-2">{acoes}</div>}
      </div>
      {children}
    </div>
  );
}

export function Cartao({ titulo, acao, destaque = false, className = "", children }: {
  titulo?: string;
  acao?: React.ReactNode;
  destaque?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`${destaque ? estiloCartaoDestaque : estiloCartao} p-4 ${className}`}>
      {(titulo || acao) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {titulo && <h2 className="text-[15px] font-medium">{titulo}</h2>}
          {acao}
        </div>
      )}
      {children}
    </section>
  );
}

const TOM_TEXTO: Record<Tom, string> = { ok: "text-vg-ok", atencao: "text-vg-aviso", erro: "text-vg-erro", neutro: "text-vg-muted" };

/** Cartão de número: ícone amarelo à esquerda, valor 20 px negrito, rótulo 12 px cinza. */
export function Numero({ rotulo, valor, sufixo, variacao, tom = "neutro", destaque = false, icone }: {
  rotulo: string;
  valor: string | number;
  sufixo?: string;
  variacao?: string;
  tom?: Tom;
  destaque?: boolean;
  icone?: string;
}) {
  return (
    <div
      className={`flex min-w-0 items-center gap-3 rounded-lg border border-transparent px-3 py-2 ${destaque ? "ring-1 ring-vg-accent/40" : ""}`}
      style={{
        background:
          "linear-gradient(131deg, #101813 0%, #15211a 50%, #0d120f 100%) padding-box, linear-gradient(to right, #0d120f, #2b3a31) border-box",
      }}
    >
      {icone && <Icone nome={icone} tamanho={24} className="text-vg-accent" />}
      <div className="min-w-0">
        <p className="truncate text-xl font-bold leading-7 tabular-nums">
          {valor}
          {sufixo && <span className="text-sm font-normal text-vg-muted"> {sufixo}</span>}
        </p>
        <p className="text-xs leading-4 text-vg-text-3">{rotulo}</p>
        {variacao && <p className={`text-[11px] leading-snug ${TOM_TEXTO[tom]}`}>{variacao}</p>}
      </div>
    </div>
  );
}

type VarianteBotao = "principal" | "contorno" | "secundario" | "perigo";

const BASE_BOTAO =
  "inline-flex items-center justify-center gap-2 rounded-lg px-[21px] py-[7px] text-[13.7px] font-medium whitespace-nowrap transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vg-accent/40 disabled:pointer-events-none disabled:opacity-50";

const COR_BOTAO: Record<VarianteBotao, string> = {
  principal: "bg-vg-primario font-semibold text-white hover:bg-vg-primario-hover",
  contorno: "border border-vg-accent/50 text-vg-accent hover:border-vg-accent hover:bg-vg-accent/10",
  secundario: "border border-vg-line-2 text-vg-text hover:bg-white/5",
  perigo: "bg-vg-erro font-semibold text-white hover:bg-[#e0524d]",
};

export function estiloBotao(variante: VarianteBotao = "principal"): string {
  return `${BASE_BOTAO} ${COR_BOTAO[variante]}`;
}

export function Botao({ children, variante = "principal", icone, className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variante?: VarianteBotao; icone?: React.ReactNode }) {
  return (
    <button {...p} className={`${estiloBotao(variante)} ${className ?? ""}`}>
      {icone}
      {children}
    </button>
  );
}

export function BotaoLink({ href, children, variante = "principal", icone }: { href: string; children: React.ReactNode; variante?: VarianteBotao; icone?: React.ReactNode }) {
  return (
    <Link href={href} className={estiloBotao(variante)}>
      {icone}
      {children}
    </Link>
  );
}

/** `contador` (ex.: "37/95") entra abaixo do campo, à direita — rótulos com asterisco das telas de criação de
 *  grupos. Opcional: sem ele, o visual é idêntico ao de hoje. */
export function Campo({ rotulo, dica, contador, children }: { rotulo: string; dica?: string; contador?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[13.3px] text-[#e3e9e5]">{rotulo}</span>
      {children}
      {(dica || contador) && (
        <span className="flex items-start justify-between gap-2">
          {dica && <span className="flex-1 text-xs text-vg-muted">{dica}</span>}
          {contador && <span className="shrink-0 text-xs tabular-nums text-vg-text-3">{contador}</span>}
        </span>
      )}
    </label>
  );
}

export const estiloInput =
  "w-full rounded border border-vg-line-2 bg-transparent px-3 py-2 text-[13.3px] text-vg-text outline-none transition placeholder:text-vg-text-3 hover:border-white/60 focus:border-vg-accent focus:ring-1 focus:ring-vg-accent disabled:opacity-60";

export const PONTO: Record<CorSelo, string> = { ok: "bg-vg-ok", erro: "bg-vg-erro", neutro: "bg-vg-text-3", aviso: "bg-vg-aviso", destaque: "bg-vg-accent" };

/** Pílula com bolinha colorida. */
export function Selo({ cor, semPonto = false, children }: { cor: CorSelo; semPonto?: boolean; children: React.ReactNode }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-vg-line-2 bg-transparent px-2 py-0.5 text-[11px] font-medium text-vg-text-2">
      {!semPonto && <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${PONTO[cor]}`} />}
      <span className="min-w-0">{children}</span>
    </span>
  );
}

export function Tabela({ colunas, children, vazio, vazioDetalhe, semCabecalhoQuandoVazio = false, vazioSemIcone = false, semCabecalho = false }: {
  colunas: string[];
  children?: React.ReactNode;
  vazio?: string;
  /** 2ª linha do vazio. */
  vazioDetalhe?: string;
  /** Esconde o `<thead>` quando `vazio` está preenchido. Padrão `false` = hoje. */
  semCabecalhoQuandoVazio?: boolean;
  /** Vazio sem o ícone `inbox` (Etapa 3N, aba Pendentes). Padrão `false` = hoje. */
  vazioSemIcone?: boolean;
  /** Esconde o `<thead>` sempre, com ou sem dados (Etapa 3N, Contas e Campanhas › Por conta). Padrão `false` = hoje. */
  semCabecalho?: boolean;
}) {
  const oculta = semCabecalho || (semCabecalhoQuandoVazio && !!vazio);
  return (
    <div className="overflow-x-auto rounded-xl border border-vg-line">
      <table className="w-full text-sm">
        {!oculta && (
          <thead className="border-b border-vg-line text-left text-[13px] font-medium text-vg-text">
            <tr>{colunas.map((c, i) => <th key={`${c}-${i}`} className="px-3 py-2.5 font-medium">{c}</th>)}</tr>
          </thead>
        )}
        <tbody className="divide-y divide-vg-line [&>tr]:transition-colors [&>tr:hover]:bg-white/[0.03]">{children}</tbody>
      </table>
      {vazio && <Vazio texto={vazio} detalhe={vazioDetalhe} compacto semIcone={vazioSemIcone} />}
    </div>
  );
}

/** Estado vazio: ícone + frase + detalhe opcional + ação opcional. */
export function Vazio({ texto, icone, acao, compacto = false, detalhe, semIcone = false }: { texto: string; icone?: React.ReactNode; acao?: React.ReactNode; compacto?: boolean; detalhe?: string; semIcone?: boolean }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-2 text-center ${compacto ? "px-4 py-6" : "px-6 py-10"}`}>
      {!semIcone && <span className="grid size-9 place-items-center rounded-full border border-vg-line-2 bg-vg-panel-3 text-vg-text-3">{icone ?? <Icone nome="inbox" tamanho={16} />}</span>}
      <p className="text-[15px] text-vg-text">{texto}</p>
      {detalhe && <p className="max-w-sm text-[13px] text-vg-text-3">{detalhe}</p>}
      {acao}
    </div>
  );
}

/** Botões de alternar (Mensagem/Enquete, QR/Código, seletor de período…). Só dentro de componente "use client" (recebe função). */
export function Segmentos<T extends string>({ opcoes, valor, aoMudar }: { opcoes: { valor: T; rotulo: string }[]; valor: T; aoMudar: (v: T) => void }) {
  return (
    <div role="tablist" className="inline-flex rounded-[10px] border border-white/[0.14] p-0">
      {opcoes.map((o) => (
        <button
          key={o.valor}
          type="button"
          role="tab"
          aria-selected={o.valor === valor}
          onClick={() => aoMudar(o.valor)}
          className={`whitespace-nowrap px-4 py-1.5 text-sm font-semibold transition-colors ${o.valor === valor ? "rounded-[10px] bg-vg-accent/15 text-vg-accent ring-1 ring-vg-accent/60" : "text-[#e3e9e5] hover:text-white"}`}
        >
          {o.rotulo}
        </button>
      ))}
    </div>
  );
}
