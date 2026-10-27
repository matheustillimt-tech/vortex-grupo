import { useId } from "react";
import { Icone } from "./icone";

type CampoBuscaProps = {
  /** Nome do campo no form GET (padrão "q", igual às telas que já usam `?q=`). */
  nome?: string;
  /** Valor inicial pra uso não controlado (form GET de página de servidor). */
  valorInicial?: string;
  /** Valor controlado, pra lista filtrada no navegador. Dá junto com `aoMudar`. */
  valor?: string;
  aoMudar?: (valor: string) => void;
  /** Texto do `aria-label`/leitura de tela; o rótulo visível flutuante é o de `rotuloVisivel` (padrão "Buscar"). */
  rotulo?: string;
  /** Rótulo flutuante visível (padrão "Buscar", o de hoje). */
  rotuloVisivel?: string;
  /** Posição da lupa; `"nenhum"` esconde (ex.: `ColunaBusca`, Início). Padrão `"esquerda"`, como hoje. */
  icone?: "esquerda" | "direita" | "nenhum";
  id?: string;
  className?: string;
  /** Repassado pro `<input>` (ex.: "numeric" nas buscas por telefone, igual às telas que já tinham isso). */
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
};

/** Campo de busca largo com rótulo flutuante "Buscar" e lupa.
 *  Funciona não controlado (form GET nativo, `name="q"` por padrão) ou controlado (lista filtrada no cliente,
 *  via `valor`/`aoMudar`) — mesma marcação nos dois casos, pra não duplicar estilo em cada tela. */
export function CampoBusca({ nome = "q", valorInicial, valor, aoMudar, rotulo, rotuloVisivel = "Buscar", icone = "esquerda", id, className = "w-full", inputMode }: CampoBuscaProps) {
  // `useId()` funciona em Server e Client Components; evita id repetido quando a mesma tela usa mais de um
  // `CampoBusca` com o mesmo `nome`. `id` continua aceito pra quem quer controlar o próprio id.
  const gerado = useId();
  const campoId = id ?? gerado;
  const controlado = valor !== undefined;
  const padInput = icone === "esquerda" ? "pl-9" : icone === "direita" ? "pr-9" : "";
  const padLabel = icone === "esquerda" ? "left-9" : "left-3";
  return (
    <div className={`relative ${className}`}>
      {icone !== "nenhum" && (
        <Icone
          nome="search"
          tamanho={18}
          className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-vg-text-3 ${icone === "direita" ? "right-3" : "left-3"}`}
        />
      )}
      <input
        id={campoId}
        type="search"
        name={nome}
        inputMode={inputMode}
        placeholder=" "
        aria-label={rotulo ?? rotuloVisivel}
        {...(controlado
          ? { value: valor, onChange: (e: React.ChangeEvent<HTMLInputElement>) => aoMudar?.(e.target.value) }
          : { defaultValue: valorInicial })}
        className={`peer w-full rounded border border-vg-line-2 bg-transparent px-3 pb-2 pt-5 text-[13.3px] text-vg-text outline-none transition placeholder:text-transparent hover:border-white/60 focus:border-vg-accent focus:ring-1 focus:ring-vg-accent ${padInput}`}
      />
      <label
        htmlFor={campoId}
        className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-[13.3px] text-vg-text-3 transition-all peer-focus:top-3 peer-focus:text-[11px] peer-focus:text-vg-accent peer-[&:not(:placeholder-shown)]:top-3 peer-[&:not(:placeholder-shown)]:text-[11px] peer-[&:not(:placeholder-shown)]:text-vg-text-2 ${padLabel}`}
      >
        {rotuloVisivel}
      </label>
    </div>
  );
}
