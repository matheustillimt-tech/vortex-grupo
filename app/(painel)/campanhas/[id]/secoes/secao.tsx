import { Icone } from "../../../_componentes/icone";
import { Interruptor } from "./interruptor";

/** Casca de uma seção da Visão geral da campanha (igual em todas as seções): título, subtítulo, à direita
 *  o interruptor "Ativado/Desativado", texto, lista com ✓ verde, bloco "Caso de uso" e `children` com os campos da
 *  seção. Só apresentação: o interruptor (cliente) recebe dados, nunca função. */
export function Secao({ titulo, subtitulo, interruptor, texto, itens = [], comoFunciona = [], casosDeUso = [], aviso, children }: {
  titulo: string;
  subtitulo?: string;
  /** Sem `interruptor`, a seção não tem o "Ativado/Desativado" (algumas seções da Etapa 3N salvam ao escolher,
   *  sem interruptor nem "SALVAR".3). */
  interruptor?: { campanhaId: string; chave: string; ativo: boolean; desabilitado?: boolean };
  texto?: React.ReactNode;
  itens?: string[];
  /** Bloco "Como funciona:" (texto corrido, sem ✓) — diferente de `casosDeUso` ("Caso de uso"/"Casos de uso"). */
  comoFunciona?: string[];
  casosDeUso?: string[];
  aviso?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg">{titulo}</h2>
          {subtitulo && <p className="text-[13px] text-vg-text-2">{subtitulo}</p>}
        </div>
        {interruptor && (
          <Interruptor campanhaId={interruptor.campanhaId} interruptor={interruptor.chave} ativo={interruptor.ativo} rotulo={titulo} desabilitado={interruptor.desabilitado} />
        )}
      </div>
      {texto && <p className="text-[13px] text-vg-text">{texto}</p>}
      {itens.length > 0 && (
        <ul className="space-y-1.5">
          {itens.map((item) => (
            <li key={item} className="flex items-start gap-2 text-[13px] text-vg-text">
              <Icone nome="check" tamanho={16} className="mt-0.5 shrink-0 text-vg-ok" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
      {aviso && (
        <p className="flex items-start gap-2 rounded-lg border border-vg-line px-3 py-2 text-[13px] text-vg-aviso">
          <Icone nome="info" tamanho={16} className="mt-0.5 shrink-0" />
          <span>{aviso}</span>
        </p>
      )}
      {children}
      {comoFunciona.length > 0 && (
        <div className="space-y-1.5 rounded-lg bg-vg-panel px-4 py-3">
          <h3 className="text-[13px] font-semibold">Como funciona:</h3>
          {comoFunciona.map((c) => (
            <p key={c} className="text-[13px] text-vg-text-2">{c}</p>
          ))}
        </div>
      )}
      {casosDeUso.length > 0 && (
        <div className="space-y-1.5 rounded-lg bg-vg-panel px-4 py-3">
          <h3 className="text-[13px] font-semibold">{casosDeUso.length > 1 ? "Casos de uso" : "Caso de uso"}</h3>
          {casosDeUso.map((c) => (
            <p key={c} className="text-[13px] text-vg-text-2">{c}</p>
          ))}
        </div>
      )}
    </div>
  );
}
