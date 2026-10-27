import { ROTULO_SITUACAO, corDaSituacao, type Situacao } from "@/src/lib/regras/calendario";
import { Selo } from "./ui";

/** "feito 30/30 · lido por 9.812": situação + detalhe (+ `extra`) numa pílula só. */
export function SeloSituacao({ situacao, detalhe, extra }: { situacao: Situacao; detalhe?: string | null; extra?: string }) {
  const resto = [detalhe, extra].filter(Boolean).join(" · ");
  return (
    <Selo cor={corDaSituacao(situacao, detalhe)}>
      {ROTULO_SITUACAO[situacao]}
      {resto && <span className="tabular-nums">{` ${resto}`}</span>}
    </Selo>
  );
}

export const ROTULO_ORIGEM: Record<string, string> = { avulsa: "avulsa", sequencia: "sequência", massa: "em massa", grupo_novo: "grupo novo", automacao: "automação", campanha: "seção da campanha" };
