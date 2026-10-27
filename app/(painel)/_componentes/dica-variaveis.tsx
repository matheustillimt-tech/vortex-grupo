import { CHAVES_AUTOMATICAS } from "@/src/lib/regras/variaveis";

/** Lista as variáveis que valem no texto. Chave sem valor na hora de enviar bloqueia o envio (e gera alerta). */
export function DicaVariaveis({ personalizadas = [] }: { personalizadas?: string[] }) {
  return (
    <p className="text-xs leading-6 text-vg-muted">
      Variáveis: {[...CHAVES_AUTOMATICAS, ...personalizadas].map((c) => <code key={c} className="mr-1 rounded border border-vg-line bg-vg-panel-3 px-1 text-vg-text-2">{`{${c}}`}</code>)}
      — preenchidas na hora do envio. Vazia bloqueia o envio.
    </p>
  );
}
