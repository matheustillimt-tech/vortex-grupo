import type { CartaoNumero } from "@/src/lib/regras/campanhas";
import { Icone } from "./icone";
import { Numero } from "./ui";

/** Linha informativa: ícone ⓘ + texto 12 px cinza. `semIcone` tira o ícone (Campanhas usa o do
 *  `ExplicacaoDados` antes do texto.2). */
export function Informativo({ children, semIcone = false }: { children: React.ReactNode; semIcone?: boolean }) {
  return (
    <p className="flex items-start gap-2 text-xs leading-5 text-vg-muted">
      {!semIcone && <Icone nome="info_outline" tamanho={18} className="text-vg-text-2" />}
      <span>{children}</span>
    </p>
  );
}

/** Os 8 cartões de número em 4 colunas (2 no celular). */
export function GradeNumeros({ cartoes }: { cartoes: CartaoNumero[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      {cartoes.map((c) => (
        <Numero key={c.rotulo} icone={c.icone} rotulo={c.rotulo} valor={c.valor} variacao={c.detalhe} tom="neutro" />
      ))}
    </div>
  );
}
